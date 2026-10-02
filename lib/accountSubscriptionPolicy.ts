export type AccountSubscriptionGateRow = {
  status?: string | null;
  trial_end_at?: string | null;
  start_date?: string | null;
};

const TRIAL_DURATION_MS = 21 * 24 * 60 * 60 * 1000;

function dateMs(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Match the dashboard's access gate, even before the billing cron updates status. */
export function hasActiveAccountSubscription(
  subscription: AccountSubscriptionGateRow | null | undefined,
  nowMs = Date.now(),
): boolean {
  const status = String(subscription?.status || "").trim().toLowerCase();
  if (status === "active") return true;
  if (status !== "trialing") return false;

  const trialEndMs = dateMs(subscription?.trial_end_at);
  if (trialEndMs !== null) return trialEndMs > nowMs;

  const startMs = dateMs(subscription?.start_date);
  return startMs !== null && startMs + TRIAL_DURATION_MS > nowMs;
}
