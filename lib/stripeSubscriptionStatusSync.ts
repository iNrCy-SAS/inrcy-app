import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { stripeGet } from "@/lib/stripeRest";
import { stripeSubscriptionCadence } from "@/lib/subscriptionCancellation";
import { stripeSubscriptionPeriodEndIso } from "@/lib/stripeSubscription";
import { reconciledStripeSubscriptionStatus } from "@/lib/stripeWebhookPayload";

const RECOVERY_CANDIDATE_STATUSES = [
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
] as const;

const BATCH_SIZE = 8;
const DEFAULT_LIMIT = 100;

type SubscriptionRecoveryRow = {
  user_id: string;
  status: string | null;
  stripe_subscription_id: string | null;
  billing_provider: string | null;
};

type StripeSubscriptionSnapshot = {
  status?: unknown;
  current_period_end?: unknown;
  items?: unknown;
};

export type StripeSubscriptionStatusSyncResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  scanned: number;
  checked: number;
  updated: number;
  recovered: number;
  unchanged: number;
  skipped: number;
  errors: Array<{ code: string }>;
};

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function syncErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const stripeMatch = message.match(/^Stripe error \((\d{3})\)/);
  if (stripeMatch) return `stripe_${stripeMatch[1]}`;
  return message.split(":")[0].slice(0, 80) || "unknown_error";
}

function billingCycleFromStripe(subscription: StripeSubscriptionSnapshot) {
  const cadence = stripeSubscriptionCadence(subscription);
  if (cadence?.interval === "year") return "yearly";
  if (cadence?.interval === "month") return "monthly";
  return null;
}

async function reconcileRow(
  row: SubscriptionRecoveryRow,
): Promise<"updated" | "recovered" | "unchanged" | "skipped"> {
  const subscriptionId = row.stripe_subscription_id?.trim();
  if (!subscriptionId) return "skipped";

  // Native billing can retain a historical Stripe id during a migration.
  // Never let the Stripe fallback overwrite the active native provider.
  const provider = normalized(row.billing_provider);
  if (provider && provider !== "stripe") return "skipped";

  const stripeSubscription = (await stripeGet(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  )) as StripeSubscriptionSnapshot;
  const stripeStatus = normalized(stripeSubscription.status);
  const existingStatus = normalized(row.status);

  if (stripeStatus === existingStatus) return "unchanged";

  const targetStatus = reconciledStripeSubscriptionStatus(existingStatus, stripeStatus);
  if (!targetStatus) return "skipped";

  const patch: Record<string, string> = {
    status: targetStatus,
    billing_provider: "stripe",
    updated_at: new Date().toISOString(),
  };
  const periodEnd = stripeSubscriptionPeriodEndIso(stripeSubscription);
  if (periodEnd) patch.next_renewal_date = periodEnd.slice(0, 10);
  const billingCycle = billingCycleFromStripe(stripeSubscription);
  if (billingCycle) patch.billing_cycle = billingCycle;

  // Optimistic status predicate: a webhook may have repaired the row while the
  // Stripe request was in flight. In that case this update becomes a no-op.
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .update(patch)
    .eq("user_id", row.user_id)
    .eq("stripe_subscription_id", subscriptionId)
    .eq("status", existingStatus)
    .select("user_id")
    .maybeSingle();

  if (error) throw error;
  if (!data) return "skipped";
  return targetStatus === "active" || targetStatus === "trialing"
    ? "recovered"
    : "updated";
}

export async function reconcileStripeSubscriptionStatuses(input?: {
  limit?: number;
}): Promise<StripeSubscriptionStatusSyncResult> {
  const startedAt = new Date();
  const result: StripeSubscriptionStatusSyncResult = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    scanned: 0,
    checked: 0,
    updated: 0,
    recovered: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
  };
  const limit = Math.min(250, Math.max(1, input?.limit ?? DEFAULT_LIMIT));

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id,status,stripe_subscription_id,billing_provider")
    .in("status", [...RECOVERY_CANDIDATE_STATUSES])
    .not("stripe_subscription_id", "is", null)
    .limit(limit);

  if (error) throw error;
  const rows = (data || []) as SubscriptionRecoveryRow[];
  result.scanned = rows.length;

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map((row) => reconcileRow(row)));
    for (const outcome of settled) {
      result.checked += 1;
      if (outcome.status === "rejected") {
        result.errors.push({ code: syncErrorCode(outcome.reason) });
        continue;
      }
      result[outcome.value] += 1;
    }
  }

  result.ok = result.errors.length === 0;
  result.finishedAt = new Date().toISOString();
  return result;
}
