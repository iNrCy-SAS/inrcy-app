export const ADMIN_SUBSCRIBER_STATUSES = ["active", "past_due", "unpaid", "paused"] as const;

export type StoredAdminSubscriberStatus = (typeof ADMIN_SUBSCRIBER_STATUSES)[number];
export type AdminSubscriberStatus = StoredAdminSubscriberStatus | "unverified";

export type AdminSubscriberSubscriptionRow = {
  user_id: string;
  contact_email: string | null;
  plan: string | null;
  status: string | null;
  monthly_price_eur: number | null;
  billing_cycle: string | null;
  billing_provider: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  last_reminder_at: string | null;
  next_renewal_date: string | null;
};

export type AdminSubscriberProfileRow = {
  user_id: string;
  admin_email: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_legal_name: string | null;
  phone: string | null;
};

export type AdminSubscriber = {
  user_id: string;
  name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  amount_eur: number | null;
  billing_cycle: string | null;
  payment_status: AdminSubscriberStatus;
  stored_payment_status: string | null;
  payment_status_source: "stripe_live" | "provider_database" | "unverified";
  payment_provider: string | null;
  last_followup_at: string | null;
  next_renewal_date: string | null;
  stripe_subscription_id: string | null;
  reconciliation_status:
    | "matched"
    | "unmatched"
    | "ambiguous"
    | "review_required"
    | "not_checked";
  reconciliation_method: string | null;
  reconciliation_candidate: {
    name: string | null;
    email: string | null;
    phone: string | null;
    amount_eur: number | null;
    payment_status: StoredAdminSubscriberStatus;
    stripe_subscription_id: string;
  } | null;
};

const RELEVANT_STATUS_SET = new Set<string>(ADMIN_SUBSCRIBER_STATUSES);
const PAYMENT_ISSUE_STATUS_SET = new Set<AdminSubscriberStatus>(["past_due", "unpaid"]);
const PAYMENT_STATUS_PRIORITY: Record<AdminSubscriberStatus, number> = {
  unpaid: 0,
  past_due: 1,
  unverified: 2,
  paused: 3,
  active: 4,
};

function textOrNull(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizedText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function amountOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function isRelevantAdminSubscriber(row: AdminSubscriberSubscriptionRow): boolean {
  return (
    Boolean(textOrNull(row.user_id)) &&
    normalizedText(row.plan) !== "trial" &&
    RELEVANT_STATUS_SET.has(normalizedText(row.status))
  );
}

export function toAdminSubscriber(
  subscription: AdminSubscriberSubscriptionRow,
  profile: AdminSubscriberProfileRow | null,
  verification?: {
    paymentStatus?: AdminSubscriberStatus;
    paymentStatusSource?: AdminSubscriber["payment_status_source"];
    reconciliationStatus?: AdminSubscriber["reconciliation_status"];
    reconciliationMethod?: string | null;
    reconciliationCandidate?: AdminSubscriber["reconciliation_candidate"];
  },
): AdminSubscriber {
  const firstName = textOrNull(profile?.first_name);
  const lastName = textOrNull(profile?.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    user_id: subscription.user_id,
    name: fullName || textOrNull(profile?.company_legal_name),
    company_name: textOrNull(profile?.company_legal_name),
    email:
      textOrNull(profile?.admin_email) ||
      textOrNull(profile?.contact_email) ||
      textOrNull(subscription.contact_email),
    phone: textOrNull(profile?.phone),
    amount_eur: amountOrNull(subscription.monthly_price_eur),
    billing_cycle: textOrNull(subscription.billing_cycle)?.toLowerCase() || null,
    payment_status:
      verification?.paymentStatus ?? (normalizedText(subscription.status) as AdminSubscriberStatus),
    stored_payment_status: textOrNull(subscription.status)?.toLowerCase() || null,
    payment_status_source: verification?.paymentStatusSource ?? "provider_database",
    payment_provider: textOrNull(subscription.billing_provider)?.toLowerCase() || null,
    last_followup_at: textOrNull(subscription.last_reminder_at),
    next_renewal_date: textOrNull(subscription.next_renewal_date),
    stripe_subscription_id: textOrNull(subscription.stripe_subscription_id),
    reconciliation_status: verification?.reconciliationStatus ?? "not_checked",
    reconciliation_method: verification?.reconciliationMethod ?? null,
    reconciliation_candidate: verification?.reconciliationCandidate ?? null,
  };
}

function followupSortValue(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function renewalSortValue(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = new Date(`${value}T00:00:00.000Z`).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

export function sortAdminSubscribers(rows: AdminSubscriber[]): AdminSubscriber[] {
  return [...rows].sort((left, right) => {
    const statusDelta =
      PAYMENT_STATUS_PRIORITY[left.payment_status] - PAYMENT_STATUS_PRIORITY[right.payment_status];
    if (statusDelta !== 0) return statusDelta;

    const followupDelta =
      followupSortValue(left.last_followup_at) - followupSortValue(right.last_followup_at);
    if (followupDelta !== 0) return followupDelta;

    const renewalDelta =
      renewalSortValue(left.next_renewal_date) - renewalSortValue(right.next_renewal_date);
    if (renewalDelta !== 0) return renewalDelta;

    const nameDelta = String(left.name || left.email || "").localeCompare(
      String(right.name || right.email || ""),
      "fr",
      { sensitivity: "base" },
    );
    return nameDelta || left.user_id.localeCompare(right.user_id);
  });
}

export function summarizeAdminSubscribers(rows: AdminSubscriber[]) {
  const activeRows = rows.filter((row) => row.payment_status === "active");
  const unpricedActiveCount = activeRows.filter((row) => row.amount_eur == null).length;
  const paymentIssueCount = rows.filter((row) =>
    PAYMENT_ISSUE_STATUS_SET.has(row.payment_status),
  ).length;
  const monthlyRevenueEur = activeRows.reduce(
    (total, row) => total + (row.amount_eur ?? 0),
    0,
  );

  return {
    active_count: activeRows.length,
    payment_issue_count: paymentIssueCount,
    monthly_revenue_eur: Math.round(monthlyRevenueEur * 100) / 100,
    unpriced_active_count: unpricedActiveCount,
    revenue_complete: unpricedActiveCount === 0,
  };
}
