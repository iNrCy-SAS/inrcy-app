import { NextResponse } from "next/server";
import {
  isRelevantAdminSubscriber,
  sortAdminSubscribers,
  summarizeAdminSubscribers,
  toAdminSubscriber,
  type AdminSubscriber,
  type AdminSubscriberProfileRow,
  type AdminSubscriberSubscriptionRow,
  type StoredAdminSubscriberStatus,
} from "@/lib/adminSubscribers";
import { collectSupabaseKeysetPages } from "@/lib/adminSubscriberPagination";
import {
  isCurrentStripeSubscriber,
  matchAdminSubscribersToStripe,
  overlaySubscriptionWithStripe,
  type AdminSubscriberReconciliationRecord,
  type StripeAdminSubscriberSnapshot,
} from "@/lib/adminSubscriberStripe";
import { listStripeAdminSubscriberSnapshots } from "@/lib/adminSubscriberStripeServer";
import { requireAdminApi } from "@/lib/adminSecurity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUBSCRIPTION_PAGE_SIZE = 500;
const PROFILE_BATCH_SIZE = 100;
const SUBSCRIPTION_SELECT =
  "user_id,contact_email,plan,status,monthly_price_eur,billing_cycle,billing_provider,stripe_customer_id,stripe_subscription_id,stripe_price_id,last_reminder_at,next_renewal_date,updated_at";
const PROFILE_SELECT =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
};

type AdminSubscriberStorageRow = AdminSubscriberSubscriptionRow & {
  updated_at: string | null;
};

async function fetchSubscriptions() {
  return collectSupabaseKeysetPages<AdminSubscriberStorageRow>({
    pageSize: SUBSCRIPTION_PAGE_SIZE,
    getCursor: (row) => row.user_id,
    fetchPage: async (after, limit) => {
      const baseQuery = supabaseAdmin
        .from("subscriptions")
        .select(SUBSCRIPTION_SELECT)
        .order("user_id", { ascending: true })
        .limit(limit);
      const { data, error } = await (after ? baseQuery.gt("user_id", after) : baseQuery);
      if (error) throw error;
      return (data ?? []) as AdminSubscriberStorageRow[];
    },
  });
}

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

function unverifiedLocalSubscriber(
  subscription: AdminSubscriberSubscriptionRow,
  profile: AdminSubscriberProfileRow | null,
  ambiguous: boolean,
): AdminSubscriber {
  const provider = String(subscription.billing_provider ?? "").trim().toLowerCase();
  const hasIndependentProvider = Boolean(provider && provider !== "stripe");
  const displaySubscription = hasIndependentProvider
    ? subscription
    : { ...subscription, monthly_price_eur: null };
  return toAdminSubscriber(displaySubscription, profile, {
    paymentStatus: hasIndependentProvider
      ? (String(subscription.status).toLowerCase() as StoredAdminSubscriberStatus)
      : "unverified",
    paymentStatusSource: hasIndependentProvider ? "provider_database" : "unverified",
    reconciliationStatus: ambiguous ? "ambiguous" : "unmatched",
  });
}

function unmatchedStripeSubscriber(snapshot: StripeAdminSubscriberSnapshot): AdminSubscriber {
  const subscription: AdminSubscriberSubscriptionRow = {
    user_id: `stripe:${snapshot.subscription_id}`,
    contact_email: snapshot.customer_email,
    plan: null,
    status: snapshot.status,
    monthly_price_eur: snapshot.amount_eur,
    billing_cycle: snapshot.billing_cycle,
    billing_provider: "stripe",
    stripe_customer_id: snapshot.customer_id,
    stripe_subscription_id: snapshot.subscription_id,
    stripe_price_id: snapshot.price_id,
    last_reminder_at: null,
    next_renewal_date: snapshot.next_renewal_date,
  };
  const profile: AdminSubscriberProfileRow = {
    user_id: subscription.user_id,
    admin_email: snapshot.customer_email,
    contact_email: null,
    first_name: snapshot.customer_name,
    last_name: null,
    company_legal_name: null,
    phone: snapshot.customer_phone,
  };
  return toAdminSubscriber(subscription, profile, {
    paymentStatus: snapshot.status as StoredAdminSubscriberStatus,
    paymentStatusSource: "stripe_live",
    reconciliationStatus: "unmatched",
  });
}

export async function GET() {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  try {
    // GET is strictly read-only. Durable backfill is delegated to the secured cron.
    const stripePromise = listStripeAdminSubscriberSnapshots()
      .then((value) => ({ ok: true as const, value }))
      .catch(() => ({ ok: false as const }));
    const { rows: subscriptions, pages: supabasePages } = await fetchSubscriptions();
    const userIds = Array.from(new Set(subscriptions.map((row) => row.user_id)));
    const profilesByUserId = await fetchProfiles(userIds);
    const records: AdminSubscriberReconciliationRecord[] = subscriptions.map(
      (subscription) => ({
        subscription,
        profile: profilesByUserId.get(subscription.user_id) ?? null,
      }),
    );

    let stripeState: "fresh" | "degraded" = "fresh";
    let stripePages = 0;
    let stripeSubscriptionsScanned = 0;
    let snapshots: StripeAdminSubscriberSnapshot[] = [];
    const stripeOutcome = await stripePromise;
    if (stripeOutcome.ok) {
      const stripeResult = stripeOutcome.value;
      snapshots = stripeResult.snapshots;
      stripePages = stripeResult.pages;
      stripeSubscriptionsScanned = stripeResult.subscriptions_scanned;
    } else {
      stripeState = "degraded";
      console.warn("[admin/subscribers][stripe_reconciliation_unavailable]");
    }

    const subscribers: AdminSubscriber[] = [];
    let matchedCount = 0;
    let ambiguousCount = 0;
    let unmatchedStripeCount = 0;
    let reviewRequiredCount = 0;
    let matchMethodCounts: Record<string, number> = {};

    if (stripeState === "fresh") {
      const reconciliation = matchAdminSubscribersToStripe(records, snapshots);
      matchedCount = reconciliation.matchesByUserId.size;
      ambiguousCount = reconciliation.ambiguousUserIds.size;
      unmatchedStripeCount = reconciliation.unmatchedStripeSubscriptionIds.size;
      reviewRequiredCount = Array.from(reconciliation.matchesByUserId.values()).filter(
        (match) => !match.write_safe,
      ).length;
      matchMethodCounts = reconciliation.matchMethodCounts;

      for (const record of records) {
        const match = reconciliation.matchesByUserId.get(record.subscription.user_id);
        if (match) {
          const live = overlaySubscriptionWithStripe(record.subscription, match.snapshot);
          if (isCurrentStripeSubscriber(match.snapshot)) {
            subscribers.push(
              toAdminSubscriber(live, record.profile, {
                paymentStatus: match.snapshot.status as StoredAdminSubscriberStatus,
                paymentStatusSource: "stripe_live",
                reconciliationStatus: match.write_safe ? "matched" : "review_required",
                reconciliationMethod: match.method,
                reconciliationCandidate: match.write_safe
                  ? null
                  : {
                      name: match.snapshot.customer_name,
                      email: match.snapshot.customer_email,
                      phone: match.snapshot.customer_phone,
                      amount_eur: match.snapshot.amount_eur,
                      payment_status: match.snapshot.status as StoredAdminSubscriberStatus,
                      stripe_subscription_id: match.snapshot.subscription_id,
                    },
              }),
            );
          }
          continue;
        }

        if (isRelevantAdminSubscriber(record.subscription)) {
          subscribers.push(
            unverifiedLocalSubscriber(
              record.subscription,
              record.profile,
              reconciliation.ambiguousUserIds.has(record.subscription.user_id),
            ),
          );
        }
      }

      const snapshotById = new Map(
        snapshots.map((snapshot) => [snapshot.subscription_id, snapshot]),
      );
      for (const subscriptionId of reconciliation.unmatchedStripeSubscriptionIds) {
        const snapshot = snapshotById.get(subscriptionId);
        if (snapshot) subscribers.push(unmatchedStripeSubscriber(snapshot));
      }
    } else {
      // Never display an unknown/stale Stripe state as a green "À jour".
      for (const record of records) {
        if (isRelevantAdminSubscriber(record.subscription)) {
          subscribers.push(unverifiedLocalSubscriber(record.subscription, record.profile, false));
        }
      }
    }

    const sortedSubscribers = sortAdminSubscribers(subscribers);
    const {
      active_count,
      payment_issue_count,
      monthly_revenue_eur,
      unpriced_active_count,
      revenue_complete: pricedRevenueComplete,
    } =
      summarizeAdminSubscribers(sortedSubscribers);
    const unverifiedCount = sortedSubscribers.filter(
      (subscriber) => subscriber.payment_status === "unverified",
    ).length;
    const revenueComplete =
      stripeState === "fresh" && unverifiedCount === 0 && pricedRevenueComplete;
    // Count affected listing rows once; an ambiguous local row is also
    // unverified but must not inflate the global anomaly counter twice.
    const reconciliationAnomalyCount = sortedSubscribers.filter(
      (subscriber) =>
        subscriber.reconciliation_status === "ambiguous" ||
        subscriber.reconciliation_status === "unmatched" ||
        subscriber.reconciliation_status === "review_required" ||
        subscriber.payment_status === "unverified",
    ).length;

    return NextResponse.json(
      {
        subscribers: sortedSubscribers,
        total: sortedSubscribers.length,
        active_count,
        payment_issue_count,
        monthly_revenue_eur,
        unpriced_active_count,
        revenue_complete: revenueComplete,
        unverified_count: unverifiedCount,
        review_required_count: reviewRequiredCount,
        reconciliation_anomaly_count: reconciliationAnomalyCount,
        generated_at: new Date().toISOString(),
        stripe_reconciliation: {
          status: stripeState,
          matched_count: matchedCount,
          ambiguous_count: ambiguousCount,
          unmatched_stripe_count: unmatchedStripeCount,
          review_required_count: reviewRequiredCount,
          subscriptions_scanned: stripeSubscriptionsScanned,
          stripe_pages: stripePages,
          supabase_pages: supabasePages,
          match_methods: matchMethodCounts,
        },
        field_sources: {
          user_id:
            "subscriptions.user_id; préfixe stripe: pour une ligne Stripe live non rapprochée",
          name:
            "profiles.first_name + profiles.last_name, sinon société; Stripe customer.name pour une ligne non rapprochée",
          company_name: "profiles.company_legal_name; null pour une ligne Stripe non rapprochée",
          email:
            "profiles.admin_email/contact_email; Stripe customer.email pour une ligne live",
          phone: "profiles.phone; Stripe customer.phone pour une ligne non rapprochée",
          amount_eur:
            "Stripe live: montant contractuel des items récurrents EUR ramené au mois, hors remises/taxes; sinon Supabase",
          billing_cycle: "Stripe live en priorité; sinon subscriptions.billing_cycle",
          payment_status:
            "Stripe live en priorité; unverified si Stripe/provider ne peut pas être confirmé",
          reconciliation_candidate:
            "identité et contrat Stripe live proposés uniquement pour une confirmation review_required",
          stored_payment_status: "subscriptions.status avant overlay Stripe",
          payment_provider: "Stripe live, sinon subscriptions.billing_provider",
          last_followup_at:
            "subscriptions.last_reminder_at (dernier rappel réellement envoyé; jamais updated_at)",
          next_renewal_date: "Stripe live en priorité; sinon Supabase",
          active_count: "nombre de lignes confirmées avec payment_status active",
          payment_issue_count:
            "nombre de lignes confirmées past_due ou unpaid; paused n'est pas un incident",
          monthly_revenue_eur:
            "somme des montants contractuels Stripe ramenés au mois pour les lignes actives valorisées; hors remises/taxes",
          unpriced_active_count:
            "nombre de lignes actives confirmées dont le montant Stripe ne peut pas être représenté honnêtement",
          revenue_complete:
            "false si Stripe est indisponible, si une ligne est non vérifiée ou si un actif confirmé n'a pas de montant mensuel fiable",
        },
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch {
    console.error("[admin/subscribers][load_failed]");
    return NextResponse.json(
      { error: "Impossible de charger les abonnés." },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}

function requestText(value: unknown, maxLength = 200): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text && text.length <= maxLength ? text : null;
}

/**
 * Explicitly confirms a read-only `review_required` suggestion from GET.
 * The server recomputes the full live reconciliation; client-provided profile
 * data or Stripe amounts/statuses are never trusted.
 */
export async function POST(request: Request) {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return NextResponse.json(
      { error: "Requête invalide." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const userId = requestText(body.user_id);
  const stripeSubscriptionId = requestText(body.stripe_subscription_id);
  const unexpectedFields = Object.keys(body).filter(
    (key) => key !== "user_id" && key !== "stripe_subscription_id",
  );
  if (
    !userId ||
    !stripeSubscriptionId ||
    unexpectedFields.length > 0 ||
    !/^sub_[A-Za-z0-9_]+$/.test(stripeSubscriptionId)
  ) {
    return NextResponse.json(
      { error: "Identifiants invalides." },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const [{ rows }, stripe] = await Promise.all([
      fetchSubscriptions(),
      listStripeAdminSubscriberSnapshots(),
    ]);
    const target = rows.find((row) => row.user_id === userId);
    if (!target) {
      return NextResponse.json(
        { error: "Abonné introuvable." },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const duplicateOwner = rows.some(
      (row) =>
        row.user_id !== userId &&
        String(row.stripe_subscription_id ?? "").trim() === stripeSubscriptionId,
    );
    if (duplicateOwner) {
      return NextResponse.json(
        { error: "Cet abonnement Stripe est déjà rattaché à un autre compte." },
        { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const profiles = await fetchProfiles(Array.from(new Set(rows.map((row) => row.user_id))));
    const records: AdminSubscriberReconciliationRecord[] = rows.map((subscription) => ({
      subscription,
      profile: profiles.get(subscription.user_id) ?? null,
    }));
    const reconciliation = matchAdminSubscribersToStripe(records, stripe.snapshots);
    const match = reconciliation.matchesByUserId.get(userId);
    if (
      match &&
      String(target.stripe_subscription_id ?? "").trim() === stripeSubscriptionId &&
      match.snapshot.subscription_id === stripeSubscriptionId &&
      isCurrentStripeSubscriber(match.snapshot)
    ) {
      return NextResponse.json(
        {
          ok: true,
          already_confirmed: true,
          user_id: userId,
          stripe_subscription_id: stripeSubscriptionId,
          reconciliation_method: match.method,
        },
        { headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    if (
      !match ||
      match.write_safe ||
      match.snapshot.subscription_id !== stripeSubscriptionId ||
      !isCurrentStripeSubscriber(match.snapshot)
    ) {
      return NextResponse.json(
        { error: "Le rapprochement doit être revérifié avant confirmation." },
        { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    const snapshot = match.snapshot;
    const patch: Record<string, string | number | null> = {
      billing_provider: "stripe",
      stripe_subscription_id: snapshot.subscription_id,
      status: snapshot.status,
      updated_at: new Date().toISOString(),
    };
    if (snapshot.customer_id) patch.stripe_customer_id = snapshot.customer_id;
    if (snapshot.price_id) patch.stripe_price_id = snapshot.price_id;
    if (
      snapshot.amount_eur != null &&
      Number.isFinite(snapshot.amount_eur) &&
      snapshot.amount_eur >= 0
    ) {
      patch.monthly_price_eur = snapshot.amount_eur;
    }
    if (snapshot.billing_cycle === "monthly" || snapshot.billing_cycle === "yearly") {
      patch.billing_cycle = snapshot.billing_cycle;
    }
    if (snapshot.next_renewal_date) {
      patch.next_renewal_date = snapshot.next_renewal_date;
    }

    let updateQuery = supabaseAdmin
      .from("subscriptions")
      .update(patch)
      .eq("user_id", target.user_id);
    updateQuery = target.stripe_subscription_id == null
      ? updateQuery.is("stripe_subscription_id", null)
      : updateQuery.eq("stripe_subscription_id", target.stripe_subscription_id);
    updateQuery = target.updated_at == null
      ? updateQuery.is("updated_at", null)
      : updateQuery.eq("updated_at", target.updated_at);
    const { data, error } = await updateQuery.select("user_id").maybeSingle();
    if (error) {
      console.warn("[admin/subscribers][confirmation_write_conflict]", {
        code: typeof error.code === "string" ? error.code : "unknown",
      });
      return NextResponse.json(
        { error: "Le rapprochement a changé; rechargez la liste." },
        { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Le rapprochement a changé; rechargez la liste." },
        { status: 409, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        already_confirmed: false,
        user_id: userId,
        stripe_subscription_id: stripeSubscriptionId,
        reconciliation_method: match.method,
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch {
    console.error("[admin/subscribers][confirmation_failed]");
    return NextResponse.json(
      { error: "Impossible de confirmer ce rapprochement maintenant." },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
}
