import { NextResponse } from "next/server";
import { commercialPriceFromId, configuredPremiumPriceId, configuredStandardPriceId } from "@/lib/billingCatalog";
import { resolveDashboardEdition } from "@/lib/dashboardEdition";
import { requireUser } from "@/lib/requireUser";
import { getAppUrl, stripeGet, stripePost } from "@/lib/stripeRest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  pricingVersionForAccountCreatedAt,
  type BillingCycle,
} from "@/lib/subscriptionOffers";
import { computeTrialDatesFromStartDate, getTrialDays } from "@/lib/trialSubscription";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { canStartSubscriptionCheckout } from "@/lib/subscriptionCheckoutPolicy";
import { findLiveStripeSubscriptions, inspectComplimentaryCheckout } from "@/lib/stripeCheckoutPreflight";

export const runtime = "nodejs";

type SubscriptionRow = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  status?: string | null;
  app_edition?: string | null;
  plan?: string | null;
  start_date?: string | null;
  trial_start_at?: string | null;
  trial_end_at?: string | null;
  contact_email?: string | null;
  billing_provider?: string | null;
  native_product_id?: string | null;
};

type ProfileRow = {
  admin_email?: string | null;
  contact_email?: string | null;
};

const STRIPE_MIN_TRIAL_SECONDS = 2 * 24 * 60 * 60;
const STRIPE_LIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
  "incomplete",
]);

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBillingCycle(value: unknown): BillingCycle {
  return String(value ?? "").trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
}

function requestedCommercialPlan(value: unknown): "Standard" | "Premium" | null {
  const normalized = String(value ?? "Standard").trim().toLowerCase();
  if (["standard", "inrcy standard", "inrcy-standard"].includes(normalized)) return "Standard";
  if (["premium", "inrcy premium", "inrcy-premium"].includes(normalized)) return "Premium";
  return null;
}

async function updateSubscriptionOrThrow(
  userId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw error;
}

async function findLiveStripeSubscription(customerId: string) {
  const subscriptions = await findLiveStripeSubscriptions(customerId, stripeGet);
  if (subscriptions.length > 1) throw new Error("stripe_checkout_identity_ambiguous");
  return subscriptions[0] ?? null;
}

export async function POST(req: Request) {
  try {
    const { supabase, user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const body: unknown = await req.json().catch(() => ({}));
    const requestedPlan = requestedCommercialPlan((body as { plan?: unknown } | null)?.plan);
    if (!requestedPlan) {
      return NextResponse.json({ error: "Forfait inconnu." }, { status: 400 });
    }

    const pricingVersion = pricingVersionForAccountCreatedAt(user.created_at);
    const priceForCycle = requestedPlan === "Premium" ? configuredPremiumPriceId : configuredStandardPriceId;
    const monthlyPriceId = priceForCycle("monthly", pricingVersion);
    const yearlyPriceId = priceForCycle("yearly", pricingVersion);
    if (!process.env.STRIPE_SECRET_KEY || !monthlyPriceId || !yearlyPriceId) {
      return NextResponse.json(
        { error: "Le paiement n’est pas disponible pour le moment." },
        { status: 503 },
      );
    }

    const billingCycle = normalizeBillingCycle(
      (body as { billingCycle?: unknown; billing?: unknown } | null)?.billingCycle ??
        (body as { billing?: unknown } | null)?.billing,
    );
    const priceId = billingCycle === "yearly" ? yearlyPriceId : monthlyPriceId;
    const userId = user.id;

    const [{ data: subscriptionData, error: subscriptionError }, { data: profileData, error: profileError }] =
      await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "stripe_customer_id, stripe_subscription_id, status, app_edition, plan, start_date, trial_start_at, trial_end_at, contact_email, billing_provider, native_product_id",
          )
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("admin_email, contact_email")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

    if (subscriptionError) throw new Error(subscriptionError.message);
    if (profileError) throw new Error(profileError.message);

    const row = subscriptionData as SubscriptionRow | null;
    const profile = profileData as ProfileRow | null;
    if (!row) {
      return NextResponse.json(
        { error: "Votre abonnement n’a pas encore été initialisé." },
        { status: 409 },
      );
    }

    const edition = resolveDashboardEdition({
      edition: row.app_edition,
      plan: row.plan,
      developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
    });
    if (edition === "founder") {
      return NextResponse.json(
        {
          error: "Votre forfait est géré avec l’équipe iNrCy.",
          code: "MANAGED_SUBSCRIPTION",
          redirectTo: "/dashboard?panel=contact",
        },
        { status: 403 },
      );
    }

    const currentStatus = normalizeStatus(row.status);
    const billingProvider = normalizeStatus(row.billing_provider);
    const nativeSubscriptionIsLive =
      (billingProvider === "app_store" || billingProvider === "play_store") &&
      STRIPE_LIVE_SUBSCRIPTION_STATUSES.has(currentStatus);
    if (nativeSubscriptionIsLive) {
      return NextResponse.json(
        {
          error: "Ce compte possède déjà un abonnement mobile actif. Il est utilisable sur la web app.",
          code: "NATIVE_SUBSCRIPTION_ALREADY_EXISTS",
        },
        { status: 409 },
      );
    }

    const localSubscriptionIsLive =
      STRIPE_LIVE_SUBSCRIPTION_STATUSES.has(currentStatus) &&
      !canStartSubscriptionCheckout(row, requestedPlan);
    if (localSubscriptionIsLive) {
      return NextResponse.json(
        {
          error: "Un abonnement est déjà en cours pour ce compte.",
          code: "SUBSCRIPTION_ALREADY_EXISTS",
        },
        { status: 409 },
      );
    }

    const email =
      profile?.admin_email?.trim() ||
      profile?.contact_email?.trim() ||
      row.contact_email?.trim() ||
      user.email?.trim() ||
      null;
    if (!email) {
      return NextResponse.json({ error: "Adresse email manquante." }, { status: 400 });
    }

    let customerId = row.stripe_customer_id?.trim() || null;
    const complimentaryUpgrade = currentStatus === "active" && canStartSubscriptionCheckout(row, requestedPlan);
    if (complimentaryUpgrade) {
      let preflight;
      try {
        preflight = await inspectComplimentaryCheckout({
          userId,
          customerId,
          emails: [user.email, profile?.admin_email, profile?.contact_email, row.contact_email],
          get: stripeGet,
          hasOtherOwner: async (customerIds, subscriptionIds) => {
            const queries = [supabaseAdmin.from("subscriptions").select("user_id")
              .neq("user_id", userId).in("stripe_customer_id", customerIds).limit(1)];
            if (subscriptionIds.length) queries.push(supabaseAdmin.from("subscriptions").select("user_id")
              .neq("user_id", userId).in("stripe_subscription_id", subscriptionIds).limit(1));
            const results = await Promise.all(queries);
            for (const result of results) if (result.error) throw result.error;
            return results.some((result) => Boolean(result.data?.length));
          },
        });
      } catch {
        return NextResponse.json({
          error: "Votre facturation n’a pas pu être vérifiée. Aucun nouveau paiement n’a été créé. Réessayez dans quelques minutes.",
          code: "BILLING_VERIFICATION_REQUIRED",
        }, { status: 409 });
      }
      customerId = preflight.customerId;
      const recovered = preflight.existingSubscription;
      if (recovered) {
        // Only restore the missing billing link. Entitlements still belong to
        // Stripe webhooks, and a paid upgrade still requires its proration quote.
        let update = supabaseAdmin.from("subscriptions").update({
          stripe_customer_id: recovered.customerId,
          stripe_subscription_id: recovered.id,
          billing_provider: "stripe",
          status: recovered.status,
          updated_at: new Date().toISOString(),
        }).eq("user_id", userId).eq("status", row.status ?? "");
        update = row.stripe_subscription_id == null
          ? update.is("stripe_subscription_id", null) : update.eq("stripe_subscription_id", row.stripe_subscription_id);
        update = row.stripe_customer_id == null
          ? update.is("stripe_customer_id", null) : update.eq("stripe_customer_id", row.stripe_customer_id);
        update = row.billing_provider == null
          ? update.is("billing_provider", null) : update.eq("billing_provider", row.billing_provider);
        const { data: linked, error: linkError } = await update.select("user_id").maybeSingle();
        if (linkError) throw linkError;
        if (!linked) return NextResponse.json({ error: "Votre abonnement a changé. Rechargez la page avant de réessayer." }, { status: 409 });
        return NextResponse.json({
          recoveredSubscription: true,
          nextAction: recovered.status === "active" && commercialPriceFromId(recovered.priceId)?.plan === "Standard"
            ? "change_plan" : "reload",
        });
      }
      if (customerId && customerId !== row.stripe_customer_id) {
        await updateSubscriptionOrThrow(userId, { stripe_customer_id: customerId, billing_provider: "stripe", updated_at: new Date().toISOString() });
      }
    } else if (customerId) {
      const existingStripeSubscription = await findLiveStripeSubscription(customerId);
      if (existingStripeSubscription?.id) {
        await updateSubscriptionOrThrow(userId, {
          stripe_subscription_id: existingStripeSubscription.id,
          billing_provider: "stripe",
          status: normalizeStatus(existingStripeSubscription.status),
          updated_at: new Date().toISOString(),
        });

        return NextResponse.json(
          {
            error: "Un abonnement Stripe existe déjà. Ouvrez la facturation pour le gérer.",
            code: "STRIPE_SUBSCRIPTION_ALREADY_EXISTS",
          },
          { status: 409 },
        );
      }
    }

    if (!customerId) {
      const customerParams = new URLSearchParams();
      customerParams.set("email", email);
      customerParams.set("metadata[user_id]", userId);
      const customer = await stripePost("/customers", customerParams, {
        idempotencyKey: `customer-create-${userId}`,
      });
      customerId = typeof customer?.id === "string" ? customer.id : null;
      if (!customerId) throw new Error("Le compte de facturation n’a pas pu être créé.");

      await updateSubscriptionOrThrow(userId, {
        stripe_customer_id: customerId,
        billing_provider: "stripe",
        contact_email: email,
        updated_at: new Date().toISOString(),
      });
    }

    const nowUnix = Math.floor(Date.now() / 1000);
    let trialStartAt = row.trial_start_at || null;
    let trialEndAt = row.trial_end_at || null;
    if (currentStatus === "trialing" && !trialEndAt) {
      const startYmd = row.start_date || trialStartAt?.slice(0, 10) || null;
      if (startYmd) {
        const computed = computeTrialDatesFromStartDate(startYmd, getTrialDays());
        trialStartAt ||= computed.trialStartAt;
        trialEndAt = computed.trialEndAt;
      }
    }

    const rawTrialEndUnix = trialEndAt ? Math.floor(new Date(trialEndAt).getTime() / 1000) : NaN;
    const trialIsStillOpen =
      currentStatus === "trialing" &&
      Number.isFinite(rawTrialEndUnix) &&
      rawTrialEndUnix > nowUnix + 60;
    const effectiveTrialEndUnix = trialIsStillOpen
      ? Math.max(rawTrialEndUnix, nowUnix + STRIPE_MIN_TRIAL_SECONDS)
      : null;
    const technicalTrialExtension =
      effectiveTrialEndUnix !== null && effectiveTrialEndUnix > rawTrialEndUnix;

    if (trialIsStillOpen) {
      const effectiveTrialEndAt = new Date(effectiveTrialEndUnix! * 1000).toISOString();
      await updateSubscriptionOrThrow(userId, {
        trial_start_at: trialStartAt,
        trial_end_at: effectiveTrialEndAt,
        updated_at: new Date().toISOString(),
      });
    }

    const appUrl = getAppUrl(req);
    const sessionParams = new URLSearchParams();
    sessionParams.set("mode", "subscription");
    sessionParams.set("customer", customerId);
    sessionParams.set("line_items[0][price]", priceId);
    sessionParams.set("line_items[0][quantity]", "1");
    sessionParams.set(
      "success_url",
      `${appUrl}/dashboard?panel=abonnement&checkout=success&billing=${billingCycle}`,
    );
    sessionParams.set("cancel_url", `${appUrl}/dashboard?panel=abonnement&checkout=cancel`);
    sessionParams.set("client_reference_id", userId);
    sessionParams.set("metadata[user_id]", userId);
    sessionParams.set("metadata[plan]", requestedPlan);
    sessionParams.set("metadata[app_edition]", requestedPlan.toLowerCase());
    sessionParams.set("metadata[billing_cycle]", billingCycle);
    sessionParams.set("metadata[pricing_version]", pricingVersion);
    sessionParams.set("subscription_data[metadata][user_id]", userId);
    sessionParams.set("subscription_data[metadata][plan]", requestedPlan);
    sessionParams.set("subscription_data[metadata][app_edition]", requestedPlan.toLowerCase());
    sessionParams.set("subscription_data[metadata][billing_cycle]", billingCycle);
    sessionParams.set("subscription_data[metadata][pricing_version]", pricingVersion);
    sessionParams.set(
      "subscription_data[metadata][trial_behavior]",
      effectiveTrialEndUnix
        ? technicalTrialExtension
          ? "technical_minimum_extension"
          : "keep_trial_end"
        : "start_now_after_trial",
    );
    if (effectiveTrialEndUnix) {
      sessionParams.set("subscription_data[trial_end]", String(effectiveTrialEndUnix));
    }

    sessionParams.set("automatic_tax[enabled]", "true");
    sessionParams.set("billing_address_collection", "required");
    sessionParams.set("tax_id_collection[enabled]", "true");
    sessionParams.set("customer_update[address]", "auto");
    sessionParams.set("customer_update[name]", "auto");
    sessionParams.set("payment_method_collection", "always");

    // Conserve l'idempotence contre les doubles clics, tout en autorisant une
    // nouvelle tentative si une ancienne session Checkout a expiré.
    const checkoutAttemptBucket = Math.floor(Date.now() / (15 * 60 * 1000));
    const session = await stripePost("/checkout/sessions", sessionParams, {
      idempotencyKey: `checkout-commercial-v2-${userId}-${priceId}-${effectiveTrialEndUnix || "immediate"}-${checkoutAttemptBucket}`,
    });
    if (typeof session?.url !== "string" || !session.url) {
      throw new Error("La page de paiement n’a pas pu être créée.");
    }

    await updateSubscriptionOrThrow(userId, {
      // Le webhook Stripe attribue l'edition seulement lorsque l'abonnement
      // existe effectivement. Une session Checkout abandonnee ne donne aucun droit.
      stripe_price_id: priceId,
      billing_cycle: billingCycle,
      scheduled_plan: requestedPlan,
      contact_email: email,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const message = getSimpleFrenchErrorMessage(
      error,
      "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.",
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
