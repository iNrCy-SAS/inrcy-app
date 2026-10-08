import { defaultPreparedDeliverySettings, normalizePreparedDeliverySettings, type PreparedDeliverySettings } from "./adsPreparedCampaignSettings.ts";
import { readLinkedInAdsPlanIntent } from "./adsLinkedInPlanIntent.ts";
import { readLinkedInHumanDeliveryConstraints } from "./adsLinkedInPlanDelivery.ts";
import type { AdsChannelDraft } from "./adsChannelDrafts.ts";

export type PreparedBudgetSuggestion = { type: "daily" | "total"; dailyEuros: number | null; totalEuros: number | null; startAt: string | null; endAt: string | null };
type Context = { provider: "x" | "tiktok"; intent?: string; now?: string; timezone?: string };

/** Human choices are draft controls only; no provider ID or publication permission is generated. */
export function readPreparedAdsPlanIntent(context: Context): { budget: PreparedBudgetSuggestion | null; deliverySettings: PreparedDeliverySettings | null; error: string | null } {
  const name = context.provider === "tiktok" ? "TikTok" : "X";
  const fail = (error: string) => ({ budget: null, deliverySettings: null, error });
  const human = readLinkedInAdsPlanIntent(context.intent);
  if (human.budgetIssue) return fail(human.budgetIssue === "combined_budget_unsupported" ? `Choisissez un budget quotidien ou une enveloppe totale pour le brouillon ${name}, sans cumuler les deux.` : human.budgetIssue === "conflicting_budget" ? `Votre brief indique plusieurs budgets ${name} contradictoires.` : "Précisez un budget préparé entre 5 et 500 € par jour ou entre 5 et 45 000 € au total.");
  const dates = readLinkedInHumanDeliveryConstraints(context);
  if (dates.error) return fail(dates.error.replace(/LinkedIn/g, name));
  const now = Date.parse(context.now || new Date().toISOString());
  if (!Number.isFinite(now)) return fail("La date de référence du brouillon préparé est invalide.");
  const text = (context.intent || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const positive = (pattern: RegExp) => [...text.matchAll(pattern)].filter((match) => !/\b(?:pas|sans|aucun\w*|exclu\w*)\b[^,;.!?]{0,35}$/.test(text.slice(Math.max(0, match.index! - 45), match.index)));
  const durations = [...new Set(positive(/\b(?:pour|sur|pendant)\s+(?:une duree de\s+)?(\d+)\s*(jours?|semaines?)\b/g).filter((match) => /\b(?:campagne|diffusion|budget|enveloppe|publicite)\b/.test(text.slice(Math.max(0, match.index! - 100), match.index))).map((match) => Number(match[1]) * (match[2].startsWith("semaine") ? 7 : 1)))];
  if (durations.length > 1 || durations.some((days) => !Number.isSafeInteger(days) || days < 1 || days > 90)) return fail(`Choisissez une seule durée préparée ${name} de 1 à 90 jours.`);
  const startAt = dates.constraints.budget.startAt ?? new Date(now + 15 * 60_000).toISOString();
  const start = startAt ? Date.parse(startAt) : now;
  const endAt = dates.constraints.budget.endAt || new Date(start + (durations[0] || 7) * 86400000).toISOString();
  const end = Date.parse(endAt);
  if (start < now - 60000 || end <= Math.max(start, now) || end > now + 90 * 86400000) return fail(`Le calendrier préparé ${name} doit être futur, la fin après le début, dans les 90 prochains jours.`);
  if (durations[0] && dates.constraints.budget.endAt && Math.abs((end - start) / 86400000 - durations[0]) > 1) return fail(`Les dates et la durée préparée ${name} se contredisent.`);
  if (positive(/\b(?:budget quotidien flexible|target[_ ]roas|roas cible|target[_ ]cpa|cpa cible)\b/g).length) return fail(`Ce réglage ne correspond pas aux enchères ou au budget préparés de ${name}.`);
  if (positive(/\b(?:cpc|cpm|cpa|encheres?)\s*(?:de|a|:)?\s*\d+(?:[.,]\d+)?\s*(?:€|euros?\b|eur\b)/g).length) return fail(`Précisez une stratégie d’enchères préparée ${name} compatible avec le montant demandé.`);
  const maximums = positive(/\b(?:max[_ ]bid|enchere maximale|encheres? manuelles?|cpc manuel|cpc max(?:imum)?)\b/g);
  const caps = positive(/\b(?:cost[_ ]cap|cout cible(?: moyen)?(?: par resultat)?|target cost per result)\b/g);
  const automatics = positive(/\b(?:encheres? automatiques?|automatic(?:_bid)?|maximum delivery|maximum results)\b/g);
  if (Number(Boolean(maximums.length)) + Number(Boolean(caps.length)) + Number(Boolean(automatics.length)) > 1) return fail(`Choisissez une seule stratégie d’enchères préparée ${name}.`);
  if (context.provider === "tiktok" && maximums.length || context.provider === "x" && caps.length) return fail(`Cette stratégie n’est pas proposée dans le brouillon préparé ${name}.`);
  // These are visible proposals, never conversions of an explicit human budget.
  const proposalType = human.budget?.type || (context.provider === "tiktok" ? "total" : "daily");
  const settings = defaultPreparedDeliverySettings(proposalType);
  settings.budget = { type: proposalType, totalEuros: human.budget?.totalEuros ?? (proposalType === "total" && !human.budget ? 200 : null), startAt, endAt };
  if (context.provider === "x" && !maximums.length && !caps.length && !automatics.length) settings.bidding = { strategy: "max_bid", amountEuros: 1 };
  if (maximums.length || caps.length) {
    const amounts = positive(/\b(?:max[_ ]bid|enchere maximale|encheres? manuelles?|cpc manuel|cpc max(?:imum)?|cost[_ ]cap|cout cible(?: moyen)?(?: par resultat)?|target cost per result)\s*(?:de|a|:|=)?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:€|euros?\b|eur\b)/g);
    const money = [...new Set(amounts.map((match) => Number(match[1].replace(",", "."))))];
    if (money.length !== 1) return fail(`Précisez un seul montant d’enchère préparée ${name}, avec deux décimales maximum.`);
    settings.bidding = { strategy: caps.length ? "cost_cap" : "max_bid", amountEuros: money[0] };
  }
  const checked = normalizePreparedDeliverySettings(settings, context.provider);
  if (checked.error || !checked.settings) return fail(checked.error || "Les réglages préparés sont invalides.");
  const dailyEuros = settings.budget.type === "daily" ? human.dailyEuros ?? 10 : null;
  if (settings.bidding.amountEuros != null && settings.bidding.amountEuros > (settings.budget.totalEuros ?? dailyEuros ?? 0)) return fail("Le montant d’enchère préparé ne peut pas dépasser le budget choisi.");
  return { budget: { type: settings.budget.type, dailyEuros, totalEuros: settings.budget.totalEuros, startAt, endAt }, deliverySettings: checked.settings, error: null };
}

/** TikTok preparation uses an ad-group budget (CBO off); X uses its campaign. */
export function preparedAdsPlanBudget(provider: "x" | "tiktok", budget: PreparedBudgetSuggestion): AdsChannelDraft["budget"] {
  return { amount: budget.type === "total" ? budget.totalEuros! : budget.dailyEuros!, currency: "EUR", period: budget.type === "total" ? "lifetime" : "daily", level: provider === "tiktok" ? "ad_group" : "campaign" };
}
