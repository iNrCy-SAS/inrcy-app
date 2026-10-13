import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { VIDEO_CREDIT_PACKS } from "@/lib/boutique/videoCreditPacks";
import { getAiMediaQuotaSnapshot } from "@/lib/aiMediaGenerationQuota";
import { getDashboardEditionForAccountId } from "@/lib/dashboardEditionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const [subscription, history, imageHistory, quota] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("status").eq("user_id", auth.activeUserId).maybeSingle(),
    supabaseAdmin.from("ai_media_video_credit_orders")
      .select("id,pack_key,request_key,seconds,amount_ht_cents,status,granted_at,revoked_seconds,held_seconds,dispute_revoked_seconds,created_at")
      .eq("account_id", auth.activeUserId).order("created_at", { ascending: false }).limit(20),
    supabaseAdmin.from("ai_media_image_credit_orders")
      .select("id,pack_key,request_key,images,amount_ht_cents,status,granted_at,revoked_images,held_images,dispute_revoked_images,created_at")
      .eq("account_id", auth.activeUserId).order("created_at", { ascending: false }).limit(20),
    getDashboardEditionForAccountId(auth.activeUserId).then((edition) => getAiMediaQuotaSnapshot({ accountId: auth.activeUserId, actorAuthUserId: auth.authUserId, edition })).catch(() => null),
  ]);
  if (subscription.error || history.error || imageHistory.error || !quota) return NextResponse.json({ error: "Le catalogue des recharges est indisponible." }, { status: 503 });
  return NextResponse.json({
    accountId: auth.activeUserId,
    actorAuthUserId: auth.authUserId,
    unit: "credit",
    creditsReady: quota.creditsReady,
    canPurchase: Boolean(quota.creditsReady && auth.activeAccount && ["owner", "admin"].includes(auth.activeAccount.role)
      && ["active", "trialing"].includes(subscription.data?.status ?? "")),
    packs: VIDEO_CREDIT_PACKS.map((pack) => ({ key: pack.key, seconds: pack.seconds, credits: pack.credits, unit: pack.unit, priceEurHt: pack.priceEurHt,
      available: Boolean(quota.creditsReady && process.env.STRIPE_SECRET_KEY && process.env[pack.priceEnv]) })),
    orders: [
      ...(history.data ?? []).map((order) => ({ ...order, mediaKind: "video", credits: order.seconds * 10, revokedCredits: order.revoked_seconds * 10, heldCredits: order.held_seconds * 10, disputeRevokedCredits: order.dispute_revoked_seconds * 10 })),
      ...(imageHistory.data ?? []).map((order) => ({ ...order, mediaKind: "image", credits: order.images * 7, revokedCredits: order.revoked_images * 7, heldCredits: order.held_images * 7, disputeRevokedCredits: order.dispute_revoked_images * 7 })),
    ].sort((left, right) => String(right.created_at).localeCompare(String(left.created_at))).slice(0, 20),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
