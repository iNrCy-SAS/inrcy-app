import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminSecurity";
import { getTrialDays } from "@/lib/trialSubscription";
import {
  ADMIN_TRIAL_FOLLOWUP_OFFSETS,
  calendarDaysUntil,
} from "@/lib/trialFollowup";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type TrialSubscriptionRow = {
  user_id: string;
  contact_email: string | null;
  plan: string | null;
  scheduled_plan: string | null;
  status: string | null;
  start_date: string | null;
  trial_start_at: string | null;
  trial_end_at: string | null;
  stripe_subscription_id: string | null;
  last_trial_reminder_day: number | null;
  last_reminder_at: string | null;
};

type TrialProfileRow = {
  user_id: string;
  admin_email: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
  company_legal_name: string | null;
  phone: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function isoFromStartDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function fallbackTrialEnd(startAt: string | null, trialDays: number) {
  if (!startAt) return null;
  const start = new Date(startAt);
  if (!Number.isFinite(start.getTime())) return null;
  return new Date(start.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();
}

function resolveState(input: {
  status: string | null;
  daysRemaining: number | null;
  hasScheduledSubscription: boolean;
}) {
  if (input.hasScheduledSubscription) return "scheduled" as const;
  const status = normalizeText(input.status).toLowerCase();
  if (status === "trial_expired" || (input.daysRemaining !== null && input.daysRemaining < 0)) {
    return "expired" as const;
  }
  if (input.daysRemaining !== null && input.daysRemaining >= 0 && input.daysRemaining <= 3) {
    return "followup" as const;
  }
  return "active" as const;
}

export async function GET() {
  const admin = await requireAdminApi();
  if (!admin.ok) return admin.response;

  try {
    const { data: subscriptionRows, error: subscriptionError } = await supabaseAdmin
      .from("subscriptions")
      .select("user_id,contact_email,plan,scheduled_plan,status,start_date,trial_start_at,trial_end_at,stripe_subscription_id,last_trial_reminder_day,last_reminder_at")
      .eq("plan", "Trial")
      .order("trial_end_at", { ascending: true, nullsFirst: false })
      .limit(500);

    if (subscriptionError) throw subscriptionError;
    const subscriptions = (subscriptionRows ?? []) as TrialSubscriptionRow[];
    const userIds = subscriptions.map((row) => row.user_id).filter(Boolean);

    const profilesByUserId = new Map<string, TrialProfileRow>();
    if (userIds.length > 0) {
      const { data: profileRows, error: profileError } = await supabaseAdmin
        .from("profiles")
        .select("user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone")
        .in("user_id", userIds);
      if (profileError) throw profileError;
      for (const profile of (profileRows ?? []) as TrialProfileRow[]) {
        profilesByUserId.set(profile.user_id, profile);
      }
    }

    const now = new Date();
    const trialDays = getTrialDays();
    const trials = subscriptions.map((subscription) => {
      const profile = profilesByUserId.get(subscription.user_id) ?? null;
      const firstName = normalizeText(profile?.first_name);
      const lastName = normalizeText(profile?.last_name);
      const fullName = [firstName, lastName].filter(Boolean).join(" ") || null;
      const companyName = normalizeText(profile?.company_legal_name) || null;
      const email =
        normalizeText(profile?.admin_email) ||
        normalizeText(profile?.contact_email) ||
        normalizeText(subscription.contact_email) ||
        null;
      const phone = normalizeText(profile?.phone) || null;
      const trialStartAt = subscription.trial_start_at || isoFromStartDate(subscription.start_date);
      const trialEndAt = subscription.trial_end_at || fallbackTrialEnd(trialStartAt, trialDays);
      const daysRemaining = calendarDaysUntil(trialEndAt, now);
      const hasScheduledSubscription = Boolean(normalizeText(subscription.stripe_subscription_id));
      const state = resolveState({
        status: subscription.status,
        daysRemaining,
        hasScheduledSubscription,
      });

      return {
        user_id: subscription.user_id,
        full_name: fullName,
        company_name: companyName,
        email,
        phone,
        registered_at: trialStartAt,
        trial_end_at: trialEndAt,
        days_remaining: daysRemaining,
        state,
        subscription_status: subscription.status,
        scheduled_plan: subscription.scheduled_plan,
        has_scheduled_subscription: hasScheduledSubscription,
        last_customer_reminder_at: subscription.last_reminder_at,
        last_customer_reminder_marker: subscription.last_trial_reminder_day,
      };
    });

    const statePriority = { followup: 0, active: 1, scheduled: 2, expired: 3 } as const;
    trials.sort((left, right) => {
      const stateDelta = statePriority[left.state] - statePriority[right.state];
      if (stateDelta !== 0) return stateDelta;
      const leftEnd = new Date(left.trial_end_at || 0).getTime();
      const rightEnd = new Date(right.trial_end_at || 0).getTime();
      return left.state === "expired" ? rightEnd - leftEnd : leftEnd - rightEnd;
    });

    return NextResponse.json({
      trials,
      total: trials.length,
      generated_at: now.toISOString(),
      trial_days: trialDays,
      admin_reminder_offsets: ADMIN_TRIAL_FOLLOWUP_OFFSETS,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "Impossible de charger les périodes d’essai.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
