import { defaultOpenaiDeliverySettings, normalizeOpenaiDeliverySettings, type OpenaiDeliverySettings } from "./adsOpenaiCampaignSettings.ts";
import { readLinkedInAdsPlanIntent, selectLinkedInAdsPlanLocations } from "./adsLinkedInPlanIntent.ts";
import { readLinkedInHumanDeliveryConstraints } from "./adsLinkedInPlanDelivery.ts";

export type OpenaiBudgetSuggestion = { type: "daily" | "total"; dailyEuros: number | null; totalEuros: number | null; startAt: string | null; endAt: string | null };
export type OpenaiPlanIntentContext = { intent?: string; now?: string; timezone?: string };
/** Preserve explicit human budgets and dates; never turn a lifetime envelope into a daily spend. */
export function readOpenaiAdsPlanIntent(context: OpenaiPlanIntentContext): { budget: OpenaiBudgetSuggestion | null; deliverySettings: OpenaiDeliverySettings | null; bidEuros: number | null; error: string | null } {
  const fail = (error: string) => ({ budget: null, deliverySettings: null, bidEuros: null, error });
  const human = readLinkedInAdsPlanIntent(context.intent);
  if (human.budgetIssue) return fail(human.budgetIssue === "combined_budget_unsupported" ? "ChatGPT Ads utilise un budget quotidien ou total. Précisez une seule limite." : human.budgetIssue === "conflicting_budget" ? "Votre brief indique plusieurs budgets ChatGPT Ads contradictoires." : "Précisez un budget quotidien de 15 à 500 € ou total de 5 à 45 000 €.");
  const dates = readLinkedInHumanDeliveryConstraints(context);
  if (dates.error) return fail(dates.error.replace(/LinkedIn/g, "ChatGPT Ads"));
  const now = Date.parse(context.now || new Date().toISOString());
  if (!Number.isFinite(now)) return fail("La date de référence ChatGPT Ads est invalide.");
  const text = (context.intent || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const positive = (pattern: RegExp) => [...text.matchAll(pattern)].filter((match) => !/\b(?:pas|sans|aucun\w*|exclu\w*)\b[^,;.!?]{0,35}$/.test(text.slice(Math.max(0, match.index! - 45), match.index)));
  if (positive(/\b(?:encheres? automatiques?|maximi[sz](?:er|ation) (?:les )?(?:clics|conversions))\b/g).length) return fail("Ce parcours ChatGPT Ads utilise une enchère fixe. L’enchère automatique doit rester un projet à préparer séparément.");
  const periods = positive(/\b(?:pour|sur|pendant)\s+(?:une duree de\s+)?(\d+)\s*(jours?|semaines?)\b/g).filter((match) => /\b(?:campagne|diffusion|budget|enveloppe|publicite)\b/.test(text.slice(Math.max(0, match.index! - 100), match.index)));
  const durations = [...new Set(periods.map((match) => Number(match[1]) * (match[2].startsWith("semaine") ? 7 : 1)))];
  if (durations.length > 1 || durations.some((days) => !Number.isSafeInteger(days) || days < 1 || days > 90)) return fail("Choisissez une seule durée ChatGPT Ads de 1 à 90 jours.");
  const startAt = dates.constraints.budget.startAt ?? null;
  const start = startAt ? Date.parse(startAt) : now;
  const endAt = dates.constraints.budget.endAt || new Date(start + (durations[0] || 7) * 86400000).toISOString();
  const end = Date.parse(endAt);
  if (start < now - 60000 || end <= Math.max(start, now) || end > now + 90 * 86400000) return fail("Le calendrier ChatGPT Ads doit être futur, avec une fin après le début, dans les 90 prochains jours.");
  if (durations[0] && dates.constraints.budget.endAt && Math.abs((end - start) / 86400000 - durations[0]) > 1) return fail("Les dates et la durée ChatGPT Ads demandées se contredisent.");
  const settings = defaultOpenaiDeliverySettings();
  settings.budget = { type: human.budget?.type || "daily", totalEuros: human.budget?.totalEuros ?? null, startAt, endAt };
  const dailyEuros = settings.budget.type === "daily" ? human.dailyEuros ?? 15 : null;
  if (dailyEuros != null && (dailyEuros < 15 || dailyEuros > 500)) return fail("Ce parcours ChatGPT Ads accepte un budget quotidien de 15 à 500 €. Précisez une enveloppe totale si c’est votre intention.");
  const checked = normalizeOpenaiDeliverySettings(settings);
  if (checked.error) return fail(checked.error);
  const bidAmounts = [...text.matchAll(/\b(?:cpc(?:\s+(?:maximal|maximum|max))?|cout\s+par\s+clic(?:\s+(?:maximal|maximum|max))?|enchere(?:\s+(?:fixe|maximale|maximum|max))?)\s*(?:(?:de|a|est|:|=)\s*)?(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b|eur\b)/g)].map((match) => Number(match[1].replace(",", ".")));
  if (new Set(bidAmounts).size > 1) return fail("Votre brief indique plusieurs enchères ChatGPT Ads contradictoires.");
  const bidEuros = bidAmounts[0] ?? 1;
  const amount = settings.budget.type === "total" ? settings.budget.totalEuros || 0 : dailyEuros || 0;
  if (!Number.isFinite(bidEuros) || bidEuros < 0.01 || bidEuros > amount || Math.abs(bidEuros * 100 - Math.round(bidEuros * 100)) > 0.000001) return fail("Précisez une enchère fixe par clic de 0,01 € au budget choisi, avec deux décimales maximum.");
  return { budget: { type: settings.budget.type, dailyEuros, totalEuros: settings.budget.totalEuros, startAt, endAt }, deliverySettings: settings, bidEuros, error: null };
}
export const selectOpenaiAdsPlanLocations = selectLinkedInAdsPlanLocations;
