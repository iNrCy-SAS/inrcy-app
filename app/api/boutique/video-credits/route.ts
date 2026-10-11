import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { VIDEO_CREDIT_PACKS } from "@/lib/boutique/videoCreditPacks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const [subscription, history] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("status").eq("user_id", auth.activeUserId).maybeSingle(),
    supabaseAdmin.from("ai_media_video_credit_orders")
      .select("id,pack_key,request_key,seconds,amount_ht_cents,status,granted_at,revoked_seconds,held_seconds,dispute_revoked_seconds,created_at")
      .eq("account_id", auth.activeUserId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (subscription.error || history.error) return NextResponse.json({ error: "Le catalogue des recharges est indisponible." }, { status: 503 });
  return NextResponse.json({
    accountId: auth.activeUserId,
    actorAuthUserId: auth.authUserId,
    canPurchase: Boolean(auth.activeAccount && ["owner", "admin"].includes(auth.activeAccount.role)
      && ["active", "trialing"].includes(subscription.data?.status ?? "")),
    packs: VIDEO_CREDIT_PACKS.map((pack) => ({ key: pack.key, seconds: pack.seconds, priceEurHt: pack.priceEurHt,
      available: Boolean(process.env.STRIPE_SECRET_KEY && process.env[pack.priceEnv]) })),
    orders: history.data ?? [],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
