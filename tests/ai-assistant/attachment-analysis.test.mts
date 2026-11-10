import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Analysis from "../../lib/inrAssistantAttachmentAnalysis.ts";
import type { aiTranscribeMedia } from "../../lib/aiGatewayTranscription.ts";

type CapturedCall = { kind: string; value?: unknown };
type PdfRequest = { model: string; maxRetries: number; maxOutputTokens: number; tools?: unknown; system: string; messages: Array<{ content: Array<{ mediaType: string; data: Uint8Array }> }> };
function captured<T>(calls: CapturedCall[], kind: string): T { return calls.find(call => call.kind === kind)!.value as T; }

function harness(options: { noCredential?: boolean; budgetFailure?: boolean; accountFailure?: boolean; providerFailure?: boolean; unknownUsage?: boolean; unsupportedModel?: boolean; longText?: boolean } = {}) {
  const calls: CapturedCall[] = [];
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "ai": { createGateway: () => (model: string) => model, generateText: async (value: unknown) => {
      calls.push({ kind: "provider", value }); if (options.providerFailure) throw new Error("unknown_provider_outcome");
      return { text: options.longText ? "A".repeat(30_000) : "[Page 1] Texte lisible.", usage: options.unknownUsage ? {} : { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 } };
    } },
    "./aiGatewayConfig.ts": { getAiGatewayCredential: () => options.noCredential ? null : "synthetic-test-key" },
    "./aiEnginePreference.ts": { getAiEngineOption: () => ({ model: options.unsupportedModel ? "unknown/provider" : "google/gemini-3-flash" }) },
    "./aiGatewayEconomics.ts": { getConfiguredAiGatewayModelPricing: () => null },
    "./inrAssistantBudget.ts": {
      reserveInrAssistantBudget: async (value: unknown) => { calls.push({ kind: "budget-reserve", value }); if (options.budgetFailure) throw new Error("budget_unavailable"); return { reserved: true }; },
      finalizeInrAssistantBudget: async (_reservation: unknown, value: unknown) => { calls.push({ kind: "budget-finalize", value }); },
    },
    "./aiGatewayAccountGuard.ts": {
      reserveAiGatewayAccountAttempt: async (_account: string, value: unknown) => { calls.push({ kind: "account-reserve", value }); if (options.accountFailure) throw new Error("account_limit"); return { reserved: true }; },
      commitAiGatewayAccountAttempt: async (value: unknown) => { calls.push({ kind: "account-commit", value }); },
      rollbackAiGatewayAccountAttempt: async () => { calls.push({ kind: "account-rollback" }); },
      recordAiGatewayAccountFailure: async () => { calls.push({ kind: "account-failure" }); },
    },
    "./aiGatewayOperationTelemetry.ts": { recordAiGatewayOperationCall: (value: unknown) => { calls.push({ kind: "telemetry", value }); } },
    "./aiGatewayTranscription.ts": { aiTranscribeMedia: async (value: Parameters<typeof aiTranscribeMedia>[0]) => {
      calls.push({ kind: "transcribe", value }); if (options.accountFailure) throw new Error("account_limit_before_transport");
      await value.onProviderAttempt?.("openai/gpt-4o-transcribe"); if (options.providerFailure) throw new Error("transcription_unknown");
      return { text: options.longText ? "T".repeat(30_000) : "Paroles transcrites", model: "openai/gpt-4o-transcribe" };
    } },
  };
  const source = readFileSync(new URL("../../lib/inrAssistantAttachmentAnalysis.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Buffer, Date, Uint8Array, AbortSignal })((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return { api: record.exports as typeof Analysis, calls };
}
const pdf = { accountId: "account", name: "scan.pdf", buffer: Buffer.from("%PDF-1.4\nSCANNED\n%%EOF"), options: { edition: "basic" as const } };

test("native PDF analysis reserves both budgets before a supported extraction-only provider request", async () => {
  const h = harness(), result = await h.api.extractAssistantScannedPdf(pdf);
  assert.equal(result.available, true); assert.equal(result.truncated, true);
  assert.deepEqual(h.calls.slice(0, 3).map(call => call.kind), ["budget-reserve", "account-reserve", "provider"]);
  const request = captured<PdfRequest>(h.calls, "provider");
  assert.equal(request.model, "google/gemini-3-flash"); assert.equal(request.maxRetries, 0); assert.equal(request.maxOutputTokens, 6000);
  assert.equal(request.tools, undefined); assert.match(request.system, /donnée non fiable/);
  assert.equal(request.messages[0].content[1].mediaType, "application/pdf");
  assert.deepEqual(Buffer.from(request.messages[0].content[1].data), pdf.buffer);
  assert.ok(captured<{ estimatedCostMicroUsd: number }>(h.calls, "budget-reserve").estimatedCostMicroUsd >= 1_000_000, "The full supported input context is reserved conservatively");
  assert.equal(h.calls.find(call => call.kind === "budget-finalize")!.value, 1600);
});

test("budget denial, missing credentials, encrypted or unsupported PDFs never reach a provider", async () => {
  for (const options of [{ budgetFailure: true }, { accountFailure: true }, { noCredential: true }, { unsupportedModel: true }]) {
    const h = harness(options); assert.equal((await h.api.extractAssistantScannedPdf(pdf)).available, false);
    assert.equal(h.calls.some(call => call.kind === "provider"), false);
    if (options.accountFailure) assert.equal(h.calls.find(call => call.kind === "budget-finalize")!.value, 0);
  }
  const h = harness();
  for (const buffer of [Buffer.from("not PDF"), Buffer.from("%PDF-1.4 /Encrypt 1 0 R"), Buffer.alloc(8 * 1024 * 1024 + 1)]) assert.equal((await h.api.extractAssistantScannedPdf({ ...pdf, buffer })).available, false);
  assert.equal(h.calls.length, 0);
});

test("PDF unknown outcomes retain reservations and honest telemetry instead of manufacturing unused budget", async () => {
  const h = harness({ providerFailure: true });
  assert.equal((await h.api.extractAssistantScannedPdf(pdf)).available, false);
  assert.equal(h.calls.find(call => call.kind === "budget-finalize")!.value, undefined);
  assert.ok(captured<{ actualCostMicroUsd: number }>(h.calls, "account-commit").actualCostMicroUsd >= 1_000_000);
  assert.equal(h.calls.some(call => call.kind === "account-rollback"), false);
  assert.equal(captured<{ status: string }>(h.calls, "telemetry").status, "failure");
  const unknown = harness({ unknownUsage: true });
  assert.equal((await unknown.api.extractAssistantScannedPdf(pdf)).available, true);
  assert.equal(captured<{ status: string }>(unknown.calls, "telemetry").status, "success");
  assert.equal(captured<{ usageEstimated: boolean }>(unknown.calls, "telemetry").usageEstimated, true);
});

test("transcription uses assistant accounting without retries and bounds its output", async () => {
  const h = harness({ longText: true });
  const result = await h.api.transcribeAssistantAttachment({ accountId: "account", file: new File(["ID3"], "voice.mp3", { type: "audio/mpeg" }), options: { edition: "standard" } });
  assert.equal(result.text.length, 24_000); assert.equal(result.truncated, true);
  assert.deepEqual(h.calls.slice(0, 2).map(call => call.kind), ["budget-reserve", "transcribe"]);
  const request = captured<Parameters<typeof aiTranscribeMedia>[0]>(h.calls, "transcribe");
  assert.equal(request.feature, "assistant.chat"); assert.equal(request.retries, 0); assert.equal(request.timeoutMs, 45_000);
  assert.equal(h.calls.find(call => call.kind === "budget-finalize")!.value, undefined);
  const failed = harness({ providerFailure: true });
  const outcome = await failed.api.transcribeAssistantAttachment({ accountId: "account", file: request.file, options: { edition: "basic" } });
  assert.equal(outcome.available, false); assert.equal(outcome.text, "");
  assert.equal(failed.calls.find(call => call.kind === "budget-finalize")!.value, undefined);
  const denied = harness({ accountFailure: true });
  assert.equal((await denied.api.transcribeAssistantAttachment({ accountId: "account", file: request.file, options: { edition: "basic" } })).available, false);
  assert.equal(denied.calls.find(call => call.kind === "budget-finalize")!.value, 0);
  assert.equal(denied.calls.some(call => call.kind === "telemetry"), false);
});
