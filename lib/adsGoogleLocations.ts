/** Keep the professional's geographic intent, while removing obvious prose
 * that cannot match a Google Ads geo target constant. */
export function normalizeGoogleTargetLocationLabels(locations: string[]): string[] {
  const labels = new Map<string, string>();
  for (const value of locations) {
    const raw = String(value || "").trim().replace(/\s+/g, " ").replace(/^[,;]+|[,;]+$/g, "");
    if (!raw) continue;
    const plain = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
    const label = /^(?:(?:et|dans)\s+)?(?:toute\s+la\s+|la\s+)?france(?:\s+entiere)?$/.test(plain)
      ? "France"
      : raw;
    const key = label.toLocaleLowerCase("fr-FR");
    if (!labels.has(key)) labels.set(key, label);
  }
  return [...labels.values()].slice(0, 20);
}

export type GoogleLocationOption = { id: string; name: string; canonicalName: string; country: string };

/** Only provider-confirmed, enabled geographic constants may be offered. */
export function googleLocationSuggestions(payload: unknown): GoogleLocationOption[] {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const suggestions = record(payload).geoTargetConstantSuggestions;
  if (suggestions !== undefined && !Array.isArray(suggestions)) throw new Error("Réponse de ciblage Google Ads invalide.");
  const options = new Map<string, GoogleLocationOption>();
  for (const value of Array.isArray(suggestions) ? suggestions : []) {
    const target = record(record(value).geoTargetConstant);
    const match = typeof target.resourceName === "string" ? target.resourceName.match(/^geoTargetConstants\/(\d+)$/) : null;
    const name = typeof target.name === "string" ? target.name.trim() : "";
    const canonicalName = typeof target.canonicalName === "string" ? target.canonicalName.trim() : "";
    const country = typeof target.countryCode === "string" ? target.countryCode : "";
    if (!match || !name || !canonicalName || canonicalName.length > 120 || !/^[A-Z]{2}$/.test(country) || target.status !== "ENABLED") continue;
    if (target.id !== undefined && String(target.id) !== match[1]) continue;
    options.set(match[1], { id: match[1], name, canonicalName, country });
  }
  return [...options.values()].slice(0, 40);
}

/** Called only by an explicit choice of a Google suggestion in the studio. */
export function selectGoogleTargetLocation(locations: readonly string[], option: GoogleLocationOption): string[] {
  const key = (value: string) => value.trim().toLocaleLowerCase("fr-FR");
  const selected = locations.some((location) => key(location) === key(option.canonicalName));
  const replacesUnqualifiedName = key(option.name) !== key(option.canonicalName)
    && locations.some((location) => key(location) === key(option.name));
  if (!replacesUnqualifiedName) return selected ? [...locations] : [...locations, option.canonicalName];
  const replaced = locations.map((location) => key(location) === key(option.name) ? option.canonicalName : location);
  return replaced.filter((location, index) => replaced.findIndex((entry) => key(entry) === key(location)) === index);
}
