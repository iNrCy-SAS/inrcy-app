import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { User } from "@supabase/supabase-js";
import { getDirectSignupMetadata } from "@/lib/directSignupPolicy";
import { ensurePrincipalInrcyAccountProvisioned } from "@/lib/inrcyAccountProvisioning";

const DIRECT_SUBSCRIPTION_SELECT = "user_id,status,plan,app_edition,billing_cycle,billing_provider,stripe_subscription_id,trial_start_at,trial_end_at";

function pendingSubscription(userId: string, email: string) {
  return {
    user_id: userId, plan: "Basic", app_edition: "basic", status: "incomplete",
    monthly_price_eur: 0, monthly_price_tax_behavior: "exclusive", billing_provider: "stripe",
    start_date: new Date().toISOString().slice(0, 10), contact_email: email,
    trial_start_at: null, trial_end_at: null, scheduled_plan: null,
    last_trial_reminder_day: 0, last_reminder_at: null, updated_at: new Date().toISOString(),
  };
}

/** Only a freshly authenticated, server-marked direct signup may repair itself.
 * Never replace an existing contract, including one inserted by a racing webhook.
 */
export async function loadOrRepairDirectSignupSubscription(user: User) {
  if (!user.id || !user.email || !getDirectSignupMetadata(user.app_metadata)) throw new Error("direct_signup_required");
  const read = async () => {
    const result = await supabaseAdmin.from("subscriptions").select(DIRECT_SUBSCRIPTION_SELECT).eq("user_id", user.id).maybeSingle();
    if (result.error || result.data && result.data.user_id !== user.id) throw new Error("direct_signup_subscription_unavailable");
    return result.data;
  };
  const existing = await read();
  if (existing) return existing;
  await ensurePrincipalInrcyAccountProvisioned(user);
  const inserted = await supabaseAdmin.from("subscriptions").upsert(pendingSubscription(user.id, user.email), {
    onConflict: "user_id", ignoreDuplicates: true,
  });
  if (inserted.error) throw new Error("direct_signup_pending_subscription_failed");
  const repaired = await read();
  if (!repaired) throw new Error("direct_signup_pending_subscription_missing");
  return repaired;
}

/** No session or password receipt may be issued until this postcondition holds. */
export async function ensureDirectSignupPendingSubscription(userId: string, email: string) {
  const { data, error } = await supabaseAdmin.from("subscriptions").upsert(pendingSubscription(userId, email),
    { onConflict: "user_id" }).select("user_id,plan,status,trial_start_at,trial_end_at").single();
  if (error || !data || data.user_id !== userId || data.plan !== "Basic" || data.status !== "incomplete"
    || data.trial_start_at !== null || data.trial_end_at !== null) throw new Error("direct_signup_pending_subscription_failed");
  return { edition: "basic" as const, trialDays: 0, end: null };
}
