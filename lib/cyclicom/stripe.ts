import "server-only";

import { requireEnv } from "@/lib/env";
import { stripeGet, stripePost } from "@/lib/stripeRest";
import { CYCLICOM_TERMS_VERSION, getCyclicomInstallments, getCyclicomOffer } from "./offer";

const API_VERSION = "2026-11-18.endive";
const ORDER_KIND = "cyclicom_website";
const LIVE_LOGO_URL = "https://app.inrcy.com/cyclicom-logo.png";
const SANDBOX_LOGO_URL = "https://cyclicom.fr/wp-content/themes/cyclicom/assets/brand/logo-cyclicom.svg";
const CHECKOUT_PAID = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);
const RISK_EVENTS = new Set(["charge.refunded", "charge.dispute.created", "radar.early_fraud_warning.created"]);

type StripeRecord = {
  id?: string;
  object?: string;
  metadata?: Record<string, string>;
  status?: string;
  active?: boolean;
  livemode?: boolean;
  mode?: string;
  type?: string;
  currency?: string;
  tax_behavior?: string;
  payment_status?: string;
  amount_subtotal?: number;
  amount_total?: number;
  amount_received?: number;
  amount?: number;
  created?: number;
  paid?: boolean;
  refunded?: boolean;
  disputed?: boolean;
  amount_refunded?: number;
  charge?: string;
  url?: string;
  unit_amount?: number;
  product?: string;
  customer?: string;
  payment_intent?: string | StripeRecord;
  payment_method?: string | StripeRecord;
  latest_charge?: string | StripeRecord;
  parent?: { subscription_details?: { metadata?: Record<string, string> } };
};

type StripeEvent = { id: string; type: string; data: { object: unknown } };
type Offer = NonNullable<ReturnType<typeof getCyclicomOffer>>;

function get<T>(path: string): Promise<T> {
  return stripeGet(path, { apiVersion: API_VERSION }) as Promise<T>;
}

function post(path: string, params: URLSearchParams, key: string): Promise<StripeRecord> {
  return stripePost(path, params, { apiVersion: API_VERSION, idempotencyKey: key }) as Promise<StripeRecord>;
}

function resource(path: string, id: string) {
  return `/${path}/${encodeURIComponent(id)}`;
}

function setMetadata(params: URLSearchParams, field: string, metadata: Record<string, string>) {
  for (const [key, value] of Object.entries(metadata)) params.set(`${field}[${key}]`, value);
}

function isCyclicomAttempt(value: string | undefined): value is string {
  return Boolean(value && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value));
}

function formatEuros(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

async function getOfferPrice(offer: Offer, live: boolean) {
  const id = live ? offer.livePriceId : requireEnv(offer.sandboxPriceEnv);
  const price = await get<StripeRecord>(resource("prices", id));
  if (!price.active || price.livemode !== live || price.type !== "one_time" || price.currency !== "eur" ||
      price.unit_amount !== offer.totalCents || price.tax_behavior !== "exclusive" || !price.product?.startsWith("prod_")) {
    throw new Error("Cyclicom Stripe catalog price does not match the website offer");
  }
  return { id, product: price.product };
}

export async function createCyclicomCheckout(input: { offer: Offer; count: number; attempt: string; origin: string }) {
  const { offer, count, attempt, origin } = input;
  const installments = getCyclicomInstallments(offer, count);
  if (!installments || !isCyclicomAttempt(attempt)) throw new Error("Invalid Cyclicom checkout selection");
  const live = /^(sk|rk)_live_/.test(requireEnv("STRIPE_SECRET_KEY"));
  const price = await getOfferPrice(offer, live);
  const paymentPath = `${origin}/cyclicom/paiement/${offer.slug}`;
  const metadata = {
    kind: ORDER_KIND,
    cyclicom_attempt: attempt,
    cyclicom_offer: offer.slug,
    cyclicom_count: String(count),
    cyclicom_terms: CYCLICOM_TERMS_VERSION,
    cyclicom_installments_ht: installments.join(","),
  };
  const params = new URLSearchParams({
    mode: "payment",
    customer_creation: "always",
    locale: "fr",
    billing_address_collection: "required",
    "tax_id_collection[enabled]": "true",
    "automatic_tax[enabled]": "true",
    "adaptive_pricing[enabled]": "false",
    "invoice_creation[enabled]": "true",
    "allowed_payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "branding_settings[display_name]": "Cyclicom",
    "branding_settings[logo][type]": "url",
    "branding_settings[logo][url]": live ? LIVE_LOGO_URL : SANDBOX_LOGO_URL,
    "branding_settings[button_color]": "#a12b58",
    "branding_settings[background_color]": "#fff7ef",
    "custom_text[submit][message]": count === 1
      ? `Paiement unique du pack Cyclicom, ${formatEuros(offer.totalCents)} HT. La TVA applicable est affichée avant validation.`
      : `En validant, vous autorisez le paiement de ${formatEuros(installments[0])} HT aujourd’hui, puis ${count - 1} versement${count === 3 ? "s" : ""} mensuel${count === 3 ? "s" : ""} de ${formatEuros(installments[1])} HT sur le même moyen de paiement, TVA applicable en sus. Aucun débit après le dernier versement.`,
    integration_identifier: "cyclicom-sites-jmqdhtvl",
    success_url: `${paymentPath}?paiement=recu&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${paymentPath}?paiement=annule`,
  });
  setMetadata(params, "metadata", metadata);
  setMetadata(params, "payment_intent_data[metadata]", metadata);
  setMetadata(params, "invoice_creation[invoice_data][metadata]", metadata);

  if (count === 1) {
    params.set("line_items[0][price]", price.id);
  } else {
    params.set("wallet_options[link][display]", "never");
    params.set("payment_intent_data[setup_future_usage]", "off_session");
    params.set("line_items[0][price_data][currency]", "eur");
    params.set("line_items[0][price_data][product]", price.product);
    params.set("line_items[0][price_data][unit_amount]", String(installments[0]));
    params.set("line_items[0][price_data][tax_behavior]", "exclusive");
  }

  const session = await post("/checkout/sessions", params, `cyclicom-checkout-${attempt}`);
  if (!session.url || new URL(session.url).origin !== "https://checkout.stripe.com") {
    throw new Error("Cyclicom checkout did not return a Stripe URL");
  }
  return session.url;
}

function nextMonth(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return Math.floor(date.getTime() / 1000);
}

async function listOrderSchedules(customer: string, attempt: string) {
  const initial = new URLSearchParams({ customer, limit: "100" });
  const matched: StripeRecord[] = [];
  let hasMore = true;
  while (hasMore) {
    const page = await get<{ data: StripeRecord[]; has_more: boolean }>(`/subscription_schedules?${initial}`);
    matched.push(...page.data.filter((row) => row.metadata?.kind === ORDER_KIND && row.metadata.cyclicom_attempt === attempt));
    hasMore = page.has_more;
    if (hasMore) {
      const last = page.data.at(-1)?.id;
      if (!last) throw new Error("Stripe did not return a subscription schedule cursor");
      initial.set("starting_after", last);
    }
  }
  return matched;
}

async function cancelOrderSchedules(schedules: StripeRecord[]) {
  for (const schedule of schedules) {
    if (schedule.id && (schedule.status === "not_started" || schedule.status === "active")) {
      await post(
        resource("subscription_schedules", schedule.id) + "/cancel",
        new URLSearchParams({ invoice_now: "false", prorate: "false" }),
        `cyclicom-cancel-${schedule.id}`,
      );
    }
  }
}

async function createRemainingSchedule(object: StripeRecord) {
  if (object.payment_status !== "paid" || !object.id) return;
  const sessionParams = new URLSearchParams();
  sessionParams.append("expand[]", "payment_intent.latest_charge");
  sessionParams.append("expand[]", "payment_intent.payment_method");
  const session = await get<StripeRecord>(`${resource("checkout/sessions", object.id)}?${sessionParams}`);
  const meta = session.metadata;
  const attempt = meta?.cyclicom_attempt;
  const offer = getCyclicomOffer(meta?.cyclicom_offer ?? "");
  const count = Number(meta?.cyclicom_count);
  const installments = offer && getCyclicomInstallments(offer, count);
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : undefined;
  const charge = typeof intent?.latest_charge === "object" ? intent.latest_charge : undefined;
  const method = typeof intent?.payment_method === "object" ? intent.payment_method : undefined;
  if (meta?.kind !== ORDER_KIND || meta.cyclicom_terms !== CYCLICOM_TERMS_VERSION ||
      !isCyclicomAttempt(attempt) || !offer || !installments || meta.cyclicom_installments_ht !== installments.join(",") ||
      session.mode !== "payment" || session.payment_status !== "paid" || session.currency !== "eur" ||
      session.amount_subtotal !== installments[0] || !session.customer || !session.amount_total ||
      intent?.status !== "succeeded" || intent.customer !== session.customer || intent.currency !== "eur" ||
      intent.amount_received !== session.amount_total || intent.metadata?.cyclicom_attempt !== attempt ||
      !charge?.id || !charge.paid) {
    throw new Error("The paid Cyclicom Checkout session does not match the agreed order");
  }
  if (count === 1) return;
  if (!method?.id || method.customer !== session.customer || method.type !== "card" || !charge.created) {
    throw new Error("Cyclicom cannot schedule installments without a verified saved card");
  }

  const [existing, currentCustomer] = await Promise.all([
    listOrderSchedules(session.customer, attempt),
    get<StripeRecord>(resource("customers", session.customer)),
  ]);
  if (charge.refunded || charge.disputed || currentCustomer.metadata?.cyclicom_hold === attempt) {
    await cancelOrderSchedules(existing);
    return;
  }
  if (existing.length) return;

  const startDate = nextMonth(charge.created);
  if (startDate <= Math.floor(Date.now() / 1000)) {
    throw new Error("Cyclicom installment start date has already passed");
  }
  const price = await getOfferPrice(offer, session.livemode === true);
  const orderMeta = { ...meta, cyclicom_checkout: object.id };
  const customerParams = new URLSearchParams();
  setMetadata(customerParams, "metadata", { kind: ORDER_KIND, cyclicom_attempt: attempt });
  await post(resource("customers", session.customer), customerParams, `cyclicom-customer-${attempt}`);

  const params = new URLSearchParams({
    customer: session.customer,
    start_date: String(startDate),
    end_behavior: "cancel",
    "default_settings[default_payment_method]": method.id,
    "default_settings[collection_method]": "charge_automatically",
    "default_settings[automatic_tax][enabled]": "true",
    "phases[0][duration][interval]": "month",
    "phases[0][duration][interval_count]": String(count - 1),
    "phases[0][proration_behavior]": "none",
    "phases[0][items][0][quantity]": "1",
    "phases[0][items][0][price_data][currency]": "eur",
    "phases[0][items][0][price_data][product]": price.product,
    "phases[0][items][0][price_data][unit_amount]": String(installments[1]),
    "phases[0][items][0][price_data][tax_behavior]": "exclusive",
    "phases[0][items][0][price_data][recurring][interval]": "month",
  });
  setMetadata(params, "metadata", orderMeta);
  setMetadata(params, "phases[0][metadata]", orderMeta);
  const schedule = await post("/subscription_schedules", params, `cyclicom-schedule-${object.id}`);

  const [latestCharge, latestCustomer] = await Promise.all([
    get<StripeRecord>(resource("charges", charge.id)),
    get<StripeRecord>(resource("customers", session.customer)),
  ]);
  if (latestCharge.refunded || latestCharge.disputed || latestCustomer.metadata?.cyclicom_hold === attempt) {
    await cancelOrderSchedules([schedule]);
  }
}

async function handleRisk(type: string, object: StripeRecord) {
  const charge = type === "charge.refunded"
    ? object
    : object.charge ? await get<StripeRecord>(resource("charges", object.charge)) : undefined;
  if (!charge?.customer || (charge.metadata?.kind && charge.metadata.kind !== ORDER_KIND)) return false;
  const customerId = charge.customer;
  const metadata = charge.metadata?.kind === ORDER_KIND
    ? charge.metadata
    : (await get<StripeRecord>(resource("customers", customerId))).metadata;
  const attempt = metadata?.cyclicom_attempt;
  if (metadata?.kind !== ORDER_KIND || !isCyclicomAttempt(attempt)) return false;
  if (type === "charge.refunded" && !charge.refunded) return true;

  const params = new URLSearchParams({ "metadata[cyclicom_hold]": attempt });
  await post(resource("customers", customerId), params, `cyclicom-hold-${attempt}`);
  await cancelOrderSchedules(await listOrderSchedules(customerId, attempt));
  return true;
}

export async function handleCyclicomStripeEvent(event: StripeEvent): Promise<boolean> {
  const object = event.data.object as StripeRecord | null;
  if (!object) return false;
  if (RISK_EVENTS.has(event.type)) return handleRisk(event.type, object);
  const kind = object.metadata?.kind ?? object.parent?.subscription_details?.metadata?.kind;
  if (kind === ORDER_KIND) {
    if (CHECKOUT_PAID.has(event.type)) await createRemainingSchedule(object);
    if (event.type === "invoice.payment_failed" || event.type === "invoice.payment_action_required") {
      console.warn("[cyclicom-payment] Stripe payment recovery", { invoiceId: object.id, event: event.type });
    }
    return true;
  }
  return false;
}
