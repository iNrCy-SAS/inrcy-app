import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { startVideoCreditCheckout } from "@/lib/boutique/videoCreditPayments";
import { getAiMediaQuotaSnapshot } from "@/lib/aiMediaGenerationQuota";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  if (!auth.activeAccount || !["owner", "admin"].includes(auth.activeAccount.role)) {
    return NextResponse.json({ error: "Seul un administrateur de l’établissement peut acheter une recharge." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (body?.accountId !== auth.activeUserId) {
    return NextResponse.json({ error: "L’établissement actif a changé. Actualisez les recharges avant de payer." }, { status: 409 });
  }
  const requestKey = typeof body?.requestKey === "string" ? body.requestKey.trim() : "";
  if (requestKey.length < 8 || requestKey.length > 180) {
    return NextResponse.json({ error: "La demande de paiement est invalide." }, { status: 400 });
  }
  try {
    const edition = await getDashboardEditionForAccountId(auth.activeUserId);
    const quota = await getAiMediaQuotaSnapshot({ accountId: auth.activeUserId, actorAuthUserId: auth.authUserId, edition });
    if (!quota.creditsReady) {
      return NextResponse.json({ code: "VIDEO_CREDITS_WALLET_UNAVAILABLE", error: "Le portefeuille de crédits médias n'est pas disponible pour le moment." }, { status: 503 });
    }
    const result = await startVideoCreditCheckout({ req, accountId: auth.activeUserId,
      actorAuthUserId: auth.authUserId, packKey: body?.packKey, requestKey, email: auth.user.email ?? "" });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "VIDEO_CREDITS_UNAVAILABLE";
    const configuration = code === "VIDEO_CREDITS_NOT_CONFIGURED" || code === "VIDEO_CREDITS_PRICE_CONFIGURATION_INVALID";
    const conflict = /IDEMPOTENCY|ALREADY_PAID|EXPIRED|RECONCILIATION/.test(code);
    const denied = /ACCESS_DENIED|ACTIVE_SUBSCRIPTION_REQUIRED/.test(code);
    // Fixed reasons only: upstream errors can contain provider details or IDs.
    console.error("[video-credit-checkout]", configuration ? "price_configuration_invalid"
      : denied ? "purchase_access_denied" : conflict ? "payment_reconciliation_required" : "payment_unavailable");
    return NextResponse.json({ code: /^VIDEO_CREDITS_[A-Z_]+$/.test(code) ? code : "VIDEO_CREDITS_UNAVAILABLE", error: configuration
      ? "Les recharges vidéo ne sont pas disponibles pour le moment."
      : denied ? "Un abonnement actif et un accès administrateur sont nécessaires."
      : conflict ? "Ce paiement doit être vérifié avant de créer une nouvelle demande. Actualisez votre solde."
      : "Le paiement n’a pas pu être ouvert. Réessayez dans quelques minutes." },
    { status: configuration ? 503 : denied ? 403 : conflict ? 409 : code === "VIDEO_CREDITS_UNKNOWN_PACK" ? 400 : 500 });
  }
}
