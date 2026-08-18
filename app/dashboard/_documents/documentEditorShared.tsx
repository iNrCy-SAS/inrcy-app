"use client";

import styles from "./documents.module.css";

export type Profile = {
  user_id: string;
  company_legal_name?: string | null;
  hq_address?: string | null;
  hq_zip?: string | null;
  hq_city?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  siren?: string | null;
  rcs_city?: string | null;
  vat_number?: string | null;
  vat_dispense?: boolean | null;
  logo_url?: string | null;
  logo_path?: string | null;
};

export type CrmContact = {
  id: string;
  last_name?: string | null;
  first_name?: string | null;
  company_name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  billing_address?: string | null;
  delivery_address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  siret?: string | null;
  vat_number?: string | null;
  category?: string | null;
  contact_type?: string | null;
};

export type ClientType = "" | "particulier" | "professionnel" | "institution";

export type ServiceDateMode = "single" | "period";

export function normalizeClientType(value: unknown): ClientType {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (
    normalized === "particulier" ||
    normalized === "professionnel" ||
    normalized === "institution"
  )
    return normalized;
  return "";
}

export function inferServiceDateMode(value: {
  serviceDateMode?: unknown;
  serviceDate?: string | null;
  servicePeriodStart?: string | null;
  servicePeriodEnd?: string | null;
}): ServiceDateMode {
  if (
    value.serviceDateMode === "period" ||
    value.serviceDateMode === "single"
  ) {
    return value.serviceDateMode;
  }
  if (value.servicePeriodStart || value.servicePeriodEnd) return "period";
  return "single";
}

export function DocumentDateInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className={styles.dateInputWrap}>
      <input
        className={styles.dateInput}
        type="date"
        lang="fr-FR"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      <span className={styles.dateInputIcon} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7 3v3M17 3v3M4.5 9h15M6.5 5.5h13v15h-15v-15h2Z" />
        </svg>
      </span>
    </div>
  );
}

export function normalizeAddressPart(value?: string | null) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function addressContainsPart(address: string, part: string) {
  if (!address || !part) return false;
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return normalize(address).includes(normalize(part));
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function buildFullCrmAddress(
  address?: string | null,
  postalCode?: string | null,
  city?: string | null,
) {
  const parts: string[] = [];
  const base = normalizeAddressPart(address);
  if (base) parts.push(base);

  [postalCode, city]
    .map(normalizeAddressPart)
    .filter(Boolean)
    .forEach((part) => {
      const current = parts.join(" ");
      if (!addressContainsPart(current, part)) parts.push(part);
    });

  return parts.join(" ").trim();
}

export function splitFrenchAddress(value?: string | null) {
  const clean = normalizeAddressPart(value);
  const match = clean.match(/^(.*?)\s+(\d{5})\s+(.+)$/);
  if (!match) return { address: clean, postal_code: "", city: "" };
  return {
    address: normalizeAddressPart(match[1]),
    postal_code: normalizeAddressPart(match[2]),
    city: normalizeAddressPart(match[3]),
  };
}

export const PAYMENT_METHODS = [
  { key: "", labelKey: null },
  { key: "virement", labelKey: "virement_bancaire_8306f08e" },
  { key: "cb", labelKey: "carte_bancaire_9e3d9bfa" },
  { key: "cheque", labelKey: "cheque_8bbb89a9" },
  { key: "especes", labelKey: "especes_b7679d62" },
  { key: "abonnement", labelKey: "abonnement_96422751" },
] as const;

export const OPERATION_CATEGORY_OPTIONS = [
  { key: "", labelKey: null },
  { key: "vente", labelKey: "vente_9e7753e0" },
  { key: "prestation", labelKey: "prestation_de_services_700b1a5a" },
  { key: "mixte", labelKey: "vente_prestation_c004923b" },
] as const;
