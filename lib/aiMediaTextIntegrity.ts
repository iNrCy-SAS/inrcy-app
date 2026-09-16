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
