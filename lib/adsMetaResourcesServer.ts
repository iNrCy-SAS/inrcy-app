import "server-only";
import { adsConnectionStatus, listMetaPages, metaAdsJson, readAdsIntegration, type AdsIntegration } from "./adsServer.ts";
import { normalizeMetaAdsGeoTargets, type MetaAdsGeoTarget, type MetaAdsResources } from "./adsMetaResources.ts";
export class MetaAdsPreparationError extends Error { constructor(message: string, readonly status = 422) { super(message); this.name = "MetaAdsPreparationError"; } }
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const pageId = (integration: AdsIntegration) => clean(object(integration.meta).selected_page_id);
const contextKey = (integration: AdsIntegration) => JSON.stringify([integration.id, integration.provider_account_id, integration.resource_id, pageId(integration), adsConnectionStatus(integration)]);
async function requireContext(userId: string, expected?: AdsIntegration) {
  const current = await readAdsIntegration(userId, "meta");
  if (!current || adsConnectionStatus(current) !== "connected" || !/^\d{5,25}$/.test(current.resource_id || "")) throw new MetaAdsPreparationError("Associez un compte Meta Ads actif avant la vérification.", 409);
  if (expected && contextKey(current) !== contextKey(expected)) throw new MetaAdsPreparationError("La connexion, le compte ou la Page Meta a changé. Actualisez les ressources avant de confirmer.", 409);
  return current;
}
/** Private context fingerprint contains no token and is never returned by a route. */
export async function metaAdsDeliveryContext(userId: string): Promise<string> { return contextKey(await requireContext(userId)); }
async function rows(userId: string, path: string) {
  const result: Record<string, unknown>[] = [];
  let after = "";
  for (let index = 0; index < 10; index++) {
    const response = await metaAdsJson(userId, path + (after ? `&after=${encodeURIComponent(after)}` : ""));
    result.push(...(Array.isArray(response.data) ? response.data.map(object) : []));
    const paging = object(response.paging), next = clean(object(paging.cursors).after);
    if (!paging.next || !next || next === after) break;
    after = next;
  }
  return result;
}
/** Read-only provider evidence; account and Page associations are checked before and after every group of reads. */
export async function readMetaAdsDeliveryResources(userId: string, expectedAccountId?: string, expectedPageId?: string): Promise<MetaAdsResources> {
  const initial = await requireContext(userId), accountId = initial.resource_id!;
  if (expectedAccountId && expectedAccountId !== accountId) throw new MetaAdsPreparationError("Le compte Meta associé ne correspond plus au brouillon.", 409);
  if (expectedPageId && pageId(initial) && expectedPageId !== pageId(initial)) throw new MetaAdsPreparationError("La Page Meta associée ne correspond plus au brouillon.", 409);
  const [account, pages] = await Promise.all([metaAdsJson(userId, `act_${accountId}?fields=id,name,currency,account_status,timezone_name`), listMetaPages(userId)]);
  await requireContext(userId, initial);
  if (String(account.id || "").replace(/^act_/, "") !== accountId || account.currency !== "EUR" || Number(account.account_status) !== 1) throw new MetaAdsPreparationError("Le compte Meta Ads EUR n’est pas actif ou accessible.", 409);
  if (expectedPageId && !pages.some((page) => page.id === expectedPageId)) throw new MetaAdsPreparationError("Cette Page Facebook n’est plus autorisée par la connexion Meta Ads.", 409);
  const [instagram, localeRows] = await Promise.all([
    pages.some((page) => page.instagramUserId) ? rows(userId, `act_${accountId}/connected_instagram_accounts?fields=id&limit=100`) : Promise.resolve([]),
    rows(userId, "search?type=adlocale&limit=1000").catch(() => []),
  ]);
  await requireContext(userId, initial);
  let timezone: string | null = null;
  if (clean(account.timezone_name)) { try { timezone = new Intl.DateTimeFormat("en-GB", { timeZone: clean(account.timezone_name) }).resolvedOptions().timeZone; } catch { /* Unknown remains unverified. */ } }
  const locales = [...new Map(localeRows.filter((row) => /^\d{1,12}$/.test(String(row.key || row.id || "")) && clean(row.name)).map((row) => [String(row.key || row.id), { id: String(row.key || row.id), name: clean(row.name) }])).values()];
  return { selectedAccountId: accountId, selectedPageId: pageId(initial), account: { id: accountId, name: clean(account.name), currency: "EUR", status: 1, timezone }, pages, instagramAccountIds: [...new Set(instagram.map((row) => clean(row.id)).filter((id) => /^\d{5,30}$/.test(id)))], locales };
}
function queryKey(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^(?:dans |toute la |toute |la |le |les )/, "").trim(); }
function nativeGeo(value: unknown): MetaAdsGeoTarget | null {
  const row = object(value), type = clean(row.type), key = String(row.key || ""), countryCode = clean(row.country_code).toUpperCase();
  const parsed = normalizeMetaAdsGeoTargets([{ key, type, name: clean(row.name), countryCode, ...(clean(row.region) ? { region: clean(row.region) } : {}) }]);
  return parsed?.[0] || null;
}
export async function searchMetaAdsGeographies(userId: string, queries: string[], expectedAccountId?: string) {
  const initial = await requireContext(userId);
  if (expectedAccountId && initial.resource_id !== expectedAccountId) throw new MetaAdsPreparationError("Le compte Meta a changé avant la recherche géographique.", 409);
  if (!queries.length || queries.length > 20 || queries.some((query) => query.trim().length < 2 || query.length > 120)) throw new MetaAdsPreparationError("Recherchez entre une et vingt zones Meta, avec des noms de 2 à 120 caractères.");
  const resolutions: Array<{ query: string; options: MetaAdsGeoTarget[]; autoSelectedTarget: MetaAdsGeoTarget | null }> = [];
  for (const query of queries) {
    const params = new URLSearchParams({ type: "adgeolocation", q: query, location_types: JSON.stringify(["country", "region", "city", "zip"]), limit: "100" });
    const response = await metaAdsJson(userId, `search?${params}`);
    const options = [...new Map((Array.isArray(response.data) ? response.data : []).map(nativeGeo).filter((target): target is MetaAdsGeoTarget => Boolean(target)).map((target) => [`${target.type}:${target.key}`, target])).values()];
    const requested = queryKey(query);
    const matches = options.filter((target) => queryKey(target.name) === requested || queryKey([target.name, target.region, target.countryCode].filter(Boolean).join(", ")) === requested || target.type === "country" && queryKey(target.countryCode) === requested);
    resolutions.push({ query, options, autoSelectedTarget: matches.length === 1 ? matches[0] : null });
  }
  await requireContext(userId, initial);
  return { selectedAccountId: initial.resource_id!, options: resolutions.length === 1 ? resolutions[0].options : [...new Map(resolutions.flatMap((entry) => entry.options).map((target) => [`${target.type}:${target.key}`, target])).values()], resolutions, complete: resolutions.every((entry) => entry.autoSelectedTarget !== null) };
}
export async function verifyMetaAdsGeoTargets(userId: string, targets: MetaAdsGeoTarget[], accountId: string) {
  if (!targets.length) throw new MetaAdsPreparationError("Choisissez au moins une zone exacte vérifiée par Meta.");
  const found = await searchMetaAdsGeographies(userId, targets.map((target) => target.name), accountId);
  for (let index = 0; index < targets.length; index++) {
    const requested = targets[index];
    if (!found.resolutions[index].options.some((target) => target.key === requested.key && target.type === requested.type && target.name === requested.name && target.countryCode === requested.countryCode && (target.region || "") === (requested.region || ""))) throw new MetaAdsPreparationError(`Meta n’a pas confirmé la zone « ${requested.name} ». Choisissez sa zone exacte dans les résultats natifs.`);
  }
  const countries = targets.filter((target) => target.type === "country").map((target) => target.countryCode);
  const ids = (type: MetaAdsGeoTarget["type"]) => targets.filter((target) => target.type === type).map((target) => ({ key: target.key }));
  return { ...(countries.length ? { countries: [...new Set(countries)] } : {}), ...(ids("region").length ? { regions: ids("region") } : {}), ...(ids("city").length ? { cities: ids("city") } : {}), ...(ids("zip").length ? { zips: ids("zip") } : {}), location_types: ["home", "recent"] };
}
