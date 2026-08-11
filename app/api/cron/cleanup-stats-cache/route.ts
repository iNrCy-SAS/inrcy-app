import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  OVERVIEW_CACHE_SOURCE,
  OVERVIEW_HISTORY_RETENTION_MS,
} from "@/lib/stats/overviewPreservation";

export const runtime = "nodejs";

function isAuthorizedCron(req: Request) {
  const cronSecret = process.env.VERCEL_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!cronSecret) return false;

  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  const querySecret = new URL(req.url).searchParams.get("secret") || "";

  return bearer === cronSecret || headerSecret === cronSecret || querySecret === cronSecret;
}

export async function GET(req: Request) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const overviewRetentionCutoff = new Date(now - OVERVIEW_HISTORY_RETENTION_MS).toISOString();

  // Normal caches may be removed as soon as they expire. Overview rows are
  // deliberately retained for a short history because iNrStats uses them as
  // the fallback when Google/Meta/etc. temporarily return no usable metrics.
  const { error: regularCacheError } = await supabase
    .from("stats_cache")
    .delete()
    .neq("source", OVERVIEW_CACHE_SOURCE)
    .lt("expires_at", nowIso);

  const { error: overviewHistoryError } = await supabase
    .from("stats_cache")
    .delete()
    .eq("source", OVERVIEW_CACHE_SOURCE)
    .lt("expires_at", overviewRetentionCutoff);

  if (regularCacheError || overviewHistoryError) {
    console.error("Cleanup stats_cache error:", regularCacheError || overviewHistoryError);
    return NextResponse.json({ ok: false });
  }

  return NextResponse.json({ ok: true });
}

export async function POST(req: Request) {
  return GET(req);
}
