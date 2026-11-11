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

test("unsafe image logo placement has one actionable private-safe explanation in live and persisted failures", () => {
  for (const error of [
    new Error("ai_media_logo_no_safe_placement"),
    new Error("ai_image_exact_contact_composition_failed", { cause: new Error("ai_media_logo_no_safe_placement:PRIVATE_LAYOUT 0.8 https://private.invalid/?token=secret") }),
    { code: "AI_MEDIA_LOGO_NO_SAFE_PLACEMENT", message: "PRIVATE_LAYOUT" },
  ]) {
    const result = explain(error);
    assert.equal(result.code, "AI_MEDIA_LOGO_NO_SAFE_PLACEMENT");
    assert.equal(result.status, 422);
    assert.equal(result.message, "L’image ne laisse pas d’espace assez libre pour votre logo. Essayez une composition plus aérée.");
    assert.equal(result.retryAfterSeconds, undefined);
    assert.doesNotMatch(result.message, /PRIVATE|https:|token|secret|OCR|seuil|0\.8|rembours|crédit/);
  }
  assert.notEqual(explain({ message: "unknown", metadata: { prompt: "ai_media_logo_no_safe_placement" } }).code, "AI_MEDIA_LOGO_NO_SAFE_PLACEMENT");
});

test("cloned narrator failures remain human-readable in generation and recovery without leaking provider diagnostics", () => {
  const cases = [
    ["ai_media_voice_clone_reference_invalid", "AI_MEDIA_NARRATION_VOICE_INVALID"],
    ["ai_media_voice_clone_reference_duration_invalid", "AI_MEDIA_NARRATION_VOICE_INVALID"],
    ["ai_media_voice_clone_consent_required", "AI_MEDIA_NARRATION_VOICE_CONSENT_REQUIRED"],
    ["ai_media_voice_clone_language_unsupported", "AI_MEDIA_NARRATION_VOICE_LANGUAGE_UNSUPPORTED"],
    ["ai_media_voice_clone_script_invalid", "AI_MEDIA_VOICE_CLONE_SCRIPT_INVALID"],
    ["ai_media_voice_clone_audio_format_mismatch", "AI_MEDIA_VOICE_CLONE_OUTPUT_INVALID"],
    ["ai_media_voice_clone_output_invalid", "AI_MEDIA_VOICE_CLONE_OUTPUT_INVALID"],
    ["ai_media_voice_clone_provider_http_401", "AI_MEDIA_VOICE_CLONE_UNAVAILABLE"],
    ["ai_media_voice_clone_provider_http_402", "AI_MEDIA_VOICE_CLONE_UNAVAILABLE"],
    ["ai_media_voice_clone_provider_http_429", "AI_MEDIA_VOICE_CLONE_UNAVAILABLE"],
    ["ai_media_voice_clone_credentials_missing", "AI_MEDIA_VOICE_CLONE_UNAVAILABLE"],
    ["ai_media_voice_clone_timeout", "AI_MEDIA_VOICE_CLONE_UNAVAILABLE"],
  ];
  for (const [cause, expected] of cases) {
    const raw = new Error("ai_media_narration_unavailable", { cause: new Error(cause + " https://private.invalid/voice?token=secret FAL_KEY=private") });
    const live = explain(raw), recovered = explain({ error_code: "ai_media_narration_unavailable", error_details: [{ message: cause }] });
    assert.equal(live.code, expected); assert.equal(recovered.code, expected);
    assert.doesNotMatch(live.message, /ai_media_|FAL_KEY|https:|token=|secret|http_\d/);
    assert.doesNotMatch(live.action, /recharg|autre moteur/);
  }
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

test("an unavailable speech verification is a private-safe technical 503, never a provider or script accusation", () => {
  for (const error of [
    new Error("ai_media_native_speech_verification_unavailable"),
    { code: "AI_MEDIA_VIDEO_SPEECH_VERIFICATION_UNAVAILABLE", message: "PRIVATE_TRANSCRIPT", cause: { message: "503 timeout https://private.invalid/?token=secret" } },
  ]) {
    const result = explain(error);
    assert.equal(result.code, "AI_MEDIA_VIDEO_SPEECH_VERIFICATION_UNAVAILABLE");
    assert.equal(result.status, 503);
    assert.equal(result.message, "La vérification des paroles n’a pas pu aboutir. Réessayez dans quelques instants.");
    assert.equal(result.retryAfterSeconds, 30);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|https:|token|secret|moteur|prompt|réplique|correspondent/);
  }
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


test("overlong cloned output is distinct from dense user text in live and persisted recovery errors", () => {
  for (const error of [
    new Error("ai_media_narration_unavailable", { cause: new Error("ai_media_voice_clone_duration_invalid", { cause: new Error("ai_narration_too_long_for_natural_pace:PRIVATE") }) }),
    { code: "AI_MEDIA_NARRATION_TOO_LONG", error_details: [{ message: "ai_media_voice_clone_duration_invalid" }] },
    { code: "AI_MEDIA_VOICE_CLONE_DURATION_INVALID" },
  ]) {
    const actual = explain(error);
    assert.equal(actual.code, "AI_MEDIA_VOICE_CLONE_DURATION_INVALID"); assert.equal(actual.status, 502);
    assert.equal(actual.message, "Le service de voix réelle a produit une piste trop longue pour cette vidéo. Vos paroles et votre vocal sont conservés.");
    assert.doesNotMatch(actual.message, /PRIVATE|raccourci|plus longue|réessay|relanc/i);
  }
  assert.equal(explain(new Error("ai_media_exact_narration_too_long")).code, "AI_MEDIA_EXACT_NARRATION_TOO_LONG");
  assert.equal(explain(new Error("ai_narration_too_long_for_natural_pace")).code, "AI_MEDIA_NARRATION_TOO_LONG");
});


test("native image QA exposes precise private-safe visual causes in live and recovered failures", () => {
  for (const [machine, code] of [["ai_media_native_visual_layout_invalid", "AI_MEDIA_VIDEO_VISUAL_LAYOUT_INVALID"], ["ai_media_native_visual_verification_unavailable", "AI_MEDIA_VIDEO_VISUAL_VERIFICATION_UNAVAILABLE"]]) {
    for (const failure of [new Error("ai_video_provider_billable_failure", { cause: new Error(machine) }), { code, error_details: [{ message: machine }] }]) {
      const result = explain(failure); assert.equal(result.code, code);
      assert.doesNotMatch(result.message, /réessay|relanc|raccourci|voix|paroles|crédit|rembours/i);
    }
  }
});
