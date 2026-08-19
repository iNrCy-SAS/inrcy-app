import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBoosterCreationWorkflow,
  shouldPrepareBoosterMediaForAi,
} from "../../lib/boosterCreationMode.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const contentPanel = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);
const imagePanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);
const workspaceHook = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const generationRoute = read("app/api/booster/generate/route.ts");
const imageController = read(
  "app/dashboard/booster/publier/usePublishImageController.ts",
);

test("step 3 defines two complete and isolated creation paths", () => {
  const ai = getBoosterCreationWorkflow("ai");
  assert.equal(ai.showsIntent, true);
  assert.equal(ai.opensContentImmediately, false);
  assert.equal(ai.generationEnabled, true);
  assert.equal(ai.aiPreparationEnabled, true);
  assert.deepEqual(ai.path, [
    "channels",
    "creation_mode",
    "intention_optional_media",
    "generation",
    "generated_content",
    "publication_media",
    "publication",
  ]);

  const manual = getBoosterCreationWorkflow("manual");
  assert.equal(manual.showsIntent, false);
  assert.equal(manual.opensContentImmediately, true);
  assert.equal(manual.generationEnabled, false);
  assert.equal(manual.aiPreparationEnabled, false);
  assert.deepEqual(manual.path, [
    "channels",
    "creation_mode",
    "manual_channel_content",
    "publication_media",
    "publication",
  ]);
});

test("AI media preparation follows the selected path and the image opt-in", () => {
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "manual",
      mediaType: "images",
      hasImages: true,
      hasVideo: false,
      useImagesForAI: true,
    }),
    false,
  );
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "ai",
      mediaType: "images",
      hasImages: true,
      hasVideo: false,
      useImagesForAI: false,
    }),
    false,
  );
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "ai",
      mediaType: "images",
      hasImages: true,
      hasVideo: false,
      useImagesForAI: true,
    }),
    true,
  );
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "ai",
      mediaType: "video",
      hasImages: false,
      hasVideo: true,
      useImagesForAI: false,
    }),
    true,
  );
});

test("the manual path cannot trigger AI generation or AI media preparation", () => {
  assert.match(modal, /if \(creationMode !== "ai"\)/);
  assert.match(workspaceHook, /creationModeRef\.current !== "ai"/);
  assert.match(workspaceHook, /runPreparationMission\("ai_preparation"\)/);
  assert.match(generationRoute, /body\.creationMode === "manual"/);
  assert.match(generationRoute, /manual_generation_forbidden/);
  assert.match(contentPanel, /creationMode === "manual"/);
  assert.match(contentPanel, /i18nT\("textes_par_canal_bf3c7397"\)/);
  assert.match(modal, /creationMode=\{creationMode\}/);
});

test("workspace media is consumed by AI only when explicitly requested", () => {
  assert.match(modal, /const shouldPrepareMediaForAi = shouldPrepareBoosterMediaForAi/);
  assert.match(
    modal,
    /const shouldUsePersistentMediaWorkspaceForAi =[\s\S]*shouldPrepareMediaForAi[\s\S]*unifiedMediaConsumptionClientAvailable/,
  );
  assert.match(
    modal,
    /let readyMediaWorkspaceId = shouldUsePersistentMediaWorkspaceForAi[\s\S]*waitForPersistentWorkspaceReadiness/,
  );
  assert.match(
    modal,
    /useWorkspaceMediaForAI:[\s\S]*shouldUsePersistentMediaWorkspaceForAi/,
  );
  assert.match(
    modal,
    /mediaWorkspaceExpected:[\s\S]*shouldUsePersistentMediaWorkspaceForAi[\s\S]*Boolean\(readyMediaWorkspaceId\)/,
  );
  assert.match(generationRoute, /let useWorkspaceMediaForAI =/);
  assert.match(
    generationRoute,
    /if \(mediaWorkspaceId && useWorkspaceMediaForAI\)/,
  );
});

test("generation reuses the existing workspace and never resynchronizes the original", () => {
  const generateStart = modal.indexOf("const onGenerate = async");
  const generateEnd = modal.indexOf("const onDuplicateContentToAllChannels", generateStart);
  assert.ok(generateStart >= 0 && generateEnd > generateStart);
  const generateSource = modal.slice(generateStart, generateEnd);

  assert.match(generateSource, /waitForPersistentWorkspaceReadiness/);
  assert.doesNotMatch(generateSource, /syncPersistentWorkspaceImages\(/);
  assert.doesNotMatch(generateSource, /syncPersistentWorkspaceVideo\(/);
});

test("media can be added after generation without clearing channel content", () => {
  const videoStart = modal.indexOf("const addVideoFile = async");
  const videoEnd = modal.indexOf("const onVideoChange", videoStart);
  assert.ok(videoStart >= 0 && videoEnd > videoStart);
  const videoSource = modal.slice(videoStart, videoEnd);
  assert.doesNotMatch(videoSource, /setPostsByChannel\(/);
  assert.doesNotMatch(videoSource, /setContentWorkspaceOpen\(false\)/);

  const imageStart = imageController.indexOf("const addImageFiles = async");
  const imageEnd = imageController.indexOf("const onImagesChange", imageStart);
  assert.ok(imageStart >= 0 && imageEnd > imageStart);
  const imageSource = imageController.slice(imageStart, imageEnd);
  assert.doesNotMatch(imageSource, /setPostsByChannel\(/);
  assert.doesNotMatch(imageSource, /setContentWorkspaceOpen/);

  assert.match(intentPanel, /getLocalizedBoosterMediaOptimization\("generation", runtimeT\)/);
  assert.match(imagePanel, /getLocalizedBoosterMediaOptimization\("publication", runtimeT\)/);
});

test("the UI keeps one final publishing engine with dynamic branch labels", () => {
  assert.match(
    modal,
    /creationMode === "ai" && workflowSteps\?\.intention && creationWorkflow\?\.showsIntent/,
  );
  assert.match(modal, /showContentWorkspace && workflowSteps/);
  assert.match(contentPanel, /i18nT\("contenus_generes_par_canal_5197ef4e"\)/);
  assert.equal((modal.match(/<PublishFooterActions/g) || []).length, 1);
});
