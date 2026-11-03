import type { BoosterChannelKey, BoosterCtaMode } from "./boosterCta.ts";
import { normalizeBoosterWhatsAppPhone } from "./boosterWhatsappCta.ts";
import { normalizeSiteWebChannelMap } from "./siteWebChannel.ts";
import { isBoosterLinkCtaChoice, type BoosterLinkCtaChoice } from "./boosterCtaActions.ts";

/** iNr'Search is excluded because its publications do not expose a CTA. */
export const AI_CTA_CHANNELS = [
  { key: "site_web", label: "Site web" },
  { key: "gmb", label: "Google Business" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "threads", label: "Threads" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "x", label: "X" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube_shorts", label: "YouTube" },
  { key: "pinterest", label: "Pinterest" },
] as const satisfies ReadonlyArray<{ key: BoosterChannelKey; label: string }>;

export type AiCtaChannel = (typeof AI_CTA_CHANNELS)[number]["key"];
export type AiCtaChoice = "site" | "devis" | "appeler" | "message" | "whatsapp" | "custom" | BoosterLinkCtaChoice;
type ActiveAiChannelCtaConfig = {
  choice: AiCtaChoice;
  mode: Exclude<BoosterCtaMode, "none">;
  label: string;
  url: string;
  phone: string;
};
export type AiChannelCtaConfig = ActiveAiChannelCtaConfig | {
  choice: "none";
  mode: "none";
  label: string;
  url: string;
  phone: string;
};
export type AiChannelCtaMap = Partial<Record<AiCtaChannel, AiChannelCtaConfig>>;
export type AiChannelCtaDestinations = {
  preferredWebsiteUrl?: string | null;
  siteWebUrl?: string | null;
  phone?: string | null;
};

const CHOICE_MODES: Record<AiCtaChoice, ActiveAiChannelCtaConfig["mode"]> = {
  site: "website",
  devis: "website",
  appeler: "call",
  message: "message",
  whatsapp: "custom",
  custom: "custom",
  reserver: "website",
  commander: "website",
  acheter: "website",
  inscrire: "website",
};

// Keep this pure so account migration works in the browser and in Node's
// standalone setup checks. These are the CTA-capable modes of boosterCta.ts.
const MODES_BY_CHANNEL: Record<AiCtaChannel, readonly ActiveAiChannelCtaConfig["mode"][]> = {
  site_web: ["website", "call", "custom"],
  gmb: ["website", "call", "custom"],
  facebook: ["website", "call", "message", "custom"],
  instagram: ["website", "call", "message", "custom"],
  threads: ["website", "call", "message", "custom"],
  linkedin: ["website", "call", "message", "custom"],
  x: ["website", "call", "message", "custom"],
  tiktok: ["website", "call", "message", "custom"],
  youtube_shorts: ["website", "call", "custom"],
  pinterest: ["website", "call", "custom"],
};

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCtaWebsiteUrl(value: unknown) {
  const raw = cleanText(value, 2048);
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !/\s/u.test(raw) &&
      (url.hostname.includes(".") || url.hostname === "localhost")
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function normalizeCtaPhone(value: unknown) {
  const phone = cleanText(value, 48).replace(/[^\d+().\-\s]/g, "").trim();
  const digitCount = phone.replace(/\D/g, "").length;
  return digitCount >= 8 && digitCount <= 15 ? phone : "";
}

function resolveChoice(entry: Record<string, unknown>): AiCtaChoice | null {
  const choice = String(entry.choice || "");
  if (Object.prototype.hasOwnProperty.call(CHOICE_MODES, choice)) {
    return choice as AiCtaChoice;
  }
  // Compatibility with already-drafted mode-only selections.
  const mode = String(entry.mode || "");
  if (mode === "website") return "site";
  if (mode === "call") return "appeler";
  if (mode === "message") return "message";
  if (mode === "custom") return "custom";
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Accept only explicit, usable, channel-compatible selections; never invent a CTA. */
export function normalizeAiChannelCtaMap(value: unknown): AiChannelCtaMap {
  const source = normalizeSiteWebChannelMap(value);
  const normalized: AiChannelCtaMap = {};

  for (const { key } of AI_CTA_CHANNELS) {
    const entry = asRecord(source[key]);
    if (entry.choice === "none" || !entry.choice && entry.mode === "none") {
      normalized[key] = { choice: "none", mode: "none", label: "", url: "", phone: "" };
      continue;
    }
    const choice = resolveChoice(entry);
    if (!choice) continue;
    const mode = CHOICE_MODES[choice];
    if (!MODES_BY_CHANNEL[key].includes(mode)) continue;

    const url = normalizeCtaWebsiteUrl(entry.url);
    const phone = normalizeCtaPhone(entry.phone);
    if ((choice === "custom" || isBoosterLinkCtaChoice(choice)) && !url) continue;
    if (choice === "whatsapp" && phone && !normalizeBoosterWhatsAppPhone(phone)) continue;

    normalized[key] = {
      choice,
      mode,
      label: String(entry.label ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      url: mode === "website" || choice === "custom" ? url : "",
      phone: choice === "appeler" || choice === "whatsapp" ? phone : "",
    };
  }

  return normalized;
}

export function isAiChannelCtaComplete(
  channel: AiCtaChannel,
  config: AiChannelCtaConfig | undefined,
  destinations: AiChannelCtaDestinations | null | undefined,
): boolean {
  if (!config) return false;
  const normalized = normalizeAiChannelCtaMap({ [channel]: config })[channel];
  if (!normalized) return false;
  if (normalized.choice === "none") return true;
  if (isBoosterLinkCtaChoice(normalized.choice)) return Boolean(normalized.url);
  if (normalized.choice === "site" || normalized.choice === "devis") {
    const profileUrl = channel === "site_web"
        ? destinations?.siteWebUrl || destinations?.preferredWebsiteUrl
        : destinations?.preferredWebsiteUrl || destinations?.siteWebUrl;
    return Boolean(normalized.url || normalizeCtaWebsiteUrl(profileUrl));
  }
  if (normalized.choice === "appeler") {
    return Boolean(normalized.phone || normalizeCtaPhone(destinations?.phone));
  }
  if (normalized.choice === "whatsapp") {
    return Boolean(normalizeBoosterWhatsAppPhone(normalized.phone || destinations?.phone));
  }
  return true;
}

export function countConfiguredAiChannelCtas(value: unknown): number {
  return Object.values(normalizeAiChannelCtaMap(value)).filter(config => config.choice !== "none").length;
}

/** Fill only unset channels. An explicit choice, including none or an unfinished
 * custom configuration, always wins. Destinations remain profile-driven. */
export function resolveAiChannelCtaMap(
  value: unknown,
  destinations: AiChannelCtaDestinations | null | undefined,
): AiChannelCtaMap {
  const source = normalizeSiteWebChannelMap(value);
  const resolved = normalizeAiChannelCtaMap(source);
  const phone = normalizeCtaPhone(destinations?.phone);
  for (const { key } of AI_CTA_CHANNELS) {
    if (Object.hasOwn(source, key)) {
      // Keep a disabled marker for an invalid explicit setting. Otherwise a
      // second resolution (API → generator/editor) would mistake it for unset.
      resolved[key] ||= { choice: "none", mode: "none", label: "", url: "", phone: "" };
      continue;
    }
    const website = normalizeCtaWebsiteUrl(key === "site_web"
      ? destinations?.siteWebUrl || destinations?.preferredWebsiteUrl
      : destinations?.preferredWebsiteUrl || destinations?.siteWebUrl);
    if (website && MODES_BY_CHANNEL[key].includes("website")) {
      resolved[key] = { choice: "site", mode: "website", label: "", url: "", phone: "" };
    } else if (phone && MODES_BY_CHANNEL[key].includes("call")) {
      resolved[key] = { choice: "appeler", mode: "call", label: "", url: "", phone: "" };
    }
  }
  return resolved;
}
