import { log } from "@/lib/observability/logger";

export async function clearAllToolCaches(supabase: any, userId: string) {
  try {
    // Durable provider fallbacks must survive unrelated cache invalidations
    // (settings changes, reconnect UI, iNrSearch provisioning, etc.).
    const { error } = await supabase
      .from("stats_cache")
      .delete()
      .eq("user_id", userId)
      .not("source", "like", "%last_good%");
    if (error) throw error;
  } catch (error) {
    log.warn("stats_cache_invalidation_failed", {
      user_id: userId,
      error: error instanceof Error ? error.message : String(error || ""),
    });
  }
}
