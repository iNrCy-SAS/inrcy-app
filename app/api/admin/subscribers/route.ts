import { NextResponse } from "next/server";
import {
  ADMIN_SUBSCRIBER_STATUSES,
  isRelevantAdminSubscriber,
  sortAdminSubscribers,
  summarizeAdminSubscribers,
  toAdminSubscriber,
  type AdminSubscriberProfileRow,
  type AdminSubscriberSubscriptionRow,
} from "@/lib/adminSubscribers";
import { requireAdminApi } from "@/lib/adminSecurity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUBSCRIBERS = 1_000;
const PROFILE_BATCH_SIZE = 200;
const SUBSCRIPTION_SELECT =
  "user_id,contact_email,plan,status,monthly_price_eur,billing_cycle,billing_provider,last_reminder_at,next_renewal_date";
const PROFILE_SELECT =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
};

async function fetchProfiles(userIds: string[]) {
  const profilesByUserId = new Map<string, AdminSubscriberProfileRow>();

  for (let index = 0; index < userIds.length; index += PROFILE_BATCH_SIZE) {
    const batch = userIds.slice(index, index + PROFILE_BATCH_SIZE);
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .in("user_id", batch);

    if (error) throw error;
    for (const profile of (data ?? []) as AdminSubscriberProfileRow[]) {
      profilesByUserId.set(profile.user_id, profile);
    }
  }

  return profilesByUserId;
}

export async function GET() {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("subscriptions")
      .select(SUBSCRIPTION_SELECT)
      .in("status", [...ADMIN_SUBSCRIBER_STATUSES])
      .limit(MAX_SUBSCRIBERS);

    if (error) throw error;

    const subscriptions = ((data ?? []) as AdminSubscriberSubscriptionRow[]).filter(
      isRelevantAdminSubscriber,
    );
    const userIds = Array.from(new Set(subscriptions.map((row) => row.user_id)));
    const profilesByUserId = await fetchProfiles(userIds);
    const subscribers = sortAdminSubscribers(
      subscriptions.map((subscription) =>
        toAdminSubscriber(subscription, profilesByUserId.get(subscription.user_id) ?? null),
      ),
    );
    const { active_count, payment_issue_count, monthly_revenue_eur } =
      summarizeAdminSubscribers(subscribers);

    return NextResponse.json(
      {
        subscribers,
        total: subscribers.length,
        active_count,
        payment_issue_count,
        monthly_revenue_eur,
        generated_at: new Date().toISOString(),
        field_sources: {
          user_id: "subscriptions.user_id",
          name:
            "profiles.first_name + profiles.last_name, sinon profiles.company_legal_name",
          email:
            "profiles.admin_email, sinon profiles.contact_email, sinon subscriptions.contact_email",
          phone: "profiles.phone",
          amount_eur:
            "subscriptions.monthly_price_eur (référence mensuelle, y compris pour un cycle annuel)",
          billing_cycle: "subscriptions.billing_cycle",
          payment_status: "subscriptions.status",
          payment_provider: "subscriptions.billing_provider (null pour un contrat manuel non qualifié)",
          last_followup_at:
            "subscriptions.last_reminder_at (dernier rappel client réellement envoyé ; null si aucun)",
          next_renewal_date: "subscriptions.next_renewal_date",
          active_count: "nombre de lignes dont payment_status vaut active",
          payment_issue_count:
            "nombre de lignes dont payment_status vaut past_due ou unpaid (paused n'est pas un incident)",
          monthly_revenue_eur:
            "somme de amount_eur pour les lignes actives uniquement",
        },
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error: unknown) {
    console.error("[admin/subscribers] Impossible de charger les abonnés.", error);
    return NextResponse.json(
      { error: "Impossible de charger les abonnés." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
