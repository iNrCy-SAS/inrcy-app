import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from 'next/server';
import { jsonUserFacingError } from '@/lib/apiUserFacingErrors';
import { DASHBOARD_CHANNEL_KEYS, isDashboardChannelKey, type DashboardChannelKey } from '@/lib/dashboardChannels';
import { requireUser } from '@/lib/requireUser';
import { getDefaultSnapshotDate } from '@/lib/stats/snapshotWindow';
import { buildStatsConnectionSignature } from '@/lib/stats/connectionSignature';
import { readLastGoodLinkedInGeneratorBlock, shouldUseLinkedInStatsFallback } from '@/lib/linkedinStatsFallback';
import { buildGeneratorChannelBlocks, summarizeGeneratorChannelBlocks, type GeneratorChannelBlock, type GeneratorChannelBlocksByChannel } from '@/lib/generator/channelBlocks';
import {
  EMPTY_CUBE_RECORD,
  INCLUDE_BY_CUBE,
  computeHistoryFromOverviews,
  computeOpportunitiesFromOverviews,
  toInrstatsSnapshot,
  type CubeKey,
  type Overview,
} from '@/lib/metrics/computeMetrics';
import { buildStatsOverview } from '@/lib/stats/buildOverview';

type ProfileMetrics = {
  lead_conversion_rate: number;
  avg_basket: number;
};

type ChannelGeneratorRefreshResponse = {
  channel: DashboardChannelKey;
  syncAt: number;
  generator: {
    block: GeneratorChannelBlock;
    leads: {
      month: number;
      week: number;
      today: number;
      byTool: Record<CubeKey, number>;
    };
    estimatedValue: number;
    generatorBlocks: GeneratorChannelBlocksByChannel;
    details: {
      opportunities: ReturnType<typeof toInrstatsSnapshot>;
      profile: ProfileMetrics;
    };
    meta: {
      source: 'api/metrics/channel-refresh';
      generatedAt: string;
      snapshotDate: string | null;
      live: boolean;
    };
  };
};

async function fetchProfileMetrics(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
): Promise<ProfileMetrics> {
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('lead_conversion_rate, avg_basket')
    .eq('user_id', userId)
    .maybeSingle();

  const leadConversionRate = Number(profileRow?.lead_conversion_rate ?? 0);
  const avgBasket = Number(profileRow?.avg_basket ?? 0);

  return {
    lead_conversion_rate: Number.isFinite(leadConversionRate) ? leadConversionRate : 0,
    avg_basket: Number.isFinite(avgBasket) ? avgBasket : 0,
  };
}

async function fetchChannelOverview(args: {
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'];
  userId: string;
  channel: DashboardChannelKey;
  days: 7 | 30;
  snapshotDate: string;
  metaPilotEnabled?: boolean;
}): Promise<Overview> {
  const { supabase, userId, channel, days, snapshotDate } = args;
  return await buildStatsOverview({
    supabase,
    userId,
    days,
    includeRaw: INCLUDE_BY_CUBE[channel],
    fresh: true,
    metaPilotEnabled: args.metaPilotEnabled,
    snapshotDate,
  }) as Overview;
}

export async function POST(req: Request) {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({} as { channel?: unknown }));
    const channel = body?.channel;

    if (!isDashboardChannelKey(channel)) {
      return NextResponse.json({
        error: `Canal invalide. Valeurs acceptées : ${DASHBOARD_CHANNEL_KEYS.join(', ')}.`,
      }, { status: 400 });
    }

    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
    if (channel === "threads" && !metaPilotEnabled) return metaChannelPilotDeniedResponse();
    const snapshotDate = getDefaultSnapshotDate();
    const [profile, monthOverview, weekOverview, connectionSignature] = await Promise.all([
      fetchProfileMetrics(supabase, activeUserId),
      fetchChannelOverview({ supabase, userId: activeUserId, channel, days: 30, snapshotDate, metaPilotEnabled }),
      fetchChannelOverview({ supabase, userId: activeUserId, channel, days: 7, snapshotDate, metaPilotEnabled }),
      buildStatsConnectionSignature(supabase, activeUserId),
    ]);

    const monthOverviews: Partial<Record<CubeKey, Overview>> = { [channel]: monthOverview };
    const weekOverviews: Partial<Record<CubeKey, Overview>> = { [channel]: weekOverview };

    const opportunitiesBase = toInrstatsSnapshot(computeOpportunitiesFromOverviews(monthOverviews, 30));
    const opportunities = {
      ...opportunitiesBase,
      today: Math.max(0, Math.round((opportunitiesBase.total / 30) * 2)),
      week: Math.max(0, Math.round((opportunitiesBase.total / 30) * 7)),
      month: opportunitiesBase.total,
    };

    const [history30, history7] = await Promise.all([
      computeHistoryFromOverviews(monthOverviews, 30),
      computeHistoryFromOverviews(weekOverviews, 7),
    ]);

    const syncAt = Date.now();
    const generatedAt = new Date(syncAt).toISOString();
    const resolvedSnapshotDate = monthOverview?.meta?.snapshotDate ?? weekOverview?.meta?.snapshotDate ?? snapshotDate ?? null;
    const live = Boolean(monthOverview?.meta?.live ?? weekOverview?.meta?.live ?? false);

    const generatorBlocks = buildGeneratorChannelBlocks({
      monthLeadsByCube: history30?.perTool || { ...EMPTY_CUBE_RECORD },
      weekLeadsByCube: history7?.perTool || { ...EMPTY_CUBE_RECORD },
      opportunitiesByCube: opportunities.byCube || { ...EMPTY_CUBE_RECORD },
      leadConversionRate: profile.lead_conversion_rate,
      avgBasket: profile.avg_basket,
      generatedAt,
      snapshotDate: resolvedSnapshotDate,
      live,
    });

    const linkedInFallback = channel === 'linkedin'
      ? await readLastGoodLinkedInGeneratorBlock({
          supabase,
          userId: activeUserId,
          connectionSignature,
        })
      : null;
    if (channel === 'linkedin' && shouldUseLinkedInStatsFallback({
      overview: monthOverview,
      statsConnected: Boolean(monthOverview?.sources?.linkedin?.connected || weekOverview?.sources?.linkedin?.connected),
      currentOpportunity: opportunities.byCube?.linkedin,
      currentWeekLeads: history7?.perTool?.linkedin,
      currentMonthLeads: history30?.perTool?.linkedin,
      fallback: linkedInFallback,
    }) && linkedInFallback?.block) {
      generatorBlocks.linkedin = {
        ...generatorBlocks.linkedin,
        leads: { ...linkedInFallback.block.leads },
        opportunities: { month: Math.max(0, Math.round(Number(linkedInFallback.block.opportunities.month || 0))) },
        estimatedValue: Math.max(0, Math.round(Number(linkedInFallback.block.estimatedValue || 0))),
        syncAt,
        snapshotDate: resolvedSnapshotDate,
        live,
        error: null,
      };
    }

    const block = generatorBlocks[channel];
    const generatorTotals = summarizeGeneratorChannelBlocks({
      blocks: generatorBlocks,
      monthDays: 30,
      weekDays: 7,
      todayDays: 2,
    });
    const payload: ChannelGeneratorRefreshResponse = {
      channel,
      syncAt,
      generator: {
        block,
        leads: generatorTotals.leads,
        estimatedValue: generatorTotals.estimatedValue,
        generatorBlocks,
        details: {
          opportunities: generatorTotals.opportunities,
          profile,
        },
        meta: {
          source: 'api/metrics/channel-refresh',
          generatedAt,
          snapshotDate: resolvedSnapshotDate,
          live,
        },
      },
    };

    return NextResponse.json(withoutThreadsData(payload, metaPilotEnabled), {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
  } catch (error) {
    return jsonUserFacingError(error, { status: 500 });
  }
}
