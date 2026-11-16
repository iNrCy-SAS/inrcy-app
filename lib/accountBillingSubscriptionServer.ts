import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { stripeSubscriptionMonthlyTerms, stripeSubscriptionTaxBehavior, type StripeAdminSubscriberSnapshot } from "@/lib/adminSubscriberStripe";
import { stripeSubscriptionPeriodEndIso } from "@/lib/stripeSubscription";

type Row = Record<string, unknown>;
export const ACCOUNT_SUBSCRIPTION_SELECT = "account_id,auth_user_id,plan,app_edition,status,monthly_price_eur,monthly_price_tax_behavior,start_date,next_renewal_date,cancel_requested_at,end_date,stripe_customer_id,stripe_subscription_id,stripe_price_id,billing_cycle,billing_provider,contact_email,updated_at";
const id = (value: unknown): string => typeof value === "string" ? value : String((value as Row | null)?.id || "");
const statuses = new Set(["active","trialing","past_due","unpaid","paused","canceled","incomplete","incomplete_expired"]);
function missing(error: {code?: string} | null) { return error?.code === "42P01" || error?.code === "PGRST205"; }

export async function getApprovedAccountSubscription(accountId: string, authUserId: string): Promise<Row | null> {
  const {data,error} = await supabaseAdmin.from("inrcy_account_subscriptions").select(ACCOUNT_SUBSCRIPTION_SELECT)
    .eq("account_id",accountId).eq("auth_user_id",authUserId).maybeSingle();
  if (missing(error)) return null;
  if (error) throw new Error("ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE");
  if (!data) return null;
  if (data.account_id !== accountId || data.auth_user_id !== authUserId) throw new Error("ACCOUNT_SUBSCRIPTION_IDENTITY_CONFLICT");
  const membership = await supabaseAdmin.from("inrcy_account_members").select("account_id")
    .eq("account_id",accountId).eq("auth_user_id",authUserId).eq("role","owner").maybeSingle();
  if (membership.error || !membership.data) throw new Error("ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED");
  return data as Row;
}

export async function getApprovedAccountSubscriptionByStripeId(subscriptionId: string): Promise<Row | null> {
  const result = await supabaseAdmin.from("inrcy_account_subscriptions").select(ACCOUNT_SUBSCRIPTION_SELECT)
    .eq("stripe_subscription_id", subscriptionId).maybeSingle();
  if (missing(result.error)) return null;
  if (result.error) throw new Error("ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE");
  if (!result.data) return null;
  if (result.data.stripe_subscription_id !== subscriptionId) throw new Error("ACCOUNT_SUBSCRIPTION_IDENTITY_CONFLICT");
  return getApprovedAccountSubscription(result.data.account_id, result.data.auth_user_id);
}

/** Private contracts override the legacy payer contract only for their verified owner/account pair. */
export async function getApprovedAccountSubscriptionsForAccounts(accountIds: readonly string[]): Promise<Map<string, Row>> {
  const records = new Map<string, Row>();
  if (!accountIds.length) return records;
  const result = await supabaseAdmin.from("inrcy_account_subscriptions").select(ACCOUNT_SUBSCRIPTION_SELECT).in("account_id", [...accountIds]);
  if (missing(result.error)) return records;
  if (result.error) throw new Error("ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE");
  if (!result.data?.length) return records;
  const members = await supabaseAdmin.from("inrcy_account_members").select("account_id,auth_user_id")
    .in("account_id", result.data.map(row => row.account_id)).eq("role", "owner");
  if (members.error) throw new Error("ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED");
  const owners = new Set((members.data || []).map(row => `${row.account_id}:${row.auth_user_id}`));
  for (const row of result.data) {
    if (!accountIds.includes(row.account_id) || !owners.has(`${row.account_id}:${row.auth_user_id}`)) throw new Error("ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED");
    records.set(row.account_id, row as Row);
  }
  return records;
}

/** Only existing, admin-approved exact subscription/customer bindings can be updated. */
export async function syncApprovedAccountSubscription(snapshot: StripeAdminSubscriberSnapshot, lifecycle: Row = {}, fetchedBefore?: number): Promise<Row | null> {
  const {data,error} = await supabaseAdmin.from("inrcy_account_subscriptions").select(ACCOUNT_SUBSCRIPTION_SELECT)
    .eq("stripe_subscription_id",snapshot.subscription_id).maybeSingle();
  if (missing(error)) return null;
  if (error) throw new Error("ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE");
  if (!data) return null;
  if (snapshot.customer_id !== data.stripe_customer_id || !statuses.has(snapshot.status)) throw new Error("ACCOUNT_SUBSCRIPTION_IDENTITY_CONFLICT");
  if (fetchedBefore !== undefined && Date.parse(String(data.updated_at || "")) > fetchedBefore) return data as Row;
  const patch: Row = {...lifecycle,status:snapshot.status,next_renewal_date:snapshot.next_renewal_date};
  if (snapshot.price_id) patch.stripe_price_id=snapshot.price_id;
  if (snapshot.amount_eur != null) patch.monthly_price_eur=snapshot.amount_eur;
  if (snapshot.tax_behavior) patch.monthly_price_tax_behavior=snapshot.tax_behavior;
  if (snapshot.billing_cycle === "monthly" || snapshot.billing_cycle === "yearly") patch.billing_cycle=snapshot.billing_cycle;
  let query = supabaseAdmin.from("inrcy_account_subscriptions").update(patch)
    .eq("account_id",data.account_id).eq("stripe_subscription_id",snapshot.subscription_id).eq("stripe_customer_id",snapshot.customer_id);
  if (data.updated_at) query = query.eq("updated_at", data.updated_at);
  const updated = await query.select("account_id,auth_user_id").maybeSingle();
  if (updated.error) throw new Error("ACCOUNT_SUBSCRIPTION_SYNC_UNAVAILABLE");
  // A newer webhook won the compare-and-swap; preserve its complete state.
  if (!updated.data) return null;
  return updated.data as Row;
}

export async function syncApprovedAccountSubscriptionFromStripe(value: unknown, fetchedBefore?: number): Promise<Row | null> {
  const sub = value as Row;
  const terms = stripeSubscriptionMonthlyTerms(sub);
  const unixDate = (raw: unknown) => typeof raw === "number" && raw > 0 ? new Date(raw * 1000).toISOString() : null;
  const cancelAt = unixDate(sub.cancel_at);
  const periodEnd = stripeSubscriptionPeriodEndIso(sub);
  const canceled = String(sub.status) === "canceled";
  const cancellation = {
    cancel_requested_at: canceled || sub.cancel_at_period_end || cancelAt ? unixDate(sub.canceled_at) || new Date().toISOString() : null,
    end_date: canceled ? (unixDate(sub.ended_at) || cancelAt || periodEnd)?.slice(0, 10) || null
      : sub.cancel_at_period_end || cancelAt ? (cancelAt || periodEnd)?.slice(0, 10) || null : null,
  };
  const updated = await syncApprovedAccountSubscription({subscription_id:id(sub.id),customer_id:id(sub.customer),status:String(sub.status||""),
    amount_eur:terms.amountEur,tax_behavior:stripeSubscriptionTaxBehavior(sub),billing_cycle:terms.billingCycle,
    next_renewal_date:stripeSubscriptionPeriodEndIso(sub)?.slice(0,10)||null,price_id:terms.priceId,
    metadata_user_id:null,subscription_metadata_user_id:null,customer_metadata_user_id:null,customer_name:null,customer_email:null,customer_phone:null,identity_conflict:false,created_at:null}, cancellation, fetchedBefore);
  return updated;
}

export async function syncApprovedAccountSubscriptionSnapshots(snapshots: StripeAdminSubscriberSnapshot[], fetchedBefore?: number): Promise<string[]> {
  const result = await supabaseAdmin.from("inrcy_account_subscriptions").select("stripe_subscription_id");
  if (missing(result.error)) return [];
  if (result.error) throw new Error("ACCOUNT_SUBSCRIPTION_READ_UNAVAILABLE");
  const byId = new Map(snapshots.map(snapshot => [snapshot.subscription_id,snapshot]));
  const known: string[] = [];
  for (const row of result.data || []) {
    const snapshot = byId.get(row.stripe_subscription_id);
    if (!snapshot) continue;
    await syncApprovedAccountSubscription(snapshot, {}, fetchedBefore);
    known.push(snapshot.subscription_id);
  }
  return known;
}
