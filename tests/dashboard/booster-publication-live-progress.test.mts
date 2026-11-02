import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import { readFileSync as readDraftSessionSource } from "node:fs";
const draftSession = readDraftSessionSource(new URL("../../app/dashboard/booster/publier/publicationDraftSession.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const client = read("lib/boosterPublishClient.ts");
const layer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const footer = read(
  "app/dashboard/booster/publier/components/PublishFooterActions.tsx",
);
const execution = read(
  "app/dashboard/_components/PublishExecutionProgress.tsx",
);
const mediaPanel = read(
  "app/dashboard/booster/publier/components/PublishValidationBoard.tsx",
);
const css = read("app/dashboard/dashboard.module.css");

test("publication progress consumes existing durable snapshots without an extra request", () => {
  assert.match(client, /stage: "request_accepted"/);
  assert.match(client, /stage: "status_update"/);
  assert.match(client, /stage: "completed"/);
  assert.match(client, /stage: "released_to_background"/);
  assert.match(client, /payload: latestPayload/);
  assert.match(submission, /_onPublicationProgress: onPublicationProgress/);
  assert.match(submission, /summary\.entries/);
  assert.match(submission, /terminalCount/);
  assert.match(submission, /mediaPreparationProgress/);
  assert.match(submission, /Préparation des médias/);
  assert.doesNotMatch([modal, submission].join("\n"), /Préparation de la vidéo/);
  assert.match(submission, /mapProgressRange\(progress, 0, 100, 23, 39\)/);
  assert.match(modal, /getPublicationProgressStageForValue\(publishProgress\)/);
  assert.match(submission, /i18nT\("publication_first_channel_progress"/);
  assert.doesNotMatch(
    [modal, submission].join("\n"),
    /setPublishProgress\(\(current\) => Math\.max\(current, phase\.start\)\)/,
  );
  assert.doesNotMatch(
    [modal, submission].join("\n"),
    /setPublicationProgressPhase\([\s\S]{0,180}\b77\b/,
  );
  assert.doesNotMatch([modal, submission].join("\n"), /publishPulseTimerRef/);
});

test("the client-only callback is deleted before the server payload is built", () => {
  const deleteIndex = layer.indexOf(
    "delete publishPayload._onPublicationProgress",
  );
  const postIndex = layer.indexOf("postBoosterPublication(", deleteIndex);
  assert.ok(deleteIndex >= 0 && postIndex > deleteIndex);
  assert.match(layer, /onProgress: onPublicationProgress/);
});

test("Booster binds its destination hub to the existing global progress while preserving compact consumers", () => {
  assert.doesNotMatch([modal, submission].join("\n"), /setPublishChannelProgress/);
  assert.doesNotMatch(footer, /publishChannelProgress|channels=/);
  assert.doesNotMatch(execution, /État de publication par canal|channels\.map/);
  assert.match(execution, /role="progressbar"/);
  assert.match(footer, /variant="immersive"/);
  assert.match(footer, /destinations=\{publicationDestinations\}/);
  assert.match(execution, /variant = "compact"/);
  assert.match(css, /\.publishProgressFillActive::after/);
  assert.match(css, /@keyframes publishProgressSweep/);
});

test("mixed photo and video allocation is explicit and persists to draft and publish", () => {
  assert.match(mediaPanel, /items\.map\(\(item\) =>/);
  assert.match(mediaPanel, /const mode = getMode\(item\.channel\)/);
  assert.match(mediaPanel, /aria-pressed=\{mode === "images"\}/);
  assert.match(mediaPanel, /aria-pressed=\{mode === "video"\}/);
  assert.match(mediaPanel, /getSelectedImageKeys\(item\.channel\)/);
  assert.match(mediaPanel, /videoPreviewUrl && mode === "video"/);
  assert.match(modal, /channelMediaModes,/);
  assert.match(draftSession, /setChannelMediaModes\(nextChannelMediaModes\)/);
  assert.match(
    submission,
    /mediaModeByChannel: buildChannelRecord\(\s*publishTargetMediaModeByChannel,\s*publishTargetChannels/,
  );
});
