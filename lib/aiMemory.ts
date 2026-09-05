import {
  EMPTY_BUSINESS_DNA_RICH_TEXT,
  normalizeBusinessDnaPlainText,
  normalizeBusinessDnaRichText,
  type BusinessDnaRichText,
} from "./businessDnaRichText.ts";
import {
  EMPTY_BUSINESS_WEEKLY_SCHEDULE,
  hasBusinessWeeklySchedule,
  mergeBusinessWeeklySchedules,
  normalizeBusinessWeeklySchedule,
  type BusinessWeeklySchedule,
} from "./businessWeeklySchedule.ts";
import { fitPromptPayloadToJsonBudget } from "./aiPromptBudget.ts";

export const AI_MEMORY_SCHEMA_VERSION = 1 as const;

export type AiMemory = {
  schemaVersion: typeof AI_MEMORY_SCHEMA_VERSION;
  detailedDescription: string;
  mission: string;
  specialties: string[];
  targetAudiences: string[];
  customerNeeds: string[];
  differentiators: string[];
  values: string[];
  brandPersonality: string[];
  commitments: string[];
  preferredVocabulary: string[];
  forbiddenVocabulary: string[];
  offersAndArguments: string;
  proofsAndObjections: string;
  editorialStrategy: string;
  richText: BusinessDnaRichText;
};

/** Données métier historiques désormais éditées dans l'espace ADN. */
export type AiBusinessKnowledge = {
  description: string;
  services: string[];
  interventionZones: string[];
  weeklySchedule: BusinessWeeklySchedule;
  strengths: string[];
  customerTypes: string[];
};

export type AiBusinessDnaAnalysis = {
  memory: AiMemory;
  businessKnowledge: AiBusinessKnowledge;
};

export type AiBusinessDnaMergeResult = AiBusinessDnaAnalysis & {
  changedFields: string[];
  addedItems: number;
};

export const EMPTY_AI_MEMORY: AiMemory = {
  schemaVersion: AI_MEMORY_SCHEMA_VERSION,
  detailedDescription: "",
  mission: "",
  specialties: [],
  targetAudiences: [],
  customerNeeds: [],
  differentiators: [],
  values: [],
  brandPersonality: [],
  commitments: [],
  preferredVocabulary: [],
  forbiddenVocabulary: [],
  offersAndArguments: "",
  proofsAndObjections: "",
  editorialStrategy: "",
  richText: EMPTY_BUSINESS_DNA_RICH_TEXT,
};

export const EMPTY_AI_BUSINESS_KNOWLEDGE: AiBusinessKnowledge = {
  description: "",
  services: [],
  interventionZones: [],
  weeklySchedule: EMPTY_BUSINESS_WEEKLY_SCHEDULE,
  strengths: [],
  customerTypes: [],
};

export const AI_MEMORY_PREMIUM_FIELDS = [
  "offersAndArguments",
  "proofsAndObjections",
  "editorialStrategy",
] as const satisfies readonly (keyof AiMemory)[];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function cleanList(value: unknown, maxItems = 16, maxItemLength = 140) {
  const input = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of input) {
    const cleaned = cleanText(item, maxItemLength).replace(/\s+/g, " ");
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function normalizeAiMemory(
  value: unknown,
  options: { includePremium?: boolean } = {},
): AiMemory {
  const source = asRecord(value);
  const includePremium = options.includePremium !== false;
  const rawDetailedDescription = cleanText(
    source.detailedDescription ?? source.detailed_description,
    5_000,
  );
  const rawOffersAndArguments = includePremium
    ? cleanText(source.offersAndArguments ?? source.offers_and_arguments, 5_000)
    : "";
  const rawProofsAndObjections = includePremium
    ? cleanText(source.proofsAndObjections ?? source.proofs_and_objections, 5_000)
    : "";
  const rawEditorialStrategy = includePremium
    ? cleanText(source.editorialStrategy ?? source.editorial_strategy, 5_000)
    : "";
  const richText = normalizeBusinessDnaRichText(source.richText ?? source.rich_text, {
    detailedDescription: rawDetailedDescription,
    offersAndArguments: rawOffersAndArguments,
    proofsAndObjections: rawProofsAndObjections,
    editorialStrategy: rawEditorialStrategy,
  });

  return {
    schemaVersion: AI_MEMORY_SCHEMA_VERSION,
    detailedDescription: normalizeBusinessDnaPlainText(rawDetailedDescription, 5_000),
    mission: cleanText(source.mission ?? source.purpose ?? source.raison_d_etre, 800),
    specialties: cleanList(source.specialties),
    targetAudiences: cleanList(source.targetAudiences ?? source.target_audiences),
    customerNeeds: cleanList(source.customerNeeds ?? source.customer_needs),
    differentiators: cleanList(source.differentiators),
    values: cleanList(source.values),
    brandPersonality: cleanList(
      source.brandPersonality ?? source.brand_personality ?? source.personality,
      12,
      100,
    ),
    commitments: cleanList(source.commitments ?? source.engagements, 12, 140),
    preferredVocabulary: cleanList(source.preferredVocabulary ?? source.preferred_vocabulary),
    forbiddenVocabulary: cleanList(source.forbiddenVocabulary ?? source.forbidden_vocabulary),
    offersAndArguments: normalizeBusinessDnaPlainText(rawOffersAndArguments, 5_000),
    proofsAndObjections: normalizeBusinessDnaPlainText(rawProofsAndObjections, 5_000),
    editorialStrategy: normalizeBusinessDnaPlainText(rawEditorialStrategy, 5_000),
    richText: includePremium
      ? richText
      : {
          ...richText,
          offersAndArguments: "",
          proofsAndObjections: "",
          editorialStrategy: "",
        },
  };
}

export function normalizeAiBusinessKnowledge(value: unknown): AiBusinessKnowledge {
  const source = asRecord(value);
  return {
    description: normalizeBusinessDnaPlainText(
      source.description ?? source.businessDescription ?? source.business_description,
      5_000,
    ),
    services: cleanList(source.services, 20, 140),
    interventionZones: cleanList(
      source.interventionZones ?? source.intervention_zones,
      30,
      140,
    ),
    weeklySchedule: normalizeBusinessWeeklySchedule(
      source.weeklySchedule ?? source.weekly_schedule,
    ),
    strengths: cleanList(source.strengths, 16, 140),
    customerTypes: cleanList(
      source.customerTypes ?? source.customer_types ?? source.customer_typologies,
      12,
      100,
    ),
  };
}

function firstOwnValue(
  source: Record<string, unknown>,
  keys: readonly string[],
): { found: boolean; value: unknown } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return { found: true, value: source[key] };
    }
  }
  return { found: false, value: undefined };
}

/**
 * Applique une sauvegarde partielle sur la mémoire existante. Les champs omis
 * restent intacts, tandis qu'une chaîne vide ou un tableau vide explicitement
 * envoyé continue de représenter une suppression volontaire.
 */
export function mergeAiMemoryUpdate(
  currentValue: unknown,
  updateValue: unknown,
  options: { includePremium?: boolean } = {},
): AiMemory {
  const current = normalizeAiMemory(currentValue, { includePremium: true });
  const update = asRecord(updateValue);
  const merged: Record<string, unknown> = { ...current };
  const fields: Array<[keyof AiMemory, readonly string[]]> = [
    ["detailedDescription", ["detailedDescription", "detailed_description"]],
    ["mission", ["mission", "purpose", "raison_d_etre"]],
    ["specialties", ["specialties"]],
    ["targetAudiences", ["targetAudiences", "target_audiences"]],
    ["customerNeeds", ["customerNeeds", "customer_needs"]],
    ["differentiators", ["differentiators"]],
    ["values", ["values"]],
    ["brandPersonality", ["brandPersonality", "brand_personality", "personality"]],
    ["commitments", ["commitments", "engagements"]],
    ["preferredVocabulary", ["preferredVocabulary", "preferred_vocabulary"]],
    ["forbiddenVocabulary", ["forbiddenVocabulary", "forbidden_vocabulary"]],
    ["offersAndArguments", ["offersAndArguments", "offers_and_arguments"]],
    ["proofsAndObjections", ["proofsAndObjections", "proofs_and_objections"]],
    ["editorialStrategy", ["editorialStrategy", "editorial_strategy"]],
  ];

  const changedPlainRichFields = new Set<keyof BusinessDnaRichText>();
  for (const [canonicalKey, aliases] of fields) {
    const next = firstOwnValue(update, aliases);
    if (!next.found) continue;
    merged[canonicalKey] = next.value;
    if (
      canonicalKey === "detailedDescription" ||
      canonicalKey === "offersAndArguments" ||
      canonicalKey === "proofsAndObjections" ||
      canonicalKey === "editorialStrategy"
    ) {
      changedPlainRichFields.add(canonicalKey);
    }
  }

  const rawRichText = firstOwnValue(update, ["richText", "rich_text"]);
  const richTextUpdate = asRecord(rawRichText.value);
  const mergedRichText: Record<string, unknown> = { ...current.richText };
  for (const key of [
    "detailedDescription",
    "offersAndArguments",
    "proofsAndObjections",
    "editorialStrategy",
  ] as const) {
    const richField = firstOwnValue(richTextUpdate, [
      key,
      key.replace(/[A-Z]/g, (letter) => `_${letter.toLocaleLowerCase()}`),
    ]);
    if (rawRichText.found && richField.found) mergedRichText[key] = richField.value;
    else if (changedPlainRichFields.has(key)) mergedRichText[key] = "";
  }
  merged.richText = mergedRichText;

  return normalizeAiMemory(merged, options);
}

/** Même garantie de non-écrasement pour les informations métier de l'ADN. */
export function mergeAiBusinessKnowledgeUpdate(
  currentValue: unknown,
  updateValue: unknown,
): AiBusinessKnowledge {
  const current = normalizeAiBusinessKnowledge(currentValue);
  const update = asRecord(updateValue);
  const merged: Record<string, unknown> = { ...current };
  const fields: Array<[keyof AiBusinessKnowledge, readonly string[]]> = [
    ["description", ["description", "businessDescription", "business_description"]],
    ["services", ["services"]],
    ["interventionZones", ["interventionZones", "intervention_zones"]],
    ["strengths", ["strengths"]],
    ["customerTypes", ["customerTypes", "customer_types", "customer_typologies"]],
  ];
  for (const [canonicalKey, aliases] of fields) {
    const next = firstOwnValue(update, aliases);
    if (next.found) merged[canonicalKey] = next.value;
  }

  const scheduleUpdate = firstOwnValue(update, ["weeklySchedule", "weekly_schedule"]);
  if (scheduleUpdate.found) {
    const rawSchedule = asRecord(scheduleUpdate.value);
    if (Object.keys(rawSchedule).length) {
      const rawDays = asRecord(rawSchedule.days);
      merged.weeklySchedule = {
        ...current.weeklySchedule,
        ...rawSchedule,
        days: {
          ...current.weeklySchedule.days,
          ...rawDays,
        },
      };
    } else {
      merged.weeklySchedule = scheduleUpdate.value;
    }
  }

  return normalizeAiBusinessKnowledge(merged);
}

export function mergeAiMemoryPremiumFields(
  core: AiMemory,
  premiumSource: unknown,
): AiMemory {
  const premium = normalizeAiMemory(premiumSource);
  return {
    ...core,
    offersAndArguments: premium.offersAndArguments,
    proofsAndObjections: premium.proofsAndObjections,
    editorialStrategy: premium.editorialStrategy,
    richText: {
      ...core.richText,
      offersAndArguments: premium.richText.offersAndArguments,
      proofsAndObjections: premium.richText.proofsAndObjections,
      editorialStrategy: premium.richText.editorialStrategy,
    },
  };
}

function mergeLists(current: string[], suggested: string[], maxItems: number, maxItemLength: number) {
  return cleanList([...current, ...suggested], maxItems, maxItemLength);
}

/**
 * Applique une analyse de canaux comme un enrichissement non destructif.
 *
 * - les listes sont complétées sans doublon ;
 * - un texte déjà validé n'est jamais remplacé silencieusement ;
 * - les blocs Premium ne sont appliqués que si l'édition les autorise ;
 * - description et forces restent synchronisées avec les colonnes historiques.
 */
export function mergeAiBusinessDnaAnalysis(
  currentMemory: unknown,
  currentBusinessKnowledge: unknown,
  suggestedMemory: unknown,
  suggestedBusinessKnowledge: unknown,
  options: { includePremium?: boolean } = {},
): AiBusinessDnaMergeResult {
  const includePremium = options.includePremium !== false;
  const current = normalizeAiMemory(currentMemory, { includePremium: true });
  const currentBusiness = normalizeAiBusinessKnowledge(currentBusinessKnowledge);
  const suggested = normalizeAiMemory(suggestedMemory, { includePremium });
  const suggestedBusiness = normalizeAiBusinessKnowledge(suggestedBusinessKnowledge);

  const businessKnowledge = normalizeAiBusinessKnowledge({
    description: currentBusiness.description || suggestedBusiness.description || suggested.detailedDescription,
    services: mergeLists(currentBusiness.services, suggestedBusiness.services, 20, 140),
    interventionZones: mergeLists(currentBusiness.interventionZones, suggestedBusiness.interventionZones, 30, 140),
    weeklySchedule: mergeBusinessWeeklySchedules(
      currentBusiness.weeklySchedule,
      suggestedBusiness.weeklySchedule,
    ),
    strengths: mergeLists(
      currentBusiness.strengths,
      [...suggestedBusiness.strengths, ...suggested.differentiators],
      16,
      140,
    ),
    customerTypes: mergeLists(currentBusiness.customerTypes, suggestedBusiness.customerTypes, 12, 100),
  });

  const memory = normalizeAiMemory({
    ...current,
    detailedDescription: businessKnowledge.description,
    mission: current.mission || suggested.mission,
    specialties: mergeLists(current.specialties, suggested.specialties, 16, 140),
    targetAudiences: mergeLists(current.targetAudiences, suggested.targetAudiences, 16, 140),
    customerNeeds: mergeLists(current.customerNeeds, suggested.customerNeeds, 16, 140),
    differentiators: businessKnowledge.strengths,
    values: mergeLists(current.values, suggested.values, 16, 140),
    brandPersonality: mergeLists(current.brandPersonality, suggested.brandPersonality, 12, 100),
    commitments: mergeLists(current.commitments, suggested.commitments, 12, 140),
    preferredVocabulary: mergeLists(current.preferredVocabulary, suggested.preferredVocabulary, 16, 140),
    forbiddenVocabulary: mergeLists(current.forbiddenVocabulary, suggested.forbiddenVocabulary, 16, 140),
    offersAndArguments: includePremium
      ? current.offersAndArguments || suggested.offersAndArguments
      : current.offersAndArguments,
    proofsAndObjections: includePremium
      ? current.proofsAndObjections || suggested.proofsAndObjections
      : current.proofsAndObjections,
    editorialStrategy: includePremium
      ? current.editorialStrategy || suggested.editorialStrategy
      : current.editorialStrategy,
  });

  const changedFields: string[] = [];
  let addedItems = 0;
  const compareText = (key: string, before: string, after: string) => {
    if (before !== after) changedFields.push(key);
  };
  const compareList = (key: string, before: string[], after: string[]) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    changedFields.push(key);
    addedItems += Math.max(0, after.length - before.length);
  };

  compareText("description", currentBusiness.description, businessKnowledge.description);
  compareText("mission", current.mission, memory.mission);
  compareList("services", currentBusiness.services, businessKnowledge.services);
  compareList("interventionZones", currentBusiness.interventionZones, businessKnowledge.interventionZones);
  if (JSON.stringify(currentBusiness.weeklySchedule) !== JSON.stringify(businessKnowledge.weeklySchedule)) {
    changedFields.push("weeklySchedule");
  }
  compareList("strengths", currentBusiness.strengths, businessKnowledge.strengths);
  compareList("customerTypes", currentBusiness.customerTypes, businessKnowledge.customerTypes);
  compareList("specialties", current.specialties, memory.specialties);
  compareList("targetAudiences", current.targetAudiences, memory.targetAudiences);
  compareList("customerNeeds", current.customerNeeds, memory.customerNeeds);
  compareList("values", current.values, memory.values);
  compareList("brandPersonality", current.brandPersonality, memory.brandPersonality);
  compareList("commitments", current.commitments, memory.commitments);
  compareList("preferredVocabulary", current.preferredVocabulary, memory.preferredVocabulary);
  compareList("forbiddenVocabulary", current.forbiddenVocabulary, memory.forbiddenVocabulary);
  compareText("offersAndArguments", current.offersAndArguments, memory.offersAndArguments);
  compareText("proofsAndObjections", current.proofsAndObjections, memory.proofsAndObjections);
  compareText("editorialStrategy", current.editorialStrategy, memory.editorialStrategy);

  return { memory, businessKnowledge, changedFields, addedItems };
}

export function getAiMemoryCompletionScore(
  memory: unknown,
  options: { includePremium?: boolean } = {},
) {
  const normalized = normalizeAiMemory(memory, options);
  const coreChecks = [
    normalized.detailedDescription.length >= 80,
    normalized.mission.length >= 30,
    normalized.specialties.length >= 2,
    normalized.targetAudiences.length >= 1,
    normalized.customerNeeds.length >= 1,
    normalized.differentiators.length >= 1,
    normalized.values.length >= 1,
    normalized.brandPersonality.length >= 1,
    normalized.commitments.length >= 1,
    normalized.preferredVocabulary.length >= 1,
    normalized.forbiddenVocabulary.length >= 1,
  ];
  const premiumChecks = options.includePremium === false
    ? []
    : [
        normalized.offersAndArguments.length >= 40,
        normalized.proofsAndObjections.length >= 40,
        normalized.editorialStrategy.length >= 40,
      ];
  const checks = [...coreChecks, ...premiumChecks];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function getAiWorkspaceCompletionScore(
  memory: unknown,
  businessKnowledge: unknown,
  options: { includePremium?: boolean } = {},
) {
  const normalized = normalizeAiMemory(memory, options);
  const business = normalizeAiBusinessKnowledge(businessKnowledge);
  const coreChecks = [
    business.description.length >= 80 || normalized.detailedDescription.length >= 80,
    normalized.mission.length >= 30,
    business.services.length >= 1,
    business.interventionZones.length >= 1,
    hasBusinessWeeklySchedule(business.weeklySchedule),
    business.strengths.length >= 1 || normalized.differentiators.length >= 1,
    business.customerTypes.length >= 1,
    normalized.specialties.length >= 2,
    normalized.targetAudiences.length >= 1,
    normalized.customerNeeds.length >= 1,
    normalized.values.length >= 1,
    normalized.brandPersonality.length >= 1,
    normalized.commitments.length >= 1,
    normalized.preferredVocabulary.length >= 1,
    normalized.forbiddenVocabulary.length >= 1,
  ];
  const premiumChecks = options.includePremium === false
    ? []
    : [
        normalized.offersAndArguments.length >= 40,
        normalized.proofsAndObjections.length >= 40,
        normalized.editorialStrategy.length >= 40,
      ];
  const checks = [...coreChecks, ...premiumChecks];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function hasAiMemoryContent(memory: unknown) {
  const normalized = normalizeAiMemory(memory);
  return Object.entries(normalized).some(([key, value]) => {
    if (key === "schemaVersion" || key === "richText") return false;
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

export const AI_MEMORY_PROMPT_PAYLOAD_MAX_CHARS = 9_000;

/**
 * Payload compact et factuel injecté dans les prompts de génération.
 * Le plafond porte sur le JSON sérialisé, échappements compris : remplir tous
 * les champs ADN ne peut donc jamais faire rejeter une génération par la
 * politique d'entrée avant même l'appel au moteur.
 */
export function buildAiMemoryPromptPayload(
  memory: unknown,
  maxChars = AI_MEMORY_PROMPT_PAYLOAD_MAX_CHARS,
) {
  const value = normalizeAiMemory(memory);
  const entries: Record<string, string | string[]> = {
    presentation_detaillee: cleanText(value.detailedDescription, 3_200),
    mission_raison_d_etre: cleanText(value.mission, 800),
    specialites: cleanList(value.specialties, 12, 110),
    clienteles_cibles: cleanList(value.targetAudiences, 12, 110),
    besoins_clients: cleanList(value.customerNeeds, 12, 110),
    differences: cleanList(value.differentiators, 10, 110),
    valeurs: cleanList(value.values, 10, 100),
    personnalite_de_marque: cleanList(value.brandPersonality, 10, 100),
    engagements: cleanList(value.commitments, 10, 120),
    vocabulaire_a_privilegier: cleanList(value.preferredVocabulary, 12, 100),
    vocabulaire_interdit: cleanList(value.forbiddenVocabulary, 12, 100),
    offres_et_arguments: cleanText(value.offersAndArguments, 2_200),
    preuves_objections_garanties: cleanText(value.proofsAndObjections, 2_200),
    strategie_editoriale: cleanText(value.editorialStrategy, 2_200),
  };

  const payload = Object.fromEntries(
    Object.entries(entries).filter(([, item]) =>
      Array.isArray(item) ? item.length > 0 : Boolean(item),
    ),
  );
  return fitPromptPayloadToJsonBudget(payload, maxChars);
}
