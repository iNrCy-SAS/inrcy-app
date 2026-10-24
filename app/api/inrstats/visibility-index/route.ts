import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { VISIBILITY_INDEX_CHANNELS, VISIBILITY_INDEX_MODEL, type VisibilityIndexInputs } from "@/lib/inrstats/visibilityIndexModel";
import { recordedVisibilitySnapshots, shiftVisibilityMonths, visibilityDay, visibilityIndexPeriods, type VisibilityIndexSnapshot } from "@/lib/inrstats/visibilityIndexSnapshots";
import { readVisibilityRewards, reconcileVisibilityRewards } from "@/lib/inrstats/visibilityIndexRewards";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request) {
  const { activeUserId, errorResponse } = await requireUser();
  if (errorResponse) return errorResponse;
  const channel = new URL(req.url).searchParams.get("channel") || "all";
  if (channel !== "all" && !VISIBILITY_INDEX_CHANNELS.includes(channel as typeof VISIBILITY_INDEX_CHANNELS[number])) return NextResponse.json({ error: "invalid_channel" }, { status: 400, headers });
  try {
    const { data: account, error: accountError } = await supabaseAdmin.from("inrcy_accounts").select("created_at").eq("id", activeUserId).maybeSingle();
    const createdAt = accountError ? null : account?.created_at;
    if (!createdAt || !Number.isFinite(Date.parse(createdAt))) throw new Error("visibility_account_date_unavailable");
    const registration = await supabaseAdmin.from("inrstats_visibility_tracking").upsert({ user_id: activeUserId }, { onConflict: "user_id", ignoreDuplicates: true });
    if (registration.error) throw new Error("visibility_tracking_unavailable");
    const now = new Date();
    const end = visibilityDay(now);
    const result = await supabaseAdmin.from("inrstats_visibility_snapshots")
      .select("observed_on,score,inputs")
      .eq("user_id", activeUserId).eq("channel_key", channel).eq("model_version", VISIBILITY_INDEX_MODEL.version)
      .gte("observed_on", shiftVisibilityMonths(end, -12)).lte("observed_on", end)
      .order("observed_on", { ascending: true }).limit(367);
    if (result.error) throw new Error("visibility_history_unavailable");
    const records = recordedVisibilitySnapshots((result.data || []).map(row => ({ date: row.observed_on, value: Number(row.score), inputs: row.inputs as VisibilityIndexInputs })) as VisibilityIndexSnapshot[], createdAt, now.toISOString());
    // Repairs an interrupted reward attempt; SQL checks real history and deduplicates atomically.
    let rewards = null;
    try { rewards = await readVisibilityRewards(activeUserId, await reconcileVisibilityRewards(activeUserId)); }
    catch { console.warn("[inrstats-visibility] Rewards temporarily unavailable"); }
    return NextResponse.json({ scope: activeUserId, channel, createdAt, asOf: now.toISOString(), modelVersion: VISIBILITY_INDEX_MODEL.version, records, periods: visibilityIndexPeriods(records, createdAt, now.toISOString()), rewards }, { headers });
  } catch {
    console.warn("[inrstats-visibility] History temporarily unavailable");
    return NextResponse.json({ error: "visibility_history_unavailable" }, { status: 503, headers });
  }
}
