import "server-only";

import { buildBubbleAccessMap, type AppBubbleAccessRow } from "@/lib/bubbleAccess";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const TRIAL_DURATION_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

export type InrSearchPublicationReason =
  | "published"
  | "bubble_disabled"
  | "subscription_inactive";

export type InrSearchPublicationEligibility = {
  allowed: boolean;
  reason: InrSearchPublicationReason;
  accountId: string;
  authUserId: string;
  subscriptionStatus: string;
};

type SubscriptionRow = {
  user_id?: string | null;
  status?: string | null;
  trial_end_at?: string | null;
  start_date?: string | null;
};

type MembershipRow = {
  account_id?: string | null;
  auth_user_id?: string | null;
  is_default?: boolean | null;
  created_at?: string | null;
};

function clean(value: unknown, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeStatus(value: unknown) {
  return clean(value, 60).toLowerCase();
}

function parseDateMs(value: unknown) {
  const raw = clean(value, 80);
  if (!raw) return null;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) ? time : null;
}

export function hasActiveInrSearchSubscription(
  subscription?: SubscriptionRow | null,
  nowMs = Date.now(),
) {
  const status = normalizeStatus(subscription?.status);
  if (status === "active") return true;
  if (status !== "trialing") return false;

  const trialEndMs = parseDateMs(subscription?.trial_end_at);
  if (trialEndMs !== null) return trialEndMs > nowMs;

  const startMs = parseDateMs(subscription?.start_date);
  return startMs !== null && startMs + TRIAL_DURATION_DAYS * DAY_MS > nowMs;
}

function pickAuthUserId(accountId: string, rows: MembershipRow[]) {
  const candidates = rows
    .filter((row) => clean(row.account_id) === accountId && clean(row.auth_user_id))
    .sort((left, right) => {
      if (Boolean(left.is_default) !== Boolean(right.is_default)) return left.is_default ? -1 : 1;
      return clean(left.created_at, 80).localeCompare(clean(right.created_at, 80));
    });
  return clean(candidates[0]?.auth_user_id) || accountId;
}

type PublicPresenceBubble = "inr_search" | "inr_directory" | "inrbadge";
type NativePublicationAccess = Record<PublicPresenceBubble, boolean>;
export type NativeChannelPublicationEligibility = Record<PublicPresenceBubble, InrSearchPublicationEligibility>;

async function loadEligibilityInputs(accountIds: string[]) {
  const uniqueAccountIds = Array.from(new Set(accountIds.map((value) => clean(value)).filter(Boolean)));
  if (!uniqueAccountIds.length) {
    return {
      accessByAccount: new Map<string, NativePublicationAccess>(),
      authUserByAccount: new Map<string, string>(),
      subscriptionByAuthUser: new Map<string, SubscriptionRow>(),
      adminAuthUsers: new Set<string>(),
    };
  }

  const [accessRes, membershipsRes] = await Promise.all([
    supabaseAdmin
      .from("app_bubble_access")
      .select("user_id,bubble_key,enabled")
      .in("user_id", uniqueAccountIds)
      .in("bubble_key", ["inrbadge", "inr_search", "inr_directory"]),
    supabaseAdmin
      .from("inrcy_account_members")
      .select("account_id,auth_user_id,is_default,created_at")
      .in("account_id", uniqueAccountIds),
  ]);

  if (accessRes.error) throw accessRes.error;
  if (membershipsRes.error) throw membershipsRes.error;
  const accessRows = Array.isArray(accessRes.data) ? accessRes.data : [];
  const membershipRows = Array.isArray(membershipsRes.data)
    ? membershipsRes.data as MembershipRow[]
    : [];

  const accessByAccount = new Map<string, NativePublicationAccess>();
  for (const accountId of uniqueAccountIds) {
    const rows = accessRows
      .filter((row: any) => clean(row?.user_id) === accountId)
      .map((row: any) => ({ bubble_key: row?.bubble_key, enabled: row?.enabled })) as AppBubbleAccessRow[];
    const access = buildBubbleAccessMap(rows);
    accessByAccount.set(accountId, {
      inrbadge: access.inrbadge,
      inr_search: access.inr_search,
      inr_directory: access.inr_directory && access.inrbadge,
    });
  }

  const authUserByAccount = new Map<string, string>();
  for (const accountId of uniqueAccountIds) {
    authUserByAccount.set(accountId, pickAuthUserId(accountId, membershipRows));
  }

  // Multi-compte : selon l'ancienneté du compte, l'abonnement / le rôle admin
  // peuvent être rattachés soit à l'utilisateur Auth, soit directement au compte actif.
  // On interroge les deux identifiants pour éviter une fausse page 404.
  const authUserIds = Array.from(new Set(authUserByAccount.values()));
  const subscriptionOwnerIds = Array.from(new Set([...uniqueAccountIds, ...authUserIds]));
  const [subscriptionsRes, profilesRes] = await Promise.all([
    supabaseAdmin
      .from("subscriptions")
      .select("user_id,status,trial_end_at,start_date")
      .in("user_id", subscriptionOwnerIds),
    supabaseAdmin
      .from("profiles")
      .select("user_id,role")
      .in("user_id", subscriptionOwnerIds),
  ]);

  if (subscriptionsRes.error) throw subscriptionsRes.error;
  if (profilesRes.error) throw profilesRes.error;
  const subscriptionByAuthUser = new Map<string, SubscriptionRow>();
  for (const row of Array.isArray(subscriptionsRes.data) ? subscriptionsRes.data : []) {
    const userId = clean((row as any)?.user_id);
    if (userId) subscriptionByAuthUser.set(userId, row as SubscriptionRow);
  }

  const adminAuthUsers = new Set<string>();
  for (const row of Array.isArray(profilesRes.data) ? profilesRes.data : []) {
    if (normalizeStatus((row as any)?.role) === "admin") {
      const userId = clean((row as any)?.user_id);
      if (userId) adminAuthUsers.add(userId);
    }
  }

  return { accessByAccount, authUserByAccount, subscriptionByAuthUser, adminAuthUsers };
}

function resolvePublicationEligibility(
  accountId: string,
  inputs: Awaited<ReturnType<typeof loadEligibilityInputs>>,
  bubbleKey: PublicPresenceBubble,
  nowMs = Date.now(),
): InrSearchPublicationEligibility {
  const authUserId = inputs.authUserByAccount.get(accountId) || accountId;
  const subscription = inputs.subscriptionByAuthUser.get(authUserId)
    || inputs.subscriptionByAuthUser.get(accountId)
    || null;
  const subscriptionStatus = normalizeStatus(subscription?.status);

  if (!accountId || inputs.accessByAccount.get(accountId)?.[bubbleKey] !== true) {
    return { allowed: false, reason: "bubble_disabled", accountId, authUserId, subscriptionStatus };
  }

  if (!inputs.adminAuthUsers.has(authUserId) && !inputs.adminAuthUsers.has(accountId) && !hasActiveInrSearchSubscription(subscription, nowMs)) {
    return { allowed: false, reason: "subscription_inactive", accountId, authUserId, subscriptionStatus };
  }

  return { allowed: true, reason: "published", accountId, authUserId, subscriptionStatus };
}

export async function getInrSearchPublicationEligibility(
  accountIdValue: unknown,
  bubbleKey: PublicPresenceBubble = "inr_search",
): Promise<InrSearchPublicationEligibility> {
  const accountId = clean(accountIdValue);
  const inputs = await loadEligibilityInputs(accountId ? [accountId] : []);
  return resolvePublicationEligibility(accountId, inputs, bubbleKey);
}

/** One batch of four queries supplies the same three native channel decisions. */
export async function getNativeChannelPublicationEligibility(accountIdValue: unknown): Promise<NativeChannelPublicationEligibility> {
  const accountId = clean(accountIdValue);
  const inputs = await loadEligibilityInputs(accountId ? [accountId] : []);
  const nowMs = Date.now();
  return {
    inrbadge: resolvePublicationEligibility(accountId, inputs, "inrbadge", nowMs),
    inr_search: resolvePublicationEligibility(accountId, inputs, "inr_search", nowMs),
    inr_directory: resolvePublicationEligibility(accountId, inputs, "inr_directory", nowMs),
  };
}

export async function filterEligibleInrSearchAccountIds(accountIds: string[], bubbleKey: PublicPresenceBubble = "inr_search") {
  const uniqueAccountIds = Array.from(new Set(accountIds.map((value) => clean(value)).filter(Boolean)));
  const inputs = await loadEligibilityInputs(uniqueAccountIds);
  const eligible = new Set<string>();

  for (const accountId of uniqueAccountIds) {
    if (inputs.accessByAccount.get(accountId)?.[bubbleKey] !== true) continue;
    const authUserId = inputs.authUserByAccount.get(accountId) || accountId;
    const subscription = inputs.subscriptionByAuthUser.get(authUserId)
      || inputs.subscriptionByAuthUser.get(accountId)
      || null;
    if (inputs.adminAuthUsers.has(authUserId) || inputs.adminAuthUsers.has(accountId) || hasActiveInrSearchSubscription(subscription)) {
      eligible.add(accountId);
    }
  }

  return eligible;
}

export function getInrDirectoryPublicationEligibility(accountId: unknown) {
  return getInrSearchPublicationEligibility(accountId, "inr_directory");
}
export function filterEligibleInrDirectoryAccountIds(accountIds: string[]) {
  return filterEligibleInrSearchAccountIds(accountIds, "inr_directory");
}
