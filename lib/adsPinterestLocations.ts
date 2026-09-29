const PINTEREST_COUNTRY_ALIASES: Record<string, string> = {
  france: "FR",
  belgique: "BE",
  belgium: "BE",
  suisse: "CH",
  switzerland: "CH",
  luxembourg: "LU",
  espagne: "ES",
  spain: "ES",
  italie: "IT",
  italy: "IT",
  allemagne: "DE",
  germany: "DE",
  portugal: "PT",
  paysbas: "NL",
  netherlands: "NL",
  royaumeuni: "GB",
  unitedkingdom: "GB",
  grandebretagne: "GB",
  irlande: "IE",
  ireland: "IE",
  autriche: "AT",
  austria: "AT",
  canada: "CA",
  etatsunis: "US",
  unitedstates: "US",
};

function normalizedCountry(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/gi, "").toLowerCase();
}

/**
 * Pinterest's current live adapter accepts country targeting only. Profiles
 * and old drafts can still contain cities, departments or service areas, so
 * extract an explicit country without turning an unknown local label into an
 * invented country.
 */
export function pinterestCountryCode(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();

  const whole = PINTEREST_COUNTRY_ALIASES[normalizedCountry(raw)];
  if (whole) return whole;

  // Handles labels such as "Lille, France" and "Île-de-France" while a
  // standalone city such as "Lille" remains unresolved.
  for (const token of raw.split(/[,;/|()\[\]\s-]+/)) {
    const code = PINTEREST_COUNTRY_ALIASES[normalizedCountry(token)];
    if (code) return code;
  }
  return null;
}

export function pinterestCountryCodes(
  locations: readonly unknown[],
  fallbackCountry?: unknown,
): string[] {
  const codes = locations.map(pinterestCountryCode).filter((code): code is string => Boolean(code));
  const fallback = pinterestCountryCode(fallbackCountry);
  if (!codes.length && fallback) codes.push(fallback);
  return [...new Set(codes)];
}

/**
 * Used at generation/reopen time. Explicit countries win; when none can be
 * inferred, retain the professional's labels so they can still be reviewed.
 * The final publisher gets a fresh advertiser-country fallback from Pinterest.
 */
export function normalizePinterestAutomaticLocations(
  locations: readonly string[],
  fallbackCountry?: unknown,
): string[] {
  const codes = pinterestCountryCodes(locations, fallbackCountry);
  if (codes.length) return codes;
  return [...new Set(locations.map((location) => location.trim()).filter(Boolean))];
}
