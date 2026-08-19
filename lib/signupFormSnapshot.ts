export const SIGNUP_FORM_METADATA_KEY = "inrcy_signup_form";

export type SignupFormSnapshot = {
  version: 1;
  lastName: string;
  firstName: string;
  email: string;
  companyName: string;
  phone: string;
  consent: boolean;
};

type LooseRecord = Record<string, unknown>;

type SignupRecordLike = LooseRecord & {
  email?: unknown;
  phone?: unknown;
  raw_user_meta_data?: unknown;
  metadata?: unknown;
};

function asRecord(value: unknown): LooseRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as LooseRecord;
}

function clean(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function firstText(maxLength: number, ...values: unknown[]) {
  for (const value of values) {
    const text = clean(value, maxLength);
    if (text) return text;
  }
  return "";
}

export function createSignupFormSnapshot(input: {
  lastName?: unknown;
  firstName?: unknown;
  email?: unknown;
  companyName?: unknown;
  phone?: unknown;
  consent?: unknown;
}): SignupFormSnapshot {
  return {
    version: 1,
    lastName: clean(input.lastName, 120),
    firstName: clean(input.firstName, 120),
    email: clean(input.email, 320),
    companyName: clean(input.companyName, 180),
    phone: clean(input.phone, 80),
    consent: input.consent === true,
  };
}

/**
 * Lit en priorité l'instantané immuable du formulaire public. Les champs
 * historiques restent des replis pour les comptes créés avant son ajout et
 * pour le webhook public.signup_alerts.
 */
export function readSignupFormSnapshot(recordValue: unknown): SignupFormSnapshot {
  const record = asRecord(recordValue) as SignupRecordLike;
  const metadata = {
    ...asRecord(record.metadata),
    ...asRecord(record.raw_user_meta_data),
  };
  const snapshot = asRecord(metadata[SIGNUP_FORM_METADATA_KEY]);

  return createSignupFormSnapshot({
    lastName: firstText(
      120,
      snapshot.lastName,
      snapshot.last_name,
      metadata.last_name,
      metadata.lastName,
      record.last_name,
      record.lastName,
    ),
    firstName: firstText(
      120,
      snapshot.firstName,
      snapshot.first_name,
      metadata.first_name,
      metadata.firstName,
      record.first_name,
      record.firstName,
    ),
    email: firstText(320, snapshot.email, record.email, metadata.email),
    companyName: firstText(
      180,
      snapshot.companyName,
      snapshot.company_name,
      metadata.company_legal_name,
      metadata.company_name,
      metadata.companyName,
      record.company_legal_name,
      record.company_name,
      record.companyName,
    ),
    phone: firstText(80, snapshot.phone, metadata.phone, record.phone),
    consent:
      snapshot.consent === true ||
      metadata.consent === true ||
      record.consent === true,
  });
}
