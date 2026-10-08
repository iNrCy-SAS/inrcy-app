import { normalizeLinkedInAudienceSuggestions, type LinkedInAudienceSuggestion, type LinkedInBudgetSuggestion } from "./adsLinkedInAudienceSuggestions.ts";
import { selectAdsPlanLocations } from "./adsPlanQuality.ts";

export type LinkedInAdsPlanIntent = {
  budget: LinkedInBudgetSuggestion | null;
  dailyEuros: number | null;
  budgetIssue: "conflicting_budget" | "combined_budget_unsupported" | "invalid_budget" | null;
  targetingSuggestions: LinkedInAudienceSuggestion[];
};

function key(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[‐‑–—]/g, "-");
}

function positiveMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].filter((match) => {
    const prefix = text.slice(Math.max(0, match.index! - 45), match.index).split(/[.!?;\n]/).at(-1) || "";
    return !/\b(?:pas|sans|exclu\w*|evit\w*|aucun\w*|ne cible\w*)\b[^,]{0,35}$/.test(prefix);
  });
}

/** Only explicit euro amounts and periods are controls. Prices and trial lengths are not budgets. */
export function readLinkedInAdsPlanIntent(intent?: string): LinkedInAdsPlanIntent {
  const text = key(intent || "");
  const amounts: { type: "daily" | "total"; value: number }[] = [];
  const totalMarker = /\b(?:total(?:e)?|enveloppe|global(?:e)?|au maximum|maximum|plafond)\b/g;
  const dailyMarker = /(?:\/\s*jour\b|\b(?:par jour|quotidien(?:ne)?|journalier(?:e)?)\b)/g;
  for (const match of positiveMatches(text, /\b(\d+(?:[ \u00a0]\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|euros?\b|eur\b)/g)) {
    const before = text.slice(Math.max(0, match.index! - 55), match.index).split(/[;!\n]/).at(-1) || "";
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 55).split(/[;!\n]/)[0];
    const lastBidMarker = [...before.matchAll(/\b(?:cpc(?: manuel)?|encheres?(?: manuelles?)?|cout cible(?: moyen)?|cost cap)\b/g)].at(-1)?.index ?? -1;
    const lastBudgetMarker = [...before.matchAll(/\b(?:budget|enveloppe|total(?:e)?|quotidien(?:ne)?)\b/g)].at(-1)?.index ?? -1;
    if (lastBidMarker > lastBudgetMarker) continue;
    if (/^\s*(?:\/\s*mois|par mois|mensuel(?:le)?)\b/.test(after)
      || /\b(?:coute|prix|tarif|abonnement)\b[^;!\n]{0,20}$/.test(before) && !/\bbudget\b[^;!\n]{0,25}$/.test(before)) continue;
    const distance = (marker: RegExp) => Math.min(
      ...[...before.matchAll(marker)].map((item) => before.length - item.index! - item[0].length),
      ...[...after.matchAll(marker)].map((item) => item.index!),
    );
    const dailyDistance = distance(dailyMarker);
    const totalDistance = distance(totalMarker);
    const durationEnvelope = /^\s*(?:pour|sur)\s+(?:une duree de\s+)?\d+\s*(?:jours?|semaines?|mois)\b/.test(after);
    const type = dailyDistance < totalDistance ? "daily" : totalDistance < Infinity || durationEnvelope ? "total" : null;
    if (!type) continue;
    const value = Number(match[1].replace(/[ \u00a0]/g, "").replace(",", "."));
    amounts.push({ type, value });
  }
  const totals = [...new Set(amounts.filter((item) => item.type === "total").map((item) => item.value))];
  const dailies = [...new Set(amounts.filter((item) => item.type === "daily").map((item) => item.value))];
  const invalid = amounts.some((item) => !Number.isFinite(item.value) || item.value < 5 || item.value > (item.type === "total" ? 45_000 : 500));
  const budgetIssue = totals.length > 1 || dailies.length > 1 ? "conflicting_budget" as const
    : totals.length && dailies.length ? "combined_budget_unsupported" as const : invalid ? "invalid_budget" as const : null;
  const budget = !budgetIssue && totals.length ? { type: "total" as const, totalEuros: totals[0] }
    : !budgetIssue && dailies.length ? { type: "daily" as const, totalEuros: null } : null;
  const targetingSuggestions: LinkedInAudienceSuggestion[] = [];
  const owners = positiveMatches(text, /\b(?:independants?|proprietaires? d[' ]entreprise|dirigeants?|entrepreneurs?|chefs? d[' ]entreprise)\b/g);
  if (owners.length) targetingSuggestions.push({ facet: "seniorities", terms: ["Owner"] });
  const sizes: string[] = [];
  if (positiveMatches(text, /\b(?:independants?|auto[- ]entrepreneurs?|micro[- ]entrepreneurs?)\b/g).length) sizes.push("Moi uniquement");
  const sizeRanges = positiveMatches(text, /\b(2\s*(?:-|a)\s*10|11\s*(?:-|a)\s*50|51\s*(?:-|a)\s*200|201\s*(?:-|a)\s*500|501\s*(?:-|a)\s*1000|1001\s*(?:-|a)\s*5000|5001\s*(?:-|a)\s*10000)\s*(?:salaries?|employes?|personnes?)\b/g);
  for (const match of sizeRanges) sizes.push(match[1].replace(/\s*(?:-|a)\s*/g, "-"));
  if (sizes.length) targetingSuggestions.push({ facet: "companySizes", terms: [...new Set(sizes)] });
  return { budget, dailyEuros: !budgetIssue ? dailies[0] ?? null : null, budgetIssue, targetingSuggestions };
}

const FRENCH_REGIONS = [
  "Hauts-de-France", "Île-de-France", "Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté",
  "Bretagne", "Centre-Val de Loire", "Corse", "Grand Est", "Normandie", "Nouvelle-Aquitaine",
  "Occitanie", "Pays de la Loire", "Provence-Alpes-Côte d’Azur", "Guadeloupe", "Martinique",
  "Guyane", "La Réunion", "Mayotte",
];

/** Geographic labels are human instructions, never proof that a provider supports a location. */
export function selectLinkedInAdsPlanLocations(input: {
  locations?: readonly string[]; city?: string; country?: string; intent?: string; locationsAreSelected?: boolean;
}): string[] {
  if (input.locationsAreSelected) return [...(input.locations || [])];
  const text = key(input.intent || "").replace(/['’]/g, " ").replace(/-/g, " ");
  const regions = FRENCH_REGIONS.filter((region) => {
    const label = key(region).replace(/['’]/g, " ").replace(/-/g, " ");
    return positiveMatches(text, new RegExp(`\\b${label.replace(/\s+/g, "\\s+")}\\b`, "g")).length > 0;
  });
  if (regions.length) return regions;
  const namedLocations = (input.locations || []).filter((location) => {
    const label = key(location.split(",")[0]).trim().replace(/-/g, " ");
    if (label.length < 3 || label === key(input.country || "") || label === "france") return false;
    return positiveMatches(text, new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "g")).length > 0;
  });
  return namedLocations.length ? [...new Set(namedLocations)] : selectAdsPlanLocations(input);
}

/** Explicit facets replace model guesses in that facet, including incompatible title guesses. */
export function mergeLinkedInAdsPlanAudienceSuggestions(value: unknown, intent: LinkedInAdsPlanIntent) {
  const explicit = intent.targetingSuggestions;
  const overridden = new Set(explicit.map((item) => item.facet));
  const inferred = normalizeLinkedInAudienceSuggestions(value).filter((item) => !overridden.has(item.facet)
    && !(overridden.has("seniorities") && item.facet === "titles"));
  return normalizeLinkedInAudienceSuggestions([...explicit, ...inferred]);
}
