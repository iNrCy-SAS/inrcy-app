import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAiMediaNativeDialogue, getAiMediaNativeDialogueDeliveryDecision,
  type AiMediaNativeDialogueQaResult, type AiMediaNativeDialogueQaClipResult,
} from "../../lib/aiMediaNativeDialogueQa.ts";

function dkAudit(overrides: Partial<AiMediaNativeDialogueQaClipResult> = {}): AiMediaNativeDialogueQaResult {
  return { version: 1, status: "rejected", elapsedMs: 120, clips: [{ sceneIndex: 0, status: "rejected",
    issues: ["spoken_critical_value_mismatch"], confirmationDecision: "confirmed_defect", audioCheckCount: 2,
    metrics: { expectedTokenCount: 20, detectedTokenCount: 22, expectedCoverage: 1,
      bestWindowSimilarity: 0.9091, extraTokenCount: 2, repeatCount: 0 }, ...overrides }] };
}

test("DK's complete twenty-word take with two extra tokens is delivered for review without declaring Exact passed", () => {
  const audit = dkAudit(); const before = structuredClone(audit);
  assert.deepEqual(getAiMediaNativeDialogueDeliveryDecision(audit), { version: 1, status: "warning",
    code: "native_speech_review_recommended", issues: ["spoken_critical_value_mismatch"], sceneIndexes: [0] });
  assert.deepEqual(audit, before, "delivery policy must never overwrite the independent audio verdict");
  assert.equal(audit.status, "rejected");
});

test("a real short critical wording difference becomes review, while intact wording remains passed", () => {
  const expectedLine = "Les feuilles tombent et votre jardin a besoin d’entretien. Nous sommes là pour vous donner un coup de main !";
  const exact = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine, transcript: expectedLine });
  const limited = evaluateAiMediaNativeDialogue({ sceneIndex: 0, expectedLine,
    transcript: expectedLine.replace("votre jardin", "votre premier jardin") });
  assert.equal(exact.status, "passed");
  assert.deepEqual(getAiMediaNativeDialogueDeliveryDecision({ version: 1, status: exact.status, clips: [exact], elapsedMs: 1 }),
    { version: 1, status: "passed" });
  assert.equal(limited.status, "rejected");
  assert.deepEqual(limited.issues, ["spoken_critical_value_mismatch"]);
  assert.equal(getAiMediaNativeDialogueDeliveryDecision({ version: 1, status: limited.status, clips: [limited], elapsedMs: 1 }).status, "warning");
});

test("missing, truncated, repeated, substantially different and visually invalid takes still block", () => {
  for (const issue of ["spoken_dialogue_missing", "spoken_dialogue_incomplete", "spoken_dialogue_repeated",
    "spoken_dialogue_mismatch", "unexpected_visual_fragmentation", "final_frame_unverified"] as const) {
    assert.equal(getAiMediaNativeDialogueDeliveryDecision(dkAudit({ issues: ["spoken_critical_value_mismatch", issue] })).status, "blocked", issue);
  }
  const metrics = dkAudit().clips[0].metrics;
  for (const patch of [{ expectedCoverage: 0.7 }, { bestWindowSimilarity: 0.68 }, { extraTokenCount: 8, detectedTokenCount: 28 },
    { repeatCount: 2 }, { detectedTokenCount: 0 }, { expectedTokenCount: 0 }, { expectedCoverage: NaN }]) {
    assert.equal(getAiMediaNativeDialogueDeliveryDecision(dkAudit({ metrics: { ...metrics, ...patch } })).status, "blocked", JSON.stringify(patch));
  }
  for (const finalFrameLayout of ["rejected", "unavailable"] as const) {
    assert.equal(getAiMediaNativeDialogueDeliveryDecision(dkAudit({ finalFrameLayout })).status, "blocked");
  }
  assert.equal(getAiMediaNativeDialogueDeliveryDecision({ ...dkAudit(), status: "unavailable" }).status, "blocked");
  assert.equal(getAiMediaNativeDialogueDeliveryDecision(null).status, "blocked");
});

test("every clip must qualify, and delivery metadata contains only bounded fixed categories", () => {
  const audit = dkAudit();
  audit.clips.push({ ...audit.clips[0], sceneIndex: 1, status: "passed", issues: [] });
  const contaminated = Object.assign(audit, { transcript: "PRIVATE_TRANSCRIPT", url: "https://private.invalid?token=secret" });
  const decision = getAiMediaNativeDialogueDeliveryDecision(contaminated);
  assert.equal(decision.status, "warning");
  assert.doesNotMatch(JSON.stringify(decision), /PRIVATE|https:|secret|transcript|metrics|elapsed/);
  audit.clips[1] = { ...audit.clips[1], status: "rejected", issues: ["spoken_dialogue_missing"] };
  assert.equal(getAiMediaNativeDialogueDeliveryDecision(audit).status, "blocked");
  assert.equal(getAiMediaNativeDialogueDeliveryDecision(dkAudit({ sceneIndex: 400 })).status, "blocked");
  assert.equal(getAiMediaNativeDialogueDeliveryDecision({ ...dkAudit(), clips: Array(5).fill(dkAudit().clips[0]) }).status, "blocked");
});
