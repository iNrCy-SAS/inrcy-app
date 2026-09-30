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
 * Recognize only an entire country label. A country suffix in a local zone
 * never authorizes national delivery.
 */
export function pinterestCountryCode(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();

  const whole = PINTEREST_COUNTRY_ALIASES[normalizedCountry(raw)];
  if (whole) return whole;

  // A country mentioned inside a city/region label is context, not consent
  // to target the whole country (e.g. Lille, France or Île-de-France).
  return null;
}

export function pinterestCountryCodes(
  locations: readonly unknown[],
  fallbackCountry?: unknown,
): string[] {
  void fallbackCountry;
  const codes = locations.map(pinterestCountryCode).filter((code): code is string => Boolean(code));
  return [...new Set(codes)];
}

/**
 * Preserve every reviewed local label when generating or reopening a draft.
 * The advertiser's own country is never an audience-selection fallback.
 */
export function normalizePinterestAutomaticLocations(
  locations: readonly string[],
  fallbackCountry?: unknown,
): string[] {
  void fallbackCountry;
  return [...new Set(locations.map((location) => pinterestCountryCode(location) || location.trim()).filter(Boolean))];
}

type PinterestLocationOption = { id: string; name: string };
type PinterestGeographyType = "LOCATION" | "GEO";
export type PinterestGeographyOption = PinterestLocationOption & {
  type: PinterestGeographyType;
  kind: "country" | "metro" | "region" | "unknown";
};

export type PinterestResolvedTargeting = {
  LOCATION?: string[];
  GEO?: string[];
  LOCALE: string[];
};

export function pinterestLocationOptions(payload: unknown, type: PinterestGeographyType | "LOCALE" = "LOCATION"): PinterestLocationOption[] {
  const rows = Array.isArray(payload) ? payload : [payload];
  return rows.flatMap((row) => row && typeof row === "object"
    ? Object.entries(row).filter(([id, name]) =>
      (type === "LOCATION" ? /^(?:[A-Z]{2}|\d+)$/.test(id)
        : type === "LOCALE" ? /^[a-z]{2}(?:[-_][A-Z]{2})?$/i.test(id)
          : /^[A-Za-z0-9][A-Za-z0-9_: .-]{0,79}$/.test(id))
      && typeof name === "string" && name.trim())
      .map(([id, name]) => ({ id, name: String(name) })) : []);
}

function matchKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function locationKeys(value: string): string[] {
  const keys = [matchKey(value)];
  const parts = value.split(/[:,]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    const firstCountry = pinterestCountryCode(parts[0]);
    const lastCountry = pinterestCountryCode(parts[1]);
    if (firstCountry) keys.push(`${firstCountry.toLowerCase()} ${matchKey(parts[1])}`);
    if (lastCountry) keys.push(`${lastCountry.toLowerCase()} ${matchKey(parts[0])}`);
  }
  return keys;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Real GEO responses group region/metro objects under each country code. */
export function pinterestGeographyOptions(locationPayload: unknown, geoPayload: unknown): PinterestGeographyOption[] {
  const options: PinterestGeographyOption[] = pinterestLocationOptions(locationPayload).map((option) => ({
    ...option, type: "LOCATION", kind: /^[A-Z]{2}$/.test(option.id) ? "country" : "metro",
  }));
  for (const row of Array.isArray(geoPayload) ? geoPayload : [geoPayload]) {
    for (const [countryCode, countryValue] of Object.entries(object(row))) {
      if (!/^[A-Z]{2}$/.test(countryCode)) continue;
      const country = object(countryValue);
      if (typeof country.country !== "string" || !country.country.trim()) continue;
      for (const [id, value] of Object.entries(object(country.regions))) {
        const region = object(value);
        if (!id.startsWith(`${countryCode}-`) || !/^[A-Z]{2}-[A-Z0-9-]+$/.test(id)
          || region.country !== countryCode || typeof region.name !== "string" || !region.name.trim()) continue;
        options.push({ id, name: `${country.country}: ${region.name}`, type: "GEO", kind: "region" });
      }
      // Metros from GEO are still LOCATION values, not GEO values.
      for (const [id, value] of Object.entries(object(country.metros))) {
        const metro = object(value);
        if (!/^\d+$/.test(id) || metro.country !== countryCode || typeof metro.name !== "string" || !metro.name.trim()) continue;
        options.push({ id, name: `${country.country}: ${metro.name}`, type: "LOCATION", kind: "metro" });
      }
    }
  }
  // Also accept the documented flat map shape, retaining unknown GEO semantics.
  for (const option of pinterestLocationOptions(geoPayload, "GEO")) {
    options.push({ ...option, type: "GEO", kind: "unknown" });
  }
  return [...new Map(options.map((option) => [`${option.type}:${option.id}`, option])).values()];
}

/** Search only catalog entries belonging to the advertiser's country. */
export function searchPinterestGeographyOptions(
  options: readonly PinterestGeographyOption[], countryCode: string, query: string,
): PinterestGeographyOption[] {
  const country = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return [];
  const countryName = options.find((option) => option.type === "LOCATION" && option.id === country)?.name;
  const terms = matchKey(query).split(" ").filter(Boolean);
  return options.filter((option) => {
    const belongsToCountry = option.type === "LOCATION" && option.id === country
      || option.type === "GEO" && option.kind === "region" && option.id.startsWith(`${country}-`)
      || Boolean(countryName && option.name.includes(":")
        && matchKey(option.name.split(":")[0]) === matchKey(countryName));
    if (!belongsToCountry) return false;
    const key = matchKey(`${option.id} ${option.name}`);
    return terms.every((term) => key.includes(term));
  }).sort((left, right) => {
    // Local options come first; listing a country never selects it implicitly.
    const countryOrder = Number(left.kind === "country") - Number(right.kind === "country");
    return countryOrder || left.name.localeCompare(right.name, "fr");
  }).slice(0, 40);
}

/** Resolve only exact provider labels/codes. Never approximate a town by a country. */
export function matchPinterestTargetLocations(locations: readonly string[], payload: unknown): string[] {
  return matchPinterestGeographies(locations, payload, undefined).LOCATION || [];
}

export function matchPinterestGeographies(
  locations: readonly string[], locationPayload: unknown, geoPayload: unknown,
): Pick<PinterestResolvedTargeting, "LOCATION" | "GEO"> {
  if (!locations.length || locations.length > 20 || locations.some((value) => !value.trim() || value.length > 120)) {
    throw new Error("Choisissez entre 1 et 20 zones Pinterest valides avant publication.");
  }
  const options = pinterestGeographyOptions(locationPayload, geoPayload);
  const ids: Record<PinterestGeographyType, string[]> = { LOCATION: [], GEO: [] };
  for (const location of locations) {
    const code = pinterestCountryCode(location);
    const keys = locationKeys(location);
    const matches = options.filter((option) => code
      ? option.type === "LOCATION" && option.id === code
      : option.id.toLowerCase() === location.trim().toLowerCase()
        || locationKeys(option.name).some((key) => keys.includes(key))
        || (option.name.includes(":") && matchKey(option.name.split(":").slice(1).join(":")) === matchKey(location)));
    const unique = [...new Map(matches.map((option) => [`${option.type}:${option.id}`, option])).values()];
    if (unique.length !== 1) {
      throw new Error(`La zone « ${location} » n’est pas reconnue de façon unique par Pinterest. Choisissez une zone prise en charge ; aucun élargissement au pays ne sera appliqué.`);
    }
    ids[unique[0].type].push(unique[0].id);
  }
  const locationIds = [...new Set(ids.LOCATION)];
  const geoIds = [...new Set(ids.GEO)];
  // Pinterest disallows mixing regions and postcodes in one GEO array. Its
  // public catalog has no typed subtype, so multiple unclassified GEO IDs
  // remain draft-only instead of guessing their semantics.
  if (geoIds.length > 1 && !geoIds.every((id) => options.some((option) => option.type === "GEO" && option.id === id && option.kind === "region"))) {
    throw new Error("Choisissez une seule zone GEO Pinterest ou plusieurs régions vérifiées. Les codes postaux et régions ne peuvent pas être mélangés dans un groupe d’annonces.");
  }
  return {
    ...(locationIds.length ? { LOCATION: locationIds } : {}),
    ...(geoIds.length ? { GEO: geoIds } : {}),
  };
}

const LANGUAGE_ALIASES: Record<string, string> = {
  francais: "fr", french: "fr", anglais: "en", english: "en", allemand: "de", german: "de",
  espagnol: "es", spanish: "es", italien: "it", italian: "it", neerlandais: "nl", dutch: "nl",
  portugais: "pt", portuguese: "pt",
};

/** Use Pinterest's returned language IDs, never silently target every language. */
export function matchPinterestTargetLanguages(languages: readonly string[], payload: unknown): string[] {
  if (!languages.length || languages.length > 10) throw new Error("Choisissez une langue Pinterest avant publication.");
  const options = pinterestLocationOptions(payload, "LOCALE");
  return [...new Set(languages.map((language) => {
    const requested = language.trim();
    const alias = LANGUAGE_ALIASES[matchKey(requested)];
    const matches = options.filter((option) =>
      option.id.toLowerCase() === (alias || requested).toLowerCase()
      || matchKey(option.name) === matchKey(requested));
    const ids = [...new Set(matches.map((option) => option.id))];
    if (ids.length !== 1) throw new Error(`La langue « ${language} » n’est pas reconnue de façon unique par Pinterest. Utilisez une langue prise en charge.`);
    return ids[0];
  }))];
}
