import { isAiMediaContentPolicyRejection } from "./aiMediaGenerationPublicErrors.ts";

export const INR_AGENT_EDITORIAL_MAX_TRANSIENT_ATTEMPTS = 8;
export const INR_AGENT_EDITORIAL_MAX_QUOTA_ATTEMPTS = 12;
export const INR_AGENT_EDITORIAL_TRANSIENT_RETRY_DELAY_MS = 15 * 60 * 1000;
export const INR_AGENT_EDITORIAL_QUOTA_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

function normalizedError(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Resume future calendar slots stopped by the former media-wallet rule only. */
export function shouldResumeInrAgentMediaCreditFailure(args: {
  status: string;
  editorialPlan: unknown;
  scheduledFor: string | null;
  refusedAt?: string | null;
  error: unknown;
  nowMs: number;
}) {
  const message = normalizedError(args.error);
  return args.editorialPlan === true &&
    (args.status === "draft" || args.status === "failed") &&
    !args.refusedAt &&
    Date.parse(args.scheduledFor || "") > args.nowMs &&
    (message.includes("le quota de medias est insuffisant pour terminer cette publication") ||
      message.includes("inr_agent_ai_media_quota_reached"));
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

function maxAttemptsFor(error: unknown, retryReason?: unknown) {
  return isInrAgentEditorialQuotaLimitError(error) ||
    normalizedError(retryReason) === "quota"
    ? INR_AGENT_EDITORIAL_MAX_QUOTA_ATTEMPTS
    : INR_AGENT_EDITORIAL_MAX_TRANSIENT_ATTEMPTS;
}

export function inrAgentEditorialRetryDecision(args: {
  error: unknown;
  attempts: number;
  nowMs: number;
}) {
  if (isAiMediaContentPolicyRejection(args.error)) {
    return { quotaLimited: false, retry: false, retryAt: null } as const;
  }
  const quotaLimited = isInrAgentEditorialQuotaLimitError(args.error);
  const maxAttempts = maxAttemptsFor(args.error);
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

export function shouldRecoverInrAgentEditorialFailure(args: {
  status: string;
  editorialState: string;
  attempts: number;
  error: unknown;
  retryReason?: unknown;
}) {
  if (normalizedError(args.retryReason) === "content_policy" || isAiMediaContentPolicyRejection(args.error)) return false;
  const quotaLimited = isInrAgentEditorialQuotaLimitError(args.error);
  const retryReason = normalizedError(args.retryReason);
  const transientFailure = retryReason === "transient_error";
  const maxAttempts = maxAttemptsFor(args.error, args.retryReason);
  return (
    args.status === "failed" &&
    args.editorialState === "failed" &&
    Math.max(0, args.attempts) < maxAttempts &&
    (quotaLimited || retryReason === "quota" || transientFailure)
  );
}

/** Failed rows below the retry limit still own their idea until a retry succeeds or stops. */
export function isTerminalInrAgentEditorialFailure(args: {
  status: string;
  editorialState: string;
  attempts: number;
  error: unknown;
  retryReason?: unknown;
}) {
  return args.status === "failed" &&
    args.editorialState === "failed" &&
    (normalizedError(args.retryReason) === "content_policy" || isAiMediaContentPolicyRejection(args.error) ||
      Math.max(0, args.attempts) >= maxAttemptsFor(args.error, args.retryReason));
}
