import assert from "node:assert/strict";
import test from "node:test";
import {
  AiMediaNativeDialogueVerificationUnavailableError, getAiMediaNativeDialogueQaFailureMetadata,
  recoverAiMediaNativeDialogueVerification, type AiMediaNativeDialogueQaResult,
} from "../../lib/aiMediaNativeDialogueQa.ts";

const diagnostic = { stage: "transcribe", reason: "provider_access_denied", status: 403, retryable: false } as const;
const qa: AiMediaNativeDialogueQaResult = { version: 1, status: "unavailable", clips: [], elapsedMs: 75, verificationAttempts: 2, diagnostics: [diagnostic] };

test("the persistence boundary retains only fixed QA categories and bounded counts, never scripts, URLs or provider fields", () => {
  const error = new AiMediaNativeDialogueVerificationUnavailableError(qa);
  const metadata = getAiMediaNativeDialogueQaFailureMetadata(error);
  assert.equal(error.message, "ai_media_native_speech_verification_unavailable");
  assert.deepEqual(metadata, { version: 1, diagnostics: [diagnostic], verificationAttempts: 2, elapsedMs: 75, clipCount: 0, clips: [] });
  const contaminated = { nativeDialogueQa: { ...metadata, transcript: "PRIVATE_TRANSCRIPT", model: "PRIVATE_KEY",
    privateUrl: "https://private.invalid/audio?token=secret", elapsedMs: Infinity, clipCount: 900, verificationAttempts: 200,
    diagnostics: [{ ...diagnostic, message: "PRIVATE_TRANSCRIPT", code: "PRIVATE_KEY" },
      { ...diagnostic, stage: "PRIVATE_STAGE" }, { ...diagnostic, reason: "PRIVATE_REASON" },
      { ...diagnostic, status: "403" }, { ...diagnostic, status: 200 }, { ...diagnostic, retryable: "secret" },
      ...Array.from({ length: 50 }, () => diagnostic)] } };
  assert.deepEqual(getAiMediaNativeDialogueQaFailureMetadata(contaminated), { version: 1, diagnostics: [diagnostic], clips: [] });
  assert.doesNotMatch(JSON.stringify(getAiMediaNativeDialogueQaFailureMetadata(contaminated)), /PRIVATE_|https:|secret/);
  const diverse = { nativeDialogueQa: { version: 1, diagnostics: Array.from({ length: 100 }, (_, i) => ({ ...diagnostic, status: 400 + i })) } };
  assert.equal(getAiMediaNativeDialogueQaFailureMetadata(diverse)?.diagnostics.length, 8);
  const clips = getAiMediaNativeDialogueQaFailureMetadata({ nativeDialogueQa: { version: 1, diagnostics: [diagnostic], clips: [{
    sceneIndex: 1, status: "unavailable", issues: ["transcription_inconclusive", "PRIVATE_TRANSCRIPT"],
    automaticDialogueVerification: "unavailable", transcript: "PRIVATE_TRANSCRIPT", privateUrl: "https://private.invalid/",
  }, { sceneIndex: 2, status: "PRIVATE_STATUS", issues: [] }] } });
  assert.deepEqual(clips?.clips, [{ sceneIndex: 1, status: "unavailable", issues: ["transcription_inconclusive"], automaticDialogueVerification: "unavailable" }]);
});

test("legacy generic failures stay unknown and local inconclusive comparisons are distinguished from provider denial", () => {
  assert.equal(getAiMediaNativeDialogueQaFailureMetadata(new Error("ai_media_native_speech_verification_unavailable")), undefined);
  assert.equal(getAiMediaNativeDialogueQaFailureMetadata(new AiMediaNativeDialogueVerificationUnavailableError(null)), undefined);
  const local = new AiMediaNativeDialogueVerificationUnavailableError({ ...qa, diagnostics: undefined });
  assert.deepEqual(getAiMediaNativeDialogueQaFailureMetadata(local)?.diagnostics, [{ stage: "comparison", reason: "verification_inconclusive", status: 0, retryable: null }]);
});

test("bounded recovery preserves first and final audit evidence without changing the existing retry or rendering policy", async () => {
  let audits = 0;
  const result = await recoverAiMediaNativeDialogueVerification({ audit: async () => {
    audits++;
    return audits === 1 ? qa : { ...qa, diagnostics: [{ stage: "transcribe", reason: "provider_rate_limited", status: 429, retryable: true }] };
  } });
  assert.equal(audits, 2);
  assert.equal(result.status, "unavailable");
  assert.equal(result.verificationAttempts, 2);
  assert.deepEqual(getAiMediaNativeDialogueQaFailureMetadata(new AiMediaNativeDialogueVerificationUnavailableError(result))?.diagnostics,
    [{ ...diagnostic, auditAttempt: 1 }, { stage: "transcribe", reason: "provider_rate_limited", status: 429, retryable: true, auditAttempt: 2 }]);
});
