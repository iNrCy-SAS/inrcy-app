import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Step 10 nonies keeps advanced publishing blocks behind an explicit creation mode", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(
    modal,
    /const \[creationMode, setCreationMode\][\s\S]*useState<BoosterCreationMode \| null>\(null\)/,
  );
  assert.match(modal, /<PublishCreationModePanel/);
  assert.match(modal, /creationMode === "ai" && workflowSteps\?\.intention/);
  assert.match(modal, /showContentWorkspace && workflowSteps/);
  assert.match(modal, /<PublishContentEditorPanel/);
  assert.doesNotMatch(modal, /<PublishImagesPanel/);
  assert.match(modal, /<PublishMediaPoolPanel/);
  assert.match(modal, /<PublishValidationBoard/);
  assert.match(modal, /<PublishFooterActions/);
});

test("Step 10 nonies opens the manual workspace directly without duplicating publishing", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const modePanel = read(
    "app/dashboard/booster/publier/components/PublishCreationModePanel.tsx",
  );
  const intentPanel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );

  assert.match(modal, /const onSelectCreationMode = async/);
  assert.match(modal, /setContentWorkspaceOpen\(nextMode === "manual"\)/);
  assert.match(modePanel, /titleKey: "wizard_automatic"/);
  assert.match(modePanel, /titleKey: "wizard_manual"/);
  assert.doesNotMatch(intentPanel, /onCreateManually/);
  assert.equal((modal.match(/<PublishFooterActions/g) || []).length, 1);
});

test("Step 10 nonies protects current branch work before changing mode or regenerating", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(modal, /if \(creationMode && hasCurrentCreationModeWork\)/);
  assert.match(modal, /Passer à la création manuelle/);
  assert.match(modal, /Passer à la création avec iNrCy/);
  assert.match(modal, /Vos canaux et vos médias seront conservés/);
  // Targeted adjustment already confirms its scope in the two-step dialog.
  // Replacing all content must still ask for explicit confirmation.
  assert.match(modal, /if \(hasWrittenChannelContent && !contentAdjustment\)/);
  assert.match(modal, /i18nT\("generer_de_nouveaux_contenus_8a601a4e"\)/);
});

test("Step 10 nonies restores a saved creation mode and closes every branch on reset", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(modal, /inferBoosterCreationMode\(\{/);
  assert.match(modal, /setCreationMode\(nextCreationMode\)/);
  assert.match(modal, /setContentWorkspaceOpen\([\s\S]*nextCreationMode === "manual"/);
  assert.match(modal, /setCreationMode\(null\)/);
  assert.match(modal, /setContentWorkspaceOpen\(false\)/);
  assert.match(modal, /clearChannelCreationWork\(\)/);
});

test("Step 10 nonies derives dynamic numbering for AI and manual paths", () => {
  const workflow = read("lib/boosterCreationMode.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(
    workflow,
    /mode === "ai"[\s\S]*intention: 3[\s\S]*content: 4[\s\S]*media: 5[\s\S]*preview: 6/,
  );
  assert.match(
    workflow,
    /intention: null[\s\S]*content: 3[\s\S]*media: 4[\s\S]*preview: 5/,
  );
  assert.match(modal, /stepNumber=\{workflowSteps\.content\}/);
  assert.match(modal, /<PublishWizardScreen active=\{activeWizardStep === "media"\} step="media"/);
  assert.match(modal, /const wizardSteps = getPublishWizardSteps\(creationMode\)/);
  const wizard = read("app/dashboard/booster/publier/components/publishWizard.ts");
  assert.match(wizard, /mode === "manual"/);
  assert.match(wizard, /step !== "intention"/);
});
