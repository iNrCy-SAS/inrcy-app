import { defaultPinterestDeliverySettings, normalizePinterestDeliverySettings, type PinterestDeliverySettings } from "./adsPinterestCampaignSettings.ts";
import { readLinkedInAdsPlanIntent, selectLinkedInAdsPlanLocations } from "./adsLinkedInPlanIntent.ts";
import { readLinkedInHumanDeliveryConstraints } from "./adsLinkedInPlanDelivery.ts";

export type PinterestBudgetSuggestion = { type: "daily" | "total"; dailyEuros: number | null; totalEuros: number | null; startAt: string | null; endAt: string | null };
type Context = { intent?: string; now?: string; timezone?: string; objectiveType?: string };
/** Human budgets and instants override model guesses. No provider ID or conversion event is generated. */
export function readPinterestAdsPlanIntent(context: Context): { budget: PinterestBudgetSuggestion | null; deliverySettings: PinterestDeliverySettings | null; error: string | null } {
  const fail = (error: string) => ({ budget: null, deliverySettings: null, error });
  const human = readLinkedInAdsPlanIntent(context.intent);
  if (human.budgetIssue) return fail(human.budgetIssue === "combined_budget_unsupported" ? "Pinterest utilise une enveloppe totale ou un budget quotidien. Précisez une seule limite." : human.budgetIssue === "conflicting_budget" ? "Votre brief indique plusieurs budgets Pinterest contradictoires." : "Précisez un budget quotidien entre 5 et 500 € ou total entre 5 et 45 000 €.");
  const dates = readLinkedInHumanDeliveryConstraints(context);
  if (dates.error) return fail(dates.error.replace(/LinkedIn/g, "Pinterest"));
  const now = Date.parse(context.now || new Date().toISOString());
  if (!Number.isFinite(now)) return fail("La date de référence Pinterest est invalide.");
  const text = (context.intent || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const positive = (pattern: RegExp) => [...text.matchAll(pattern)].filter((match) => !/\b(?:pas|sans|aucun\w*|exclu\w*)\b[^,;.!?]{0,35}$/.test(text.slice(Math.max(0, match.index! - 45), match.index)));
  const periods = positive(/\b(?:pour|sur|pendant)\s+(?:une duree de\s+)?(\d+)\s*(jours?|semaines?)\b/g).filter((match) => /\b(?:campagne|diffusion|budget|enveloppe|publicite)\b/.test(text.slice(Math.max(0, match.index! - 100), match.index)));
  const durations = [...new Set(periods.map((match) => Number(match[1]) * (match[2].startsWith("semaine") ? 7 : 1)))];
  if (durations.length > 1 || durations.some((days) => !Number.isSafeInteger(days) || days < 1 || days > 90)) return fail("Choisissez une seule durée Pinterest de 1 à 90 jours.");
  const startAt = dates.constraints.budget.startAt ?? null;
  const start = startAt ? Date.parse(startAt) : now;
  const endAt = dates.constraints.budget.endAt || new Date(start + (durations[0] || 7) * 86400000).toISOString();
  const end = Date.parse(endAt);
  if (start < now - 60000 || end <= Math.max(start, now) || end > now + 90 * 86400000) return fail("Le calendrier Pinterest doit être futur, la fin après le début, dans les 90 prochains jours.");
  if (durations[0] && dates.constraints.budget.endAt && Math.abs((end - start) / 86400000 - durations[0]) > 1) return fail("Les dates et la durée Pinterest demandées se contredisent.");
  const settings = defaultPinterestDeliverySettings(context.objectiveType);
  settings.budget = { type: human.budget?.type || "daily", totalEuros: human.budget?.totalEuros || null, flexibleDaily: /\bbudget quotidien flexible\b/.test(text), startAt, endAt };
  const manuals = positive(/\b(?:enchere maximale|max_bid|max bid|cpc manuel|cpm manuel|encheres? manuelles?)\b/g);
  const automatics = positive(/\b(?:encheres? automatiques?|automatic_bid|performance\+)\b/g);
  if (manuals.length && automatics.length) return fail("Choisissez une seule stratégie d’enchères Pinterest.");
  if (manuals.length) {
    const amounts = positive(/\b(?:enchere maximale|cpc manuel|cpm manuel|enchere manuelle)\s*(?:de|a|:)?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?\b|eur\b)/g);
    const money = [...new Set(amounts.map((match) => Number(match[1].replace(",", "."))))];
    if (money.length > 1) return fail("Votre brief indique plusieurs enchères Pinterest contradictoires.");
    settings.bidding = { strategy: "max_bid", amountEuros: money[0] ?? 1 };
  }
  const checked = normalizePinterestDeliverySettings(settings);
  if (checked.error) return fail(checked.error);
  const dailyEuros = settings.budget.type === "daily" ? human.dailyEuros || 10 : null;
  if (settings.bidding.amountEuros != null && settings.bidding.amountEuros > (settings.budget.totalEuros || dailyEuros || 0)) return fail("L’enchère Pinterest ne peut pas dépasser le budget choisi.");
  return { budget: { type: settings.budget.type, dailyEuros, totalEuros: settings.budget.totalEuros, startAt, endAt }, deliverySettings: settings, error: null };
}
export const selectPinterestAdsPlanLocations = selectLinkedInAdsPlanLocations;
