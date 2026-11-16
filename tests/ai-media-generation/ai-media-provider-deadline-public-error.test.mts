import assert from "node:assert/strict";
import test from "node:test";
import { getAiMediaGenerationPublicError, isAiMediaProviderBillingFailure } from "../../lib/aiMediaGenerationPublicErrors.ts";
import { safeAiMediaErrorDetails } from "../../lib/aiMediaSensitiveText.ts";

const genericSdkMessage = "Invalid error response format: Gateway request failed";
const clipDeadline = {
  phase: "provider_submission", clipIndex: 1, clipCount: 2,
  clipDurationSeconds: 8, completedClips: 0, clipBudgetMs: 600_000,
  clipElapsedMs: 600_021, overallBudgetMs: 709_768,
  deadlineExceeded: true, deadlineKind: "clip", providerAborted: true, callerAborted: false,
  providerErrorName: "GatewayResponseError", providerErrorType: "response_error",
};

test("a confirmed clip deadline survives the generic SDK error in live and persisted recovery explanations", () => {
  const raw = Object.assign(new Error(genericSdkMessage), { diagnostics: {
    ...clipDeadline, privateUrl: "https://private.invalid/result?token=SECRET", transcript: "PRIVATE_DIALOGUE",
  } });
  const persistedDetails = safeAiMediaErrorDetails(raw);
  assert.equal(persistedDetails[0].diagnostics?.deadlineKind, "clip");
  assert.doesNotMatch(JSON.stringify(persistedDetails), /SECRET|PRIVATE_DIALOGUE|privateUrl|transcript/);
  for (const input of [raw, new Error("Video provider failed", { cause: raw }), {
    error_code: "AI_MEDIA_GENERATION_FAILED", error_details: persistedDetails,
  }]) {
    const result = getAiMediaGenerationPublicError(input);
    assert.equal(result.code, "AI_MEDIA_GENERATION_TIMEOUT");
    assert.equal(result.status, 504);
    assert.match(result.reason, /délai disponible/);
    assert.doesNotMatch(result.message, /cause identifiable|SECRET|PRIVATE|https:|Gateway|600|rembours|crédit/i);
    assert.equal(isAiMediaProviderBillingFailure(input), false);
  }
});

test("the bounded overall-film deadline is also recognized without exposing provider diagnostics", () => {
  const result = getAiMediaGenerationPublicError({ message: genericSdkMessage, diagnostics: {
    ...clipDeadline, deadlineKind: "film", clipBudgetMs: 600_000,
  } });
  assert.equal(result.code, "AI_MEDIA_GENERATION_TIMEOUT");
  assert.doesNotMatch(JSON.stringify(result), /deadline|clipIndex|providerAborted|600000/);
});

test("unproven or caller-aborted diagnostic flags cannot manufacture a provider deadline", () => {
  for (const diagnostics of [
    { ...clipDeadline, deadlineExceeded: false },
    { ...clipDeadline, deadlineExceeded: "true" },
    { ...clipDeadline, providerAborted: false },
    { ...clipDeadline, callerAborted: true },
    { ...clipDeadline, callerAborted: undefined },
    { ...clipDeadline, deadlineKind: "untrusted" },
    { deadlineKind: "clip", deadlineExceeded: true, message: "ai_video_gateway_timeout" },
  ]) assert.equal(getAiMediaGenerationPublicError({ message: genericSdkMessage, diagnostics }).code, "AI_MEDIA_GENERATION_FAILED");
  for (const value of [
    { message: genericSdkMessage, metadata: { diagnostics: clipDeadline } },
    { message: genericSdkMessage, diagnostics: { prompt: "ai_video_gateway_timeout", body: clipDeadline } },
  ]) assert.equal(getAiMediaGenerationPublicError(value).code, "AI_MEDIA_GENERATION_FAILED");
});

test("explicit cancellation and supplier billing retain their existing higher-priority decisions", () => {
  assert.equal(getAiMediaGenerationPublicError({ code: "AI_MEDIA_GENERATION_CANCELLED", diagnostics: clipDeadline }).code,
    "AI_MEDIA_GENERATION_CANCELLED");
  const billing = { message: "insufficient_balance", diagnostics: clipDeadline };
  assert.equal(getAiMediaGenerationPublicError(billing).code, "AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT");
  assert.equal(isAiMediaProviderBillingFailure(billing), true);
  assert.equal(getAiMediaGenerationPublicError(new DOMException("This operation was aborted", "AbortError")).code,
    "AI_MEDIA_CONNECTION_INTERRUPTED");
});

test("diagnostic getter and cycle traps remain bounded and private-safe", () => {
  const raw: Record<string, unknown> = { message: genericSdkMessage };
  Object.defineProperty(raw, "diagnostics", { get() { throw new Error("PRIVATE_GETTER"); } });
  raw.cause = raw;
  assert.equal(getAiMediaGenerationPublicError(raw).code, "AI_MEDIA_GENERATION_FAILED");
  const nested: Record<string, unknown> = {};
  Object.defineProperty(nested, "deadlineKind", { get() { throw new Error("PRIVATE_KIND"); } });
  assert.equal(getAiMediaGenerationPublicError({ message: genericSdkMessage, diagnostics: nested }).code, "AI_MEDIA_GENERATION_FAILED");
});
