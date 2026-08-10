import test from "node:test";
import assert from "node:assert/strict";

import {
  invoiceCustomerEmail,
  invoiceCustomerId,
  invoiceSubscriptionId,
  invoiceUserId,
  paymentFailureStatus,
  paymentSuccessStatus,
  subscriptionCancellationReason,
} from "../../lib/stripeWebhookPayload.ts";

test("retrouve l'abonnement avec l'ancien champ invoice.subscription", () => {
  assert.equal(invoiceSubscriptionId({ subscription: "sub_legacy" }), "sub_legacy");
});

test("retrouve l'abonnement avec le champ Stripe actuel parent.subscription_details.subscription", () => {
  assert.equal(
    invoiceSubscriptionId({
      parent: {
        type: "subscription_details",
        subscription_details: { subscription: "sub_current" },
      },
    }),
    "sub_current"
  );
});

test("accepte les objets Stripe developpes", () => {
  assert.equal(invoiceSubscriptionId({ subscription: { id: "sub_expanded" } }), "sub_expanded");
  assert.equal(invoiceCustomerId({ customer: { id: "cus_expanded", email: "client@example.com" } }), "cus_expanded");
  assert.equal(invoiceCustomerEmail({ customer: { id: "cus_expanded", email: "client@example.com" } }), "client@example.com");
});

test("retrouve le user_id dans les metadonnees de facture ou d'abonnement", () => {
  assert.equal(invoiceUserId({ metadata: { user_id: "user_invoice" } }), "user_invoice");
  assert.equal(
    invoiceUserId({ parent: { subscription_details: { metadata: { user_id: "user_subscription" } } } }),
    "user_subscription"
  );
});

test("un echec passe en past_due sans ressusciter un abonnement termine", () => {
  assert.equal(paymentFailureStatus("active", "past_due"), "past_due");
  assert.equal(paymentFailureStatus("active", null), "past_due");
  assert.equal(paymentFailureStatus("canceled", null), "canceled");
  assert.equal(paymentFailureStatus("past_due", "unpaid"), "unpaid");
});

test("un paiement recupere reactive uniquement un abonnement recuperable", () => {
  assert.equal(paymentSuccessStatus("past_due", "active"), "active");
  assert.equal(paymentSuccessStatus("past_due", null), "active");
  assert.equal(paymentSuccessStatus("canceled", "canceled"), null);
  assert.equal(paymentSuccessStatus("past_due", "incomplete"), null);
  assert.equal(paymentSuccessStatus("trialing", null), null);
});

test("lit la raison d'annulation Stripe", () => {
  assert.equal(subscriptionCancellationReason({ cancellation_details: { reason: "payment_failed" } }), "payment_failed");
});
