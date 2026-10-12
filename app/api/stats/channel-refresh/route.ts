import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { captureApiException } from "@/lib/observability/sentry";
import { withApi } from "@/lib/observability/withApi";
import { DASHBOARD_CHANNEL_KEYS, isDashboardChannelKey, type DashboardChannelKey } from "@/lib/dashboardChannels";
import { requireUser } from "@/lib/requireUser";
import { getDefaultSnapshotDate } from "@/lib/stats/snapshotWindow";
import { buildStatsConnectionSignature } from "@/lib/stats/connectionSignature";
import { applyLinkedInFallbackToStatsRecords, readLastGoodLinkedInGeneratorBlock, type LinkedInStatsFallback } from "@/lib/linkedinStatsFallback";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { buildChannelBlocks, type InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import {
  EMPTY_CUBE_RECORD,
  INCLUDE_BY_CUBE,
  computeHistoryFromOverviews,
  computeOpportunitiesFromOverviews,
  toInrstatsSnapshot,
  type CubeKey,
  type Overview,
} from "@/lib/metrics/computeMetrics";
import { buildStatsOverview } from "@/lib/stats/buildOverview";

type ProfileMetrics = {
  lead_conversion_rate: number;
  avg_basket: number;
};

type ChannelRefreshPeriodPayload = {
  block: InrstatsChannelBlock;
  overview: Overview | null;
  syncedAt: number;
  snapshotDate: string | null;
};

type ChannelRefreshResponse = {
  channel: DashboardChannelKey;
  syncAt: number;
  periods: Record<"7" | "30", ChannelRefreshPeriodPayload>;
  meta: {
    source: "api/stats/channel-refresh";
    generatedAt: string;
    snapshotDate: string | null;
  };
};

async function fetchProfileMetrics(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  userId: string,
): Promise<ProfileMetrics> {
  const { data: profileRow } = await supabase
    .from("profiles")
    .select("lead_conversion_rate, avg_basket")
    .eq("user_id", userId)
    .maybeSingle();

  const leadConversionRate = Number(profileRow?.lead_conversion_rate ?? 0);
  const avgBasket = Number(profileRow?.avg_basket ?? 0);

  return {
    lead_conversion_rate: Number.isFinite(leadConversionRate) ? leadConversionRate : 0,
    avg_basket: Number.isFinite(avgBasket) ? avgBasket : 0,
  };
}

async function buildChannelPeriodPayload(args: {
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"];
  userId: string;
  channel: DashboardChannelKey;
  period: 7 | 30;
  snapshotDate: string;
  metaPilotEnabled?: boolean;
  channelStates: Awaited<ReturnType<typeof getChannelConnectionStates>>;
  profile: ProfileMetrics;
  linkedInFallback?: LinkedInStatsFallback | null;
}): Promise<ChannelRefreshPeriodPayload> {
  const { supabase, userId, channel, period, snapshotDate, channelStates, profile, linkedInFallback, metaPilotEnabled } = args;
  const overview = await buildStatsOverview({
    supabase,
    userId,
    days: period,
    includeRaw: INCLUDE_BY_CUBE[channel],
    fresh: true,
    metaPilotEnabled: args.metaPilotEnabled,
    snapshotDate,
  }) as Overview;

  const overviews: Partial<Record<CubeKey, Overview>> = { [channel]: overview };
  const opportunities = toInrstatsSnapshot(computeOpportunitiesFromOverviews(overviews, period));
  const capturedForPeriod = computeHistoryFromOverviews(overviews, period).perTool || {};
  const capturedLeadsByCube = {
    week: { ...EMPTY_CUBE_RECORD, ...(period === 7 ? capturedForPeriod : {}) },
    month: { ...EMPTY_CUBE_RECORD, ...(period === 30 ? capturedForPeriod : {}) },
  };
  const estimatedByCube: Record<CubeKey, number> = {
    ...EMPTY_CUBE_RECORD,
    [channel]: Math.round((opportunities.byCube[channel] || 0) * (profile.lead_conversion_rate / 100) * profile.avg_basket),
  };

  const linkedInPreserved = channel === "linkedin"
    ? applyLinkedInFallbackToStatsRecords({
        overviews,
        opportunities,
        capturedLeadsByCube,
        estimatedByCube,
        statsConnected: Boolean(channelStates.linkedin.connected && !channelStates.linkedin.requiresUpdate),
        fallback: linkedInFallback,
        leadConversionRate: profile.lead_conversion_rate,
        avgBasket: profile.avg_basket,
      })
    : false;

  const block = buildChannelBlocks({
    periodDays: period,
    overviews,
    opportunitiesByCube: opportunities.byCube,
    capturedLeadsByCube,
    estimatedByCube,
    channelStates,
    preservedChannels: linkedInPreserved ? { linkedin: true } : undefined,
  })[channel];

  return {
    block,
    overview,
    syncedAt: block.syncAt ?? Date.now(),
    snapshotDate: block.snapshotDate ?? overview?.meta?.snapshotDate ?? snapshotDate ?? null,
  };
}

async function channelStatsRefreshHandler(req: Request) {
  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({} as { channel?: unknown }));
    const channel = body?.channel;

    if (!isDashboardChannelKey(channel)) {
      return NextResponse.json({
        error: `Canal invalide. Valeurs acceptées : ${DASHBOARD_CHANNEL_KEYS.join(", ")}.`,
      }, { status: 400 });
    }

    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
    if (channel === "threads" && !metaPilotEnabled) return metaChannelPilotDeniedResponse();
    const snapshotDate = getDefaultSnapshotDate();
    const [profile, channelStates, connectionSignature] = await Promise.all([
      fetchProfileMetrics(supabase, activeUserId),
      getChannelConnectionStates(supabase, activeUserId, undefined, { metaPilotEnabled }),
      buildStatsConnectionSignature(supabase, activeUserId),
    ]);
    const linkedInFallback = channel === "linkedin"
      ? await readLastGoodLinkedInGeneratorBlock({
          supabase,
          userId: activeUserId,
          connectionSignature,
        })
      : null;

    const [rawPeriod7, rawPeriod30] = await Promise.all([
      buildChannelPeriodPayload({ supabase, userId: activeUserId, channel, period: 7, snapshotDate, channelStates, profile, linkedInFallback, metaPilotEnabled }),
      buildChannelPeriodPayload({ supabase, userId: activeUserId, channel, period: 30, snapshotDate, channelStates, profile, linkedInFallback, metaPilotEnabled }),
    ]);

    const capturedLeads = {
      week: Math.max(0, Math.round(Number(rawPeriod7.block.capturedLeads?.week ?? 0))),
      month: Math.max(0, Math.round(Number(rawPeriod30.block.capturedLeads?.month ?? 0))),
    };
    const period7: ChannelRefreshPeriodPayload = {
      ...rawPeriod7,
      block: {
        ...rawPeriod7.block,
        capturedLeads: rawPeriod7.block.connection.statsConnected ? capturedLeads : { week: 0, month: 0 },
      },
    };
    const period30: ChannelRefreshPeriodPayload = {
      ...rawPeriod30,
      block: {
        ...rawPeriod30.block,
        capturedLeads: rawPeriod30.block.connection.statsConnected ? capturedLeads : { week: 0, month: 0 },
      },
    };

    const syncAt = Date.now();
    const payload: ChannelRefreshResponse = {
      channel,
      syncAt,
      periods: {
        "7": { ...period7, syncedAt: syncAt },
        "30": { ...period30, syncedAt: syncAt },
      },
      meta: {
        source: "api/stats/channel-refresh",
        generatedAt: new Date(syncAt).toISOString(),
        snapshotDate,
      },
    };

    return NextResponse.json(withoutThreadsData(payload, metaPilotEnabled), {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    captureApiException(req, error, { area: "inrstats", operation: "POST /api/stats/channel-refresh", statusCode: 500 });
    return jsonUserFacingError(error, { status: 500 });
  }
}

export const POST = withApi(channelStatsRefreshHandler, { route: "/api/stats/channel-refresh" });
