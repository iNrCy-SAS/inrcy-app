import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES,
  getAiMemoryReferenceDocumentStorage,
  normalizeAiMemory,
} from "../../lib/aiMemory.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("iNrADN reference documents are private, bounded and explicitly consented", () => {
  const route = read("app/api/ai-memory/documents/route.ts");
  const memory = read("lib/aiMemory.ts");
  const migration = read("supabase/migrations/20260915150000_business_dna_reference_documents_bucket.sql");

  assert.match(route, /requireUser\(\)/);
  assert.match(route, /users\/\$\{activeUserId\}\/ai-memory-documents/);
  assert.match(route, /createSignedUploadUrl\(storagePath\)/);
  assert.match(route, /selectUniversalMediaUploadProtocol\(size\)/);
  assert.match(route, /buildDirectStorageResumableEndpoint/);
  assert.match(route, /protocol,[\s\S]*resumableEndpoint/);
  assert.match(route, /const BUCKET = "inrcy-ai-documents"/);
  assert.match(route, /canonicalDocumentMimeType/);
  assert.match(route, /body\?\.analysisConsent !== true/);
  assert.match(route, /AI_MEMORY_DOCUMENT_CONSENT_REQUIRED/);
  assert.match(route, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES/);
  assert.match(route, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS/);
  assert.match(route, /ownedPath\(activeUserId, storagePath\)/);
  assert.match(route, /analyseAiMemoryReferenceDocument/);
  assert.match(route, /invalidateBoosterGenerationContext\(activeUserId, "professional"\)/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS = 10/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES = 20 \* 1024 \* 1024/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES = 50 \* 1024 \* 1024/);
  assert.match(route, /exceedsReferenceDocumentsQuota/);
  assert.match(migration, /'inrcy-ai-documents'/);
  assert.match(migration, /public,[\s\S]*false/);
  assert.match(migration, /20971520/);
  assert.match(migration, /'application\/pdf'/);
  assert.match(migration, /wordprocessingml\.document/);
});

test("iNrADN keeps up to ten reference documents while preserving the size quotas", () => {
  const memory = normalizeAiMemory({
    referenceDocuments: Array.from({ length: 12 }, (_value, index) => ({
      id: `document-${index + 1}`,
      name: `Document ${index + 1}.pdf`,
      bucket: "inrcy-ai-documents",
      path: `users/account/ai-memory-documents/document-${index + 1}.pdf`,
      mimeType: "application/pdf",
      size: 1024,
      status: "analysed",
      extractedText: "Contenu analysé",
      createdAt: "2026-10-01T00:00:00.000Z",
    })),
  });

  assert.equal(AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS, 10);
  assert.equal(memory.referenceDocuments.length, 10);
  assert.equal(AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES, 50 * 1024 * 1024);
});

test("concurrent document mutations merge under a database lock and preserve cross-writer updates", () => {
  const route = read("app/api/ai-memory/documents/route.ts");
  const genericMemoryRoute = read("app/api/ai-memory/route.ts");
  const migration = read(
    "supabase/migrations/20261001090000_ai_memory_reference_documents_atomic.sql",
  );

  assert.match(route, /rpc\([\s\S]*"inrcy_add_ai_memory_reference_document"/);
  assert.match(route, /rpc\([\s\S]*"inrcy_remove_ai_memory_reference_document"/);
  assert.doesNotMatch(route, /persistDocuments/);
  assert.doesNotMatch(route, /referenceDocuments, document\]\.slice/);

  assert.match(migration, /create or replace function public\.inrcy_add_ai_memory_reference_document/);
  assert.match(migration, /create or replace function public\.inrcy_remove_ai_memory_reference_document/);
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /on conflict \(account_id\) do nothing/);
  assert.match(migration, /where memory_row\.account_id = p_account_id\s+for update/gi);
  assert.match(migration, /jsonb_array_length\(v_documents\) >= p_max_items/);
  assert.match(migration, /v_incoming_size > p_max_total_bytes - v_total_bytes/);
  assert.match(migration, /v_documents := v_documents \|\| jsonb_build_array\(p_document\)/);

  assert.match(migration, /business_ai_memories_preserve_reference_documents/);
  assert.match(migration, /reference_documents_atomic_write/);
  assert.match(migration, /old\.memory -> 'referenceDocuments'[\s\S]*old\.memory -> 'reference_documents'/);
  assert.match(migration, /new\.memory - 'reference_documents'/);
  assert.match(
    genericMemoryRoute,
    /referenceDocuments: currentMemory\.referenceDocuments/,
  );
  assert.match(
    migration,
    /revoke all on function public\.inrcy_add_ai_memory_reference_document[\s\S]*from public, anon, authenticated, service_role;[\s\S]*to service_role;/,
  );
});

test("quota rejections clean their candidate while analysis rejection keeps an ambiguous blob", () => {
  const route = read("app/api/ai-memory/documents/route.ts");
  const finalize = route.slice(
    route.indexOf('if (action === "finalize")'),
    route.indexOf('return NextResponse.json({ error: "Action de document inconnue."'),
  );

  assert.match(
    finalize,
    /referenceDocuments\.length >= AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS[\s\S]*cleanupUploadedDocument\(activeUserId, storagePath, "item_limit_precheck"\)[\s\S]*status: 409/,
  );
  assert.match(
    finalize,
    /mutation\.status === "limit_items"[\s\S]*cleanupUploadedDocument\(activeUserId, storagePath, "item_limit_atomic"\)[\s\S]*status: 409/,
  );
  assert.match(
    finalize,
    /mutation\.status === "limit_bytes"[\s\S]*cleanupUploadedDocument\(activeUserId, storagePath, "byte_limit_atomic"\)[\s\S]*status: 413/,
  );
  const analysisRejection = finalize.slice(
    finalize.indexOf('analysis.status === "ignored"'),
    finalize.indexOf("const analysedSize"),
  );
  assert.match(analysisRejection, /analysis rejected; object retained/);
  assert.doesNotMatch(analysisRejection, /cleanupUploadedDocument/);
  assert.match(analysisRejection, /status: 422/);
});

test("document ids stay bound to their prepared Storage path without deleting an existing path owner", () => {
  const route = read("app/api/ai-memory/documents/route.ts");
  const migration = read(
    "supabase/migrations/20261001090000_ai_memory_reference_documents_atomic.sql",
  );

  assert.match(route, /expectedPathPrefix = `users\/\$\{activeUserId\}\/ai-memory-documents\/\$\{id\}-`/);
  assert.match(route, /storagePath\.startsWith\(expectedPathPrefix\)/);
  assert.match(route, /document\.bucket === BUCKET && document\.path === storagePath/);
  assert.match(route, /mutation\.status === "conflict_path"[\s\S]*object must remain untouched/);
  assert.match(route, /persistedDocument\.id !== document\.id/);
  assert.match(
    migration,
    /entry\.value ->> 'bucket' = p_document ->> 'bucket'[\s\S]*entry\.value ->> 'path' = p_document ->> 'path'[\s\S]*'conflict_path'/,
  );
});

test("every dashboard locale displays the shared document-count limit", () => {
  for (const locale of [
    "de-DE",
    "en-GB",
    "es-ES",
    "fr-FR",
    "it-IT",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const catalog = JSON.parse(read(`messages/${locale}/dashboard.json`)) as {
      aiMemory?: { documentsLimitReached?: string };
    };
    assert.match(
      catalog.aiMemory?.documentsLimitReached || "",
      /\{limit\}/,
      `${locale} must interpolate the shared document limit`,
    );
  }
});

test("the Documents tab uses the signed resumable transport and supports explicit deletion", () => {
  const ui = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  const transport = read("lib/universalMediaUploadClient.ts");
  const policy = read("lib/mediaUploadPolicy.ts");

  assert.match(ui, /\| "documents"/);
  assert.match(ui, /\{ key: "documents", icon: "📎", label: t\("tabDocuments"\) \}/);
  assert.match(ui, /if \(!documentAnalysisConsent\)/);
  assert.match(ui, /uploadFileToPreparedStorageIntent/);
  assert.match(ui, /prepared\.protocol === "tus"/);
  assert.match(ui, /prepared\.mimeType \|\| file\.type/);
  assert.match(ui, /contentType: uploadMimeType/);
  assert.match(ui, /analysisConsent: true/);
  assert.match(ui, /method: "DELETE"/);
  assert.match(ui, /memory\.referenceDocuments\.map/);
  assert.match(ui, /getAiMemoryReferenceDocumentStorage\(memory\.referenceDocuments\)/);
  assert.match(ui, /role="progressbar"/);
  assert.match(ui, /documentStorage\.status === "near"/);
  assert.match(ui, /documentStorage\.status === "reached"/);
  assert.match(
    policy,
    /UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES = 6 \* 1024 \* 1024/,
  );
  assert.match(
    transport,
    /export async function uploadFileToPreparedStorageIntent[\s\S]*intent\.protocol === "tus"[\s\S]*uploadWithTus\(file, intent, options\)/,
  );
  const genericIntent = transport.slice(
    transport.indexOf("export type PreparedStorageUploadIntent"),
    transport.indexOf("type StorageTransportIntent"),
  );
  assert.doesNotMatch(genericIntent, /mediaType|image|video/);
  assert.doesNotMatch(ui, /\.uploadToSignedUrl\(/);
});

test("the Documents storage meter derives its usage from the shared backend quota", () => {
  const megabyte = 1024 * 1024;
  const available = getAiMemoryReferenceDocumentStorage([
    { size: 12 * megabyte },
    { size: null },
    { size: -1 },
  ]);
  assert.equal(available.usedBytes, 12 * megabyte);
  assert.equal(available.limitBytes, AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES);
  assert.equal(available.remainingBytes, 38 * megabyte);
  assert.equal(available.percent, 24);
  assert.equal(available.status, "available");

  const near = getAiMemoryReferenceDocumentStorage([{ size: 40 * megabyte }]);
  assert.equal(near.percent, 80);
  assert.equal(near.status, "near");

  const reached = getAiMemoryReferenceDocumentStorage([
    { size: 30 * megabyte },
    { size: 20 * megabyte },
  ]);
  assert.equal(reached.remainingBytes, 0);
  assert.equal(reached.percent, 100);
  assert.equal(reached.status, "reached");
});

test("the document consent description stays on a distinct readable line", () => {
  const ui = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(ui, /<span style=\{documentsConsentCopyStyle\}>/);
  assert.match(
    ui,
    /<strong style=\{documentsConsentTitleStyle\}>[\s\S]*?documentsConsentTitle[\s\S]*?<small style=\{documentsConsentDescriptionStyle\}>[\s\S]*?documentsConsentDescription/,
  );
  assert.match(
    ui,
    /documentsConsentCopyStyle[^;]*display: "grid"[^;]*gap: 5/,
  );
  assert.match(
    ui,
    /documentsConsentDescriptionStyle[^;]*display: "block"[^;]*lineHeight: 1\.5/,
  );
});

test("reference document extracts are part of the shared AI context", () => {
  const memory = read("lib/aiMemory.ts");
  const profile = read("lib/aiGenerationProfile.ts");
  const analysis = read("app/api/ai-memory/analyze-channels/route.ts");
  const source = read("lib/businessDnaReferenceDocumentSource.ts");
  const budget = read("lib/businessDnaSourceBudget.ts");

  assert.match(memory, /documents_fournis_par_le_professionnel/);
  assert.match(memory, /value\.referenceDocuments/);
  assert.match(memory, /document\.extractedText/);
  assert.match(profile, /memory: normalizeAiMemory/);
  assert.match(analysis, /buildBusinessDnaReferenceDocumentSources/);
  assert.match(analysis, /storedMemory\.referenceDocuments/);
  assert.match(source, /key: "reference_documents"/);
  assert.match(source, /MAX_DOCUMENT_SOURCE_CHARS = 18_000/);
  assert.match(
    budget,
    /key === "website" \|\| key === "inrcy_site" \|\| key === "reference_documents"\) return 5/,
  );
});

test("instruction sections remain backward-compatible and allow 1200 characters each", () => {
  const sections = read("lib/aiInstructionSections.ts");
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");

  assert.match(sections, /AI_INSTRUCTION_SECTION_MAX_LENGTH = 1_200/);
  assert.match(sections, /encodeAiInstructionSections/);
  assert.match(sections, /decodeAiInstructionSections/);
  assert.match(configuration, /maxLength=\{AI_INSTRUCTION_SECTION_MAX_LENGTH\}/);
  assert.match(configuration, /forbiddenInstructions: form\.forbiddenStyle/);
});
