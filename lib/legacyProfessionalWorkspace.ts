type LegacyBusinessActivityRow = Record<string, unknown>;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstNonBlankText(row: LegacyBusinessActivityRow, keys: string[]): string {
  for (const key of keys) {
    const value = cleanText(row[key]);
    if (value) return value;
  }
  return "";
}

function cleanList(value: unknown, separator: RegExp): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(separator)
      : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const value = String(item ?? "").trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

function firstNonEmptyList(
  row: LegacyBusinessActivityRow,
  keys: string[],
  separator: RegExp,
): string[] {
  for (const key of keys) {
    const values = cleanList(row[key], separator);
    if (values.length > 0) return values;
  }
  return [];
}

/**
 * Resolves the current business-profile columns and every historical fallback
 * used by Mon profil. Empty defaults added by a later SQL migration must not
 * hide populated legacy fields.
 */
export function resolveLegacyBusinessActivityValues(row: LegacyBusinessActivityRow) {
  return {
    activityDescription: firstNonBlankText(row, [
      "business_description",
      "activity_description",
      "company_description",
      "description",
    ]),
    services: firstNonEmptyList(row, ["services", "services_text"], /[;\n]/),
    interventionZones: firstNonEmptyList(
      row,
      ["intervention_zones", "intervention_zones_text", "zones"],
      /[,;\n]/,
    ),
    strengths: firstNonEmptyList(row, ["strengths", "strengths_text"], /[;\n]/),
    customerTypes: firstNonEmptyList(
      row,
      ["customer_typologies", "customer_types", "audiences"],
      /[,;\n]/,
    ),
  };
}
