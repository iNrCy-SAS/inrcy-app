import {
  sanitizeBoosterSiteText,
  stripSiteTextFormatting,
  stripSiteTextFormattingPreserveLayout,
} from "@/lib/boosterFormatting";
import {
  buildUniqueBoosterHashtagLine,
  dedupeBoosterHashtagsInText,
  getBoosterPhoneDisplayValue,
  sanitizeBoosterPostForStructuredCta as sanitizeStructuredCtaPost,
  sanitizeGoogleBusinessPublicationText,
} from "@/lib/boosterPublicationSafety";
export {
  buildBoosterWhatsAppUrl,
  getBoosterWhatsAppPhoneFromUrl,
  isBoosterWhatsAppUrl,
  normalizeBoosterWhatsAppPhone,
} from "@/lib/boosterWhatsappCta";

export type BoosterChannelKey = "inrcy_site" | "site_web" | "inr_search" | "gmb" | "facebook" | "instagram" | "linkedin" | "tiktok" | "youtube_shorts" | "pinterest";
export type BoosterCtaMode = "none" | "website" | "call" | "message" | "custom";

export type BoosterPostLike = {
  title?: string | null;
  content?: string | null;
  cta?: string | null;
  hashtags?: string[] | null;
  ctaMode?: string | null;
  ctaUrl?: string | null;
  ctaPhone?: string | null;
};

export type BoosterCtaContext = {
  websiteUrl?: string | null;
  phone?: string | null;
};

export type BoosterGmbCallToAction =
  | { actionType: "LEARN_MORE"; url: string }
  | { actionType: "CALL" }
  | null;

const VALID_MODES: BoosterCtaMode[] = ["none", "website", "call", "message", "custom"];

function collapseWhitespace(input: string) {
  return String(input || "")
    .replace(/\r/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function ensureUrl(input: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^[^\s]+\.[^\s]+/.test(raw)) return `https://${raw}`;
  return "";
}

function normalizePhone(input: string) {
  return String(input || "")
    .trim()
    .replace(/[^\d+]/g, "")
    .slice(0, 24);
}

export function inferLegacyCtaMode(text: string): BoosterCtaMode {
  const value = collapseWhitespace(text).toLowerCase();
  if (!value) return "none";
  if (/(^|\b)(message|mp|dm|priv[ée]|mensaje|nachricht|bericht|messaggio)/.test(value)) return "message";
  if (/(^|\b)(appel|appelez|t[ée]l|t[ée]l[ée]phone|joindre|call|llamar|chiama|anrufen|bellen|ligar)/.test(value)) return "call";
  if (/(https?:\/\/|www\.|site|website|sitio|sito|webseite|orçamento|orcamento|offerte|quote|presupuesto|preventivo|angebot|en savoir plus|learn more|m[aá]s informaci[oó]n|scopri|mehr erfahren|meer informatie|saiba mais|d[ée]couvrir|voir|ver |devis)/.test(value)) return "website";
  return "custom";
}

export function getCtaMode(post: Partial<BoosterPostLike> | null | undefined): BoosterCtaMode {
  const raw = String(post?.ctaMode || "").trim() as BoosterCtaMode;
  if (VALID_MODES.includes(raw)) return raw;
  return inferLegacyCtaMode(String(post?.cta || ""));
}

export function getCtaLabel(post: Partial<BoosterPostLike> | null | undefined, mode = getCtaMode(post)) {
  const value = collapseWhitespace(String(post?.cta || ""));
  if (value) return value.slice(0, 180);
  switch (mode) {
    case "website":
      return "Voir le site";
    case "call":
      return "Appeler";
    case "message":
      return "Message privé";
    default:
      return "";
  }
}

export function getCtaWebsiteUrl(post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext) {
  return ensureUrl(String(post?.ctaUrl || "")) || ensureUrl(String(context?.websiteUrl || ""));
}

export function getCtaPhone(post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext) {
  return normalizePhone(String(post?.ctaPhone || "")) || normalizePhone(String(context?.phone || ""));
}

function joinCtaLabelAndValue(label: string, value: string, fallbackLabel: string) {
  const cleanLabel = collapseWhitespace(label || fallbackLabel);
  if (!cleanLabel) return value;
  if (/[:!?]$/u.test(cleanLabel)) return `${cleanLabel} ${value}`;
  return `${cleanLabel} : ${value}`;
}

export function sanitizeBoosterPostForStructuredCta<
  T extends Partial<BoosterPostLike> | null | undefined,
>(
  post: T,
  context?: BoosterCtaContext,
): T extends null | undefined ? BoosterPostLike : T {
  return sanitizeStructuredCtaPost(
    post,
    getCtaMode(post),
    context,
  ) as T extends null | undefined ? BoosterPostLike : T;
}

export function buildCtaTextForChannel(channel: BoosterChannelKey, post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext) {
  const mode = getCtaMode(post);
  const sanitizedPost = sanitizeStructuredCtaPost(post, mode, context);
  const label = getCtaLabel(sanitizedPost, mode);
  const websiteUrl = getCtaWebsiteUrl(post, context);
  const phone = getBoosterPhoneDisplayValue(post, context);

  if (channel === "gmb") {
    return mode === "custom" ? label : "";
  }

  switch (mode) {
    case "none":
      return "";
    case "website":
      if (!websiteUrl) return label && label !== "En savoir plus" ? label : "";
      return joinCtaLabelAndValue(label, websiteUrl, "En savoir plus");
    case "call":
      return phone ? joinCtaLabelAndValue(label, phone, "Appelez-nous") : label;
    case "message":
      return label || (channel === "instagram" || channel === "tiktok" || channel === "youtube_shorts" ? "Écrivez-nous en commentaire ou message privé." : "Envoyez-nous un message privé.");
    case "custom": {
      const customUrl = ensureUrl(String(post?.ctaUrl || ""));
      if (customUrl) return joinCtaLabelAndValue(label, customUrl, "En savoir plus");
      return label;
    }
    default:
      return label;
  }
}

function buildPrimaryBoosterText(channel: BoosterChannelKey, post: Partial<BoosterPostLike> | null | undefined) {
  const isSiteChannel = channel === "inrcy_site" || channel === "site_web" || channel === "inr_search";
  const title = collapseWhitespace(
    isSiteChannel
      ? sanitizeBoosterSiteText(post?.title || "")
      : stripSiteTextFormatting(post?.title || ""),
  );
  const content = isSiteChannel
    ? sanitizeBoosterSiteText(post?.content || "")
    : stripSiteTextFormattingPreserveLayout(post?.content || "");

  // The professional's edited paragraph layout is the source of truth for
  // social-channel bodies. Do not collapse repeated blank lines here.
  return dedupeBoosterHashtagsInText(
    [title, content].filter(Boolean).join("\n\n").trim(),
  );
}

export function buildBoosterMessage(channel: BoosterChannelKey, post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext) {
  const sanitizedPost = sanitizeBoosterPostForStructuredCta(post, context);
  const parts = [
    buildPrimaryBoosterText(channel, sanitizedPost),
    buildCtaTextForChannel(channel, sanitizedPost, context),
  ].filter(Boolean);
  return parts.join("\n\n").trim();
}

export function buildBoosterHashtagLine(
  post: Partial<BoosterPostLike> | null | undefined,
  baseText: string,
  maxTags = 8,
) {
  return buildUniqueBoosterHashtagLine(baseText, post?.hashtags, maxTags);
}

export function buildBoosterInstagramCaption(post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext) {
  const base = buildBoosterMessage("instagram", post, context);
  const tagLine = buildBoosterHashtagLine(post, base, 8);
  return (tagLine ? `${base}\n\n${tagLine}` : base).trim().slice(0, 2200);
}

export function buildBoosterGmbSummary(post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext) {
  const sanitizedPost = sanitizeBoosterPostForStructuredCta(post, context);
  const parts = [
    collapseWhitespace(stripSiteTextFormatting(sanitizedPost?.title || "")),
    stripSiteTextFormattingPreserveLayout(sanitizedPost?.content || ""),
    getCtaMode(sanitizedPost) === "custom" ? getCtaLabel(sanitizedPost, "custom") : "",
  ].filter(Boolean);
  return sanitizeGoogleBusinessPublicationText(parts.join("\n\n"))
    .trim()
    .slice(0, 1498);
}

export function getBoosterGmbCallToAction(post: Partial<BoosterPostLike> | null | undefined, context?: BoosterCtaContext): BoosterGmbCallToAction {
  const mode = getCtaMode(post);
  if (mode === "website") {
    const url = getCtaWebsiteUrl(post, context);
    if (!url) return null;
    return { actionType: "LEARN_MORE", url };
  }
  if (mode === "call") {
    if (!getCtaPhone(post, context)) return null;
    // Google Business déduit le numéro de la fiche et refuse une URL sur CALL.
    return { actionType: "CALL" };
  }
  if (mode === "custom") {
    const url = ensureUrl(String(post?.ctaUrl || ""));
    if (!url) return null;
    return { actionType: "LEARN_MORE", url };
  }
  return null;
}
