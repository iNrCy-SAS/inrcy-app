type Target = { urn: string; name: string };
type Resolution = { query: string; suggestions: Target[]; autoSelectedUrn?: string | null };
const key = (query: string) => query.trim().toLocaleLowerCase("fr");
const labelKey = (value: string) => value.split(",")[0].normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/^greater /, "").replace(/ metropolitan area$/, "").replace(/ et peripherie$/, "").replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte");

/** Query bindings are user choices or exact provider defaults, never every search candidate. */
export function removeLinkedInBriefGeoTargets(previous: readonly string[], next: readonly string[], resolutions: readonly Resolution[], targets: readonly Target[], choices: Readonly<Record<string, string>> = {}) {
  const before = new Set(previous.map(key)), retained = new Set(next.map(key));
  const removed = new Set(previous.map(key).filter((query) => !retained.has(query)));
  const chosen = (row: Resolution): string[] => {
    if (Object.hasOwn(choices, key(row.query))) return choices[key(row.query)] ? [choices[key(row.query)]] : [];
    if (row.autoSelectedUrn && targets.some((target) => target.urn === row.autoSelectedUrn)) return [row.autoSelectedUrn];
    return row.suggestions.filter((option) => labelKey(option.name) === labelKey(row.query) && targets.some((target) => target.urn === option.urn)).map((target) => target.urn);
  };
  const removedUrns = new Set(resolutions.filter((row) => removed.has(key(row.query))).flatMap(chosen));
  // Old drafts can be edited before the first lookup finishes. Their native label
  // supplies the association, without inventing a geographic identifier.
  for (const target of targets) if ([...removed].some((query) => labelKey(query) === labelKey(target.name))) removedUrns.add(target.urn);
  const keptUrns = new Set(resolutions.filter((row) => retained.has(key(row.query)) || !before.has(key(row.query))).flatMap(chosen));
  for (const target of targets) if ([...retained].some((query) => labelKey(query) === labelKey(target.name))) keptUrns.add(target.urn);
  const dismissed = targets.filter((target) => removedUrns.has(target.urn) && !keptUrns.has(target.urn)).map((target) => target.urn);
  const dismissedSet = new Set(dismissed);
  return { targets: targets.filter((target) => !dismissedSet.has(target.urn)), dismissed };
}
