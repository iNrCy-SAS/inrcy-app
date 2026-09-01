import "server-only";

import type { User } from "@supabase/supabase-js";

import {
  DASHBOARD_ONBOARDING_SELECT,
  normalizeDashboardOnboardingRow,
  type DashboardOnboardingRow,
} from "@/lib/dashboardOnboarding";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getPrincipalDisplayName(user: User) {
  const metadata = user.user_metadata && typeof user.user_metadata === "object"
    ? user.user_metadata as Record<string, unknown>
    : {};

  return (
    cleanString(metadata.company_legal_name) ||
    cleanString(metadata.full_name) ||
    [cleanString(metadata.first_name), cleanString(metadata.last_name)]
      .filter(Boolean)
      .join(" ") ||
    cleanString(user.email) ||
    "Établissement principal"
  ).slice(0, 120);
}

function provisioningError(code: string, detail?: string | null) {
  return new Error(detail ? `${code}: ${detail}` : code);
}

export async function ensureInrcyAccountOnboardingState(
  accountId: string,
): Promise<DashboardOnboardingRow> {
  const normalizedAccountId = cleanString(accountId);
  if (!normalizedAccountId) {
    throw provisioningError("INRCY_ONBOARDING_ACCOUNT_ID_MISSING");
  }

  const { error: ensureError } = await supabaseAdmin.rpc(
    "inrcy_ensure_account_onboarding_state",
    { p_account_id: normalizedAccountId },
  );

  // La relecture est volontaire : un retour RPC sans erreur ne suffit pas à
  // déclarer le compte prêt. Inversement, si le trigger avait déjà fait son
  // travail, une erreur réseau ponctuelle de la RPC ne doit pas créer un faux
  // échec : seule la postcondition en base décide.
  const { data, error } = await supabaseAdmin
    .from("inrcy_onboarding_states")
    .select(DASHBOARD_ONBOARDING_SELECT)
    .eq("account_id", normalizedAccountId)
    .maybeSingle();

  if (error) {
    throw provisioningError("INRCY_ONBOARDING_VERIFICATION_FAILED", error.message);
  }

  const row = normalizeDashboardOnboardingRow(data);
  if (!row || row.accountId !== normalizedAccountId) {
    throw provisioningError(
      "INRCY_ONBOARDING_STATE_NOT_FOUND_AFTER_PROVISIONING",
      ensureError?.message,
    );
  }

  return row;
}

export async function ensurePrincipalInrcyAccountProvisioned(user: User) {
  if (!user?.id) {
    throw provisioningError("INRCY_AUTH_USER_ID_MISSING");
  }

  const { error: ensureError } = await supabaseAdmin.rpc(
    "inrcy_ensure_auth_account_provisioned",
    {
      p_auth_user_id: user.id,
      p_display_name: getPrincipalDisplayName(user),
    },
  );

  const onboarding = await ensureInrcyAccountOnboardingState(user.id);
  const [accountResult, membershipResult, configResult, onboardingResult] =
    await Promise.all([
      supabaseAdmin
        .from("inrcy_accounts")
        .select("id, created_by_auth_user_id")
        .eq("id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("inrcy_account_members")
        .select("auth_user_id, account_id, role, is_default")
        .eq("auth_user_id", user.id)
        .eq("account_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("inrcy_multi_account_config")
        .select("auth_user_id, multi_account_enabled, max_establishments")
        .eq("auth_user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("inrcy_onboarding_states")
        .select(DASHBOARD_ONBOARDING_SELECT)
        .eq("account_id", user.id)
        .maybeSingle(),
    ]);

  const firstError = [
    accountResult.error,
    membershipResult.error,
    configResult.error,
    onboardingResult.error,
  ].find(Boolean);
  if (firstError) {
    throw provisioningError(
      "INRCY_PRINCIPAL_ACCOUNT_VERIFICATION_FAILED",
      firstError?.message,
    );
  }

  const account = accountResult.data;
  const membership = membershipResult.data;
  const config = configResult.data;
  const verifiedOnboarding = normalizeDashboardOnboardingRow(onboardingResult.data);

  if (!account || account.id !== user.id) {
    throw provisioningError("INRCY_PRINCIPAL_ACCOUNT_MISSING", ensureError?.message);
  }
  if (
    !membership ||
    membership.auth_user_id !== user.id ||
    membership.account_id !== user.id ||
    membership.role !== "owner" ||
    membership.is_default !== true
  ) {
    throw provisioningError("INRCY_PRINCIPAL_MEMBERSHIP_INVALID");
  }
  if (
    !config ||
    config.auth_user_id !== user.id ||
    Number(config.max_establishments) < 1
  ) {
    throw provisioningError("INRCY_MULTI_ACCOUNT_CONFIG_INVALID");
  }
  if (!verifiedOnboarding || verifiedOnboarding.accountId !== onboarding.accountId) {
    throw provisioningError("INRCY_PRINCIPAL_ONBOARDING_INVALID", ensureError?.message);
  }

  return {
    accountId: user.id,
    onboarding: verifiedOnboarding,
  };
}
