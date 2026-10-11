import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAppUrl, stripeGet, stripePost } from "@/lib/stripeRest";
import { isStripeCheckoutUrl } from "@/lib/boutique/videoCreditPacks";

type Row = Record<string, unknown>;
export type MediaCreditOrder = {
  id: string; account_id: string; actor_auth_user_id: string; pack_key: string;
  amount_ht_cents: number; currency: string; tax_behavior: string;
  status: string; stripe_price_id: string; stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null; stripe_payment_intent_id: string | null;
  stripe_livemode: boolean | null; granted_at: string | null;
  checkout_attempted_at: string | null; checkout_params: string | null;
  created_at: string; refunded_amount_cents: number;
  [field: string]: unknown;
};
type CreditPack = { readonly key: string; readonly priceEurHt: number; readonly priceEnv: string };
type CreditConfig = ({ readonly mediaKind: "video"; readonly unit: "seconds" } | { readonly mediaKind: "image"; readonly unit: "images" })
  & { readonly findPack: (key: unknown) => CreditPack | null };

/** One verified payment flow; its domain is fixed by server-only catalogue configuration. */
export function createMediaCreditPayments(config: CreditConfig) {
  const paymentKind = `inrcy_${config.mediaKind}_credits_v1`;
  const orderTable = `ai_media_${config.mediaKind}_credit_orders`;
  const returnQuery = config.mediaKind === "image" ? "media=image&" : "";
  const errorCode = (suffix: string) => `${config.mediaKind === "video" ? "VIDEO" : "IMAGE"}_CREDITS_${suffix}`;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SAFE_REPLAY_MS = 23 * 60 * 60 * 1000;

  function record(value: unknown): Row {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(errorCode("INVALID_STRIPE_RESPONSE"));
    return value as Row;
  }
  function objectId(value: unknown): string {
    return typeof value === "string" ? value : value && typeof value === "object" ? String((value as Row).id ?? "") : "";
  }
  function cents(value: unknown): number {
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(errorCode("INVALID_AMOUNT"));
    return Number(value);
  }
  function metadata(value: unknown): Row { return record(record(value).metadata ?? {}); }
  function assert(condition: unknown, code = errorCode("PAYMENT_SCOPE_MISMATCH")): asserts condition {
    if (!condition) throw new Error(code);
  }
  async function rpcOrder(name: string, args: Row): Promise<MediaCreditOrder> {
    const result = await supabaseAdmin.rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    const order = Array.isArray(result.data) ? result.data[0] : result.data;
    assert(order?.id, errorCode("ORDER_UNAVAILABLE"));
    return order as MediaCreditOrder;
  }
  async function rpc(name: string, args: Row) {
    const result = await supabaseAdmin.rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  async function getOrder(orderId: string, accountId?: string): Promise<MediaCreditOrder | null> {
    if (!UUID.test(orderId)) return null;
    let query = supabaseAdmin.from(orderTable).select("*").eq("id", orderId);
    if (accountId) query = query.eq("account_id", accountId);
    const result = await query.maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return result.data as MediaCreditOrder | null;
  }

  /** Price, tax and quantity come exclusively from the server catalogue/Stripe. */
  function validatePrice(value: unknown, pack: { readonly priceEurHt: number }, expectedPriceId: string, requireActive = true): Row {
    const price = record(value);
    assert(price.id === expectedPriceId && price.currency === "eur"
      && price.unit_amount === pack.priceEurHt * 100 && price.tax_behavior === "exclusive"
      && price.type === "one_time" && !price.recurring && typeof price.livemode === "boolean"
      && (!requireActive || price.active === true), errorCode("PRICE_CONFIGURATION_INVALID"));
    return price;
  }

  function checkoutScope(session: Row, order: MediaCreditOrder) {
    const hints = metadata(session);
    assert(/^cs_[\w]+$/.test(objectId(session.id)) && session.mode === "payment"
      && session.client_reference_id === order.account_id && hints.kind === paymentKind
      && hints.order_id === order.id && hints.account_id === order.account_id
      && hints.actor_auth_user_id === order.actor_auth_user_id && hints.pack_key === order.pack_key
      && objectId(session.customer) === order.stripe_customer_id && session.livemode === order.stripe_livemode
      && (!order.stripe_checkout_session_id || session.id === order.stripe_checkout_session_id));
  }

  const DISPUTE_ID = /^d[up]_[\w]+$/;
  const DISPUTE_STATUSES = new Set(["warning_needs_response", "warning_under_review", "warning_closed", "needs_response", "under_review", "won", "lost", "prevented"]);
  function disputeSnapshot(value: unknown, order: MediaCreditOrder, charge: Row, intentId: string): Row {
    const dispute = record(value);
    assert(DISPUTE_ID.test(objectId(dispute.id)) && objectId(dispute.charge) === objectId(charge.id)
      && (!dispute.payment_intent || objectId(dispute.payment_intent) === intentId)
      && dispute.livemode === order.stripe_livemode && DISPUTE_STATUSES.has(String(dispute.status))
      && /^[a-z]{3}$/.test(String(dispute.currency)) && cents(dispute.amount) > 0, errorCode("DISPUTE_SCOPE_MISMATCH"));
    return { id: dispute.id, charge_id: charge.id, amount: dispute.amount, currency: dispute.currency, status: dispute.status };
  }
  async function currentDisputes(charge: Row, order: MediaCreditOrder, intentId: string): Promise<Row[]> {
    if (charge.disputed !== true && !((order[`held_${config.unit}`] as number) > 0) && !((order[`dispute_revoked_${config.unit}`] as number) > 0)) return [];
    const list = record(await stripeGet(`/disputes?charge=${encodeURIComponent(objectId(charge.id))}&limit=100`));
    assert(Array.isArray(list.data) && list.has_more === false && (charge.disputed !== true || list.data.length > 0), errorCode("DISPUTE_STATE_UNCERTAIN"));
    return (list.data as unknown[]).map((value) => disputeSnapshot(value, order, charge, intentId));
  }

  async function startCheckout(args: {
    req: Request; accountId: string; actorAuthUserId: string; packKey: unknown; requestKey: string; email: string;
  }) {
    const pack = config.findPack(args.packKey);
    assert(pack, errorCode("UNKNOWN_PACK"));
    const priceId = process.env[pack.priceEnv]?.trim() ?? "";
    assert(/^price_[\w]+$/.test(priceId) && process.env.STRIPE_SECRET_KEY, errorCode("NOT_CONFIGURED"));
    const price = validatePrice(await stripeGet(`/prices/${encodeURIComponent(priceId)}`), pack, priceId);
    let order = await rpcOrder(`create_ai_media_${config.mediaKind}_credit_order`, {
      p_account_id: args.accountId, p_actor_auth_user_id: args.actorAuthUserId,
      p_pack_key: pack.key, p_request_key: args.requestKey, p_stripe_price_id: priceId,
    });
    if (order.granted_at) return { orderId: order.id, completed: true, url: null };

    if (!order.checkout_params) {
      const { data: subscription, error } = await supabaseAdmin.from("subscriptions")
        .select("stripe_customer_id").eq("user_id", args.accountId).maybeSingle();
      if (error) throw new Error(error.message);
      let customerId = String(subscription?.stripe_customer_id ?? "");
      if (customerId) {
        assert(/^cus_[\w]+$/.test(customerId));
        const customer = record(await stripeGet(`/customers/${encodeURIComponent(customerId)}`));
        assert(!customer.deleted && customer.id === customerId);
        const hints = metadata(customer);
        assert(!hints.user_id || hints.user_id === args.accountId, errorCode("CUSTOMER_SCOPE_MISMATCH"));
        // Strong DB link and Stripe metadata must agree; never recover by email.
        const matches = await supabaseAdmin.from("subscriptions").select("user_id")
          .eq("stripe_customer_id", customerId).limit(2);
        if (matches.error) throw new Error(matches.error.message);
        assert(matches.data?.length === 1 && matches.data[0].user_id === args.accountId, errorCode("CUSTOMER_SCOPE_MISMATCH"));
      } else {
        const params = new URLSearchParams({ email: args.email, "metadata[user_id]": args.accountId });
        const customer = record(await stripePost("/customers", params, { idempotencyKey: `${config.mediaKind}-credit-customer-v1-${args.accountId}` }));
        customerId = objectId(customer.id);
        assert(/^cus_[\w]+$/.test(customerId) && metadata(customer).user_id === args.accountId);
      }
      const appUrl = getAppUrl(args.req);
      const params = new URLSearchParams({
        mode: "payment", customer: customerId, "line_items[0][price]": priceId, "line_items[0][quantity]": "1",
        client_reference_id: args.accountId, "automatic_tax[enabled]": "true",
        billing_address_collection: "required", "tax_id_collection[enabled]": "true",
        "customer_update[address]": "auto", "customer_update[name]": "auto", "invoice_creation[enabled]": "true",
        success_url: `${appUrl}/dashboard/boutique/recharges?${returnQuery}checkout=success&order=${order.id}`,
        cancel_url: `${appUrl}/dashboard/boutique/recharges?${returnQuery}checkout=cancel&order=${order.id}`,
      });
      const hints: Record<string, string> = { kind: paymentKind, order_id: order.id,
        account_id: args.accountId, actor_auth_user_id: args.actorAuthUserId, pack_key: pack.key };
      for (const [key, value] of Object.entries(hints)) {
        params.set(`metadata[${key}]`, value);
        params.set(`payment_intent_data[metadata][${key}]`, value);
        params.set(`invoice_creation[invoice_data][metadata][${key}]`, value);
      }
      order = await rpcOrder(`prepare_ai_media_${config.mediaKind}_credit_checkout`, {
        p_order_id: order.id, p_account_id: order.account_id, p_params: params.toString(),
        p_customer_id: customerId, p_livemode: price.livemode,
      });
    }
    assert(order.checkout_params && order.checkout_attempted_at, errorCode("CHECKOUT_STATE_UNCERTAIN"));
    let session: Row;
    if (order.stripe_checkout_session_id) {
      session = record(await stripeGet(`/checkout/sessions/${encodeURIComponent(order.stripe_checkout_session_id)}`));
    } else {
      // The original exact parameters survive retries. After Stripe's idempotency
      // retention window, an uncertain POST is fenced for manual reconciliation.
      assert(Date.now() - Date.parse(order.checkout_attempted_at) < SAFE_REPLAY_MS, errorCode("CHECKOUT_RECONCILIATION_REQUIRED"));
      session = record(await stripePost("/checkout/sessions", new URLSearchParams(order.checkout_params), {
        idempotencyKey: `${config.mediaKind}-credit-checkout-v1-${order.id}`,
      }));
    }
    checkoutScope(session, order);
    assert(["open", "complete", "expired"].includes(String(session.status)));
    const binding = await supabaseAdmin.from(orderTable)
      .update({ stripe_checkout_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", order.id).is("stripe_checkout_session_id", null);
    if (binding.error) throw new Error(binding.error.message);
    const stored = await getOrder(order.id, order.account_id);
    assert(stored?.stripe_checkout_session_id === session.id);
    if (session.status === "complete") {
      const paid = await fulfillCheckout(objectId(session.id), "checkout-return");
      const current = await getOrder(order.id, order.account_id);
      return { orderId: order.id, completed: paid, pending: !paid && current?.status !== "failed", failed: !paid && current?.status === "failed", url: null };
    }
    if (session.status === "expired") {
      const expired = await supabaseAdmin.from(orderTable)
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .eq("id", order.id).is("granted_at", null);
      if (expired.error) throw new Error(expired.error.message);
      return { orderId: order.id, completed: false, expired: true, url: null };
    }
    assert(isStripeCheckoutUrl(session.url), errorCode("INVALID_CHECKOUT_URL"));
    return { orderId: order.id, completed: false, url: session.url };
  }

  /** Shared by signed webhooks and authenticated returns. Browser success alone never grants credit. */
  async function fulfillCheckout(sessionId: string, eventId: string): Promise<boolean> {
    assert(/^cs_[\w]+$/.test(sessionId));
    const session = record(await stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`));
    const hints = metadata(session);
    if (hints.kind !== paymentKind) return false;
    const order = await getOrder(String(hints.order_id ?? ""));
    assert(order, errorCode("ORDER_NOT_FOUND"));
    checkoutScope(session, order);
    if (session.payment_status !== "paid" || session.status !== "complete") {
      let terminal: "expired" | "failed" | null = session.status === "expired" ? "expired" : null;
      // A completed unpaid session may be an asynchronous payment still in
      // progress. Release the browser intent only after Stripe proves failure.
      if (session.status === "complete" && session.payment_status === "unpaid" && /^pi_[\w]+$/.test(objectId(session.payment_intent))) {
        const intent = record(await stripeGet(`/payment_intents/${encodeURIComponent(objectId(session.payment_intent))}`));
        const intentHints = metadata(intent);
        assert(intent.id === objectId(session.payment_intent) && objectId(intent.customer) === order.stripe_customer_id
          && intent.livemode === order.stripe_livemode && intentHints.kind === paymentKind
          && intentHints.order_id === order.id && intentHints.account_id === order.account_id);
        if (intent.status === "canceled" || (intent.status === "requires_payment_method" && intent.last_payment_error)) terminal = "failed";
      }
      if (terminal) {
        const update = await supabaseAdmin.from(orderTable)
          .update({ status: terminal, updated_at: new Date().toISOString() }).eq("id", order.id).is("granted_at", null);
        if (update.error) throw new Error(update.error.message);
      }
      return false;
    }
    const pack = config.findPack(order.pack_key);
    assert(pack && Number.isSafeInteger(order[config.unit] as number) && (order[config.unit] as number) > 0
      && Number.isSafeInteger(order.amount_ht_cents) && order.amount_ht_cents > 0);
    assert(session.currency === "eur" && cents(session.amount_subtotal) === order.amount_ht_cents
      && cents(session.amount_total) >= order.amount_ht_cents && record(session.total_details).amount_discount === 0
      && record(session.automatic_tax).enabled === true && record(session.automatic_tax).status === "complete");
    const lineItems = record(await stripeGet(`/checkout/sessions/${sessionId}/line_items?limit=100`));
    assert(lineItems.has_more === false && Array.isArray(lineItems.data) && lineItems.data.length === 1);
    const item = record((lineItems.data as unknown[])[0]);
    assert(item.quantity === 1);
    // Existing paid orders retain their price snapshot when a later catalogue
    // update changes the amount of the same pack.
    validatePrice(item.price, { ...pack, priceEurHt: order.amount_ht_cents / 100 }, order.stripe_price_id, false);
    const intentId = objectId(session.payment_intent);
    assert(/^pi_[\w]+$/.test(intentId));
    const intent = record(await stripeGet(`/payment_intents/${intentId}?expand%5B%5D=latest_charge`));
    const intentHints = metadata(intent);
    assert(intent.id === intentId && intent.status === "succeeded" && intent.currency === "eur"
      && intent.amount_received === session.amount_total && objectId(intent.customer) === order.stripe_customer_id
      && intent.livemode === order.stripe_livemode && intentHints.kind === paymentKind
      && intentHints.order_id === order.id && intentHints.account_id === order.account_id);
    const charge = record(intent.latest_charge);
    assert(/^ch_[\w]+$/.test(objectId(charge.id)) && objectId(charge.payment_intent) === intentId && charge.paid === true && charge.currency === "eur"
      && charge.amount === session.amount_total && charge.livemode === order.stripe_livemode);
    const refunded = cents(charge.amount_refunded);
    assert(refunded <= cents(session.amount_total));
    const disputes = await currentDisputes(charge, order, intentId);
    await rpc(`fulfill_ai_media_${config.mediaKind}_credit_order`, {
      p_order_id: order.id, p_account_id: order.account_id, p_checkout_session_id: sessionId,
      p_payment_intent_id: intentId, p_customer_id: order.stripe_customer_id, p_livemode: order.stripe_livemode,
      p_amount_subtotal_cents: session.amount_subtotal, p_amount_total_cents: session.amount_total,
      p_currency: session.currency, p_stripe_event_id: eventId, p_refunded_amount_cents: refunded,
      p_disputes: disputes,
    });
    return true;
  }

  /** Dispute events are only hints: current Stripe objects determine the effect. */
  async function reconcileDispute(disputeId: string, eventId: string): Promise<boolean> {
    assert(DISPUTE_ID.test(disputeId));
    const dispute = record(await stripeGet(`/disputes/${encodeURIComponent(disputeId)}`));
    assert(dispute.id === disputeId);
    const chargeId = objectId(dispute.charge);
    assert(/^ch_[\w]+$/.test(chargeId));
    const charge = record(await stripeGet(`/charges/${chargeId}`));
    const intentId = objectId(charge.payment_intent);
    assert(/^pi_[\w]+$/.test(intentId));
    const intent = record(await stripeGet(`/payment_intents/${encodeURIComponent(intentId)}`));
    const hints = metadata(intent);
    if (hints.kind !== paymentKind) return false;
    const order = await getOrder(String(hints.order_id ?? ""));
    assert(order && hints.account_id === order.account_id && intent.id === intentId && intent.status === "succeeded"
      && objectId(intent.customer) === order.stripe_customer_id && intent.livemode === order.stripe_livemode
      && charge.id === chargeId && charge.currency === order.currency && charge.livemode === order.stripe_livemode
      && charge.paid === true && cents(charge.amount) === cents(intent.amount_received)
      && cents(charge.amount) >= order.amount_ht_cents, errorCode("DISPUTE_SCOPE_MISMATCH"));
    const snapshot = disputeSnapshot(dispute, order, charge, intentId);
    await rpc(`reconcile_ai_media_${config.mediaKind}_credit_dispute`, {
      p_order_id: order.id, p_account_id: order.account_id, p_payment_intent_id: intentId,
      p_dispute_id: snapshot.id, p_charge_id: chargeId, p_amount_cents: snapshot.amount,
      p_charge_amount_cents: charge.amount, p_currency: snapshot.currency, p_status: snapshot.status, p_stripe_event_id: eventId,
    });
    return true;
  }

  async function reconcileRefund(chargeId: string, eventId: string): Promise<boolean> {
    assert(/^ch_[\w]+$/.test(chargeId));
    const charge = record(await stripeGet(`/charges/${chargeId}`));
    const intentId = objectId(charge.payment_intent);
    if (!intentId) return false;
    const intent = record(await stripeGet(`/payment_intents/${encodeURIComponent(intentId)}`));
    const hints = metadata(intent);
    if (hints.kind !== paymentKind) return false;
    const order = await getOrder(String(hints.order_id ?? ""));
    assert(order && hints.account_id === order.account_id && order.stripe_customer_id === objectId(intent.customer)
      && order.stripe_livemode === charge.livemode && charge.id === chargeId && charge.currency === "eur"
      && charge.amount === intent.amount_received && objectId(intent.id) === intentId);
    await rpc(`refund_ai_media_${config.mediaKind}_credit_order`, {
      p_order_id: order.id, p_payment_intent_id: intentId,
      p_refunded_amount_cents: cents(charge.amount_refunded), p_stripe_event_id: eventId,
    });
    return true;
  }

  return { getOrder, validatePrice, startCheckout, fulfillCheckout, reconcileDispute, reconcileRefund };
}
