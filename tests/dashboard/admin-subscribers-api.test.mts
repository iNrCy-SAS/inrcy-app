import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isRelevantAdminSubscriber,
  sortAdminSubscribers,
  summarizeAdminSubscribers,
  toAdminSubscriber,
  type AdminSubscriberProfileRow,
  type AdminSubscriberSubscriptionRow,
} from "../../lib/adminSubscribers.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function subscription(
  overrides: Partial<AdminSubscriberSubscriptionRow>,
): AdminSubscriberSubscriptionRow {
  return {
    user_id: "user-default",
    contact_email: null,
    plan: "Standard",
    status: "active",
    monthly_price_eur: 69,
    billing_cycle: "monthly",
    billing_provider: "stripe",
    stripe_customer_id: null,
    stripe_subscription_id: null,
    stripe_price_id: null,
    last_reminder_at: null,
    next_renewal_date: null,
    ...overrides,
  };
}

test("l'API Abonnés reste admin-only, dynamique et sans cache de données personnelles", () => {
  const route = read("app/api/admin/subscribers/route.ts");
  const getHandler = route.slice(
    route.indexOf("export async function GET"),
    route.indexOf("function requestText"),
  );
  const stripeServer = read("lib/adminSubscriberStripeServer.ts");

  assert.match(route, /const admin = await requireAdminApi\(\)/);
  assert.match(route, /if \(!admin\.ok\) return admin\.response/);
  assert.match(route, /export const dynamic = "force-dynamic"/);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /\.from\("subscriptions"\)/);
  assert.match(route, /\.from\("profiles"\)/);
  assert.doesNotMatch(getHandler, /\.update\(/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(stripeServer, /status: "all"/);
  assert.match(stripeServer, /params\.append\("expand\[\]", "data\.customer"\)/);
  assert.match(stripeServer, /stripe_subscription_list_malformed/);
});

test("le périmètre retient les abonnés actifs et incidents, jamais les simples essais", () => {
  for (const status of ["active", "past_due", "unpaid", "paused"]) {
    assert.equal(isRelevantAdminSubscriber(subscription({ status })), true);
  }

  assert.equal(isRelevantAdminSubscriber(subscription({ plan: "Trial", status: "active" })), false);
  assert.equal(isRelevantAdminSubscriber(subscription({ plan: "Standard", status: "trialing" })), false);
  assert.equal(isRelevantAdminSubscriber(subscription({ status: "incomplete" })), false);
  assert.equal(isRelevantAdminSubscriber(subscription({ status: "canceled" })), false);
});

test("le contrat public expose les colonnes métier et la provenance nécessaire", () => {
  const profile: AdminSubscriberProfileRow = {
    user_id: "manual-1",
    admin_email: "direction@example.com",
    contact_email: "contact@example.com",
    first_name: "Ada",
    last_name: "Martin",
    company_legal_name: "Atelier Martin",
    phone: "+33601020304",
  };
  const row = toAdminSubscriber(
    subscription({
      user_id: "manual-1",
      billing_cycle: "YEARLY",
      billing_provider: null,
      last_reminder_at: "2026-09-01T08:00:00.000Z",
      next_renewal_date: "2027-09-01",
    }),
    profile,
  );

  assert.deepEqual(Object.keys(row), [
    "user_id",
    "name",
    "company_name",
    "email",
    "phone",
    "amount_eur",
    "billing_cycle",
    "payment_status",
    "stored_payment_status",
    "payment_status_source",
    "payment_provider",
    "last_followup_at",
    "next_renewal_date",
    "stripe_subscription_id",
    "reconciliation_status",
    "reconciliation_method",
    "reconciliation_candidate",
  ]);
  assert.equal(row.name, "Ada Martin");
  assert.equal(row.company_name, "Atelier Martin");
  assert.equal(row.email, "direction@example.com");
  assert.equal(row.amount_eur, 69);
  assert.equal(row.billing_cycle, "yearly");
  assert.equal(row.payment_provider, null);
  assert.equal(row.last_followup_at, "2026-09-01T08:00:00.000Z");
});

test("le tri place les incidents et les comptes jamais suivis en tête", () => {
  const rows = [
    toAdminSubscriber(subscription({ user_id: "active", status: "active" }), null),
    toAdminSubscriber(
      subscription({
        user_id: "past-due-followed",
        status: "past_due",
        last_reminder_at: "2026-09-01T08:00:00.000Z",
      }),
      null,
    ),
    toAdminSubscriber(subscription({ user_id: "past-due-new", status: "past_due" }), null),
    toAdminSubscriber(subscription({ user_id: "unpaid", status: "unpaid" }), null),
  ];

  assert.deepEqual(
    sortAdminSubscribers(rows).map((row) => row.user_id),
    ["unpaid", "past-due-new", "past-due-followed", "active"],
  );
});

test("les indicateurs comptent les actifs, les incidents et le revenu mensuel actif", () => {
  const rows = [
    toAdminSubscriber(subscription({ user_id: "active-69", monthly_price_eur: 69 }), null),
    toAdminSubscriber(subscription({ user_id: "active-108", monthly_price_eur: 108 }), null),
    toAdminSubscriber(
      subscription({ user_id: "past-due", status: "past_due", monthly_price_eur: 69 }),
      null,
    ),
    toAdminSubscriber(
      subscription({ user_id: "unpaid", status: "unpaid", monthly_price_eur: 69 }),
      null,
    ),
    toAdminSubscriber(
      subscription({ user_id: "manual", status: "paused", monthly_price_eur: null }),
      null,
    ),
  ];

  assert.deepEqual(summarizeAdminSubscribers(rows), {
    active_count: 2,
    payment_issue_count: 2,
    monthly_revenue_eur: 177,
    unpriced_active_count: 0,
    revenue_complete: true,
  });

  const incomplete = summarizeAdminSubscribers([
    ...rows,
    toAdminSubscriber(subscription({ user_id: "active-unpriced", monthly_price_eur: null }), null),
  ]);
  assert.equal(incomplete.unpriced_active_count, 1);
  assert.equal(incomplete.revenue_complete, false);
});

test("le payload racine publie le listing, les indicateurs et la provenance des dates", () => {
  const route = read("app/api/admin/subscribers/route.ts");

  assert.match(route, /subscribers: sortedSubscribers/);
  assert.match(route, /total: sortedSubscribers\.length/);
  assert.match(route, /active_count/);
  assert.match(route, /payment_issue_count/);
  assert.match(route, /monthly_revenue_eur/);
  assert.match(route, /unpriced_active_count/);
  assert.match(route, /revenue_complete/);
  assert.match(route, /generated_at/);
  assert.match(route, /field_sources/);
  assert.match(route, /stripe_reconciliation/);
  assert.match(route, /unverified_count/);
  assert.match(route, /review_required_count/);
  assert.match(route, /reconciliationCandidate/);
  assert.match(route, /company_name/);
  assert.match(route, /monthly_price_eur: null/);
  assert.match(route, /\.order\("user_id", \{ ascending: true \}\)/);
  assert.match(route, /collectSupabaseKeysetPages/);
  assert.match(route, /\.gt\("user_id", after\)/);
  assert.match(route, /subscriptions\.last_reminder_at/);
  assert.doesNotMatch(route, /last_followup_at:\s*subscription\.updated_at/);
});

test("la confirmation admin revalide la suggestion live et écrit avec CAS", () => {
  const route = read("app/api/admin/subscribers/route.ts");
  const postHandler = route.slice(route.indexOf("export async function POST"));

  assert.match(postHandler, /const admin = await requireAdminApi\(\)/);
  assert.match(postHandler, /matchAdminSubscribersToStripe/);
  assert.match(postHandler, /match\.snapshot\.subscription_id !== stripeSubscriptionId/);
  assert.match(postHandler, /match\.write_safe/);
  assert.match(postHandler, /already_confirmed: true/);
  assert.match(postHandler, /duplicateOwner/);
  assert.match(postHandler, /unexpectedFields/);
  assert.match(postHandler, /\.eq\("updated_at", target\.updated_at\)/);
  assert.match(postHandler, /\.eq\("stripe_subscription_id", target\.stripe_subscription_id\)/);
  assert.match(postHandler, /status: 409/);
});
