import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { historicalVisibilityRewardRanges } from "./visibilityRewardHistory";

/** Only official server responses enter this private coverage register. */
export async function recordVisibilityRewardHistory(userId: string, overview: unknown) {
  const ranges = historicalVisibilityRewardRanges(overview);
  if (!ranges.length) return;
  const result = await supabaseAdmin.from("inrstats_visibility_reward_history").upsert(
    ranges.map(range => ({ user_id: userId, ...range, source: "provider_report" })),
    { onConflict: "user_id,channel_key,starts_on,ends_on", ignoreDuplicates: true },
  );
  if (result.error) throw new Error("visibility_reward_history_unavailable");
}
