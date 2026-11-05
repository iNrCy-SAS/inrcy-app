import { ACTIVITY_SECTOR_OPTIONS, decodeBusinessSector, encodeBusinessSector } from "./activitySectors.ts";
import { findJobValueByLabel, getJobLabel, isValidJobForSector } from "./activityCatalog.ts";

export const BUSINESS_IDENTITY_COLUMNS = {
  firstName: "first_name", lastName: "last_name", contactEmail: "contact_email", phone: "phone", companyName: "company_legal_name",
  address: "hq_address", postalCode: "hq_zip", city: "hq_city", country: "hq_country", logoPath: "logo_path",
  legalForm: "legal_form", legalFormOther: "legal_form_other", siren: "siren", rcsCity: "rcs_city", capitalSocial: "capital_social",
  capitalDispenseEi: "capital_dispense_ei", vatNumber: "vat_number", vatDispense: "vat_dispense",
} as const;
export type BusinessIdentityField = keyof typeof BUSINESS_IDENTITY_COLUMNS;
export const BUSINESS_IDENTITY_FIELDS = Object.keys(BUSINESS_IDENTITY_COLUMNS) as BusinessIdentityField[];
export const BUSINESS_IDENTITY_PROFILE_SELECT = ["user_id", ...Object.values(BUSINESS_IDENTITY_COLUMNS)].join(",");
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const BOOLEAN_FIELDS = new Set(["capitalDispenseEi", "vatDispense"]);
const LEGAL_FORMS = new Set(["EI", "EURL", "SARL", "SAS", "SASU", "AUTRE"]);

/** The same public profile columns used by the native profile/legal forms.
 * No login identity, membership, bank account or subscription is writable. */
export function normalizeBusinessIdentityChange(field: string, value: unknown, accountId: string): string | boolean {
  if (!BUSINESS_IDENTITY_FIELDS.includes(field as BusinessIdentityField)) throw new Error("Champ d’identité inconnu.");
  if (BOOLEAN_FIELDS.has(field)) {
    if (typeof value !== "boolean") throw new Error("Valeur d’identité invalide.");
    return value;
  }
  if (typeof value !== "string" || value.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Texte d’identité invalide.");
  const clean = value.trim();
  if (/\bBearer\s+\S+|\b(?:sk-(?:proj-)?|sb_secret_)[a-z0-9_-]{12,}|(?:password|mot de passe|api[_ -]?key|access[_ -]?token)\s*[:=]/i.test(clean)) throw new Error("Les secrets ne sont pas des coordonnées professionnelles.");
  if (["firstName", "lastName", "companyName", "phone", "contactEmail", "city", "postalCode"].includes(field) && !clean) throw new Error("Ce champ ne peut pas être effacé par cette action.");
  if (field === "contactEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("Email professionnel invalide.");
  if (field === "phone" && (!/^[+() .\-/\d]{6,40}$/.test(clean) || clean.replace(/\D/g, "").length < 6)) throw new Error("Téléphone professionnel invalide.");
  if (field === "postalCode" && (clean.length > 20 || !/[\p{L}\p{N}]/u.test(clean))) throw new Error("Code postal invalide.");
  if (field === "siren" && clean && !/^\d{9}$/.test(clean.replace(/\s/g, ""))) throw new Error("Le SIREN doit comporter neuf chiffres.");
  if (field === "legalForm" && !LEGAL_FORMS.has(clean)) throw new Error("Forme juridique inconnue.");
  if (field === "logoPath" && clean && !["png", "jpg", "webp", "svg"].some(extension => clean === `${accountId}/logo.${extension}`)) throw new Error("Le logo doit être un fichier déjà importé pour cet établissement.");
  return field === "siren" ? clean.replace(/\s/g, "") : field === "country" ? clean || "France" : clean;
}

export function normalizeBusinessProfession(sectorCategory: string, profession: string) {
  if (!ACTIVITY_SECTOR_OPTIONS.some(option => option.value === sectorCategory)) throw new Error("Choisissez un secteur du catalogue.");
  const clean = profession.trim();
  if (!clean || clean.length > 160 || /[\u0000-\u001f]/.test(clean)) throw new Error("Métier invalide.");
  const code = isValidJobForSector(sectorCategory, clean) ? clean : findJobValueByLabel(sectorCategory, clean);
  if (sectorCategory !== "autre" && !code) throw new Error("Ce métier ne correspond pas au secteur choisi ; recherchez le métier exact.");
  const label = code ? getJobLabel(sectorCategory, code) : clean;
  return { sectorCategory, profession: code || clean, professionLabel: label, sector: encodeBusinessSector(sectorCategory, label) };
}

export function projectBusinessIdentity(profile: unknown, business: unknown) {
  const source = row(profile), activity = row(business);
  const fields: Record<string, string | boolean> = {};
  for (const [key, column] of Object.entries(BUSINESS_IDENTITY_COLUMNS)) fields[key] = BOOLEAN_FIELDS.has(key) ? source[column] === true : String(source[column] ?? "");
  const decoded = decodeBusinessSector(String(activity.sector ?? ""));
  const missingFields = [
    ...(!String(fields.companyName).trim() ? ["company"] : []),
    ...(!/\d{6}/.test(String(fields.phone).replace(/\D/g, "")) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.contactEmail)) ? ["contact"] : []),
    ...(!decoded.profession.trim() ? ["profession"] : []),
    ...(!String(fields.city).trim() ? ["city"] : []),
    ...(!String(fields.postalCode).trim() ? ["postalCode"] : []),
  ];
  return { fields, activity: { sectorCategory: decoded.sectorCategory, professionLabel: decoded.profession }, missingFields };
}
