type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && Number.isFinite(Date.parse(text(value))) && new Date(text(value)).toISOString().slice(0, 10) === text(value);
export const commercialDocumentRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

/** Persist the same tax rates shown by the editor, without changing its source or a saved document. */
export function commercialDocumentLinesForEditor<T extends { vatRate: number }>(lines: readonly T[], vatDispense: boolean): T[] {
  return lines.map(line => vatDispense && line.vatRate !== 0 ? { ...line, vatRate: 0 } : line);
}

/** Keep the server's explicit completion details visible instead of showing only its generic error. */
export function commercialDocumentCompletionError(value: unknown, fallback: string, translate?: (key: string, values?: Record<string, string | number>) => string): string {
  const result = commercialDocumentRow(value);
  const missingFields = Array.isArray(result.missingFields)
    ? [...new Set(result.missingFields.filter((field): field is string => typeof field === "string").map(field => field.trim()).filter(Boolean))].slice(0, 10)
    : [];
  if (missingFields.length && translate) {
    const fieldKeys: Record<string, string> = {
      "Nom du client": "nom_du_client_8626bd1c",
      "Adresse de facturation": "completion_billing_address",
      "Code postal": "code_postal_74779109",
      "Ville": "ville_97217611",
      "Type de client": "type_de_client_b2406987",
      "SIREN du client": "siren_client_70e2fa4d",
      "Email client valide": "completion_valid_email",
      "Date de facture": "date_de_facture_f1edd0d6",
      "Date d’échéance": "echeance_f9a77ff6",
      "Catégorie d’opération": "categorie_d_operation_298de450",
      "Numéro du devis": "numero_de_devis_fefc5f0c",
      "Date du devis": "date_du_devis_0029f3d6",
      "Validité du devis": "duree_de_validite_jours_f911e91b",
      "Lignes du document": "completion_document_lines",
      "Libellé, quantité et prix HT de chaque ligne": "completion_line_description_quantity_price",
      "Taux de TVA de chaque ligne": "completion_line_vat",
    };
    return translate("completion_missing_fields", { fields: missingFields.map(field => fieldKeys[field] ? translate(fieldKeys[field]) : field).join(" · ") });
  }
  return missingFields.length ? `À compléter : ${missingFields.join(" · ")}.` : text(result.error) || fallback;
}

/** Native editor prerequisites, checked again on the server without inventing values. */
export function commercialDocumentMissingFields(kind: "devis" | "facture", payload: Row): string[] {
  const missing = new Set<string>();
  const required = { clientName: "Nom du client", billingAddress: "Adresse de facturation", billingPostalCode: "Code postal", billingCity: "Ville" };
  for (const [key, label] of Object.entries(required)) if (!text(payload[key])) missing.add(label);
  if (!["particulier", "professionnel", "institution"].includes(text(payload.clientType))) missing.add("Type de client");
  if (payload.clientType !== "particulier" && !text(payload.clientSiren)) missing.add("SIREN du client");
  if (text(payload.clientEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(payload.clientEmail))) missing.add("Email client valide");
  if (kind === "facture") {
    if (!date(payload.invoiceDate)) missing.add("Date de facture");
    if (!date(payload.dueDate) || date(payload.invoiceDate) && String(payload.dueDate) < String(payload.invoiceDate)) missing.add("Date d’échéance");
    if (payload.clientType !== "particulier" && !text(payload.operationCategory)) missing.add("Catégorie d’opération");
  } else {
    if (!text(payload.number)) missing.add("Numéro du devis");
    if (!date(payload.docDateISO)) missing.add("Date du devis");
    if (!Number.isFinite(Number(payload.validityDays)) || Number(payload.validityDays) < 1) missing.add("Validité du devis");
  }
  const lines = Array.isArray(payload.lines) ? payload.lines : [];
  if (!lines.length || lines.length > 200) missing.add("Lignes du document");
  for (const item of lines) {
    const line = commercialDocumentRow(item);
    if (!text(line.label) || typeof line.qty !== "number" || !Number.isFinite(line.qty) || line.qty <= 0 || typeof line.unitPrice !== "number" || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 || line.qty * line.unitPrice > 1_000_000_000) missing.add("Libellé, quantité et prix HT de chaque ligne");
    if (typeof line.vatRate !== "number" || ![0, 5.5, 10, 20].includes(line.vatRate) || payload.vatDispense === true && line.vatRate !== 0) missing.add("Taux de TVA de chaque ligne");
  }
  return [...missing];
}

/** Allocation may update numbering metadata, never business fields. */
export function commercialDocumentContentVersion(payload: Row): string {
  const metadata = new Set(["number", "status", "isFinalized", "finalizedAt", "lockedAt", "officialNumberAssignedAt", "officialSequenceYear", "officialSequenceValue"]);
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return JSON.stringify(stable(Object.fromEntries(Object.entries(payload).filter(([key]) => !metadata.has(key)))));
}
