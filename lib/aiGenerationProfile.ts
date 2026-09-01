import { getJobLabel } from "@/lib/activityCatalog";
import {
  decodeBusinessSector,
  getActivitySectorLabel,
} from "@/lib/activitySectors";
import {
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import { asRecord } from "@/lib/tsSafe";
import { combineOpeningSchedule } from "@/lib/openingSchedule";

export type AiLanguageCode = "fr" | "en" | "es" | "it" | "de" | "nl" | "pt" | "th" | "zh";
export type AiTone = "serious" | "warm" | "fun" | "premium" | "direct";
export type AiCommunicationStyle =
  | "simple"
  | "dynamic"
  | "expert"
  | "coulisses"
  | "local_humain"
  | "premium";
export type AiCreativity = "classic" | "balanced" | "creative";
export type AiLength = "short" | "medium" | "detailed";
export type AiEmojiLevel = "none" | "light" | "dynamic";
export type AiVoice = "je" | "nous" | "vous" | "neutral";
export type AiAddressMode = "vous" | "tu";
export type AiCommercialLevel = "discreet" | "balanced" | "direct";
export type AiMainGoal = "visibility" | "contacts" | "reassure" | "offer";
export type AiPreferredAngle = "local" | "quality" | "price" | "speed" | "trust";
export type AiPreferredCta = "none" | "site" | "devis" | "appeler" | "message" | "custom";
export type AiGenerationMediaType = "none" | "images" | "video" | "attachments";

export type AiGenerationPreferences = {
  engine: AiPreferredEngine;
  language: AiLanguageCode;
  tone: AiTone;
  communicationStyle: AiCommunicationStyle;
  creativity: AiCreativity;
  length: AiLength;
  emojiLevel: AiEmojiLevel;
  voice: AiVoice;
  addressMode: AiAddressMode;
  commercialLevel: AiCommercialLevel;
  mainGoal: AiMainGoal;
  preferredAngle: AiPreferredAngle;
  preferredCta: AiPreferredCta;
  likedExample: string;
  customInstructions: string;
};

export type AiGenerationBusinessContext = {
  companyName: string;
  city: string;
  postalCode: string;
  phone: string;
  email: string;
  sectorCode: string;
  sectorLabel: string;
  professionCode: string;
  professionLabel: string;
  description: string;
  services: string[];
  interventionZones: string[];
  openingDays: string;
  openingHours: string;
  strengths: string[];
  customerTypologies: string[];
};

export type AiGenerationMediaContext = {
  type: AiGenerationMediaType;
  count: number;
  hasVisualContext: boolean;
  hasAudioTranscript: boolean;
  context: string;
};

export type AiGenerationRequestContext = {
  idea: string;
  theme: string;
  style: string;
  media: AiGenerationMediaContext;
};

export type NormalizedAiGenerationProfile = {
  kind: "inrcy.ai-generation-profile";
  version: 1;
  preferences: AiGenerationPreferences;
  business: AiGenerationBusinessContext;
  request: AiGenerationRequestContext;
};

export type BuildNormalizedAiGenerationProfileArgs = {
  profile?: unknown;
  business?: unknown;
  preferences?: unknown;
  idea?: unknown;
  theme?: unknown;
  style?: unknown;
  media?: Partial<AiGenerationMediaContext> | null;
};

const cleanText = (value: unknown, max = 800) =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);

function cleanList(value: unknown, maxItems = 12, maxItemLength = 120) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const text = cleanText(item, maxItemLength);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function firstValue(sources: Record<string, unknown>[], keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return value;
      }
    }
  }
  return undefined;
}

function firstList(sources: Record<string, unknown>[], keys: string[], maxItems = 12) {
  for (const source of sources) {
    for (const key of keys) {
      const list = cleanList(source[key], maxItems);
      if (list.length) return list;
    }
  }
  return [];
}

function normalizeFromMap<T extends string>(
  value: unknown,
  aliases: Record<string, T>,
  fallback: T,
): T {
  const raw = cleanText(value, 100).toLocaleLowerCase();
  return aliases[raw] || fallback;
}

const TONE_ALIASES: Record<string, AiTone> = {
  serious: "serious",
  serieux: "serious",
  sérieux: "serious",
  pro: "serious",
  professional: "serious",
  warm: "warm",
  chaleureux: "warm",
  friendly: "warm",
  fun: "fun",
  premium: "premium",
  direct: "direct",
};

const STYLE_ALIASES: Record<string, AiCommunicationStyle> = {
  simple: "simple",
  clear: "simple",
  clair: "simple",
  dynamic: "dynamic",
  dynamique: "dynamic",
  moderne: "dynamic",
  expert: "expert",
  professionnel: "expert",
  coulisses: "coulisses",
  histoire: "coulisses",
  storytelling: "coulisses",
  local_humain: "local_humain",
  "local-humain": "local_humain",
  premium: "premium",
};

const CREATIVITY_ALIASES: Record<string, AiCreativity> = {
  classic: "classic",
  classique: "classic",
  stable: "classic",
  balanced: "balanced",
  equilibree: "balanced",
  équilibrée: "balanced",
  equilibre: "balanced",
  creative: "creative",
  creatif: "creative",
  créatif: "creative",
  creativee: "creative",
  créative: "creative",
};

const LENGTH_ALIASES: Record<string, AiLength> = {
  short: "short",
  court: "short",
  medium: "medium",
  moyen: "medium",
  detailed: "detailed",
  detaille: "detailed",
  détaillé: "detailed",
  long: "detailed",
};

const EMOJI_ALIASES: Record<string, AiEmojiLevel> = {
  none: "none",
  aucun: "none",
  no: "none",
  light: "light",
  leger: "light",
  léger: "light",
  moderate: "light",
  normal: "light",
  dynamic: "dynamic",
  many: "dynamic",
  beaucoup: "dynamic",
};

const VOICE_ALIASES: Record<string, AiVoice> = {
  auto: "nous",
  je: "je",
  nous: "nous",
  vous: "vous",
  neutral: "neutral",
  neutre: "neutral",
};

const ADDRESS_ALIASES: Record<string, AiAddressMode> = {
  vous: "vous",
  vouvoiement: "vous",
  auto: "vous",
  tu: "tu",
  tutoiement: "tu",
};

const COMMERCIAL_ALIASES: Record<string, AiCommercialLevel> = {
  discreet: "discreet",
  discret: "discreet",
  discretement: "discreet",
  balanced: "balanced",
  equilibre: "balanced",
  équilibré: "balanced",
  direct: "direct",
};

const GOAL_ALIASES: Record<string, AiMainGoal> = {
  visibility: "visibility",
  visible: "visibility",
  notoriete: "visibility",
  contacts: "contacts",
  contact: "contacts",
  leads: "contacts",
  reassure: "reassure",
  rassurer: "reassure",
  offer: "offer",
  offre: "offer",
};

const ANGLE_ALIASES: Record<string, AiPreferredAngle> = {
  local: "local",
  proximity: "local",
  proximite: "local",
  quality: "quality",
  qualite: "quality",
  qualité: "quality",
  price: "price",
  prix: "price",
  speed: "speed",
  rapidite: "speed",
  rapidité: "speed",
  trust: "trust",
  confiance: "trust",
};

const CTA_ALIASES: Record<string, AiPreferredCta> = {
  none: "none",
  aucun: "none",
  site: "site",
  website: "site",
  devis: "devis",
  quote: "devis",
  appeler: "appeler",
  call: "appeler",
  message: "message",
  contact: "message",
  custom: "custom",
  personnalise: "custom",
  personnalisé: "custom",
};

export function normalizeAiLanguageCode(value: unknown): AiLanguageCode {
  const raw = cleanText(value, 80).toLocaleLowerCase();
  if (["fr", "french", "francais", "français"].includes(raw)) return "fr";
  if (["en", "english", "anglais"].includes(raw)) return "en";
  if (["es", "spanish", "espagnol"].includes(raw)) return "es";
  if (["it", "italian", "italien"].includes(raw)) return "it";
  if (["de", "german", "allemand"].includes(raw)) return "de";
  if (["nl", "dutch", "neerlandais", "néerlandais"].includes(raw)) return "nl";
  if (["pt", "portuguese", "portugais"].includes(raw)) return "pt";
  if (["th", "th-th", "thai", "thailandais", "thaïlandais", "ภาษาไทย"].includes(raw)) return "th";
  if (["zh", "zh-cn", "zh_cn", "zh-hans", "chinese", "simplified chinese", "chinois", "chinois simplifié", "中文", "简体中文"].includes(raw)) return "zh";
  return "fr";
}

export function isNormalizedAiGenerationProfile(
  value: unknown,
): value is NormalizedAiGenerationProfile {
  const source = asRecord(value);
  return (
    source.kind === "inrcy.ai-generation-profile" &&
    source.version === 1 &&
    Boolean(source.preferences) &&
    Boolean(source.business) &&
    Boolean(source.request)
  );
}

export function buildNormalizedAiGenerationProfile(
  args: BuildNormalizedAiGenerationProfileArgs = {},
): NormalizedAiGenerationProfile {
  if (isNormalizedAiGenerationProfile(args.business)) return args.business;
  if (isNormalizedAiGenerationProfile(args.profile)) return args.profile;
  if (isNormalizedAiGenerationProfile(args.preferences)) return args.preferences;

  const profile = asRecord(args.profile);
  const business = asRecord(args.business);
  const preferenceOverrides = asRecord(args.preferences);

  // Les préférences explicites gagnent, puis les informations métier et générales du profil unifié.
  // Cela rend la résolution identique dans Booster, iNrAgent et les reprises.
  const preferenceSources = [preferenceOverrides, business, profile];
  const identitySources = [profile, business];
  const activitySources = [business, profile];

  const rawSector = cleanText(
    firstValue(activitySources, ["sector", "activity_sector", "sector_category"]),
    160,
  );
  const decodedSector = decodeBusinessSector(rawSector);
  const sectorCode = cleanText(decodedSector.sectorCategory || rawSector, 100);
  const professionCode = cleanText(
    decodedSector.profession ||
      firstValue(activitySources, ["profession", "job", "business_job", "activity_job"]),
    120,
  );
  const sectorLabel = cleanText(getActivitySectorLabel(sectorCode), 120);
  const professionLabel = cleanText(
    getJobLabel(decodedSector.sectorCategory, professionCode) || professionCode,
    140,
  );

  const mediaType: AiGenerationMediaType =
    args.media?.type === "video"
      ? "video"
      : args.media?.type === "images"
        ? "images"
        : args.media?.type === "attachments"
          ? "attachments"
          : "none";
  const mediaCount = Math.max(0, Math.min(10, Number(args.media?.count || 0) || 0));

  return {
    kind: "inrcy.ai-generation-profile",
    version: 1,
    preferences: {
      engine: normalizeAiPreferredEngine(
        firstValue(preferenceSources, ["ai_preferred_engine", "preferred_engine", "engine"]),
      ),
      language: normalizeAiLanguageCode(
        firstValue(preferenceSources, ["ai_language", "language", "generation_language"]),
      ),
      tone: normalizeFromMap(
        firstValue(preferenceSources, ["tone", "ai_tone"]),
        TONE_ALIASES,
        "serious",
      ),
      communicationStyle: normalizeFromMap(
        firstValue(preferenceSources, [
          "communication_style",
          "ai_communication_style",
          "ai_text_style",
          "text_style",
        ]),
        STYLE_ALIASES,
        "simple",
      ),
      creativity: normalizeFromMap(
        firstValue(preferenceSources, ["ai_creativity", "creativity", "originality"]),
        CREATIVITY_ALIASES,
        "balanced",
      ),
      length: normalizeFromMap(
        firstValue(preferenceSources, ["ai_length", "ai_content_length", "content_length"]),
        LENGTH_ALIASES,
        "medium",
      ),
      emojiLevel: normalizeFromMap(
        firstValue(preferenceSources, ["emoji_level", "ai_emoji_level", "emojis"]),
        EMOJI_ALIASES,
        "light",
      ),
      voice: normalizeFromMap(
        firstValue(preferenceSources, ["ai_voice", "ai_pronoun", "pronoun", "voice"]),
        VOICE_ALIASES,
        "nous",
      ),
      addressMode: normalizeFromMap(
        firstValue(preferenceSources, [
          "address_mode",
          "ai_audience_relation",
          "audience_relation",
        ]),
        ADDRESS_ALIASES,
        "vous",
      ),
      commercialLevel: normalizeFromMap(
        firstValue(preferenceSources, ["ai_commercial_level", "commercial_level"]),
        COMMERCIAL_ALIASES,
        "balanced",
      ),
      mainGoal: normalizeFromMap(
        firstValue(preferenceSources, ["ai_main_goal", "main_goal", "goal"]),
        GOAL_ALIASES,
        "contacts",
      ),
      preferredAngle: normalizeFromMap(
        firstValue(preferenceSources, ["ai_preferred_angle", "preferred_angle", "angle"]),
        ANGLE_ALIASES,
        "trust",
      ),
      preferredCta: normalizeFromMap(
        firstValue(preferenceSources, [
          "preferred_cta",
          "ai_cta_preference",
          "cta_preference",
        ]),
        CTA_ALIASES,
        "devis",
      ),
      likedExample: cleanText(
        firstValue(preferenceSources, ["ai_liked_example", "liked_example"]),
        1200,
      ),
      customInstructions: cleanText(
        firstValue(preferenceSources, ["ai_custom_instructions", "custom_instructions"]),
        1200,
      ),
    },
    business: {
      companyName: cleanText(
        firstValue(identitySources, [
          "company_legal_name",
          "companyLegalName",
          "company_name",
          "business_name",
          "name",
        ]),
        120,
      ),
      city: cleanText(
        firstValue(identitySources, ["hq_city", "hqCity", "city", "business_city"]),
        100,
      ),
      postalCode: cleanText(
        firstValue(identitySources, ["hq_zip", "hqZip", "postal_code", "zip"]),
        24,
      ),
      phone: cleanText(firstValue(identitySources, ["phone", "business_phone"]), 70),
      email: cleanText(
        firstValue(identitySources, [
          "contact_email",
          "contactEmail",
          "email",
          "business_email",
        ]),
        120,
      ),
      sectorCode,
      sectorLabel,
      professionCode,
      professionLabel,
      description: cleanText(
        firstValue(activitySources, [
          "business_description",
          "activity_description",
          "company_description",
          "description",
        ]),
        1200,
      ),
      services: firstList(activitySources, ["services", "services_text"], 12),
      interventionZones: firstList(
        activitySources,
        ["intervention_zones", "intervention_zones_text", "zones"],
        10,
      ),
      // Profil canonique : tous les anciens et nouveaux formats deviennent un
      // seul planning libre. openingDays reste vide pour éviter les doublons.
      openingDays: "",
      openingHours: combineOpeningSchedule(
        firstValue(activitySources, ["opening_days"]),
        firstValue(activitySources, ["opening_hours"]),
      ),
      strengths: firstList(activitySources, ["strengths", "strengths_text"], 8),
      customerTypologies: firstList(
        activitySources,
        ["customer_typologies", "customer_types", "audiences"],
        8,
      ),
    },
    request: {
      idea: cleanText(args.idea, 4000),
      theme: cleanText(args.theme, 120),
      style: cleanText(args.style, 120),
      media: {
        type: mediaType,
        count: mediaCount,
        hasVisualContext: Boolean(args.media?.hasVisualContext || mediaCount > 0),
        hasAudioTranscript: Boolean(args.media?.hasAudioTranscript),
        context: cleanText(args.media?.context, 8000),
      },
    },
  };
}

/**
 * Normalise une source isolée (ancienne ligne business_profiles, profil général,
 * ou déjà le profil canonique) pour les modules qui ne disposent pas encore
 * d'un contexte de requête complet.
 */
export function normalizeAiGenerationSource(source: unknown) {
  if (isNormalizedAiGenerationProfile(source)) return source;
  return buildNormalizedAiGenerationProfile({ business: source });
}
