import "server-only";

import type { AiMemoryReferenceDocument } from "@/lib/aiMemory";
import type { BusinessDnaSourceResult } from "@/lib/businessDnaChannelAnalysis";
import { fitBusinessDnaDocuments } from "./businessDnaDocumentBudget.ts";

const MAX_DOCUMENT_SOURCE_CHARS = 60_000;

function cleanDocumentText(value: unknown, maxLength = 30_000) {
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

  const content = fitBusinessDnaDocuments(readableDocuments.map((document, index) => ({
    heading: `[Document fourni ${index + 1} — ${document.name || "sans nom"}]`,
    text: document.text,
  })), MAX_DOCUMENT_SOURCE_CHARS);

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
