export type MetaAdsGeoTarget = { key: string; type: "country" | "region" | "city" | "zip"; name: string; countryCode: string; region?: string };
export type MetaAdsResources = { selectedAccountId: string; selectedPageId: string; account: { id: string; name: string; currency: "EUR"; status: number; timezone: string | null }; pages: Array<{ id: string; name: string; instagramUserId?: string }>; instagramAccountIds: string[]; locales: Array<{ id: string; name: string }> };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function normalizeMetaAdsGeoTargets(value: unknown): MetaAdsGeoTarget[] | null {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  const targets: MetaAdsGeoTarget[] = [];
  for (const item of value) {
    const row = object(item);
    if (Object.keys(row).some((key) => !["key", "type", "name", "countryCode", "region"].includes(key)) || typeof row.key !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(row.key) || !["country", "region", "city", "zip"].includes(String(row.type)) || typeof row.name !== "string" || !row.name.trim() || row.name.length > 120 || typeof row.countryCode !== "string" || !/^[A-Z]{2}$/.test(row.countryCode) || row.region != null && (typeof row.region !== "string" || row.region.length > 120)) return null;
    targets.push({ key: row.key, type: row.type as MetaAdsGeoTarget["type"], name: row.name.trim(), countryCode: row.countryCode, ...(row.region ? { region: String(row.region).trim() } : {}) });
  }
  return [...new Map(targets.map((target) => [`${target.type}:${target.key}`, target])).values()];
}
export function metaAdsResourcesConsentKey(resources: MetaAdsResources | null | undefined): string {
  if (!resources) return "";
  const sort = <T>(rows: T[], key: (row: T) => string) => [...new Map(rows.map((row) => [key(row), row])).values()].sort((left, right) => key(left).localeCompare(key(right)));
  return JSON.stringify({ selectedAccountId: resources.selectedAccountId, selectedPageId: resources.selectedPageId, account: resources.account, pages: sort(resources.pages.map(({ id, name, instagramUserId }) => ({ id, name, ...(instagramUserId ? { instagramUserId } : {}) })), (page) => page.id), instagramAccountIds: [...new Set(resources.instagramAccountIds)].sort(), locales: sort(resources.locales.map(({ id, name }) => ({ id, name })), (locale) => locale.id) });
}
const languageNames: Record<string, string[]> = { fr: ["French", "Français"], en: ["English", "Anglais"], de: ["German", "Allemand"], es: ["Spanish", "Espagnol"], it: ["Italian", "Italien"], nl: ["Dutch", "Néerlandais"], pt: ["Portuguese", "Portugais"] };
const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
/** Empty language choices mean no language filter; otherwise require real provider IDs. */
export function resolveMetaAdsLanguages(resources: Pick<MetaAdsResources, "locales">, requested: readonly string[]): number[] {
  if (!requested.length) return [];
  if (requested.length > 10) throw new Error("Choisissez au maximum dix langues Meta.");
  return [...new Set(requested.map((value) => {
    const names = languageNames[value.toLowerCase()] || [value];
    const matches = resources.locales.filter((locale) => locale.id === value || names.some((name) => normalized(locale.name) === normalized(name)));
    const ids = [...new Set(matches.map((locale) => locale.id))];
    if (ids.length !== 1 || !/^\d{1,12}$/.test(ids[0])) throw new Error(`La langue « ${value} » doit être choisie dans les langues vérifiées par Meta, ou retirée pour diffuser sans filtre de langue.`);
    return Number(ids[0]);
  }))];
}
