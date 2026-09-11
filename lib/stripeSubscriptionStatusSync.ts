import "server-only";

import { collectSupabaseKeysetPages } from "@/lib/adminSubscriberPagination";
import {
  matchAdminSubscribersToStripe,
  type AdminSubscriberReconciliationRecord,
  type AdminSubscriberStripeMatch,
} from "@/lib/adminSubscriberStripe";
import { listStripeAdminSubscriberSnapshots } from "@/lib/adminSubscriberStripeServer";
import type {
  AdminSubscriberProfileRow,
  AdminSubscriberSubscriptionRow,
} from "@/lib/adminSubscribers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { reconciledStripeSubscriptionStatus } from "@/lib/stripeWebhookPayload";

const SUBSCRIPTION_PAGE_SIZE = 500;
const PROFILE_BATCH_SIZE = 100;
const WRITE_BATCH_SIZE = 20;
const SUBSCRIPTION_SELECT =
  "user_id,contact_email,plan,status,monthly_price_eur,billing_cycle,billing_provider,stripe_customer_id,stripe_subscription_id,stripe_price_id,last_reminder_at,next_renewal_date,updated_at";
const PROFILE_SELECT =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone";

type SubscriptionSyncRow = AdminSubscriberSubscriptionRow & {
  updated_at: string | null;
};

export type StripeSubscriptionStatusSyncResult = {
  ok: boolean;
  degraded: boolean;
  startedAt: string;
  finishedAt: string;
  scanned: number;
  stripe_scanned: number;
  stripe_pages: number;
  matched: number;
  checked: number;
  updated: number;
  recovered: number;
  unchanged: number;
  skipped: number;
  ambiguous: number;
  review_required: number;
  unmatched_stripe: number;
  errors: Array<{ code: string }>;
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function syncErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  return message.split(":")[0].slice(0, 80) || "unknown_error";
}

async function fetchSubscriptions() {
  return collectSupabaseKeysetPages<SubscriptionSyncRow>({
    pageSize: SUBSCRIPTION_PAGE_SIZE,
    getCursor: (row) => row.user_id,
    fetchPage: async (after, limit) => {
      const baseQuery = supabaseAdmin
        .from("subscriptions")
        .select(SUBSCRIPTION_SELECT)
        .order("user_id", { ascending: true })
        .limit(limit);
      const { data, error } = await (after ? baseQuery.gt("user_id", after) : baseQuery);
      if (error) throw error;
      return (data ?? []) as SubscriptionSyncRow[];
    },
  });
}

async function fetchProfiles(userIds: string[]) {
  const byUserId = new Map<string, AdminSubscriberProfileRow>();
  for (let offset = 0; offset < userIds.length; offset += PROFILE_BATCH_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .in("user_id", userIds.slice(offset, offset + PROFILE_BATCH_SIZE));
    if (error) throw error;
    for (const profile of (data ?? []) as AdminSubscriberProfileRow[]) {
      byUserId.set(profile.user_id, profile);
    }
  }
  return byUserId;
}

function stringChanged(existing: unknown, next: string | null) {
  return String(existing ?? "").trim() !== String(next ?? "").trim();
}

function stripeIdChanged(existing: unknown, next: string | null) {
  return String(existing ?? "") !== String(next ?? "");
}

async function persistMatch(
  row: SubscriptionSyncRow,
  match: AdminSubscriberStripeMatch,
): Promise<"updated" | "recovered" | "unchanged" | "skipped"> {
  if (!match.write_safe) return "skipped";

  const snapshot = match.snapshot;
  const existingStatus = normalized(row.status);
  const patch: Record<string, string | number | null> = {};
  const targetStatus = reconciledStripeSubscriptionStatus(existingStatus, snapshot.status);
  if (targetStatus) patch.status = targetStatus;

  if (stringChanged(row.billing_provider, "stripe")) patch.billing_provider = "stripe";
  if (stripeIdChanged(row.stripe_subscription_id, snapshot.subscription_id)) {
    patch.stripe_subscription_id = snapshot.subscription_id;
  }
  if (snapshot.customer_id && stripeIdChanged(row.stripe_customer_id, snapshot.customer_id)) {
    patch.stripe_customer_id = snapshot.customer_id;
  }
  if (snapshot.price_id && stripeIdChanged(row.stripe_price_id, snapshot.price_id)) {
    patch.stripe_price_id = snapshot.price_id;
  }
  if (
    snapshot.amount_eur != null &&
    Number.isFinite(snapshot.amount_eur) &&
    snapshot.amount_eur >= 0 &&
    (row.monthly_price_eur == null ||
      Number(row.monthly_price_eur) !== snapshot.amount_eur)
  ) {
    patch.monthly_price_eur = snapshot.amount_eur;
  }
  if (
    (snapshot.billing_cycle === "monthly" || snapshot.billing_cycle === "yearly") &&
    stringChanged(row.billing_cycle, snapshot.billing_cycle)
  ) {
    patch.billing_cycle = snapshot.billing_cycle;
  }
  if (
    snapshot.next_renewal_date &&
    stringChanged(row.next_renewal_date, snapshot.next_renewal_date)
  ) {
    patch.next_renewal_date = snapshot.next_renewal_date;
  }

  if (Object.keys(patch).length === 0) return "unchanged";
  patch.updated_at = new Date().toISOString();

  // Optimistic predicates ensure a concurrent webhook wins over this backfill.
  let query = supabaseAdmin
    .from("subscriptions")
    .update(patch)
    .eq("user_id", row.user_id);
  query = row.status == null
    ? query.is("status", null)
    : query.eq("status", row.status);
  query = row.stripe_subscription_id == null
    ? query.is("stripe_subscription_id", null)
    : query.eq("stripe_subscription_id", row.stripe_subscription_id);
  query = row.updated_at == null
    ? query.is("updated_at", null)
    : query.eq("updated_at", row.updated_at);

  const { data, error } = await query.select("user_id").maybeSingle();
  if (error) throw error;
  if (!data) return "skipped";
  return targetStatus === "active" || targetStatus === "trialing"
    ? "recovered"
    : "updated";
}

export async function reconcileStripeSubscriptionStatuses(): Promise<StripeSubscriptionStatusSyncResult> {
  const startedAt = new Date();
  const result: StripeSubscriptionStatusSyncResult = {
    ok: true,
    degraded: false,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    scanned: 0,
    stripe_scanned: 0,
    stripe_pages: 0,
    matched: 0,
    checked: 0,
    updated: 0,
    recovered: 0,
    unchanged: 0,
    skipped: 0,
    ambiguous: 0,
    review_required: 0,
    unmatched_stripe: 0,
    errors: [],
  };

  const [{ rows }, stripe] = await Promise.all([
    fetchSubscriptions(),
    listStripeAdminSubscriberSnapshots(),
  ]);
  result.scanned = rows.length;
  const profilesByUserId = await fetchProfiles(
    Array.from(new Set(rows.map((row) => row.user_id))),
  );
  result.stripe_scanned = stripe.subscriptions_scanned;
  result.stripe_pages = stripe.pages;

  // All Supabase rows participate in uniqueness indexes, even expired trials,
  // so an out-of-scope duplicate can never become a false unique match.
  const records: AdminSubscriberReconciliationRecord[] = rows.map((subscription) => ({
    subscription,
    profile: profilesByUserId.get(subscription.user_id) ?? null,
  }));
  const reconciliation = matchAdminSubscribersToStripe(records, stripe.snapshots);
  result.matched = reconciliation.matchesByUserId.size;
  result.ambiguous = reconciliation.ambiguousUserIds.size;
  result.unmatched_stripe = reconciliation.unmatchedStripeSubscriptionIds.size;

  const writable = records.flatMap((record) => {
    const match = reconciliation.matchesByUserId.get(record.subscription.user_id);
    if (!match) return [];
    if (!match.write_safe) {
      result.review_required += 1;
      return [];
    }
    return [{ row: record.subscription as SubscriptionSyncRow, match }];
  });

  for (let offset = 0; offset < writable.length; offset += WRITE_BATCH_SIZE) {
    const batch = writable.slice(offset, offset + WRITE_BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map(({ row, match }) => persistMatch(row, match)),
    );
    for (const outcome of settled) {
      result.checked += 1;
      if (outcome.status === "rejected") {
        result.errors.push({ code: syncErrorCode(outcome.reason) });
      } else {
        result[outcome.value] += 1;
      }
    }
  }

  if (result.ambiguous || result.unmatched_stripe || result.review_required) {
    console.warn(
      "[stripe-subscription-sync][reconciliation_anomalies]",
      JSON.stringify({
        ambiguous: result.ambiguous,
        unmatched_stripe: result.unmatched_stripe,
        review_required: result.review_required,
      }),
    );
  }
  result.ok = result.errors.length === 0;
  result.degraded = Boolean(
    result.ambiguous ||
      result.unmatched_stripe ||
      result.review_required ||
      result.errors.length,
  );
  result.finishedAt = new Date().toISOString();
  return result;
}
