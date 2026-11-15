import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GmbVerificationStatus } from "@/lib/googleBusinessVerification";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const statuses = new Set<GmbVerificationStatus>(["verified", "pending", "required", "restricted", "unknown"]);
const TTL_MS = 5 * 60 * 60 * 1000;
const authorizationRevision = (meta: Row) => text(meta.connection_version_updated_at || meta.token_issued_at) || null;

/** Cached Google business validation never survives a different selection or
 * OAuth revision. A normal access-token refresh does not renew this evidence. */
export function readStoredGmbVerificationStatus(metaValue: unknown, locationName: string | null, accountName: string | null, nowMs = Date.now()): GmbVerificationStatus {
  const meta = object(metaValue);
  const saved = object(meta.gmb_verification);
  const checkedAt = Date.parse(text(saved.checked_at));
  if (!locationName || !accountName || saved.locationName !== locationName || saved.accountName !== accountName
    || !Object.hasOwn(saved, "authorization_revision") || saved.authorization_revision !== authorizationRevision(meta)
    || !Number.isFinite(checkedAt) || checkedAt > nowMs + 60_000 || nowMs - checkedAt >= TTL_MS
    || !statuses.has(saved.status as GmbVerificationStatus)) return "unknown";
  return saved.status as GmbVerificationStatus;
}

/** Only business-permission refusals are eligible for a Voice of Merchant
 * check. Explicit OAuth/token failures and service configuration errors retain
 * the existing failure path even if another Google endpoint is available. */
export function shouldCheckGmbBusinessEligibility(error: unknown): boolean {
  const value = object(error);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : text(value.message);
  const status = Number(value.status || value.httpStatus || value.statusCode || value.responseCode || value.code);
  const raw = message.toLowerCase();
  if (status === 401 || /\b401\b|invalid[_ -]?(?:grant|token|client)|unauthorized[_ -]?client|invalid authentication credentials|insufficient authentication scopes|access token.{0,50}(?:expired|revoked|invalid)|refresh token|service_disabled|accessnotconfigured|access not configured|api.{0,60}(?:not enabled|has not been used)|serviceusage/.test(raw)) return false;
  return status === 403 || /\b403\b|permission[_ ]denied|caller.{0,40}(?:does not have|has no) permission/.test(raw);
}

export type PersistedGmbVerification = { status: GmbVerificationStatus; persisted: boolean; clearedStatsReconnect: boolean };

/** Best effort, compare-and-swap only: enrichment cannot change credentials,
 * selection or authorization. An inconclusive provider response preserves fresh
 * evidence without renewing it; even this fallback requires the same snapshot.
 * A losing/stale write returns unknown to callers. */
export async function persistGmbVerification({ db, userId, row, locationName, accountName, status, selectionValidated = false, nowMs = Date.now() }: {
  db: SupabaseClient; userId: string; row: Row; locationName: string; accountName: string;
  status: GmbVerificationStatus; selectionValidated?: boolean; nowMs?: number;
}): Promise<PersistedGmbVerification> {
  const inconclusive = (): PersistedGmbVerification => ({ status: "unknown", persisted: false, clearedStatsReconnect: false });
  const meta = object(row.meta);
  if (!statuses.has(status) || !row.id || row.user_id !== userId || row.provider !== "google" || row.source !== "gmb" || row.product !== "gmb"
    || !["connected", "account_connected"].includes(text(row.status)) || row.resource_id !== locationName
    || !/^locations\/[a-zA-Z0-9_-]+$/.test(locationName) || !/^accounts\/[a-zA-Z0-9_-]+$/.test(accountName)
    || (text(meta.account) && meta.account !== accountName)) return inconclusive();
  const nextMeta: Row = { ...meta };
  const currentStatus = status === "unknown" ? readStoredGmbVerificationStatus(meta, locationName, accountName, nowMs) : status;
  const clearsStatsMarker = selectionValidated && status !== "unknown"
    && meta.needs_reconnect_reason === "provider_authentication_failed" && meta.needs_reconnect_stage === "stats_provider_metrics";
  if (clearsStatsMarker) {
    for (const key of ["needs_reconnect", "needs_reconnect_at", "needs_reconnect_reason", "needs_reconnect_stage", "needs_reconnect_channel"]) delete nextMeta[key];
  }
  if (status !== "unknown") nextMeta.gmb_verification = { status, locationName, accountName, checked_at: new Date(nowMs).toISOString(), authorization_revision: authorizationRevision(meta) };
  try {
    let update = db.from("integrations").update({ meta: nextMeta })
      .eq("id", row.id).eq("user_id", userId).eq("provider", "google").eq("source", "gmb").eq("product", "gmb");
    for (const key of ["status", "email_address", "access_token_enc", "refresh_token_enc", "expires_at", "resource_id", "resource_label"] as const) {
      update = row[key] == null ? update.is(key, null) : update.eq(key, row[key]);
    }
    update = row.meta == null ? update.is("meta", null) : update.eq("meta", JSON.stringify(row.meta));
    const { data, error } = await update.select("id").maybeSingle();
    if (error || !data?.id) return inconclusive();
    return { status: currentStatus, persisted: true, clearedStatsReconnect: Boolean(clearsStatsMarker && meta.needs_reconnect) };
  } catch {
    return inconclusive();
  }
}
