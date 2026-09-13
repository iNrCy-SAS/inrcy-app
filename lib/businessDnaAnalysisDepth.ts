import {
  normalizeAiBusinessKnowledge,
  normalizeAiMemory,
  type AiBusinessDnaAnalysis,
} from "./aiMemory.ts";
import {
  hasBusinessWeeklySchedule,
  mergeBusinessWeeklySchedules,
} from "./businessWeeklySchedule.ts";

function richerText(primary: string, supplement: string) {
  if (!primary) return supplement;
  if (!supplement) return primary;
  // Une seconde passe ne remplace le brouillon principal que lorsqu'elle
  // apporte une quantité d'information réellement sensible, pas quelques
  // mots de reformulation.
  return supplement.length >= primary.length + Math.max(40, primary.length * 0.12)
    ? supplement
    : primary;
}

function mergeUnique(primary: string[], supplement: string[], maxItems: number) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of [...primary, ...supplement]) {
    const value = String(item || "").trim();
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= maxItems) break;
  }
  return result;
}

function chooseNews(primary: string[], supplement: string[]) {
  if (supplement.length <= primary.length) return primary;
  return supplement.slice(0, 4);
}

/**
 * Repère les rubriques trop pauvres pour justifier une passe de complément.
 * Les seuils sont des objectifs de richesse, jamais une autorisation à
 * inventer : une rubrique peut légitimement rester vide si les sources ne la
 * prouvent pas.
 */
export function getBusinessDnaAnalysisDepthGaps(
  businessKnowledge: unknown,
  memory: unknown,
  options: { includePremium?: boolean } = {},
) {
  const business = normalizeAiBusinessKnowledge(businessKnowledge);
  const normalized = normalizeAiMemory(memory, options);
  const gaps: string[] = [];
  const textGap = (key: string, value: string, minLength: number) => {
    if (value.length < minLength) gaps.push(key);
  };
  const listGap = (key: string, value: string[], minItems: number) => {
    if (value.length < minItems) gaps.push(key);
  };

  textGap("businessKnowledge.description", business.description, 500);
  listGap("businessKnowledge.services", business.services, 4);
  listGap("businessKnowledge.interventionZones", business.interventionZones, 1);
  if (!hasBusinessWeeklySchedule(business.weeklySchedule)) {
    gaps.push("businessKnowledge.weeklySchedule");
  }
  listGap("businessKnowledge.strengths", business.strengths, 4);
  listGap("businessKnowledge.customerTypes", business.customerTypes, 1);
  textGap("memory.detailedDescription", normalized.detailedDescription, 500);
  textGap("memory.mission", normalized.mission, 100);
  listGap("memory.specialties", normalized.specialties, 4);
  listGap("memory.targetAudiences", normalized.targetAudiences, 3);
  listGap("memory.customerNeeds", normalized.customerNeeds, 4);
  listGap("memory.differentiators", normalized.differentiators, 4);
  listGap("memory.values", normalized.values, 3);
  listGap("memory.brandPersonality", normalized.brandPersonality, 3);
  listGap("memory.commitments", normalized.commitments, 3);
  listGap("memory.preferredVocabulary", normalized.preferredVocabulary, 5);
  listGap("memory.forbiddenVocabulary", normalized.forbiddenVocabulary, 3);

  if (options.includePremium !== false) {
    textGap("memory.offersAndArguments", normalized.offersAndArguments, 700);
    textGap("memory.keyArguments", normalized.keyArguments, 350);
    textGap("memory.proofsAndObjections", normalized.proofsAndObjections, 700);
    textGap("memory.objectionResponses", normalized.objectionResponses, 450);
    textGap("memory.editorialStrategy", normalized.editorialStrategy, 900);
    textGap("memory.campaignCalendar", normalized.campaignCalendar, 650);
  }

  return gaps;
}

/**
 * Combine deux propositions générées à partir des mêmes sources. La seconde
 * passe peut compléter les listes et enrichir un texte trop court, tandis que
 * la fusion finale avec les données validées du professionnel reste assurée
 * par mergeAiBusinessDnaAnalysis().
 */
export function mergeBusinessDnaAnalysisDrafts(
  primaryDraft: { businessKnowledge?: unknown; memory?: unknown },
  supplementDraft: { businessKnowledge?: unknown; memory?: unknown },
  options: { includePremium?: boolean } = {},
): AiBusinessDnaAnalysis {
  const primaryBusiness = normalizeAiBusinessKnowledge(primaryDraft.businessKnowledge);
  const supplementBusiness = normalizeAiBusinessKnowledge(supplementDraft.businessKnowledge);
  const primaryMemory = normalizeAiMemory(primaryDraft.memory, options);
  const supplementMemory = normalizeAiMemory(supplementDraft.memory, options);
  const description = richerText(
    richerText(primaryBusiness.description, primaryMemory.detailedDescription),
    richerText(supplementBusiness.description, supplementMemory.detailedDescription),
  );

  const businessKnowledge = normalizeAiBusinessKnowledge({
    description,
    services: mergeUnique(primaryBusiness.services, supplementBusiness.services, 20),
    interventionZones: mergeUnique(
      primaryBusiness.interventionZones,
      supplementBusiness.interventionZones,
      30,
    ),
    weeklySchedule: mergeBusinessWeeklySchedules(
      primaryBusiness.weeklySchedule,
      supplementBusiness.weeklySchedule,
    ),
    strengths: mergeUnique(primaryBusiness.strengths, supplementBusiness.strengths, 16),
    customerTypes: mergeUnique(primaryBusiness.customerTypes, supplementBusiness.customerTypes, 3),
  });

  const memory = normalizeAiMemory({
    ...primaryMemory,
    detailedDescription: description,
    mission: richerText(primaryMemory.mission, supplementMemory.mission),
    specialties: mergeUnique(primaryMemory.specialties, supplementMemory.specialties, 16),
    targetAudiences: mergeUnique(primaryMemory.targetAudiences, supplementMemory.targetAudiences, 16),
    customerNeeds: mergeUnique(primaryMemory.customerNeeds, supplementMemory.customerNeeds, 16),
    differentiators: mergeUnique(
      primaryMemory.differentiators,
      supplementMemory.differentiators,
      16,
    ),
    values: mergeUnique(primaryMemory.values, supplementMemory.values, 16),
    brandPersonality: mergeUnique(
      primaryMemory.brandPersonality,
      supplementMemory.brandPersonality,
      12,
    ),
    commitments: mergeUnique(primaryMemory.commitments, supplementMemory.commitments, 12),
    preferredVocabulary: mergeUnique(
      primaryMemory.preferredVocabulary,
      supplementMemory.preferredVocabulary,
      16,
    ),
    forbiddenVocabulary: mergeUnique(
      primaryMemory.forbiddenVocabulary,
      supplementMemory.forbiddenVocabulary,
      16,
    ),
    offersAndArguments: richerText(
      primaryMemory.offersAndArguments,
      supplementMemory.offersAndArguments,
    ),
    keyArguments: richerText(primaryMemory.keyArguments, supplementMemory.keyArguments),
    proofsAndObjections: richerText(
      primaryMemory.proofsAndObjections,
      supplementMemory.proofsAndObjections,
    ),
    objectionResponses: richerText(
      primaryMemory.objectionResponses,
      supplementMemory.objectionResponses,
    ),
    editorialStrategy: richerText(
      primaryMemory.editorialStrategy,
      supplementMemory.editorialStrategy,
    ),
    campaignCalendar: richerText(
      primaryMemory.campaignCalendar,
      supplementMemory.campaignCalendar,
    ),
    recentNewsItems: chooseNews(
      primaryMemory.recentNewsItems,
      supplementMemory.recentNewsItems,
    ),
  }, options);

  return { businessKnowledge, memory };
}
