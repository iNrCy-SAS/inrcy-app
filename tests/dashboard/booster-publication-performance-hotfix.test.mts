import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAutomaticVideoSettingsForPublication } from "../../lib/boosterVideoSettings.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishClient = read("lib/boosterPublishClient.ts");
const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const resultModal = read("app/dashboard/_components/PublishExecutionResultModal.tsx");
const youtube = read("lib/youtubeShortsPublish.ts");
const layer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const progressPhases = read("lib/boosterProgressPhases.ts");

test("queued publication opens a useful balance by 60 seconds, then continues in background", () => {
  assert.match(publishClient, /BOOSTER_PUBLISH_RESULT_GRACE_MS = 60_000/);
  assert.match(publishClient, /resultGraceMs/);
  assert.match(publishClient, /resultGraceMs - elapsedBeforePollingMs/);
  assert.match(submission, /BOOSTER_PUBLISH_VISIBLE_CAP_MS = 60_000/);
  assert.match(
    submission,
    /BOOSTER_PUBLISH_WITH_MEDIA_FINALIZATION_VISIBLE_CAP_MS = 90_000/,
  );
  assert.match(submission, /_clientVisibleWaitMs/);
  assert.doesNotMatch([publishModal, submission].join("\n"), /await sleep\(remainingPublishWindowMs\)/);
  assert.match(submission, /les workers durables poursuivent l’envoi/);
  assert.match(progressPhases, /key: "inrsend_recording"/);
  assert.match(submission, /completePublicationProgress\([\s\S]*backgroundFinalization/);
  assert.match(publishClient, /releasedToBackground: true/);
  assert.match(publishClient, /BOOSTER_PUBLISH_MAX_POLL_MS = 8_000/);
  assert.match(publishClient, /2 \*\* Math\.min\(3, pollAttempt\)/);
  assert.doesNotMatch(publishClient, /8 \* 60_000/);
  assert.match(resultModal, /api\/booster\/publications/);
  assert.match(resultModal, /hasPendingAsyncJob/);
  assert.match(layer, /void award\("create_actu"/);
  assert.match(layer, /void Promise\.resolve\(refreshMetrics\(\)\)/);
  assert.doesNotMatch(layer, /finally \{\s*await refreshMetrics\(\)/);
});

test("YouTube preserves the selected framing while using the managed master", () => {
  assert.deepEqual(
    getAutomaticVideoSettingsForPublication({
      channel: "youtube_shorts",
      settings: { format: "original", adaptationMode: "safe_frame" },
      durationSeconds: 34,
    }),
    { format: "original", adaptationMode: "safe_frame" },
  );
  assert.doesNotMatch(
    [publishModal, submission].join("\n"),
    /current\.youtube_shorts === "9_16"[\s\S]*setVideoAdaptationModeByChannel/,
  );
  assert.match(publishModal, /mediaPipelineCutoverV1: true/);
  assert.match(publishModal, /allowOriginalVideoFallback: false/);
  assert.doesNotMatch([publishModal, submission].join("\n"), /source: "original"/);
});

test("YouTube streams the stored source instead of buffering the full video", () => {
  assert.match(youtube, /res\.body as unknown as BodyInit/);
  assert.match(youtube, /uploadRequest\.duplex = "half"/);
  assert.match(youtube, /Content-Length": String\(source\.size\)/);
  assert.doesNotMatch(youtube, /const blob = await fetchVideoBlob/);
});

test("media finalization exposes universal media preparation progress", () => {
  assert.match(publishModal, /"publication_checking_media"/);
  assert.match(submission, /Préparation des médias/);
  assert.doesNotMatch([publishModal, submission].join("\n"), /Préparation de la vidéo/);
  assert.match(submission, /mediaPreparationProgress/);
  assert.match(
    submission,
    /mapProgressRange\(progress, 0, 100, 23, 39\)/,
  );
  assert.doesNotMatch(
    [publishModal, submission].join("\n"),
    /setPublicationProgressPhase\([\s\S]{0,180}\b77\b/,
  );
  assert.doesNotMatch([publishModal, submission].join("\n"), /publishPulseTimerRef/);
});
