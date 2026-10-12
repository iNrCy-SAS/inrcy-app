import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { requireUser } from "@/lib/requireUser";
import { NextResponse } from 'next/server';
import { jsonUserFacingError } from '@/lib/apiUserFacingErrors';
import { computeOpportunitiesFromOverviews, fetchCubeOverviews } from '@/lib/metrics/computeMetrics';

export async function GET(request: Request) {
  try {
    const { supabase, activeUserId, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;
    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
    const { searchParams, origin } = new URL(request.url);
    const days = Math.max(7, Math.min(90, Number(searchParams.get('days') || '30')));
    const cookie = request.headers.get('cookie') || '';

    const overviews = await fetchCubeOverviews({
      supabase, userId: activeUserId, metaPilotEnabled,
      origin,
      days,
      getHeaders: () => (cookie ? { cookie } : undefined),
    });

    return NextResponse.json(withoutThreadsData(computeOpportunitiesFromOverviews(overviews, days), metaPilotEnabled));
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
