import { getCtaMode, getCtaWebsiteUrl, getCtaPhone, isBoosterCtaModeSupportedForChannel, type BoosterChannelKey, type BoosterPostLike } from "./boosterCta";

export type InrAssistantPublicationCtaPatch = Partial<Pick<BoosterPostLike, "cta" | "ctaMode" | "ctaUrl" | "ctaPhone" | "ctaAction">>;
/** Native per-publication fields, no global profile fallback or default write. */
export function parseInrAssistantPublicationCtaPatch(value: unknown): InrAssistantPublicationCtaPatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>, keys = Object.keys(input);
  if (!keys.length || keys.some(key => !["cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].includes(key)) || keys.some(key => typeof input[key] !== "string" || String(input[key]).length > (key === "ctaUrl" ? 2000 : key === "cta" ? 300 : 80))
    || input.ctaMode !== undefined && !["none", "website", "call", "message", "custom"].includes(String(input.ctaMode)) || input.ctaAction !== undefined && !["", "BOOK", "ORDER", "SHOP", "SIGN_UP"].includes(String(input.ctaAction))) return null;
  return Object.fromEntries(keys.map(key => [key, String(input[key]).trim()])) as InrAssistantPublicationCtaPatch;
}
export function isInrAssistantPublicationCtaPatchValid(channel: BoosterChannelKey, current: BoosterPostLike, patch: InrAssistantPublicationCtaPatch): boolean {
  const merged = { ...current, ...patch }, mode = getCtaMode(merged);
  return isBoosterCtaModeSupportedForChannel(channel, mode) && (!["website", "custom"].includes(mode) || !!getCtaWebsiteUrl(merged)) && (mode !== "call" || !!getCtaPhone(merged));
}
