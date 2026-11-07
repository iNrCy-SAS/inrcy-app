import assert from "node:assert/strict";
import test from "node:test";
import { redactAiMediaSensitiveText, safeAiMediaErrorDetails, safeAiMediaErrorMessage,
  safeAiVideoProviderFailureDiagnostics, safeAiVideoProviderErrorMetadata } from "../../lib/aiMediaSensitiveText.ts";

test("empty failures retain their category instead of persisting an empty message", () => {
  assert.equal(safeAiMediaErrorMessage(new Error()), "ai_media_unknown_error");
  assert.equal(safeAiMediaErrorMessage(new DOMException("", "AbortError")), "AbortError");
  assert.equal(safeAiMediaErrorMessage(undefined), "ai_media_unknown_error");
  assert.equal(redactAiMediaSensitiveText(undefined), "");
});

test("composition diagnostics preserve nested causes without response payloads", () => {
  const underlying = Object.assign(new Error("ai_narration_too_long_for_natural_pace"), {
    code: "AUDIO_DURATION", response: { secret: "private-response-body" },
  });
  const failure = new Error("ai_media_essential_video_composition_failed", { cause: underlying });
  const details = safeAiMediaErrorDetails(failure);
  assert.equal(details.length, 2);
  assert.equal(details[1].code, "AUDIO_DURATION");
  assert.equal(details[1].message, "ai_narration_too_long_for_natural_pace");
  assert.doesNotMatch(JSON.stringify(details), /private-response|stack/);
});

test("diagnostics are bounded and handle cyclic causes", () => {
  const cyclic = new Error("cycle") as Error & { cause?: unknown };
  cyclic.cause = cyclic;
  assert.equal(safeAiMediaErrorDetails(cyclic).length, 1);
  let deep: Error = new Error("x".repeat(10_000));
  for (let index = 0; index < 8; index += 1) deep = new Error("x".repeat(10_000), { cause: deep });
  const details = safeAiMediaErrorDetails(deep);
  assert.equal(details.length, 4);
  assert.ok(details.every((item) => item.message.length <= 600));
});

test("audio references and signed credentials are redacted in nested causes", () => {
  const audio = "YWJj".repeat(120);
  const failure = new Error("composition_failed", { cause: new Error(
    `data:audio/wav;base64,${audio} https://example.test/audio?token=private-token&x-goog-signature=private-signature Authorization: Bearer private.jwt.token`,
  ) });
  const output = JSON.stringify(safeAiMediaErrorDetails(failure));
  assert.doesNotMatch(output, /YWJj|private-token|private-signature|private\.jwt\.token/);
  assert.match(output, /redacted/);
});

test("video diagnostics persist only bounded machine fields and discard arbitrary SDK bodies and identifiers", () => {
  const diagnostics = {
    phase: "provider_submission", providerHttpStatus: 504, providerErrorName: "GatewayResponseError",
    providerErrorType: "response_error", providerErrorCode: "UND_ERR_BODY_TIMEOUT",
    clipIndex: 2, clipCount: 2, clipDurationSeconds: 15, completedClips: 1,
    elapsedMs: 615_740, clipElapsedMs: 297_670, committedCostMicroUsd: 3_000_000,
    currentClipAssetObserved: false, callerAborted: false, providerAborted: false, deadlineExceeded: false,
  };
  const failure = Object.assign(new Error("safe_failure"), { diagnostics: {
    ...diagnostics, requestBodyValues: { prompt: "private-prompt-sentinel" }, responseBody: "private-body-sentinel",
    generationId: "private-generation-id", url: "https://private.invalid/?token=secret", sample: "private-voice-sentinel",
  } });
  assert.deepEqual(safeAiMediaErrorDetails(failure)[0].diagnostics, diagnostics);
  const serialized = JSON.stringify(safeAiMediaErrorDetails(failure));
  assert.doesNotMatch(serialized, /private-|https?:|requestBody|responseBody|generationId|sample|token/);
  assert.ok(Object.isFrozen(safeAiVideoProviderFailureDiagnostics(diagnostics)));
});

test("video diagnostics reject malformed values and extract categories from a bounded cyclic cause chain", () => {
  assert.equal(safeAiVideoProviderFailureDiagnostics({
    phase: "https://private.invalid", providerHttpStatus: 200, providerErrorName: "private-name",
    providerErrorType: "private-type", providerErrorCode: "private-code", clipIndex: 3, clipCount: 3,
    clipDurationSeconds: 31, completedClips: -1, elapsedMs: Infinity, clipElapsedMs: -1,
    committedCostMicroUsd: Number.MAX_SAFE_INTEGER, callerAborted: "false",
  }), undefined);
  const underlying = Object.assign(new Error("private-message-not-a-category"), {
    name: "GatewayResponseError", statusCode: 504, type: "response_error", code: "UND_ERR_BODY_TIMEOUT",
    requestBodyValues: { prompt: "private-prompt" }, cause: undefined as unknown,
  });
  const wrapper = new Error("wrapper", { cause: underlying }); underlying.cause = wrapper;
  assert.deepEqual(safeAiVideoProviderErrorMetadata(wrapper), {
    providerErrorName: "GatewayResponseError", providerHttpStatus: 504,
    providerErrorType: "response_error", providerErrorCode: "UND_ERR_BODY_TIMEOUT",
  });
});
