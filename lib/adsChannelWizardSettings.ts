import type { AdsChannelDraft } from "./adsChannelDrafts.ts";
import type { PlannedAdsChannel } from "./adsChannelCapabilities.ts";

/** Local planning choices only. Never serialize these values to an Ads API. */
export const LINKEDIN_WIZARD_FORMATS = {
  BRAND_AWARENESS: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL", "TEXT_AD"],
  WEBSITE_VISIT: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL", "TEXT_AD"],
  ENGAGEMENT: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL"],
  VIDEO_VIEW: ["SINGLE_VIDEO"],
  LEAD_GENERATION: ["LEAD_GENERATION_FORM_SPONSORED_CONTENT"],
  WEBSITE_CONVERSION: ["STANDARD_UPDATE", "SINGLE_VIDEO", "CAROUSEL", "TEXT_AD"],
} as const;

export const PINTEREST_WIZARD_OBJECTIVES = ["AWARENESS", "CONSIDERATION", "VIDEO_COMPLETION", "SALES", "LEADS"] as const;
export const TIKTOK_WIZARD_OBJECTIVES = ["REACH", "VIDEO_VIEWS", "TRAFFIC", "WEB_CONVERSIONS", "LEAD_GENERATION", "ENGAGEMENT"] as const;
export const X_WIZARD_OBJECTIVES = ["reach", "video_views", "website_traffic", "website_conversions", "engagement"] as const;

export type LinkedInWizardSettings = {
  schemaVersion: 1;
  channel: "linkedin";
  objectiveType: keyof typeof LINKEDIN_WIZARD_FORMATS;
  format: (typeof LINKEDIN_WIZARD_FORMATS)[keyof typeof LINKEDIN_WIZARD_FORMATS][number];
  targetingFacet: "titles" | "industries" | "skills";
  locale: { country: string; language: string };
};
export type TikTokWizardSettings = {
  schemaVersion: 1;
  channel: "tiktok";
  objectiveType: (typeof TIKTOK_WIZARD_OBJECTIVES)[number];
  format: "video";
  targetingMode: "broad" | "interests";
  placementIntent: "automatic" | "tiktok_only";
  optimizationIntent: "reach" | "views" | "clicks" | "conversions" | "leads" | "engagement";
  destinationKind: "website" | "instant_form" | "profile";
};
export type PinterestWizardSettings = {
  schemaVersion: 1;
  channel: "pinterest";
  objectiveType: (typeof PINTEREST_WIZARD_OBJECTIVES)[number];
  intendedPromotionType: "STANDARD_AD" | "CATALOG";
  creativeType: "REGULAR" | "VIDEO" | "MAX_VIDEO" | "CAROUSEL" | null;
  targetingMode: "interests" | "keywords" | "audiences";
  conversionEvent: "CHECKOUT" | "ADD_TO_CART" | "SIGNUP" | "LEAD" | null;
};
export type XWizardSettings = {
  schemaVersion: 1;
  channel: "x";
  objective: (typeof X_WIZARD_OBJECTIVES)[number];
  format: "text" | "image" | "video";
  targetingMode: "broad" | "keywords" | "interests" | "follower_lookalikes";
};
export type AdsChannelWizardSettings = LinkedInWizardSettings | TikTokWizardSettings | PinterestWizardSettings | XWizardSettings;

export function defaultAdsChannelWizardSettings(channel: PlannedAdsChannel): AdsChannelWizardSettings {
  switch (channel) {
    case "linkedin": return { schemaVersion: 1, channel, objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", targetingFacet: "titles", locale: { country: "FR", language: "fr" } };
    case "tiktok": return { schemaVersion: 1, channel, objectiveType: "TRAFFIC", format: "video", targetingMode: "broad", placementIntent: "tiktok_only", optimizationIntent: "clicks", destinationKind: "website" };
    case "pinterest": return { schemaVersion: 1, channel, objectiveType: "CONSIDERATION", intendedPromotionType: "STANDARD_AD", creativeType: "REGULAR", targetingMode: "interests", conversionEvent: null };
    case "x": return { schemaVersion: 1, channel, objective: "website_traffic", format: "text", targetingMode: "broad" };
  }
}

export function adsChannelWizardSettingsFromBrief(brief: AdsChannelDraft): AdsChannelWizardSettings {
  const defaults = defaultAdsChannelWizardSettings(brief.channel);
  switch (brief.channel) {
    case "linkedin": return { ...(defaults as LinkedInWizardSettings), objectiveType: brief.objectiveType, format: brief.format, locale: brief.locale };
    case "tiktok": return { ...(defaults as TikTokWizardSettings), objectiveType: brief.objectiveType, format: brief.format, placementIntent: brief.placementIntent, optimizationIntent: brief.optimizationIntent, destinationKind: brief.destinationKind };
    case "pinterest": return { ...(defaults as PinterestWizardSettings), objectiveType: brief.objectiveType, intendedPromotionType: brief.intendedPromotionType, creativeType: brief.creativeType || null, conversionEvent: brief.conversionEvent || null };
    case "x": return { ...(defaults as XWizardSettings), objective: brief.objective, format: brief.format, targetingMode: brief.targetingMode };
  }
}

/** A changed native choice invalidates the AI brief even after a JSON round trip. */
export function adsChannelWizardSettingsMatchBrief(settings: AdsChannelWizardSettings, brief: AdsChannelDraft): boolean {
  if (settings.channel !== brief.channel) return false;
  switch (settings.channel) {
    case "linkedin": return brief.channel === "linkedin" && settings.objectiveType === brief.objectiveType && settings.format === brief.format && settings.targetingFacet === "titles" && settings.locale.country === brief.locale.country && settings.locale.language === brief.locale.language;
    case "tiktok": return brief.channel === "tiktok" && settings.objectiveType === brief.objectiveType && settings.format === brief.format && settings.targetingMode === "broad" && settings.placementIntent === brief.placementIntent && settings.optimizationIntent === brief.optimizationIntent && settings.destinationKind === brief.destinationKind;
    case "pinterest": return brief.channel === "pinterest" && settings.objectiveType === brief.objectiveType && settings.intendedPromotionType === brief.intendedPromotionType && settings.creativeType === (brief.creativeType || null) && settings.targetingMode === "interests" && settings.conversionEvent === (brief.conversionEvent || null);
    case "x": return brief.channel === "x" && settings.objective === brief.objective && settings.format === brief.format && settings.targetingMode === brief.targetingMode;
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function exactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function oneOf<const Values extends readonly string[]>(value: unknown, choices: Values): value is Values[number] {
  return typeof value === "string" && (choices as readonly string[]).includes(value);
}

function containsExternalRefs(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsExternalRefs);
  return Object.entries(value).some(([key, nested]) =>
    key.replace(/[_-]/g, "").toLowerCase() === "externalrefs" || containsExternalRefs(nested));
}

export function parseAdsChannelWizardSettings(
  value: unknown,
  channel: PlannedAdsChannel,
): { settings: AdsChannelWizardSettings | null; error: string | null } {
  if (value == null) return { settings: null, error: null };
  let json: string;
  try { json = JSON.stringify(value); }
  catch { return { settings: null, error: "Les réglages du canal ne sont pas un JSON valide." }; }
  if (!json || new TextEncoder().encode(json).length > 4_096) {
    return { settings: null, error: "Les réglages du canal sont trop volumineux." };
  }
  const raw = record(JSON.parse(json));
  if (containsExternalRefs(raw)) return { settings: null, error: "Les identifiants publicitaires externes sont interdits dans les réglages." };
  if (raw.channel !== channel || raw.schemaVersion !== 1) {
    return { settings: null, error: "Les réglages ne correspondent pas au canal ou à la version attendue." };
  }
  switch (channel) {
    case "linkedin": {
      const locale = record(raw.locale);
      const objective = raw.objectiveType;
      const formats = typeof objective === "string" && Object.hasOwn(LINKEDIN_WIZARD_FORMATS, objective)
        ? LINKEDIN_WIZARD_FORMATS[objective as keyof typeof LINKEDIN_WIZARD_FORMATS] as readonly string[] : [];
      if (!exactKeys(raw, ["schemaVersion", "channel", "objectiveType", "format", "targetingFacet", "locale"]) ||
          !formats.includes(String(raw.format)) || !oneOf(raw.targetingFacet, ["titles", "industries", "skills"] as const) ||
          !exactKeys(locale, ["country", "language"]) ||
          typeof locale.country !== "string" || !/^[A-Z]{2}$/.test(locale.country) ||
          typeof locale.language !== "string" || !/^[a-z]{2}$/.test(locale.language)) break;
      return { settings: raw as LinkedInWizardSettings, error: null };
    }
    case "tiktok":
      if (!exactKeys(raw, ["schemaVersion", "channel", "objectiveType", "format", "targetingMode", "placementIntent", "optimizationIntent", "destinationKind"]) ||
          !oneOf(raw.objectiveType, TIKTOK_WIZARD_OBJECTIVES) || raw.format !== "video" ||
          !oneOf(raw.targetingMode, ["broad", "interests"] as const) ||
          !oneOf(raw.placementIntent, ["automatic", "tiktok_only"] as const) ||
          !oneOf(raw.optimizationIntent, ["reach", "views", "clicks", "conversions", "leads", "engagement"] as const) ||
          !oneOf(raw.destinationKind, ["website", "instant_form", "profile"] as const) ||
          raw.optimizationIntent !== ({ REACH: "reach", VIDEO_VIEWS: "views", TRAFFIC: "clicks", WEB_CONVERSIONS: "conversions", LEAD_GENERATION: "leads", ENGAGEMENT: "engagement" } as const)[raw.objectiveType as (typeof TIKTOK_WIZARD_OBJECTIVES)[number]] ||
          (raw.objectiveType === "WEB_CONVERSIONS" && raw.destinationKind !== "website") ||
          (raw.destinationKind === "instant_form" && raw.objectiveType !== "LEAD_GENERATION") ||
          (raw.destinationKind === "profile" && !["REACH", "VIDEO_VIEWS", "ENGAGEMENT"].includes(raw.objectiveType as string))) break;
      return { settings: raw as TikTokWizardSettings, error: null };
    case "pinterest": {
      const catalog = raw.intendedPromotionType === "CATALOG";
      const conversion = raw.conversionEvent;
      const allowedEvents = raw.objectiveType === "SALES" ? ["CHECKOUT", "ADD_TO_CART"]
        : raw.objectiveType === "LEADS" ? ["SIGNUP", "LEAD"] : [];
      if (!exactKeys(raw, ["schemaVersion", "channel", "objectiveType", "intendedPromotionType", "creativeType", "targetingMode", "conversionEvent"]) ||
          !oneOf(raw.objectiveType, PINTEREST_WIZARD_OBJECTIVES) ||
          !oneOf(raw.intendedPromotionType, ["STANDARD_AD", "CATALOG"] as const) ||
          // Pinterest's objective simplification uses CATALOG for product
          // group promotions under CONSIDERATION or SALES. LEADS remains a
          // Pin-based STANDARD_AD flow even though it also carries conversion
          // metadata at ad-group level.
          (catalog && !["CONSIDERATION", "SALES"].includes(raw.objectiveType as string)) ||
          (catalog ? raw.creativeType !== null : !oneOf(raw.creativeType, ["REGULAR", "VIDEO", "MAX_VIDEO", "CAROUSEL"] as const)) ||
          (raw.objectiveType === "VIDEO_COMPLETION" && !["VIDEO", "MAX_VIDEO"].includes(String(raw.creativeType))) ||
          !oneOf(raw.targetingMode, ["interests", "keywords", "audiences"] as const) ||
          (allowedEvents.length ? !allowedEvents.includes(String(conversion)) : conversion !== null)) break;
      return { settings: raw as PinterestWizardSettings, error: null };
    }
    case "x":
      if (!exactKeys(raw, ["schemaVersion", "channel", "objective", "format", "targetingMode"]) ||
          !oneOf(raw.objective, X_WIZARD_OBJECTIVES) ||
          !oneOf(raw.format, ["text", "image", "video"] as const) ||
          !oneOf(raw.targetingMode, ["broad", "keywords", "interests", "follower_lookalikes"] as const) ||
          (raw.objective === "video_views" && raw.format !== "video")) break;
      return { settings: raw as XWizardSettings, error: null };
  }
  return { settings: null, error: "Les réglages natifs du canal sont incomplets ou incompatibles." };
}
