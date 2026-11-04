/** Public page choices are independent from the private profile and iNrADN. */
export const DEFAULT_INR_SEARCH_DISPLAY_SETTINGS = {
  phone: true, email: true, address: true, contactName: true,
  logo: true, badge: true, website: true, socials: true,
} as const;

export type InrSearchDisplaySettings = { [K in keyof typeof DEFAULT_INR_SEARCH_DISPLAY_SETTINGS]: boolean };

export const DEFAULT_INR_SEARCH_SECTIONS = {
  identity: true, presentation: true, contact: true, hours: true,
  services: true, sectors: true, areas: true, media: true, news: true,
  socials: true, faq: true, trust: true, cta: true,
} as const;

export type InrSearchSectionKey = keyof typeof DEFAULT_INR_SEARCH_SECTIONS;
export type InrSearchSections = Record<InrSearchSectionKey, boolean>;

function normalizeBooleanChoices<T extends Record<string, boolean>>(defaults: T, value: unknown): { [K in keyof T]: boolean } {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = { ...defaults } as { [K in keyof T]: boolean };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    if (typeof source[String(key)] === "boolean") result[key] = source[String(key)] as boolean;
  }
  return result;
}

export function normalizeInrSearchDisplaySettings(value: unknown): InrSearchDisplaySettings {
  return normalizeBooleanChoices(DEFAULT_INR_SEARCH_DISPLAY_SETTINGS, value);
}

export function normalizeInrSearchSections(value: unknown): InrSearchSections {
  return normalizeBooleanChoices(DEFAULT_INR_SEARCH_SECTIONS, value);
}

type PrivateContact = { phone?: unknown; email?: unknown; address?: unknown; zip?: unknown; city?: unknown; country?: unknown; contactName?: unknown };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Also remove hidden contact details repeated in generated descriptions or news text. */
export function createInrSearchPublicTextSanitizer(displayValue: unknown, privateContact: PrivateContact = {}) {
  const display = normalizeInrSearchDisplaySettings(displayValue);
  const patterns: RegExp[] = [];
  const addLiteral = (value: unknown) => {
    const literal = text(value);
    if (literal.length < 3) return;
    patterns.push(new RegExp(escapePattern(literal).replace(/\s+/g, "\\s+"), "giu"));
    const encoded = encodeURIComponent(literal);
    if (encoded !== literal) patterns.push(new RegExp(escapePattern(encoded), "giu"));
  };
  if (!display.phone) {
    const digits = text(privateContact.phone).replace(/\D/g, "");
    if (digits.length >= 6) {
      const aliases = new Set([digits]);
      const french = /^0\d{9}$/.test(digits) ? digits.slice(1) : /^33\d{9}$/.test(digits) ? digits.slice(2) : /^0033\d{9}$/.test(digits) ? digits.slice(4) : "";
      if (french) for (const alias of [`0${french}`, `33${french}`, `0033${french}`]) aliases.add(alias);
      for (const alias of aliases) patterns.push(new RegExp(`(?<!\\d)(?:tel:)?\\+?${alias.split("").join("[\\s().\\-\\u00a0]*")}(?!\\d)`, "giu"));
      if (french) patterns.unshift(new RegExp(`(?<!\\d)(?:tel:)?(?:\\+|00)?33[\\s().\\-\\u00a0]*(?:0[\\s().\\-\\u00a0]*)?${french.split("").join("[\\s().\\-\\u00a0]*")}(?!\\d)`, "giu"));
      addLiteral(privateContact.phone);
    }
  }
  if (!display.email) { addLiteral(privateContact.email); }
  if (!display.address) { addLiteral(privateContact.address); addLiteral(privateContact.zip); }
  if (!display.contactName) addLiteral(privateContact.contactName);
  return (value: string) => patterns.reduce((current, pattern) => current.replace(pattern, ""), value).replace(/(?:mailto:|tel:)(?=\s|$)/giu, "").trim();
}

/** Apply visibility before returning a DTO to metadata, JSON-LD or client components. */
export function applyInrSearchPublicDisplaySettings<T extends object>(value: T, configValue: unknown, privateContact: PrivateContact = {}): T {
  const config = configValue && typeof configValue === "object" && !Array.isArray(configValue) ? configValue as Record<string, unknown> : {};
  const display = normalizeInrSearchDisplaySettings(config.display);
  const sections = normalizeInrSearchSections(config.sections);
  const source = value as Record<string, unknown>;
  const effectiveDisplay = {
    ...display,
    phone: display.phone && sections.contact,
    email: display.email && sections.contact,
    address: display.address && sections.contact,
    contactName: display.contactName && sections.contact,
  };
  const sanitize = createInrSearchPublicTextSanitizer(effectiveDisplay, privateContact);
  const sanitizeDeep = (input: unknown): unknown => {
    if (typeof input === "string") return sanitize(input);
    if (Array.isArray(input)) return input.map(sanitizeDeep);
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([key, child]) => [key, sanitizeDeep(child)]));
    return input;
  };
  const result = sanitizeDeep(source) as Record<string, unknown>;
  result.sections = sections;
  for (const key of ["phone", "email", "contactName"] as const) if (!effectiveDisplay[key]) result[key] = "";
  if (!effectiveDisplay.address) for (const key of ["address", "zip", "city", "country", "addressLine", "googleBusinessUrl"]) result[key] = "";
  if (!display.logo) result.logoUrl = "";
  if (!display.badge) { result.inrBadgeUrl = ""; result.inrBadgeQrUrl = ""; }
  if (!display.website) result.websiteUrl = "";
  if (!display.socials || !sections.socials) result.socialLinks = [];
  else if (Array.isArray(result.socialLinks)) result.socialLinks = result.socialLinks.filter((item) => {
    const key = (item as Record<string, unknown>).key;
    return (display.website || key !== "website") && (effectiveDisplay.address || key !== "google");
  });
  if (!sections.presentation) { result.description = ""; result.pageDescription = ""; }
  if (!sections.hours) { result.openingDays = ""; result.openingHours = ""; }
  if (!sections.services) { result.services = []; result.serviceDescriptions = {}; }
  if (!sections.sectors) for (const key of ["profession", "sectorCategory", "sectorLabel"]) result[key] = "";
  if (!sections.areas) result.zones = [];
  if (!sections.media) result.media = [];
  if (!sections.news) result.publications = [];
  if (!sections.faq) result.faq = [];
  if (!sections.trust) result.strengths = [];
  return result as T;
}
