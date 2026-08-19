import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBoosterPublicationWorkflowSteps,
  inferBoosterCreationMode,
  normalizeBoosterCreationMode,
} from "../../lib/boosterCreationMode.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const modePanel = read(
  "app/dashboard/booster/publier/components/PublishCreationModePanel.tsx",
);
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);

test("creation mode normalization and legacy-draft inference are deterministic", () => {
  assert.equal(normalizeBoosterCreationMode("ai"), "ai");
  assert.equal(normalizeBoosterCreationMode("MANUAL"), "manual");
  assert.equal(normalizeBoosterCreationMode("unknown"), null);

  assert.equal(
    inferBoosterCreationMode({
      explicitMode: "manual",
      idea: "brief historique",
    }),
    "manual",
    "an explicit saved mode must win over legacy inference",
  );
  assert.equal(inferBoosterCreationMode({ idea: "Chantier terminé" }), "ai");
  assert.equal(
    inferBoosterCreationMode({
      postsByChannel: { facebook: { content: "Texte saisi" } },
    }),
    "manual",
  );
  assert.equal(inferBoosterCreationMode({}), null);
});

test("workflow numbering stays explicit for AI and manual creation", () => {
  assert.deepEqual(getBoosterPublicationWorkflowSteps("ai"), {
    intention: 3,
    content: 4,
    media: 5,
    preview: 6,
  });
  assert.deepEqual(getBoosterPublicationWorkflowSteps("manual"), {
    intention: null,
    content: 3,
    media: 4,
    preview: 5,
  });
});

test("Booster displays a permanent block 2 before either creation path", () => {
  assert.match(modePanel, /step=\{2\}/);
  assert.match(modePanel, /titleKey: "creer_avec_inrcy_6abf3922"/);
  assert.match(modePanel, /titleKey: "creer_manuellement_89b2d47e"/);
  assert.match(modePanel, /role="radiogroup"/);
  assert.match(modal, /<PublishChannelSelector[\s\S]*<PublishCreationModePanel/);
  assert.match(
    modal,
    /creationMode === "ai" && workflowSteps\?\.intention[\s\S]*<PublishIntentPanel/,
  );
  assert.match(modal, /showContentWorkspace && workflowSteps/);
});

test("mode switching removes only branch work and preserves shared media", () => {
  const start = modal.indexOf("const onSelectCreationMode");
  const end = modal.indexOf("const onGenerate", start);
  assert.ok(start >= 0 && end > start);
  const switchSource = modal.slice(start, end);

  assert.match(switchSource, /Passer à la création manuelle/);
  assert.match(switchSource, /Passer à la création avec iNrCy/);
  assert.match(switchSource, /Vos canaux et vos médias seront conservés/);
  assert.match(switchSource, /clearAiCreationWork\(\)/);
  assert.match(switchSource, /clearChannelCreationWork\(\)/);
  assert.doesNotMatch(switchSource, /clearImagesMedia\(\)/);
  assert.doesNotMatch(switchSource, /clearVideoMedia\(/);
});

test("the obsolete manual branch button is removed from the AI intention panel", () => {
  assert.doesNotMatch(intentPanel, /onCreateManually/);
  assert.doesNotMatch(intentPanel, />\s*Créer manuellement\s*</);
  assert.doesNotMatch(intentPanel, /channelMediaModes: _channelMediaModes/);
  assert.doesNotMatch(intentPanel, /publicationMediaType,/);
});

test("creation mode is persisted and forwarded without duplicating the publish engine", () => {
  assert.match(modal, /payload: \{\s*status: "draft",\s*creationMode,/);
  assert.match(
    modal,
    /const result = await trackEvent\("publish", \{[\s\S]{0,300}creationMode,/,
  );
  assert.match(modal, /publishPayload: \{\s*creationMode,/);
  assert.equal((modal.match(/<PublishFooterActions/g) || []).length, 1);
});
