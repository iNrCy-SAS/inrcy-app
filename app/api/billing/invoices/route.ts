import { NextResponse } from "next/server";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { stripeGet } from "@/lib/stripeRest";
import { invoiceSubscriptionId } from "@/lib/stripeWebhookPayload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionRow = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  billing_provider?: string | null;
};

type StripeInvoice = {
  id?: string | null;
  number?: string | null;
  status?: string | null;
  currency?: string | null;
  total?: number | null;
  amount_paid?: number | null;
  created?: number | null;
  period_start?: number | null;
  period_end?: number | null;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  subscription?: unknown;
  parent?: unknown;
};

type StripeInvoiceList = {
  data?: StripeInvoice[];
};

function cleanId(value: unknown) {
  const id = String(value ?? "").trim();
  return id || null;
}

function publicInvoice(invoice: StripeInvoice) {
  const id = cleanId(invoice.id);
  if (!id) return null;

  return {
    id,
    number: cleanId(invoice.number),
    status: cleanId(invoice.status) ?? "unknown",
    currency: cleanId(invoice.currency) ?? "eur",
    total: typeof invoice.total === "number" ? invoice.total : null,
    amountPaid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : null,
    created: typeof invoice.created === "number" ? invoice.created : null,
    periodStart: typeof invoice.period_start === "number" ? invoice.period_start : null,
    periodEnd: typeof invoice.period_end === "number" ? invoice.period_end : null,
    hostedInvoiceUrl: cleanId(invoice.hosted_invoice_url),
    invoicePdf: cleanId(invoice.invoice_pdf),
  };
}

export async function GET() {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json(
        { error: "La facturation Stripe n’est pas disponible pour le moment." },
        { status: 503 },
      );
    }

    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const { data: subscription, error } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id,stripe_subscription_id,billing_provider")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const row = subscription as SubscriptionRow | null | undefined;
    const billingProvider = String(row?.billing_provider ?? "").trim().toLowerCase();
    if (billingProvider === "app_store" || billingProvider === "play_store") {
      return NextResponse.json(
        { invoices: [], code: "NATIVE_MANAGEMENT_REQUIRED" },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const customerId = cleanId(row?.stripe_customer_id);
    const subscriptionId = cleanId(row?.stripe_subscription_id);

    // Fail closed when the app has not linked a specific Stripe subscription.
    // This avoids exposing another customer’s invoices if reconciliation is incomplete.
    if (!customerId || !subscriptionId) {
      return NextResponse.json(
        { invoices: [], code: "STRIPE_SUBSCRIPTION_NOT_LINKED" },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    const query = new URLSearchParams({ customer: customerId, limit: "100" });
    const response = (await stripeGet(`/invoices?${query.toString()}`)) as StripeInvoiceList;
    const invoices = (response.data ?? [])
      .filter((invoice) => invoiceSubscriptionId(invoice) === subscriptionId)
      .map(publicInvoice)
      .filter((invoice): invoice is NonNullable<ReturnType<typeof publicInvoice>> => Boolean(invoice))
      .sort((left, right) => (right.created ?? 0) - (left.created ?? 0));

    return NextResponse.json(
      { invoices },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error: unknown) {
    const message = getSimpleFrenchErrorMessage(
      error,
      "Les factures d’abonnement sont momentanément indisponibles. Merci de réessayer dans quelques minutes.",
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
