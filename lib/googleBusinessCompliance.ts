import { stripSiteTextFormatting } from "@/lib/boosterFormatting";
import { limitBoosterGeneratedTitle } from "@/lib/boosterChannelRules";

export type GmbDraft = {
  title: string;
  content: string;
  cta: string;
  hashtags?: string[];
};

function collapseWhitespace(input: string) {
  return String(input || "")
    .replace(/\r/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/ +/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripPhones(input: string) {
  return input
    .replace(/(?:\+33|0)\s*(?:\(0\)\s*)?(?:[1-9](?:[ .-]*\d{2}){4})/g, " ")
    .replace(/\b\d{2}(?:[ .-]*\d{2}){4}\b/g, " ");
}

function stripEmails(input: string) {
  return input.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
}

function stripUrls(input: string) {
  return input.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
}

function stripHashtags(input: string) {
  return input.replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, " ");
}

function softenPromotionalLanguage(input: string) {
  return input
    .replace(/\b(?:100\s*%\s*)?gratuit(?:e|s)?\b/gi, "")
    .replace(/\b(?:offre|promo(?:tion)?|remise|r[ée]duction|soldes?|bon plan|exceptionnel(?:le)?|exclusive?)\b/gi, "")
    .replace(/\b(?:profitez(?:-en)?|r[ée]servez vite|cliquez ici|appelez-nous|appelez nous|contactez-nous|contactez nous)\b/gi, "")
    .replace(/\b(?:1er|premier) mois offert\b/gi, "")
    .replace(/\bessai gratuit\b/gi, "découverte")
    .replace(/!{2,}/g, "!");
}

function sanitizeText(input: string) {
  return collapseWhitespace(
    softenPromotionalLanguage(stripHashtags(stripUrls(stripEmails(stripPhones(stripSiteTextFormatting(input)))))),
  );
}

function sanitizeCta(input: string) {
  const cleaned = sanitizeText(input).slice(0, 80);
  const lower = cleaned.toLowerCase();
  if (!cleaned) return "En savoir plus";
  if (
    /(?:appelez|contact|devis|gratuit|offert|promo|remise|r[ée]duction|r[ée]servez|cliquez)/i.test(cleaned) ||
    lower.includes("@")
  ) {
    return "En savoir plus";
  }
  return cleaned;
}

export function sanitizeGmbGeneratedPost(post: Partial<GmbDraft> | null | undefined): GmbDraft {
  const title = limitBoosterGeneratedTitle(
    "gmb",
    sanitizeText(String(post?.title || "")),
  );
  const content = sanitizeText(String(post?.content || "")).slice(0, 2000);
  const cta = sanitizeCta(String(post?.cta || ""));
  return {
    title,
    content,
    cta,
    hashtags: [],
  };
}

export function buildGmbSummary(post: Partial<GmbDraft> | null | undefined) {
  const safe = sanitizeGmbGeneratedPost(post);
  const parts = [safe.title, safe.content, safe.cta].filter(Boolean);
  return collapseWhitespace(parts.join("\n\n")).slice(0, 1498);
}
