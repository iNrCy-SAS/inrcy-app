const REDACTION = "[media-reference-redacted]";

export type AiVideoProviderFailurePhase = "input_storage" | "continuity" | "cost_reservation" |
  "provider_submission" | "asset_download" | "output_validation" | "cost_commit";
export type AiVideoProviderFailureDiagnostics = Readonly<{
  phase?: AiVideoProviderFailurePhase;
  providerHttpStatus?: number;
  providerErrorName?: string;
  providerErrorType?: string;
  providerErrorCode?: string;
  clipIndex?: number;
  clipCount?: number;
  clipDurationSeconds?: number;
  completedClips?: number;
  elapsedMs?: number;
  clipElapsedMs?: number;
  committedCostMicroUsd?: number;
  currentClipAssetObserved?: boolean;
  callerAborted?: boolean;
  providerAborted?: boolean;
  deadlineExceeded?: boolean;
  deadlineKind?: "clip" | "film";
  overallBudgetMs?: number;
  clipBudgetMs?: number;
}>;

const VIDEO_FAILURE_PHASES = new Set<AiVideoProviderFailurePhase>([
  "input_storage", "continuity", "cost_reservation", "provider_submission",
  "asset_download", "output_validation", "cost_commit",
]);
const PROVIDER_ERROR_NAMES = new Set([
  "Error", "AbortError", "TimeoutError", "AI_APICallError", "APICallError", "GatewayResponseError",
  "GatewayTimeoutError", "GatewayInternalServerError", "GatewayInvalidRequestError",
  "GatewayRateLimitError", "GatewayFailedDependencyError", "GatewayModelNotFoundError",
  "GatewayAuthenticationError", "GatewayForbiddenError", "AI_NoVideoGeneratedError",
]);
const PROVIDER_ERROR_TYPES = new Set([
  "response_error", "timeout_error", "internal_server_error", "invalid_request_error",
  "rate_limit_exceeded", "failed_dependency", "model_not_found", "authentication_error", "forbidden",
]);
const PROVIDER_ERROR_CODES = new Set([
  "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ABORT_ERR",
]);

/** No arbitrary SDK strings, request identifiers, URLs or response bodies enter diagnostics. */
export function safeAiVideoProviderFailureDiagnostics(value: unknown): AiVideoProviderFailureDiagnostics | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  if (VIDEO_FAILURE_PHASES.has(input.phase as AiVideoProviderFailurePhase)) output.phase = input.phase;
  if (input.deadlineKind === "clip" || input.deadlineKind === "film") output.deadlineKind = input.deadlineKind;
  for (const [key, allowed] of [["providerErrorName", PROVIDER_ERROR_NAMES], ["providerErrorType", PROVIDER_ERROR_TYPES], ["providerErrorCode", PROVIDER_ERROR_CODES]] as const) {
    if (typeof input[key] === "string" && allowed.has(input[key])) output[key] = input[key];
  }
  const ranges = {
    providerHttpStatus: [400, 599], clipIndex: [0, 2], clipCount: [1, 2], clipDurationSeconds: [0, 30],
    completedClips: [0, 2], elapsedMs: [0, 86_400_000], clipElapsedMs: [0, 86_400_000],
    committedCostMicroUsd: [0, 1_000_000_000],
    overallBudgetMs: [1, 715_000], clipBudgetMs: [1, 600_000],
  } as const;
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    const number = input[key];
    if (typeof number === "number" && Number.isSafeInteger(number) && number >= minimum && number <= maximum) output[key] = number;
  }
  for (const key of ["currentClipAssetObserved", "callerAborted", "providerAborted", "deadlineExceeded"] as const) {
    if (typeof input[key] === "boolean") output[key] = input[key];
  }
  return Object.keys(output).length ? Object.freeze(output) as AiVideoProviderFailureDiagnostics : undefined;
}

/** Extract only machine categories before the private SDK error is discarded. */
export function safeAiVideoProviderErrorMetadata(error: unknown): AiVideoProviderFailureDiagnostics {
  const output: Record<string, unknown> = {};
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current) && seen.size < 5) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if ((!output.providerErrorName || output.providerErrorName === "Error") && typeof record.name === "string" && PROVIDER_ERROR_NAMES.has(record.name)) output.providerErrorName = record.name;
    if (!output.providerErrorType && typeof record.type === "string" && PROVIDER_ERROR_TYPES.has(record.type)) output.providerErrorType = record.type;
    if (!output.providerErrorCode && typeof record.code === "string" && PROVIDER_ERROR_CODES.has(record.code)) output.providerErrorCode = record.code;
    const status = record.statusCode ?? record.status;
    if (!output.providerHttpStatus && typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) output.providerHttpStatus = status;
    current = record.cause;
  }
  return safeAiVideoProviderFailureDiagnostics(output) || {};
}

function stringifySafely(value: unknown) {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "provider_error";
  }
}

/**
 * Retire les data URLs et les séquences base64 suffisamment longues pour
 * contenir un fichier. Cette fonction doit être appliquée avant tout log,
 * warning fournisseur ou message d’échec persistant.
 */
export function redactAiMediaSensitiveText(
  value: unknown,
  maxLength = 1_000,
) {
  const limit = Math.max(1, Math.min(4_000, Math.floor(maxLength)));
  return stringifySafely(value)
    .replace(
      /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+/gi,
      REDACTION,
    )
    .replace(
      /((?:"|')?(?:data|base64|image_?bytes|imageBytes)(?:"|')?\s*[:=]\s*(?:"|'))([a-z0-9+/=\s]{64,})((?:"|'))/gi,
      `$1${REDACTION}$3`,
    )
    .replace(
      /(^|[^a-z0-9+/])((?:[a-z0-9+/]{4}){24,}(?:[a-z0-9+/]{2}==|[a-z0-9+/]{3}=)?)(?=$|[^a-z0-9+/=])/gi,
      `$1${REDACTION}`,
    )
    .replace(/([?&](?:token|key|api_key|access_token|signature|x-amz-signature|x-goog-signature)=)[^\s"'&]+/gi, "$1[redacted]")
    .replace(/(\bBearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function safeAiMediaErrorMessage(error: unknown, maxLength = 1_000) {
  const message = redactAiMediaSensitiveText(
    error instanceof Error ? error.message : String(error || ""),
    maxLength,
  );
  if (message) return message;
  const name = error instanceof Error ? error.name : "";
  return redactAiMediaSensitiveText(
    name && name !== "Error" ? name : "ai_media_unknown_error",
    maxLength,
  );
}

/** Log only selected diagnostic fields, never provider payloads or stacks. */
export function safeAiMediaErrorDetails(error: unknown) {
  const causes: Array<{ name: string; message: string; code?: string; diagnostics?: AiVideoProviderFailureDiagnostics }> = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current) && causes.length < 4) {
    seen.add(current);
    const record = current instanceof Error
      ? current as Error & { code?: unknown; cause?: unknown; diagnostics?: unknown }
      : null;
    const code = record && (typeof record.code === "string" || typeof record.code === "number")
      ? redactAiMediaSensitiveText(record.code, 120)
      : undefined;
    const diagnostics = safeAiVideoProviderFailureDiagnostics(record?.diagnostics);
    causes.push({
      name: redactAiMediaSensitiveText(record?.name || "UnknownError", 80),
      message: safeAiMediaErrorMessage(current, 600),
      ...(code ? { code } : {}),
      ...(diagnostics ? { diagnostics } : {}),
    });
    current = record?.cause;
  }
  return causes;
}
