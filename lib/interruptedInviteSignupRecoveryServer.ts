import "server-only";

import type { User } from "@supabase/supabase-js";

import { provisionNewAccountBubbleAccess } from "@/lib/appBubbleAccessProvisioning";
import { requireEnv } from "@/lib/env";
import { ensureProfileRow } from "@/lib/ensureProfileRow";
import { ensurePrincipalInrcyAccountProvisioned } from "@/lib/inrcyAccountProvisioning";
import {
  ensureNotificationPreferences,
  seedWelcomeNotifications,
} from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NEW_ACCOUNT_EDITION } from "@/lib/trialSubscription";
import {
  SIGNUP_FORM_METADATA_KEY,
  type SignupFormSnapshot,
} from "@/lib/signupFormSnapshot";
import { recoverInterruptedPublicInviteSignup } from "@/lib/interruptedInviteSignupRecoveryFlow";
import {
  SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY,
  type RecoveryClaim,
} from "@/lib/signupRecoveryProof";
import { markPublicSignupTrialCompleted } from "@/lib/signupTrialCompletion";
import { log } from "@/lib/observability/logger";
import {
  DEFAULT_APP_LOCALE,
  appLanguageFromLocale,
  tryNormalizeAppLocale,
} from "@/i18n/config";

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

async function hasSubscription(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  return Boolean(data);
}

async function ensureBubbleDefaults(userId: string) {
  // Match the public signup's canonical defaults after Auth triggers run.
  // This keeps Site iNrCy opt-in even when the deployed trigger is stale.
  await provisionNewAccountBubbleAccess(userId);
}

async function ensureProfile(user: User, claim: RecoveryClaim) {
  const snapshot: SignupFormSnapshot = claim.snapshot;
  await ensureProfileRow(user);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone")
    .eq("user_id", user.id)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw new Error("interrupted_signup_profile_missing");

  const expected = {
    admin_email: user.email?.trim().toLowerCase() || "",
    contact_email: user.email?.trim().toLowerCase() || "",
    first_name: snapshot.firstName,
    last_name: snapshot.lastName,
    company_legal_name: snapshot.companyName,
    phone: snapshot.phone,
  };
  const missing = Object.fromEntries(
    Object.entries(expected).filter(([key, value]) => value && !data[key as keyof typeof expected]),
  );
  if (Object.keys(missing).length === 0) return;

  const { error: patchError } = await supabaseAdmin
    .from("profiles")
    .update({ ...missing, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
  throwIfError(patchError);
}

async function ensureBusinessLanguage(userId: string, user: User) {
  const metadata = user.user_metadata || {};
  const locale =
    tryNormalizeAppLocale(metadata.app_locale) ||
    tryNormalizeAppLocale(metadata.app_language) ||
    DEFAULT_APP_LOCALE;
  const { error } = await supabaseAdmin
    .from("business_profiles")
    .upsert({
      user_id: userId,
      app_language: appLanguageFromLocale(locale),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id", ignoreDuplicates: true });
  throwIfError(error);
}

async function ensurePreferencesIfMissing(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) await ensureNotificationPreferences(userId);
}

async function ensureMissingTrial(userId: string, email: string, claim: RecoveryClaim) {
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert({
      user_id: userId,
      plan: "Trial",
      app_edition: NEW_ACCOUNT_EDITION,
      status: "trialing",
      monthly_price_eur: 0,
      start_date: claim.trialStartAt.slice(0, 10),
      contact_email: email,
      trial_start_at: claim.trialStartAt,
      trial_end_at: claim.trialEndAt,
      last_trial_reminder_day: 0,
      last_reminder_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id", ignoreDuplicates: true });
  throwIfError(error);
  if (!(await hasSubscription(userId))) {
    throw new Error("interrupted_signup_trial_missing");
  }
}

export async function recoverInterruptedPublicInviteSignupForUser(
  verifiedUser: User,
) {
  const verifiedEmail = verifiedUser.email?.trim().toLowerCase() || null;
  // Ordinary password resets have no public signup snapshot and need no
  // subscription lookup or provisioning work.
  if (!verifiedUser.user_metadata?.[SIGNUP_FORM_METADATA_KEY]) {
    return "ineligible";
  }
  if (verifiedUser.app_metadata?.[SIGNUP_TRIAL_COMPLETED_APP_METADATA_KEY]) {
    return "already_claimed";
  }

  return recoverInterruptedPublicInviteSignup<User>(
    verifiedUser.id,
    verifiedEmail,
    requireEnv("INRCY_TRIAL_SIGNUP_SECRET"),
    {
    hasSubscription,
    async getAuthUser(userId) {
      const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
      throwIfError(error);
      return data.user;
    },
    async ensurePrincipal(user) {
      await ensurePrincipalInrcyAccountProvisioned(user);
    },
    ensureBubbleDefaults,
    ensureProfile,
    ensureBusinessLanguage,
    ensureNotificationPreferences: ensurePreferencesIfMissing,
    async seedWelcomeNotifications(userId) {
      await seedWelcomeNotifications(userId);
    },
    ensureMissingTrial,
    markCompleted: markPublicSignupTrialCompleted,
    onExistingSubscriptionMarkerFailure(userId, error) {
      log.warn("auth_invite_existing_trial_marker_failed", {
        user_id: userId,
        error_code: error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unknown",
      });
    },
  });
}
