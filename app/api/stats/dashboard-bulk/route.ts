import { NextResponse } from 'next/server';
import { jsonUserFacingError } from '@/lib/apiUserFacingErrors';
import { captureApiException } from '@/lib/observability/sentry';
import { withApi } from '@/lib/observability/withApi';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { resolveActiveInrcyAccountId } from '@/lib/multicompte/server';
import { isAuthorizedCronRequest, getCronUserIdFromRequest } from '@/lib/cronAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getChannelConnectionStates } from '@/lib/channelConnectionState';
import { buildStatsConnectionSignature } from '@/lib/stats/connectionSignature';
import { applyLinkedInFallbackToStatsRecords, readLastGoodLinkedInGeneratorBlock } from '@/lib/linkedinStatsFallback';
import { buildChannelBlocks, type InrstatsChannelBlocksByChannel } from '@/lib/inrstats/channelBlocks';
import { DASHBOARD_CHANNEL_KEYS } from '@/lib/dashboardChannels';
import {
  EMPTY_CUBE_RECORD,
  fetchCubeOverviews,
  computeHistoryFromOverviews,
  computeOpportunitiesFromOverviews,
  toInrstatsSnapshot,
  type CubeKey,
  type Overview,
} from '@/lib/metrics/computeMetrics';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

type BulkResponse = {
  period: number;
  overviews: Partial<Record<CubeKey, Overview>>;
  opportunities: ReturnType<typeof toInrstatsSnapshot>;
  profile: {
    lead_conversion_rate: number;
    avg_basket: number;
  };
  estimatedByCube: Record<CubeKey, number>;
  capturedLeadsByCube: {
    week: Record<CubeKey, number>;
    month: Record<CubeKey, number>;
  };
  blocks: InrstatsChannelBlocksByChannel;
  meta: {
    source: 'api/stats/dashboard-bulk';
    generatedAt: string;
    snapshotDate: string | null;
    live: boolean;
  };
};

async function dashboardStatsBulkHandler(req: Request) {
  try {
    if (!SUPABASE_URL) {
      return NextResponse.json({ error: 'Configuration serveur incomplète.' }, { status: 500 });
    }

    const cronUserId = isAuthorizedCronRequest(req) ? getCronUserIdFromRequest(req) : '';
    const supabase = cronUserId ? supabaseAdmin : await createSupabaseServer();
    let userId = cronUserId;

    if (!userId) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
      }
      userId = await resolveActiveInrcyAccountId(supabase, user.id);
    }

    const { searchParams, origin } = new URL(req.url);
    const period = Math.max(1, Number(searchParams.get('days') || 30));
    const fresh = searchParams.get('fresh') === '1';
    const snapshotDate = (searchParams.get('snapshotDate') || '').trim() || null;
    const cookie = req.headers.get('cookie') || '';

    const overviews = await fetchCubeOverviews({
      origin,
      days: period,
      getHeaders: () => (cookie ? { cookie } : undefined),
      bypassCache: fresh,
      supabase,
      userId,
      snapshotDate,
    });

    const opportunities = toInrstatsSnapshot(computeOpportunitiesFromOverviews(overviews, period));

    const [capturedWeekOverviews, capturedMonthOverviews] = await Promise.all([
      period === 7
        ? Promise.resolve(overviews)
        : fetchCubeOverviews({
            origin,
            days: 7,
            getHeaders: () => (cookie ? { cookie } : undefined),
            bypassCache: fresh,
            supabase,
            userId,
            snapshotDate,
          }),
      period === 30
        ? Promise.resolve(overviews)
        : fetchCubeOverviews({
            origin,
            days: 30,
            getHeaders: () => (cookie ? { cookie } : undefined),
            bypassCache: fresh,
            supabase,
            userId,
            snapshotDate,
          }),
    ]);

    const capturedLeadsByCube = {
      week: { ...EMPTY_CUBE_RECORD, ...(computeHistoryFromOverviews(capturedWeekOverviews, 7).perTool || {}) },
      month: { ...EMPTY_CUBE_RECORD, ...(computeHistoryFromOverviews(capturedMonthOverviews, 30).perTool || {}) },
    };

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('lead_conversion_rate, avg_basket')
      .eq('user_id', userId)
      .maybeSingle();

    const [channelStates, connectionSignature] = await Promise.all([
      getChannelConnectionStates(supabase, userId),
      buildStatsConnectionSignature(supabase, userId),
    ]);

    const leadConversionRate = Number(profileRow?.lead_conversion_rate ?? 0);
    const avgBasket = Number(profileRow?.avg_basket ?? 0);
    const estimatedByCube: Record<CubeKey, number> = { ...EMPTY_CUBE_RECORD };
    for (const cube of Object.keys(estimatedByCube) as CubeKey[]) {
      estimatedByCube[cube] = Math.round((opportunities.byCube[cube] || 0) * (leadConversionRate / 100) * avgBasket);
    }

    const linkedInFallback = await readLastGoodLinkedInGeneratorBlock({
      supabase,
      userId,
      connectionSignature,
    });
    const linkedInPreserved = applyLinkedInFallbackToStatsRecords({
      overviews,
      opportunities,
      capturedLeadsByCube,
      estimatedByCube,
      statsConnected: Boolean(channelStates.linkedin.connected && !channelStates.linkedin.requiresUpdate),
      fallback: linkedInFallback,
      leadConversionRate,
      avgBasket,
    });

    const blocks = buildChannelBlocks({
      periodDays: period,
      overviews,
      opportunitiesByCube: opportunities.byCube,
      capturedLeadsByCube,
      estimatedByCube,
      channelStates,
      preservedChannels: linkedInPreserved ? { linkedin: true } : undefined,
    });

    // The official channel state wins over every cached/provider value. An
    // expired, disconnected or otherwise unavailable channel must expose zero
    // opportunities and zero estimated value everywhere in iNrStats.
    for (const channel of DASHBOARD_CHANNEL_KEYS) {
      opportunities.byCube[channel] = blocks[channel].opportunities;
      estimatedByCube[channel] = blocks[channel].estimatedValue;
      capturedLeadsByCube.week[channel] = blocks[channel].capturedLeads.week;
      capturedLeadsByCube.month[channel] = blocks[channel].capturedLeads.month;
    }
    opportunities.total = Math.max(
      0,
      Math.round(
        Object.values(opportunities.byCube).reduce(
          (sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0),
          0,
        ),
      ),
    );

    const overviewList = Object.values(overviews) as Array<{ meta?: { snapshotDate?: string | null; live?: boolean | null } }>;
    const overviewWithMeta = overviewList.find((overview) => overview?.meta);

    const payload: BulkResponse = {
      period,
      overviews,
      opportunities,
      profile: {
        lead_conversion_rate: Number.isFinite(leadConversionRate) ? leadConversionRate : 0,
        avg_basket: Number.isFinite(avgBasket) ? avgBasket : 0,
      },
      estimatedByCube,
      capturedLeadsByCube,
      blocks,
      meta: {
        source: 'api/stats/dashboard-bulk',
        generatedAt: new Date().toISOString(),
        snapshotDate: overviewWithMeta?.meta?.snapshotDate ?? snapshotDate ?? null,
        live: Boolean(overviewWithMeta?.meta?.live ?? fresh),
      },
    };

    return NextResponse.json(payload, {
      headers: fresh
        ? {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          }
        : undefined,
    });
  } catch (e) {
    captureApiException(req, e, { area: 'inrstats', operation: 'GET /api/stats/dashboard-bulk', statusCode: 500 });
    return jsonUserFacingError(e, { status: 500 });
  }
}

export const GET = withApi(dashboardStatsBulkHandler, { route: "/api/stats/dashboard-bulk" });
