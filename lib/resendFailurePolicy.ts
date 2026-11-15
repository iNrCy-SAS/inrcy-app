export type ResendQuotaScope = "daily" | "monthly";

export type ResendFailureDetails = {
  code: string;
  message: string;
  providerCode: string | null;
  responseCode: number;
  quotaScope: ResendQuotaScope | null;
  retryAt: string | null;
  retryAtIsEstimate: boolean;
  retryAfterSeconds: number | null;
  retryable: boolean;
  deliveryState: "rejected" | "unknown";
};

const KNOWN_CODES = new Set([
  "daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded",
  "validation_error", "missing_api_key", "restricted_api_key", "suspended_api_key",
  "invalid_permission", "invalid_idempotency_key", "invalid_idempotent_request",
  "concurrent_idempotent_requests", "application_error", "service_unavailable", "dns_lookup_failed",
]);

export function resendRetryAfterSeconds(header: string | null, nowMs = Date.now()): number | null {
  if (!header?.trim()) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= (8.64e15 - nowMs) / 1000) return Math.ceil(seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) && date >= nowMs ? Math.ceil((date - nowMs) / 1000) : null;
}

/** Classify only provider codes, never include provider text, recipients or credentials. */
export function resendFailureDetails(
  status: number,
  name: unknown,
  retryAfter: string | null,
  nowMs = Date.now(),
): ResendFailureDetails {
  const providerCode = typeof name === "string" && KNOWN_CODES.has(name) ? name : null;
  const delay = resendRetryAfterSeconds(retryAfter, nowMs);
  const quotaScope: ResendQuotaScope | null = status === 429 && providerCode === "daily_quota_exceeded" ? "daily"
    : status === 429 && providerCode === "monthly_quota_exceeded" ? "monthly" : null;
  let retryMs: number | null = null;
  let retryAtIsEstimate = false;
  if (quotaScope === "daily") {
    const midnight = new Date(nowMs);
    midnight.setUTCHours(24, 0, 0, 0);
    retryMs = Math.max(midnight.getTime(), delay === null ? 0 : nowMs + delay * 1000);
  } else if (quotaScope === "monthly") {
    // Billing-cycle reset is not exposed by the error. This is a later probe,
    // not an assertion that the account quota resets in one hour.
    retryMs = nowMs + Math.max(3600, delay ?? 0) * 1000;
    retryAtIsEstimate = true;
  } else if (status === 429 || status >= 500 || providerCode === "concurrent_idempotent_requests") {
    retryMs = nowMs + (delay ?? (providerCode === "rate_limit_exceeded" ? 1 : 60)) * 1000;
    retryAtIsEstimate = delay === null;
  }
  return {
    code: quotaScope ? "TX_RESEND_QUOTA_EXCEEDED" : status === 429 ? "TX_RESEND_RATE_LIMITED" : "TX_RESEND_DELIVERY_FAILED",
    message: quotaScope === "daily" ? "Le quota quotidien du secours mail est atteint. L’envoi doit attendre la remise à zéro du quota."
      : quotaScope === "monthly" ? "Le quota mensuel du secours mail est atteint. Vérifiez le forfait du fournisseur avant la prochaine reprise."
        : status === 429 ? "Le secours mail limite temporairement les requêtes. L’envoi reste à reprendre."
          : `Le secours mail a refusé la requête (HTTP ${status}).`,
    providerCode, responseCode: status, quotaScope,
    retryAt: retryMs === null ? null : new Date(retryMs).toISOString(),
    retryAtIsEstimate, retryAfterSeconds: retryMs === null ? null : Math.max(0, Math.ceil((retryMs - nowMs) / 1000)),
    retryable: retryMs !== null,
    deliveryState: status >= 500 || providerCode === "concurrent_idempotent_requests" ? "unknown" : "rejected",
  };
}

export class TxResendDeliveryError extends Error {
  readonly provider = "resend";
  readonly code: string;
  readonly providerCode: string | null;
  readonly responseCode: number;
  readonly quotaScope: ResendQuotaScope | null;
  readonly retryAt: string | null;
  readonly retryAtIsEstimate: boolean;
  readonly retryAfterSeconds: number | null;
  readonly retryable: boolean;
  readonly deliveryState: "rejected" | "unknown";
  readonly quotaStateStorage?: "shared" | "instance";

  constructor(details: ResendFailureDetails, storage?: "shared" | "instance") {
    super(details.message);
    this.name = "TxResendDeliveryError";
    this.code = details.code;
    this.providerCode = details.providerCode;
    this.responseCode = details.responseCode;
    this.quotaScope = details.quotaScope;
    this.retryAt = details.retryAt;
    this.retryAtIsEstimate = details.retryAtIsEstimate;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.retryable = details.retryable;
    this.deliveryState = details.deliveryState;
    this.quotaStateStorage = storage;
  }
}
