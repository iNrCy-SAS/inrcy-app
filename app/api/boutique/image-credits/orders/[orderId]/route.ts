import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { fulfillImageCreditCheckout, getImageCreditOrder } from "@/lib/boutique/imageCreditPayments";
import { isExpectedCreditOrderRequestScope } from "@/lib/boutique/creditOrderRequestScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ orderId: string }> }) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  if (!isExpectedCreditOrderRequestScope(req, auth)) return NextResponse.json({ error: "La session ou l’établissement a changé.", code: "credit_order_scope_changed" }, { status: 409 });
  const { orderId } = await context.params;
  try {
    let order = await getImageCreditOrder(orderId, auth.activeUserId);
    if (!order) return NextResponse.json({ error: "Cette recharge n’appartient pas à l’établissement actif." }, { status: 404 });
    if (order.stripe_checkout_session_id) {
      if (!isExpectedCreditOrderRequestScope(req, auth)) return NextResponse.json({ error: "La vérification doit être reprise.", code: "credit_order_scope_changed" }, { status: 409 });
      await fulfillImageCreditCheckout(order.stripe_checkout_session_id, "authenticated-checkout-return", { orderId, accountId: auth.activeUserId, signal: req.signal });
      order = await getImageCreditOrder(orderId, auth.activeUserId);
    }
    return NextResponse.json({ order: order ? {
      id: order.id, images: order.images, status: order.status, granted: Boolean(order.granted_at),
      unit: "credit", credits: order.images * 7,
      revokedCredits: order.revoked_images * 7, heldCredits: order.held_images * 7, disputeRevokedCredits: order.dispute_revoked_images * 7,
      revokedImages: order.revoked_images, createdAt: order.created_at,
      heldImages: order.held_images, disputeRevokedImages: order.dispute_revoked_images,
      packKey: order.pack_key,
    } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[image-credit-return]", error instanceof Error ? error.message : "unavailable");
    return NextResponse.json({ error: "La confirmation du paiement est encore en cours. Actualisez dans quelques instants." }, { status: 503 });
  }
}
