import { resolveDirectoryProfession } from "./inrDirectoryCatalog.ts";
import { resolveProfessionalCompanyNameFromProfile } from "./professionalBusinessIdentity.ts";
import { isInrDirectoryEnabled } from "./inrDirectorySettings.ts";

export const NATIVE_CHANNEL_KEYS = ["inrbadge", "inr_search", "inr_directory"] as const;
export type NativeChannelKey = typeof NATIVE_CHANNEL_KEYS[number];
export type NativeChannelMissingField = "company" | "contact" | "profession" | "city" | "postalCode";
export type NativeChannelState = {
  requested: boolean; ready: boolean; published: boolean; pending: boolean;
  allowed: boolean; missingFields: NativeChannelMissingField[];
};
export type NativeChannelStates = Record<NativeChannelKey, NativeChannelState>;
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const validLink = (v: unknown) => { try { return ["http:", "https:"].includes(new URL(text(v)).protocol); } catch { return false; } };

export function getNativeChannelMissingFields(profileValue: unknown, businessValue: unknown, settingsValue: unknown) {
  const profile = record(profileValue), business = record(businessValue), settings = record(settingsValue);
  const company = Boolean(resolveProfessionalCompanyNameFromProfile(profile.company_legal_name));
  const contact = /\d{6}/.test(text(profile.phone).replace(/\D/g, "")) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(profile.contact_email)) ||
    ["site_web", "gmb", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x"].some(key => {
      const channel = record(settings[key]);
      return [channel.url, channel.profileUrl, channel.profile_url, channel.orgUrl, channel.channelUrl].some(validLink);
    });
  const badge: NativeChannelMissingField[] = [];
  if (!company) badge.push("company");
  if (!contact) badge.push("contact");
  const listing: NativeChannelMissingField[] = [];
  if (!company) listing.push("company");
  if (!resolveDirectoryProfession(text(business.sector)).profession) listing.push("profession");
  if (!text(profile.hq_city)) listing.push("city");
  if (!text(profile.hq_zip)) listing.push("postalCode");
  return { inrbadge: badge, inr_search: listing, inr_directory: [...listing] };
}

/** Activation consent is separate from publication readiness. Legacy public pages stay public. */
export function resolveNativeChannelStates(params: {
  profile: unknown; business: unknown; settings: unknown;
  allowed?: Partial<Record<NativeChannelKey, boolean>>;
}): NativeChannelStates {
  const root = record(params.settings), profile = record(params.profile);
  const badge = record(root.inrBadge), search = record(root.inrSearch), directory = record(root.inrDirectory);
  const missing = getNativeChannelMissingFields(profile, params.business, root);
  const legacyBadgeReady = ["first_name", "last_name", "company_legal_name", "phone", "contact_email", "hq_zip", "hq_city"].every(key => text(profile[key]));
  const requested = {
    inrbadge: badge.activationVersion === 1 ? badge.enabled === true : typeof badge.enabled === "boolean" ? badge.enabled : legacyBadgeReady,
    inr_search: search.activationVersion === 1 ? search.activationRequested === true : typeof search.activationRequested === "boolean" ? search.activationRequested : search.enabled === true,
    inr_directory: isInrDirectoryEnabled(root),
  };
  const nodes = { inrbadge: badge, inr_search: search, inr_directory: directory };
  return Object.fromEntries(NATIVE_CHANNEL_KEYS.map(key => {
    const allowed = params.allowed?.[key] !== false;
    const legacyPublished = nodes[key].activationVersion !== 1 && (key === "inrbadge" ? legacyBadgeReady : key === "inr_search" ? search.enabled === true : requested.inr_directory && !missing.inr_directory.filter(field => field !== "postalCode").length);
    const ready = legacyPublished || missing[key].length === 0;
    return [key, { requested: requested[key], ready, published: allowed && requested[key] && ready && (key !== "inr_search" || Boolean(text(search.slug))), pending: allowed && requested[key] && !ready, allowed, missingFields: ready ? [] : missing[key] }];
  })) as NativeChannelStates;
}

export function updateNativeChannelActivation(settingsValue: unknown, key: NativeChannelKey, enabled: boolean) {
  const root = record(settingsValue);
  // Preserve the directory opt-in before Search's effective publication changes.
  const directory = { ...record(root.inrDirectory), enabled: isInrDirectoryEnabled(root) };
  if (key === "inrbadge") return { ...root, inrDirectory: directory, inrBadge: { ...record(root.inrBadge), enabled, activationVersion: 1 } };
  if (key === "inr_directory") return { ...root, inrDirectory: { ...directory, enabled, activationVersion: 1 } };
  return { ...root, inrDirectory: directory, inrSearch: { ...record(root.inrSearch), activationRequested: enabled, activationVersion: 1 } };
}
