import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { PREMIUM_SUBSCRIPTION_OFFER, STANDARD_SUBSCRIPTION_OFFER } from "@/lib/subscriptionOffers";
import { nativeSubscriptionFromProductId, type NativeBillingCycle, type NativeSubscriptionPlan } from "@/lib/nativeBillingCatalog";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RevenueCatEvent = {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  product_id?: string | null;
  entitlement_ids?: string[] | null;
  store?: string | null;
  environment?: string | null;
  transaction_id?: string | null;
  original_transaction_id?: string | null;
  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number | null;
  cancel_reason?: string | null;
};

type RevenueCatPayload = {
  api_version?: string;
  event?: RevenueCatEvent;
};

type SubscriptionRow = {
  billing_provider?: string | null;
  status?: string | null;
  stripe_subscription_id?: string | null;
  start_date?: string | null;
};

type WebhookEventRow = {
  event_id: string;
  status: "processing" | "completed" | "failed";
  attempts: number;
  last_received_at: string;
};

function authorized(request: Request): boolean {
  const expected = String(process.env.REVENUECAT_WEBHOOK_AUTHORIZATION || "").trim();
  const received = String(request.headers.get("authorization") || "").trim();
  if (!expected || !received) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isoFromMs(value: unknown): string | null {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function ymdFromIso(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

function storeProvider(store: unknown): "app_store" | "play_store" | null {
  const normalized = String(store || "").trim().toUpperCase();
  if (normalized === "APP_STORE") return "app_store";
  if (normalized === "PLAY_STORE") return "play_store";
  return null;
}

function subscriptionMatch(event: RevenueCatEvent): {
  plan: NativeSubscriptionPlan;
  billingCycle: NativeBillingCycle;
} | null {
  const direct = nativeSubscriptionFromProductId(event.product_id);
  if (direct) return direct;

  const entitlementIds = new Set((event.entitlement_ids || []).map((value) => String(value).trim().toLowerCase()));
  const productId = String(event.product_id || "").trim().toLowerCase();
  const plan: NativeSubscriptionPlan | null =
    entitlementIds.has("premium") || productId.includes("premium") ? "Premium" :
      entitlementIds.has("standard") || productId.includes("standard") ? "Standard" : null;
  if (!plan) return null;

  const billingCycle: NativeBillingCycle = /year|annual|annualy|annuel/.test(productId) ? "yearly" : "monthly";
  return { plan, billingCycle };
}

function monthlyPriceForPlan(plan: NativeSubscriptionPlan): number {
  return plan === "Premium"
    ? PREMIUM_SUBSCRIPTION_OFFER.monthlyPriceEur
    : STANDARD_SUBSCRIPTION_OFFER.monthlyPriceEur;
}

function activeStoreStatus(eventType: string, expirationIso: string | null): string {
  if (eventType === "EXPIRATION") return "canceled";
  if (expirationIso && new Date(expirationIso).getTime() <= Date.now()) return "canceled";
  return "active";
}

async function claimEvent(event: RevenueCatEvent, rawPayload: RevenueCatPayload): Promise<"process" | "duplicate"> {
  const eventId = String(event.id || "").trim();
  if (!eventId) throw new Error("Événement RevenueCat sans identifiant.");

  const nowIso = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin.from("revenuecat_webhook_events").insert({
    event_id: eventId,
    event_type: String(event.type || "unknown"),
    status: "processing",
    attempts: 1,
    first_received_at: nowIso,
    last_received_at: nowIso,
    payload: rawPayload,
  });
  if (!insertError) return "process";
  if (insertError.code !== "23505") throw insertError;

  const { data, error } = await supabaseAdmin
    .from("revenuecat_webhook_events")
    .select("event_id,status,attempts,last_received_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;

  const existing = data as WebhookEventRow | null;
  if (!existing || existing.status === "completed") return "duplicate";

  const lastReceivedMs = new Date(existing.last_received_at).getTime();
  if (existing.status === "processing" && Number.isFinite(lastReceivedMs) && Date.now() - lastReceivedMs < 5 * 60 * 1000) {
    return "duplicate";
  }

  const { error: retryError } = await supabaseAdmin
    .from("revenuecat_webhook_events")
    .update({
      status: "processing",
      attempts: Math.max(1, Number(existing.attempts || 0)) + 1,
      last_received_at: nowIso,
      last_error: null,
      payload: rawPayload,
    })
    .eq("event_id", eventId);
  if (retryError) throw retryError;
  return "process";
}

async function completeEvent(eventId: string) {
  const { error } = await supabaseAdmin
    .from("revenuecat_webhook_events")
    .update({ status: "completed", completed_at: new Date().toISOString(), last_error: null })
    .eq("event_id", eventId);
  if (error) throw error;
}

async function failEvent(eventId: string, error: unknown) {
  await supabaseAdmin
    .from("revenuecat_webhook_events")
    .update({
      status: "failed",
      last_error: error instanceof Error ? error.message : String(error || "Erreur inconnue"),
      last_received_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);
}

export async function POST(request: Request) {
  if (!process.env.REVENUECAT_WEBHOOK_AUTHORIZATION) {
    return NextResponse.json({ error: "Webhook RevenueCat non configuré." }, { status: 503 });
  }
  if (!authorized(request)) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });

  let payload: RevenueCatPayload;
  try {
    payload = (await request.json()) as RevenueCatPayload;
  } catch {
    return NextResponse.json({ error: "Payload JSON invalide." }, { status: 400 });
  }

  const event = payload.event;
  const eventId = String(event?.id || "").trim();
  if (!event || !eventId) return NextResponse.json({ error: "Événement RevenueCat incomplet." }, { status: 400 });

  try {
    if ((await claimEvent(event, payload)) === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    const eventType = String(event.type || "").trim().toUpperCase();
    if (eventType === "TEST") {
      await completeEvent(eventId);
      return NextResponse.json({ received: true, ignored: "test" });
    }

    const userId = String(event.app_user_id || event.original_app_user_id || "").trim();
    const provider = storeProvider(event.store);
    if (!isUuid(userId) || !provider) {
      await completeEvent(eventId);
      return NextResponse.json({ received: true, ignored: "unsupported_user_or_store" });
    }

    const match = subscriptionMatch(event);
    if (!match) throw new Error("Produit RevenueCat inconnu : configurez son identifiant dans le catalogue mobile.");

    const { data: existingData, error: existingError } = await supabaseAdmin
      .from("subscriptions")
      .select("billing_provider,status,stripe_subscription_id,start_date")
      .eq("user_id", userId)
      .maybeSingle();
    if (existingError) throw existingError;

    const existing = existingData as SubscriptionRow | null;
    const existingProvider = String(existing?.billing_provider || "").trim().toLowerCase();
    const existingStatus = String(existing?.status || "").trim().toLowerCase();
    const stripeIsLive = Boolean(existing?.stripe_subscription_id) &&
      new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]).has(existingStatus);
    const anotherProviderIsLive =
      (existingProvider === "app_store" || existingProvider === "play_store") &&
      existingProvider !== provider &&
      existingStatus === "active";

    // The client-side prepare endpoint prevents this path in normal use. If two
    // devices race, preserve the already authoritative source instead of
    // silently creating a double-billing state.
    if (stripeIsLive || anotherProviderIsLive) {
      console.warn("[revenuecat-webhook] Subscription source conflict; existing source preserved.", {
        userId,
        existingProvider,
        provider,
        eventId,
      });
      await completeEvent(eventId);
      return NextResponse.json({ received: true, ignored: "billing_source_conflict" });
    }

    const expirationAt = isoFromMs(event.expiration_at_ms);
    const purchasedAt = isoFromMs(event.purchased_at_ms) || isoFromMs(event.event_timestamp_ms);
    const eventAt = isoFromMs(event.event_timestamp_ms) || new Date().toISOString();
    const isCancellation = eventType === "CANCELLATION";
    const isUncancellation = eventType === "UNCANCELLATION";
    const isBillingIssue = eventType === "BILLING_ISSUE" || event.cancel_reason === "BILLING_ERROR";
    const isExpired = eventType === "EXPIRATION";
    const status = activeStoreStatus(eventType, expirationAt);
    const cancellationRequestedAt = isCancellation && !isBillingIssue ? eventAt : isUncancellation ? null : undefined;
    const billingIssueAt = isBillingIssue ? eventAt : isUncancellation ? null : undefined;
    const expirationYmd = ymdFromIso(expirationAt);
    const patch: Record<string, unknown> = {
      billing_provider: provider,
      native_product_id: String(event.product_id || "").trim() || null,
      native_transaction_id: String(event.transaction_id || "").trim() || null,
      native_original_transaction_id: String(event.original_transaction_id || "").trim() || null,
      native_expires_at: expirationAt,
      native_will_renew: !isCancellation && !isExpired && !isBillingIssue,
      native_last_event_at: eventAt,
      native_last_event_id: eventId,
      native_environment: String(event.environment || "").trim() || null,
      native_entitlement_ids: Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [],
      plan: match.plan,
      app_edition: match.plan.toLowerCase(),
      billing_cycle: match.billingCycle,
      monthly_price_eur: monthlyPriceForPlan(match.plan),
      status,
      next_renewal_date: expirationYmd,
      scheduled_plan: null,
      ...(purchasedAt && !existing?.start_date ? { start_date: purchasedAt.slice(0, 10) } : {}),
      ...(cancellationRequestedAt !== undefined ? { cancel_requested_at: cancellationRequestedAt, end_date: expirationYmd } : {}),
      ...(isUncancellation ? { cancel_requested_at: null, end_date: null } : {}),
      ...(billingIssueAt !== undefined ? { native_billing_issue_at: billingIssueAt } : {}),
      ...(isUncancellation ? { native_billing_issue_at: null } : {}),
    };

    if (isExpired) {
      patch.cancel_requested_at = null;
      patch.end_date = expirationYmd;
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .select("user_id,status,billing_provider,native_product_id,native_expires_at")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) throw new Error("Aucun abonnement iNrCy ne correspond à l’utilisateur RevenueCat.");

    await completeEvent(eventId);
    return NextResponse.json({ received: true, status, provider });
  } catch (error: unknown) {
    if (eventId) await failEvent(eventId, error).catch(() => null);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "La synchronisation RevenueCat sera retentée." },
      { status: 500 },
    );
  }
}
