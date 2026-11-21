import { acquireExecutionIdempotencyLock } from "./executionIdempotency.ts";

export const INR_AGENT_EDITORIAL_GENERATION_LEASE_MS = 20 * 60 * 1000;
const SCOPE = "inr_agent_editorial_generation";
const KEY = "account";
type Database = Parameters<typeof acquireExecutionIdempotencyLock>[0]["supabase"];

/** Shared by activation and cron; a lock failure must never start a generation. */
export async function withInrAgentEditorialGenerationLease<T>(
  args: { supabase: Database; userId: string },
  prepare: () => Promise<T>,
) {
  const claim = await acquireExecutionIdempotencyLock({
    ...args,
    scope: SCOPE,
    idempotencyKey: KEY,
    ttlMs: INR_AGENT_EDITORIAL_GENERATION_LEASE_MS,
  });
  if (claim.state === "running") return { status: "idle" as const, actionId: null, generationStarted: false as const };
  if (claim.state !== "acquired" || !claim.lock?.id || !claim.lock.locked_at || !claim.lock.expires_at) {
    return { status: "failed" as const, actionId: null, generationStarted: false as const, error: "editorial_generation_lease_unavailable" };
  }
  const lock = claim.lock;
  try {
    // Workers already running before this lease was introduced still own their action.
    try {
      const { data, error } = await args.supabase.from("inr_agent_actions")
        .select("id").eq("user_id", args.userId).eq("automation_key", "publish")
        .eq("status", "executing").eq("metadata->>editorialPlan", "true").limit(1);
      if (error) throw error;
      if (Array.isArray(data) && data.length) return { status: "idle" as const, actionId: null, generationStarted: false as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message || error);
      return { status: "failed" as const, actionId: null, generationStarted: false as const, error: message };
    }
    return await prepare();
  } finally {
    // A late worker cannot release a newer lease recovered after its own expiry.
    const now = new Date().toISOString();
    try {
      const { error } = await args.supabase.from("execution_idempotency_locks")
        .update({ status: "expired", expires_at: now, updated_at: now })
        .eq("id", lock.id).eq("user_id", args.userId).eq("scope", SCOPE).eq("idempotency_key", KEY)
        .eq("status", "running").eq("locked_at", lock.locked_at).eq("expires_at", lock.expires_at);
      if (error) console.warn("[inr-agent-editorial] generation lease release failed", error);
    } catch (error) {
      console.warn("[inr-agent-editorial] generation lease release failed", error);
    }
  }
}
