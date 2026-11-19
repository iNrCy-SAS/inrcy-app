import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DIRECT_SIGNUP_ACTIVATION_PATH, getDirectSignupMetadata, isDirectSignupPaid } from "@/lib/directSignupPolicy";
import { loadOrRepairDirectSignupSubscription } from "@/lib/directSignupServer";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Referrer-Policy": "no-referrer" };

export async function GET() {
  const supabase = await createSupabaseServer();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) return NextResponse.json({ error: "auth_required" }, { status: 401, headers });
  const directSignup = Boolean(getDirectSignupMetadata(data.user.app_metadata));
  let subscription;
  try {
    if (directSignup) subscription = await loadOrRepairDirectSignupSubscription(data.user);
    else {
      const result = await supabaseAdmin.from("subscriptions")
        .select("status,plan,billing_cycle,stripe_subscription_id").eq("user_id", data.user.id).maybeSingle();
      if (result.error) throw new Error("subscription_unavailable");
      subscription = result.data;
    }
  } catch { return NextResponse.json({ error: "subscription_unavailable" }, { status: 503, headers }); }
  const paid = isDirectSignupPaid(subscription);
  const plan = ["Basic", "Standard", "Premium"].includes(subscription?.plan ?? "") ? subscription!.plan : null;
  const billingCycle = ["monthly", "yearly"].includes(subscription?.billing_cycle ?? "") ? subscription!.billing_cycle : null;
  return NextResponse.json({ directSignup, paid, status: subscription?.status ?? "incomplete", plan, billingCycle,
    nextUrl: directSignup && !paid ? DIRECT_SIGNUP_ACTIVATION_PATH : "/dashboard" }, { headers });
}
