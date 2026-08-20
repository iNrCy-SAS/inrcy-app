import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAppUrl, stripePost } from "@/lib/stripeRest";

export const runtime = "nodejs";

type SubscriptionRow = {
  stripe_customer_id?: string | null;
  billing_provider?: string | null;
};

function hasStripeConfig() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export async function POST(req: Request) {
  try {
    if (!hasStripeConfig()) {
      return NextResponse.json(
        { error: "Le portail de facturation n’est pas disponible pour le moment." },
        { status: 503 }
      );
    }

    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const userId = user.id;
    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id,billing_provider")
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

    const customerId = row?.stripe_customer_id?.trim();
    if (!customerId) {
      return NextResponse.json(
        { error: "Aucun compte de facturation Stripe n’a encore été trouvé pour ce compte." },
        { status: 400 }
      );
    }

    const appUrl = getAppUrl(req);
    const params = new URLSearchParams();
    params.set("customer", customerId);
    params.set("return_url", `${appUrl}/dashboard?panel=abonnement`);

    const session = await stripePost("/billing_portal/sessions", params);
    if (!session?.url) {
      throw new Error("Le portail de facturation n’a pas pu être ouvert.");
    }

    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    const msg = getSimpleFrenchErrorMessage(
      e,
      "Le portail de facturation est momentanément indisponible. Merci de réessayer dans quelques minutes."
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
