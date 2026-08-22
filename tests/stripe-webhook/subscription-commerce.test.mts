import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PREMIUM_SUBSCRIPTION_OFFER,
  STANDARD_SUBSCRIPTION_OFFER,
} from "../../lib/subscriptionOffers.ts";
import {
  stripeSubscriptionPeriodEndIso,
  stripeSubscriptionPeriodEndUnix,
} from "../../lib/stripeSubscription.ts";
import {
  addStripeBillingIntervalUnix,
  stripeCancellationSchedule,
} from "../../lib/subscriptionCancellation.ts";

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, new URL("../../", import.meta.url)), "utf8");

test("les offres commerciales publiques gardent les quatre montants valides", () => {
  assert.deepEqual(STANDARD_SUBSCRIPTION_OFFER, {
    edition: "standard",
    plan: "Standard",
    monthlyPriceEur: 69,
    yearlyPriceEur: 730,
    annualSavingPercent: 12,
  });
  assert.deepEqual(PREMIUM_SUBSCRIPTION_OFFER, {
    edition: "premium",
    plan: "Premium",
    monthlyPriceEur: 129,
    yearlyPriceEur: 1390,
    annualSavingPercent: 10,
  });

  assert.ok(1 - 730 / (69 * 12) > 0.118);
  assert.ok(1 - 1390 / (129 * 12) > 0.10);
});

test("la date de renouvellement Stripe Basil vient des postes d'abonnement", () => {
  const basil = {
    current_period_end: null,
    items: {
      data: [
        { current_period_end: 1_786_294_800 },
        { current_period_end: 1_786_294_700 },
      ],
    },
  };
  assert.equal(stripeSubscriptionPeriodEndUnix(basil), 1_786_294_800);
  assert.equal(
    stripeSubscriptionPeriodEndIso(basil),
    new Date(1_786_294_800 * 1000).toISOString(),
  );
  assert.equal(
    stripeSubscriptionPeriodEndUnix({ current_period_end: 1_700_000_000 }),
    1_700_000_000,
  );
});

test("le mensuel conserve exactement un renouvellement complet après la demande", () => {
  const currentPeriodEnd = Date.UTC(2026, 7, 15, 10, 0, 0) / 1000;
  const monthlySubscription = {
    items: {
      data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }],
    },
  };
  const schedule = stripeCancellationSchedule(monthlySubscription, currentPeriodEnd);
  assert.deepEqual(schedule, {
    mode: "custom",
    cancelAtUnix: Date.UTC(2026, 8, 15, 10, 0, 0) / 1000,
  });

  assert.equal(
    addStripeBillingIntervalUnix(Date.UTC(2027, 0, 31, 10, 0, 0) / 1000, {
      interval: "month",
      intervalCount: 1,
    }),
    Date.UTC(2027, 1, 28, 10, 0, 0) / 1000,
  );
});

test("l'annuel s'arrête à l'échéance sans préavis ni nouvelle année", () => {
  const currentPeriodEnd = Date.UTC(2027, 7, 15, 10, 0, 0) / 1000;
  const annualSubscription = {
    items: {
      data: [{ price: { recurring: { interval: "year", interval_count: 1 } } }],
    },
  };
  assert.deepEqual(stripeCancellationSchedule(annualSubscription, currentPeriodEnd), {
    mode: "period_end",
    cancelAtUnix: currentPeriodEnd,
  });
});

test("un essai s'arrête sans prélèvement avant toute règle de préavis", () => {
  const trialEnd = Date.UTC(2026, 8, 1, 10, 0, 0) / 1000;
  const trialingMonthlySubscription = {
    status: "trialing",
    items: {
      data: [{ price: { recurring: { interval: "month", interval_count: 1 } } }],
    },
  };
  assert.deepEqual(
    stripeCancellationSchedule(trialingMonthlySubscription, trialEnd),
    { mode: "trial_end", cancelAtUnix: trialEnd },
  );
});

test("le Checkout reste Standard en libre-service et Premium reste accompagné", () => {
  const checkout = source("app/api/billing/checkout/route.ts");
  const managedSubscriptionUi = source(
    "app/dashboard/settings/_components/AbonnementContent.tsx",
  );
  assert.match(checkout, /configuredStandardPriceId\("monthly"\)/);
  assert.match(checkout, /configuredStandardPriceId\("yearly"\)/);
  assert.match(checkout, /PREMIUM_CONTACT_REQUIRED/);
  assert.match(checkout, /automatic_tax\[enabled\]/);
  assert.match(checkout, /tax_id_collection\[enabled\]/);
  assert.match(checkout, /findLiveStripeSubscription/);
  assert.match(checkout, /checkoutAttemptBucket/);
  assert.match(checkout, /15 \* 60 \* 1000/);
  assert.match(checkout, /sessionParams\.set\("client_reference_id", userId\)/);
  assert.match(managedSubscriptionUi, /i18nT\("les_forfaits_premium_et_founder_sont_374bb1ec"\)/);
  assert.doesNotMatch(managedSubscriptionUi, /CHECKOUT_OFFERS/);
});

test("le webhook est idempotent, compatible Basil et ne rétrograde jamais Founder", () => {
  const webhook = source("app/api/stripe/webhook/route.ts");
  assert.match(webhook, /claimStripeWebhookEvent/);
  assert.match(webhook, /completeStripeWebhookEvent/);
  assert.match(webhook, /failStripeWebhookEvent/);
  assert.match(webhook, /stripeSubscriptionPeriodEndIso\(sub\)/);
  assert.match(webhook, /const founderAccount = existingEdition === "founder"/);
  assert.match(webhook, /commercialPrice && !founderAccount/);
  assert.match(webhook, /const cancellationScheduled = cancelAtPeriodEnd \|\| Boolean\(cancelAt\)/);
  assert.match(webhook, /billing_cycle: billingCycle/);
  assert.match(webhook, /session\?\.client_reference_id/);
  assert.match(webhook, /metadataUserId \|\| clientReferenceId/);
});

test("la résiliation et sa réactivation couvrent les deux cadences commerciales", () => {
  const cancelRoute = source("app/api/billing/cancel/route.ts");
  const uncancelRoute = source("app/api/billing/uncancel/route.ts");
  const cancellationService = source("lib/scheduleSubscriptionCancellation.ts");
  assert.match(cancelRoute, /scheduleSubscriptionCancellationForUser/);
  assert.match(uncancelRoute, /restoreSubscriptionRenewalForUser/);
  assert.match(cancellationService, /stripeCancellationSchedule/);
  assert.match(cancellationService, /one_additional_monthly_renewal/);
  assert.match(cancellationService, /current_annual_period_end/);
  assert.match(cancellationService, /trial_end_without_charge/);
  assert.match(cancellationService, /proration_behavior", "none"/);
  assert.match(cancellationService, /cancel_at: ""/);
  assert.match(cancellationService, /cancel_at_period_end: "false"/);
});

test("les relances et le blocage d'essai restent pilotés côté serveur", () => {
  const cron = source("app/api/cron/billing/route.ts");
  const gate = source("proxy.ts");
  const trialExpiry = cron.slice(
    cron.indexOf("const { data: maybeExpired"),
    cron.indexOf("// Filet de sécurité quotidien"),
  );
  assert.match(cron, /TRIAL_REMINDER_OFFSETS/);
  assert.match(cron, /dueReminderOffset/);
  assert.match(cron, /status: "trial_expired"/);
  assert.match(cron, /stripeSubscriptionPeriodEndUnix\(stripeSubscription\)/);
  assert.match(cron, /repaired_renewal_dates: repairedRenewalDates/);
  assert.match(cron, /repaired_billing_cycles: repairedBillingCycles/);
  assert.match(cron, /reconciled_cancelled_accesses: reconciledCancelledAccesses/);
  assert.doesNotMatch(trialExpiry, /deleteUserAccountEverywhere/);
  assert.match(cron, /account_deletion_requests/);
  assert.match(cron, /deleteUserAccountEverywhere\(deletion\.user_id\)/);
  assert.match(gate, /status === "active" \|\| isTrialStillValid\(subscription\)/);
  assert.match(gate, /url\.pathname = "\/compte-bloque"/);
});

test("une panne SMTP ne coupe plus les expirations et réconciliations du cron", () => {
  const cron = source("app/api/cron/billing/route.ts");
  assert.match(cron, /async function deliverReminderSafely/);
  assert.match(cron, /catch \(error\) \{/);
  assert.match(cron, /captureApiException\(req, error/);
  assert.match(cron, /if \(!delivered\) continue;/);
  assert.match(cron, /mail_failures: mailFailures/);
  assert.match(cron, /degraded: mailFailures > 0/);
  assert.match(cron, /expired_trial_accounts: expiredTrialAccounts/);
  assert.match(cron, /reconciled_cancelled_accesses: reconciledCancelledAccesses/);
});

test("la migration reste atomique et conserve la colonne texte existante", () => {
  const migration = source(
    "ops/sql/2026-08-10_standard_premium_founder_and_stripe_webhook.sql",
  );
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/m);
  assert.match(migration, /set app_edition = 'founder'/);
  assert.match(
    migration,
    /check \(app_edition in \('standard', 'premium', 'founder'\)\)/,
  );
  assert.doesNotMatch(migration, /alter column app_edition type/i);
  assert.match(migration, /create table if not exists public\.stripe_webhook_events/);
  assert.match(migration, /add column if not exists billing_cycle text/);
  assert.match(migration, /billing_cycle in \('monthly', 'yearly'\)/);
  assert.match(migration, /testinrcy@gmail\.com/);
});
