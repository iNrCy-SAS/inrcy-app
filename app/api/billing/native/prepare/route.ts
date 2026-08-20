import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type BillingCycle } from "@/lib/subscriptionOffers";

export const runtime = "nodejs";

type SubscriptionRow = {
  plan?: string | null;
  app_edition?: string | null;
  status?: string | null;
  trial_end_at?: string | null;
  stripe_subscription_id?: string | null;
  billing_provider?: string | null;
};

function normalizeCycle(value: unknown): BillingCycle {
  return String(value || "").trim().toLowerCase() === "yearly" ? "yearly" : "monthly";
}

function isLiveStripeStatus(status: unknown): boolean {
  return new Set(["active", "trialing", "past_due", "unpaid", "paused", "incomplete"]).has(
    String(status || "").trim().toLowerCase(),
  );
}

function frenchDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "prochainement";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export async function POST(req: Request) {
  try {
    const { supabase, user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const body = (await req.json().catch(() => ({}))) as { plan?: unknown; billingCycle?: unknown };
    const requestedPlan = String(body.plan || "Standard").trim();
    if (requestedPlan !== "Standard") {
      return NextResponse.json(
        { error: "Cette formule mobile doit être activée avec l’équipe iNrCy.", code: "NATIVE_PLAN_CONTACT_REQUIRED" },
        { status: 403 },
      );
    }

    const billingCycle = normalizeCycle(body.billingCycle);
    const { data, error } = await supabase
      .from("subscriptions")
      .select("plan, app_edition, status, trial_end_at, stripe_subscription_id, billing_provider")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const row = data as SubscriptionRow | null;
    if (!row) {
      return NextResponse.json({ error: "Votre abonnement n’est pas encore initialisé." }, { status: 409 });
    }

    const provider = String(row.billing_provider || "").trim().toLowerCase();
    const status = String(row.status || "").trim().toLowerCase();
    const isNativeProvider = provider === "app_store" || provider === "play_store";
    if (isNativeProvider && isLiveStripeStatus(status)) {
      return NextResponse.json(
        { error: "Un abonnement mobile est déjà actif pour ce compte.", code: "NATIVE_SUBSCRIPTION_ALREADY_EXISTS" },
        { status: 409 },
      );
    }

    if (provider === "stripe" || row.stripe_subscription_id) {
      if (isLiveStripeStatus(status)) {
        return NextResponse.json(
          { error: "Ce compte possède déjà un abonnement Stripe actif. Il sera aussi disponible dans l’application.", code: "STRIPE_SUBSCRIPTION_ALREADY_EXISTS" },
          { status: 409 },
        );
      }
    }

    const trialEndMs = row.trial_end_at ? new Date(row.trial_end_at).getTime() : NaN;
    if (status === "trialing" && Number.isFinite(trialEndMs) && trialEndMs > Date.now()) {
      return NextResponse.json(
        {
          error: `Votre essai gratuit se termine le ${frenchDate(row.trial_end_at as string)}. Le paiement mobile sera disponible ensuite.`,
          code: "TRIAL_NOT_EXPIRED",
          trial_end_at: row.trial_end_at,
          billing_cycle: billingCycle,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, plan: requestedPlan, billingCycle });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Le paiement mobile n’est pas disponible." },
      { status: 500 },
    );
  }
}
