import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { fulfillVideoCreditCheckout, getVideoCreditOrder } from "@/lib/boutique/videoCreditPayments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ orderId: string }> }) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const { orderId } = await context.params;
  try {
    let order = await getVideoCreditOrder(orderId, auth.activeUserId);
    if (!order) return NextResponse.json({ error: "Cette recharge n’appartient pas à l’établissement actif." }, { status: 404 });
    if (order.stripe_checkout_session_id) {
      await fulfillVideoCreditCheckout(order.stripe_checkout_session_id, "authenticated-checkout-return");
      order = await getVideoCreditOrder(orderId, auth.activeUserId);
    }
    return NextResponse.json({ order: order ? {
      id: order.id, seconds: order.seconds, status: order.status, granted: Boolean(order.granted_at),
      unit: "credit", credits: order.seconds * 10,
      revokedCredits: order.revoked_seconds * 10, heldCredits: order.held_seconds * 10, disputeRevokedCredits: order.dispute_revoked_seconds * 10,
      revokedSeconds: order.revoked_seconds, createdAt: order.created_at,
      heldSeconds: order.held_seconds, disputeRevokedSeconds: order.dispute_revoked_seconds,
      packKey: order.pack_key,
    } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[video-credit-return]", error instanceof Error ? error.message : "unavailable");
    return NextResponse.json({ error: "La confirmation du paiement est encore en cours. Actualisez dans quelques instants." }, { status: 503 });
  }
}
