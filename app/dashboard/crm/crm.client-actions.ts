"use client";

import { useTranslations } from "next-intl";


import { useCallback, type Dispatch, type SetStateAction } from "react";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { buildDisplayName } from "./crm.shared";
import type { Category, ContactType, CrmActionRecipient, CrmContact } from "./crm.types";
import {
  buildFullCrmAddress,
  contactsToCsv,
  downloadTextFile,
  inferImportedDefaults,
  loadXlsxModule,
  normalizeImportedRow,
  parseCsv,
} from "./crm.import-export";

type MutableRef<T> = { current: T | null };
type SetState<T> = Dispatch<SetStateAction<T>>;

type LoadContactsOptions = {
  page?: number;
  pageSize?: number;
  query?: string;
  preserveSuccess?: boolean;
  append?: boolean;
};

type LoadContacts = (options?: LoadContactsOptions) => Promise<unknown>;

export function useCrmImportExportActions({
  fileInputRef,
  setImporting,
  setError,
  setSuccess,
  setPage,
  loadContacts,
  serverQuery,
  categoryFilter,
  typeFilter,
  departmentFilter,
  importantOnly,
  mergeContactWithLocalState,
  setExportingFormat,
}: {
  fileInputRef: MutableRef<HTMLInputElement>;
  setImporting: SetState<boolean>;
  setError: SetState<string | null>;
  setSuccess: SetState<string | null>;
  setPage: SetState<number>;
  loadContacts: LoadContacts;
  serverQuery: string;
  categoryFilter: Category;
  typeFilter: ContactType;
  departmentFilter: string;
  importantOnly: boolean;
  mergeContactWithLocalState: (contact: CrmContact) => CrmContact;
  setExportingFormat: SetState<"" | "csv" | "xlsx">;
}) {
  const i18nT = useTranslations("crm");
async function importContacts(rows: any[]) {
  const inferredDefaults = inferImportedDefaults(rows);
  const cleaned = rows
    .map((row) => normalizeImportedRow(row, inferredDefaults))
    .filter((r) => r.display_name || r.email || r.phone || r.last_name || r.company_name);

  if (cleaned.length === 0) {
    setError(i18nT("aucune_ligne_exploitable_trouvee_dans_le_907c885d"));
    setSuccess(null);
    return;
  }

  setImporting(true);
  setError(null);
  try {
    const r = await fetch("/api/crm/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contacts: cleaned }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Import impossible."));
    setPage(1);
    await loadContacts({ page: 1, preserveSuccess: true });

    const inserted = Math.max(0, Number(j?.inserted ?? cleaned.length));
    const skippedDuplicates = Math.max(0, Number(j?.skipped_duplicates ?? 0));
    const skippedExisting = Math.max(0, Number(j?.skipped_existing ?? 0));
    const ignoredInvalid = Math.max(0, Number(j?.ignored_invalid ?? 0));
    const parts = [`Import terminé : ${inserted} contact(s) ajouté(s).`];
    if (skippedDuplicates > 0) parts.push(`${skippedDuplicates} doublon${skippedDuplicates > 1 ? "s" : ""} ignoré${skippedDuplicates > 1 ? "s" : ""} dans le fichier.`);
    if (skippedExisting > 0) parts.push(`${skippedExisting} email${skippedExisting > 1 ? "s" : ""} déjà présent${skippedExisting > 1 ? "s" : ""} ignoré${skippedExisting > 1 ? "s" : ""}.`);
    if (ignoredInvalid > 0) parts.push(`${ignoredInvalid} ligne${ignoredInvalid > 1 ? "s" : ""} invalide${ignoredInvalid > 1 ? "s" : ""} ignorée${ignoredInvalid > 1 ? "s" : ""}.`);
    setSuccess(parts.join(" "));
  } catch (e: any) {
    setError(getSimpleFrenchErrorMessage(e, "Import impossible."));
  } finally {
    setImporting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
}

async function handleImportFile(file: File) {
  const name = (file?.name || "").toLowerCase();

  if (name.endsWith(".json")) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("Le JSON doit être un tableau de contacts.");
    await importContacts(parsed);
    return;
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const XLSX = await loadXlsxModule();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const firstSheetName = workbook.SheetNames?.[0];
    if (!firstSheetName) throw new Error("Le fichier Excel est vide.");
    const firstSheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    await importContacts(rows);
    return;
  }

  const text = await file.text();
  const rows = parseCsv(text);
  await importContacts(rows);
}

const triggerImport = () => fileInputRef.current?.click();

const fetchAllContactsForCurrentQuery = useCallback(async () => {
  const params = new URLSearchParams({ all: "1" });
  if (serverQuery) params.set("q", serverQuery);
  if (categoryFilter) params.set("category", categoryFilter);
  if (typeFilter) params.set("contactType", typeFilter);
  if (departmentFilter.trim()) params.set("department", departmentFilter.trim());
  if (importantOnly) params.set("important", "1");

  const r = await fetch(`/api/crm/contacts?${params.toString()}`, { method: "GET" });
  if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Export impossible."));
  const j = await r.json().catch(() => ({}));
  const base = Array.isArray(j?.contacts) ? j.contacts : [];
  return base.map((contact: CrmContact) => mergeContactWithLocalState(contact));
}, [mergeContactWithLocalState, serverQuery, categoryFilter, typeFilter, departmentFilter, importantOnly]);

const buildExportRows = useCallback(
  (rows: CrmContact[]) =>
    rows.map((c) => ({
      display_name: buildDisplayName(c),
      last_name: c.last_name ?? "",
      first_name: c.first_name ?? "",
      company_name: c.company_name ?? "",
      siret: c.siret ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      billing_address: c.billing_address ?? "",
      delivery_address: c.delivery_address ?? "",
      vat_number: c.vat_number ?? "",
      city: c.city ?? "",
      postal_code: c.postal_code ?? "",
      category: c.category ?? "",
      contact_type: c.contact_type ?? "",
      notes: (c.notes ?? "") as string,
      important: Boolean((c as any).important),
    })),
  [],
);

const getExportBaseFilename = () => `crm_inrcy_${new Date().toISOString().slice(0, 10)}`;

const exportCsv = async () => {
  setExportingFormat("csv");
  setError(null);
  try {
    const exportedContacts = await fetchAllContactsForCurrentQuery();
    const rows = buildExportRows(exportedContacts);
    const csv = contactsToCsv(rows);
    downloadTextFile(`${getExportBaseFilename()}.csv`, csv, "text/csv;charset=utf-8");
  } catch (e: any) {
    setError(getSimpleFrenchErrorMessage(e, "Export CSV impossible."));
  } finally {
    setExportingFormat("");
  }
};

const exportExcel = async () => {
  setExportingFormat("xlsx");
  setError(null);
  try {
    const XLSX = await loadXlsxModule();
    const exportedContacts = await fetchAllContactsForCurrentQuery();
    const rows = buildExportRows(exportedContacts);
    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 28 },
      { wch: 24 },
      { wch: 18 },
      { wch: 24 },
      { wch: 16 },
      { wch: 28 },
      { wch: 32 },
      { wch: 32 },
      { wch: 18 },
      { wch: 18 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 36 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts CRM");
    XLSX.writeFile(workbook, `${getExportBaseFilename()}.xlsx`, {
      bookType: "xlsx",
      compression: true,
    });
  } catch (e: any) {
    setError(getSimpleFrenchErrorMessage(e, "Export Excel impossible."));
  } finally {
    setExportingFormat("");
  }
};

  return { handleImportFile, triggerImport, exportCsv, exportExcel };
}

type RouterLike = {
  push: (href: string) => void;
};

export function createCrmNavigationActions({
  router,
  actionRecipients,
  actionEmails,
  primaryContact,
}: {
  router: RouterLike;
  actionRecipients: CrmActionRecipient[];
  actionEmails: string[];
  primaryContact: CrmContact | null;
}) {
  const sendMailToAction = () => {
    if (actionRecipients.length === 0) return;

    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(
          "inrcy_pending_mail_compose",
          JSON.stringify({
            to: actionEmails,
            from: "crm",
            contactId: primaryContact?.id || "",
            contactName: primaryContact ? buildDisplayName(primaryContact) : "",
            recipients: actionRecipients,
            createdAt: Date.now(),
          }),
        );
        const params = new URLSearchParams({ compose: "1", from: "crm", prefillStorage: "session" });
        if (primaryContact?.id) params.set("contactId", primaryContact.id);
        if (primaryContact) params.set("contactName", buildDisplayName(primaryContact));
        router.push(`/dashboard/mails?${params.toString()}`);
        return;
      } catch {
        // fallback URL prefill below
      }
    }

    const params = new URLSearchParams({ compose: "1", to: actionEmails.join(","), from: "crm" });
    if (primaryContact?.id) params.set("contactId", primaryContact.id);
    if (primaryContact) params.set("contactName", buildDisplayName(primaryContact));
    router.push(`/dashboard/mails?${params.toString()}`);
  };

  const sendMailToContact = (c: CrmContact) => {
    const to = (c.email || "").trim();
    if (!to) return;
    const contactName = buildDisplayName(c);
    const params = new URLSearchParams({ compose: "1", to, from: "crm" });
    if (contactName) params.set("name", contactName);
    router.push(`/dashboard/mails?${params.toString()}`);
  };

  const buildDocPrefillParams = (c: CrmContact) => {
    const clientName = buildDisplayName(c);
    const clientEmail = (c.email || "").trim();
    const clientAddress = buildFullCrmAddress(c.address, c.postal_code, c.city);
    const billingAddress = buildFullCrmAddress(c.billing_address || c.address, c.postal_code, c.city);
    const deliveryAddress = buildFullCrmAddress(c.delivery_address || c.address, c.postal_code, c.city);
    const params = new URLSearchParams();
    if (clientName) params.set("clientName", clientName);
    if (clientEmail) params.set("clientEmail", clientEmail);
    if (clientAddress) params.set("clientAddress", clientAddress);
    if ((c.siret || "").trim()) params.set("clientSiren", (c.siret || "").trim());
    if ((c.vat_number || "").trim()) params.set("clientVatNumber", (c.vat_number || "").trim());
    if ((c.billing_address || "").trim()) params.set("billingAddress", (c.billing_address || "").trim());
    if ((c.delivery_address || "").trim()) params.set("deliveryAddress", (c.delivery_address || "").trim());
    params.set("from", "crm");
    params.set("contactId", c.id);
    return params;
  };

  const goNewDevis = (c: CrmContact) => {
    const params = buildDocPrefillParams(c);
    router.push(`/dashboard/devis/new?${params.toString()}`);
  };

  const goNewFacture = (c: CrmContact) => {
    const params = buildDocPrefillParams(c);
    router.push(`/dashboard/factures/new?${params.toString()}`);
  };

  const goPlanifierIntervention = (c: CrmContact) => {
    const q = new URLSearchParams();
    q.set("action", "new");
    q.set("contactId", c.id);
    q.set("contactName", buildDisplayName(c));
    if ((c.email || "").trim()) q.set("contactEmail", (c.email || "").trim());
    if ((c.phone || "").trim()) q.set("contactPhone", (c.phone || "").trim());
    if ((c.address || "").trim()) q.set("contactAddress", (c.address || "").trim());
    if ((c.city || "").trim()) q.set("contactCity", (c.city || "").trim());
    if ((c.postal_code || "").trim()) q.set("contactPostalCode", (c.postal_code || "").trim());
    router.push(`/dashboard/agenda?${q.toString()}`);
  };

  return { sendMailToAction, sendMailToContact, goNewDevis, goNewFacture, goPlanifierIntervention };
}
