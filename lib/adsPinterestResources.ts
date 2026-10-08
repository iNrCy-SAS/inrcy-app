import { matchPinterestGeographies, pinterestGeographyOptions, pinterestLocationOptions, type PinterestGeographyOption } from "./adsPinterestLocations.ts";

export type PinterestAdsResources = {
  selectedAccountId: string;
  account: { id: string; name: string; currency: "EUR"; country: string | null; timezone: string | null };
  geographies: PinterestGeographyOption[];
  locales: Array<{ id: string; name: string }>;
};
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
export function normalizePinterestAdsResources(accountValue: unknown, locationPayload: unknown, geoPayload: unknown, localePayload: unknown, expectedAccountId: string): PinterestAdsResources {
  const account = object(accountValue);
  if (account.id !== expectedAccountId || !/^\d{5,30}$/.test(expectedAccountId) || account.currency !== "EUR") throw new Error("Le compte Pinterest Ads EUR n’a pas pu être confirmé.");
  const geographies = pinterestGeographyOptions(locationPayload, geoPayload), locales = pinterestLocationOptions(localePayload, "LOCALE");
  if (!geographies.length || !locales.length) throw new Error("Les zones et langues natives Pinterest n’ont pas pu être vérifiées.");
  let timezone: string | null = null;
  const nativeTimezone = clean(account.time_zone);
  if (nativeTimezone) {
    try { timezone = new Intl.DateTimeFormat("en-GB", { timeZone: nativeTimezone }).resolvedOptions().timeZone; } catch { /* Unknown remains unverified, never replaced by a guessed timezone. */ }
  }
  return { selectedAccountId: expectedAccountId, account: { id: expectedAccountId, name: clean(account.name), currency: "EUR", country: /^[A-Z]{2}$/.test(clean(account.country)) ? clean(account.country) : null, timezone }, geographies, locales };
}

/** Compare semantic native evidence, never transport order or timestamps. */
export function pinterestAdsResourcesConsentKey(resources: PinterestAdsResources | null | undefined): string {
  if (!resources) return "";
  const sorted = <T>(items: T[], itemKey: (item: T) => string) => [...new Map(items.map((item) => [itemKey(item), item])).values()].sort((left, right) => itemKey(left).localeCompare(itemKey(right)));
  return JSON.stringify({ selectedAccountId: resources.selectedAccountId, account: { id: resources.account.id, name: resources.account.name, currency: resources.account.currency, country: resources.account.country, timezone: resources.account.timezone },
    geographies: sorted(resources.geographies.map(({ id, name, type, kind }) => ({ id, name, type, kind })), (item) => `${item.type}:${item.id}`),
    locales: sorted(resources.locales.map(({ id, name }) => ({ id, name })), (item) => item.id) });
}

/** Exact provider catalog matching. IDs are canonical stored selections; no country fallback or nearby substitution. */
export function resolvePinterestAdsGeographies(resources: PinterestAdsResources, labels: readonly string[]) {
  const location = resources.geographies.filter((option) => option.type === "LOCATION");
  const geo = resources.geographies.filter((option) => option.type === "GEO");
  // The matcher also accepts flat native maps; keep the original kinds for mixed-region validation.
  const payload = (options: PinterestGeographyOption[]) => options.map(({ id, name }) => ({ [id]: name }));
  if (!labels.length || labels.length > 20) throw new Error("Choisissez entre 1 et 20 zones Pinterest.");
  const resolved = labels.map((label) => matchPinterestGeographies([label], payload(location), payload(geo)));
  const geoIds = [...new Set(resolved.flatMap((item) => item.GEO || []))];
  if (geoIds.length > 1 && !geoIds.every((id) => geo.some((option) => option.id === id && option.kind === "region"))) throw new Error("Les codes postaux et régions Pinterest ne peuvent pas être mélangés dans un groupe d’annonces.");
  const ids = new Set(resolved.flatMap((item) => [...(item.LOCATION || []).map((id) => `LOCATION:${id}`), ...(item.GEO || []).map((id) => `GEO:${id}`)]));
  return resources.geographies.filter((option) => ids.has(`${option.type}:${option.id}`));
}
