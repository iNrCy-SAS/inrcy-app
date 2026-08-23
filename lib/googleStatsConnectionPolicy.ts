type UnknownRecord = Record<string, unknown>;

export type GoogleStatsConnectionRow = {
  status?: string | null;
  access_token_enc?: string | null;
  refresh_token_enc?: string | null;
  meta?: unknown;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isGoogleStatsRuntimeRefreshFailure(row: GoogleStatsConnectionRow | null | undefined) {
  const meta = asRecord(row?.meta);
  return (
    String(meta["needs_reconnect_reason"] || "") === "google_refresh_token_invalid" ||
    String(meta["google_stats_refresh_failure_reason"] || "") === "google_refresh_token_invalid"
  );
}

export function hasRecoverableGoogleStatsCredential(row: GoogleStatsConnectionRow | null | undefined) {
  const meta = asRecord(row?.meta);
  return hasText(row?.refresh_token_enc) || meta["uses_admin"] === true;
}

export function hasUsableGoogleStatsCredential(row: GoogleStatsConnectionRow | null | undefined) {
  return hasText(row?.access_token_enc) || hasRecoverableGoogleStatsCredential(row);
}

/**
 * A saved GA4/GSC binding is the business connection shown by both Dashboard
 * and iNrStats. A provider refresh failure must not be confused with the
 * user's explicit Disconnect action:
 *
 * - the explicit action removes the saved binding and credentials;
 * - the runtime failure keeps the binding and a recoverable credential.
 */
export function isGoogleStatsSiteBindingConnected(params: {
  row: GoogleStatsConnectionRow | null | undefined;
  settingsConnected: boolean;
}) {
  const { row, settingsConnected } = params;
  if (!settingsConnected) return false;

  const status = String(row?.status || "").trim().toLowerCase();
  if (status === "connected" || status === "account_connected") {
    return hasUsableGoogleStatsCredential(row);
  }

  if (status === "disconnected" || status === "expired") {
    return (
      isGoogleStatsRuntimeRefreshFailure(row) &&
      hasRecoverableGoogleStatsCredential(row)
    );
  }

  return false;
}

export function canRetryGoogleStatsIntegration(row: GoogleStatsConnectionRow | null | undefined) {
  const status = String(row?.status || "").trim().toLowerCase();
  if (status === "connected" || status === "account_connected") {
    return hasUsableGoogleStatsCredential(row);
  }
  return (
    isGoogleStatsRuntimeRefreshFailure(row) &&
    hasRecoverableGoogleStatsCredential(row)
  );
}

export function isGoogleStatsRefreshRetryDeferred(
  row: GoogleStatsConnectionRow | null | undefined,
  nowMs = Date.now(),
) {
  const retryAt = Date.parse(String(asRecord(row?.meta)["google_stats_refresh_retry_at"] || ""));
  return Number.isFinite(retryAt) && retryAt > nowMs;
}
