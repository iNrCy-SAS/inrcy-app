import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("iNrADN reference documents are private, bounded and explicitly consented", () => {
  const route = read("app/api/ai-memory/documents/route.ts");
  const memory = read("lib/aiMemory.ts");

  assert.match(route, /requireUser\(\)/);
  assert.match(route, /users\/\$\{activeUserId\}\/ai-memory-documents/);
  assert.match(route, /createSignedUploadUrl\(storagePath\)/);
  assert.match(route, /body\?\.analysisConsent !== true/);
  assert.match(route, /AI_MEMORY_DOCUMENT_CONSENT_REQUIRED/);
  assert.match(route, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES/);
  assert.match(route, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS/);
  assert.match(route, /ownedPath\(activeUserId, storagePath\)/);
  assert.match(route, /analyseAiMemoryReferenceDocument/);
  assert.match(route, /invalidateBoosterGenerationContext\(accountId, "professional"\)/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS = 6/);
  assert.match(memory, /AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES = 6 \* 1024 \* 1024/);
});

test("the Documents tab uploads through a signed URL and supports explicit deletion", () => {
  const ui = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(ui, /\| "documents"/);
  assert.match(ui, /\{ key: "documents", icon: "📎", label: t\("tabDocuments"\) \}/);
  assert.match(ui, /if \(!documentAnalysisConsent\)/);
  assert.match(ui, /uploadToSignedUrl/);
  assert.match(ui, /analysisConsent: true/);
  assert.match(ui, /method: "DELETE"/);
  assert.match(ui, /memory\.referenceDocuments\.map/);
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

  assert.match(memory, /documents_fournis_par_le_professionnel/);
  assert.match(memory, /value\.referenceDocuments/);
  assert.match(memory, /document\.extractedText/);
  assert.match(profile, /memory: normalizeAiMemory/);
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
