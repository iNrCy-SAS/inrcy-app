import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { backfillVisibilityRewardHistory } from "./visibilityRewardBackfill";
import { hasActiveAccountSubscription } from "@/lib/accountSubscriptionPolicy";

export const VISIBILITY_MILESTONE_REWARDS = [{ months: 1, amount: 50 }, { months: 3, amount: 100 }, { months: 6, amount: 200 }, { months: 12, amount: 500 }] as const;
export type VisibilityRewardTier = "basic" | "standard" | "premium";
export function visibilityRewardTier(plan: unknown, edition: unknown): VisibilityRewardTier | null {
  const normalized = String(plan || "").trim().toLowerCase().replace(/^inrcy[ _-]+/, "");
  if (["basic", "basique"].includes(normalized)) return "basic";
  if (["premium", "founder", "starter", "accel", "speed"].includes(normalized)) return "premium";
  if (["standard", "trial"].includes(normalized)) return "standard";
  const appEdition = String(edition || "").trim().toLowerCase();
  return appEdition === "basic" || appEdition === "basique" ? "basic" : appEdition === "standard" ? "standard" : appEdition === "premium" || appEdition === "founder" ? "premium" : null;
}
export function visibilityRewardMultiplier(tier: VisibilityRewardTier): number { return tier === "basic" ? 0.5 : tier === "premium" ? 1.5 : 1; }

/** The commercial subscription belongs to the owner, never to the visiting team member. */
export async function getVisibilityRewardTier(userId: string): Promise<VisibilityRewardTier | null> {
  const membership = await supabaseAdmin.from("inrcy_account_members").select("auth_user_id").eq("account_id", userId).eq("role", "owner").maybeSingle();
  if (membership.error) throw new Error("visibility_reward_owner_unavailable");
  const ownerId = membership.data?.auth_user_id || userId;
  const subscriptions = await supabaseAdmin.from("subscriptions").select("user_id,plan,app_edition,status,trial_end_at,start_date").in("user_id", ownerId === userId ? [userId] : [ownerId, userId]);
  if (subscriptions.error) throw new Error("visibility_reward_subscription_unavailable");
  const row = subscriptions.data?.find(item => item.user_id === ownerId) ?? subscriptions.data?.find(item => item.user_id === userId);
  return row && hasActiveAccountSubscription(row) ? visibilityRewardTier(row.plan, row.app_edition) : null;
}
export async function reconcileVisibilityRewards(userId: string) {
  const tier = await getVisibilityRewardTier(userId);
  if (tier) {
    try { await backfillVisibilityRewardHistory(userId); }
    catch { console.warn("[inrstats-visibility] Historical reward reconciliation deferred"); }
    const result = await supabaseAdmin.rpc("award_inrstats_visibility_milestones", { p_user_id: userId, p_tier: tier });
    if (result.error) throw new Error("visibility_reward_write_failed");
  }
  return tier;
}
export async function readVisibilityRewards(userId: string, tier: VisibilityRewardTier | null) {
  const result = await supabaseAdmin.from("loyalty_ledger").select("source_id,amount,created_at").eq("user_id", userId).eq("action_key", "stats_evolution_milestone");
  if (result.error) throw new Error("visibility_rewards_unavailable");
  return VISIBILITY_MILESTONE_REWARDS.map(reward => {
    const earned = result.data?.find(row => row.source_id === `visibility-${reward.months}m`);
    return { months: reward.months, amount: earned ? Number(earned.amount) : tier ? Math.round(reward.amount * visibilityRewardMultiplier(tier)) : null, awardedAt: earned?.created_at ?? null };
  });
}
