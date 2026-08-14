import { NextResponse } from "next/server";
import { withApi } from "@/lib/observability/withApi";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getDefaultSnapshotDate } from "@/lib/stats/snapshotWindow";
import { buildMetricsSummary } from "@/lib/metrics/summary";
import { buildStatsConnectionSignature } from "@/lib/stats/connectionSignature";
import { applyLinkedInFallbackToStatsRecords, readLastGoodLinkedInGeneratorBlock, type LinkedInStatsFallback } from "@/lib/linkedinStatsFallback";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { buildChannelBlocks, type InrstatsChannelBlocksByChannel } from "@/lib/inrstats/channelBlocks";
import {
  EMPTY_CUBE_RECORD,
  fetchCubeOverviews,
  computeHistoryFromOverviews,
  computeOpportunitiesFromOverviews,
  toInrstatsSnapshot,
  type CubeKey,
  type Overview,
} from "@/lib/metrics/computeMetrics";

const DAILY_REFRESH_LEASE_SECONDS = 15 * 60;

type ProfileMetrics = {
  lead_conversion_rate: number;
  avg_basket: number;
};

type BulkResponse = {
  period: number;
  overviews: Partial<Record<CubeKey, Overview>>;
  opportunities: ReturnType<typeof toInrstatsSnapshot>;
  profile: ProfileMetrics;
  estimatedByCube: Record<CubeKey, number>;
  capturedLeadsByCube: {
    week: Record<CubeKey, number>;
    month: Record<CubeKey, number>;
  };
  blocks: InrstatsChannelBlocksByChannel;
  meta: {
    source: "api/stats/daily-refresh";
    generatedAt: string;
    snapshotDate: string | null;
    live: boolean;
    connectionSignature?: string;
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

function buildBulkPayloadFromOverviews(args: {
  period: number;
  overviews: Partial<Record<CubeKey, Overview>>;
  profile: ProfileMetrics;
  snapshotDate: string;
  channelStates: Awaited<ReturnType<typeof getChannelConnectionStates>>;
  capturedLeadsByCube: {
    week: Record<CubeKey, number>;
    month: Record<CubeKey, number>;
  };
  connectionSignature?: string;
  linkedInFallback?: LinkedInStatsFallback | null;
}): BulkResponse {
  const { period, overviews, profile, snapshotDate, channelStates, capturedLeadsByCube, connectionSignature, linkedInFallback } = args;
  const opportunities = toInrstatsSnapshot(computeOpportunitiesFromOverviews(overviews, period));
  const scopedCapturedLeadsByCube = {
    week: { ...capturedLeadsByCube.week },
    month: { ...capturedLeadsByCube.month },
  };
  const leadConversionRate = Number(profile?.lead_conversion_rate ?? 0);
  const avgBasket = Number(profile?.avg_basket ?? 0);
  const estimatedByCube: Record<CubeKey, number> = { ...EMPTY_CUBE_RECORD };
  for (const cube of Object.keys(estimatedByCube) as CubeKey[]) {
    estimatedByCube[cube] = Math.round((opportunities.byCube[cube] || 0) * (leadConversionRate / 100) * avgBasket);
  }

  const linkedInPreserved = applyLinkedInFallbackToStatsRecords({
    overviews,
    opportunities,
    capturedLeadsByCube: scopedCapturedLeadsByCube,
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
    capturedLeadsByCube: scopedCapturedLeadsByCube,
    estimatedByCube,
    channelStates,
    preservedChannels: linkedInPreserved ? { linkedin: true } : undefined,
  });

  return {
    period,
    overviews,
    opportunities,
    profile,
    estimatedByCube,
    capturedLeadsByCube: scopedCapturedLeadsByCube,
    blocks,
    meta: {
      source: "api/stats/daily-refresh",
      generatedAt: new Date().toISOString(),
      snapshotDate: Object.values(overviews).find((overview) => overview?.meta)?.meta?.snapshotDate ?? snapshotDate ?? null,
      live: Boolean(Object.values(overviews).find((overview) => overview?.meta)?.meta?.live ?? false),
      connectionSignature,
    },
  };
}

async function bumpStatsVersion(userId: string) {
  try {
    await supabaseAdmin.rpc("bump_profile_version", {
      p_user_id: userId,
      p_column: "stats_version",
    });
  } catch {
    // Best effort only: stats are already refreshed even if realtime broadcast fails.
  }
}

function isLeaseActive(startedAt: string | null | undefined) {
  if (!startedAt) return false;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return false;
  return Date.now() - startedMs < DAILY_REFRESH_LEASE_SECONDS * 1000;
}

function devLogDailyRefresh(payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log("[daily-refresh][dev]", payload);
}

const nowMs = () => (typeof performance !== "undefined" && typeof performance.now === "function"
  ? performance.now()
  : Date.now());

async function handler(req: Request) {
  const totalStarted = nowMs();

  try {
    const { supabase, user, errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const body = await req.json().catch(() => ({} as { announce?: unknown; force?: unknown }));
    const announce = body?.announce === true;
    const force = body?.force === true;

    const snapshotDate = getDefaultSnapshotDate();
    const claimResult = force
      ? { data: true, error: null as { message?: string } | null }
      : await supabase.rpc("claim_daily_stats_refresh", {
          p_user_id: activeUserId,
          p_snapshot_date: snapshotDate,
          p_lease_seconds: DAILY_REFRESH_LEASE_SECONDS,
        });
    const claimed = !!claimResult.data;
    const claimError = claimResult.error;

    if (claimError) {
      return jsonUserFacingError(`daily_refresh_claim_failed:${claimError.message}`, { status: 500 });
    }

    if (!claimed) {
      const { data: state } = await supabase
        .from("user_daily_stats_refresh")
        .select("last_started_snapshot_date, last_started_at, last_completed_snapshot_date")
        .eq("user_id", activeUserId)
        .maybeSingle();

      const inProgress =
        state?.last_completed_snapshot_date !== snapshotDate &&
        state?.last_started_snapshot_date === snapshotDate &&
        isLeaseActive(state?.last_started_at);

      devLogDailyRefresh({
        userId: activeUserId,
        action: "run",
        ran: false,
        inProgress,
        snapshotDate,
        timings: {
          total: Math.round(nowMs() - totalStarted),
        },
      });

      const syncAt = Date.now();
      if (announce) {
        await bumpStatsVersion(activeUserId);
      }

      return NextResponse.json({
        ok: true,
        ran: false,
        inProgress,
        snapshotDate,
        syncAt,
      });
    }

    const { origin } = new URL(req.url);
    const cookie = req.headers.get("cookie") || "";
    const syncAt = Date.now();
    const debug = {
      ok: false,
      errors: {},
      env: {
        has_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      },
    };

    try {
      const headers = () => (cookie ? { cookie } : undefined);
      const profileStarted = nowMs();
      const profilePromise = fetchProfileMetrics(supabase, activeUserId);
      const monthStarted = nowMs();
      const monthPromise = fetchCubeOverviews({
        origin,
        days: 30,
        getHeaders: headers,
        bypassCache: force,
        supabase,
        userId: activeUserId,
        snapshotDate,
      });
      const weekStarted = nowMs();
      const weekPromise = fetchCubeOverviews({
        origin,
        days: 7,
        getHeaders: headers,
        bypassCache: force,
        supabase,
        userId: activeUserId,
        snapshotDate,
      });

      const [profile, monthOverviews, weekOverviews, connectionSignature] = await Promise.all([
        profilePromise,
        monthPromise,
        weekPromise,
        buildStatsConnectionSignature(supabase, activeUserId),
      ]);
      const channelStates = await getChannelConnectionStates(supabase, activeUserId);
      const linkedInFallback = await readLastGoodLinkedInGeneratorBlock({
        supabase,
        userId: activeUserId,
        connectionSignature,
      });

      const generatorStarted = nowMs();
      const generator = await buildMetricsSummary({
        supabase,
        userId: activeUserId,
        origin,
        getHeaders: headers,
        monthDays: 30,
        weekDays: 7,
        todayDays: 2,
        debug,
        fresh: force,
        snapshotDate,
        profileOverride: profile,
        monthOverviewsOverride: monthOverviews,
        weekOverviewsOverride: weekOverviews,
      });

      const generatorDuration = Math.round(nowMs() - generatorStarted);
      const profileDuration = Math.round(nowMs() - profileStarted);
      const monthDuration = Math.round(nowMs() - monthStarted);
      const weekDuration = Math.round(nowMs() - weekStarted);

      const capturedLeadsByCube = {
        week: { ...EMPTY_CUBE_RECORD, ...(computeHistoryFromOverviews(weekOverviews, 7).perTool || {}) },
        month: { ...EMPTY_CUBE_RECORD, ...(computeHistoryFromOverviews(monthOverviews, 30).perTool || {}) },
      };

      const inrstatsEntries = [
        ["7", buildBulkPayloadFromOverviews({ period: 7, overviews: weekOverviews, profile, snapshotDate, channelStates, capturedLeadsByCube, connectionSignature, linkedInFallback })],
        ["30", buildBulkPayloadFromOverviews({ period: 30, overviews: monthOverviews, profile, snapshotDate, channelStates, capturedLeadsByCube, connectionSignature, linkedInFallback })],
      ] as const;

      const { error: completeError } = await supabase.rpc("complete_daily_stats_refresh", {
        p_user_id: activeUserId,
        p_snapshot_date: snapshotDate,
      });

      if (completeError) {
        return jsonUserFacingError(`daily_refresh_complete_failed:${completeError.message}`, { status: 500 });
      }

      await bumpStatsVersion(activeUserId);

      devLogDailyRefresh({
        userId: activeUserId,
        action: "run",
        ran: true,
        snapshotDate,
        timings: {
          profile: profileDuration,
          weekOverviews: weekDuration,
          monthOverviews: monthDuration,
          generator: generatorDuration,
          total: Math.round(nowMs() - totalStarted),
        },
      });

      return NextResponse.json({
        ok: true,
        ran: true,
        inProgress: false,
        snapshotDate,
        syncAt,
        generator,
        inrstats: Object.fromEntries(inrstatsEntries),
      }, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    } catch (error) {
      if (!force) {
        try {
          await supabase.rpc("release_daily_stats_refresh_claim", {
            p_user_id: activeUserId,
            p_snapshot_date: snapshotDate,
          });
        } catch {
          // Best-effort cleanup: the original refresh error remains the one returned.
        }
      }
      throw error;
    }
  } catch (error) {
    devLogDailyRefresh({
      action: "run",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      timings: {
        total: Math.round(nowMs() - totalStarted),
      },
    });
    return jsonUserFacingError(error, { status: 500 });
  }
}

export const POST = withApi(handler, { route: "/api/stats/daily-refresh" });
