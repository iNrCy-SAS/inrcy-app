import "server-only";
import { createClient } from "@supabase/supabase-js";
import { analyseAiMemoryReferenceDocument } from "@/lib/aiAttachmentContext";
import type { AiPreferredEngine } from "@/lib/aiEnginePreference";
import {
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES,
  type AiMemoryReferenceDocument,
} from "@/lib/aiMemory";

export const BUSINESS_DNA_DOCUMENT_EXTRACT_CHARS = 30_000;

/** Relit les fichiers textuels déjà consentis, sans modifier les documents
 * persistés ni lancer d'analyse visuelle payante. Un incident Storage conserve
 * l'extrait déjà disponible. Deux téléchargements maximum à la fois. */
export async function refreshBusinessDnaReferenceDocuments(
  documents: AiMemoryReferenceDocument[],
  options: { accountId: string; engine: AiPreferredEngine; storageClient?: any },
): Promise<AiMemoryReferenceDocument[]> {
  if (!documents.length) return documents;
  const storageClient = options.storageClient ?? createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
    },
  );
  const result = [...documents];
  let index = 0;
  let reservedBytes = 0;
  async function worker() {
    while (index < documents.length) {
      const currentIndex = index++;
      const document = documents[currentIndex];
      const extension = /\.(pdf|docx)$/i.exec(document.name)?.[1]?.toLowerCase();
      if (!extension || document.bucket !== "inrcy-ai-documents" ||
          !document.path.startsWith(`users/${options.accountId}/ai-memory-documents/`) ||
          document.path.includes("..") || /[\u0000-\u001f]/.test(document.path)) continue;
      const reservedSize = document.size || AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES;
      if (reservedSize > AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES - reservedBytes) continue;
      reservedBytes += reservedSize;
      try {
        const extracted = await analyseAiMemoryReferenceDocument(storageClient, {
          bucket: document.bucket, path: document.path, name: document.name, size: document.size,
          type: extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }, {
          userId: options.accountId, engine: options.engine,
          maxFileBytes: Math.min(AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES, reservedSize),
          maxCharsPerFile: BUSINESS_DNA_DOCUMENT_EXTRACT_CHARS,
        });
        if (extracted.status === "analysed" && extracted.text) {
          result[currentIndex] = { ...document, extractedText: extracted.text };
        }
      } catch {
        // Même une erreur inattendue du lecteur reste locale à ce fichier.
        // Son ancien extrait est conservé et les autres sources continuent.
        console.warn("[business-dna] document refresh skipped", { documentId: document.id });
      }
    }
  }
  await Promise.all([worker(), worker()]);
  return result;
}
