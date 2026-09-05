import { normalizeAppLanguage, type AppLanguageCode } from "./appLanguage.ts";
import {
  DEFAULT_AI_PREFERRED_ENGINE,
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "./aiEnginePreference.ts";
import {
  enforceAiContentLengthForEdition,
  normalizeAiContentLength,
  type AiContentLength,
} from "./aiContentLength.ts";
import type { DashboardEdition } from "./dashboardEdition.ts";

type BoosterPreferredCta = "none" | "site" | "devis" | "appeler" | "message" | "custom";

const PREFERRED_CTA_VALUES = new Set<BoosterPreferredCta>([
  "none",
  "site",
  "devis",
  "appeler",
  "message",
  "custom",
]);

function normalizeBoosterPreferredCta(value: unknown): BoosterPreferredCta {
  const raw = String(value ?? "").trim().toLocaleLowerCase() as BoosterPreferredCta;
  return PREFERRED_CTA_VALUES.has(raw) ? raw : "devis";
}

export type AiConfigurationFormValues = {
  preferredEngine: AiPreferredEngine;
  tone: "serious" | "warm" | "fun" | "premium";
  textStyle: "simple" | "dynamic" | "expert" | "coulisses" | "local_humain" | "premium";
  originality: "classic" | "balanced" | "creative";
  webLength: AiContentLength;
  socialLength: AiContentLength;
  emojiLevel: "none" | "light" | "dynamic";
  pronoun: "auto" | "je" | "nous" | "vous" | "neutral";
  addressMode: "vous" | "tu";
  commercialLevel: "discreet" | "balanced" | "direct";
  technicalityLevel: "accessible" | "balanced" | "expert";
  humorLevel: "none" | "light" | "present";
  mainGoal: "visibility" | "contacts" | "reassure" | "offer";
  preferredAngle: "local" | "quality" | "price" | "speed" | "trust";
  preferredCta: BoosterPreferredCta;
  language: AppLanguageCode;
  likedExample: string;
  likedExample2: string;
  forbiddenStyle: string;
};

export const DEFAULT_AI_CONFIGURATION_FORM: AiConfigurationFormValues = {
  preferredEngine: DEFAULT_AI_PREFERRED_ENGINE,
  tone: "serious",
  textStyle: "simple",
  originality: "balanced",
  webLength: "adapted",
  socialLength: "adapted",
  emojiLevel: "light",
  pronoun: "nous",
  addressMode: "vous",
  commercialLevel: "balanced",
  technicalityLevel: "balanced",
  humorLevel: "none",
  mainGoal: "contacts",
  preferredAngle: "trust",
  preferredCta: "devis",
  language: "fr",
  likedExample: "",
  likedExample2: "",
  forbiddenStyle: "",
};

export type AiConfigurationCacheSelection = {
  rawValue: string | null;
  source: "scoped" | "legacy-global" | "none";
};

/**
 * Sélectionne le cache navigateur sans laisser les réglages d'un compte
 * contaminer un autre compte actif. La clé globale historique reste lisible
 * uniquement pour le compte principal qui l'avait créée ; une clé scopée,
 * même vide après une réinitialisation volontaire, gagne toujours.
 */
export function selectAiConfigurationCache(args: {
  scopedValue: string | null;
  legacyGlobalValue: string | null;
  activeUserId: string | null | undefined;
  authUserId: string | null | undefined;
}): AiConfigurationCacheSelection {
  if (args.scopedValue !== null) {
    return { rawValue: args.scopedValue, source: "scoped" };
  }
  if (
    args.activeUserId &&
    args.authUserId &&
    args.activeUserId === args.authUserId &&
    args.legacyGlobalValue !== null
  ) {
    return { rawValue: args.legacyGlobalValue, source: "legacy-global" };
  }
  return { rawValue: null, source: "none" };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function firstMeaningful(source: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function cleanLower(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function normalizeTone(value: unknown): AiConfigurationFormValues["tone"] {
  const raw = cleanLower(value);
  if (raw === "fun") return "fun";
  if (["premium", "haut de gamme", "haut-de-gamme"].includes(raw)) return "premium";
  if (["friendly", "warm", "chaleureux"].includes(raw)) return "warm";
  return "serious";
}

function normalizeTextStyle(value: unknown): AiConfigurationFormValues["textStyle"] {
  const raw = cleanLower(value);
  if (["dynamic", "dynamique", "moderne"].includes(raw)) return "dynamic";
  if (["expert", "professionnel", "professional"].includes(raw)) return "expert";
  if (["coulisses", "histoire", "storytelling"].includes(raw)) return "coulisses";
  if (["local_humain", "local-humain"].includes(raw)) return "local_humain";
  if (raw === "premium") return "premium";
  return "simple";
}

function normalizeOriginality(value: unknown): AiConfigurationFormValues["originality"] {
  const raw = cleanLower(value);
  if (["classic", "classique", "stable"].includes(raw)) return "classic";
  if (["creative", "creatif", "créatif"].includes(raw)) return "creative";
  return "balanced";
}

function normalizeLength(
  value: unknown,
  fallback: AiContentLength = "medium",
): AiContentLength {
  return normalizeAiContentLength(value, fallback);
}

function normalizeEmojiLevel(value: unknown): AiConfigurationFormValues["emojiLevel"] {
  const raw = cleanLower(value);
  if (raw === "none") return "none";
  if (["dynamic", "many", "beaucoup"].includes(raw)) return "dynamic";
  return "light";
}

function normalizePronoun(value: unknown): AiConfigurationFormValues["pronoun"] {
  const raw = cleanLower(value);
  if (raw === "auto") return "auto";
  if (raw === "je") return "je";
  if (raw === "vous") return "vous";
  if (["neutral", "neutre"].includes(raw)) return "neutral";
  return "nous";
}

function normalizeAddressMode(value: unknown): AiConfigurationFormValues["addressMode"] {
  return cleanLower(value) === "tu" ? "tu" : "vous";
}

function normalizeCommercialLevel(value: unknown): AiConfigurationFormValues["commercialLevel"] {
  const raw = cleanLower(value);
  if (["discreet", "discret", "discrèt"].includes(raw)) return "discreet";
  if (raw === "direct") return "direct";
  return "balanced";
}

function normalizeTechnicalityLevel(value: unknown): AiConfigurationFormValues["technicalityLevel"] {
  const raw = cleanLower(value);
  if (["accessible", "simple", "beginner", "débutant"].includes(raw)) return "accessible";
  if (["expert", "technical", "technique"].includes(raw)) return "expert";
  return "balanced";
}

function normalizeHumorLevel(value: unknown): AiConfigurationFormValues["humorLevel"] {
  const raw = cleanLower(value);
  if (["light", "leger", "léger"].includes(raw)) return "light";
  if (["present", "présent", "visible"].includes(raw)) return "present";
  return "none";
}

function normalizeMainGoal(value: unknown): AiConfigurationFormValues["mainGoal"] {
  const raw = cleanLower(value);
  if (["visibility", "visible", "visibilite", "visibilité"].includes(raw)) return "visibility";
  if (["reassure", "rassurer"].includes(raw)) return "reassure";
  if (["offer", "offre"].includes(raw)) return "offer";
  return "contacts";
}

function normalizePreferredAngle(value: unknown): AiConfigurationFormValues["preferredAngle"] {
  const raw = cleanLower(value);
  if (raw === "local") return "local";
  if (["quality", "qualite", "qualité"].includes(raw)) return "quality";
  if (["price", "prix"].includes(raw)) return "price";
  if (["speed", "rapidite", "rapidité"].includes(raw)) return "speed";
  return "trust";
}

function setIfMeaningful<K extends keyof AiConfigurationFormValues>(
  target: Partial<AiConfigurationFormValues>,
  key: K,
  value: unknown,
  normalize: (raw: unknown) => AiConfigurationFormValues[K],
) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    target[key] = normalize(value);
  }
}

/**
 * Convertit toutes les formes historiques de `inrcy_ai_configuration` sans
 * fabriquer de valeur. Les clés absentes restent absentes afin qu'une ancienne
 * sauvegarde partielle ne masque jamais une valeur serveur existante.
 */
export function migrateLegacyAiConfigurationLocal(
  value: unknown,
  edition: DashboardEdition,
): Partial<AiConfigurationFormValues> {
  const source = asRecord(value);
  const result: Partial<AiConfigurationFormValues> = {};

  setIfMeaningful(result, "preferredEngine", firstMeaningful(source, ["preferredEngine", "engine"]), normalizeAiPreferredEngine);
  const rawTone = firstMeaningful(source, ["tone"]);
  setIfMeaningful(result, "tone", rawTone, normalizeTone);
  setIfMeaningful(result, "textStyle", firstMeaningful(source, ["textStyle", "communicationStyle"]), normalizeTextStyle);
  setIfMeaningful(result, "originality", firstMeaningful(source, ["originality", "creativity"]), normalizeOriginality);

  const legacyLength = firstMeaningful(source, ["length"]);
  const webLength = firstMeaningful(source, ["webLength"]);
  const socialLength = firstMeaningful(source, ["socialLength"]);
  if (webLength !== undefined || legacyLength !== undefined) {
    result.webLength = enforceAiContentLengthForEdition(
      normalizeLength(webLength, normalizeLength(legacyLength, "adapted")),
      edition,
    );
  }
  if (socialLength !== undefined || legacyLength !== undefined) {
    result.socialLength = enforceAiContentLengthForEdition(
      normalizeLength(socialLength, normalizeLength(legacyLength, "adapted")),
      edition,
    );
  }

  setIfMeaningful(result, "emojiLevel", firstMeaningful(source, ["emojiLevel", "emojis"]), normalizeEmojiLevel);
  setIfMeaningful(result, "pronoun", firstMeaningful(source, ["pronoun", "aiVoice"]), normalizePronoun);
  setIfMeaningful(result, "addressMode", firstMeaningful(source, ["addressMode"]), normalizeAddressMode);

  const rawCommercialLevel = firstMeaningful(source, ["commercialLevel"]);
  if (rawCommercialLevel !== undefined) {
    result.commercialLevel = normalizeCommercialLevel(rawCommercialLevel);
  } else if (cleanLower(rawTone) === "direct") {
    // L'ancien ton « Direct » n'existe plus comme ton. Son intention se
    // range désormais dans le niveau commercial plutôt que d'être perdue.
    result.commercialLevel = "direct";
  }

  setIfMeaningful(result, "technicalityLevel", firstMeaningful(source, ["technicalityLevel"]), normalizeTechnicalityLevel);
  setIfMeaningful(result, "humorLevel", firstMeaningful(source, ["humorLevel", "humourLevel"]), normalizeHumorLevel);
  setIfMeaningful(result, "mainGoal", firstMeaningful(source, ["mainGoal"]), normalizeMainGoal);
  setIfMeaningful(result, "preferredAngle", firstMeaningful(source, ["preferredAngle"]), normalizePreferredAngle);
  setIfMeaningful(result, "preferredCta", firstMeaningful(source, ["preferredCta"]), normalizeBoosterPreferredCta);
  setIfMeaningful(result, "language", firstMeaningful(source, ["language"]), normalizeAppLanguage);

  const likedExample = firstMeaningful(source, ["likedExample"]);
  if (likedExample !== undefined) result.likedExample = String(likedExample).slice(0, 1200);
  const likedExample2 = firstMeaningful(source, ["likedExample2"]);
  if (likedExample2 !== undefined) result.likedExample2 = String(likedExample2).slice(0, 1200);
  const instructions = firstMeaningful(source, ["forbiddenStyle", "customInstructions"]);
  if (instructions !== undefined) result.forbiddenStyle = String(instructions).slice(0, 700);

  return result;
}

/** Transforme une ligne `business_profiles`, ancienne ou actuelle, en champs UI. */
export function migrateBusinessProfileAiConfiguration(
  value: unknown,
  edition: DashboardEdition,
  options: { useDbLanguage?: boolean } = {},
): Partial<AiConfigurationFormValues> {
  const source = asRecord(value);
  const result: Partial<AiConfigurationFormValues> = {};

  setIfMeaningful(result, "preferredEngine", firstMeaningful(source, ["ai_preferred_engine", "preferred_engine"]), normalizeAiPreferredEngine);
  const rawTone = firstMeaningful(source, ["tone", "ai_tone"]);
  setIfMeaningful(result, "tone", rawTone, normalizeTone);
  setIfMeaningful(result, "textStyle", firstMeaningful(source, ["communication_style", "ai_communication_style", "ai_text_style"]), normalizeTextStyle);
  setIfMeaningful(result, "originality", firstMeaningful(source, ["ai_creativity", "creativity", "originality"]), normalizeOriginality);

  const legacyLength = firstMeaningful(source, ["ai_length", "length"]);
  const webLength = firstMeaningful(source, ["ai_web_length", "web_length"]);
  const socialLength = firstMeaningful(source, ["ai_social_length", "social_length"]);
  if (webLength !== undefined || legacyLength !== undefined) {
    result.webLength = enforceAiContentLengthForEdition(
      normalizeLength(webLength, normalizeLength(legacyLength, "adapted")),
      edition,
    );
  }
  if (socialLength !== undefined || legacyLength !== undefined) {
    result.socialLength = enforceAiContentLengthForEdition(
      normalizeLength(socialLength, normalizeLength(legacyLength, "adapted")),
      edition,
    );
  }

  setIfMeaningful(result, "emojiLevel", firstMeaningful(source, ["emoji_level", "ai_emoji_level"]), normalizeEmojiLevel);
  setIfMeaningful(result, "pronoun", firstMeaningful(source, ["ai_voice", "ai_pronoun", "pronoun"]), normalizePronoun);
  setIfMeaningful(result, "addressMode", firstMeaningful(source, ["address_mode", "ai_audience_relation"]), normalizeAddressMode);
  const rawCommercialLevel = firstMeaningful(source, ["ai_commercial_level", "commercial_level"]);
  if (rawCommercialLevel !== undefined) {
    result.commercialLevel = normalizeCommercialLevel(rawCommercialLevel);
  } else if (cleanLower(rawTone) === "direct") {
    result.commercialLevel = "direct";
  }
  setIfMeaningful(result, "technicalityLevel", firstMeaningful(source, ["ai_technicality_level", "technicality_level"]), normalizeTechnicalityLevel);
  setIfMeaningful(result, "humorLevel", firstMeaningful(source, ["ai_humor_level", "humor_level", "humour_level"]), normalizeHumorLevel);
  setIfMeaningful(result, "mainGoal", firstMeaningful(source, ["ai_main_goal", "main_goal"]), normalizeMainGoal);
  setIfMeaningful(result, "preferredAngle", firstMeaningful(source, ["ai_preferred_angle", "preferred_angle"]), normalizePreferredAngle);
  setIfMeaningful(result, "preferredCta", firstMeaningful(source, ["preferred_cta", "ai_cta_preference"]), normalizeBoosterPreferredCta);
  if (options.useDbLanguage) {
    setIfMeaningful(result, "language", firstMeaningful(source, ["ai_language", "generation_language"]), normalizeAppLanguage);
  }

  const likedExample = firstMeaningful(source, ["ai_liked_example", "liked_example"]);
  if (likedExample !== undefined) result.likedExample = String(likedExample).slice(0, 1200);
  const likedExample2 = firstMeaningful(source, ["ai_liked_example_2", "liked_example_2"]);
  if (likedExample2 !== undefined) result.likedExample2 = String(likedExample2).slice(0, 1200);
  const instructions = firstMeaningful(source, ["ai_custom_instructions", "custom_instructions"]);
  if (instructions !== undefined) result.forbiddenStyle = String(instructions).slice(0, 700);

  return result;
}

export function resolveCompatibleAiConfiguration(args: {
  local?: unknown;
  businessProfile?: unknown;
  edition: DashboardEdition;
  appDefaultLanguage?: AppLanguageCode;
  useDbLanguage?: boolean;
}): AiConfigurationFormValues {
  const defaults = {
    ...DEFAULT_AI_CONFIGURATION_FORM,
    language: args.appDefaultLanguage || DEFAULT_AI_CONFIGURATION_FORM.language,
  };
  return {
    ...defaults,
    ...migrateLegacyAiConfigurationLocal(args.local, args.edition),
    ...migrateBusinessProfileAiConfiguration(args.businessProfile, args.edition, {
      useDbLanguage: args.useDbLanguage,
    }),
  };
}
