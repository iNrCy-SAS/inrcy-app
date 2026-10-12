export function normalizeWidgetDomain(input: string | null): string {
  if (!input) return "";
  let raw = input.trim();
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//i, "").replace(/^www\./, "").split("/")[0] || "";
  }
}

/** A disconnected website grants no widget domains, including stored aliases. */
export function isConfiguredSiteWebWidgetDomain(siteWeb: unknown, domainInput: string): boolean {
  const site = siteWeb && typeof siteWeb === "object" && !Array.isArray(siteWeb)
    ? siteWeb as Record<string, unknown> : {};
  const primaryDomain = normalizeWidgetDomain(String(site.url || ""));
  const domain = normalizeWidgetDomain(domainInput);
  if (!primaryDomain || !domain) return false;
  const secondaryDomains = Array.isArray(site.widget_domains) ? site.widget_domains : [];
  return [primaryDomain, ...secondaryDomains.map((entry) => normalizeWidgetDomain(String(entry || "")))].includes(domain);
}
