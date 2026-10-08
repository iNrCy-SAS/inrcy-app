import { readPinterestAdsPlanIntent } from "./adsPinterestPlanIntent.ts";
import { defaultMetaDeliverySettings, type MetaDeliverySettings } from "./adsMetaCampaignSettings.ts";
export type MetaBudgetSuggestion = { type: "daily" | "total"; dailyEuros: number | null; totalEuros: number | null; startAt: string | null; endAt: string | null };
/** Human EUR amounts and dated instants take precedence over model suggestions. */
export function readMetaAdsPlanIntent(input: { intent?: string; now?: string; timezone?: string }) {
  const parsed = readPinterestAdsPlanIntent({ ...input, objectiveType: "CONSIDERATION" });
  if (parsed.error) return { budget: null, deliverySettings: null, error: parsed.error.replace(/Pinterest/g, "Meta") };
  const settings: MetaDeliverySettings = defaultMetaDeliverySettings();
  if (parsed.budget) settings.budget = { type: parsed.budget.type, totalEuros: parsed.budget.totalEuros, startAt: parsed.budget.startAt, endAt: parsed.budget.endAt };
  if (parsed.deliverySettings?.bidding.strategy === "max_bid") settings.bidding = { strategy: "bid_cap", amountEuros: parsed.deliverySettings.bidding.amountEuros };
  return { budget: parsed.budget as MetaBudgetSuggestion | null, deliverySettings: settings, error: null };
}
