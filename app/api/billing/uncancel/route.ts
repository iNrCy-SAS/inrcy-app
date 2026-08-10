import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

import { requireUser } from "@/lib/requireUser";
import { stripePost } from "@/lib/stripeRest";
import { stripeSubscriptionPeriodEndIso } from "@/lib/stripeSubscription";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Annule une résiliation programmée, qu'elle utilise cancel_at (mensuel avec
 * mois de préavis) ou cancel_at_period_end (annuel).
 * La DB est ensuite remise à jour (pour un UI immédiat) — le webhook Stripe fera foi ensuite.
 */
export async function POST() {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const { data: subRow, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (subErr) throw subErr;
    const stripeSubId = (subRow as { stripe_subscription_id?: string | null } | null | undefined)?.stripe_subscription_id ?? null;
    if (!stripeSubId) {
      return NextResponse.json({ error: "Aucun abonnement actif n’a été trouvé pour ce compte." }, { status: 400 });
    }

    // Stripe REST API: POST /v1/subscriptions/{id}
    const updated = await stripePost(
      `/subscriptions/${stripeSubId}`,
      new URLSearchParams({
        cancel_at: "",
        cancel_at_period_end: "false",
        proration_behavior: "none",
      })
    );

    // UI immédiat (le webhook mettra aussi à jour)
    await supabaseAdmin
      .from("subscriptions")
      .update({
        cancel_requested_at: null,
        end_date: null,
        status: updated.status,
        next_renewal_date: stripeSubscriptionPeriodEndIso(updated)?.slice(0, 10) ?? null,
      })
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const msg = getSimpleFrenchErrorMessage(e, "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
