import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { stripeGet, verifyStripeWebhookSignature } from "@/lib/stripeRest";
import { optionalEnv } from "@/lib/env";
import { commercialPriceFromId } from "@/lib/billingCatalog";
import { stripeSubscriptionMonthlyTerms } from "@/lib/adminSubscriberStripe";
import { stripeSubscriptionPeriodEndIso } from "@/lib/stripeSubscription";
import { sendAdminSubscriptionAlertForUser } from "@/lib/subscriptionAdmin";
import {
  consistentStripeWebhookUserId,
  invoiceCustomerEmail,
  invoiceCustomerId,
  invoiceSubscriptionId,
  invoiceUserIdentity,
  paymentFailureStatus,
  paymentSuccessStatus,
  resolveStripeWebhookStrongUser,
  stripeObjectId,
  subscriptionCancellationReason,
} from "@/lib/stripeWebhookPayload";

export const runtime = "nodejs";

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: unknown;
    previous_attributes?: Record<string, unknown>;
  };
};

type StripeObjectLoose = Record<string, unknown>;

type SubscriptionSnapshot = {
  user_id?: string | null;
  contact_email?: string | null;
  plan?: string | null;
  scheduled_plan?: string | null;
  status?: string | null;
  trial_start_at?: string | null;
  trial_end_at?: string | null;
  cancel_requested_at?: string | null;
  end_date?: string | null;
  next_renewal_date?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_price_id?: string | null;
  monthly_price_eur?: number | null;
  app_edition?: string | null;
  billing_cycle?: string | null;
  billing_provider?: string | null;
};

const STRIPE_SUBSCRIPTION_STATUSES = new Set([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

function normalizeStripeStatus(status: string): string {
  const s = String(status || "").toLowerCase();
  return STRIPE_SUBSCRIPTION_STATUSES.has(s) ? s : "incomplete";
}

function planFromPriceId(priceId: string | null) {
  if (!priceId) return null;
  const commercialPrice = commercialPriceFromId(priceId);
  if (commercialPrice) return commercialPrice.plan;
  const starter = optionalEnv("STRIPE_PRICE_STARTER_ID");
  const accel = optionalEnv("STRIPE_PRICE_ACCEL_ID");
  const speed = optionalEnv("STRIPE_PRICE_SPEED_ID") || optionalEnv("STRIPE_PRICE_FULL_ID");
  const yearly = optionalEnv("STRIPE_PRICE_YEARLY");
  const accelYearly = optionalEnv("STRIPE_PRICE_ACCEL_YEARLY_ID");
  if (starter && priceId === starter) return "Starter";
  if (yearly && priceId === yearly) return "Starter";
  if (accel && priceId === accel) return "Accel";
  if (accelYearly && priceId === accelYearly) return "Accel";
  if (speed && priceId === speed) return "Speed";
  return null;
}

function storedDbPrice(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const SUBSCRIPTION_SELECT =
  "user_id, contact_email, plan, scheduled_plan, status, trial_start_at, trial_end_at, cancel_requested_at, end_date, next_renewal_date, stripe_customer_id, stripe_subscription_id, stripe_price_id, monthly_price_eur, app_edition, billing_cycle, billing_provider";

function normalizedEmailVariants(email?: string | null) {
  const raw = String(email || "").trim();
  if (!raw) return [];
  return Array.from(new Set([raw, raw.toLowerCase()]));
}

function exactIlikePattern(value: string) {
  return value.replace(/([\\%_])/g, "\\$1");
}

async function findSubscriptionMatchesBy(column: string, value?: string | null) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return [] as SubscriptionSnapshot[];

  const query = supabaseAdmin
    .from("subscriptions")
    .select(SUBSCRIPTION_SELECT)
    .limit(2);
  const { data, error } = column === "contact_email"
    ? await query.ilike(column, exactIlikePattern(cleaned))
    : await query.eq(column, cleaned);

  if (error) throw error;
  const rows = (data as SubscriptionSnapshot[] | null) ?? [];
  if (rows.length > 1) {
    console.warn(`[stripe-webhook] Correspondance subscriptions ambigue pour ${column}.`);
  }
  return rows;
}

async function findUserIdsByEmail(email?: string | null) {
  const variants = normalizedEmailVariants(email);
  if (!variants.length) return [] as string[];

  const userIds = new Set<string>();
  for (const value of variants) {
    for (const column of ["admin_email", "contact_email"]) {
      const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("user_id")
        .ilike(column, exactIlikePattern(value))
        .limit(2);

      if (error) throw error;
      for (const row of data ?? []) {
        if (typeof row.user_id === "string" && row.user_id) userIds.add(row.user_id);
      }
    }
  }

  return Array.from(userIds);
}

async function getStripeCustomerHints(customerId?: string | null) {
  if (!customerId) return { userId: null as string | null, email: null as string | null };

  try {
    const customer = (await stripeGet(`/customers/${encodeURIComponent(customerId)}`)) as StripeObjectLoose;
    const metadata = (customer?.metadata as StripeObjectLoose | undefined) ?? undefined;
    return {
      userId: typeof metadata?.user_id === "string" ? metadata.user_id : null,
      email: typeof customer?.email === "string" ? customer.email : null,
    };
  } catch {
    return { userId: null as string | null, email: null as string | null };
  }
}

async function getSubscriptionRow(
  userId?: string | null,
  customerId?: string | null,
  subscriptionId?: string | null,
  email?: string | null,
  customerHintsCache?: Map<
    string,
    Promise<{ userId: string | null; email: string | null }>
  >,
) {
  let hints = { userId: null as string | null, email: null as string | null };
  if (customerId) {
    let hintsPromise = customerHintsCache?.get(customerId);
    if (!hintsPromise) {
      hintsPromise = getStripeCustomerHints(customerId);
      customerHintsCache?.set(customerId, hintsPromise);
    }
    hints = await hintsPromise;
  }
  const metadataConsensus = consistentStripeWebhookUserId([userId]);
  const subscriptionRows = await findSubscriptionMatchesBy(
    "stripe_subscription_id",
    subscriptionId,
  );
  const customerRows = await findSubscriptionMatchesBy("stripe_customer_id", customerId);
  const metadataRows = metadataConsensus.userId
    ? await findSubscriptionMatchesBy("user_id", metadataConsensus.userId)
    : [];
  const hintRows = hints.userId
    ? await findSubscriptionMatchesBy("user_id", hints.userId)
    : [];
  const strongRows = [...subscriptionRows, ...customerRows, ...metadataRows, ...hintRows];
  const warnStrongConflict = () => {
    console.warn("[stripe-webhook][strong_identity_conflict]", {
      hasUserId: Boolean(userId || hints.userId),
      hasCustomerId: Boolean(customerId),
      hasSubscriptionId: Boolean(subscriptionId),
      matchedAccounts: new Set(strongRows.map((row) => row.user_id)).size,
    });
  };
  const strongResolution = resolveStripeWebhookStrongUser({
    metadataUserIds: [userId],
    subscriptionUserIds: subscriptionRows.map((row) => row.user_id),
    customerUserIds: [
      ...customerRows.map((row) => row.user_id),
      hints.userId,
    ],
    subscriptionAmbiguous: subscriptionRows.length > 1,
    metadataAmbiguous: metadataRows.length > 1,
  });
  if (strongResolution.conflict) {
    warnStrongConflict();
    return null;
  }
  if (strongResolution.userId) {
    const strongWinner = strongRows.find(
      (row) => row.user_id === strongResolution.userId,
    );
    // Metadata names a non-existent local subscription: never redirect by a
    // lower-priority customer id or email.
    return strongWinner ?? null;
  }

  const resolvedEmail = email || hints.email;
  const weakRows: SubscriptionSnapshot[] = [];
  let weakAmbiguous = false;
  for (const emailVariant of normalizedEmailVariants(resolvedEmail)) {
    const rows = await findSubscriptionMatchesBy("contact_email", emailVariant);
    weakAmbiguous ||= rows.length > 1;
    weakRows.push(...rows);
  }
  const profileUserIds = await findUserIdsByEmail(resolvedEmail);
  weakAmbiguous ||= profileUserIds.length > 1;
  for (const profileUserId of profileUserIds) {
    const rows = await findSubscriptionMatchesBy("user_id", profileUserId);
    weakAmbiguous ||= rows.length > 1;
    weakRows.push(...rows);
  }
  const weakConsensus = consistentStripeWebhookUserId(
    weakRows.map((row) => row.user_id),
  );
  if (weakAmbiguous || weakConsensus.conflict) {
    console.warn("[stripe-webhook][email_identity_conflict]", {
      hasEmail: Boolean(resolvedEmail),
      matchedAccounts: new Set(weakRows.map((row) => row.user_id)).size,
    });
    return null;
  }
  return weakConsensus.userId
    ? weakRows.find((row) => row.user_id === weakConsensus.userId) ?? null
    : null;
}

async function getStripeSubscriptionStatus(subscriptionId?: string | null) {
  if (!subscriptionId) return null;
  // Invoice webhooks can arrive late or out of order. Never infer a transition
  // when Stripe live is unavailable; throwing lets Stripe retry the event.
  const subscription = (await stripeGet(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
  )) as StripeObjectLoose;
  const status = String(subscription?.status || "").trim().toLowerCase();
  if (!STRIPE_SUBSCRIPTION_STATUSES.has(status)) {
    throw new Error("stripe_subscription_status_unavailable");
  }
  return status;
}

type StripeWebhookEventRow = {
  event_id: string;
  status: "processing" | "completed" | "failed";
  attempts: number;
  last_received_at: string;
};

async function claimStripeWebhookEvent(event: StripeEvent): Promise<"process" | "duplicate"> {
  const eventId = String(event.id || "").trim();
  if (!eventId) return "process";

  const nowIso = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin
    .from("stripe_webhook_events")
    .insert({
      event_id: eventId,
      event_type: String(event.type || "unknown"),
      status: "processing",
      attempts: 1,
      first_received_at: nowIso,
      last_received_at: nowIso,
    });

  if (!insertError) return "process";
  if (insertError.code !== "23505") throw insertError;

  const { data, error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .select("event_id,status,attempts,last_received_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;

  const existing = data as StripeWebhookEventRow | null;
  if (!existing || existing.status === "completed") return "duplicate";

  const lastReceivedMs = new Date(existing.last_received_at).getTime();
  const isFreshProcessing =
    existing.status === "processing" &&
    Number.isFinite(lastReceivedMs) &&
    Date.now() - lastReceivedMs < 5 * 60 * 1000;
  if (isFreshProcessing) return "duplicate";

  const { error: retryError } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({
      status: "processing",
      attempts: Math.max(1, Number(existing.attempts || 0)) + 1,
      last_received_at: nowIso,
      last_error: null,
    })
    .eq("event_id", eventId);
  if (retryError) throw retryError;
  return "process";
}

async function completeStripeWebhookEvent(event: StripeEvent) {
  const eventId = String(event.id || "").trim();
  if (!eventId) return;
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("event_id", eventId);
  if (error) throw error;
}

async function failStripeWebhookEvent(event: StripeEvent, failure: unknown) {
  const eventId = String(event.id || "").trim();
  if (!eventId) return;
  const message = failure instanceof Error ? failure.message : String(failure || "Unknown error");
  await supabaseAdmin
    .from("stripe_webhook_events")
    .update({
      status: "failed",
      last_error: message.slice(0, 2000),
      last_received_at: new Date().toISOString(),
    })
    .eq("event_id", eventId);
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const payload = await req.text();

  try {
    verifyStripeWebhookSignature(payload, sig);
  } catch (e: unknown) {
    return jsonUserFacingError(e, { status: 400, fallback: "Une erreur est survenue pendant la validation du paiement." });
  }

  let evt: StripeEvent;
  try {
    evt = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "JSON invalide." }, { status: 400 });
  }

  try {
    const claim = await claimStripeWebhookEvent(evt);
    if (claim === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (error: unknown) {
    return jsonUserFacingError(error, {
      status: 500,
      fallback: "La synchronisation du paiement sera retentée automatiquement.",
    });
  }

  const customerHintsCache = new Map<
    string,
    Promise<{ userId: string | null; email: string | null }>
  >();
  const resolveSubscriptionRow = (
    userId?: string | null,
    customerId?: string | null,
    subscriptionId?: string | null,
    email?: string | null,
  ) => getSubscriptionRow(
    userId,
    customerId,
    subscriptionId,
    email,
    customerHintsCache,
  );

  const updateSubscriptionRow = async (
    userId: string | null | undefined,
    customerId: string | null | undefined,
    patch: Record<string, unknown>,
    subscriptionId?: string | null,
    email?: string | null
  ) => {
    const existingRow = await resolveSubscriptionRow(userId, customerId, subscriptionId, email);
    if (!existingRow?.user_id) {
      const details = {
        eventId: typeof evt.id === "string" ? evt.id : null,
        eventType: String(evt.type || "unknown"),
        hasUserId: Boolean(userId),
        hasCustomerId: Boolean(customerId),
        hasSubscriptionId: Boolean(subscriptionId),
        hasEmail: Boolean(email),
      };
      const eventType = String(evt.type || "");
      if (
        userId ||
        eventType === "checkout.session.completed" ||
        eventType.startsWith("customer.subscription.") ||
        eventType.startsWith("invoice.")
      ) {
        console.warn("[stripe-webhook] Aucun compte Supabase unique ne correspond a l'evenement Stripe.", details);
      } else {
        // Historical or out-of-scope Stripe objects can legitimately reach the
        // endpoint. Acknowledge them without polluting the production warnings.
        console.info("[stripe-webhook] Evenement Stripe sans compte iNrCy local.", details);
      }
      return null;
    }

    const existingProvider = String(existingRow.billing_provider || "").trim().toLowerCase();
    const incomingProvider = String(patch.billing_provider || "").trim().toLowerCase();
    const nativeProviders = new Set(["app_store", "play_store"]);
    if (
      incomingProvider === "stripe" &&
      nativeProviders.has(existingProvider) &&
      existingRow.stripe_subscription_id !== (subscriptionId || null)
    ) {
      console.warn("[stripe-webhook] Evenement Stripe ignore pour un abonnement natif deja actif.", {
        eventId: typeof evt.id === "string" ? evt.id : null,
        eventType: String(evt.type || "unknown"),
        userId: existingRow.user_id,
        existingProvider,
      });
      return null;
    }

    if (
      subscriptionId &&
      existingRow.stripe_subscription_id &&
      existingRow.stripe_subscription_id !== subscriptionId
    ) {
      const terminalStatuses = new Set([
        "canceled",
        "cancelled",
        "incomplete_expired",
        "trial_expired",
        "inactive",
        "expired",
        "unpaid",
      ]);
      const mayReplaceTerminalSubscription =
        evt.type === "checkout.session.completed" &&
        Boolean(userId) &&
        existingRow.user_id === userId &&
        terminalStatuses.has(String(existingRow.status ?? "").trim().toLowerCase());
      if (!mayReplaceTerminalSubscription) {
        console.warn("[stripe-webhook][stale_subscription_event_ignored]", {
          eventType: String(evt.type || "unknown"),
          hasIncomingSubscriptionId: true,
          hasCurrentSubscriptionId: true,
        });
        return null;
      }
    }

    let updateQuery = supabaseAdmin
      .from("subscriptions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", existingRow.user_id);
    updateQuery = existingRow.stripe_subscription_id == null
      ? updateQuery.is("stripe_subscription_id", null)
      : updateQuery.eq("stripe_subscription_id", existingRow.stripe_subscription_id);
    updateQuery = existingRow.status == null
      ? updateQuery.is("status", null)
      : updateQuery.eq("status", existingRow.status);
    const { data, error } = await updateQuery
      .select(SUBSCRIPTION_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      console.warn("[stripe-webhook][concurrent_subscription_update_ignored]", {
        eventType: String(evt.type || "unknown"),
        hasSubscriptionId: Boolean(subscriptionId),
      });
      return null;
    }
    return data as SubscriptionSnapshot;
  };

  try {
    const type = String(evt.type || "");
    const obj = (evt.data?.object ?? null) as StripeObjectLoose | null;
    const previous = (evt.data?.previous_attributes ?? {}) as StripeObjectLoose;

    if (type === "checkout.session.completed") {
      const session = obj;
      const metadata = (session?.metadata as StripeObjectLoose | undefined) ?? undefined;
      const metadataUserId = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const clientReferenceId =
        typeof session?.client_reference_id === "string"
          ? session.client_reference_id
          : null;
      const checkoutIdentity = consistentStripeWebhookUserId([
        metadataUserId,
        clientReferenceId,
      ]);
      let userId = checkoutIdentity.userId;
      let customerId = stripeObjectId(session?.customer);
      const subId = stripeObjectId(session?.subscription);
      const checkoutMode = String(session?.mode ?? "").trim().toLowerCase();
      const customerDetails = (session?.customer_details as StripeObjectLoose | undefined) ?? undefined;
      const email =
        (typeof customerDetails?.email === "string" ? customerDetails.email : null) ||
        (typeof session?.customer_email === "string" ? session.customer_email : null);
      const billingCycle = typeof metadata?.billing_cycle === "string" ? metadata.billing_cycle : null;

      if (checkoutIdentity.conflict) {
        console.warn("[stripe-webhook][checkout_identity_conflict]", {
          eventType: type,
          hasMetadataUserId: Boolean(metadataUserId),
          hasClientReferenceId: Boolean(clientReferenceId),
        });
        await completeStripeWebhookEvent(evt);
        return NextResponse.json({ received: true, ignored: "identity_conflict" });
      }
      if (checkoutMode !== "subscription" || !subId) {
        console.info("[stripe-webhook][checkout_non_subscription_ignored]", {
          eventType: type,
          hasSubscriptionId: Boolean(subId),
        });
        await completeStripeWebhookEvent(evt);
        return NextResponse.json({ received: true, ignored: "not_a_subscription" });
      }

      const checkoutSubscription = (await stripeGet(
        `/subscriptions/${encodeURIComponent(subId)}`,
      )) as StripeObjectLoose;
      const checkoutSubscriptionMetadata =
        (checkoutSubscription.metadata as StripeObjectLoose | undefined) ?? undefined;
      const subscriptionMetadataUserId =
        typeof checkoutSubscriptionMetadata?.user_id === "string"
          ? checkoutSubscriptionMetadata.user_id
          : null;
      const confirmedIdentity = consistentStripeWebhookUserId([
        userId,
        subscriptionMetadataUserId,
      ]);
      const liveCustomerId = stripeObjectId(checkoutSubscription.customer);
      const liveCheckoutStatus = normalizeStripeStatus(
        String(checkoutSubscription.status || ""),
      );
      const liveCheckoutIsCurrent = ["active", "trialing"].includes(liveCheckoutStatus);
      if (
        confirmedIdentity.conflict ||
        (customerId && liveCustomerId && customerId !== liveCustomerId) ||
        !liveCheckoutIsCurrent
      ) {
        console.warn("[stripe-webhook][checkout_subscription_validation_failed]", {
          hasIdentityConflict: confirmedIdentity.conflict,
          hasCustomerConflict: Boolean(
            customerId && liveCustomerId && customerId !== liveCustomerId,
          ),
          statusIsCurrent: liveCheckoutIsCurrent,
        });
        await completeStripeWebhookEvent(evt);
        return NextResponse.json({ received: true, ignored: "subscription_not_current" });
      }
      userId = confirmedIdentity.userId;
      customerId = liveCustomerId || customerId;

      const row = await updateSubscriptionRow(
        userId,
        customerId,
        {
          billing_provider: "stripe",
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subId,
          ...(billingCycle === "monthly" || billingCycle === "yearly"
            ? { billing_cycle: billingCycle }
            : {}),
          ...(email ? { contact_email: email } : {}),
        },
        subId,
        email
      );

      if (row?.user_id && row.stripe_subscription_id === subId) {
        await sendAdminSubscriptionAlertForUser({
          type: "checkout_completed",
          source: "stripe.webhook.checkout.session.completed",
          userId: row.user_id,
          accountEmail: row?.contact_email ?? null,
          plan: row?.plan ?? null,
          scheduledPlan: row?.scheduled_plan ?? null,
          status: row?.status ?? null,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subId,
          stripePriceId: row?.stripe_price_id ?? null,
          trialStartAt: row?.trial_start_at ?? null,
          trialEndAt: row?.trial_end_at ?? null,
          note:
            billingCycle === "yearly"
              ? "Abonnement annuel confirmé dans Stripe Checkout. Le renouvellement se fera automatiquement chaque année."
              : "Paiement confirmé dans Stripe Checkout. L'abonnement démarrera à la fin de l'essai si celui-ci est encore en cours.",
        }).catch(() => null);
      }
    }

    if (type === "customer.subscription.created" || type === "customer.subscription.updated") {
      const eventSub = obj;
      const eventSubscriptionId = stripeObjectId(eventSub?.id);
      // Stripe does not guarantee webhook ordering. Always read the current
      // subscription so a delayed past_due snapshot cannot overwrite a newer
      // successful payment already reflected by Stripe.
      const sub = eventSubscriptionId
        ? (await stripeGet(
            `/subscriptions/${encodeURIComponent(eventSubscriptionId)}`,
          )) as StripeObjectLoose
        : eventSub;
      const metadata = (sub?.metadata as StripeObjectLoose | undefined) ?? undefined;
      const userId = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const customerId = stripeObjectId(sub?.customer);
      const subId = stripeObjectId(sub?.id);
      const stripeStatus = normalizeStripeStatus(String(sub?.status || ""));
      const currentPeriodEnd = stripeSubscriptionPeriodEndIso(sub);
      const cancelAt = sub?.cancel_at ? new Date(Number(sub.cancel_at) * 1000).toISOString() : null;
      const cancelAtPeriodEnd = !!sub?.cancel_at_period_end;
      const cancellationScheduled = cancelAtPeriodEnd || Boolean(cancelAt);
      const items = (sub?.items as StripeObjectLoose | undefined) ?? undefined;
      const dataArr = (items?.data as unknown[]) || [];
      const firstItem = (dataArr[0] as StripeObjectLoose | undefined) ?? undefined;
      const priceObj = (firstItem?.price as StripeObjectLoose | undefined) ?? undefined;
      const priceId = typeof priceObj?.id === "string" ? priceObj.id : null;
      const trialEndAt = sub?.trial_end ? new Date(Number(sub.trial_end) * 1000).toISOString() : null;
      const trialStartAt = sub?.trial_start ? new Date(Number(sub.trial_start) * 1000).toISOString() : null;
      const commercialPrice = commercialPriceFromId(priceId);
      const liveTerms = stripeSubscriptionMonthlyTerms(sub);
      const billingCycle =
        liveTerms.billingCycle === "monthly" || liveTerms.billingCycle === "yearly"
          ? liveTerms.billingCycle
          : null;
      const inrcyPlan = planFromPriceId(priceId);
      const existingRow = await resolveSubscriptionRow(userId, customerId, subId);
      const currentStoredPrice = storedDbPrice(existingRow?.monthly_price_eur);
      const stripeStoredPrice =
        liveTerms.amountEur != null &&
        Number.isFinite(liveTerms.amountEur) &&
        liveTerms.amountEur >= 0
          ? liveTerms.amountEur
          : null;
      const existingEdition = String(existingRow?.app_edition || "").trim().toLowerCase();
      const founderAccount = existingEdition === "founder";
      const shouldKeepTrialPlan = stripeStatus === "trialing";
      const cancellationTimestamp = cancellationScheduled
        ? existingRow?.cancel_requested_at || new Date().toISOString()
        : null;
      const cancellationEnd = cancelAt || (cancelAtPeriodEnd ? currentPeriodEnd : null);

      const row = await updateSubscriptionRow(userId, customerId, {
        billing_provider: "stripe",
        status: stripeStatus,
        stripe_customer_id: customerId || null,
        ...(subId ? { stripe_subscription_id: subId } : {}),
        stripe_price_id: priceId,
        ...(billingCycle ? { billing_cycle: billingCycle } : {}),
        ...(commercialPrice && !founderAccount ? { app_edition: commercialPrice.edition } : {}),
        ...(inrcyPlan ? { scheduled_plan: inrcyPlan } : {}),
        ...(shouldKeepTrialPlan
          ? {
              plan: "Trial",
              // Ne jamais écraser un tarif manuel déjà enregistré.
              ...(currentStoredPrice == null ? { monthly_price_eur: 0 } : {}),
            }
          : {
              ...(inrcyPlan ? { plan: inrcyPlan } : {}),
              // For a linked Stripe subscription, Stripe is authoritative even
              // when Supabase previously contained 0 or a stale negotiated price.
              ...(stripeStoredPrice != null
                ? { monthly_price_eur: stripeStoredPrice }
                : {}),
              scheduled_plan: null,
            }),
        ...(trialEndAt ? { trial_end_at: trialEndAt } : {}),
        ...(trialStartAt ? { trial_start_at: trialStartAt } : {}),
        next_renewal_date: currentPeriodEnd ? currentPeriodEnd.slice(0, 10) : null,
        cancel_requested_at: cancellationTimestamp,
        end_date: cancellationEnd ? cancellationEnd.slice(0, 10) : null,
      }, subId);

      const resolvedUserId = row?.user_id ?? null;
      if (resolvedUserId && subId && row?.stripe_subscription_id === subId) {
        const previousStatus = normalizeStripeStatus(String(previous?.status || ""));
        const previousCancellationScheduled =
          previous?.cancel_at_period_end === true || Boolean(previous?.cancel_at);

        if (stripeStatus === "active" && previousStatus === "trialing") {
          await sendAdminSubscriptionAlertForUser({
            type: "subscription_activated",
            source: `stripe.webhook.${type}`,
            userId: resolvedUserId,
            accountEmail: row?.contact_email ?? null,
            plan: row?.plan ?? inrcyPlan,
            scheduledPlan: row?.scheduled_plan ?? null,
            status: stripeStatus,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            stripePriceId: priceId,
            trialStartAt: row?.trial_start_at ?? trialStartAt,
            trialEndAt: row?.trial_end_at ?? trialEndAt,
            nextRenewalDate: row?.next_renewal_date ?? (currentPeriodEnd ? currentPeriodEnd.slice(0, 10) : null),
            note: "Le trial Stripe est terminé et l'abonnement payant est désormais actif.",
          }).catch(() => null);
        }

        if (cancellationScheduled && !previousCancellationScheduled) {
          await sendAdminSubscriptionAlertForUser({
            type: "cancellation_requested",
            source: `stripe.webhook.${type}`,
            userId: resolvedUserId,
            accountEmail: row?.contact_email ?? null,
            plan: row?.plan ?? null,
            scheduledPlan: row?.scheduled_plan ?? null,
            status: stripeStatus,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            stripePriceId: priceId,
            cancelRequestedAt: row?.cancel_requested_at ?? cancellationTimestamp,
            endDate: row?.end_date ?? (cancelAt ? cancelAt.slice(0, 10) : null),
            nextRenewalDate: row?.next_renewal_date ?? (currentPeriodEnd ? currentPeriodEnd.slice(0, 10) : null),
            note: cancelAtPeriodEnd
              ? "Résiliation annuelle programmée à l'échéance Stripe."
              : "Résiliation mensuelle programmée après le prochain renouvellement et son mois de préavis.",
          }).catch(() => null);
        }

        if (!cancellationScheduled && previousCancellationScheduled) {
          await sendAdminSubscriptionAlertForUser({
            type: "cancellation_reversed",
            source: `stripe.webhook.${type}`,
            userId: resolvedUserId,
            accountEmail: row?.contact_email ?? null,
            plan: row?.plan ?? null,
            scheduledPlan: row?.scheduled_plan ?? null,
            status: stripeStatus,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subId,
            stripePriceId: priceId,
            nextRenewalDate: row?.next_renewal_date ?? (currentPeriodEnd ? currentPeriodEnd.slice(0, 10) : null),
            note: "La résiliation a été annulée. L'abonnement continue.",
          }).catch(() => null);
        }
      }
    }

    if (type === "customer.subscription.deleted") {
      const sub = obj;
      const metadata = (sub?.metadata as StripeObjectLoose | undefined) ?? undefined;
      const userId = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const customerId = stripeObjectId(sub?.customer);
      const subId = stripeObjectId(sub?.id);
      const endedAt = sub?.ended_at ? new Date(Number(sub.ended_at) * 1000).toISOString() : null;
      const cancellationReason = subscriptionCancellationReason(sub);

      const row = await updateSubscriptionRow(
        userId,
        customerId,
        {
          billing_provider: "stripe",
          status: "canceled",
          stripe_customer_id: customerId || null,
          ...(subId ? { stripe_subscription_id: subId } : {}),
          end_date: endedAt ? endedAt.slice(0, 10) : null,
          // Une annulation automatique pour impaye bloque le compte, sans demander sa suppression.
          ...(cancellationReason === "payment_failed" ? { cancel_requested_at: null } : {}),
        },
        subId
      );

      const resolvedUserId = row?.user_id ?? null;
      if (resolvedUserId && subId && row?.stripe_subscription_id === subId) {
        await sendAdminSubscriptionAlertForUser({
          type: "subscription_deleted",
          source: "stripe.webhook.customer.subscription.deleted",
          userId: resolvedUserId,
          accountEmail: row?.contact_email ?? null,
          plan: row?.plan ?? null,
          scheduledPlan: row?.scheduled_plan ?? null,
          status: "canceled",
          stripeCustomerId: customerId,
          stripeSubscriptionId: subId,
          stripePriceId: row?.stripe_price_id ?? null,
          endDate: endedAt ? endedAt.slice(0, 10) : row?.end_date ?? null,
          note: cancellationReason === "payment_failed"
              ? "Stripe a annulé l’abonnement après l’échec définitif des relances. Le compte reste conservé mais bloqué."
              : "Stripe a confirmé la fin effective de l’abonnement.",
        }).catch(() => null);
      }
    }

    if (type === "invoice.payment_failed") {
      const invoice = obj;
      const subId = invoiceSubscriptionId(invoice);

      // Une facture ponctuelle ne doit jamais modifier l'accès à l'abonnement iNrCy.
      if (subId) {
        const customerId = invoiceCustomerId(invoice);
        const identity = invoiceUserIdentity(invoice);
        const userId = identity.userId;
        const email = invoiceCustomerEmail(invoice);
        if (identity.conflict) {
          console.warn("[stripe-webhook][invoice_metadata_conflict]", {
            eventType: type,
            hasSubscriptionId: true,
          });
        } else {
          const existingRow = await resolveSubscriptionRow(userId, customerId, subId, email);
          const stripeStatus = await getStripeSubscriptionStatus(subId);
          const targetStatus = paymentFailureStatus(existingRow?.status, stripeStatus);

          if (targetStatus) {
            await updateSubscriptionRow(
              userId,
              customerId,
              {
                billing_provider: "stripe",
                status: targetStatus,
                stripe_customer_id: customerId || existingRow?.stripe_customer_id || null,
                stripe_subscription_id: subId || existingRow?.stripe_subscription_id || null,
                ...(email ? { contact_email: email } : {}),
              },
              subId,
              email
            );
          }
        }
      }
    }

    if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
      const invoice = obj;
      const subId = invoiceSubscriptionId(invoice);

      // Même protection : seuls les paiements liés à un abonnement peuvent rétablir l'accès.
      if (subId) {
        const customerId = invoiceCustomerId(invoice);
        const identity = invoiceUserIdentity(invoice);
        const userId = identity.userId;
        const email = invoiceCustomerEmail(invoice);
        if (identity.conflict) {
          console.warn("[stripe-webhook][invoice_metadata_conflict]", {
            eventType: type,
            hasSubscriptionId: true,
          });
        } else {
          const existingRow = await resolveSubscriptionRow(userId, customerId, subId, email);
          const stripeStatus = await getStripeSubscriptionStatus(subId);
          const targetStatus = paymentSuccessStatus(existingRow?.status, stripeStatus);

          if (targetStatus) {
            await updateSubscriptionRow(
              userId,
              customerId,
              {
                billing_provider: "stripe",
                status: targetStatus,
                stripe_customer_id: customerId || existingRow?.stripe_customer_id || null,
                stripe_subscription_id: subId || existingRow?.stripe_subscription_id || null,
                ...(email ? { contact_email: email } : {}),
              },
              subId,
              email
            );
          }
        }
      }
    }

    await completeStripeWebhookEvent(evt);
    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    await failStripeWebhookEvent(evt, e).catch(() => null);
    return jsonUserFacingError(e, { status: 500, fallback: "Une erreur est survenue pendant la validation du paiement." });
  }
}
