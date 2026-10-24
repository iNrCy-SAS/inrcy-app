import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HISTORICAL_REWARD_CHANNELS, historicalVisibilityRewardRanges } from "./visibilityRewardHistory";

// Fetch only dates, range totals and error flags; never provider tokens or raw reports.
export const REWARD_CACHE_PROJECTION = ["range_key", "days:payload->days", "meta:payload->meta", ...HISTORICAL_REWARD_CHANNELS.flatMap(key => [
  `${key}_connected:payload->sources->${key}->connected`, `${key}_range:payload->sources->${key}->metrics->range`,
  `${key}_totals:payload->sources->${key}->metrics->totals`, `${key}_error:payload->sources->${key}->metrics->error`,
  `${key}_reconnect:payload->sources->${key}->metrics->needs_reconnect`,
])].join(",");
export function rewardCacheOverview(row: Record<string, unknown>) {
  return { days: row.days, meta: row.meta, sources: Object.fromEntries(HISTORICAL_REWARD_CHANNELS.map(key => [key, {
    connected: row[`${key}_connected`], metrics: { range: row[`${key}_range`], totals: row[`${key}_totals`], error: row[`${key}_error`], needs_reconnect: row[`${key}_reconnect`] },
  }])) };
}

/** Idempotent legacy import, strictly scoped to the server-resolved account. */
export async function backfillVisibilityRewardHistory(userId: string) {
  const tracking = await supabaseAdmin.from("inrstats_visibility_tracking").select("reward_history_checked_at").eq("user_id", userId).maybeSingle();
  if (tracking.error) throw new Error("visibility_reward_history_unavailable");
  const last = Date.parse(tracking.data?.reward_history_checked_at || "");
  if (Number.isFinite(last) && Date.now() - last < 86_400_000) return;
  const trusted = await supabaseAdmin.rpc("inrstats_reward_cache_is_trusted");
  if (trusted.error) throw new Error("visibility_reward_history_unavailable");
  if (trusted.data === true) {
    for (let offset = 0; ; offset += 500) {
      const result = await supabaseAdmin.from("stats_cache").select(REWARD_CACHE_PROJECTION)
        .eq("user_id", userId).in("source", ["overview", "overview_last_good"]).order("source").order("range_key").range(offset, offset + 499);
      if (result.error) throw new Error("visibility_reward_history_unavailable");
      const rows = (result.data || []) as unknown as Array<Record<string, unknown>>;
      const ranges = new Map(rows.flatMap(row => historicalVisibilityRewardRanges(rewardCacheOverview(row))).map(range => [`${range.channel_key}:${range.starts_on}:${range.ends_on}`, range]));
      if (ranges.size) {
        const saved = await supabaseAdmin.from("inrstats_visibility_reward_history").upsert([...ranges.values()].map(range => ({ user_id: userId, ...range, source: "trusted_cache" })), { onConflict: "user_id,channel_key,starts_on,ends_on", ignoreDuplicates: true });
        if (saved.error) throw new Error("visibility_reward_history_unavailable");
      }
      if (rows.length < 500) break;
    }
  }
  const checked = await supabaseAdmin.from("inrstats_visibility_tracking").update({ reward_history_checked_at: new Date().toISOString() }).eq("user_id", userId);
  if (checked.error) throw new Error("visibility_reward_history_unavailable");
}
