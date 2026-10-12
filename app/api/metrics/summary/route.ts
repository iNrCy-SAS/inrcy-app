import { isMetaChannelPilotEnabledForActorAndAccount, isMetaChannelPilotEnabledForAccount, metaChannelPilotDeniedResponse } from "@/lib/metaChannelRolloutServer";
import { withoutThreadsData } from "@/lib/stats/metaPilotData";
import { NextResponse } from 'next/server';
import { createSupabaseServer } from '@/lib/supabaseServer';
import { resolveActiveInrcyAccountId } from '@/lib/multicompte/server';
import { buildMetricsSummary } from '@/lib/metrics/summary';
import { captureApiException } from '@/lib/observability/sentry';
import { withApi } from '@/lib/observability/withApi';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

type AnyRec = Record<string, unknown>;

async function metricsSummaryHandler(req: Request) {
  const debug: AnyRec = {
    ok: false,
    errors: {},
    env: {
      has_SUPABASE_URL: !!SUPABASE_URL,
    },
  };

  try {
    if (!SUPABASE_URL) {
      return NextResponse.json(
        {
          error: 'Configuration serveur incomplète.',
          debug,
        },
        { status: 500 }
      );
    }

    const supabase = await createSupabaseServer();
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr && typeof authErr.message === 'string') {
      (debug.errors as Record<string, string>).auth = authErr.message;
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Non authentifié.', debug: process.env.NODE_ENV === 'development' ? debug : undefined },
        { status: 401 }
      );
    }

    const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

    const { searchParams, origin } = new URL(req.url);
    const monthDays = Math.max(1, Number(searchParams.get('monthDays') || 30));
    const weekDays = Math.max(1, Number(searchParams.get('weekDays') || 7));
    const todayDays = Math.max(1, Number(searchParams.get('todayDays') || 2));
    const cookie = req.headers.get('cookie') || '';
    const fresh = searchParams.get('fresh') === '1';
    const snapshotDate = (searchParams.get('snapshotDate') || '').trim() || null;

    const metaPilotEnabled = await isMetaChannelPilotEnabledForActorAndAccount(supabase, activeUserId);
    const summary = await buildMetricsSummary({
      metaPilotEnabled,
      supabase,
      userId: activeUserId,
      origin,
      getHeaders: () => (cookie ? { cookie } : undefined),
      monthDays,
      weekDays,
      todayDays,
      debug,
      fresh,
      snapshotDate,
    });

    debug.ok = true;

    const includeDebug = process.env.NODE_ENV === 'development' || req.headers.get('x-inrcy-debug') === '1';

    return NextResponse.json({
      ...summary,
      ...(includeDebug ? { debug } : {}),
    });
  } catch (e: unknown) {
    captureApiException(req, e, { area: 'inrstats', operation: 'GET /api/metrics/summary', statusCode: 500 });
    (debug.errors as Record<string, string>).unhandled = e instanceof Error ? e.message : String(e);
    const includeDebug = process.env.NODE_ENV === 'development' || req.headers.get('x-inrcy-debug') === '1';
    return NextResponse.json(
      { error: (debug.errors as Record<string, string>).unhandled, ...(includeDebug ? { debug } : {}) },
      { status: 500 }
    );
  }
}

export const GET = withApi(metricsSummaryHandler, { route: "/api/metrics/summary" });
