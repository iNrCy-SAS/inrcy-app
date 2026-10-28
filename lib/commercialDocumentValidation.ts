type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const date = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && Number.isFinite(Date.parse(text(value))) && new Date(text(value)).toISOString().slice(0, 10) === text(value);
export const commercialDocumentRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

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
