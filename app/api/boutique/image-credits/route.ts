import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireUser();
  if (auth.errorResponse) return auth.errorResponse;
  const [subscription, history] = await Promise.all([
    supabaseAdmin.from("subscriptions").select("status").eq("user_id", auth.activeUserId).maybeSingle(),
    supabaseAdmin.from("ai_media_image_credit_orders")
      .select("id,pack_key,request_key,images,amount_ht_cents,status,granted_at,revoked_images,held_images,dispute_revoked_images,created_at")
      .eq("account_id", auth.activeUserId).order("created_at", { ascending: false }).limit(20),
  ]);
  if (subscription.error || history.error) return NextResponse.json({ error: "Le catalogue des recharges est indisponible." }, { status: 503 });
  return NextResponse.json({
    accountId: auth.activeUserId,
    actorAuthUserId: auth.authUserId,
    unit: "credit",
    canPurchase: false,
    packs: [],
    orders: (history.data ?? []).map((order) => ({ ...order, credits: order.images * 7 })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
