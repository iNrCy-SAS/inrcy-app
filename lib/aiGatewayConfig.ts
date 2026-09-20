import "server-only";

import { getAiEngineOption } from "@/lib/aiEnginePreference";

const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_GATEWAY_TRANSCRIPTION_URL = "https://ai-gateway.vercel.sh/v4/ai/transcription-model";
const DEFAULT_GATEWAY_MODEL = getAiEngineOption("openai").model;

// Compatibilité de déploiement : les anciennes variables Vercel peuvent rester
// présentes pendant un changement de catalogue. Elles sont migrées vers le
// modèle courant de la même marque avant le contrôle de l'allowlist.
const LEGACY_GATEWAY_MODEL_MIGRATIONS: Readonly<Record<string, string>> = {
  "openai/gpt-4o-mini": getAiEngineOption("openai").model,
  "anthropic/claude-3.5-haiku": getAiEngineOption("anthropic").model,
  "anthropic/claude-haiku-4.5": getAiEngineOption("anthropic").model,
  "google/gemini-2.5-flash-lite": getAiEngineOption("google").model,
  "xai/grok-4.1-fast-non-reasoning": getAiEngineOption("xai").model,
  "perplexity/sonar": getAiEngineOption("perplexity").model,
  "deepseek/deepseek-v3.2": getAiEngineOption("deepseek").model,
};

export function cleanAiGatewayEnv(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getAiGatewayCredential(): string {
  return cleanAiGatewayEnv(process.env.AI_GATEWAY_API_KEY) || cleanAiGatewayEnv(process.env.VERCEL_OIDC_TOKEN);
}

export function normalizeAiGatewayBaseUrl(value: unknown): string {
  const raw = (cleanAiGatewayEnv(value) || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, "");

  // AI_GATEWAY_BASE_URL doit rester une base. Une ancienne configuration peut
  // toutefois contenir l'endpoint complet. On le corrige ici pour ne jamais
  // fabriquer /chat/completions/responses ou /responses/responses.
  return raw
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "")
    .replace(/\/+$/, "");
}

export function getAiGatewayTranscriptionUrl(): string {
  return (
    cleanAiGatewayEnv(process.env.AI_GATEWAY_TRANSCRIPTION_URL) ||
    DEFAULT_GATEWAY_TRANSCRIPTION_URL
  ).replace(/\/+$/, "");
}

/**
 * AI Gateway attend des identifiants provider/model. Les anciens noms sans
 * préfixe restent tolérés pour les variables d'environnement historiques.
 */
export function normalizeGatewayModelId(value: unknown, defaultProvider = "openai"): string {
  const raw = cleanAiGatewayEnv(value);
  if (!raw) return DEFAULT_GATEWAY_MODEL;
  const normalized = raw.includes("/") ? raw : `${defaultProvider}/${raw}`;
  return LEGACY_GATEWAY_MODEL_MIGRATIONS[normalized.toLowerCase()] || normalized;
}
