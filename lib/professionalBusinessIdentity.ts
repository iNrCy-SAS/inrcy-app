const INTERNAL_PRODUCT_IDENTITIES = new Set([
  "inrcy",
  "inrsearch",
  "inrbadge",
  "inragent",
  "inrsend",
  "inrstats",
  "inradn",
  "booster",
  "entrepriseinrcy",
  "societeinrcy",
  "inrcysas",
  "siteinrcy",
  "generateurinrcy",
  "publicationsinrcy",
]);

const INTERNAL_PRODUCT_SUBJECT =
  String.raw`iNr\s*(?:['’]\s*)?(?:Cy|Search|Badge|Agent|Send|Stats|ADN)`;

const COMPANY_ACTION = String.raw`(?:
  est\s+(?:une?\s+)?(?:entreprise|société|agence|artisan|professionnel|spécialiste)
  |(?:propose|offre|accompagne|intervient|réalise|conçoit|développe|fournit|assure|commercialise)\b
  |se\s+(?:spécialise|distingue|positionne)\b
)`.replace(/\s+/g, "");

function clean(value: unknown, max = 180) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function identityKey(value: unknown) {
  return clean(value, 240)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^a-z0-9]/g, "");
}

export function isInternalProductIdentity(value: unknown) {
  return INTERNAL_PRODUCT_IDENTITIES.has(identityKey(value));
}

/**
 * Résout le nom de l'entreprise uniquement depuis des champs d'identité.
 * Les noms de la plateforme et de ses outils ne sont jamais des replis métier.
 */
export function resolveProfessionalCompanyName(...candidates: unknown[]) {
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value && !isInternalProductIdentity(value)) return value;
  }
  return "";
}

/**
 * Répare uniquement les usages où un produit iNrCy est grammaticalement pris
 * pour l'entreprise. Les mentions légitimes comme « utilise iNrCy » ou
 * « publier sur iNr’Search » restent intactes.
 */
export function sanitizeProfessionalIdentityText(
  value: unknown,
  companyName: unknown,
) {
  const input = String(value ?? "");
  if (!input) return "";

  const canonicalName = resolveProfessionalCompanyName(companyName);
  const companySubject = canonicalName || "L’entreprise";
  const companyAfterPreposition = canonicalName || "cette entreprise";
  const prefix = String.raw`(^|[.!?]\s+|[\r\n]+|>\s*|[-–—•]\s+)`;
  const rolePrefix = String.raw`(?:(?:l['’]entreprise|la\s+société)\s+)?`;

  let output = input.replace(
    new RegExp(
      `${prefix}${rolePrefix}${INTERNAL_PRODUCT_SUBJECT}(?=\\s+${COMPANY_ACTION})`,
      "giu",
    ),
    (_match, before: string) => `${before}${companySubject}`,
  );

  output = output.replace(
    new RegExp(
      `${prefix}${rolePrefix}${INTERNAL_PRODUCT_SUBJECT}(?=\\s*,\\s*(?:une?\\s+)?(?:entreprise|société|agence|artisan|professionnel|spécialiste)\\b)`,
      "giu",
    ),
    (_match, before: string) => `${before}${companySubject}`,
  );

  output = output.replace(
    new RegExp(
      String.raw`\b(?:l['’]entreprise|la\s+société)\s+${INTERNAL_PRODUCT_SUBJECT}\b`,
      "giu",
    ),
    companySubject,
  );

  output = output.replace(
    new RegExp(String.raw`\bchez\s+${INTERNAL_PRODUCT_SUBJECT}\b`, "giu"),
    (match) => `${/^Chez\b/.test(match) ? "Chez" : "chez"} ${companyAfterPreposition}`,
  );

  return output;
}

export function sanitizeProfessionalIdentityValue<T>(
  value: T,
  companyName: unknown,
): T {
  if (typeof value === "string") {
    return sanitizeProfessionalIdentityText(value, companyName) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeProfessionalIdentityValue(item, companyName)
    ) as T;
  }
  if (value && typeof value === "object") {
    const sanitized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeProfessionalIdentityValue(item, companyName),
      ]),
    );
    return sanitized as T;
  }
  return value;
}

export const INTERNAL_PRODUCT_COMPANY_NAMES = [
  "iNrCy",
  "iNr’Search",
  "iNr’Badge",
  "iNr’Agent",
  "iNr’Send",
  "iNr’Stats",
  "iNr’ADN",
] as const;
