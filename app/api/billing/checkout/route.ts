import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireEnv } from "@/lib/env";
import { getAppUrl, stripePost } from "@/lib/stripeRest";
import { computeTrialDatesFromStartDate, getTrialDays } from "@/lib/trialSubscription";
import { resolveDashboardEdition } from "@/lib/dashboardEdition";

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
  founder_offer_enabled?: boolean | null;
};

type ProfileRow = {
  admin_email?: string | null;
  contact_email?: string | null;
};

type BillingCycle = "monthly" | "yearly";

function hasStripeConfig() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_PRICE_STARTER_ID &&
      process.env.STRIPE_PRICE_ACCEL_ID
  );
}

function normalizeWantedPlan(plan: string) {
  if (plan === "Starter" || plan === "Accel") return plan;
  return null;
}

export async function POST(req: Request) {
  try {
    if (!hasStripeConfig()) {
      return NextResponse.json(
        { error: "Le paiement n’est pas disponible pour le moment." },
        { status: 503 }
      );
    }

    const { supabase, user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const userId = user.id;
    const body: unknown = await req.json().catch(() => ({}));
    const wantedPlanRaw = String((body as { plan?: unknown } | null | undefined)?.plan || "Accel");
    const wantedPlan = normalizeWantedPlan(wantedPlanRaw);
    const billingCycleRaw = String(
      (body as { billingCycle?: unknown; billing?: unknown } | null | undefined)?.billingCycle ||
        (body as { billing?: unknown } | null | undefined)?.billing ||
        "monthly"
    );
    const billingCycle: BillingCycle = billingCycleRaw === "yearly" ? "yearly" : "monthly";
    const trialDays = getTrialDays();

    if (!wantedPlan) {
      return NextResponse.json({ error: "L’offre sélectionnée est invalide." }, { status: 400 });
    }

    const monthlyPriceIdByPlan: Record<string, string | undefined> = {
      Starter: requireEnv("STRIPE_PRICE_STARTER_ID"),
      Accel: requireEnv("STRIPE_PRICE_ACCEL_ID"),
      Speed: requireEnv("STRIPE_PRICE_SPEED_ID") || requireEnv("STRIPE_PRICE_FULL_ID"),
    };

    const yearlyPriceIdByPlan: Record<string, string | undefined> = {
      Starter: process.env.STRIPE_PRICE_YEARLY,
      Accel: process.env.STRIPE_PRICE_ACCEL_YEARLY_ID,
    };

    const priceId = billingCycle === "yearly" ? yearlyPriceIdByPlan[wantedPlan] : monthlyPriceIdByPlan[wantedPlan];
    if (!priceId) {
      return NextResponse.json({ error: "L’offre sélectionnée est invalide." }, { status: 400 });
    }

    const [{ data: sub, error: subErr }, { data: profile, error: profileErr }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("stripe_customer_id, stripe_subscription_id, status, app_edition, plan, start_date, trial_start_at, trial_end_at, contact_email, founder_offer_enabled")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("profiles")
        .select("admin_email, contact_email")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

    if (subErr) throw new Error(subErr.message);
    if (profileErr) throw new Error(profileErr.message);

    const row = sub as SubscriptionRow | null | undefined;
    const profileRow = profile as ProfileRow | null | undefined;
    const appUrl = getAppUrl(req) || requireEnv("NEXT_PUBLIC_APP_URL");

    if (resolveDashboardEdition({
      edition: row?.app_edition,
      plan: row?.plan,
      developmentOverride: process.env.INRCY_DEV_DASHBOARD_EDITION,
    }) === "standard") {
      return NextResponse.json(
        {
          error: "Le passage à iNrCy Premium nécessite un échange avec notre équipe.",
          code: "PREMIUM_CONTACT_REQUIRED",
          redirectTo: "/dashboard?panel=contact",
        },
        { status: 403 },
      );
    }

    if (wantedPlan === "Starter" && !row?.founder_offer_enabled) {
      return NextResponse.json(
        { error: "L’offre Partenaire Fondateur n’est pas disponible pour ce compte." },
        { status: 403 }
      );
    }

    let trialStartAt = row?.trial_start_at ?? undefined;
    let trialEndAt = row?.trial_end_at ?? undefined;
    if (!trialEndAt) {
      const startYmd = row?.start_date ?? (trialStartAt ? trialStartAt.slice(0, 10) : undefined);
      if (!startYmd) {
        return NextResponse.json(
          { error: "Période d'essai introuvable. L'abonnement est indisponible." },
          { status: 403 }
        );
      }

      const computed = computeTrialDatesFromStartDate(startYmd, trialDays);
      trialStartAt = trialStartAt ?? computed.trialStartAt;
      trialEndAt = computed.trialEndAt;

      await supabaseAdmin
        .from("subscriptions")
        .update({
          start_date: startYmd,
          trial_start_at: trialStartAt,
          trial_end_at: trialEndAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    const trialEndUnix = Math.floor(new Date(trialEndAt).getTime() / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);
    const stripeMinTrialEndUnix = nowUnix + 2 * 24 * 60 * 60;

    if (!Number.isFinite(trialEndUnix) || trialEndUnix <= nowUnix + 60) {
      return NextResponse.json(
        { error: "La période d'essai est terminée. L'abonnement n'est plus disponible pour ce compte." },
        { status: 403 }
      );
    }

    // Stripe Checkout refuse un trial_end situé à moins de 48h.
    // Si le client s'abonne en fin d'essai, on crée donc l'abonnement immédiatement
    // plutôt que de bloquer le paiement avec une erreur Stripe.
    const shouldKeepTrialEnd = trialEndUnix >= stripeMinTrialEndUnix;

    const existingSubId = row?.stripe_subscription_id ?? undefined;
    const existingStatus = String(row?.status || "").toLowerCase();

    const alreadySubscribed =
      !!existingSubId &&
      existingStatus !== "canceled" &&
      existingStatus !== "cancelled" &&
      existingStatus !== "incomplete_expired";

    if (alreadySubscribed) {
      return NextResponse.json(
        { error: "Un abonnement est déjà en cours pour ce compte." },
        { status: 409 }
      );
    }

    const email =
      profileRow?.admin_email?.trim() ||
      profileRow?.contact_email?.trim() ||
      row?.contact_email?.trim() ||
      user.email ||
      null;
    if (!email) {
      return NextResponse.json({ error: "Adresse email manquante." }, { status: 400 });
    }

    let customerId = row?.stripe_customer_id ?? undefined;

    if (!customerId) {
      const customerParams = new URLSearchParams();
      customerParams.set("email", email);
      customerParams.set("metadata[user_id]", userId);

      const customer = await stripePost("/customers", customerParams, {
        idempotencyKey: `customer-create-${userId}`,
      });

      customerId = customer.id;

      await supabaseAdmin
        .from("subscriptions")
        .update({ stripe_customer_id: customerId, contact_email: email, updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }

    if (!customerId) throw new Error("Le paiement n’a pas pu être préparé pour ce compte.");

    const sessionParams = new URLSearchParams();
    sessionParams.set("mode", "subscription");
    sessionParams.set("customer", customerId);
    sessionParams.set("line_items[0][price]", priceId);
    sessionParams.set("line_items[0][quantity]", "1");
    sessionParams.set("success_url", `${appUrl}/dashboard?panel=abonnement&checkout=success&billing=${billingCycle}`);
    sessionParams.set("cancel_url", `${appUrl}/dashboard?panel=abonnement&checkout=cancel`);
    sessionParams.set("metadata[user_id]", userId);
    sessionParams.set("metadata[plan]", wantedPlan);
    sessionParams.set("metadata[billing_cycle]", billingCycle);
    sessionParams.set("metadata[access_months]", billingCycle === "yearly" ? "12" : "");
    sessionParams.set("metadata[trial_behavior]", shouldKeepTrialEnd ? "keep_trial_end" : "start_now");

    sessionParams.set("subscription_data[metadata][user_id]", userId);
    sessionParams.set("subscription_data[metadata][plan]", wantedPlan);
    sessionParams.set("subscription_data[metadata][billing_cycle]", billingCycle);
    sessionParams.set("subscription_data[metadata][trial_behavior]", shouldKeepTrialEnd ? "keep_trial_end" : "start_now");
    if (shouldKeepTrialEnd) {
      sessionParams.set("subscription_data[trial_end]", String(trialEndUnix));
    }

    // TVA / Stripe Tax : le tarif Stripe est configuré TTC, mais Checkout doit aussi
    // activer le calcul automatique des taxes pour que les abonnements et factures
    // créés depuis l'application affichent bien HT + TVA + total TTC.
    sessionParams.set("automatic_tax[enabled]", "true");
    sessionParams.set("billing_address_collection", "required");
    sessionParams.set("tax_id_collection[enabled]", "true");
    sessionParams.set("customer_update[address]", "auto");
    sessionParams.set("customer_update[name]", "auto");
    sessionParams.set("payment_method_collection", "always");

    const session = await stripePost("/checkout/sessions", sessionParams, {
      // Versionnée pour éviter de récupérer une ancienne session Stripe sans TVA
      // via l'idempotency cache après le déploiement du correctif.
      idempotencyKey: `checkout-session-tax-v2-${userId}-${priceId}-${billingCycle}-${shouldKeepTrialEnd ? trialEndUnix : "start-now"}`,
    });

    await supabaseAdmin
      .from("subscriptions")
      .update({
        stripe_price_id: priceId,
        scheduled_plan: wantedPlan,
        contact_email: email,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    const msg = getSimpleFrenchErrorMessage(e, "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
