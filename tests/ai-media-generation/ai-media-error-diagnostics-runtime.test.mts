import assert from "node:assert/strict";
import test from "node:test";
import { redactAiMediaSensitiveText, safeAiMediaErrorDetails, safeAiMediaErrorMessage } from "../../lib/aiMediaSensitiveText.ts";

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
