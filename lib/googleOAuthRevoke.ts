import "server-only";

import { tryDecryptToken } from "@/lib/oauthCrypto";
import { safeErrorMessage } from "@/lib/tsSafe";
import { log } from "@/lib/observability/logger";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => String(v || "").trim()).filter(Boolean)));
}

export async function revokeGoogleTokensBestEffort(input: {
  accessTokenEnc?: string | null;
  refreshTokenEnc?: string | null;
  integrationId?: string | null;
  context?: string | null;
} | Array<{
  accessTokenEnc?: string | null;
  refreshTokenEnc?: string | null;
  integrationId?: string | null;
  context?: string | null;
}>): Promise<void> {
  const items = Array.isArray(input) ? input : [input];
  const tokens = uniqueNonEmpty(items.flatMap((item) => [
    tryDecryptToken(item.accessTokenEnc || null),
    tryDecryptToken(item.refreshTokenEnc || null),
  ]));

  if (!tokens.length) return;
  // One deadline for the entire best-effort cleanup, not one per token.
  // A slow provider must not prevent the local disconnection from persisting.
  const signal = AbortSignal.timeout(1_500);
  for (const token of tokens) {
    if (signal.aborted) break;
    try {
      const res = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        cache: "no-store",
        signal,
      });

      if (!res.ok) {
        log.warn("google_oauth_revoke_non_ok", {
          status: res.status,
          contexts: items.map((item) => item.context || null).filter(Boolean),
          integration_ids: items.map((item) => item.integrationId || null).filter(Boolean),
        });
      }
    } catch (e) {
      log.warn("google_oauth_revoke_failed", {
        error_message: safeErrorMessage(e),
        contexts: items.map((item) => item.context || null).filter(Boolean),
        integration_ids: items.map((item) => item.integrationId || null).filter(Boolean),
      });
    }
  }
}


function normalizeGoogleIdentity(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function isActiveGoogleIntegrationStatus(value: string | null | undefined): boolean {
  const status = String(value || "").trim().toLowerCase();
  return status === "connected" || status === "account_connected";
}

type GoogleRevokeSafetyRow = {
  id?: string | null;
  provider?: string | null;
  provider_account_id?: string | null;
  email_address?: string | null;
  account_email?: string | null;
  status?: string | null;
  source?: string | null;
  product?: string | null;
};

export async function shouldRevokeGoogleTokensForDisconnect(opts: {
  userId: string;
  rows: GoogleRevokeSafetyRow[];
  context?: string | null;
}): Promise<boolean> {
  const targetRows = Array.isArray(opts.rows) ? opts.rows : [];
  const targetIds = uniqueNonEmpty(targetRows.map((row) => row?.id || null));
  const targetProviderAccountIds = uniqueNonEmpty(targetRows.map((row) => row?.provider_account_id || null));
  const targetEmails = uniqueNonEmpty(targetRows.map((row) => normalizeGoogleIdentity(row?.email_address || row?.account_email || null)));

  // Safety first: if we cannot reliably identify the Google account, never revoke here.
  // Manual disconnection should only affect the selected bubble, not sibling Google products.
  if (!targetProviderAccountIds.length && !targetEmails.length) {
    log.info("google_oauth_revoke_skipped_unidentified_account", {
      context: opts.context || null,
      integration_ids: targetIds,
      user_id: opts.userId,
    });
    return false;
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("integrations")
      .select("id,provider,provider_account_id,email_address,account_email,status,source,product")
      .eq("user_id", opts.userId)
      .in("provider", ["google", "gmail", "youtube"]);

    if (error) {
      log.warn("google_oauth_revoke_safety_query_failed", {
        context: opts.context || null,
        error_message: safeErrorMessage(error),
        integration_ids: targetIds,
        user_id: opts.userId,
      });
      return false;
    }

    const rows = Array.isArray(data) ? (data as GoogleRevokeSafetyRow[]) : [];
    const otherActiveRows = rows.filter((row) => {
      const id = String(row?.id || "").trim();
      if (id && targetIds.includes(id)) return false;
      if (!isActiveGoogleIntegrationStatus(row?.status || null)) return false;

      const providerAccountId = String(row?.provider_account_id || "").trim();
      const emailAddress = normalizeGoogleIdentity(row?.email_address || row?.account_email || null);

      return (providerAccountId && targetProviderAccountIds.includes(providerAccountId)) || (emailAddress && targetEmails.includes(emailAddress));
    });

    if (otherActiveRows.length > 0) {
      log.info("google_oauth_revoke_skipped_shared_account", {
        context: opts.context || null,
        integration_ids: targetIds,
        user_id: opts.userId,
        blockers: otherActiveRows.map((row) => ({
          id: row.id || null,
          provider: row.provider || null,
          source: row.source || null,
          product: row.product || null,
          status: row.status || null,
        })),
      });
      return false;
    }

    return true;
  } catch (e) {
    log.warn("google_oauth_revoke_safety_failed", {
      context: opts.context || null,
      error_message: safeErrorMessage(e),
      integration_ids: targetIds,
      user_id: opts.userId,
    });
    return false;
  }
}
