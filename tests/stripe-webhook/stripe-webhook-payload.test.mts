import test from "node:test";
import assert from "node:assert/strict";

import {
  consistentStripeWebhookUserId,
  invoiceCustomerEmail,
  invoiceCustomerId,
  invoiceSubscriptionId,
  invoiceUserIdentity,
  invoiceUserId,
  paymentFailureStatus,
  paymentSuccessStatus,
  reconciledStripeSubscriptionStatus,
  resolveStripeWebhookStrongUser,
  subscriptionCancellationReason,
} from "../../lib/stripeWebhookPayload.ts";

test("les identifiants forts webhook doivent converger vers le même compte", () => {
  assert.deepEqual(consistentStripeWebhookUserId(["user-a", "user-a", null]), {
    userId: "user-a",
    conflict: false,
  });
  assert.deepEqual(
    consistentStripeWebhookUserId(["metadata-user", "subscription-owner", "customer-owner"]),
    { userId: null, conflict: true },
  );

  assert.deepEqual(
    resolveStripeWebhookStrongUser({
      metadataUserIds: ["user-a"],
      subscriptionUserIds: ["user-a"],
      customerUserIds: ["user-a", "user-b"],
    }),
    { userId: "user-a", conflict: false, source: "subscription_id" },
  );
  assert.deepEqual(
    resolveStripeWebhookStrongUser({
      metadataUserIds: ["metadata-user"],
      subscriptionUserIds: ["subscription-owner"],
      customerUserIds: [],
    }),
    { userId: null, conflict: true, source: null },
  );
  assert.deepEqual(
    resolveStripeWebhookStrongUser({
      metadataUserIds: [],
      subscriptionUserIds: [],
      customerUserIds: ["user-a", "user-b"],
    }),
    { userId: null, conflict: true, source: null },
  );
});

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
  assert.deepEqual(
    invoiceUserIdentity({
      metadata: { user_id: "invoice-user" },
      parent: {
        subscription_details: { metadata: { user_id: "subscription-user" } },
      },
    }),
    { userId: null, conflict: true },
  );
});

test("un echec passe en past_due sans ressusciter un abonnement termine", () => {
  assert.equal(paymentFailureStatus("active", "past_due"), "past_due");
  assert.equal(paymentFailureStatus("active", "active"), "active");
  assert.equal(paymentFailureStatus("active", "incomplete"), "incomplete");
  assert.equal(paymentFailureStatus("active", null), null);
  assert.equal(paymentFailureStatus("canceled", null), null);
  assert.equal(paymentFailureStatus("past_due", "unpaid"), "unpaid");
});

test("un paiement recupere reactive uniquement un abonnement recuperable", () => {
  assert.equal(paymentSuccessStatus("past_due", "active"), "active");
  assert.equal(paymentSuccessStatus("past_due", null), null);
  assert.equal(paymentSuccessStatus("canceled", "canceled"), "canceled");
  assert.equal(paymentSuccessStatus("past_due", "incomplete"), "incomplete");
  assert.equal(paymentSuccessStatus("trialing", null), null);
});

test("lit la raison d'annulation Stripe", () => {
  assert.equal(subscriptionCancellationReason({ cancellation_details: { reason: "payment_failed" } }), "payment_failed");
});

test("la reconciliation Stripe fonctionne dans les deux sens une fois le lien établi", () => {
  assert.equal(reconciledStripeSubscriptionStatus("past_due", "active"), "active");
  assert.equal(reconciledStripeSubscriptionStatus("unpaid", "active"), "active");
  assert.equal(reconciledStripeSubscriptionStatus("paused", "trialing"), "trialing");
  assert.equal(reconciledStripeSubscriptionStatus("cancelled", "active"), "active");
  assert.equal(reconciledStripeSubscriptionStatus("past_due", "canceled"), "canceled");
  assert.equal(reconciledStripeSubscriptionStatus("active", "past_due"), "past_due");
  assert.equal(reconciledStripeSubscriptionStatus("past_due", "mystery"), null);
  assert.equal(reconciledStripeSubscriptionStatus("past_due", "past_due"), null);
});
