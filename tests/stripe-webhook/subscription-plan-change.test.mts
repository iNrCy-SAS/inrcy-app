import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  downgradeScheduleParams,
  isInrcyDowngradeSchedule,
  parsePlanChangeQuote,
  scheduledStandardPriceId,
  singleCommercialItem,
} from "../../lib/subscriptionPlanChange.ts";
import { isApiRouteAllowedForEdition } from "../../lib/dashboardEdition.ts";

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, new URL("../../", import.meta.url)), "utf8");

test("the plan-change flow quotes and confirms the same Stripe proration before granting rights", () => {
  const route = source("app/api/billing/change-plan/route.ts");
  const webhook = source("app/api/stripe/webhook/route.ts");
  assert.match(route, /invoices\/create_preview/);
  assert.match(route, /quote\.amountDue !== expectedAmountDue/);
  assert.match(route, /payment_behavior", "pending_if_incomplete"/);
  assert.match(route, /proration_behavior", "always_invoice"/);
  assert.match(route, /updated\.pending_update/);
  assert.doesNotMatch(route, /app_edition\s*:/);
  assert.match(webhook, /app_edition: commercialPrice\.edition/);
});

test("Stripe item must be a single, quantity-one commercial subscription", () => {
  const item = {
    id: "si_current",
    price: { id: "price_current", recurring: { interval: "month", interval_count: 1 } },
    quantity: 1,
  };
  assert.deepEqual(singleCommercialItem({ items: { data: [item], has_more: false } }), {
    id: "si_current", priceId: "price_current", quantity: 1, billingCycle: "monthly",
  });
  assert.equal(singleCommercialItem({ items: { data: [item, item] } }), null);
  assert.equal(singleCommercialItem({ items: { data: [{ ...item, quantity: 2 }] } }), null);
  assert.equal(singleCommercialItem({ items: { data: [item], has_more: true } }), null);
});

test("proration quote rejects missing or negative amounts", () => {
  assert.deepEqual(parsePlanChangeQuote({ amount_due: 1234, currency: "EUR" }, 123), {
    amountDue: 1234, currency: "eur", prorationDate: 123,
  });
  assert.equal(parsePlanChangeQuote({ amount_due: -1, currency: "eur" }, 123), null);
  assert.equal(parsePlanChangeQuote({ amount_due: null, currency: "eur" }, 123), null);
});

test("downgrade schedule keeps the paid phase intact and activates Standard at renewal", () => {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 1000;
  const end = now + 86_400;
  const schedule = {
    status: "active",
    phases: [{
      start_date: start,
      end_date: end,
      items: [{ price: "price_premium", quantity: 1 }],
      metadata: { user_id: "user-1" },
    }],
  };
  const params = downgradeScheduleParams({
    schedule, currentPriceId: "price_premium", nextPriceId: "price_standard",
    periodEndUnix: end, userId: "user-1",
  });
  assert.ok(params);
  assert.equal(params.get("phases[0][end_date]"), String(end));
  assert.equal(params.get("phases[0][items][0][price]"), "price_premium");
  assert.equal(params.get("phases[1][items][0][price]"), "price_standard");
  assert.equal(params.get("phases[1][proration_behavior]"), "none");
  assert.equal(params.get("end_behavior"), "release");
  assert.equal(params.get("metadata[inrcy_user_id]"), "user-1");
  assert.equal(downgradeScheduleParams({
    schedule: { ...schedule, phases: [{ ...schedule.phases[0], discounts: [{ coupon: "custom" }] }] },
    currentPriceId: "price_premium", nextPriceId: "price_standard", periodEndUnix: end, userId: "user-1",
  }), null);
  assert.equal(downgradeScheduleParams({
    schedule, currentPriceId: "price_premium", nextPriceId: "price_standard",
    periodEndUnix: end + 1, userId: "user-1",
  }), null);
});

test("only the account's own active downgrade schedule can be cancelled", () => {
  const schedule = {
    status: "active",
    metadata: { inrcy_plan_change: "premium_to_standard_at_period_end", inrcy_user_id: "user-1" },
    phases: [{}, { items: [{ price: "price_standard" }] }],
  };
  assert.equal(isInrcyDowngradeSchedule(schedule, "user-1"), true);
  assert.equal(isInrcyDowngradeSchedule(schedule, "user-2"), false);
  assert.equal(scheduledStandardPriceId(schedule), "price_standard");
  assert.equal(isInrcyDowngradeSchedule({ ...schedule, status: "completed" }, "user-1"), false);
});

test("Premium video quota patch is scoped to Premium and preserves Founder/data", () => {
  const sql = source("supabase/migrations/20261003163341_ai_media_premium_video_196_seconds.sql");
  const policy = source("lib/aiMediaPlanLimits.ts");
  const billingSync = source("lib/stripeSubscriptionStatusSync.ts");
  assert.match(sql, /update public\.ai_media_plan_limits\s+set video_monthly_limit = 196/i);
  assert.match(sql, /where edition = 'premium'/i);
  assert.doesNotMatch(sql, /delete\s+from/i);
  assert.match(policy, /premium: Object\.freeze\(\{[\s\S]*?video: 196/);
  assert.match(billingSync, /commercialPriceFromId\(snapshot\.price_id\)/);
  assert.match(billingSync, /patch\.app_edition = safeCommercialPrice\.edition/);
});

test("after downgrade, Premium APIs and background tools are blocked without deleting their data", () => {
  for (const pathname of [
    "/api/ads/campaigns",
    "/api/calendar/events",
    "/api/mails/campaigns",
    "/api/agent/actions/prepare-campaign",
  ]) {
    assert.equal(isApiRouteAllowedForEdition(pathname, undefined, "standard"), false, pathname);
    assert.equal(isApiRouteAllowedForEdition(pathname, undefined, "premium"), true, pathname);
  }
  for (const path of [
    "app/api/cron/calendar-reminders/route.ts",
    "app/api/cron/notifications/route.ts",
    "lib/crmCampaigns.ts",
    "lib/mailCampaignCompletionEmail.ts",
  ]) {
    assert.match(source(path), /hasPremiumDashboardAccess/);
  }
});
