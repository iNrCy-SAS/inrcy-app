export const LINKEDIN_GEO_QUERY_LIMIT = 8;

export function linkedInGeoQueryKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

/** A manual lookup stays available even when eight brief locations are present. */
export function buildLinkedInGeoQueries(locations: readonly string[], manualSearch?: string): {
  queries: string[];
  manualOnly: boolean;
} {
  const seen = new Set<string>();
  const briefQueries: string[] = [];
  for (const location of locations) {
    const query = location.trim().replace(/\s+/g, " ");
    if (!query) continue;
    if (query.length < 2 || query.length > 80) {
      throw new Error("Chaque zone LinkedIn du brief doit contenir entre 2 et 80 caractères.");
    }
    const key = linkedInGeoQueryKey(query);
    if (seen.has(key)) continue;
    seen.add(key);
    briefQueries.push(query);
  }
  if (briefQueries.length > LINKEDIN_GEO_QUERY_LIMIT) {
    throw new Error("Vérifiez jusqu’à huit zones du brief à la fois. Retirez une zone avant d’actualiser.");
  }

  const manualQuery = manualSearch?.trim().replace(/\s+/g, " ") || "";
  if (!manualQuery) {
    return { queries: briefQueries, manualOnly: false };
  }
  if (manualQuery.length < 2 || manualQuery.length > 80) {
    throw new Error("La recherche LinkedIn doit contenir entre 2 et 80 caractères.");
  }
  return { queries: [manualQuery], manualOnly: true };
}
