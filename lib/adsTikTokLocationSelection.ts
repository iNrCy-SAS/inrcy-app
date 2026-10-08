import { TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT, type TikTokAdsGeoTarget } from "./adsTikTokResources.ts";

export type TikTokLocationRow = { query: string; options: TikTokAdsGeoTarget[]; selected: TikTokAdsGeoTarget | null };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function target(value: unknown): TikTokAdsGeoTarget {
  const row = object(value);
  if (typeof row.id !== "string" || !/^\d{1,30}$/.test(row.id) || /^0+$/.test(row.id)
    || typeof row.name !== "string" || !row.name.trim() || row.name.length > 180
    || typeof row.countryCode !== "string" || !/^[A-Z]{2}$/.test(row.countryCode)
    || typeof row.parentId !== "string" || !/^\d{1,30}$/.test(row.parentId)
    || !["COUNTRY", "PROVINCE", "CITY"].includes(String(row.level))
    || !["ADMIN", "METROPOLITAN_OR_DMA"].includes(String(row.areaType))
    || !Array.isArray(row.path) || row.path.length > 12 || row.path.some((part) => typeof part !== "string" || !part.trim() || part.length > 180)) {
    throw new Error("TikTok a renvoyé une zone invalide. Relancez sa vérification.");
  }
  return { id: row.id, name: row.name, countryCode: row.countryCode, level: row.level as TikTokAdsGeoTarget["level"], parentId: row.parentId, areaType: row.areaType as TikTokAdsGeoTarget["areaType"], path: row.path as string[] };
}

/** Exact advertiser/context/query binding; partial native suggestions remain unselected. */
export function tikTokLocationPickerRows(response: unknown, accountId: string, queries: readonly string[]): TikTokLocationRow[] {
  const body = object(response);
  if (body.selectedAccountId !== accountId || body.publicationEnabled !== false
    || JSON.stringify(body.context) !== JSON.stringify(TIKTOK_TRAFFIC_GEOGRAPHY_CONTEXT)) {
    throw new Error("Le compte ou le parcours TikTok a changé. Revérifiez ses zones.");
  }
  if (!Array.isArray(body.resolutions) || body.resolutions.length !== queries.length || queries.length > 20) {
    throw new Error("TikTok n’a pas répondu pour toutes les zones demandées.");
  }
  return queries.map((query) => {
    const entries = (body.resolutions as unknown[]).map(object).filter((row) => row.query === query);
    if (entries.length !== 1 || !Array.isArray(entries[0].candidates) || entries[0].candidates.length > 25
      || !["resolved", "ambiguous", "not_found"].includes(String(entries[0].status))) throw new Error(`La zone « ${query} » doit être revérifiée.`);
    const options = entries[0].candidates.map(target);
    if (new Set(options.map((option) => option.id)).size !== options.length) throw new Error("Les zones TikTok reçues sont incohérentes.");
    let selected: TikTokAdsGeoTarget | null = null;
    if (entries[0].status === "resolved") {
      const exact = target(entries[0].target);
      selected = options.find((option) => JSON.stringify(option) === JSON.stringify(exact)) || null;
      if (!selected) throw new Error("TikTok n’a pas confirmé son choix automatique dans les résultats natifs.");
    } else if (entries[0].target != null) throw new Error("Une suggestion ambiguë ne peut pas être retenue automatiquement.");
    return { query, options, selected };
  });
}
