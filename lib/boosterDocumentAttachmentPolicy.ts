import { BOOSTER_PDF_STORAGE_BUCKET, BOOSTER_PDF_STORAGE_FOLDER, type BoosterPdfAttachmentRef } from "./boosterPdfAttachmentPolicy.ts";

export const BOOSTER_DOCUMENT_MAX_COUNT = 5;
export const BOOSTER_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const BOOSTER_DOCUMENT_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const BOOSTER_DOCUMENT_MAX_TEXT_CHARS = 6_500;
export const BOOSTER_DOCUMENT_TOTAL_TEXT_CHARS = 12_000;
export const BOOSTER_DOCUMENT_STORAGE_BUCKET = BOOSTER_PDF_STORAGE_BUCKET;
export const BOOSTER_DOCUMENT_STORAGE_FOLDER = BOOSTER_PDF_STORAGE_FOLDER;
export const BOOSTER_DOCUMENT_ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain";
export type BoosterDocumentAttachmentRef = BoosterPdfAttachmentRef;
export type DocumentMetadata = { name?: unknown; type?: unknown; size?: unknown };
const mimeTypes: Record<string, string> = {
  pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", csv: "text/csv", txt: "text/plain",
};
export function getBoosterDocumentMimeType(name: unknown) {
  return mimeTypes[String(name || "").split(".").pop()?.toLowerCase() || ""] || "";
}
export function validateBoosterDocumentSelection(files: readonly DocumentMetadata[]) {
  if (files.length > BOOSTER_DOCUMENT_MAX_COUNT) return "Ajoutez 5 documents maximum au total.";
  let total = 0;
  for (const file of files) {
    if (!file || typeof file !== "object") return "Document invalide.";
    const expected = getBoosterDocumentMimeType(file.name);
    const supplied = String(file.type || "").toLowerCase().trim();
    if (!expected || supplied && ![expected, "application/octet-stream", "application/zip", "text/plain", ...(expected === "text/csv" ? ["application/csv", "application/vnd.ms-excel"] : []), ...(expected === "application/pdf" ? ["application/x-pdf"] : [])].includes(supplied)) {
      return "Formats acceptés : PDF, Word (.docx), Excel (.xlsx), CSV et TXT.";
    }
    const size = Number(file.size);
    if (!Number.isSafeInteger(size) || size <= 0) return "Ce document est vide ou illisible.";
    if (size > BOOSTER_DOCUMENT_MAX_BYTES) return "Chaque document doit peser 8 Mo maximum.";
    total += size;
    if (total > BOOSTER_DOCUMENT_TOTAL_MAX_BYTES) return "Les documents doivent peser 20 Mo maximum au total.";
  }
  return null;
}
export function normalizeBoosterDocumentReferences(value: unknown, userId: string): BoosterDocumentAttachmentRef[] {
  if (!Array.isArray(value)) throw new Error("La liste des documents est invalide.");
  const error = validateBoosterDocumentSelection(value);
  if (error) throw new Error(error);
  const paths = new Set<string>();
  return value.map(file => {
    if (!file || typeof file !== "object") throw new Error("Document invalide.");
    const path = String(file.path || "");
    if (file.bucket !== BOOSTER_DOCUMENT_STORAGE_BUCKET || !path.startsWith(`${userId}/${BOOSTER_DOCUMENT_STORAGE_FOLDER}/`) || path.includes("..") || /[\u0000-\u001f\\]/.test(path) || paths.has(path)) {
      throw new Error("La référence du document est invalide. Ajoutez-le à nouveau.");
    }
    paths.add(path);
    const originalName = String(file.name);
    const suffix = originalName.slice(originalName.lastIndexOf("."));
    const name = originalName.length > 160 ? originalName.slice(0, 160 - suffix.length) + suffix : originalName;
    return { bucket: BOOSTER_DOCUMENT_STORAGE_BUCKET, path, name, type: getBoosterDocumentMimeType(file.name), size: Number(file.size) };
  });
}
