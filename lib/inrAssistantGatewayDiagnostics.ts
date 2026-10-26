import { INR_ASSISTANT_MODELS } from "./inrAssistantPolicy.ts";

/** Private server diagnostics. No conversation, credential or raw provider error belongs here. */
export const INR_ASSISTANT_DIAGNOSTIC_PHASES = [
  "credential_missing", "redis_reserve", "redis_commit", "provider_completed", "provider_timeout", "provider_error",
  "output_limit", "empty_output", "input_limit", "deadline", "call_limit", "request_aborted", "unavailable",
  "quota_finalize_started", "quota_finalize_completed",
] as const;
export type InrAssistantDiagnosticPhase = typeof INR_ASSISTANT_DIAGNOSTIC_PHASES[number];
export type InrAssistantGatewayDiagnostic = {
  requestId: string;
  phase: InrAssistantDiagnosticPhase;
  model?: string;
  elapsedMs?: number;
  durationMs?: number;
  statusCode?: number;
  finishReason?: string;
  hasText?: boolean;
  inputBytes?: number;
  historyTurns?: number;
  callCount?: number;
};

const phases = new Set<string>(INR_ASSISTANT_DIAGNOSTIC_PHASES);
const models = new Set<string>(Object.values(INR_ASSISTANT_MODELS));
const reasons = new Set(["stop", "length", "tool-calls", "content-filter", "error", "other", "unknown"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Only fixed, typed metadata is copied; unknown keys and unexpected values are discarded. */
export function projectInrAssistantGatewayDiagnostic(value: unknown): InrAssistantGatewayDiagnostic | null {
  try {
    const input = object(value);
    if (typeof input.requestId !== "string" || !uuid.test(input.requestId) || typeof input.phase !== "string" || !phases.has(input.phase)) return null;
    const output: InrAssistantGatewayDiagnostic = { requestId: input.requestId.toLowerCase(), phase: input.phase as InrAssistantDiagnosticPhase };
    if (typeof input.model === "string" && models.has(input.model)) output.model = input.model;
    if (typeof input.finishReason === "string" && reasons.has(input.finishReason)) output.finishReason = input.finishReason;
    if (typeof input.hasText === "boolean") output.hasText = input.hasText;
    for (const [key, maximum] of [["elapsedMs", 3_600_000], ["durationMs", 3_600_000], ["inputBytes", 1_000_000], ["historyTurns", 12], ["callCount", 4]] as const) {
      if (typeof input[key] === "number" && Number.isFinite(input[key]) && input[key] >= 0) output[key] = Math.min(maximum, Math.floor(input[key]));
    }
    if (typeof input.statusCode === "number" && Number.isInteger(input.statusCode) && input.statusCode >= 100 && input.statusCode <= 599) output.statusCode = input.statusCode;
    return output;
  } catch { return null; }
}

/** This direct bounded log does not depend on an optional SDK telemetry collector. */
export function recordInrAssistantGatewayDiagnostic(value: unknown): InrAssistantGatewayDiagnostic | undefined {
  const diagnostic = projectInrAssistantGatewayDiagnostic(value);
  if (!diagnostic) return undefined;
  try { console.info("[assistant.gateway]", diagnostic); } catch { /* Diagnostics must not change business execution. */ }
  return diagnostic;
}

/** Inspect only machine names/codes, never exception.message, URLs or response bodies. */
export function classifyInrAssistantGatewayFailure(error: unknown, requestAborted = false): "request_aborted" | "provider_timeout" | "provider_error" {
  if (requestAborted) return "request_aborted";
  try {
    const input = object(error), cause = object(input.cause);
    const names = [input.name, cause.name];
    const codes = [input.code, cause.code];
    if (names.some(name => name === "TimeoutError" || name === "AbortError") || codes.some(code => typeof code === "string" && ["ETIMEDOUT", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"].includes(code))) return "provider_timeout";
  } catch { /* Opaque provider errors stay generic rather than changing the original exception. */ }
  return "provider_error";
}
