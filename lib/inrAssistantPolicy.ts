import type { DashboardEdition } from "./dashboardEdition.ts";

/** This catalogue belongs only to iNr'Assistant; editorial engine preferences stay unchanged. */
export const INR_ASSISTANT_MODELS = {
  luna: "openai/gpt-6-luna",
  qwen: "alibaba/qwen3.7-flash",
  haiku: "anthropic/claude-haiku-5.5",
  sol: "openai/gpt-6.1-sol",
} as const;

export type InrAssistantModel = typeof INR_ASSISTANT_MODELS[keyof typeof INR_ASSISTANT_MODELS];
export type InrAssistantComplexity = "routine" | "complex";
export type InrAssistantModelAttempt = {
  model: InrAssistantModel;
  reasoningEffort?: "low" | "medium" | "high";
};

/** Base USD/token rates, without assuming any cache discount. Inputs must stay below 32K tokens. */
export const INR_ASSISTANT_MODEL_PRICING: Readonly<Record<InrAssistantModel, {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}>> = {
  [INR_ASSISTANT_MODELS.luna]: { inputUsdPerMillion: 0.10, outputUsdPerMillion: 0.50 },
  [INR_ASSISTANT_MODELS.qwen]: { inputUsdPerMillion: 0.03, outputUsdPerMillion: 0.13 },
  [INR_ASSISTANT_MODELS.haiku]: { inputUsdPerMillion: 0.10, outputUsdPerMillion: 0.50 },
  [INR_ASSISTANT_MODELS.sol]: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
};

export function hasInrAssistantPremiumAccess(edition: DashboardEdition): boolean {
  return edition === "premium" || edition === "founder";
}

function normalizedPrompt(prompt: string): string {
  return String(prompt || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Conservative routing from the actual latest user message. Claims such as
 * "complexity: high" or a requested model do not grant access to a costly model.
 * A false negative simply stays on Luna high/Haiku; no business right depends on this heuristic.
 */
export function classifyInrAssistantRequest(prompt: string): InrAssistantComplexity {
  const text = normalizedPrompt(prompt);
  const actionFamilies = [
    /\b(?:gener\w*|cre(?:e|er|ation)\w*|redig\w*|ecri\w*|produi\w*|prepar\w*|generate|create|write)\b/,
    /\b(?:programm\w*|planifi\w*|publie\w*|publier|schedule\w*|publish\w*)\b/,
    /\b(?:analys\w*|compar\w*|evalu\w*|diagnosti\w*|optimis\w*|analyz\w*)\b/,
    /\b(?:connect\w*|configur\w*|relie\w*|raccord\w*|connecter)\b/,
    /\b(?:rempli\w*|complet\w*|modifi\w*|corrig\w*|enrich\w*|update\w*|fill)\b/,
  ];
  const actions = actionFamilies.reduce((count, pattern) => count + Number(pattern.test(text)), 0);
  const constraints = [
    /\b(?:budget|cout|cost|euros?|tarif|plafond)\b|[€$]/,
    /\b(?:avant|apres|demain|semaine|mois|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|timezone|fuseau|before|after|weekly|monthly)\b/,
    /\b(?:canaux|multicanal|plateformes?|facebook|instagram|linkedin|tiktok|youtube|pinterest|channels?)\b/,
    /\b(?:si|sauf|sans|uniquement|minimum|maximum|chaque|except|unless|only|without|at least)\b/,
  ].reduce((count, pattern) => count + Number(pattern.test(text)), 0);
  const strategic = /\b(?:strategie|strategique|scenario|arbitrage|business plan|strategy|strategic|trade.?off)\b/.test(text);
  const comparison = /\b(?:compar\w*|evalu\w*|optimis\w*|analyz\w*|analys\w*)\b/.test(text);

  const channelConnection = /\b(?:connect\w*|configur\w*|relie\w*|raccord\w*)\b/.test(text) &&
    /\b(?:canaux?|channels?|facebook|instagram|linkedin|tiktok|youtube|pinterest|page|profil\w*)\b/.test(text);
  const createsContent = /\b(?:image|video|publications?|posts?|contenus?|calendrier|campagne|content|calendar)\b/.test(text);
  const crossAccountDiagnosis = comparison && (
    /\b(?:plusieurs|deux|differents?|multiple|two)\s+(?:comptes?|etablissements?|accounts?)\b/.test(text) ||
    (/\b(?:permissions?|droits|roles?)\b/.test(text) && /\b(?:conflit\w*|contradic\w*|incompatib\w*|conflict\w*)\b/.test(text))
  );
  // Creating a page, configuring its profile and connecting it is one guided
  // channel setup, even when it takes several chat turns or includes an error.
  if (channelConnection && !createsContent && !crossAccountDiagnosis) return "routine";

  return actions >= 3 || (actions >= 2 && constraints >= 2) ||
    (crossAccountDiagnosis && constraints >= 1) ||
    (comparison && constraints >= 3) ||
    (strategic && actions >= 1 && constraints >= 2)
    ? "complex" : "routine";
}

/** Every primary and fallback is selected here; no generic provider fallback may escape this list. */
export function getInrAssistantModelChain(args: {
  edition: DashboardEdition;
  complexity: InrAssistantComplexity;
  solReserved: boolean;
}): readonly InrAssistantModelAttempt[] {
  const complex = args.complexity === "complex";
  const economical: InrAssistantModelAttempt[] = complex
    ? [
        { model: INR_ASSISTANT_MODELS.luna, reasoningEffort: "high" },
        { model: INR_ASSISTANT_MODELS.haiku },
        { model: INR_ASSISTANT_MODELS.qwen },
      ]
    : [
        { model: INR_ASSISTANT_MODELS.qwen },
        { model: INR_ASSISTANT_MODELS.luna, reasoningEffort: "low" },
        { model: INR_ASSISTANT_MODELS.haiku },
      ];
  return complex && args.solReserved && hasInrAssistantPremiumAccess(args.edition)
    ? [{ model: INR_ASSISTANT_MODELS.sol, reasoningEffort: "medium" }, ...economical]
    : economical;
}

/** Count a possible new Sol request itself in the denominator, never pending cheap requests. */
export function canReserveInrAssistantSol(args: { completedRequests: number; solRequests: number }): boolean {
  const { completedRequests, solRequests } = args;
  if (!Number.isSafeInteger(completedRequests) || !Number.isSafeInteger(solRequests) ||
    completedRequests < 0 || solRequests < 0 || solRequests > completedRequests ||
    completedRequests >= Number.MAX_SAFE_INTEGER / 5) return false;
  return (solRequests + 1) * 5 <= completedRequests + 1;
}
