import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";

/**
 * These limits describe copy that the branded renderer can display in full.
 * They are validation limits, never instructions to slice a string.
 */
export const AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS = 120;
export const AI_MEDIA_VISIBLE_BODY_MAX_CHARACTERS = 78;
export const AI_MEDIA_VISIBLE_EYEBROW_MAX_CHARACTERS = 80;
export const AI_MEDIA_SPOKEN_LINE_MAX_CHARACTERS = 90;
export const AI_MEDIA_SPOKEN_LINE_MAX_WORDS = 14;

const DANGLING_COPY_WORDS = new Set([
  "a", "afin", "au", "aux", "avec", "car", "ce", "ces", "chez", "comme",
  "dans", "de", "des", "du", "en", "et", "la", "le", "les", "mais",
  "notre", "ou", "par", "pour", "que", "qui", "sans", "sur", "un", "une",
  "vers", "votre", "an", "and", "at", "by", "for", "from", "in", "of",
  "on", "or", "the", "to", "with", "con", "del", "el", "las", "los",
  "para", "por", "una", "y", "da", "della", "di", "e", "il", "per",
  "am", "auf", "der", "die", "das", "ein", "eine", "für", "im", "mit",
  "und", "von", "zu",
]);

export function normalizeAiMediaCopy(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/^[\s"'«»“”]+|[\s"'«»“”]+$/g, "")
    .replace(/#(?![\da-f]{3}(?:[\da-f]{3})?\b)|[*_`<>]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function copyWordSignature(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z]/g, "");
}

export function hasCompleteAiMediaVisibleCopy(value: unknown) {
  const normalized = normalizeAiMediaCopy(value);
  if (!normalized) return false;
  if (/(?:\.{3}|…)\s*$/u.test(normalized)) return false;
  if (/[,;:\-–—]\s*$/u.test(normalized)) return false;
  const lastWord = normalized
    .replace(/[.!?。！？]+$/u, "")
    .trim()
    .split(/\s+/u)
    .at(-1);
  return !DANGLING_COPY_WORDS.has(copyWordSignature(lastWord || ""));
}

/** Validate-or-reject: there is deliberately no truncation branch. */
export function acceptCompleteAiMediaVisibleCopy(value: unknown, maximum: number) {
  const normalized = normalizeAiMediaCopy(value);
  if (normalized.length > maximum) return "";
  return hasCompleteAiMediaVisibleCopy(normalized) ? normalized : "";
}

function comparableCopy(value: unknown) {
  return normalizeAiMediaCopy(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AI_MEDIA_COMMERCIAL_PRICE_PATTERN = String.raw`\d{1,4}(?:[.,]\d{1,2})?\s*(?:€|euros?)(?:\s*(?:HT|TTC|hors\s+taxes?|toutes\s+taxes(?:\s+comprises)?))?(?:\s*(?:\/|par)\s*(?:mois|ans?|années?|jours?|semaines?))?`;

export type AiMediaCommercialOfferTerm = {
  name: string;
  price: string;
};

function extractCommercialOfferName(prefix: string) {
  const normalized = normalizeAiMediaCopy(prefix);
  if (!normalized) return "";

  const offerMarker = /\b(?:packs?|forfaits?|formules?|offres?|abonnements?)\b/giu;
  const markers = Array.from(normalized.matchAll(offerMarker));
  const hasConnector = /\b(?:et|ou|versus|vs\.?)\b/iu.test(normalized);
  const hasPriceLead = /(?:\bau\s+prix\s+de|\bà|\bpour|:|=|[-–—])\s*$/iu.test(
    normalized
  );
  if (markers.length === 0 && !hasConnector && !hasPriceLead) return "";

  const lastMarker = markers.at(-1);
  let candidate = lastMarker?.index !== undefined
    ? normalized.slice(lastMarker.index + lastMarker[0].length)
    : normalized;
  candidate = candidate
    .replace(/\s*(?:au\s+prix\s+de|à|pour|:|=|[-–—])\s*$/iu, "")
    .split(/(?:[:,;]|\b(?:et|ou|versus|vs\.?)\b)/giu)
    .at(-1) || "";
  candidate = candidate
    .replace(/^(?:nos?|les?|des?|deux|trois|quatre|cinq)\s+/iu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’\-]+$/gu, "")
    .trim();

  const words = candidate.split(/\s+/u).filter(Boolean);
  if (candidate.length < 2 || candidate.length > 40 || words.length > 4) return "";
  if (
    /^(?:pack|forfait|formule|offre|abonnement|prix|tarif|comparaison)$/iu.test(
      candidate
    )
  ) {
    return "";
  }
  return candidate;
}

/**
 * Extrait les libellés et montants commerciaux tels qu'ils ont été fournis.
 * Une mention fiscale et sa périodicité restent atomiques : aucune branche ne
 * complète ni ne tronque une information absente du brief.
 */
export function extractAiMediaCommercialOfferTerms(value: unknown) {
  const source = normalizeAiMediaCopy(value);
  const prices: string[] = [];
  const offers: AiMediaCommercialOfferTerm[] = [];
  const priceRegex = new RegExp(`\\b${AI_MEDIA_COMMERCIAL_PRICE_PATTERN}`, "giu");
  let previousPriceEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = priceRegex.exec(source))) {
    const price = normalizeAiMediaCopy(match[0]);
    const name = extractCommercialOfferName(
      source.slice(previousPriceEnd, match.index)
    );
    if (price && !prices.some((item) => comparableCopy(item) === comparableCopy(price))) {
      prices.push(price);
    }
    if (
      name &&
      !offers.some(
        (item) =>
          comparableCopy(item.name) === comparableCopy(name) ||
          comparableCopy(item.price) === comparableCopy(price)
      )
    ) {
      offers.push({ name, price });
    }
    previousPriceEnd = match.index + match[0].length;
  }

  return { offers, prices };
}

function addProtectedTerm(target: string[], value: unknown) {
  const term = normalizeAiMediaCopy(value).replace(/[.!?。！？]+$/u, "").trim();
  if (term.length < 2 || term.length > AI_MEDIA_VISIBLE_TITLE_MAX_CHARACTERS) return;
  const comparable = comparableCopy(term);
  if (!comparable || target.some((item) => comparableCopy(item) === comparable)) return;
  target.push(term);
}

function extractQuotedTerms(source: string, target: string[]) {
  const quoted = /[«“"]([^»”"]{2,120})[»”"]/gu;
  let match: RegExpExecArray | null;
  while ((match = quoted.exec(source))) addProtectedTerm(target, match[1]);
}

function extractCapitalizedPhrases(source: string, target: string[]) {
  const properPhrase = /(?:^|[^\p{L}\p{N}])((?:[\p{Lu}][\p{L}\p{M}\p{N}'’.-]*)(?:\s+(?:(?:de|du|des|la|le|les|d['’]|l['’]|van|von|da|di|del|della|saint|sainte)\s+)?[\p{Lu}][\p{L}\p{M}\p{N}'’.-]*)+)/gu;
  let match: RegExpExecArray | null;
  while ((match = properPhrase.exec(source))) addProtectedTerm(target, match[1]);
}

function extractCommercialTerms(source: string, target: string[]) {
  const commercialValue =
    /\b\d{1,4}(?:[.,]\d{1,2})?\s*(?:%|jours?|mois|ans?)(?:\s*(?:\/|par)\s*(?:mois|an|année|jour))?/giu;
  const offerName =
    /\b(?:pack|forfait|formule|offre)\s+[\p{L}\p{M}\p{N}'’\-]{2,28}/giu;
  let match: RegExpExecArray | null;
  while ((match = commercialValue.exec(source))) addProtectedTerm(target, match[0]);
  while ((match = offerName.exec(source))) addProtectedTerm(target, match[0]);
  const extracted = extractAiMediaCommercialOfferTerms(source);
  for (const price of extracted.prices) addProtectedTerm(target, price);
  for (const offer of extracted.offers) addProtectedTerm(target, offer.name);
}

export function collectAiMediaProtectedTerms(args: {
  request: Pick<AiMediaGenerationRequest, "idea" | "aiInstruction" | "textKeywords">;
  profile: Pick<NormalizedAiGenerationProfile, "business">;
}) {
  const sources = [args.request.idea, args.request.aiInstruction, ...args.request.textKeywords]
    .map((value) => normalizeAiMediaCopy(value))
    .filter(Boolean);
  const sourceComparable = comparableCopy(sources.join(" "));
  const terms: string[] = [];

  for (const source of sources) {
    extractQuotedTerms(source, terms);
    extractCapitalizedPhrases(source, terms);
    extractCommercialTerms(source, terms);
  }

  for (const term of [
    args.profile.business.companyName,
    args.profile.business.city,
    ...args.profile.business.interventionZones,
  ]) {
    const comparable = comparableCopy(term);
    if (comparable && sourceComparable.includes(comparable)) addProtectedTerm(terms, term);
  }

  return terms
    .sort((left, right) => right.length - left.length)
    .filter((term, index, all) => {
      const comparable = comparableCopy(term);
      return !all.slice(0, index).some((larger) => comparableCopy(larger).includes(comparable));
    });
}

export function missingAiMediaProtectedTerms(
  value: unknown,
  protectedTerms: readonly string[],
) {
  const normalized = normalizeAiMediaCopy(value);
  return protectedTerms.filter(
    (term) => !normalized.includes(normalizeAiMediaCopy(term)),
  );
}

export function preservesAiMediaProtectedTerms(
  value: unknown,
  protectedTerms: readonly string[],
) {
  return missingAiMediaProtectedTerms(value, protectedTerms).length === 0;
}
