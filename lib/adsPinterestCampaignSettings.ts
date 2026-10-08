/** Additive native CBO settings. An absent value preserves the historical daily/MAX_BID adapter. */
export type PinterestDeliverySettings = {
  budget: { type: "daily" | "total"; totalEuros: number | null; flexibleDaily: boolean; startAt: string | null; endAt: string | null };
  bidding: { strategy: "automatic" | "max_bid"; amountEuros: number | null };
  placementGroup: "ALL" | "SEARCH" | "BROWSE" | "OTHER";
  optimizationGoal: "impressions" | "pin_clicks";
};
export const PINTEREST_PLACEMENT_GROUPS = ["ALL", "SEARCH", "BROWSE", "OTHER"] as const;

export function defaultPinterestDeliverySettings(objectiveType = "CONSIDERATION"): PinterestDeliverySettings {
  return { budget: { type: "daily", totalEuros: null, flexibleDaily: false, startAt: null, endAt: null }, bidding: { strategy: "automatic", amountEuros: null }, placementGroup: "ALL", optimizationGoal: objectiveType === "AWARENESS" ? "impressions" : "pin_clicks" };
}
function known(value: unknown, keys: string[]) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  return object && Object.keys(object).every((name) => keys.includes(name)) ? object : null;
}
export function pinterestAdsInstant(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parts = value.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/)!;
  if (Number(parts[1]) > 23 || Number(parts[2]) > 59 || Number(parts[3]) > 59 || Number(parts[5] || 0) > 23 || Number(parts[6] || 0) > 59) return null;
  const date = Date.parse(value);
  const calendar = new Date(value.slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(date) || !Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  return new Date(date).toISOString();
}
function money(value: unknown, maximum: number) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum && Math.abs(Math.round(value * 100) - value * 100) < 0.000001;
}
export function normalizePinterestDeliverySettings(value: unknown): { settings: PinterestDeliverySettings | null; error: string | null } {
  if (value == null) return { settings: null, error: null };
  const fail = (error: string) => ({ settings: null, error });
  const raw = known(value, ["budget", "bidding", "placementGroup", "optimizationGoal"]);
  if (!raw) return fail("Les réglages natifs Pinterest sont invalides.");
  const defaults = defaultPinterestDeliverySettings();
  const budget = known(raw.budget ?? defaults.budget, Object.keys(defaults.budget));
  const bidding = known(raw.bidding ?? defaults.bidding, ["strategy", "amountEuros"]);
  if (!budget || !bidding || !["daily", "total"].includes(String(budget.type)) || !["automatic", "max_bid"].includes(String(bidding.strategy))) return fail("Choisissez un budget et une stratégie d’enchères Pinterest valides.");
  const totalEuros = budget.totalEuros ?? null, amountEuros = bidding.amountEuros ?? null;
  if (totalEuros !== null && (!money(totalEuros, 45000) || Number(totalEuros) < 5)) return fail("Le budget total Pinterest doit être compris entre 5 et 45 000 €, avec deux décimales maximum.");
  if (budget.type === "total" && totalEuros === null) return fail("Renseignez l’enveloppe totale Pinterest.");
  if (budget.type === "daily" && totalEuros !== null) return fail("Choisissez une seule limite Pinterest : quotidienne ou totale.");
  const flexibleDaily = budget.flexibleDaily ?? false;
  if (typeof flexibleDaily !== "boolean" || budget.type === "total" && flexibleDaily) return fail("Le budget quotidien flexible Pinterest ne s’applique qu’au budget quotidien.");
  const startAt = budget.startAt == null ? null : pinterestAdsInstant(budget.startAt), endAt = budget.endAt == null ? null : pinterestAdsInstant(budget.endAt);
  if (budget.startAt != null && !startAt || budget.endAt != null && !endAt || startAt && endAt && startAt >= endAt) return fail("Vérifiez le calendrier Pinterest et le fuseau horaire des dates.");
  if (amountEuros !== null && !money(amountEuros, 45000)) return fail("L’enchère Pinterest doit être positive, avec deux décimales maximum.");
  if (bidding.strategy === "max_bid" && amountEuros === null) return fail("Renseignez l’enchère maximale Pinterest.");
  if (bidding.strategy === "automatic" && amountEuros !== null) return fail("L’enchère automatique Pinterest ne prend pas de montant maximal manuel.");
  const placementGroup = raw.placementGroup ?? "ALL", optimizationGoal = raw.optimizationGoal ?? "pin_clicks";
  if (!PINTEREST_PLACEMENT_GROUPS.includes(placementGroup as PinterestDeliverySettings["placementGroup"])) return fail("Choisissez un placement Pinterest pris en charge.");
  // AdGroupCreate exposes no verified selector for outbound-click optimisation.
  if (optimizationGoal !== "impressions" && optimizationGoal !== "pin_clicks") return fail("Le connecteur Pinterest optimise les impressions ou les clics sur l’épingle ; les conversions et clics sortants nécessitent un parcours natif vérifié.");
  return { settings: { budget: { type: budget.type as "daily" | "total", totalEuros: totalEuros as number | null, flexibleDaily, startAt, endAt }, bidding: { strategy: bidding.strategy as "automatic" | "max_bid", amountEuros: amountEuros as number | null }, placementGroup: placementGroup as PinterestDeliverySettings["placementGroup"], optimizationGoal }, error: null };
}

type PinterestDeliveryDraft = { dailyBudgetEuros: number; pinterestBidEuros?: number; endDate: string; pinterestDeliverySettings?: PinterestDeliverySettings; channelSettings?: { channel?: string; objectiveType?: string; conversionEvent?: string | null } };
export function pinterestNativeDelivery(draft: PinterestDeliveryDraft, nowMs = Date.now()) {
  const parsed = normalizePinterestDeliverySettings(draft.pinterestDeliverySettings);
  if (parsed.error) throw new Error(parsed.error);
  const settings = parsed.settings;
  const objectiveType = draft.channelSettings?.objectiveType;
  if (objectiveType !== "AWARENESS" && objectiveType !== "CONSIDERATION") throw new Error("Choisissez Notoriété ou Considération pour cette épingle sponsorisée.");
  const expectedGoal = objectiveType === "AWARENESS" ? "impressions" : "pin_clicks";
  if (settings && settings.optimizationGoal !== expectedGoal) throw new Error("L’optimisation Pinterest doit correspondre à l’objectif de la campagne.");
  if (draft.channelSettings?.conversionEvent != null) throw new Error("Cette campagne Pinterest ne sélectionne aucun événement de conversion : choisissez Notoriété ou Considération.");
  const amount = settings?.budget.type === "total" ? Number(settings.budget.totalEuros) : draft.dailyBudgetEuros;
  if (!money(amount, settings?.budget.type === "total" ? 45000 : 500) || amount < 5) throw new Error("Vérifiez le budget Pinterest choisi.");
  const endMs = Date.parse(settings?.budget.endAt || `${draft.endDate}T23:59:59Z`);
  const startMs = settings?.budget.startAt ? Date.parse(settings.budget.startAt) : nowMs;
  const days = (endMs - nowMs) / 86400000;
  if (!Number.isFinite(endMs) || !Number.isFinite(startMs) || endMs <= Math.max(startMs, nowMs) || days > 90 || (settings ? startMs < nowMs - 60000 : days < 1)) throw new Error("Le calendrier Pinterest doit être futur, avec une fin après le début dans les 90 prochains jours.");
  const strategy = settings?.bidding.strategy || "max_bid";
  const bidEuros = strategy === "automatic" ? null : settings?.bidding.amountEuros ?? draft.pinterestBidEuros ?? 1;
  if (bidEuros !== null && (!money(bidEuros, amount) || bidEuros < 0.01)) throw new Error("L’enchère maximale Pinterest ne peut pas dépasser le budget choisi.");
  return { budgetType: settings?.budget.type || "daily", spendCap: Math.round(amount * 100) * 10000, flexibleDaily: settings?.budget.flexibleDaily || false, startTime: settings?.budget.startAt ? Math.floor(startMs / 1000) : null, endTime: Math.floor(endMs / 1000), bidStrategyType: strategy === "automatic" ? "AUTOMATIC_BID" as const : "MAX_BID" as const, bidInMicroCurrency: bidEuros === null ? null : Math.round(bidEuros * 100) * 10000, placementGroup: settings?.placementGroup || "ALL", optimizationGoal: expectedGoal };
}
