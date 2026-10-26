import type { JSONSchema7 } from "@ai-sdk/provider";

export type CommercialDocumentDraftInput = {
  kind: "devis" | "facture";
  client: { contactId: string | null; name: string | null; email: string | null; address: string | null; postalCode: string | null; city: string | null; type: "particulier" | "professionnel" | "institution" | null };
  lines: Array<{ label: string; qty: number | null; unitPrice: number | null; vatRate: number | null }>;
  documentDate: string | null; dueDate: string | null; validityDays: number | null; notes: string | null;
};
export const COMMERCIAL_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const row = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strict = (value: unknown, allowed: string[]) => { const data = row(value); if (Object.keys(data).some(key => !allowed.includes(key))) throw new Error("Champs du brouillon invalides."); return data; };
const text = (value: unknown, maximum: number): string | null => {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Texte du brouillon invalide.");
  return value.trim();
};
function date(value: unknown): string | null {
  const valueText = text(value, 10);
  if (valueText === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueText) || !Number.isFinite(Date.parse(`${valueText}T12:00:00Z`)) || new Date(`${valueText}T12:00:00Z`).toISOString().slice(0, 10) !== valueText) throw new Error("Date du brouillon invalide.");
  return valueText;
}
function numeric(value: unknown, maximum: number, allowZero: boolean): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value > maximum || (allowZero ? value < 0 : value <= 0)) throw new Error("Montant ou quantité invalide.");
  return value;
}

export function parseCommercialDocumentDraft(value: unknown): CommercialDocumentDraftInput {
  const data = strict(value, ["kind", "client", "lines", "documentDate", "dueDate", "validityDays", "notes"]);
  if (data.kind !== "devis" && data.kind !== "facture") throw new Error("Type de document invalide.");
  const client = strict(data.client, ["contactId", "name", "email", "address", "postalCode", "city", "type"]);
  const contactId = text(client.contactId, 36);
  if (contactId !== null && !COMMERCIAL_UUID.test(contactId)) throw new Error("Référence client invalide.");
  const email = text(client.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Adresse email invalide.");
  if (client.type != null && !["particulier", "professionnel", "institution"].includes(String(client.type))) throw new Error("Type de client invalide.");
  if (!Array.isArray(data.lines) || data.lines.length < 1 || data.lines.length > 20) throw new Error("Précisez entre une et vingt lignes.");
  const lines = data.lines.map(value => {
    const line = strict(value, ["label", "qty", "unitPrice", "vatRate"]);
    const label = text(line.label, 220);
    const vatRate = numeric(line.vatRate, 20, true);
    if (!label || vatRate !== null && ![0, 5.5, 10, 20].includes(vatRate)) throw new Error("Détail de ligne ou TVA invalide.");
    return { label, qty: numeric(line.qty, 1_000_000, false), unitPrice: numeric(line.unitPrice, 10_000_000, true), vatRate };
  });
  const validityDays = numeric(data.validityDays, 3650, false);
  if (validityDays !== null && !Number.isInteger(validityDays)) throw new Error("Validité invalide.");
  const documentDate = date(data.documentDate);
  const dueDate = date(data.dueDate);
  if (documentDate && dueDate && dueDate < documentDate) throw new Error("L’échéance précède le document.");
  return { kind: data.kind, client: { contactId, name: text(client.name, 180), email, address: text(client.address, 500), postalCode: text(client.postalCode, 25), city: text(client.city, 100), type: client.type as CommercialDocumentDraftInput["client"]["type"] ?? null },
    lines, documentDate, dueDate, validityDays, notes: text(data.notes, 3000) };
}

const string = (maxLength: number): JSONSchema7 => ({ type: ["string", "null"], maxLength });
export const COMMERCIAL_DOCUMENT_DRAFT_SCHEMA: JSONSchema7 = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["devis", "facture"] },
    client: { type: "object", additionalProperties: false, properties: {
      contactId: { type: ["string", "null"], pattern: COMMERCIAL_UUID.source }, name: string(180), email: string(254), address: string(500), postalCode: string(25), city: string(100), type: { type: ["string", "null"], enum: ["particulier", "professionnel", "institution", null] },
    }, required: ["contactId", "name", "email", "address", "postalCode", "city", "type"] },
    lines: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", additionalProperties: false, properties: {
      label: { type: "string", minLength: 1, maxLength: 220 }, qty: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 1_000_000 }, unitPrice: { type: ["number", "null"], minimum: 0, maximum: 10_000_000 }, vatRate: { type: ["number", "null"], enum: [0, 5.5, 10, 20, null] },
    }, required: ["label", "qty", "unitPrice", "vatRate"] } },
    documentDate: string(10), dueDate: string(10), validityDays: { type: ["integer", "null"], minimum: 1, maximum: 3650 }, notes: string(3000),
  }, required: ["kind", "client", "lines", "documentDate", "dueDate", "validityDays", "notes"],
};
