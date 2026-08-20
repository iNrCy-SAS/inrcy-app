import { NextResponse } from "next/server";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { stripeGet, verifyStripeWebhookSignature } from "@/lib/stripeRest";
import { optionalEnv } from "@/lib/env";
import { commercialPriceFromId } from "@/lib/billingCatalog";
import { stripeSubscriptionPeriodEndIso } from "@/lib/stripeSubscription";
import { sendAdminSubscriptionAlertForUser } from "@/lib/subscriptionAdmin";
import {
  invoiceCustomerEmail,
  invoiceCustomerId,
  invoiceSubscriptionId,
  invoiceUserId,
  paymentFailureStatus,
  paymentSuccessStatus,
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

function normalizeStripeStatus(status: string): string {
  const s = String(status || "").toLowerCase();
  const allowed = new Set([
    "incomplete",
    "incomplete_expired",
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
  ]);
  return allowed.has(s) ? s : "incomplete";
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

function stripePriceAmountForIntegerColumn(price: StripeObjectLoose | null | undefined, quantity = 1): number | null {
  if (!price) return null;

  const amountRaw = price.unit_amount ?? price.unit_amount_decimal;
  const amountCents = Number(amountRaw);
  const normalizedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  if (!Number.isFinite(amountCents) || amountCents < 0) return null;

  const amountEur = (amountCents * normalizedQuantity) / 100;

  // La colonne actuelle monthly_price_eur est entière (int4) dans Supabase.
  // On refuse donc d'inventer/arrondir un prix Stripe avec des centimes.
  return Number.isInteger(amountEur) ? amountEur : null;
}

async function resolveStripeStoredPrice(
  price: StripeObjectLoose | null | undefined,
  priceId: string | null,
  quantity = 1
): Promise<number | null> {
  const inlineAmount = stripePriceAmountForIntegerColumn(price, quantity);
  if (inlineAmount != null) return inlineAmount;
  if (!priceId) return null;

  try {
    const fetchedPrice = (await stripeGet(`/prices/${encodeURIComponent(priceId)}`)) as StripeObjectLoose;
    return stripePriceAmountForIntegerColumn(fetchedPrice, quantity);
  } catch {
    // Un webhook de statut ne doit pas échouer uniquement parce que Stripe Price
    // n'a pas pu être relu. La valeur DB existante reste alors intacte.
    return null;
  }
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

async function findUniqueSubscriptionBy(column: string, value?: string | null) {
  const cleaned = String(value || "").trim();
  if (!cleaned) return null;

  const query = supabaseAdmin
    .from("subscriptions")
    .select(SUBSCRIPTION_SELECT)
    .limit(2);
  const { data, error } = column === "contact_email"
    ? await query.ilike(column, exactIlikePattern(cleaned))
    : await query.eq(column, cleaned);

  if (error) throw error;
  const rows = (data as SubscriptionSnapshot[] | null) ?? [];
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) {
    console.warn(`[stripe-webhook] Correspondance subscriptions ambigue pour ${column}.`);
  }
  return null;
}

async function findUserIdByEmail(email?: string | null) {
  const variants = normalizedEmailVariants(email);
  if (!variants.length) return null;

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

  return userIds.size === 1 ? Array.from(userIds)[0] : null;
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
  email?: string | null
) {
  let resolvedUserId = userId || null;
  let resolvedEmail = email || null;

  for (const lookup of [
    ["user_id", resolvedUserId],
    ["stripe_subscription_id", subscriptionId],
    ["stripe_customer_id", customerId],
  ] as const) {
    const row = await findUniqueSubscriptionBy(lookup[0], lookup[1]);
    if (row) return row;
  }

  if (!resolvedUserId && customerId) {
    const hints = await getStripeCustomerHints(customerId);
    resolvedUserId = hints.userId;
    resolvedEmail = resolvedEmail || hints.email;

    if (resolvedUserId) {
      const row = await findUniqueSubscriptionBy("user_id", resolvedUserId);
      if (row) return row;
    }
  }

  for (const emailVariant of normalizedEmailVariants(resolvedEmail)) {
    const row = await findUniqueSubscriptionBy("contact_email", emailVariant);
    if (row) return row;
  }

  const profileUserId = await findUserIdByEmail(resolvedEmail);
  if (profileUserId) return findUniqueSubscriptionBy("user_id", profileUserId);

  return null;
}

async function getStripeSubscriptionStatus(subscriptionId?: string | null) {
  if (!subscriptionId) return null;
  try {
    const subscription = (await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`)) as StripeObjectLoose;
    return normalizeStripeStatus(String(subscription?.status || ""));
  } catch {
    return null;
  }
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

  const updateSubscriptionRow = async (
    userId: string | null | undefined,
    customerId: string | null | undefined,
    patch: Record<string, unknown>,
    subscriptionId?: string | null,
    email?: string | null
  ) => {
    const existingRow = await getSubscriptionRow(userId, customerId, subscriptionId, email);
    if (!existingRow?.user_id) {
      const details = {
        eventId: typeof evt.id === "string" ? evt.id : null,
        eventType: String(evt.type || "unknown"),
        hasUserId: Boolean(userId),
        hasCustomerId: Boolean(customerId),
        hasSubscriptionId: Boolean(subscriptionId),
        hasEmail: Boolean(email),
      };
      if (userId || evt.type === "checkout.session.completed") {
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
      return existingRow;
    }

    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("user_id", existingRow.user_id)
      .select(SUBSCRIPTION_SELECT)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error("La synchronisation Stripe n'a modifie aucun abonnement Supabase.");
    return data as SubscriptionSnapshot;
  };

  try {
    const type = String(evt.type || "");
    const obj = (evt.data?.object ?? null) as StripeObjectLoose | null;
    const previous = (evt.data?.previous_attributes ?? {}) as StripeObjectLoose;

    if (type === "checkout.session.completed") {
      const session = obj;
      const metadata = (session?.metadata as StripeObjectLoose | undefined) ?? undefined;
      const userId = typeof metadata?.user_id === "string" ? metadata.user_id : null;
      const customerId = stripeObjectId(session?.customer);
      const subId = stripeObjectId(session?.subscription);
      const customerDetails = (session?.customer_details as StripeObjectLoose | undefined) ?? undefined;
      const email =
        (typeof customerDetails?.email === "string" ? customerDetails.email : null) ||
        (typeof session?.customer_email === "string" ? session.customer_email : null);
      const billingCycle = typeof metadata?.billing_cycle === "string" ? metadata.billing_cycle : null;

      await updateSubscriptionRow(
        userId,
        customerId,
        {
          billing_provider: "stripe",
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subId || null,
          ...(billingCycle === "monthly" || billingCycle === "yearly"
            ? { billing_cycle: billingCycle }
            : {}),
          ...(email ? { contact_email: email } : {}),
        },
        subId,
        email
      );

      if (userId) {
        const row = await getSubscriptionRow(userId, customerId, subId, email);
        await sendAdminSubscriptionAlertForUser({
          type: "checkout_completed",
          source: "stripe.webhook.checkout.session.completed",
          userId,
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
      const sub = obj;
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
      const recurring = (priceObj?.recurring as StripeObjectLoose | undefined) ?? undefined;
      const recurringInterval = String(recurring?.interval || "").toLowerCase();
      const billingCycle = commercialPrice?.billingCycle ??
        (recurringInterval === "year"
          ? "yearly"
          : recurringInterval === "month"
            ? "monthly"
            : null);
      const inrcyPlan = planFromPriceId(priceId);
      const quantityRaw = Number(firstItem?.quantity ?? 1);
      const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
      const existingRow = await getSubscriptionRow(userId, customerId, subId);
      const currentStoredPrice = storedDbPrice(existingRow?.monthly_price_eur);
      const stripeStoredPrice = await resolveStripeStoredPrice(priceObj, priceId, quantity);
      const existingEdition = String(existingRow?.app_edition || "").trim().toLowerCase();
      const founderAccount = existingEdition === "founder";
      const shouldKeepTrialPlan = stripeStatus === "trialing";
      const existingWasTrial =
        String(existingRow?.plan || "").toLowerCase() === "trial" ||
        String(existingRow?.status || "").toLowerCase() === "trialing";

      // Une valeur déjà présente dans Supabase est volontairement prioritaire :
      // elle peut venir d'un tarif négocié saisi manuellement. Pour un nouvel abonnement
      // automatique (prix absent ou sortie d'essai), on enregistre le montant réel Stripe.
      const shouldAutofillPriceFromStripe =
        !shouldKeepTrialPlan &&
        stripeStoredPrice != null &&
        (currentStoredPrice == null || (existingWasTrial && currentStoredPrice === 0));
      const cancellationTimestamp = cancellationScheduled
        ? existingRow?.cancel_requested_at || new Date().toISOString()
        : null;
      const cancellationEnd = cancelAt || (cancelAtPeriodEnd ? currentPeriodEnd : null);
      const commercialMonthlyPrice =
        commercialPrice && !founderAccount ? commercialPrice.monthlyReferenceEur : null;

      await updateSubscriptionRow(userId, customerId, {
        billing_provider: "stripe",
        status: stripeStatus,
        stripe_customer_id: customerId || null,
        stripe_subscription_id: subId || null,
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
              ...(commercialMonthlyPrice != null
                ? { monthly_price_eur: commercialMonthlyPrice }
                : shouldAutofillPriceFromStripe
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

      const row = await getSubscriptionRow(userId, customerId, subId);
      const resolvedUserId = userId || row?.user_id || null;
      if (resolvedUserId) {
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

      await updateSubscriptionRow(
        userId,
        customerId,
        {
          billing_provider: "stripe",
          status: "canceled",
          stripe_customer_id: customerId || null,
          stripe_subscription_id: subId || null,
          end_date: endedAt ? endedAt.slice(0, 10) : null,
          // Une annulation automatique pour impaye bloque le compte, sans demander sa suppression.
          ...(cancellationReason === "payment_failed" ? { cancel_requested_at: null } : {}),
        },
        subId
      );

      const row = await getSubscriptionRow(userId, customerId, subId);
      const resolvedUserId = userId || row?.user_id || null;
      if (resolvedUserId) {
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
        const userId = invoiceUserId(invoice);
        const email = invoiceCustomerEmail(invoice);
        const existingRow = await getSubscriptionRow(userId, customerId, subId, email);
        const stripeStatus = await getStripeSubscriptionStatus(subId);
        const targetStatus = paymentFailureStatus(existingRow?.status, stripeStatus);

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

    if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
      const invoice = obj;
      const subId = invoiceSubscriptionId(invoice);

      // Même protection : seuls les paiements liés à un abonnement peuvent rétablir l'accès.
      if (subId) {
        const customerId = invoiceCustomerId(invoice);
        const userId = invoiceUserId(invoice);
        const email = invoiceCustomerEmail(invoice);
        const existingRow = await getSubscriptionRow(userId, customerId, subId, email);
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

    await completeStripeWebhookEvent(evt);
    return NextResponse.json({ received: true });
  } catch (e: unknown) {
    await failStripeWebhookEvent(evt, e).catch(() => null);
    return jsonUserFacingError(e, { status: 500, fallback: "Une erreur est survenue pendant la validation du paiement." });
  }
}
