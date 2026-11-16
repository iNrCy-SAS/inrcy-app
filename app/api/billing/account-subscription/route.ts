import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getApprovedAccountSubscription } from "@/lib/accountBillingSubscriptionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control":"private, no-store"};
const SELECT = "plan,scheduled_plan,status,monthly_price_eur,monthly_price_tax_behavior,start_date,trial_start_at,trial_end_at,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle,billing_provider,native_product_id,native_will_renew,founder_offer_enabled";
export async function GET() {
  try {
    const {user,activeUserId,errorResponse} = await requireUser();
    if (errorResponse) return errorResponse;
    const accountId = activeUserId || user.id;
    const approved = await getApprovedAccountSubscription(accountId,user.id);
    if (approved) return NextResponse.json({ok:true,accountId,subscription:approved},{headers});
    const result = await supabaseAdmin.from("subscriptions").select(SELECT).eq("user_id",user.id).maybeSingle();
    if (result.error) throw new Error("SUBSCRIPTION_READ_UNAVAILABLE");
    return NextResponse.json({ok:true,accountId,subscription:result.data || null},{headers});
  } catch {
    return NextResponse.json({ok:false,error:"L’abonnement est momentanément indisponible."},{status:503,headers});
  }
}
