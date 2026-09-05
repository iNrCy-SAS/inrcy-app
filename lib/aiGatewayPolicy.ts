export type AiGenerationFeature =
  | "booster.publish"
  | "booster.media-understanding"
  | "agent.publish"
  | "agent.media-understanding"
  | "templates.generate"
  | "agent.campaign"
  | "mails.generate"
  | "mails.attachment-image"
  | "mails.attachment-video"
  | "reviews.google"
  | "business-dna.analyze"
  | "agent.stats-report"
  | "booster.transcript-cleanup"
  | "booster.transcribe"
  | "media.image"
  | "media.video";

export type AiFeaturePolicy = {
  maxOutputTokens: number;
  maxRetries: number;
  maxTimeoutMs: number;
  maxInputChars: number;
  maxImages: number;
  maxImageDataChars: number;
  defaultOperationMaxCalls: number;
  defaultOperationMaxReservedOutputTokens: number;
  defaultOperationMaxDurationMs: number;
};

const MB_AS_DATA_URL_CHARS = 1_450_000;

const DEFAULT_ALLOWED_AI_GATEWAY_MODELS = [
  "openai/gpt-4o-mini",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash-lite",
  "mistral/mistral-medium-3.5",
  "xai/grok-4.1-fast-non-reasoning",
  "perplexity/sonar",
  "deepseek/deepseek-v3.2",
  "meta/llama-4-maverick",
] as const;

const DEFAULT_ALLOWED_AI_GATEWAY_TRANSCRIPTION_MODELS = [
  "openai/gpt-4o-transcribe",
  "openai/gpt-4o-mini-transcribe",
  "openai/whisper-1",
] as const;


export const AI_FEATURE_POLICIES: Readonly<Record<AiGenerationFeature, AiFeaturePolicy>> = {
  "booster.publish": {
    maxOutputTokens: 12_000,
    maxRetries: 1,
    maxTimeoutMs: 70_000,
    // Le Prompt Compiler V2 compacte fortement le contexte. 72k reste un dernier
    // garde-fou défensif pour les cas média/transcription atypiques, pas une cible.
    maxInputChars: 72_000,
    maxImages: 5,
    maxImageDataChars: 40 * MB_AS_DATA_URL_CHARS,
    // V2 Étape 3 : un appel principal pour tous les canaux, puis au maximum
    // une réparation ciblée unique. Le nombre de canaux ne multiplie plus les appels.
    defaultOperationMaxCalls: 2,
    defaultOperationMaxReservedOutputTokens: 24_000,
    // 30 s reste la cible UX. Ce budget laisse toutefois une vraie place au
    // basculement fournisseur, afin qu'une première latence ne force jamais le
    // professionnel à cliquer une seconde fois.
    defaultOperationMaxDurationMs: 100_000,
  },
  "agent.media-understanding": {
    maxOutputTokens: 900,
    maxRetries: 0,
    maxTimeoutMs: 32_000,
    maxInputChars: 12_000,
    maxImages: 5,
    maxImageDataChars: 40 * MB_AS_DATA_URL_CHARS,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 900,
    defaultOperationMaxDurationMs: 35_000,
  },
  "booster.media-understanding": {
    maxOutputTokens: 900,
    maxRetries: 0,
    maxTimeoutMs: 32_000,
    maxInputChars: 12_000,
    maxImages: 5,
    maxImageDataChars: 40 * MB_AS_DATA_URL_CHARS,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 900,
    defaultOperationMaxDurationMs: 35_000,
  },
  "agent.publish": {
    maxOutputTokens: 12_000,
    maxRetries: 1,
    maxTimeoutMs: 72_000,
    // iNrAgent réutilise le même Prompt Compiler et le même orchestrateur Booster.
    maxInputChars: 72_000,
    maxImages: 5,
    maxImageDataChars: 40 * MB_AS_DATA_URL_CHARS,
    // iNrAgent réutilise le même orchestrateur 1 appel + 1 réparation max.
    defaultOperationMaxCalls: 2,
    defaultOperationMaxReservedOutputTokens: 24_000,
    defaultOperationMaxDurationMs: 110_000,
  },
  "templates.generate": {
    maxOutputTokens: 3000,
    maxRetries: 1,
    maxTimeoutMs: 50_000,
    maxInputChars: 28_000,
    maxImages: 4,
    maxImageDataChars: 32 * MB_AS_DATA_URL_CHARS,
    defaultOperationMaxCalls: 2,
    defaultOperationMaxReservedOutputTokens: 5500,
    defaultOperationMaxDurationMs: 90_000,
  },
  "agent.campaign": {
    maxOutputTokens: 3000,
    maxRetries: 1,
    maxTimeoutMs: 50_000,
    maxInputChars: 28_000,
    maxImages: 4,
    maxImageDataChars: 32 * MB_AS_DATA_URL_CHARS,
    defaultOperationMaxCalls: 2,
    defaultOperationMaxReservedOutputTokens: 5500,
    defaultOperationMaxDurationMs: 90_000,
  },
  "mails.generate": {
    maxOutputTokens: 2200,
    maxRetries: 1,
    maxTimeoutMs: 50_000,
    maxInputChars: 28_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 2200,
    defaultOperationMaxDurationMs: 60_000,
  },
  "mails.attachment-image": {
    maxOutputTokens: 900,
    maxRetries: 0,
    maxTimeoutMs: 45_000,
    maxInputChars: 10_000,
    maxImages: 1,
    maxImageDataChars: 10 * MB_AS_DATA_URL_CHARS,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 900,
    defaultOperationMaxDurationMs: 50_000,
  },
  "mails.attachment-video": {
    maxOutputTokens: 1000,
    maxRetries: 0,
    maxTimeoutMs: 60_000,
    maxInputChars: 12_000,
    maxImages: 6,
    maxImageDataChars: 24 * MB_AS_DATA_URL_CHARS,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 1000,
    defaultOperationMaxDurationMs: 65_000,
  },
  "reviews.google": {
    maxOutputTokens: 1000,
    maxRetries: 1,
    maxTimeoutMs: 40_000,
    maxInputChars: 16_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 1000,
    defaultOperationMaxDurationMs: 50_000,
  },
  "business-dna.analyze": {
    // Une sortie structurée complète peut contenir les trois blocs Premium.
    // Le plafond garde une vraie marge pour éviter une coupure en fin de JSON ;
    // il ne constitue jamais une taille cible ni une dépense automatique.
    maxOutputTokens: 8_000,
    maxRetries: 1,
    maxTimeoutMs: 72_000,
    maxInputChars: 68_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 8_000,
    defaultOperationMaxDurationMs: 95_000,
  },
  "agent.stats-report": {
    maxOutputTokens: 1800,
    maxRetries: 1,
    maxTimeoutMs: 55_000,
    maxInputChars: 30_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 1800,
    defaultOperationMaxDurationMs: 65_000,
  },
  "booster.transcript-cleanup": {
    maxOutputTokens: 700,
    maxRetries: 0,
    maxTimeoutMs: 30_000,
    maxInputChars: 14_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 700,
    defaultOperationMaxDurationMs: 35_000,
  },
  "booster.transcribe": {
    maxOutputTokens: 128,
    maxRetries: 1,
    maxTimeoutMs: 90_000,
    maxInputChars: 0,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 2,
    defaultOperationMaxReservedOutputTokens: 128,
    defaultOperationMaxDurationMs: 110_000,
  },
  "media.image": {
    maxOutputTokens: 128,
    maxRetries: 0,
    maxTimeoutMs: 300_000,
    maxInputChars: 12_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 128,
    defaultOperationMaxDurationMs: 300_000,
  },
  "media.video": {
    maxOutputTokens: 128,
    maxRetries: 0,
    maxTimeoutMs: 900_000,
    maxInputChars: 12_000,
    maxImages: 0,
    maxImageDataChars: 0,
    defaultOperationMaxCalls: 1,
    defaultOperationMaxReservedOutputTokens: 128,
    defaultOperationMaxDurationMs: 900_000,
  },
};

export function getAiFeaturePolicy(feature: AiGenerationFeature): AiFeaturePolicy {
  return AI_FEATURE_POLICIES[feature];
}

function cleanModelId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getDefaultAllowedAiGatewayModels(extraModels: unknown = ""): Set<string> {
  const models = new Set<string>(DEFAULT_ALLOWED_AI_GATEWAY_MODELS);

  for (const raw of String(extraModels || "").split(/[\s,;]+/)) {
    const model = cleanModelId(raw);
    if (model) models.add(model);
  }

  return models;
}

export function assertAllowedAiGatewayModel(model: string, extraModels: unknown = ""): void {
  if (!getDefaultAllowedAiGatewayModels(extraModels).has(model)) {
    throw new Error(`Modèle IA non autorisé par la politique iNrCy : ${model}`);
  }
}

export function getDefaultAllowedAiGatewayTranscriptionModels(extraModels: unknown = ""): Set<string> {
  const models = new Set<string>(DEFAULT_ALLOWED_AI_GATEWAY_TRANSCRIPTION_MODELS);

  for (const raw of String(extraModels || "").split(/[\s,;]+/)) {
    const model = cleanModelId(raw);
    if (model) models.add(model);
  }

  return models;
}

export function assertAllowedAiGatewayTranscriptionModel(
  model: string,
  extraModels: unknown = "",
): void {
  if (!getDefaultAllowedAiGatewayTranscriptionModels(extraModels).has(model)) {
    throw new Error(`Modèle de transcription non autorisé par la politique iNrCy : ${model}`);
  }
}

export class AiOperationBudgetExceededError extends Error {
  code = "ai_operation_budget_exceeded" as const;

  constructor(message = "La génération IA a atteint sa limite de sécurité. Merci de relancer la génération.") {
    super(message);
    this.name = "AiOperationBudgetExceededError";
  }
}

export class AiOperationDeadlineExceededError extends Error {
  code = "ai_operation_deadline_exceeded" as const;

  constructor(message = "La génération IA a dépassé sa durée de sécurité. Merci de relancer.") {
    super(message);
    this.name = "AiOperationDeadlineExceededError";
  }
}

export type AiOperationBudget = {
  id: string;
  feature: AiGenerationFeature;
  maxCalls: number;
  calls: number;
  maxReservedOutputTokens: number;
  reservedOutputTokens: number;
  startedAt: number;
  maxDurationMs: number;
};

let operationSequence = 0;

export function createAiOperationBudget(
  feature: AiGenerationFeature,
  overrides: Partial<Pick<AiOperationBudget, "maxCalls" | "maxReservedOutputTokens" | "maxDurationMs">> = {},
): AiOperationBudget {
  const policy = getAiFeaturePolicy(feature);
  operationSequence += 1;
  return {
    id: `${feature}:${Date.now().toString(36)}:${operationSequence.toString(36)}`,
    feature,
    maxCalls: Math.max(1, Math.floor(overrides.maxCalls ?? policy.defaultOperationMaxCalls)),
    calls: 0,
    maxReservedOutputTokens: Math.max(
      128,
      Math.floor(overrides.maxReservedOutputTokens ?? policy.defaultOperationMaxReservedOutputTokens),
    ),
    reservedOutputTokens: 0,
    startedAt: Date.now(),
    maxDurationMs: Math.max(5000, Math.floor(overrides.maxDurationMs ?? policy.defaultOperationMaxDurationMs)),
  };
}

export function reserveAiOperationBudget(
  budget: AiOperationBudget | undefined,
  requestedOutputTokens: number,
): void {
  if (!budget) return;

  if (Date.now() - budget.startedAt > budget.maxDurationMs) {
    throw new AiOperationDeadlineExceededError("La génération IA a dépassé sa durée de sécurité. Merci de relancer.");
  }

  const nextCalls = budget.calls + 1;
  if (nextCalls > budget.maxCalls) {
    throw new AiOperationBudgetExceededError("La génération IA a atteint le nombre maximal de reprises de sécurité.");
  }

  const safeRequestedTokens = Math.max(128, Math.floor(requestedOutputTokens || 0));
  const nextReserved = budget.reservedOutputTokens + safeRequestedTokens;
  if (nextReserved > budget.maxReservedOutputTokens) {
    throw new AiOperationBudgetExceededError("La génération IA a atteint son budget maximal de sortie pour cette action.");
  }

  budget.calls = nextCalls;
  budget.reservedOutputTokens = nextReserved;
}
