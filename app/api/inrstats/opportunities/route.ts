import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { requireUser } from "@/lib/requireUser";
import { NextResponse } from 'next/server';
import { jsonUserFacingError } from '@/lib/apiUserFacingErrors';
import { computeOpportunitiesFromOverviews, fetchCubeOverviews, invalidateOverviewCache, toInrstatsSnapshot } from '@/lib/metrics/computeMetrics';
import { captureApiException } from '@/lib/observability/sentry';
import { withApi } from '@/lib/observability/withApi';

async function inrStatsOpportunitiesHandler(request: Request) {
  try {
    const { supabase, activeUserId, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;
    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
    const url = new URL(request.url);
    const qMode = (url.searchParams.get('mode') || '').toLowerCase();
    const qToday = Number(url.searchParams.get('todayDays') || '0') || 0;
    const qWeek = Number(url.searchParams.get('weekDays') || '0') || 0;
    const qMonth = Number(url.searchParams.get('monthDays') || url.searchParams.get('days') || '0') || 0;

    const todayDays = qToday > 0 ? qToday : qMode === 'generator' ? 2 : 3;
    const weekDays = qWeek > 0 ? qWeek : 7;
    const monthDays = qMonth > 0 ? qMonth : qMode === 'generator' ? 28 : 30;
    const cookie = request.headers.get('cookie') || '';
    const fresh = url.searchParams.get('fresh') === '1';

    if (fresh) invalidateOverviewCache();

    const monthOverviews = await fetchCubeOverviews({
      supabase, userId: activeUserId, metaPilotEnabled,
      origin: url.origin,
      days: monthDays,
      getHeaders: () => (cookie ? { cookie } : undefined),
      bypassCache: fresh,
    });

    const monthOpps = computeOpportunitiesFromOverviews(monthOverviews, monthDays);
    const result = toInrstatsSnapshot(monthOpps);

    // Respect explicit windows while keeping the same unique formula source.
    const perDay = monthOpps.total / Math.max(1, monthDays);
    result.today = Math.max(0, Math.round(perDay * todayDays));
    result.week = Math.max(0, Math.round(perDay * weekDays));
    result.month = monthOpps.total;
    result.total = monthOpps.total;

    return NextResponse.json(withoutThreadsData(result, metaPilotEnabled));
  } catch (e: unknown) {
    captureApiException(request, e, {
      area: 'inrstats',
      operation: 'GET /api/inrstats/opportunities',
      statusCode: 500,
    });
    return jsonUserFacingError(e, {
      status: 500,
      fallback: "Impossible de charger les opportunités pour le moment.",
    });
  }
}

export const GET = withApi(inrStatsOpportunitiesHandler, { route: "/api/inrstats/opportunities" });
