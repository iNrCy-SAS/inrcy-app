/** Legacy identifiers are accepted only when reading saved drafts or public links. */
const LEGACY_SITE_CHANNELS = new Set(["inrcy_site", "site_inrcy", "siteInrcy"]);
export const LEGACY_SITE_OUTPUT_ALIASES = ["inrcy_site", "inrcysite", "site_inrcy", "siteinrcy"] as const;

export function canonicalSiteWebChannel(value: unknown): string {
  const channel = typeof value === "string" ? value.trim() : "";
  return LEGACY_SITE_CHANNELS.has(channel) ? "site_web" : channel;
}

export function normalizeWidgetSource(value: unknown): "site_web" | null {
  return canonicalSiteWebChannel(value) === "site_web" ? "site_web" : null;
}

/** Preserve the current Site Web value when a saved payload contains both sites. */
export function normalizeSiteWebChannelMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result = { ...source };
  for (const [key, entry] of Object.entries(source)) {
    if (!LEGACY_SITE_CHANNELS.has(key)) continue;
    const current = result.site_web;
    if (current == null || current === "" || (typeof current === "object" && Object.keys(current).length === 0)) {
      result.site_web = entry;
    }
    delete result[key];
  }
  return result;
}

/** Normalize channel keys and selections at an old draft / dispatch boundary. */
export function normalizeSiteWebPublicationPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSiteWebPublicationPayload(entry)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(normalizeSiteWebChannelMap(value)).map(([key, entry]) => {
      const normalized = normalizeSiteWebPublicationPayload(entry);
      const next = (key === "channels" || key === "targetChannels" || key === "selectedChannels") && Array.isArray(normalized)
        ? Array.from(new Set(normalized))
        : normalized;
      return [key, next];
    })) as T;
  }
  return (typeof value === "string" && LEGACY_SITE_CHANNELS.has(value)
    ? "site_web"
    : value) as T;
}
