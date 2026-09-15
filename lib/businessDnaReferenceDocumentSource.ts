import "server-only";

import type { AiMemoryReferenceDocument } from "@/lib/aiMemory";
import type { BusinessDnaSourceResult } from "@/lib/businessDnaChannelAnalysis";

const MAX_DOCUMENT_SOURCE_CHARS = 18_000;

function cleanDocumentText(value: unknown, maxLength = 3_000) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

/**
 * Transforme les extraits privés validés dans iNrADN en une source bornée de
 * l'analyse. Les fichiers eux-mêmes ne quittent jamais Storage à cette étape.
 */
export function buildBusinessDnaReferenceDocumentSources(
  documents: AiMemoryReferenceDocument[],
): BusinessDnaSourceResult[] {
  if (!documents.length) return [];

  const readableDocuments = documents
    .map((document) => ({
      name: cleanDocumentText(document.name, 180),
      text: cleanDocumentText(document.extractedText),
    }))
    .filter((document) => Boolean(document.text));

  const content = readableDocuments
    .map(
      (document, index) =>
        `[Document fourni ${index + 1} — ${document.name || "sans nom"}]\n${document.text}`,
    )
    .join("\n\n")
    .slice(0, MAX_DOCUMENT_SOURCE_CHARS);

  const unreadableCount = Math.max(0, documents.length - readableDocuments.length);
  return [
    {
      key: "reference_documents",
      label: "Documents iNrADN",
      status: content ? "analyzed" : "failed",
      url: null,
      itemCount: documents.length,
      recentItemCount: 0,
      contentChars: content.length,
      message: content
        ? unreadableCount
          ? `${readableDocuments.length} document(s) lu(s), ${unreadableCount} sans texte exploitable.`
          : `${readableDocuments.length} document(s) lu(s).`
        : "Aucun texte exploitable n’a pu être extrait des documents joints.",
      content,
    },
  ];
}
