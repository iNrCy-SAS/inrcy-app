import "server-only";

import type { User } from "@supabase/supabase-js";

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

  const [accountResult, membershipResult, configResult] =
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
    ]);

  const firstError = [
    accountResult.error,
    membershipResult.error,
    configResult.error,
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
  return { accountId: user.id };
}
