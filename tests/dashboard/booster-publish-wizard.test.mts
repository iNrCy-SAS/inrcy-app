import assert from "node:assert/strict";
import test from "node:test";
import {
  canOpenPublishWizardStep,
  getPublishWizardSteps,
  getRestoredPublishWizardStep,
  getVisiblePublishWizardStep,
} from "../../app/dashboard/booster/publier/components/publishWizard.ts";

test("the automatic path follows the agreed sequence, and manual skips only the AI brief", () => {
  assert.deepEqual(getPublishWizardSteps("ai"), [
    "channels", "intention", "content", "media", "control", "publication",
  ]);
  assert.deepEqual(getPublishWizardSteps("manual"),
    getPublishWizardSteps("ai").filter((step) => step !== "intention"));
});

test("mode can be selected before any account is connected, but creation needs channels", () => {
  const empty = { mode: null, channelCount: 0, contentReady: false, busy: false };
  assert.equal(canOpenPublishWizardStep("mode", empty), true);
  assert.equal(canOpenPublishWizardStep("channels", empty), true);
  assert.equal(canOpenPublishWizardStep("channels", { ...empty, mode: "ai" }), true);
  assert.equal(canOpenPublishWizardStep("intention", { ...empty, mode: "ai" }), false);
  assert.equal(canOpenPublishWizardStep("content", { ...empty, mode: "manual" }), false);
});

test("a new publication requires an explicit mode even with all channels and existing content ready", () => {
  const ready = { channelCount: 11, contentReady: true, busy: false };
  for (const step of ["intention", "content", "media", "control"] as const) {
    assert.equal(canOpenPublishWizardStep(step, { ...ready, mode: null }), false, `${step} must wait for an explicit mode`);
  }
  assert.equal(getRestoredPublishWizardStep(null, true), "mode");
  assert.equal(canOpenPublishWizardStep("intention", { ...ready, mode: "ai" }), true);
  assert.equal(canOpenPublishWizardStep("intention", { ...ready, mode: "manual" }), false);
  for (const mode of ["ai", "manual"] as const) {
    for (const step of ["content", "media", "control"] as const) {
      assert.equal(canOpenPublishWizardStep(step, { ...ready, mode }), true);
    }
  }
});

test("preparation combines mode and channels while review and results keep their action guards", () => {
  assert.equal(getVisiblePublishWizardStep("mode"), "channels");
  assert.equal(getVisiblePublishWizardStep("validation"), "control");
  assert.equal(getVisiblePublishWizardStep("results"), "publication");
});

test("navigation cannot bypass automatic generation or enter the publication engine", () => {
  const ready = { mode: "ai" as const, channelCount: 2, contentReady: true, busy: false };
  assert.equal(canOpenPublishWizardStep("intention", ready), true);
  assert.equal(canOpenPublishWizardStep("content", { ...ready, contentReady: false }), false);
  for (const step of ["validation", "publication", "results"] as const) {
    assert.equal(canOpenPublishWizardStep(step, ready), false);
  }
  for (const step of getPublishWizardSteps("ai")) {
    assert.equal(canOpenPublishWizardStep(step, { ...ready, busy: true }), false);
  }
});

test("returning between editable steps does not require regeneration", () => {
  const ready = { mode: "ai" as const, channelCount: 2, contentReady: true, busy: false };
  for (const step of ["mode", "channels", "intention", "content", "media", "control"] as const) {
    assert.equal(canOpenPublishWizardStep(step, ready), true);
  }
  assert.equal(canOpenPublishWizardStep("intention", { ...ready, mode: "manual" }), false);
});

test("drafts reopen their existing content or unfinished AI brief", () => {
  assert.equal(getRestoredPublishWizardStep("ai", true), "content");
  assert.equal(getRestoredPublishWizardStep("manual", false), "content");
  assert.equal(getRestoredPublishWizardStep("ai", false), "intention");
  assert.equal(getRestoredPublishWizardStep(null, false), "mode");
});
