export type GscSiteEntry = {
  siteUrl: string;
};

export type GscSelectionResolution =
  | "exact_domain_property"
  | "parent_domain_property"
  | "exact_url_prefix"
  | "equivalent_url_prefix";

export type GscSelectionResult =
  | {
      ok: true;
      property: string;
      resolution: GscSelectionResolution;
      accessiblePropertyCount: number;
    }
  | {
      ok: false;
      reason: string;
      accessiblePropertyCount: number;
    };

function normalizeDomain(raw: string): string | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  try {
    const input = /^(https?:\/\/)/i.test(value) ? value : `https://${value}`;
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}

function normalizeUrlPrefix(raw: string, stripWww = false): string | null {
  try {
    const url = new URL(String(raw || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    url.hostname = stripWww ? host.replace(/^www\./, "") : host;
    url.hash = "";
    url.search = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url.toString();
  } catch {
    return null;
  }
}

function uniqueProperties(entries: GscSiteEntry[]) {
  const properties = new Map<string, string>();
  for (const entry of entries) {
    const property = String(entry.siteUrl || "").trim();
    if (!property) continue;
    const key = property.toLowerCase();
    if (!properties.has(key)) properties.set(key, property);
  }
  return Array.from(properties.values());
}

function domainPropertyHost(property: string) {
  if (!property.toLowerCase().startsWith("sc-domain:")) return null;
  return normalizeDomain(property.slice("sc-domain:".length));
}

/**
 * Search Console domain properties cover the root domain and all subdomains.
 * URL-prefix properties are narrower, so they only match the same normalized
 * host (with www/non-www treated as the same canonical host).
 */
export function doesGscPropertyCoverSite(
  property: string,
  domain: string,
  siteUrlHint?: string | null,
) {
  const targetDomain = normalizeDomain(domain);
  if (!targetDomain) return false;

  const domainProperty = domainPropertyHost(property);
  if (domainProperty) {
    return targetDomain === domainProperty || targetDomain.endsWith(`.${domainProperty}`);
  }

  const propertyUrl = normalizeUrlPrefix(property, true);
  if (!propertyUrl) return false;
  const propertyHost = normalizeDomain(propertyUrl);
  if (propertyHost !== targetDomain) return false;

  if (!siteUrlHint) return true;
  const hint = normalizeUrlPrefix(siteUrlHint, true);
  if (!hint) return true;
  return hint.startsWith(propertyUrl);
}

export function selectGscPropertyForSite(
  entries: GscSiteEntry[],
  domain: string,
  siteUrlHint?: string | null,
): GscSelectionResult {
  const properties = uniqueProperties(entries);
  const targetDomain = normalizeDomain(domain);
  if (!targetDomain) {
    return {
      ok: false,
      reason: "Le domaine du site est invalide pour Search Console.",
      accessiblePropertyCount: properties.length,
    };
  }

  const domainMatches = properties
    .map((property) => ({ property, host: domainPropertyHost(property) }))
    .filter(
      (candidate): candidate is { property: string; host: string } =>
        Boolean(candidate.host) &&
        (targetDomain === candidate.host || targetDomain.endsWith(`.${candidate.host}`)),
    )
    .sort((left, right) => right.host.length - left.host.length);

  if (domainMatches.length > 0) {
    const selected = domainMatches[0]!;
    return {
      ok: true,
      property: selected.property,
      resolution:
        selected.host === targetDomain ? "exact_domain_property" : "parent_domain_property",
      accessiblePropertyCount: properties.length,
    };
  }

  const urlProperties = properties.filter(
    (property) => property.startsWith("http://") || property.startsWith("https://"),
  );
  const exactHint = siteUrlHint ? normalizeUrlPrefix(siteUrlHint) : null;
  if (exactHint) {
    const exact = urlProperties.find((property) => normalizeUrlPrefix(property) === exactHint);
    if (exact) {
      return {
        ok: true,
        property: exact,
        resolution: "exact_url_prefix",
        accessiblePropertyCount: properties.length,
      };
    }
  }

  const comparableHint = siteUrlHint ? normalizeUrlPrefix(siteUrlHint, true) : null;
  const equivalent = urlProperties
    .filter((property) => doesGscPropertyCoverSite(property, targetDomain, comparableHint))
    .sort((left, right) => {
      const leftUrl = normalizeUrlPrefix(left, true) || "";
      const rightUrl = normalizeUrlPrefix(right, true) || "";
      return rightUrl.length - leftUrl.length;
    });

  if (equivalent.length > 0) {
    return {
      ok: true,
      property: equivalent[0]!,
      resolution: "equivalent_url_prefix",
      accessiblePropertyCount: properties.length,
    };
  }

  return {
    ok: false,
    reason:
      "Aucune propriété Search Console ne correspond à ce domaine sur ce compte Google. Veuillez ajouter le domaine dans Search Console, ou donner accès à ce compte, puis relancer l’activation.",
    accessiblePropertyCount: properties.length,
  };
}
