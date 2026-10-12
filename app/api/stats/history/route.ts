import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { requireUser } from "@/lib/requireUser";
import { NextResponse } from 'next/server';
import { jsonUserFacingError } from '@/lib/apiUserFacingErrors';
import { computeHistoryFromOverviews, fetchCubeOverviews } from '@/lib/metrics/computeMetrics';

export async function GET(request: Request) {
  try {
    const { supabase, activeUserId, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;
    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
    const { searchParams, origin } = new URL(request.url);
    const raw = Number(searchParams.get('days') || '30');
    const days = raw === 7 || raw === 30 || raw === 60 || raw === 90 ? raw : 30;
    const cookie = request.headers.get('cookie') || '';

    const overviews = await fetchCubeOverviews({
      supabase, userId: activeUserId, metaPilotEnabled,
      origin,
      days,
      getHeaders: () => (cookie ? { cookie } : undefined),
    });

    return NextResponse.json(withoutThreadsData(computeHistoryFromOverviews(overviews, days), metaPilotEnabled));
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 500 });
  }
}
