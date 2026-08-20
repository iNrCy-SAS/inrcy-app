import { NextResponse } from "next/server";
import { configuredStandardPriceId } from "@/lib/billingCatalog";
import { resolveDashboardEdition } from "@/lib/dashboardEdition";
import { requireUser } from "@/lib/requireUser";
import { getAppUrl, stripeGet, stripePost } from "@/lib/stripeRest";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type BillingCycle } from "@/lib/subscriptionOffers";
import { computeTrialDatesFromStartDate, getTrialDays } from "@/lib/trialSubscription";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

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
};

type ProfileRow = {
  admin_email?: string | null;
  contact_email?: string | null;
};

type StripeSubscriptionList = {
  data?: Array<{ id?: string | null; status?: string | null }>;
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

function requestedStandardPlan(value: unknown): boolean {
  const normalized = String(value ?? "Standard").trim().toLowerCase();
  return normalized === "standard" || normalized === "inrcy standard" || normalized === "inrcy-standard";
}

async function findLiveStripeSubscription(customerId: string) {
  const query = new URLSearchParams({ customer: customerId, status: "all", limit: "100" });
  const response = (await stripeGet(`/subscriptions?${query.toString()}`)) as StripeSubscriptionList;
  return (response.data ?? []).find((subscription) =>
    STRIPE_LIVE_SUBSCRIPTION_STATUSES.has(normalizeStatus(subscription.status)),
  ) ?? null;
}

export async function POST(req: Request) {
  try {
    const monthlyPriceId = configuredStandardPriceId("monthly");
    const yearlyPriceId = configuredStandardPriceId("yearly");
    if (!process.env.STRIPE_SECRET_KEY || !monthlyPriceId || !yearlyPriceId) {
      return NextResponse.json(
        { error: "Le paiement n’est pas disponible pour le moment." },
        { status: 503 },
      );
    }

    const { supabase, user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const body: unknown = await req.json().catch(() => ({}));
    const requestedPlan = (body as { plan?: unknown } | null)?.plan;
    if (!requestedStandardPlan(requestedPlan)) {
      return NextResponse.json(
        {
          error: "Le passage à iNrCy Premium nécessite un échange avec notre équipe.",
          code: "PREMIUM_CONTACT_REQUIRED",
          redirectTo: "/dashboard?panel=contact",
        },
        { status: 403 },
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
            "stripe_customer_id, stripe_subscription_id, status, app_edition, plan, start_date, trial_start_at, trial_end_at, contact_email, billing_provider",
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
        { error: "Votre abonnement Standard n’a pas encore été initialisé." },
        { status: 409 },
      );
    }

    const edition = resolveDashboardEdition({
      edition: row.app_edition,
      plan: row.plan,
      developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
    });
    if (edition !== "standard") {
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
      (Boolean(row.stripe_subscription_id) || currentStatus !== "trialing");
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
    if (customerId) {
      const existingStripeSubscription = await findLiveStripeSubscription(customerId);
      if (existingStripeSubscription?.id) {
        await supabaseAdmin
          .from("subscriptions")
        .update({
          stripe_subscription_id: existingStripeSubscription.id,
          billing_provider: "stripe",
          status: normalizeStatus(existingStripeSubscription.status),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId);

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

      await supabaseAdmin
        .from("subscriptions")
        .update({
          stripe_customer_id: customerId,
          billing_provider: "stripe",
          contact_email: email,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
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
      await supabaseAdmin
        .from("subscriptions")
        .update({
          trial_start_at: trialStartAt,
          trial_end_at: effectiveTrialEndAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
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
    sessionParams.set("metadata[user_id]", userId);
    sessionParams.set("metadata[plan]", "Standard");
    sessionParams.set("metadata[app_edition]", "standard");
    sessionParams.set("metadata[billing_cycle]", billingCycle);
    sessionParams.set("subscription_data[metadata][user_id]", userId);
    sessionParams.set("subscription_data[metadata][plan]", "Standard");
    sessionParams.set("subscription_data[metadata][app_edition]", "standard");
    sessionParams.set("subscription_data[metadata][billing_cycle]", billingCycle);
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
      idempotencyKey: `checkout-standard-v1-${userId}-${priceId}-${effectiveTrialEndUnix || "immediate"}-${checkoutAttemptBucket}`,
    });
    if (typeof session?.url !== "string" || !session.url) {
      throw new Error("La page de paiement n’a pas pu être créée.");
    }

    await supabaseAdmin
      .from("subscriptions")
      .update({
        app_edition: "standard",
        stripe_price_id: priceId,
        billing_cycle: billingCycle,
        scheduled_plan: "Standard",
        contact_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const message = getSimpleFrenchErrorMessage(
      error,
      "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.",
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
