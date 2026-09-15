import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  assert.match(route, /invalidateBoosterGenerationContext\(accountId, "professional"\)/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS = 6/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES = 20 \* 1024 \* 1024/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES = 50 \* 1024 \* 1024/);
  assert.match(route, /exceedsReferenceDocumentsQuota/);
  assert.match(migration, /'inrcy-ai-documents'/);
  assert.match(migration, /public,[\s\S]*false/);
  assert.match(migration, /20971520/);
  assert.match(migration, /'application\/pdf'/);
  assert.match(migration, /wordprocessingml\.document/);
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
