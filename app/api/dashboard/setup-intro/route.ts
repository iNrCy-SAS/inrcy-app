import { NextResponse } from "next/server";

import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { getDirectSignupMetadata, isDirectSignupPaid } from "@/lib/directSignupPolicy";
import { createVisioBookingToken } from "@/lib/visioBookingToken";
import { stripeGet } from "@/lib/stripeRest";
import { invoiceAmountPaidCents, invoiceCustomerId, invoiceSubscriptionId } from "@/lib/stripeWebhookPayload";

export const dynamic = "force-dynamic";

// Une prise atomique côté serveur remplace le marqueur local au navigateur.
// Les comptes présents avant la migration sont déjà marqués comme vus.
export async function POST(request: Request) {
  const supabase = await createSupabaseServer();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  }

  let accountId: string;
  try {
    accountId = await resolveActiveInrcyAccountId(supabase, user.id);
  } catch {
    return NextResponse.json({ error: "Établissement indisponible." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { accountId?: unknown } | null;
  if (body?.accountId !== accountId) {
    // Une bascule d'établissement pendant le chargement ne doit pas consommer
    // l'introduction d'un autre compte.
    return NextResponse.json({ error: "Établissement modifié." }, { status: 409 });
  }

  const isPaidSignupOwner = accountId === user.id && Boolean(getDirectSignupMetadata(user.app_metadata));
  let bookingToken: string | undefined;
  if (isPaidSignupOwner) {
    const skip = () => NextResponse.json({ accountId, show: false }, { headers: { "Cache-Control": "no-store" } });
    const intro = await supabaseAdmin.from("inrcy_accounts").select("dashboard_setup_intro_seen_at").eq("id", accountId).maybeSingle();
    if (intro.error) return NextResponse.json({ error: "Introduction indisponible." }, { status: 503 });
    if (!intro.data || intro.data.dashboard_setup_intro_seen_at) return skip();
    const subscription = await supabaseAdmin.from("subscriptions")
      .select("status,stripe_subscription_id,stripe_customer_id").eq("user_id", user.id).maybeSingle();
    if (subscription.error) return NextResponse.json({ error: "Abonnement indisponible." }, { status: 503 });
    const sub = subscription.data;
    if (!sub || !isDirectSignupPaid(sub) || !sub.stripe_customer_id || !user.email) return skip();
    // An active subscription can precede settlement. Only an actual paid invoice
    // from this customer and subscription unlocks the appointment invitation.
    const filters = new URLSearchParams({ subscription: sub.stripe_subscription_id, customer: sub.stripe_customer_id, status: "paid", limit: "10" });
    let paidInvoices: Array<{ status: string }>;
    try {
      const invoices = await stripeGet(`/invoices?${filters}`);
      if (!Array.isArray(invoices?.data)) throw new Error("invoice_list_unavailable");
      paidInvoices = invoices.data;
    } catch {
      return NextResponse.json({ error: "Confirmation du paiement indisponible." }, { status: 503 });
    }
    if (!paidInvoices.some(invoice => invoice.status === "paid" && invoiceAmountPaidCents(invoice) > 0
      && invoiceCustomerId(invoice) === sub.stripe_customer_id && invoiceSubscriptionId(invoice) === sub.stripe_subscription_id)) {
      return NextResponse.json({ accountId, show: false, paymentPending: true }, { headers: { "Cache-Control": "no-store" } });
    }
    bookingToken = createVisioBookingToken({ userId: user.id, email: user.email, ttlSeconds: 3600 });
  }

  const { data, error } = await supabaseAdmin
    .from("inrcy_accounts")
    .update({ dashboard_setup_intro_seen_at: new Date().toISOString() })
    .eq("id", accountId)
    .is("dashboard_setup_intro_seen_at", null)
    .select("id");

  if (error) {
    console.error("[dashboard/setup-intro] claim failed", { accountId, code: error.code });
    return NextResponse.json({ error: "Introduction indisponible." }, { status: 503 });
  }

  return NextResponse.json(
    { accountId, show: Array.isArray(data) && data.length > 0,
      ...(data?.length && bookingToken ? { bookingToken } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
