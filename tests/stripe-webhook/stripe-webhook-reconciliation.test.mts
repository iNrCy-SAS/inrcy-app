import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  stripeWebhookNeedsReconciliation,
  stripeWebhookReconciliationLastError,
} from "../../lib/stripeWebhookReconciliation.ts";

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, new URL("../../", import.meta.url)), "utf8");

test("les événements de paiement sans abonnement local restent à rapprocher", () => {
  for (const eventType of [
    "checkout.session.completed",
    "customer.subscription.created",
    "invoice.paid",
    "invoice.payment_succeeded",
  ]) {
    assert.equal(stripeWebhookNeedsReconciliation(eventType, false), true);
    assert.equal(stripeWebhookNeedsReconciliation(eventType, true), false);
  }

  for (const eventType of [
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.payment_failed",
    "payment_intent.succeeded",
  ]) {
    assert.equal(stripeWebhookNeedsReconciliation(eventType, false), false);
  }
});

test("le motif durable est stable et ne contient aucune donnée client", () => {
  assert.equal(
    stripeWebhookReconciliationLastError("local_subscription_not_found"),
    "stripe_webhook_reconciliation_required:local_subscription_not_found",
  );
});

test("le webhook acquitte Stripe sans clore un paiement non rapproché", () => {
  const webhook = source("app/api/stripe/webhook/route.ts");
  const reconciliationBranch = webhook.slice(
    webhook.indexOf("if (reconciliationReason)"),
    webhook.indexOf("await completeStripeWebhookEvent(evt);", webhook.indexOf("if (reconciliationReason)")),
  );

  assert.match(webhook, /status: "needs_reconciliation"/);
  assert.match(webhook, /completed_at: null/);
  assert.match(webhook, /stripeWebhookNeedsReconciliation\(evt\.type, false\)/);
  assert.match(
    webhook,
    /if \(!existing \|\| existing\.status === "completed"\) return "duplicate";/,
  );
  assert.match(
    webhook,
    /status: "processing" \| "completed" \| "failed" \| "needs_reconciliation"/,
  );
  assert.match(reconciliationBranch, /markStripeWebhookNeedsReconciliation/);
  assert.match(reconciliationBranch, /NextResponse\.json\(\{ received: true, reconciliation: "required" \}\)/);
  assert.doesNotMatch(reconciliationBranch, /sendAdminSubscriptionAlertForUser/);
});

test("la migration autorise le statut de rapprochement sans relâcher la table", () => {
  const migration = source(
    "ops/sql/2026-09-18_stripe_webhook_reconciliation_status.sql",
  );

  assert.match(migration, /^begin;/m);
  assert.match(migration, /drop constraint if exists stripe_webhook_events_status_check/i);
  assert.match(migration, /'needs_reconciliation'/);
  assert.match(migration, /validate constraint stripe_webhook_events_status_check/i);
  assert.match(migration, /commit;\s*$/m);
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete|all)/i);
});
