import { getJobLabel } from "./activityCatalog.ts";
import { decodeBusinessSector, getActivitySectorLabel, isActivitySectorCategory } from "./activitySectors.ts";
import { getInrBadgeLocale, normalizeInrBadgeLanguage, type InrBadgeLanguageCode } from "./inrBadgeLanguage.ts";

export const INRBADGE_PRESENTATION_MAX_CHARACTERS = 150;

const labels: Record<InrBadgeLanguageCode, { activity: string; fallback: string }> = {
  fr: { activity: "Notre activité :", fallback: "Découvrez notre activité et contactez-nous." },
  en: { activity: "Our business:", fallback: "Discover our business and get in touch." },
  es: { activity: "Nuestra actividad:", fallback: "Descubra nuestra actividad y contacte con nosotros." },
  it: { activity: "La nostra attività:", fallback: "Scopri la nostra attività e contattaci." },
  de: { activity: "Unser Tätigkeitsbereich:", fallback: "Entdecken Sie unser Unternehmen und kontaktieren Sie uns." },
  nl: { activity: "Onze activiteit:", fallback: "Ontdek ons bedrijf en neem contact op." },
  pt: { activity: "A nossa atividade:", fallback: "Conheça a nossa atividade e entre em contacto." },
  th: { activity: "บริการของเรา:", fallback: "ทำความรู้จักธุรกิจของเราและติดต่อเรา" },
  zh: { activity: "我们的业务：", fallback: "了解我们的业务，欢迎联系我们。" },
};

const text = (value: unknown) => typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\s+/gu, " ").trim() : "";
const length = (value: string) => Array.from(value).length;
const reporting = /^(?:selon\b|d['’]apres\b|le site(?:\s+officiel)?\b|les informations?\s+(?:du|de la)\b|the (?:official )?website\b|according to\b|segun\b|el sitio\b|secondo\b|il sito\b|laut\b|die website\b|volgens\b|de website\b|segundo\b|o site\b)/u;
const address = /\b\d+[a-z]?\s+(?:bis\s+|ter\s+)?(?:rue|avenue|boulevard|chemin|route|impasse|place|allee|street|road|lane|drive|calle|avenida|via|viale|rua|strasse|straat)\b|\b(?:rue|avenue|street|road|calle|via|rua|strasse|straat)\b.{0,60}\b\d+\b/u;

function sentenceEnding(value: string, language: InrBadgeLanguageCode): string {
  if (/[.!?。！？][)\]"'»”’]*$/u.test(value) || language === "th") return value;
  return `${value}${language === "zh" ? "。" : "."}`;
}

/** Remove identified dependent location/purpose clauses, never a character
 * prefix. Every surviving phrase keeps its source wording and activity. */
function presentationClause(sentence: string): string {
  const reduced = sentence
    .replace(/\s+(?:permettant|allowing|enabling|permitiendo|permitindo|consentendo)\b[\s\S]*$/iu, "")
    .replace(/(?:,\s*|\s+)(?:qui permet\w*|que permite\w*|che permette\w*|waarmee|waardoor)\b[\s\S]*$/iu, "")
    .replace(/(?:,\s*|\s+)(?:implantée?|basée?|située?|installée?|localisée?)\s+(?:à|au|aux|en|dans|près de)\s+[\s\S]*$/iu, "")
    .replace(/(?:,\s*|\s+)(?:(?:is\s+)?(?:based|located|situated|headquartered))\s+(?:at|in|on|near)\s+[\s\S]*$/iu, "")
    .replace(/(?:,\s*|\s+)(?:con sede|ubicad[ao]s?|situad[ao]s?|sediad[ao]s?|localizad[ao]s?)\s+(?:en|a|in|em|no|na)\s+[\s\S]*$/iu, "")
    .replace(/(?:,\s*|\s+)(?:mit sitz|ansässig|gevestigd)\s+(?:in|an|aan|op)\s+[\s\S]*$/iu, "")
    .trim();
  // A paired comma can delimit an incise followed by the real main clause.
  // Do not drop that clause or turn a bare subject into a complete sentence.
  return reduced !== sentence && (reduced.split(/\s+/u).length < 3 || sentence.slice(reduced.length).replace(/^,\s*/u, "").includes(",")) ? sentence : reduced;
}

function usefulPhrase(value: string, language: InrBadgeLanguageCode): string {
  const normalized = value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (length(value) < 8 || !/\p{L}/u.test(value) || reporting.test(normalized) || address.test(normalized)
    || /^(?:notre|votre|cette|the|our|this)\s+(?:entreprise|societe|plateforme|application|company|platform|business)[.!?]*$/u.test(normalized)
    || /…|\.{2,}$/u.test(value) || /[,;:–—-]$/u.test(value)
    || /\b(?:et|ou|and|or|de|du|des|pour|avec|en|dans|of|for|with|und|oder|y|e|con)\s*[.!?]?$/iu.test(value)) return "";
  const completed = sentenceEnding(value, language);
  return length(completed) <= INRBADGE_PRESENTATION_MAX_CHARACTERS ? completed : "";
}

/** Public card projection only. The full business description and identity
 * remain their original stored fields; no model, write or inferred service. */
export function getInrBadgePresentation(input: { description?: unknown; sector?: unknown; language?: unknown }): string {
  const language = normalizeInrBadgeLanguage(input.language);
  const description = text(input.description);
  const sentences = new Intl.Segmenter(getInrBadgeLocale(language), { granularity: "sentence" }).segment(description);
  let prefix = "";
  for (const { segment } of sentences) {
    const sentence = `${prefix}${text(segment)}`;
    if (/(?:\b(?:M|Mme|Mlle|Mr|Mrs|Ms|Dr|Prof|St|Ste|Inc|Ltd|Co)|\bS\.A(?:\.S|\.R\.L)?)\.$/u.test(sentence)) { prefix = `${sentence} `; continue; }
    prefix = "";
    const candidate = usefulPhrase(sentence, language) || usefulPhrase(presentationClause(sentence), language);
    if (candidate) return candidate;
  }
  const rawSector = text(input.sector);
  if (rawSector) {
    const decoded = decodeBusinessSector(rawSector);
    const profession = isActivitySectorCategory(decoded.profession) ? "" : getJobLabel(decoded.sectorCategory, decoded.profession) || decoded.profession;
    const sector = decoded.sectorCategory !== "autre" ? getActivitySectorLabel(decoded.sectorCategory) : "";
    for (const activity of [profession, sector]) {
      // Unknown machine codes and paragraphs are not human activity labels.
      if (!activity || /[_\[\]<>]|[.!?。！？]/u.test(activity)) continue;
      const candidate = usefulPhrase(`${labels[language].activity} ${activity}`, language);
      if (candidate) return candidate;
    }
  }
  return labels[language].fallback;
}
