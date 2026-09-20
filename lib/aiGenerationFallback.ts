import "server-only";

import {
  getAiEngineOption,
  type AiJsonMode,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import {
  cleanAiGatewayEnv,
  normalizeGatewayModelId,
} from "@/lib/aiGatewayConfig";

export type AiGenerationTransport = "vercel_ai_gateway" | "openai_direct";
export type AiGenerationFallbackStage = "gateway_model" | "openai_direct";
export type AiGenerationFallbackReason =
  | "gateway_credentials_missing"
  | "gateway_auth"
  | "rate_limit"
  | "provider_unavailable"
  | "provider_incompatible"
  | "transport_error"
  | "empty_output"
  | "invalid_output";

export type AiGenerationFallbackInfo = {
  used: true;
  stage: AiGenerationFallbackStage;
  reason: AiGenerationFallbackReason;
  primaryEngine?: AiPreferredEngine;
  primaryEngineLabel: string;
  primaryModel: string;
  finalEngine: AiPreferredEngine;
  finalEngineLabel: string;
  finalModel: string;
  transport: AiGenerationTransport;
};

export type AiGatewayFallbackRouting = {
  engine: AiPreferredEngine;
  model: string;
  jsonMode: AiJsonMode;
};

const AI_FALLBACK_METADATA = Symbol.for("inrcy.ai-generation-fallback");
const DEFAULT_OPENAI_DIRECT_MODEL = getAiEngineOption("openai").model.replace(
  /^openai\//,
  "",
);

function fallbackEngineForPrimary(primaryModel: string): AiPreferredEngine {
  return normalizeGatewayModelId(primaryModel).startsWith("openai/")
    ? "google"
    : "openai";
}

export function resolveGatewayFallbackRouting(
  primaryModel: string,
): AiGatewayFallbackRouting | null {
  const fallbackEngine = fallbackEngineForPrimary(primaryModel);
  const defaultOption = getAiEngineOption(fallbackEngine);
  const configured = cleanAiGatewayEnv(
    fallbackEngine === "google"
      ? process.env.AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL
      : process.env.AI_GATEWAY_FALLBACK_MODEL,
  );
  const expectedProviderPrefix = fallbackEngine === "google" ? "google/" : "openai/";
  const configuredModel = normalizeGatewayModelId(configured);
  const model = configuredModel.startsWith(expectedProviderPrefix)
    ? configuredModel
    : normalizeGatewayModelId(defaultOption.model);

  if (!model || model === normalizeGatewayModelId(primaryModel)) return null;

  // Un override est accepté uniquement s'il reste chez le fournisseur de secours
  // attendu. Cela évite une variable mal saisie qui annoncerait « ChatGPT » tout
  // en appelant en réalité un autre fournisseur.
  return {
    engine: fallbackEngine,
    model,
    jsonMode: defaultOption.jsonMode,
  };
}

export function getOpenAiDirectFallbackCredential(): string {
  return cleanAiGatewayEnv(process.env.OPENAI_API_KEY);
}

export function getOpenAiDirectFallbackModel(): string {
  const configured = cleanAiGatewayEnv(process.env.OPENAI_DIRECT_FALLBACK_MODEL);
  const normalized = normalizeGatewayModelId(
    configured || DEFAULT_OPENAI_DIRECT_MODEL,
  );
  const model = normalized.startsWith("openai/")
    ? normalized.slice("openai/".length)
    : DEFAULT_OPENAI_DIRECT_MODEL;
  // Défense simple contre une URL ou une valeur inattendue injectée par erreur.
  return /^[a-zA-Z0-9._:-]+$/.test(model)
    ? model
    : DEFAULT_OPENAI_DIRECT_MODEL;
}

export function getOpenAiDirectAccountingModel(): string {
  return `openai/${getOpenAiDirectFallbackModel()}`;
}

const PROVIDER_CAPABILITY_ERROR_PATTERNS = [
  /\bunsupported (?:parameter|field|option|feature|response[_ ]?format|structured output|json schema|tool(?:s| calling)?)\b/i,
  /\b(?:json schema|response[_ ]?format|structured output|tool(?:s| calling)?).{0,100}\b(?:not supported|unsupported|unavailable)\b/i,
  /\bmodel.{0,100}\b(?:does not support|is not supported|unsupported|unavailable|not available)\b/i,
  /\b(?:no available endpoints?|no endpoints? found|provider unavailable|provider is unavailable)\b/i,
  /\b(?:context length|maximum context length|max context length|too many (?:input )?tokens|input is too long).{0,100}\b(?:exceed(?:ed|s)?|too long|limit)\b/i,
];

export function isProviderCapabilityError(status: number, message: string): boolean {
  if (![400, 409, 422].includes(status)) return false;
  const normalized = String(message || "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  return PROVIDER_CAPABILITY_ERROR_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function getFallbackReason(error: unknown): {
  eligible: boolean;
  skipGatewayModelFallback: boolean;
  reason: AiGenerationFallbackReason;
} {
  const record = error && typeof error === "object"
    ? (error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown })
    : null;
  const code = String(record?.code || "");
  const status = Number(record?.status || 0);
  const name = String(record?.name || "");
  const message = String(record?.message || error || "");

  if ([
    "ai_operation_budget_exceeded",
    "ai_operation_deadline_exceeded",
    "ai_gateway_account_limit_reached",
    "ai_gateway_guard_unavailable",
  ].includes(code)) {
    return { eligible: false, skipGatewayModelFallback: false, reason: "transport_error" };
  }

  if (code === "ai_gateway_auth" || status === 401 || status === 403) {
    return { eligible: true, skipGatewayModelFallback: true, reason: "gateway_auth" };
  }

  if (code === "ai_gateway_rate_limit" || status === 429) {
    return { eligible: true, skipGatewayModelFallback: false, reason: "rate_limit" };
  }

  if (isProviderCapabilityError(status, message)) {
    return { eligible: true, skipGatewayModelFallback: false, reason: "provider_incompatible" };
  }

  if (
    code === "ai_gateway_unavailable" ||
    [404, 408, 500, 502, 503, 504].includes(status)
  ) {
    return { eligible: true, skipGatewayModelFallback: false, reason: "provider_unavailable" };
  }

  if (/contenu de sortie manquant|empty output/i.test(message)) {
    return { eligible: true, skipGatewayModelFallback: false, reason: "empty_output" };
  }

  if (/génération n['’]a pas pu être finalisée|invalid structured output|json/i.test(message)) {
    return { eligible: true, skipGatewayModelFallback: false, reason: "invalid_output" };
  }

  if (
    name === "AbortError" ||
    /fetch failed|network error|econnreset|econnrefused|enotfound|socket hang up|timed out|timeout|aborted/i.test(message)
  ) {
    return { eligible: true, skipGatewayModelFallback: false, reason: "transport_error" };
  }

  return { eligible: false, skipGatewayModelFallback: false, reason: "transport_error" };
}

export function attachAiGenerationFallbackInfo<T extends Record<string, unknown>>(
  value: T,
  info: AiGenerationFallbackInfo | undefined,
): T {
  if (!info || !value || typeof value !== "object") return value;
  Object.defineProperty(value, AI_FALLBACK_METADATA, {
    value: info,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return value;
}

export function getAiGenerationFallbackInfo(
  value: unknown,
): AiGenerationFallbackInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<PropertyKey, unknown>)[AI_FALLBACK_METADATA] as
    | AiGenerationFallbackInfo
    | undefined;
}

export function buildAiGenerationFallbackInfo(args: {
  stage: AiGenerationFallbackStage;
  reason: AiGenerationFallbackReason;
  primaryEngine?: AiPreferredEngine;
  primaryModel: string;
  finalEngine: AiPreferredEngine;
  finalModel: string;
  transport: AiGenerationTransport;
}): AiGenerationFallbackInfo {
  const primaryOption = args.primaryEngine
    ? getAiEngineOption(args.primaryEngine)
    : null;
  const finalOption = getAiEngineOption(args.finalEngine);

  return {
    used: true,
    stage: args.stage,
    reason: args.reason,
    primaryEngine: args.primaryEngine,
    primaryEngineLabel: primaryOption?.shortLabel || "Le moteur sélectionné",
    primaryModel: args.primaryModel,
    finalEngine: args.finalEngine,
    finalEngineLabel: finalOption.shortLabel,
    finalModel: args.finalModel,
    transport: args.transport,
  };
}
