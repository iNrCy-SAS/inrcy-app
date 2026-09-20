import "server-only";

type ModelPricing = {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
};

type UsageLike = {
  inputTokens: number;
  outputTokens: number;
};

export type AiGatewayPricingSource = "configured" | "conservative_fallback";

export type AiGatewayPricingResolution = {
  pricing: ModelPricing;
  source: AiGatewayPricingSource;
};

const DEFAULT_FALLBACK_GUARD_PRICING: ModelPricing = {
  // Valeurs volontairement conservatrices servant uniquement au garde-fou interne.
  // Elles ne constituent pas une grille tarifaire fournisseur et ne sont jamais
  // affichées comme un coût facturé au client.
  inputUsdPerMillion: 10,
  outputUsdPerMillion: 30,
};

function finiteNonNegative(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function finitePositive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseConfiguredPricingTable(): Record<string, Record<string, unknown>> | null {
  const raw = String(process.env.AI_GATEWAY_MODEL_PRICING_JSON || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, Record<string, unknown>>
      : null;
  } catch {
    return null;
  }
}

/**
 * Pricing is environment-driven because model/provider prices evolve.
 * Example:
 * AI_GATEWAY_MODEL_PRICING_JSON={"openai/gpt-5.6-luna":{"inputUsdPerMillion":0.2,"outputUsdPerMillion":1.2}}
 */
export function getConfiguredAiGatewayModelPricing(model: string): ModelPricing | null {
  const parsed = parseConfiguredPricingTable();
  const row = parsed?.[model];
  if (!row || typeof row !== "object") return null;
  const inputUsdPerMillion = finiteNonNegative(row.inputUsdPerMillion ?? row.input_per_million_usd);
  const outputUsdPerMillion = finiteNonNegative(row.outputUsdPerMillion ?? row.output_per_million_usd);
  if (inputUsdPerMillion === null || outputUsdPerMillion === null) return null;
  // Deux zéros désactiveraient silencieusement le garde-fou monétaire.
  if (inputUsdPerMillion === 0 && outputUsdPerMillion === 0) return null;
  return { inputUsdPerMillion, outputUsdPerMillion };
}

export function getConservativeAiGatewayFallbackPricing(): ModelPricing {
  return {
    inputUsdPerMillion: finitePositive(
      process.env.AI_GATEWAY_FALLBACK_INPUT_USD_PER_MILLION,
      DEFAULT_FALLBACK_GUARD_PRICING.inputUsdPerMillion,
    ),
    outputUsdPerMillion: finitePositive(
      process.env.AI_GATEWAY_FALLBACK_OUTPUT_USD_PER_MILLION,
      DEFAULT_FALLBACK_GUARD_PRICING.outputUsdPerMillion,
    ),
  };
}

/**
 * Résout toujours un prix de garde-fou. Une configuration absente ou invalide
 * ne désactive donc plus silencieusement la protection monétaire : iNrCy utilise
 * un plafond conservateur configurable jusqu'à correction de l'environnement.
 */
export function resolveAiGatewayGuardPricing(model: string): AiGatewayPricingResolution {
  const configured = getConfiguredAiGatewayModelPricing(model);
  if (configured) return { pricing: configured, source: "configured" };
  return {
    pricing: getConservativeAiGatewayFallbackPricing(),
    source: "conservative_fallback",
  };
}

export function estimateAiGatewayCostMicroUsd(model: string, usage: UsageLike): number {
  const { pricing } = resolveAiGatewayGuardPricing(model);
  const inputTokens = Math.max(0, Math.floor(Number(usage.inputTokens || 0)));
  const outputTokens = Math.max(0, Math.floor(Number(usage.outputTokens || 0)));
  const usd =
    (inputTokens / 1_000_000) * pricing.inputUsdPerMillion +
    (outputTokens / 1_000_000) * pricing.outputUsdPerMillion;
  return Math.max(0, Math.round(usd * 1_000_000));
}

export function estimateInputTokensFromTextChars(chars: number): number {
  // Estimation prudente et indépendante du tokenizer fournisseur.
  return Math.max(1, Math.ceil(Math.max(0, chars) / 3.5));
}

export function estimateInputTokensWithImages(args: {
  textChars: number;
  imageCount?: number;
  imageDetail?: "low" | "high" | "auto";
}): number {
  const textTokens = estimateInputTokensFromTextChars(args.textChars);
  const count = Math.max(0, Math.floor(Number(args.imageCount || 0)));
  // Réservation volontairement conservatrice : le coût exact dépend du moteur.
  const perImage = args.imageDetail === "high" ? 4_000 : 2_500;
  return textTokens + count * perImage;
}
