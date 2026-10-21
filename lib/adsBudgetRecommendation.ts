import type { AdsChannelId } from "./adsValidation.ts";

/** A reviewable test proposal, never a billing authorization or a performance forecast. */
export type AdsBudgetRecommendation = { dailyEuros: number; durationDays: number; rationale: string };

export function adsRequestedDurationDays(intent = ""): { days: number | null; error: string | null } {
  const text = intent.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const words: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4 };
  const values = [...text.matchAll(/\b(?:pour|sur|pendant)\s+(?:une duree de\s+)?(\d+|un|une|deux|trois|quatre)\s*(jours?|semaines?)\b/g)]
    .filter((match) => /\b(?:campagne|diffusion|budget|enveloppe|publicite)\b/.test(text.slice(Math.max(0, match.index! - 100), match.index))
      && !/\b(?:pas|sans|aucun\w*|exclu\w*)\b[^,;.!?]{0,35}$/.test(text.slice(Math.max(0, match.index! - 45), match.index)))
    .map((match) => (words[match[1]] ?? Number(match[1])) * (match[2].startsWith("semaine") ? 7 : 1));
  const days = [...new Set(values)];
  return days.length > 1 || days.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 90)
    ? { days: null, error: "Précisez une seule durée de diffusion de 1 à 90 jours." }
    : { days: days[0] ?? null, error: null };
}

export function normalizeAdsBudgetRecommendation(value: unknown, provider: AdsChannelId): AdsBudgetRecommendation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const dailyEuros = raw.dailyEuros, durationDays = raw.durationDays;
  const rationale = typeof raw.rationale === "string" ? raw.rationale.replace(/\u0000/g, "").trim() : "";
  if (typeof dailyEuros !== "number" || !Number.isFinite(dailyEuros) || dailyEuros < (provider === "openai" ? 15 : 5) || dailyEuros > 500
    || Math.abs(dailyEuros * 100 - Math.round(dailyEuros * 100)) > 0.000001
    || typeof durationDays !== "number" || !Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 90
    || rationale.length < 40 || rationale.length > 1_000) return null;
  return { dailyEuros, durationDays, rationale };
}

export const ADS_BUDGET_RECOMMENDATION_INSTRUCTIONS = `Ajoute obligatoirement budgetRecommendation:{dailyEuros:number,durationDays:integer,rationale:string}. Analyse séparément le budget et la durée de test pour ce canal : offre attestée, objectif, périmètre géographique, public, maturité et données de performance réellement disponibles. Ne reconduis pas automatiquement 10 € et sept jours et ne varie pas les chiffres sans raison. dailyEuros est une hypothèse quotidienne en euros avec deux décimales maximum, de 5 à 500 (15 à 500 pour ChatGPT Ads) ; durationDays est de 1 à 90 jours. Justifie en 40 à 1000 caractères le niveau de test et la durée choisis avec les faits du contexte, en langage métier. Sans historique de diffusion exploitable, présente une hypothèse de test à mesurer et ajuster, jamais un budget optimal, un CPC/CPA observé, un volume de ventes attendu ou une rentabilité garantie. Les noms de campagnes passées ne prouvent aucune performance. Respecte d’abord les montants, l’enveloppe totale, les dates et la durée explicitement demandés par le professionnel ; ne transforme jamais un total en montant quotidien. Si une enveloppe totale est imposée, dailyEuros reste un repère, pas un nouveau plafond de dépense. Les bornes réelles du compte seront contrôlées avant lancement. Tout budget reste modifiable et nécessite la confirmation du professionnel ; aucun budget supplémentaire n’est engagé par cette analyse.`;
