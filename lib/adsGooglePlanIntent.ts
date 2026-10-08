import { defaultGoogleDeliverySettings, googleAdsCalendarDate, type GoogleDeliverySettings } from "./adsGoogleCampaignSettings.ts";
import { googleAdsDateInAccount } from "./adsGoogleResources.ts";
import { readLinkedInAdsPlanIntent, selectLinkedInAdsPlanLocations } from "./adsLinkedInPlanIntent.ts";

export type GoogleBudgetSuggestion = { type: "daily" | "total"; dailyEuros: number | null; totalEuros: number | null; startDate: string | null; endDate: string | null };
export type GooglePlanIntentContext = { intent?: string; now?: string; timezone?: string };
function key(value: string) { return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/’/g, "'"); }
function positive(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].filter((match) => !/\b(?:pas|sans|aucun\w*|exclu\w*)\b[^,;.!?]{0,35}$/.test(text.slice(Math.max(0, match.index! - 45), match.index)));
}
const MONTHS: Record<string, number> = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
const DATE = `(?:(\\d{4}-\\d{2}-\\d{2})|(\\d{1,2})(?:er)?(?:\\s+(${Object.keys(MONTHS).join("|")})|[/-](\\d{1,2}))(?:[ /-]+(\\d{4}))?)`;
function requestedDate(match: RegExpMatchArray, year: number) {
  const value = match[1] || `${match[5] || year}-${String(MONTHS[match[3]] || Number(match[4])).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return googleAdsCalendarDate(value) ? value : null;
}
const addDays = (date: string, days: number) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

/** EUR budget parsing is shared with the proven human-constraint parser, never with model controls or platform IDs. */
export function readGoogleAdsPlanIntent(context: GooglePlanIntentContext): { budget: GoogleBudgetSuggestion | null; deliverySettings: GoogleDeliverySettings | null; error: string | null } {
  const fail = (error: string) => ({ budget: null, deliverySettings: null, error });
  const human = readLinkedInAdsPlanIntent(context.intent);
  if (human.budgetIssue) return fail(human.budgetIssue === "combined_budget_unsupported"
    ? "Google Search utilise soit un budget total, soit un budget quotidien. Précisez une seule de ces limites."
    : human.budgetIssue === "conflicting_budget" ? "Votre brief indique plusieurs budgets contradictoires. Précisez un seul montant."
      : "Précisez un budget quotidien entre 5 et 500 € ou un budget total entre 5 et 45 000 €.");
  const now = new Date(context.now || Date.now());
  let today: string;
  try { if (!Number.isFinite(now.getTime())) throw new Error(); today = googleAdsDateInAccount(context.timezone || "Europe/Paris", now); }
  catch { return fail("Le calendrier Google ne peut pas être calculé avec ce fuseau horaire."); }
  const text = key(context.intent || "");
  const year = Number(today.slice(0, 4));
  const starts = positive(text, new RegExp(`\\b(?:debut(?:er)?|demarr(?:age|er)|commenc(?:er|e)|a partir du|du)\\s*(?:le|du|:)?\\s*${DATE}`, "g"));
  const ends = positive(text, new RegExp(`\\b(?:fin(?:ir)?|termin(?:er|e)|jusqu'au|au)\\s*(?:le|:)?\\s*${DATE}`, "g"));
  const startDates = [...new Set(starts.map((match) => requestedDate(match, year)))];
  const endDates = [...new Set(ends.map((match) => requestedDate(match, year)))];
  if (startDates.includes(null) || endDates.includes(null) || startDates.length > 1 || endDates.length > 1) return fail("Les dates demandées pour Google Search sont invalides ou contradictoires.");
  const periods = positive(text, /\b(?:pour|sur|pendant)\s+(?:une duree de\s+)?(\d+)\s*(jours?|semaines?)\b/g)
    .filter((match) => /\b(?:campagne|diffusion|budget|enveloppe|publicite)\b/.test(text.slice(Math.max(0, match.index! - 100), match.index)));
  const durations = [...new Set(periods.map((match) => Number(match[1]) * (match[2].startsWith("semaine") ? 7 : 1)))];
  if (durations.some((duration) => !Number.isSafeInteger(duration) || duration < 1 || duration > 90)) return fail("Choisissez une période Google Search de 1 à 90 jours.");
  if (durations.length > 1) return fail("Votre brief indique plusieurs durées de diffusion contradictoires.");
  const startDate = startDates[0] || today;
  const endDate = endDates[0] || addDays(startDate, (durations[0] || 7) - 1);
  if (startDate < today || endDate < startDate || endDate > addDays(today, 90)) return fail("Le calendrier Google doit être futur, la fin doit suivre le début, dans les 90 prochains jours.");
  const days = (Date.parse(endDate + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / 86400000 + 1;
  if (durations[0] && days !== durations[0]) return fail("La durée et les dates de diffusion Google demandées se contredisent.");
  const type = human.budget?.type || "daily";
  if (days < (type === "total" ? 3 : 1) || days > 90) return fail(type === "total" ? "Un budget total Google Search requiert une période de 3 à 90 jours." : "Choisissez une période Google Search de 1 à 90 jours.");
  const settings = defaultGoogleDeliverySettings();
  settings.startDate = startDate;
  settings.budget = { type, totalEuros: type === "total" ? human.budget?.totalEuros || null : null };
  return { budget: { type, dailyEuros: type === "daily" ? human.dailyEuros || 10 : null, totalEuros: settings.budget.totalEuros, startDate, endDate }, deliverySettings: settings, error: null };
}

/** Human regions/cities stay labels until Google's own lookup verifies the exact native resource. */
export const selectGoogleAdsPlanLocations = selectLinkedInAdsPlanLocations;
