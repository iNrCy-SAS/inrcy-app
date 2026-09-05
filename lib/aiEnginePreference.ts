export type AiPreferredEngine =
  | "openai"
  | "anthropic"
  | "google"
  | "mistral"
  | "xai"
  | "perplexity"
  | "deepseek"
  | "meta";

export type AiJsonMode = "strict" | "prompt-only";

export type AiEngineOption = {
  value: AiPreferredEngine;
  label: string;
  shortLabel: string;
  description: string;
  naturalTendency: string;
  bestFor: string;
  model: string;
  supportsVision: boolean;
  jsonMode: AiJsonMode;
};

/**
 * Le professionnel choisit un moteur, pas un identifiant de modèle technique.
 * iNrCy garde ainsi la possibilité de faire évoluer le modèle associé à un
 * moteur sans migrer les profils Supabase ni modifier l'interface.
 *
 * Les identifiants ci-dessous sont centralisés pour permettre une évolution
 * du catalogue sans toucher aux profils utilisateurs.
 */
export const AI_ENGINE_OPTIONS: readonly AiEngineOption[] = [
  {
    value: "openai",
    label: "OpenAI — ChatGPT",
    shortLabel: "ChatGPT",
    description: "Polyvalent, rapide et très économique pour les contenus multicanaux.",
    naturalTendency: "Polyvalent, équilibré, clair et efficace.",
    bestFor: "Posts complets, contenus marketing locaux et adaptations multicanaux.",
    model: "openai/gpt-4o-mini",
    supportsVision: true,
    jsonMode: "strict",
  },
  {
    value: "anthropic",
    label: "Anthropic — Claude",
    shortLabel: "Claude",
    description: "Écriture naturelle, nuancée et attentive au style.",
    naturalTendency: "Fluide, humain, nuancé et moins mécanique.",
    bestFor: "LinkedIn, storytelling, textes longs et contenus premium.",
    model: "anthropic/claude-haiku-4.5",
    supportsVision: true,
    jsonMode: "strict",
  },
  {
    value: "google",
    label: "Google — Gemini",
    shortLabel: "Gemini",
    description: "Rapide, multimodal et efficace sur les longs contextes.",
    naturalTendency: "Structuré, contextuel, informatif et organisé.",
    bestFor: "SEO, contenus explicatifs, articles et fiches détaillées.",
    model: "google/gemini-2.5-flash-lite",
    supportsVision: true,
    jsonMode: "strict",
  },
  {
    value: "mistral",
    label: "Mistral AI — Mistral",
    shortLabel: "Mistral",
    description: "Alternative européenne puissante, multilingue et multimodale.",
    naturalTendency: "Direct, naturel en français, efficace et sans détour.",
    bestFor: "Posts courts, messages simples et contenus pros rapides.",
    model: "mistral/mistral-medium-3.5",
    supportsVision: true,
    jsonMode: "strict",
  },
  {
    value: "xai",
    label: "xAI — Grok",
    shortLabel: "Grok",
    description: "Direct, rapide et créatif pour varier les approches éditoriales.",
    naturalTendency: "Plus vivant, punchy, créatif et moins lisse.",
    bestFor: "Réseaux sociaux, accroches fortes et contenus dynamiques.",
    model: "xai/grok-4.1-fast-non-reasoning",
    supportsVision: true,
    jsonMode: "strict",
  },
  {
    value: "perplexity",
    label: "Perplexity — Sonar",
    shortLabel: "Perplexity",
    description: "Recherche web intégrée et contenus ancrés dans des informations récentes.",
    naturalTendency: "Factuel, précis, informatif et orienté synthèse.",
    bestFor: "Contenus pédagogiques, veille, explications et résumés.",
    model: "perplexity/sonar",
    supportsVision: true,
    jsonMode: "prompt-only",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    description: "Très bon rapport coût-performance pour les tâches de génération et d'instruction.",
    naturalTendency: "Logique, argumenté, démonstratif et structuré.",
    bestFor: "Conseils, argumentaires, contenus techniques et démonstrations.",
    model: "deepseek/deepseek-v3.2",
    supportsVision: false,
    jsonMode: "prompt-only",
  },
  {
    value: "meta",
    label: "Meta — Llama",
    shortLabel: "Llama",
    description: "Modèle ouvert, multimodal et performant pour diversifier les contenus.",
    naturalTendency: "Conversationnel, accessible, social et spontané.",
    bestFor: "Facebook, Instagram et contenus communautaires accessibles.",
    model: "meta/llama-4-maverick",
    supportsVision: true,
    jsonMode: "prompt-only",
  },
] as const;

export const DEFAULT_AI_PREFERRED_ENGINE: AiPreferredEngine = "openai";

export const DEFAULT_AI_VISION_FALLBACK_MODEL = "google/gemini-2.5-flash-lite";

export type AiEngineRequestRouting = {
  model: string;
  jsonMode: AiJsonMode;
};


const AI_ENGINE_VALUES = new Set<AiPreferredEngine>(
  AI_ENGINE_OPTIONS.map((option) => option.value),
);

export function normalizeAiPreferredEngine(value: unknown): AiPreferredEngine {
  const raw = String(value ?? "").trim().toLowerCase();
  if (AI_ENGINE_VALUES.has(raw as AiPreferredEngine)) return raw as AiPreferredEngine;

  // Migration douce d'anciennes valeurs, marques ou libellés éventuels.
  if (["chatgpt", "gpt", "open-ai"].includes(raw)) return "openai";
  if (["claude", "anthropic-ai"].includes(raw)) return "anthropic";
  if (["gemini", "google-ai"].includes(raw)) return "google";
  if (["mistral-ai", "mistral ai", "le-chat", "le chat"].includes(raw)) return "mistral";
  if (["grok", "x-ai"].includes(raw)) return "xai";
  if (["sonar", "perplexity-ai"].includes(raw)) return "perplexity";
  if (["deep-seek", "deepseek-ai"].includes(raw)) return "deepseek";
  if (["llama", "meta-ai", "meta ai"].includes(raw)) return "meta";

  return DEFAULT_AI_PREFERRED_ENGINE;
}

export function getAiEngineOption(value: unknown): AiEngineOption {
  const engine = normalizeAiPreferredEngine(value);
  return AI_ENGINE_OPTIONS.find((option) => option.value === engine) || AI_ENGINE_OPTIONS[0];
}

const AI_ENGINE_OUTPUT_TOKEN_LIMITS: Record<AiPreferredEngine, number> = {
  openai: 16_000,
  anthropic: 16_000,
  google: 16_000,
  mistral: 12_000,
  xai: 12_000,
  perplexity: 8_000,
  deepseek: 12_000,
  meta: 8_000,
};

/**
 * Plafond de requête prudent par moteur. Il laisse une large marge à la sortie
 * sans envoyer une valeur supérieure aux capacités des moteurs les plus courts.
 */
export function getAiEngineOutputTokenLimit(value: unknown) {
  return AI_ENGINE_OUTPUT_TOKEN_LIMITS[normalizeAiPreferredEngine(value)];
}

/**
 * Moteur utilisé pour l'unique nouvelle tentative automatique côté client.
 * La préférence enregistrée du professionnel n'est jamais modifiée : cette
 * valeur ne sert qu'à terminer l'action en cours lorsqu'un fournisseur échoue.
 */
export function getAutomaticAiRetryEngine(value: unknown): AiPreferredEngine {
  const primary = normalizeAiPreferredEngine(value);
  return primary === "openai" ? "google" : "openai";
}


export function resolveAiEngineRequestRouting(
  value: unknown,
  hasImages: boolean,
): AiEngineRequestRouting {
  const option = getAiEngineOption(value);

  // Étape 7 : ne jamais remplacer silencieusement l'auteur choisi par le pro.
  // Les moteurs sans vision doivent recevoir une préanalyse factuelle via
  // prepareMediaForSelectedWriter(), puis rédiger eux-mêmes sans image brute.
  if (hasImages && !option.supportsVision) {
    throw new Error(
      `Le moteur ${option.shortLabel} ne prend pas en charge les images brutes. Une préanalyse visuelle neutre est requise avant la rédaction.`,
    );
  }

  return {
    model: option.model,
    jsonMode: option.jsonMode,
  };
}

export function getAiPreferredEngineFromBusiness(
  business: Record<string, unknown> | null | undefined,
): AiPreferredEngine {
  const preferences =
    business?.preferences &&
    typeof business.preferences === "object" &&
    !Array.isArray(business.preferences)
      ? (business.preferences as Record<string, unknown>)
      : null;

  return normalizeAiPreferredEngine(
    preferences?.engine ?? business?.ai_preferred_engine,
  );
}
