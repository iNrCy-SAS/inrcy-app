export const INR_AGENT_EDITORIAL_MAX_TRANSIENT_ATTEMPTS = 4;
export const INR_AGENT_EDITORIAL_MAX_QUOTA_ATTEMPTS = 12;
export const INR_AGENT_EDITORIAL_TRANSIENT_RETRY_DELAY_MS = 15 * 60 * 1000;
export const INR_AGENT_EDITORIAL_QUOTA_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

function normalizedError(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Provider quotas and the account-level AI Gateway fuse are temporary limits.
 * They must never turn an autonomous editorial slot into a permanent failure.
 */
export function isInrAgentEditorialQuotaLimitError(value: unknown) {
  const message = normalizedError(value);
  return (
    /\bquota\b|rate.?limit|too many requests|\b429\b/.test(message) ||
    message.includes("ai_gateway_account_limit_reached") ||
    /limite.{0,100}securite ia/.test(message) ||
    /ai.{0,100}safety limit/.test(message)
  );
}

export function inrAgentEditorialRetryDecision(args: {
  error: unknown;
  attempts: number;
  nowMs: number;
}) {
  const quotaLimited = isInrAgentEditorialQuotaLimitError(args.error);
  const maxAttempts = quotaLimited
    ? INR_AGENT_EDITORIAL_MAX_QUOTA_ATTEMPTS
    : INR_AGENT_EDITORIAL_MAX_TRANSIENT_ATTEMPTS;
  const retry = Math.max(0, args.attempts) < maxAttempts;
  const delayMs = quotaLimited
    ? INR_AGENT_EDITORIAL_QUOTA_RETRY_DELAY_MS
    : INR_AGENT_EDITORIAL_TRANSIENT_RETRY_DELAY_MS;
  return {
    quotaLimited,
    retry,
    retryAt: retry ? new Date(args.nowMs + delayMs).toISOString() : null,
  } as const;
}

export function shouldRecoverInrAgentEditorialQuotaFailure(args: {
  status: string;
  editorialState: string;
  attempts: number;
  error: unknown;
}) {
  return (
    args.status === "failed" &&
    args.editorialState === "failed" &&
    Math.max(0, args.attempts) < INR_AGENT_EDITORIAL_MAX_QUOTA_ATTEMPTS &&
    isInrAgentEditorialQuotaLimitError(args.error)
  );
}
