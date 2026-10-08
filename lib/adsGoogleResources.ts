export type GoogleAdsConversionGoal = { category: string; origin: string; biddable: boolean };
export type GoogleAdsConversionAction = { resourceName: string; name: string; category: string; origin: string; type: string; status: string; primaryForGoal: boolean };
export type GoogleAdsAccountResources = {
  selectedAccountId: string;
  timeZone: string;
  conversionGoals: GoogleAdsConversionGoal[];
  conversionActions: GoogleAdsConversionAction[];
  hasBiddableConversions: boolean;
  conversionMode: "account_defaults";
};
export type GoogleAdsReadQuery = (query: string, pageToken?: string) => Promise<Record<string, unknown>>;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
async function rows(read: GoogleAdsReadQuery, query: string) {
  const found: unknown[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const response = await read(query, pageToken);
    if (!Array.isArray(response.results) && response.results != null) throw new Error("Réponse Google Ads invalide.");
    found.push(...(Array.isArray(response.results) ? response.results : []));
    if (!response.nextPageToken) return found;
    if (typeof response.nextPageToken !== "string" || response.nextPageToken === pageToken) throw new Error("Pagination Google Ads invalide.");
    pageToken = response.nextPageToken;
  }
  throw new Error("La liste des conversions Google Ads est trop longue pour être entièrement vérifiée. Aucun objectif partiel ne sera utilisé.");
}
export function googleAdsAccountTimeZone(account: Record<string, unknown>, customerId: string): string {
  if (String(account.id) !== customerId || account.currencyCode !== "EUR" || account.manager === true || account.status !== "ENABLED") throw new Error("Le compte Google Ads doit être un compte annonceur actif en euros.");
  const timeZone = typeof account.timeZone === "string" ? account.timeZone : "";
  try { if (!timeZone) throw new Error(); new Intl.DateTimeFormat("en", { timeZone }); } catch { throw new Error("Google Ads n’a pas confirmé le fuseau horaire du compte."); }
  return timeZone;
}

export async function readGoogleAdsAccountResources(read: GoogleAdsReadQuery, customerId: string, customer?: Record<string, unknown>): Promise<GoogleAdsAccountResources> {
  if (!/^\d{5,25}$/.test(customerId)) throw new Error("Compte Google Ads invalide.");
  const account = customer || record(record((await rows(read, "SELECT customer.id, customer.currency_code, customer.manager, customer.status, customer.time_zone FROM customer LIMIT 1"))[0]).customer);
  const timeZone = googleAdsAccountTimeZone(account, customerId);
  const [goalRows, actionRows] = await Promise.all([
    rows(read, "SELECT customer_conversion_goal.category, customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal"),
    rows(read, "SELECT conversion_action.resource_name, conversion_action.name, conversion_action.category, conversion_action.origin, conversion_action.type, conversion_action.status, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status = 'ENABLED'"),
  ]);
  const conversionGoals = goalRows.map((row) => record(record(row).customerConversionGoal)).filter((goal) => typeof goal.category === "string" && typeof goal.origin === "string" && typeof goal.biddable === "boolean").map((goal) => ({ category: String(goal.category), origin: String(goal.origin), biddable: goal.biddable === true }));
  const conversionActions = actionRows.map((row) => record(record(row).conversionAction)).filter((action) => /^customers\/\d+\/conversionActions\/\d+$/.test(String(action.resourceName)) && typeof action.name === "string" && typeof action.category === "string" && typeof action.origin === "string").map((action) => ({ resourceName: String(action.resourceName), name: String(action.name), category: String(action.category), origin: String(action.origin), type: String(action.type || ""), status: String(action.status || ""), primaryForGoal: action.primaryForGoal === true }));
  const hasBiddableConversions = conversionGoals.some((goal) => goal.biddable && conversionActions.some((action) => action.status === "ENABLED" && action.primaryForGoal && action.category === goal.category && action.origin === goal.origin));
  return { selectedAccountId: customerId, timeZone, conversionGoals, conversionActions, hasBiddableConversions, conversionMode: "account_defaults" };
}

export function googleAdsDateInAccount(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

/** Stable approval evidence for the exact account-default goals actually shown in the review. */
export function googleAdsResourcesConsentKey(resources: GoogleAdsAccountResources | null | undefined): string {
  if (!resources || !resources.selectedAccountId || !resources.timeZone || resources.conversionMode !== "account_defaults"
    || !Array.isArray(resources.conversionGoals) || !Array.isArray(resources.conversionActions)) return "";
  const stable = (rows: unknown[]) => [...new Set(rows.map((row) => JSON.stringify(row)))].sort().map((row) => JSON.parse(row));
  return JSON.stringify({
    selectedAccountId: resources.selectedAccountId, timeZone: resources.timeZone, conversionMode: resources.conversionMode,
    goals: stable(resources.conversionGoals.map((goal) => ({ category: goal.category, origin: goal.origin, biddable: goal.biddable }))),
    actions: stable(resources.conversionActions.filter((action) => action.status === "ENABLED" && action.primaryForGoal)
      .map((action) => ({ resourceName: action.resourceName, name: action.name, category: action.category, origin: action.origin, type: action.type, status: action.status, primaryForGoal: action.primaryForGoal }))),
  });
}
