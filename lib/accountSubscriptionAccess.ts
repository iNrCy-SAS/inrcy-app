import "server-only";

import { hasActiveAccountSubscription, type AccountSubscriptionGateRow } from "@/lib/accountSubscriptionPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function cleanId(value: unknown): string {
  return String(value || "").trim();
}

/** Resolve account-scoped jobs against their owner's auth subscription. Lookup errors fail closed. */
export async function getActiveSubscriptionAccountIds(
  accountIds: readonly string[],
  nowMs = Date.now(),
): Promise<Set<string>> {
  const uniqueAccountIds = Array.from(new Set(accountIds.map(cleanId).filter(Boolean)));
  const active = new Set<string>();
  if (!uniqueAccountIds.length) return active;

  const { data: membershipRows, error: membershipError } = await supabaseAdmin
    .from("inrcy_account_members")
    .select("account_id,auth_user_id,role")
    .in("account_id", uniqueAccountIds);
  if (membershipError) throw new Error("Vérification des titulaires de compte impossible.");

  const ownerByAccount = new Map<string, string>();
  for (const row of Array.isArray(membershipRows) ? membershipRows : []) {
    const accountId = cleanId(row.account_id);
    const authUserId = cleanId(row.auth_user_id);
    if (!accountId || !authUserId) continue;
    if (String(row.role || "").trim().toLowerCase() === "owner" || !ownerByAccount.has(accountId)) {
      ownerByAccount.set(accountId, authUserId);
    }
  }

  // Legacy accounts may store the subscription on the account id itself.
  const userIds = Array.from(new Set([...uniqueAccountIds, ...ownerByAccount.values()]));
  const { data: subscriptionRows, error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id,status,trial_end_at,start_date")
    .in("user_id", userIds);
  if (subscriptionError) throw new Error("Vérification de l’abonnement impossible.");

  const subscriptionByUser = new Map<string, AccountSubscriptionGateRow>();
  for (const row of Array.isArray(subscriptionRows) ? subscriptionRows : []) {
    const userId = cleanId(row.user_id);
    if (userId) subscriptionByUser.set(userId, row as AccountSubscriptionGateRow);
  }

  for (const accountId of uniqueAccountIds) {
    const ownerId = ownerByAccount.get(accountId) || accountId;
    const subscription = subscriptionByUser.get(ownerId) || subscriptionByUser.get(accountId);
    if (hasActiveAccountSubscription(subscription, nowMs)) active.add(accountId);
  }
  return active;
}
