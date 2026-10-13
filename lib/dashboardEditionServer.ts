import "server-only";

import { NextResponse } from "next/server";
import {
  resolveDashboardEdition,
  resolveDashboardEditionForRole,
  type DashboardEdition,
} from "@/lib/dashboardEdition";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SubscriptionEditionRow = {
  user_id?: string | null;
  app_edition?: string | null;
  plan?: string | null;
};

function editionFromRow(
  row: SubscriptionEditionRow | null | undefined,
): DashboardEdition {
  return resolveDashboardEdition({
    edition: row?.app_edition,
    plan: row?.plan,
    developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
  });
}

export async function getDashboardEditionForAuthUser(
  authUserId: string,
): Promise<DashboardEdition> {
  if (!authUserId) return "standard";

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, app_edition, plan")
    .eq("user_id", authUserId)
    .maybeSingle();

  // A temporary subscription lookup failure must never unlock Premium APIs.
  if (error || !data) return "standard";
  const { data: profile, error: profileError } = await supabaseAdmin.from("profiles").select("role").eq("user_id", authUserId).maybeSingle();
  return resolveDashboardEditionForRole(editionFromRow(data as SubscriptionEditionRow), profileError ? null : profile?.role, authUserId);
}

/** Resolve auth-level editions for account-scoped cron rows in one batch. */
export async function getDashboardEditionsForAccountIds(
  accountIds: readonly string[],
): Promise<Map<string, DashboardEdition>> {
  const uniqueAccountIds = Array.from(
    new Set(accountIds.map((value) => String(value || "").trim()).filter(Boolean)),
  );
  const editions = new Map<string, DashboardEdition>(
    uniqueAccountIds.map((accountId) => [accountId, "standard"]),
  );
  if (!uniqueAccountIds.length) return editions;

  const { data: membershipRows, error: membershipError } = await supabaseAdmin
    .from("inrcy_account_members")
    .select("account_id, auth_user_id, role")
    .in("account_id", uniqueAccountIds);

  if (membershipError) return editions;

  const ownerByAccount = new Map<string, string>();
  for (const row of Array.isArray(membershipRows) ? membershipRows : []) {
    const accountId = String(row?.account_id || "").trim();
    const authUserId = String(row?.auth_user_id || "").trim();
    const role = String(row?.role || "").trim().toLowerCase();
    if (!accountId || !authUserId) continue;
    if (role === "owner" || !ownerByAccount.has(accountId)) {
      ownerByAccount.set(accountId, authUserId);
    }
  }

  const authUserIds = Array.from(
    new Set([
      ...uniqueAccountIds,
      ...ownerByAccount.values(),
    ]),
  );
  const { data: subscriptionRows, error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, app_edition, plan")
    .in("user_id", authUserIds);

  if (subscriptionError) return editions;

  // The exception is restricted to the explicitly approved existing review account.
  // No role grants membership, changes a subscription, or unlocks another company.
  const { data: profileRows, error: profileError } = await supabaseAdmin.from("profiles").select("user_id,role").in("user_id", uniqueAccountIds);
  const rolesByAccount = new Map<string, unknown>();
  if (!profileError) for (const row of Array.isArray(profileRows) ? profileRows : []) {
    rolesByAccount.set(String(row.user_id || "").trim(), row.role);
  }

  const subscriptionsByUser = new Map<string, SubscriptionEditionRow>();
  for (const row of Array.isArray(subscriptionRows) ? subscriptionRows : []) {
    const userId = String(row?.user_id || "").trim();
    if (userId) subscriptionsByUser.set(userId, row as SubscriptionEditionRow);
  }

  for (const accountId of uniqueAccountIds) {
    const authUserId = ownerByAccount.get(accountId) || accountId;
    const subscription =
      subscriptionsByUser.get(authUserId) || subscriptionsByUser.get(accountId);
    if (subscription) editions.set(accountId, resolveDashboardEditionForRole(editionFromRow(subscription), rolesByAccount.get(accountId), accountId));
  }

  return editions;
}

export async function getDashboardEditionForAccountId(
  accountId: string,
): Promise<DashboardEdition> {
  const normalizedAccountId = String(accountId || "").trim();
  if (!normalizedAccountId) return "standard";
  const editions = await getDashboardEditionsForAccountIds([normalizedAccountId]);
  return editions.get(normalizedAccountId) || "standard";
}

export function premiumRequiredApiResponse() {
  return NextResponse.json(
    {
      error: "PREMIUM_REQUIRED",
      code: "PREMIUM_REQUIRED",
      redirectTo: "/dashboard?panel=contact",
      message:
        "Cette automatisation est réservée à iNrCy Premium. Contactez-nous pour en parler.",
    },
    { status: 403 },
  );
}
