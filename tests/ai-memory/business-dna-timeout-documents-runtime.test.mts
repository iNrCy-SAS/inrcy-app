import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import ts from "typescript";

import * as memory from "../../lib/aiMemory.ts";
import { getAiFeaturePolicy } from "../../lib/aiGatewayPolicy.ts";
import * as timing from "../../lib/businessDnaAnalysisTiming.ts";
import { buildBusinessDnaAnalysisSourcePayload } from "../../lib/businessDnaSourceBudget.ts";
import * as documentBudget from "../../lib/businessDnaDocumentBudget.ts";
import { extractPdfTextForAi } from "../../lib/pdfTextExtraction.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const requireBuiltin = createRequire(import.meta.url);
function loadModule<T extends object>(path: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(readFileSync(resolve(ROOT, path), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} as T };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "server-only") return {};
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    if (["node:zlib", "fs", "os", "path", "child_process"].includes(name)) return requireBuiltin(name);
    throw new Error(`Unexpected dependency ${name}`);
  });
  return loaded.exports;
}

const { getSimpleFrenchErrorMessage } = loadModule<typeof import("../../lib/userFacingErrors.ts")>("lib/userFacingErrors.ts", {
  "@/lib/appLanguage": { normalizeAppLanguage: () => "fr-FR" },
  "@/lib/publicationErrorFrench": { getProviderPublicationErrorMessage: () => null, looksLikeEnglishErrorMessage: () => false },
  "@/lib/metaGraphErrorClassification": { isMetaRateLimitError: () => false },
});

test("une analyse lente conserve les mêmes plafonds de coût et assez de temps pour ses secours", () => {
  const policy = getAiFeaturePolicy("business-dna.analyze");
  assert.equal(policy.defaultOperationMaxCalls, 2);
  assert.equal(policy.defaultOperationMaxReservedOutputTokens, 15_200);
  assert.equal(policy.maxInputChars, 150_000);
  assert.equal(policy.maxOutputTokens, 8_000);
  assert.equal(getAiFeaturePolicy("booster.publish").maxTimeoutMs, 70_000);
  assert.equal(getAiFeaturePolicy("agent.publish").maxTimeoutMs, 72_000);
  const args = { hardDeadlineAt: 240_000, requestedTimeoutMs: policy.maxTimeoutMs,
    gatewayFallbackAvailable: true, directFallbackAvailable: true };
  const primary = timing.resolveBusinessDnaStageTimeoutMs({ ...args, stage: "primary", now: 0 });
  assert.equal(primary, 130_000);
  // Le modèle choisi peut désormais terminer en 90 s, sans la coupure à 70 s.
  assert.ok(primary > 90_000);
  const gateway = timing.resolveBusinessDnaStageTimeoutMs({ ...args, stage: "gateway_model", now: primary });
  const direct = timing.resolveBusinessDnaStageTimeoutMs({ ...args, stage: "openai_direct", now: primary + gateway });
  assert.equal(gateway, 60_000);
  assert.equal(direct, 40_000);
  assert.ok(primary + gateway + direct < args.hardDeadlineAt);
  assert.equal(timing.resolveBusinessDnaStageTimeoutMs({ ...args, stage: "openai_direct", now: 239_000 }), 0);
  assert.ok(timing.BUSINESS_DNA_AUTOMATIC_LEASE_SECONDS * 1000 > timing.BUSINESS_DNA_AUTOMATIC_REQUEST_TIMEOUT_MS);
});

test("le timeout réseau est typé ; une annulation externe garde sa cause", async (context) => {
  const fetchModule = loadModule<typeof import("../../lib/observability/fetch.ts")>("lib/observability/fetch.ts", { "@/lib/observability/logger": { log: { error() {} } } });
  context.mock.method(globalThis, "fetch", (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    const abort = () => reject(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener("abort", abort, { once: true });
  }));
  await assert.rejects(fetchModule.fetchWithTimeout("https://example.test", { timeoutMs: 10 }), (error: unknown) => {
    assert.ok(error instanceof fetchModule.FetchTimeoutError);
    assert.equal(error.code, "fetch_timeout");
    assert.equal((error.cause as Error).name, "AbortError");
    assert.doesNotMatch(getSimpleFrenchErrorMessage(error, "Erreur"), /timed out|aborted/i);
    return true;
  });
  const upstream = new AbortController();
  const cancellation = new Error("Annulation explicite");
  upstream.abort(cancellation);
  await assert.rejects(fetchModule.fetchWithTimeout("https://example.test", { signal: upstream.signal, timeoutMs: 100 }),
    (error) => error === cancellation);
  assert.doesNotMatch(getSimpleFrenchErrorMessage(new DOMException("This operation was aborted", "AbortError"), "Erreur"), /aborted/i);
});

function docxFixture(text: string) {
  const name = Buffer.from("word/document.xml");
  const data = deflateRawSync(Buffer.from(`<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`));
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, data]);
}

test("un Word long conserve les consignes après 2200 caractères dans l'analyse ADN", async () => {
  const attachmentModule = loadModule<typeof import("../../lib/aiAttachmentContext.ts")>("lib/aiAttachmentContext.ts", {
    "@/lib/aiGatewayClient": { aiGenerateJSON: () => { throw new Error("Aucun appel IA nécessaire pour un Word"); } },
    "@/lib/boosterPdfAttachmentPolicy": { hasBoosterPdfSignature: () => true },
    "@/lib/pdfTextExtraction": { extractPdfTextForAi },
  });
  const fixture = docxFixture("Présentation de l'entreprise. ".repeat(160) + "CONSIGNE FINALE : conserver les fenêtres.");
  const storage = { storage: { from: () => ({ download: async () => ({ data: new Blob([fixture]), error: null }) }) } };
  const ref = { bucket: "inrcy-ai-documents", path: "users/account/ai-memory-documents/guide.docx", name: "guide.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: fixture.length };
  const complete = await attachmentModule.analyseAiMemoryReferenceDocument(storage, ref, { userId: "account", engine: "anthropic", maxCharsPerFile: 12_000 });
  assert.equal(complete.status, "analysed");
  assert.match(complete.text, /CONSIGNE FINALE/);
  const mail = await attachmentModule.analyseStoredAiAttachment(storage, ref, { userId: "account", engine: "anthropic" });
  assert.ok(mail.text.length <= 2_200);
});

test("les documents anciens sont relus uniquement dans leur compte et un échec conserve leur extrait", async () => {
  const touched: string[] = [];
  const refreshModule = loadModule<typeof import("../../lib/businessDnaReferenceDocumentRefresh.ts")>("lib/businessDnaReferenceDocumentRefresh.ts", {
    "@supabase/supabase-js": { createClient: () => { throw new Error("Client fourni"); } },
    "@/lib/aiMemory": memory,
    "@/lib/aiAttachmentContext": { analyseAiMemoryReferenceDocument: async (_client: unknown, ref: { name: string; path: string }) => {
      touched.push(ref.path);
      return ref.name === "ok.docx" ? { status: "analysed", text: "Extrait complet relu" } : { status: "error", text: "" };
    } },
  });
  const document = (name: string, accountId = "account") => ({ id: name, name, bucket: "inrcy-ai-documents",
    path: `users/${accountId}/ai-memory-documents/${name}`, mimeType: "application/pdf", size: 1_024,
    extractedText: "Ancien extrait", status: "analysed" as const, note: "", createdAt: "2026-10-01T00:00:00.000Z" });
  const originals = [document("ok.docx"), document("unavailable.pdf"), document("private.pdf", "other-account"), document("photo.jpg")];
  const refreshed = await refreshModule.refreshBusinessDnaReferenceDocuments(originals, { accountId: "account", engine: "anthropic", storageClient: {} });
  assert.equal(touched.length, 2);
  assert.equal(refreshed[0].extractedText, "Extrait complet relu");
  assert.equal(refreshed[1].extractedText, "Ancien extrait");
  assert.equal(originals[0].extractedText, "Ancien extrait");
  assert.equal(refreshed[2], originals[2]);
});

test("un petit contexte multicanal conserve chaque document et les règles finales sans dépasser le JSON", () => {
  const documents = Array.from({ length: 4 }, (_value, index) => ({
    heading: `[Document fourni ${index + 1} — guide-${index + 1}.docx]`,
    text: `DÉBUT-${index + 1} ` + "description \"détaillée\"\n".repeat(1200) + ` FIN-${index + 1}`,
  }));
  const content = documentBudget.fitBusinessDnaDocuments(documents, 60_000);
  const payload = buildBusinessDnaAnalysisSourcePayload([
    { key: "website", label: "Site web", status: "analyzed", content: "Site officiel ".repeat(2000) },
    { key: "reference_documents", label: "Documents", status: "analyzed", content },
    { key: "facebook", label: "Facebook", status: "analyzed", content: "Publications ".repeat(2000) },
  ], 8_000);
  assert.ok(JSON.stringify(payload).length <= 8_000);
  const docs = payload.find((source) => source.source === "reference_documents")!.content;
  for (let index = 1; index <= 4; index++) {
    assert.ok(docs.includes(`DÉBUT-${index}`));
    assert.ok(docs.includes(`FIN-${index}`));
  }
  const unlabelled = documentBudget.fitBusinessDnaReferenceDocumentSource('"ancien extrait"\n'.repeat(500), 1_000);
  assert.ok(JSON.stringify(unlabelled).length - 2 <= 1_000);
});
