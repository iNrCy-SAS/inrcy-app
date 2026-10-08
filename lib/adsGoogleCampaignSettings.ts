export const GOOGLE_KEYWORD_MATCH_TYPES = ["PHRASE", "EXACT", "BROAD"] as const;
export type GoogleKeywordMatchType = typeof GOOGLE_KEYWORD_MATCH_TYPES[number];
export type GoogleDeliverySettings = {
  keywordMatchType: GoogleKeywordMatchType;
  negativeKeywordMatchType: GoogleKeywordMatchType;
  geoTargetType: "PRESENCE" | "PRESENCE_OR_INTEREST";
  startDate: string | null;
  budget: { type: "daily" | "total"; totalEuros: number | null };
  bidding: { manualCpcEuros: number | null; cpcBidCeilingEuros: number | null; targetCpaEuros: number | null; targetRoas: number | null };
  responsiveSearchAd: { path1: string; path2: string };
  /** Search inherits verified account goals; a human goal label is not an API conversion selection. */
  conversions: { mode: "account_defaults" };
};

export function defaultGoogleDeliverySettings(): GoogleDeliverySettings {
  return {
    keywordMatchType: "PHRASE", negativeKeywordMatchType: "BROAD", geoTargetType: "PRESENCE", startDate: null,
    budget: { type: "daily", totalEuros: null },
    bidding: { manualCpcEuros: null, cpcBidCeilingEuros: null, targetCpaEuros: null, targetRoas: null },
    responsiveSearchAd: { path1: "", path2: "" }, conversions: { mode: "account_defaults" },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function known(value: unknown, keys: string[]) {
  const result = record(value);
  return result && Object.keys(result).every((key) => keys.includes(key)) ? result : null;
}
export function googleAdsTextLength(value: string): number {
  // Google counts double-width scripts twice; count Unicode code points rather than UTF-16 surrogates.
  return [...value].reduce((length, char) => length + (/^[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]$/u.test(char) ? 2 : 1), 0);
}
export function googleAdsCalendarDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

export function normalizeGoogleDeliverySettings(value: unknown): { settings: GoogleDeliverySettings | null; error: string | null } {
  if (value == null) return { settings: null, error: null };
  const error = (message: string) => ({ settings: null, error: message });
  const raw = known(value, ["keywordMatchType", "negativeKeywordMatchType", "geoTargetType", "startDate", "budget", "bidding", "responsiveSearchAd", "conversions"]);
  if (!raw) return error("Les réglages Google Search sont invalides.");
  const defaults = defaultGoogleDeliverySettings();
  const keywordMatchType = raw.keywordMatchType ?? defaults.keywordMatchType;
  const negativeKeywordMatchType = raw.negativeKeywordMatchType ?? defaults.negativeKeywordMatchType;
  if (!GOOGLE_KEYWORD_MATCH_TYPES.includes(keywordMatchType as GoogleKeywordMatchType) || !GOOGLE_KEYWORD_MATCH_TYPES.includes(negativeKeywordMatchType as GoogleKeywordMatchType)) return error("Choisissez une correspondance de mots-clés Google valide.");
  const geoTargetType = raw.geoTargetType ?? defaults.geoTargetType;
  if (geoTargetType !== "PRESENCE" && geoTargetType !== "PRESENCE_OR_INTEREST") return error("Choisissez une option géographique Google valide.");
  const startDate = raw.startDate ?? null;
  if (startDate !== null && !googleAdsCalendarDate(startDate)) return error("La date de début Google est invalide.");
  const budget = known(raw.budget ?? defaults.budget, ["type", "totalEuros"]);
  if (!budget || !["daily", "total"].includes(String(budget.type))) return error("Choisissez un type de budget Google valide.");
  const totalEuros = budget.totalEuros ?? null;
  if (totalEuros !== null && (typeof totalEuros !== "number" || !Number.isFinite(totalEuros) || totalEuros < 5 || totalEuros > 45000 || Math.abs(Math.round(totalEuros * 100) - totalEuros * 100) > 0.000001)) return error("Le budget total Google doit être compris entre 5 et 45 000 €, avec deux décimales maximum.");
  if (budget.type === "total" && totalEuros === null) return error("Renseignez l’enveloppe totale Google.");
  const bidding = known(raw.bidding ?? defaults.bidding, Object.keys(defaults.bidding));
  if (!bidding) return error("Les enchères Google sont invalides.");
  const normalizedBidding = { ...defaults.bidding };
  for (const key of Object.keys(defaults.bidding) as (keyof typeof normalizedBidding)[]) {
    const amount = bidding[key] ?? null;
    const max = key === "targetRoas" ? 1000 : key === "targetCpaEuros" ? 45000 : 500;
    if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0.01 || amount > max || (key !== "targetRoas" && Math.abs(Math.round(amount * 100) - amount * 100) > 0.000001))) return error("Les montants d’enchères Google doivent être positifs et valides ; les montants en euros ont deux décimales maximum.");
    normalizedBidding[key] = amount as number | null;
  }
  const rsa = known(raw.responsiveSearchAd ?? defaults.responsiveSearchAd, ["path1", "path2"]);
  if (!rsa) return error("Les chemins affichés Google sont invalides.");
  const paths = { path1: "", path2: "" };
  for (const key of ["path1", "path2"] as const) {
    if (rsa[key] != null && typeof rsa[key] !== "string") return error("Les chemins affichés Google sont invalides.");
    paths[key] = String(rsa[key] ?? "").trim();
    if (googleAdsTextLength(paths[key]) > 15 || /[\/?#\r\n]/.test(paths[key])) return error("Chaque chemin affiché Google doit contenir au plus 15 caractères, sans séparateur d’URL.");
  }
  const conversions = known(raw.conversions ?? defaults.conversions, ["mode"]);
  if (!conversions || conversions.mode !== "account_defaults") return error("Google Search utilise les objectifs de conversion vérifiés du compte. Aucun identifiant de conversion ne peut être inventé.");
  return { settings: { keywordMatchType: keywordMatchType as GoogleKeywordMatchType, negativeKeywordMatchType: negativeKeywordMatchType as GoogleKeywordMatchType, geoTargetType, startDate: startDate as string | null, budget: { type: budget.type as "daily" | "total", totalEuros: totalEuros as number | null }, bidding: normalizedBidding, responsiveSearchAd: paths, conversions: { mode: "account_defaults" } }, error: null };
}

export function googleSearchKeyword(value: string, defaultMatchType: GoogleKeywordMatchType) {
  let text = value.trim();
  let matchType = defaultMatchType;
  if (text.startsWith("[") && text.endsWith("]")) { text = text.slice(1, -1).trim(); matchType = "EXACT"; }
  else if (text.startsWith('"') && text.endsWith('"')) { text = text.slice(1, -1).trim(); matchType = "PHRASE"; }
  if (!text || text.length > 80 || text.split(/\s+/).length > 10 || /[\[\]"\r\n]/.test(text)) throw new Error("Chaque mot-clé Google doit contenir au plus 80 caractères et 10 mots. Utilisez [exact] ou \"expression\" uniquement autour d’un mot-clé complet.");
  return { text, matchType };
}

export function googleSearchNativeBidding(strategy: string, settings?: GoogleDeliverySettings | null): Record<string, object> | null {
  const euros = (amount: number) => String(Math.round(amount * 100) * 10000);
  if (strategy === "maximize_clicks") return { targetSpend: { ...(settings?.bidding.cpcBidCeilingEuros != null ? { cpcBidCeilingMicros: euros(settings.bidding.cpcBidCeilingEuros) } : {}) } };
  if (strategy === "maximize_conversions" || strategy === "target_cpa" && settings?.bidding.targetCpaEuros != null) return { maximizeConversions: { ...(settings?.bidding.targetCpaEuros != null ? { targetCpaMicros: euros(settings.bidding.targetCpaEuros) } : {}) } };
  if (strategy === "maximize_value" || strategy === "target_roas" && settings?.bidding.targetRoas != null) return { maximizeConversionValue: { ...(settings?.bidding.targetRoas != null ? { targetRoas: settings.bidding.targetRoas } : {}) } };
  if (strategy === "manual_review" && settings?.bidding.manualCpcEuros != null) return { manualCpc: {} };
  return null;
}

export function googleSearchLocalIssue(draft: { campaignType: string; bidStrategy: string; endDate: string; headlines: string[]; descriptions: string[]; keywords: string[]; negativeKeywords: string[]; googleDeliverySettings?: GoogleDeliverySettings }): string | null {
  if (draft.campaignType !== "search") return "La publication Google prend en charge le Réseau de recherche uniquement.";
  const parsed = normalizeGoogleDeliverySettings(draft.googleDeliverySettings);
  if (parsed.error) return parsed.error;
  if (!googleSearchNativeBidding(draft.bidStrategy, parsed.settings)) return "Choisissez une stratégie Google Search prise en charge et renseignez l’enchère CPC si elle est manuelle.";
  if (parsed.settings?.startDate && parsed.settings.startDate > draft.endDate) return "Le début de diffusion Google doit précéder la fin de campagne.";
  if (draft.headlines.length < 3 || draft.headlines.length > 15 || draft.descriptions.length < 2 || draft.descriptions.length > 4 || draft.headlines.some((text) => !text.trim() || googleAdsTextLength(text) > 30) || draft.descriptions.some((text) => !text.trim() || googleAdsTextLength(text) > 90)) return "Google Search requiert 3 à 15 titres de 30 caractères et 2 à 4 descriptions de 90 caractères maximum, en comptant les caractères larges deux fois.";
  try { for (const keyword of draft.keywords) googleSearchKeyword(keyword, parsed.settings?.keywordMatchType || "PHRASE"); for (const keyword of draft.negativeKeywords) googleSearchKeyword(keyword, parsed.settings?.negativeKeywordMatchType || "BROAD"); } catch (error) { return error instanceof Error ? error.message : "Vérifiez les mots-clés Google."; }
  return null;
}
