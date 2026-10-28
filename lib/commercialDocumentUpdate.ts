import type { JSONSchema7 } from "@ai-sdk/provider";
import { COMMERCIAL_UUID } from "./commercialDocumentDraft.ts";
import { commercialDocumentRow as row } from "./commercialDocumentValidation.ts";

export const COMMERCIAL_DOCUMENT_EDIT_FIELDS = ["number", "clientName", "clientEmail", "clientType", "clientSiren", "clientVatNumber", "billingAddress", "billingPostalCode", "billingCity", "documentDate", "dueDate", "validityDays", "operationCategory", "notes", "paymentMethod", "paymentDetails", "discountKind", "discountValue", "discountDetails", "quoteMention", "invoiceMention"] as const;
type Field = typeof COMMERCIAL_DOCUMENT_EDIT_FIELDS[number];
export type CommercialDocumentUpdate = {
  kind: "devis" | "facture"; documentId: string; expectedUpdatedAt: string;
  changes: { fields: Array<{ field: Field; value: string | number }>; lines: Array<{ id: string; label: string | null; qty: number | null; unitPrice: number | null; vatRate: number | null }>; addLines: Array<{ label: string; qty: number; unitPrice: number; vatRate: number }>; removeLineIds: string[] };
};
const strict = (value: unknown, keys: readonly string[]) => { const data = row(value); if (Object.keys(data).some(key => !keys.includes(key))) throw new Error("Champ non modifiable."); return data; };
const string = (value: unknown, max: number) => { if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Texte invalide."); return value.trim(); };
const number = (value: unknown, min: number, max: number) => { if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("Nombre invalide."); return value; };
function date(value: unknown) { const text = string(value, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text).toISOString().slice(0,10) !== text) throw new Error("Date invalide."); return text; }
export function parseCommercialDocumentUpdate(value: unknown): CommercialDocumentUpdate {
  const input = strict(value, ["kind", "documentId", "expectedUpdatedAt", "changes"]);
  if (!["devis", "facture"].includes(String(input.kind)) || !COMMERCIAL_UUID.test(String(input.documentId)) || typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt.length > 80 || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new Error("Document ou version invalide.");
  const changes = strict(input.changes, ["fields", "lines", "addLines", "removeLineIds"]);
  for (const key of ["fields", "lines", "addLines", "removeLineIds"]) if (!Array.isArray(changes[key]) || changes[key].length > 24) throw new Error("Trop de changements.");
  const fields = (changes.fields as unknown[]).map(value => {
    const item = strict(value, ["field", "value"]), field = item.field as Field;
    if (!COMMERCIAL_DOCUMENT_EDIT_FIELDS.includes(field) || input.kind === "facture" && ["number", "validityDays", "quoteMention"].includes(field) || input.kind === "devis" && ["dueDate", "invoiceMention"].includes(field)) throw new Error("Champ non modifiable pour ce document.");
    const next: string | number = field === "validityDays" ? number(item.value, 1, 3650) : field === "discountValue" ? number(item.value, 0, 1_000_000_000) : field === "documentDate" || field === "dueDate" ? date(item.value) : string(item.value, ["notes", "paymentDetails", "discountDetails", "quoteMention", "invoiceMention"].includes(field) ? 3000 : field === "billingAddress" ? 500 : 254);
    if (field === "validityDays" && !Number.isInteger(next)) throw new Error("Validité invalide.");
    const enums: Partial<Record<Field, string[]>> = { clientType: ["particulier", "professionnel", "institution"], operationCategory: ["", "vente", "prestation", "mixte"], paymentMethod: ["", "virement", "cb", "cheque", "especes", "abonnement"], discountKind: ["", "percent", "amount"] };
    if (enums[field] && !enums[field]!.includes(String(next)) || field === "clientEmail" && next && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(next))) throw new Error("Valeur non valide.");
    return { field, value: next };
  });
  if (new Set(fields.map(item => item.field)).size !== fields.length) throw new Error("Champ dupliqué.");
  const parseLine = (value: unknown, add: boolean) => {
    const line = strict(value, add ? ["label", "qty", "unitPrice", "vatRate"] : ["id", "label", "qty", "unitPrice", "vatRate"]);
    const id = add ? "" : string(line.id, 100); if (!add && !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Ligne invalide.");
    const label = line.label == null && !add ? null : string(line.label, 220); if (label === "") throw new Error("Libellé requis.");
    const qty = line.qty == null && !add ? null : number(line.qty, Number.MIN_VALUE, 1_000_000);
    const unitPrice = line.unitPrice == null && !add ? null : number(line.unitPrice, 0, 10_000_000);
    const vatRate = line.vatRate == null && !add ? null : number(line.vatRate, 0, 20);
    if (vatRate !== null && ![0,5.5,10,20].includes(vatRate)) throw new Error("TVA invalide.");
    return { id, label, qty, unitPrice, vatRate };
  };
  const lines = (changes.lines as unknown[]).map(item => parseLine(item, false));
  const addLines = (changes.addLines as unknown[]).map(item => { const { id: _id, ...line } = parseLine(item, true); return line as CommercialDocumentUpdate["changes"]["addLines"][number]; });
  const removeLineIds = (changes.removeLineIds as unknown[]).map(value => string(value, 100));
  const ids = [...lines.map(line => line.id), ...removeLineIds]; if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error("Lignes dupliquées ou invalides.");
  if (!fields.length && !lines.length && !addLines.length && !removeLineIds.length) throw new Error("Aucun changement.");
  return { kind: input.kind as CommercialDocumentUpdate["kind"], documentId: String(input.documentId), expectedUpdatedAt: input.expectedUpdatedAt, changes: { fields, lines, addLines, removeLineIds } };
}
const lineProperties = { label: { type: ["string", "null"], maxLength: 220 }, qty: { type: ["number", "null"], exclusiveMinimum: 0, maximum: 1_000_000 }, unitPrice: { type: ["number", "null"], minimum: 0, maximum: 10_000_000 }, vatRate: { type: ["number", "null"], enum: [0,5.5,10,20,null] } } as const;
export const COMMERCIAL_DOCUMENT_CHANGES_SCHEMA: JSONSchema7 = { type: "object", additionalProperties: false, properties: {
  fields: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, properties: { field: { type: "string", enum: [...COMMERCIAL_DOCUMENT_EDIT_FIELDS] }, value: { type: ["string", "number"], maxLength: 3000 } }, required: ["field", "value"] } },
  lines: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, properties: { id: { type: "string", maxLength: 100 }, ...lineProperties } as unknown as Record<string, JSONSchema7>, required: ["id", "label", "qty", "unitPrice", "vatRate"] } },
  addLines: { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, properties: { label: { type: "string", maxLength: 220 }, qty: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 }, unitPrice: { type: "number", minimum: 0, maximum: 10_000_000 }, vatRate: { type: "number", enum: [0,5.5,10,20] } }, required: ["label", "qty", "unitPrice", "vatRate"] } },
  removeLineIds: { type: "array", maxItems: 24, items: { type: "string", maxLength: 100 } },
}, required: ["fields", "lines", "addLines", "removeLineIds"] };

export function applyCommercialDocumentChanges(payload: Record<string, unknown>, input: CommercialDocumentUpdate, newLineId: (index: number) => string) {
  if (payload.isFinalized === true || payload.status && payload.status !== "brouillon") throw new Error("Seul un brouillon peut être modifié.");
  const next = { ...payload }, oldLines = Array.isArray(payload.lines) ? payload.lines.map(row) : [];
  for (const id of [...input.changes.lines.map(line => line.id), ...input.changes.removeLineIds]) if (oldLines.filter(line => line.id === id).length !== 1) throw new Error("Ligne inconnue ou ambiguë.");
  for (const item of input.changes.fields) next[item.field === "documentDate" ? input.kind === "devis" ? "docDateISO" : "invoiceDate" : item.field] = item.value;
  next.lines = oldLines.filter(line => !input.changes.removeLineIds.includes(String(line.id))).map(line => {
    const patch = input.changes.lines.find(item => item.id === line.id); return patch ? { ...line, ...Object.fromEntries(Object.entries(patch).filter(([key,value]) => key !== "id" && value !== null)) } : line;
  }).concat(input.changes.addLines.map((line,index) => ({ id: newLineId(index), ...line })));
  if (!(next.lines as unknown[]).length || (next.lines as unknown[]).length > 200) throw new Error("Le document doit contenir une à deux cents lignes.");
  if (next.discountKind === "percent" && Number(next.discountValue) > 100) throw new Error("Remise supérieure à 100 %.");
  if (input.kind === "facture" && next.dueDate && next.invoiceDate && String(next.dueDate) < String(next.invoiceDate)) throw new Error("L’échéance précède la facture.");
  // Keep the legacy full client address in sync with its native split fields.
  if (input.changes.fields.some(item => ["billingAddress", "billingPostalCode", "billingCity"].includes(item.field))) next.clientAddress = [next.billingAddress, next.billingPostalCode, next.billingCity].filter(Boolean).join(" ");
  return next;
}
