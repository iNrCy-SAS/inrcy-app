import assert from "node:assert/strict";
import test from "node:test";
import { AI_MEDIA_PUBLIC_ERROR_CATALOG, getAiMediaGenerationPublicError as explain, isAiMediaContentPolicyRejection, isAiMediaProviderBillingFailure } from "../../lib/aiMediaGenerationPublicErrors.ts";

// Diagnostic shapes observed in historical jobs; no customer data or prompts.
const historical = [
  ["ai_media_narration_unavailable:La voix off est trop longue pour cette durée.", "AI_MEDIA_NARRATION_TOO_LONG"],
  ["Le texte exact de la voix off est trop long pour cette durée.", "AI_MEDIA_EXACT_NARRATION_TOO_LONG"],
  ["Une réplique est trop longue pour un plan de 8 secondes.", "AI_MEDIA_DIALOGUE_TOO_LONG"],
  ["Le film contient trop de textes ou de valeurs exactes pour cette durée.", "AI_MEDIA_EXACT_TEXT_TOO_DENSE"],
  ["La préparation des voix des personnages est incomplète.", "AI_MEDIA_CHARACTER_DIALOGUE_MISSING"],
  ["ai_video_omni_rate_limited:429 Your project has exceeded its monthly spending cap.", "AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED"],
  ["Quota exceeded for your project, check billing.", "AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED"],
  ["ai_video_provider_billable_failure:La limite quotidienne de sécurité IA (coût de sécurité) de ce compte est atteinte.", "AI_MEDIA_ACCOUNT_DAILY_SAFETY_LIMIT"],
  ["ai_video_veo_operation_failed:The service is currently experiencing high load", "AI_MEDIA_VIDEO_CAPACITY_REACHED"],
  ["ai_video_provider_billable_failure:ai_video_veo_safety_filtered:We encountered an issue with the audio due to safety filters.", "AI_MEDIA_AUDIO_SAFETY_FILTERED"],
  ["ai_video_veo_safety_filtered:Sorry, we can't create videos from input images containing photorealistic children.", "AI_MEDIA_REFERENCE_POLICY_REJECTED"],
  ["imagine:content-moderated: Generated video rejected by content moderation.", "AI_MEDIA_VIDEO_SAFETY_FILTERED"],
  ["Invalid resolution: 720x1280", "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED"],
  ["400 Image delivery mode is not supported.", "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED"],
  ["allow_adult for personGeneration is currently not supported.", "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED"],
  ["seed parameter is only supported in Gemini Enterprise Agent Platform mode, not in Gemini Developer API mode.", "AI_MEDIA_VIDEO_CONFIGURATION_REJECTED"],
  ["ai_video_fal_credentials_missing", "AI_MEDIA_GATEWAY_NOT_CONFIGURED"],
  ["ai_video_instruction_contract_too_long:30:3294", "AI_MEDIA_VIDEO_INSTRUCTION_TOO_COMPLEX"],
  ["ai_video_omni_scene_count_invalid", "AI_MEDIA_VIDEO_PREPARATION_FAILED"],
  ["ai_video_provider_contract_incomplete", "AI_MEDIA_VIDEO_PREPARATION_FAILED"],
  ["ai_media_exact_dialogue_unfit", "AI_MEDIA_EXACT_DIALOGUE_INVALID"],
  ["ai_media_character_dialogue_unavailable", "AI_MEDIA_CHARACTER_DIALOGUE_UNAVAILABLE"],
  ["ai_media_narration_unavailable:ai_media_narration_copy_unavailable", "AI_MEDIA_NARRATION_UNAVAILABLE"],
  ["ai_media_visible_copy_unavailable", "AI_MEDIA_VISIBLE_COPY_UNAVAILABLE"],
  ["ai_image_identity_generation_unavailable", "AI_MEDIA_IMAGE_PROVIDERS_UNAVAILABLE"],
  ["ai_media_essential_video_composition_failed", "AI_MEDIA_VIDEO_COMPOSITION_FAILED"],
  ["ai_video_omni_billable_failure:ai_video_omni_interaction_id_missing", "AI_MEDIA_VIDEO_INCOMPLETE"],
  ["Request timed out after 11319 ms.", "AI_MEDIA_GENERATION_TIMEOUT"],
  ["ResponseAborted", "AI_MEDIA_CONNECTION_INTERRUPTED"],
  ["Internal Server Error", "AI_MEDIA_VIDEO_PROVIDER_UNAVAILABLE"],
] as const;
for (const [diagnostic, code] of historical) test(`historical cause: ${code} / ${diagnostic.slice(0, 50)}`, () => {
  assert.equal(explain(new Error(diagnostic)).code, code);
});

test("nested causes outrank generic wrappers, including timeouts over AbortError", () => {
  assert.equal(explain(new Error("ai_media_narration_unavailable", { cause: new Error("La voix off est trop longue pour cette durée.") })).code, "AI_MEDIA_NARRATION_TOO_LONG");
  assert.equal(explain({ error_code: "ai_media_narration_unavailable", error_details: [{ code: "ai_media_generated_narration_invalid" }] }).code, "AI_MEDIA_GENERATED_NARRATION_INVALID");
  assert.equal(explain({ message: "Request timed out", cause: { name: "AbortError" } }).code, "AI_MEDIA_GENERATION_TIMEOUT");
  assert.equal(explain(new DOMException("This operation was aborted", "AbortError")).code, "AI_MEDIA_CONNECTION_INTERRUPTED");
  assert.equal(explain(new Error("ai_media_generation_cancelled")).code, "AI_MEDIA_GENERATION_CANCELLED");
});

test("a supplier minimum-balance refusal has a precise operator-facing cause without a wallet recharge request", () => {
  const diagnostic = "Video generation requires a minimum balance of $10. Your current balance is insufficient. Visit https://provider.invalid/billing?token=private to top up your credits.";
  const error = new Error("Video provider unavailable", { cause: new Error(diagnostic) });
  const result = explain(error);
  assert.equal(result.code, "AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT");
  assert.equal(result.status, 503);
  assert.match(result.reason, /fournisseur vidéo.*solde nécessaire/);
  assert.match(result.action, /assistance iNrCy/);
  assert.doesNotMatch(result.message, /https:|\$10|private|recharg|autre moteur|n’a pas démarré/);
  assert.equal(isAiMediaProviderBillingFailure(error), true);
  for (const message of ["insufficient_balance", "INSUFFICIENT FUNDS", "Not enough credits for video", "Credit balance too low"])
    assert.equal(explain({ error: { message } }).code, result.code);
  assert.equal(explain({ code: "AI_MEDIA_QUOTA_REACHED" }).code, "AI_MEDIA_QUOTA_REACHED");
  assert.equal(isAiMediaProviderBillingFailure({ message: "provider unavailable", metadata: { prompt: diagnostic } }), false);
});

test("per-minute request quotas are distinct from supplier billing failures", () => {
  for (const suffix of ["", " Check billing for more information."]) {
    const error = Object.assign(new Error(`Quota exceeded for metric GenerateContent requests per minute per project. Please retry in 60 seconds.${suffix}`), { statusCode: 429 });
    assert.equal(isAiMediaProviderBillingFailure(error), false);
    assert.equal(explain(error).code, "AI_MEDIA_VIDEO_CAPACITY_REACHED");
    assert.equal(explain(error).status, 429);
    assert.equal(explain(error).retryAfterSeconds, 60);
  }
});

test("audio QA explains missing, repeated, incomplete and mismatched speech separately", () => {
  for (const [issue, code] of [
    ["spoken_dialogue_missing", "AI_MEDIA_VIDEO_SPEECH_MISSING"], ["spoken_dialogue_incomplete", "AI_MEDIA_VIDEO_SPEECH_INCOMPLETE"],
    ["spoken_dialogue_repeated", "AI_MEDIA_VIDEO_SPEECH_REPEATED"], ["spoken_dialogue_mismatch", "AI_MEDIA_VIDEO_SPEECH_MISMATCH"],
  ]) assert.equal(explain(new Error(`ai_media_free_native_character_speech_unusable:${issue}`)).code, code);
});

test("a critical speech mismatch takes priority over incidental repeated words", () => {
  assert.equal(explain(new Error("ai_media_free_native_character_speech_unusable:spoken_critical_value_mismatch,spoken_dialogue_repeated,spoken_dialogue_mismatch")).code,
    "AI_MEDIA_VIDEO_SPEECH_MISMATCH");
  assert.equal(explain(new Error("ai_media_free_native_character_speech_unusable:spoken_critical_value_mismatch")).code,
    "AI_MEDIA_VIDEO_SPEECH_MISMATCH");
  assert.equal(explain(new Error("ai_media_free_native_character_speech_unusable:spoken_dialogue_repeated,spoken_dialogue_mismatch")).code,
    "AI_MEDIA_VIDEO_SPEECH_REPEATED", "a correctly pronounced script replayed twice is still explained as repetition");
});

test("unknown and malicious diagnostics never become public output, including getter and cycle traps", () => {
  const secret = "PRIVATE_PROMPT https://private.invalid/?token=secret data:image/png;base64,AAAA sk-test-secret";
  const error: Record<string, unknown> = { message: secret, metadata: { code: "ai_media_generation_cancelled" } };
  error.cause = error;
  Object.defineProperty(error, "details", { get() { throw new Error(secret); } });
  const result = explain(error);
  assert.equal(result.code, "AI_MEDIA_GENERATION_FAILED");
  assert.match(result.message, /cause identifiable/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|https:|token|secret|base64|sk-test/);
  assert.equal(explain({ error: [{ message: "unknown" }] }, { expired: true }).code, "AI_MEDIA_GENERATION_EXPIRED");
  assert.equal(explain({ message: "x".repeat(500_000) }).code, "AI_MEDIA_GENERATION_FAILED");
});

test("every canonical public code round trips without diagnostics or a promise about credits", () => {
  for (const [code, entry] of Object.entries(AI_MEDIA_PUBLIC_ERROR_CATALOG)) {
    const result = explain({ code, message: "PRIVATE_DETAIL" });
    assert.equal(result.code, code); assert.equal(result.message, `${entry.reason} ${entry.action}`);
    assert.doesNotMatch(result.message, /PRIVATE_DETAIL|aucun quota|aucun crédit|deux moteurs/i);
  }
});

test("an image safety rejection is classified without exposing the supplier's private diagnostics", () => {
  const refusal = new Error("Image provider failed", { cause: { code: "content_policy_violation", message: "Your request was rejected by the safety system. PRIVATE_REQUEST_ID" } });
  assert.equal(isAiMediaContentPolicyRejection(refusal), true);
  const result = explain(refusal);
  assert.equal(result.code, "AI_MEDIA_CONTENT_POLICY_REJECTED");
  assert.equal(result.status, 422);
  assert.doesNotMatch(result.message, /PRIVATE|help\.openai|réessayez|autre moteur/i);
  assert.equal(explain("Your request was rejected by the safety system. If you believe this is an error").code, result.code);
});

test("content refusals stay distinct from spending fuses, temporary limits and arbitrary prompt metadata", () => {
  for (const code of ["AI_MEDIA_CONTENT_POLICY_REJECTED", "AI_MEDIA_REFERENCE_POLICY_REJECTED", "AI_MEDIA_AUDIO_SAFETY_FILTERED", "AI_MEDIA_VIDEO_SAFETY_FILTERED"])
    assert.equal(isAiMediaContentPolicyRejection({ code }), true);
  for (const error of ["AI_GATEWAY_ACCOUNT_LIMIT_REACHED", "La limite quotidienne de sécurité IA est atteinte", "AI safety limit", "Rate limit 429", "Request timed out", { message: "provider unavailable", metadata: { prompt: "safety filter" } }])
    assert.equal(isAiMediaContentPolicyRejection(error), false);
});
