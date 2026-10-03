import { NextResponse } from "next/server";
import { commercialPriceFromId, configuredPremiumPriceId, configuredStandardPriceId } from "@/lib/billingCatalog";
import { requireUser } from "@/lib/requireUser";
import { stripeGet, stripePost } from "@/lib/stripeRest";
import { stripeSubscriptionPeriodEndUnix } from "@/lib/stripeSubscription";
import {
  downgradeScheduleParams,
  isInrcyDowngradeSchedule,
  parsePlanChangeQuote,
  scheduledStandardPriceId,
  singleCommercialItem,
  stripeObjectId,
} from "@/lib/subscriptionPlanChange";

export const runtime = "nodejs";

type Plan = "Standard" | "Premium";
type LooseObject = Record<string, unknown>;

type SubscriptionRow = {
  app_edition?: string | null;
  billing_provider?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

class PlanChangeError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) {
    super(message);
  }
}

function record(value: unknown): LooseObject {
  return value && typeof value === "object" ? value as LooseObject : {};
}

function result(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function failure(error: unknown) {
  if (error instanceof PlanChangeError) {
    return result({ error: error.message, code: error.code }, error.status);
  }
  console.error("[billing-change-plan]", error instanceof Error ? error.message : "unknown_error");
  return result({ error: "Le changement de forfait est momentanément indisponible." }, 503);
}

async function loadContext() {
  const { supabase, user, errorResponse } = await requireUser();
  if (errorResponse) return { errorResponse } as const;
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new PlanChangeError("STRIPE_UNAVAILABLE", "La facturation est momentanément indisponible.", 503);
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("app_edition,billing_provider,stripe_customer_id,stripe_subscription_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  const row = data as SubscriptionRow | null;
  if (!row) throw new PlanChangeError("NO_SUBSCRIPTION", "Aucun abonnement n’a été trouvé pour ce compte.");
  if (String(row.app_edition || "").toLowerCase() === "founder") {
    throw new PlanChangeError("MANAGED_SUBSCRIPTION", "Ce forfait est géré avec l’équipe iNrCy.");
  }
  const provider = String(row.billing_provider || "").toLowerCase();
  if (provider === "app_store" || provider === "play_store") {
    throw new PlanChangeError(
      "NATIVE_MANAGEMENT_REQUIRED",
      provider === "app_store"
        ? "Changez votre formule depuis les abonnements de l’App Store."
        : "Changez votre formule depuis les abonnements Google Play.",
    );
  }
  const subscriptionId = row.stripe_subscription_id?.trim();
  const customerId = row.stripe_customer_id?.trim();
  if (!subscriptionId || !customerId) {
    throw new PlanChangeError("NO_STRIPE_SUBSCRIPTION", "Choisissez un forfait pour commencer votre abonnement.");
  }

  const subscription = record(await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`));
  if (stripeObjectId(subscription) !== subscriptionId || stripeObjectId(subscription.customer) !== customerId) {
    throw new PlanChangeError("STRIPE_IDENTITY_MISMATCH", "L’abonnement Stripe ne correspond pas à ce compte.");
  }
  const metadataUserId = record(subscription.metadata).user_id;
  if (typeof metadataUserId === "string" && metadataUserId && metadataUserId !== user.id) {
    throw new PlanChangeError("STRIPE_IDENTITY_MISMATCH", "L’abonnement Stripe ne correspond pas à ce compte.");
  }
  if (subscription.status !== "active") {
    throw new PlanChangeError("SUBSCRIPTION_NOT_ACTIVE", "Le changement de forfait sera disponible une fois l’abonnement actif.");
  }
  if (subscription.cancel_at || subscription.cancel_at_period_end === true || subscription.pending_update) {
    throw new PlanChangeError("SUBSCRIPTION_CHANGE_PENDING", "Une modification de facturation est déjà en cours.");
  }
  const item = singleCommercialItem(subscription);
  const current = item ? commercialPriceFromId(item.priceId) : null;
  if (!item || !current || item.billingCycle !== current.billingCycle) {
    throw new PlanChangeError("CUSTOM_SUBSCRIPTION", "Ce tarif doit être modifié avec l’équipe iNrCy.");
  }
  const periodEndUnix = stripeSubscriptionPeriodEndUnix(subscription);
  if (!periodEndUnix || periodEndUnix <= Math.floor(Date.now() / 1000)) {
    throw new PlanChangeError("PERIOD_UNKNOWN", "La date de renouvellement n’est pas disponible.");
  }
  const scheduleId = stripeObjectId(subscription.schedule);
  const schedule = scheduleId
    ? record(await stripeGet(`/subscription_schedules/${encodeURIComponent(scheduleId)}`))
    : null;

  return {
    userId: user.id,
    subscriptionId,
    customerId,
    subscription,
    item,
    current,
    periodEndUnix,
    scheduleId,
    schedule,
  } as const;
}

function targetPriceId(context: Exclude<Awaited<ReturnType<typeof loadContext>>, { errorResponse: NextResponse }>, target: Plan) {
  const configured = target === "Premium" ? configuredPremiumPriceId : configuredStandardPriceId;
  const priceId = configured(context.item.billingCycle, context.current.pricingVersion);
  if (!priceId) throw new PlanChangeError("TARGET_PRICE_UNAVAILABLE", "Ce tarif n’est pas disponible pour le moment.", 503);
  return priceId;
}

async function previewUpgrade(context: Exclude<Awaited<ReturnType<typeof loadContext>>, { errorResponse: NextResponse }>, prorationDate: number) {
  const params = new URLSearchParams();
  params.set("customer", context.customerId);
  params.set("subscription", context.subscriptionId);
  params.set("subscription_details[items][0][id]", context.item.id);
  params.set("subscription_details[items][0][price]", targetPriceId(context, "Premium"));
  params.set("subscription_details[proration_date]", String(prorationDate));
  const invoice = await stripePost("/invoices/create_preview", params);
  const quote = parsePlanChangeQuote(invoice, prorationDate);
  if (!quote || quote.currency !== "eur") {
    throw new PlanChangeError("QUOTE_UNAVAILABLE", "Le montant du prorata n’a pas pu être calculé.", 503);
  }
  return quote;
}

async function assertLastInvoicePaid(context: Exclude<Awaited<ReturnType<typeof loadContext>>, { errorResponse: NextResponse }>) {
  const invoiceId = stripeObjectId(context.subscription.latest_invoice);
  if (!invoiceId) return;
  const invoice = record(await stripeGet(`/invoices/${encodeURIComponent(invoiceId)}`));
  if (invoice.status !== "paid") {
    throw new PlanChangeError("UNPAID_INVOICE", "Régularisez d’abord votre dernière facture avant de changer de forfait.");
  }
}

function ownDowngrade(context: Exclude<Awaited<ReturnType<typeof loadContext>>, { errorResponse: NextResponse }>) {
  if (!context.schedule || !isInrcyDowngradeSchedule(context.schedule, context.userId)) return false;
  const standardPriceId = targetPriceId(context, "Standard");
  return scheduledStandardPriceId(context.schedule) === standardPriceId;
}

export async function GET(req: Request) {
  try {
    const context = await loadContext();
    if ("errorResponse" in context) return context.errorResponse;
    const target = new URL(req.url).searchParams.get("target");
    if (target !== "Standard" && target !== "Premium") {
      throw new PlanChangeError("INVALID_TARGET", "Forfait inconnu.", 400);
    }
    const pendingDowngrade = ownDowngrade(context);
    if (context.scheduleId && !pendingDowngrade) {
      throw new PlanChangeError("SCHEDULE_MANAGED", "Une modification d’abonnement existe déjà dans Stripe.");
    }
    if (target.toLowerCase() === context.current.edition) {
      return result({ currentPlan: context.current.plan, pendingDowngrade,
        renewalAt: new Date(context.periodEndUnix * 1000).toISOString() });
    }
    if (target === "Standard") {
      return result({ currentPlan: context.current.plan, pendingDowngrade,
        renewalAt: new Date(context.periodEndUnix * 1000).toISOString(),
        targetPriceId: targetPriceId(context, "Standard") });
    }
    await assertLastInvoicePaid(context);
    const quote = await previewUpgrade(context, Math.floor(Date.now() / 1000));
    return result({ currentPlan: context.current.plan, quote,
      renewalAt: new Date(context.periodEndUnix * 1000).toISOString() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(req: Request) {
  try {
    const context = await loadContext();
    if ("errorResponse" in context) return context.errorResponse;
    const body = record(await req.json().catch(() => ({})));
    const target = body.targetPlan;
    if (target !== "Standard" && target !== "Premium") {
      throw new PlanChangeError("INVALID_TARGET", "Forfait inconnu.", 400);
    }
    if (target.toLowerCase() === context.current.edition) {
      throw new PlanChangeError("ALREADY_ON_PLAN", `Vous êtes déjà sur l’offre ${target}.`);
    }

    if (target === "Premium") {
      if (context.scheduleId) {
        throw new PlanChangeError("SCHEDULE_MANAGED", "Une modification d’abonnement existe déjà dans Stripe.");
      }
      if (context.subscription.collection_method !== "charge_automatically") {
        throw new PlanChangeError("MANUAL_COLLECTION", "Ce mode de paiement doit être modifié avec l’équipe iNrCy.");
      }
      await assertLastInvoicePaid(context);
      const prorationDate = Number(body.prorationDate);
      const expectedAmountDue = Number(body.expectedAmountDue);
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isSafeInteger(prorationDate) || prorationDate > now || prorationDate < now - 600 ||
          !Number.isSafeInteger(expectedAmountDue) || expectedAmountDue < 0) {
        throw new PlanChangeError("QUOTE_EXPIRED", "Le calcul du prorata a expiré. Actualisez le montant.");
      }
      const quote = await previewUpgrade(context, prorationDate);
      if (quote.amountDue !== expectedAmountDue) {
        throw new PlanChangeError("QUOTE_CHANGED", "Le montant a changé. Vérifiez le nouveau prorata avant de confirmer.");
      }
      const params = new URLSearchParams();
      params.set("items[0][id]", context.item.id);
      params.set("items[0][price]", targetPriceId(context, "Premium"));
      params.set("payment_behavior", "pending_if_incomplete");
      params.set("proration_behavior", "always_invoice");
      params.set("proration_date", String(prorationDate));
      params.set("expand[]", "latest_invoice");
      const updated = record(await stripePost(
        `/subscriptions/${encodeURIComponent(context.subscriptionId)}`,
        params,
        { idempotencyKey: `inrcy-upgrade-premium-${context.subscriptionId}-${prorationDate}` },
      ));
      const applied = !updated.pending_update &&
        singleCommercialItem(updated)?.priceId === targetPriceId(context, "Premium");
      const hostedInvoiceUrl = record(updated.latest_invoice).hosted_invoice_url;
      const paymentUrl = typeof hostedInvoiceUrl === "string" &&
        (() => { try { return new URL(hostedInvoiceUrl).protocol === "https:"; } catch { return false; } })()
          ? hostedInvoiceUrl
          : null;
      return result({ applied, pendingPayment: Boolean(updated.pending_update), paymentUrl });
    }

    if (ownDowngrade(context)) {
      return result({ scheduled: true, renewalAt: new Date(context.periodEndUnix * 1000).toISOString() });
    }
    if (context.scheduleId) {
      throw new PlanChangeError("SCHEDULE_MANAGED", "Une modification d’abonnement existe déjà dans Stripe.");
    }
    const createParams = new URLSearchParams({ from_subscription: context.subscriptionId });
    const created = record(await stripePost("/subscription_schedules", createParams, {
      idempotencyKey: `inrcy-downgrade-schedule-${context.subscriptionId}-${context.periodEndUnix}`,
    }));
    const createdId = stripeObjectId(created);
    if (!createdId || stripeObjectId(created.subscription) !== context.subscriptionId) {
      throw new PlanChangeError("SCHEDULE_CREATION_FAILED", "Le changement à échéance n’a pas pu être programmé.", 503);
    }
    const scheduleParams = downgradeScheduleParams({
      schedule: created,
      currentPriceId: context.item.priceId,
      nextPriceId: targetPriceId(context, "Standard"),
      periodEndUnix: context.periodEndUnix,
      userId: context.userId,
    });
    if (!scheduleParams) {
      await stripePost(`/subscription_schedules/${encodeURIComponent(createdId)}/release`, new URLSearchParams());
      throw new PlanChangeError("SCHEDULE_UNSUPPORTED", "Ce contrat doit être modifié avec l’équipe iNrCy.");
    }
    try {
      await stripePost(`/subscription_schedules/${encodeURIComponent(createdId)}`, scheduleParams, {
        idempotencyKey: `inrcy-downgrade-update-${createdId}-${context.periodEndUnix}`,
      });
    } catch (error) {
      await stripePost(`/subscription_schedules/${encodeURIComponent(createdId)}/release`, new URLSearchParams())
        .catch(() => null);
      throw error;
    }
    return result({ scheduled: true, renewalAt: new Date(context.periodEndUnix * 1000).toISOString() });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE() {
  try {
    const context = await loadContext();
    if ("errorResponse" in context) return context.errorResponse;
    if (!context.scheduleId || !ownDowngrade(context) || context.current.edition !== "premium") {
      throw new PlanChangeError("NO_DOWNGRADE_SCHEDULED", "Aucun passage à Standard n’est programmé.");
    }
    await stripePost(`/subscription_schedules/${encodeURIComponent(context.scheduleId)}/release`,
      new URLSearchParams());
    return result({ canceled: true });
  } catch (error) {
    return failure(error);
  }
}
