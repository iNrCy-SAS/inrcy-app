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
