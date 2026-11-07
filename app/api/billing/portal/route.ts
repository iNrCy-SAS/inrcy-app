import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAppUrl, stripeGet, stripePost } from "@/lib/stripeRest";
import { inspectComplimentaryCheckout } from "@/lib/stripeCheckoutPreflight";
import { hasActiveAccountSubscription } from "@/lib/accountSubscriptionPolicy";

export const runtime = "nodejs";

type SubscriptionRow = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  billing_provider?: string | null;
  status?: string | null;
  trial_end_at?: string | null;
  start_date?: string | null;
  contact_email?: string | null;
};

function hasStripeConfig() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function POST(req: Request) {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    if (!hasStripeConfig()) {
      return NextResponse.json(
        { error: "Le portail de facturation n’est pas disponible pour le moment." },
        { status: 503 }
      );
    }

    // Billing follows the authenticated payer, like the subscription gate and
    // /compte-bloque. An active establishment or request body cannot choose it.
    const userId = user.id;
    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id,stripe_subscription_id,billing_provider,status,trial_end_at,start_date,contact_email")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const row = sub as SubscriptionRow | null | undefined;
    const billingProvider = String(row?.billing_provider || "").trim().toLowerCase();
    if (billingProvider === "app_store" || billingProvider === "play_store") {
      return NextResponse.json(
        { error: "Cet abonnement se gère directement dans l’App Store ou Google Play.", code: "NATIVE_MANAGEMENT_REQUIRED" },
        { status: 409 },
      );
    }

    let identity;
    try {
      identity = await inspectComplimentaryCheckout({
        userId,
        customerId: row?.stripe_customer_id?.trim() || null,
        subscriptionId: row?.stripe_subscription_id?.trim() || null,
        emails: [user.email, row?.contact_email],
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
        error: "Votre facturation n’a pas pu être vérifiée. Réessayez dans quelques minutes ou contactez iNrCy.",
        code: "BILLING_VERIFICATION_REQUIRED",
      }, { status: 409 });
    }
    const blocked = !hasActiveAccountSubscription(row);
    const customerId = identity.customerId;
    if (!customerId || (blocked && !identity.existingSubscription)) {
      return NextResponse.json(
        { error: "Aucun abonnement en cours n’a été retrouvé. Vous pouvez choisir une offre pour reprendre votre abonnement.", code: "BILLING_SUBSCRIPTION_NOT_FOUND" },
        { status: 409 }
      );
    }

    const appUrl = getAppUrl(req);
    const params = new URLSearchParams();
    params.set("customer", customerId);
    params.set("return_url", blocked ? `${appUrl}/compte-bloque` : `${appUrl}/dashboard?panel=abonnement`);

    const session = await stripePost("/billing_portal/sessions", params);
    if (!session?.url) {
      throw new Error("Le portail de facturation n’a pas pu être ouvert.");
    }

    return NextResponse.json({ url: session.url }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: unknown) {
    const msg = getSimpleFrenchErrorMessage(
      e,
      "Le portail de facturation est momentanément indisponible. Merci de réessayer dans quelques minutes."
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
