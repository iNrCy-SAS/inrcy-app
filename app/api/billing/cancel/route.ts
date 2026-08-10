import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { stripeGet, stripePost } from "@/lib/stripeRest";
import { stripeSubscriptionPeriodEndUnix } from "@/lib/stripeSubscription";
import { stripeCancellationSchedule } from "@/lib/subscriptionCancellation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const userId = user.id;

    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_subscription_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    const stripeSubId = (sub as { stripe_subscription_id?: string | null } | null | undefined)?.stripe_subscription_id ?? undefined;
    if (!stripeSubId) {
      return NextResponse.json({ error: "Aucun abonnement actif n’a été trouvé pour ce compte." }, { status: 400 });
    }

    const currentSubscription = await stripeGet(
      `/subscriptions/${encodeURIComponent(stripeSubId)}`,
    );
    const currentPeriodEndUnix = stripeSubscriptionPeriodEndUnix(currentSubscription);
    if (!currentPeriodEndUnix) {
      throw new Error("Stripe n’a pas renvoyé la date de la période en cours.");
    }

    const schedule = stripeCancellationSchedule(
      currentSubscription,
      currentPeriodEndUnix,
    );
    const cancellationParams = new URLSearchParams();

    if (schedule.mode === "custom") {
      // Mensuel : le prochain renouvellement reste dû et paie un dernier mois
      // complet de préavis, sans ligne de prorata ni montant surprise.
      cancellationParams.set("cancel_at_period_end", "false");
      cancellationParams.set("cancel_at", String(schedule.cancelAtUnix));
      cancellationParams.set("proration_behavior", "none");
    } else {
      // Annuel (ou cadence inconnue) : fin à l'échéance déjà payée, sans
      // déclencher une nouvelle année entière.
      cancellationParams.set("cancel_at_period_end", "true");
    }

    const updated = await stripePost(
      `/subscriptions/${encodeURIComponent(stripeSubId)}`,
      cancellationParams,
    );

    const returnedCancelAtUnix = Number(updated?.cancel_at);
    const cancelAtUnix = Number.isFinite(returnedCancelAtUnix) && returnedCancelAtUnix > 0
      ? returnedCancelAtUnix
      : schedule.cancelAtUnix;
    const cancelEndDate = new Date(cancelAtUnix * 1000).toISOString().slice(0, 10);
    const nextRenewalDate = new Date(currentPeriodEndUnix * 1000).toISOString().slice(0, 10);

    if (!cancelEndDate) {
      throw new Error("Stripe n’a pas renvoyé la date de résiliation programmée.");
    }

    // UI immédiat : le webhook Stripe reste la source de vérité ensuite.
    await supabaseAdmin
      .from("subscriptions")
      .update({
        cancel_requested_at: new Date().toISOString(),
        end_date: cancelEndDate,
        status: updated.status,
        next_renewal_date: nextRenewalDate,
      })
      .eq("user_id", userId);

    return NextResponse.json({
      ok: true,
      end_date: cancelEndDate,
      next_renewal_date: nextRenewalDate,
      cancellation_policy:
        schedule.mode === "custom"
          ? "one_additional_monthly_renewal"
          : schedule.mode === "trial_end"
            ? "trial_end_without_charge"
            : "current_annual_period_end",
    });
  } catch (e: unknown) {
    const msg = getSimpleFrenchErrorMessage(e, "Le service est momentanément indisponible. Merci de réessayer dans quelques minutes.");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
