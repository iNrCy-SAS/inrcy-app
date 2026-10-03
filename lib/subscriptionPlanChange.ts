import type { BillingCycle } from "./subscriptionOffers.ts";

type LooseObject = Record<string, unknown>;

function record(value: unknown): LooseObject {
  return value && typeof value === "object" ? value as LooseObject : {};
}

export function stripeObjectId(value: unknown): string | null {
  const id = typeof value === "string" ? value : record(value).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export type LiveCommercialItem = {
  id: string;
  priceId: string;
  quantity: number;
  billingCycle: BillingCycle;
};

export function singleCommercialItem(subscription: unknown): LiveCommercialItem | null {
  const items = record(record(subscription).items);
  const data = Array.isArray(items.data) ? items.data : [];
  if (items.has_more === true || data.length !== 1) return null;
  const item = record(data[0]);
  const price = record(item.price);
  const recurring = record(price.recurring);
  const id = stripeObjectId(item);
  const priceId = stripeObjectId(item.price);
  const intervalCount = Number(recurring.interval_count ?? 1);
  const billingCycle = recurring.interval === "month" && intervalCount === 1
    ? "monthly"
    : recurring.interval === "year" && intervalCount === 1
      ? "yearly"
      : null;
  const quantity = Number(item.quantity ?? 1);
  if (!id || !priceId || !billingCycle || quantity !== 1) return null;
  return { id, priceId, quantity, billingCycle };
}

export type PlanChangeQuote = {
  amountDue: number;
  currency: string;
  prorationDate: number;
};

export function parsePlanChangeQuote(invoice: unknown, prorationDate: number): PlanChangeQuote | null {
  const row = record(invoice);
  const amountDue = row.amount_due;
  const currency = String(row.currency ?? "").toLowerCase();
  if (typeof amountDue !== "number" || !Number.isSafeInteger(amountDue) ||
      amountDue < 0 || !/^[a-z]{3}$/.test(currency)) return null;
  return { amountDue, currency, prorationDate };
}

export const INRcy_DOWNGRADE_SCHEDULE_TAG = "premium_to_standard_at_period_end";

export function isInrcyDowngradeSchedule(schedule: unknown, userId: string): boolean {
  const row = record(schedule);
  const metadata = record(row.metadata);
  return metadata.inrcy_plan_change === INRcy_DOWNGRADE_SCHEDULE_TAG &&
    metadata.inrcy_user_id === userId &&
    row.status === "active";
}

export function scheduledStandardPriceId(schedule: unknown): string | null {
  const phases = record(schedule).phases;
  if (!Array.isArray(phases) || phases.length < 2) return null;
  const items = record(phases[1]).items;
  if (!Array.isArray(items) || items.length !== 1) return null;
  return stripeObjectId(record(items[0]).price);
}

/** Preserve the current paid period exactly; the next phase begins at renewal. */
export function downgradeScheduleParams({
  schedule,
  currentPriceId,
  nextPriceId,
  periodEndUnix,
  userId,
}: {
  schedule: unknown;
  currentPriceId: string;
  nextPriceId: string;
  periodEndUnix: number;
  userId: string;
}): URLSearchParams | null {
  const row = record(schedule);
  const phases = row.phases;
  if (!Array.isArray(phases) || phases.length !== 1) return null;
  const phase = record(phases[0]);
  const items = phase.items;
  if (!Array.isArray(items) || items.length !== 1) return null;
  const item = record(items[0]);
  if (stripeObjectId(item.price) !== currentPriceId || Number(item.quantity ?? 1) !== 1) return null;
  const start = Number(phase.start_date);
  const end = Number(phase.end_date);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start >= end || end !== periodEndUnix || end <= Math.floor(Date.now() / 1000)) return null;
  // Complex commercial agreements need a dedicated review so their discounts
  // or tax settings are never silently removed by a schedule update.
  if ([phase.discounts, phase.default_tax_rates, item.tax_rates, phase.add_invoice_items]
      .some((value) => Array.isArray(value) && value.length > 0) || phase.trial_end) return null;

  const params = new URLSearchParams();
  params.set("end_behavior", "release");
  params.set("proration_behavior", "none");
  params.set("metadata[inrcy_plan_change]", INRcy_DOWNGRADE_SCHEDULE_TAG);
  params.set("metadata[inrcy_user_id]", userId);
  params.set("phases[0][start_date]", String(start));
  params.set("phases[0][end_date]", String(end));
  params.set("phases[0][items][0][price]", currentPriceId);
  params.set("phases[0][items][0][quantity]", "1");
  for (const [key, value] of Object.entries(record(phase.metadata))) {
    if (typeof value === "string") params.set(`phases[0][metadata][${key}]`, value);
  }
  params.set("phases[1][items][0][price]", nextPriceId);
  params.set("phases[1][items][0][quantity]", "1");
  params.set("phases[1][iterations]", "1");
  params.set("phases[1][proration_behavior]", "none");
  params.set("phases[1][metadata][user_id]", userId);
  params.set("phases[1][metadata][plan]", "Standard");
  params.set("phases[1][metadata][app_edition]", "standard");
  return params;
}
