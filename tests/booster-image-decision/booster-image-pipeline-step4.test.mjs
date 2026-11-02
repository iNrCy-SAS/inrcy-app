import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Step 4 persists explicit Adapter provenance instead of relying on opening the modal", async () => {
  const shared = await read("app/dashboard/booster/publier/publishModal.shared.tsx");
  const controller = await read("app/dashboard/booster/publier/usePublishImageController.ts");

  assert.match(shared, /customizedImageKeys\?: string\[\]/);
  assert.match(controller, /areBoosterImageTransformsEquivalent/);
  assert.match(controller, /customizedImageKeys\.add\(imageKey\)/);
  assert.match(controller, /customizedImageKeys\.delete\(imageKey\)/);
});

test("Step 4 gives explicit customization priority in preview and publication preparation", async () => {
  const controller = await read("app/dashboard/booster/publier/usePublishImageController.ts");

  assert.match(controller, /const activeEditorDisplayPlan = getBoosterImageDisplayPlan\(\{/);
  assert.match(controller, /customized: activeEditorExplicitlyCustomized/);
  assert.match(controller, /customized: explicitlyCustomized/);
  assert.match(controller, /imageDecisionMode: displayPlan\.decision\.mode/);
  assert.match(controller, /isCustomized: displayPlan\.decision\.mode === "customized"/);
});

test("Step 4 keeps manual Instagram carousel framing inside the shared sequence ratio", async () => {
  const controller = await read("app/dashboard/booster/publier/usePublishImageController.ts");

  assert.match(
    controller,
    /channel === "instagram" && sequenceTargetRatio[\s\S]*buildAutomaticRenderPreset\(channel, sequenceTargetRatio\)/,
  );
  assert.match(controller, /activeEditorSequenceTargetRatio/);
  assert.match(
    controller,
    /activeEditorDisplayPlan\.decision\.mode === "customized"[\s\S]*activeEditorSequenceTargetRatio/,
  );
});

test("Step 4 keeps Adapter provenance in drafts, scheduled payloads and editable attachments", async () => {
  const controller = await read("app/dashboard/booster/publier/usePublishImageController.ts");
  const foundations = await read(
    "app/api/booster/publish-now/publishNow.foundations.ts",
  );

  assert.match(controller, /customizedImageKeys: \(editor\.customizedImageKeys \|\| \[\]\)\.filter/);
  assert.match(controller, /customizedImageKeys: actualCustomizedImageKeys/);
  assert.match(foundations, /imageDecisionMode/);
  assert.match(foundations, /isCustomized: raw\.isCustomized === true/);
});
