import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { INR_ASSISTANT_MODELS } from "../../lib/inrAssistantPolicy.ts";
import { classifyInrAssistantGatewayFailure, projectInrAssistantGatewayDiagnostic, recordInrAssistantGatewayDiagnostic } from "../../lib/inrAssistantGatewayDiagnostics.ts";

test("diagnostics retain only bounded machine metadata, never arbitrary provider or conversation data", () => {
  const requestId = randomUUID();
  const safe = projectInrAssistantGatewayDiagnostic({
    requestId: requestId.toUpperCase(), phase: "provider_completed", model: INR_ASSISTANT_MODELS.qwen,
    finishReason: "length", hasText: true, statusCode: 503, elapsedMs: 4_000_000, durationMs: 12.8,
    inputBytes: 9_000_000, historyTurns: 40, callCount: 10,
    message: "SECRET PROMPT", headers: { authorization: "SECRET KEY" }, response: "SECRET BODY", url: "https://private.test?token=SECRET",
  });
  assert.deepEqual(safe, { requestId, phase: "provider_completed", model: INR_ASSISTANT_MODELS.qwen,
    finishReason: "length", hasText: true, elapsedMs: 3_600_000, durationMs: 12, inputBytes: 1_000_000, historyTurns: 12, callCount: 10, statusCode: 503 });
  assert.doesNotMatch(JSON.stringify(safe), /SECRET|authorization|private|prompt|headers|response|url/i);
  assert.ok(Buffer.byteLength(JSON.stringify(safe), "utf8") < 500);
});

test("unexpected IDs, models, phases, reasons and number encodings cannot enter the diagnostic log", () => {
  assert.equal(projectInrAssistantGatewayDiagnostic({ requestId: "secret-user@example.test", phase: "provider_error" }), null);
  assert.equal(projectInrAssistantGatewayDiagnostic({ requestId: randomUUID(), phase: "PRIVATE ERROR TEXT" }), null);
  const requestId = randomUUID();
  assert.deepEqual(projectInrAssistantGatewayDiagnostic({ requestId, phase: "provider_error",
    model: "private-model-or-url", finishReason: "raw provider exception\nSECRET", hasText: "SECRET",
    statusCode: "503", elapsedMs: -1, durationMs: Infinity, inputBytes: NaN, historyTurns: -5, callCount: "4" }), { requestId, phase: "provider_error" });
  assert.equal(projectInrAssistantGatewayDiagnostic(new Proxy({}, { get: () => { throw new Error("Opaque object"); } })), null);
});

test("failure classification uses names and codes without reading exception messages", () => {
  const opaqueMessage = { name: "APIError", cause: { code: "UND_ERR_HEADERS_TIMEOUT" },
    get message() { throw new Error("Exception messages must not be inspected"); } };
  assert.equal(classifyInrAssistantGatewayFailure(opaqueMessage), "provider_timeout");
  assert.equal(classifyInrAssistantGatewayFailure({ name: "TimeoutError" }), "provider_timeout");
  assert.equal(classifyInrAssistantGatewayFailure({ name: "AbortError" }), "provider_timeout");
  assert.equal(classifyInrAssistantGatewayFailure(opaqueMessage, true), "request_aborted");
  assert.equal(classifyInrAssistantGatewayFailure({ message: "timeout https://SECRET", statusCode: 500 }), "provider_error");
  assert.equal(classifyInrAssistantGatewayFailure(new Proxy({}, { get: () => { throw new Error("Opaque error"); } })), "provider_error");
});

test("logging is bounded, skips invalid metadata and cannot turn a logger failure into a business failure", () => {
  const original = console.info;
  const calls: unknown[][] = [];
  try {
    console.info = (...args: unknown[]) => { calls.push(args); };
    const requestId = randomUUID();
    assert.deepEqual(recordInrAssistantGatewayDiagnostic({ requestId, phase: "redis_commit", message: "SECRET" }), { requestId, phase: "redis_commit" });
    assert.equal(recordInrAssistantGatewayDiagnostic({ requestId: "SECRET", phase: "redis_commit" }), undefined);
    assert.deepEqual(calls, [["[assistant.gateway]", { requestId, phase: "redis_commit" }]]);
    console.info = () => { throw new Error("Logging unavailable"); };
    assert.deepEqual(recordInrAssistantGatewayDiagnostic({ requestId, phase: "deadline" }), { requestId, phase: "deadline" });
  } finally { console.info = original; }
});
