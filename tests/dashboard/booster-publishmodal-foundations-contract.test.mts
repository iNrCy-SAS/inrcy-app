import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const foundations = read(
  "app/dashboard/booster/publier/publishModal.foundations.ts",
);
const videoAiRuntime = read(
  "app/dashboard/booster/publier/publishModal.videoAiRuntime.ts",
);

test("PublishModal foundations stay limited to types, constants and pure helpers", () => {
  const forbiddenRuntimePatterns = [
    /\buseState\b/,
    /\buseEffect\b/,
    /\buseMemo\b/,
    /\buseCallback\b/,
    /\buseRef\b/,
    /\bfetch\s*\(/,
    /\bcreateClient\b/,
    /\bwindow\./,
    /\bdocument\./,
    /URL\.createObjectURL/,
    /\bFormData\b/,
    /\bAbortController\b/,
    /usePersistentMediaWorkspace/,
    /usePublishImageController/,
    /usePublishVideoController/,
    /loadMediaPublicationWorkspace/,
    /prepareMediaPublicationWorkspace/,
    /\/api\/booster\/publish-now/,
    /\/api\/agent\/scheduled-actions/,
  ];

  for (const pattern of forbiddenRuntimePatterns) {
    assert.doesNotMatch(foundations, pattern);
  }
});

test("the extracted module keeps the expected stable foundations", () => {
  for (const symbol of [
    "CHANNEL_KEYS",
    "EMPTY_CHANNEL_DETAILS",
    "sanitizePostForEditor",
    "sanitizePostsForEditor",
    "simplifyChannelDetail",
    "buildVideoFileName",
    "buildVideoRatioLabel",
    "buildVideoOrientation",
    "makeVideoTranscriptCacheKey",
  ]) {
    assert.match(foundations, new RegExp(`export (?:const|function|type) ${symbol}`));
  }
});

test("media, browser and transcription operations stay in the dedicated client runtime", () => {
  assert.match(videoAiRuntime, /export function preloadPreparedImagePreview/);
  assert.match(videoAiRuntime, /export function readVideoSourceMetadata/);
  assert.match(videoAiRuntime, /export async function transcribeVideoAudioForAI/);
  assert.match(videoAiRuntime, /fetch\("\/api\/booster\/transcribe"/);
  assert.doesNotMatch(videoAiRuntime, /\buseState\b|\buseEffect\b|\bcreateClient\b/);
  assert.match(publishModal, /from "\.\/publishModal\.videoAiRuntime"/);
  assert.doesNotMatch([publishModal, submission].join("\n"), /function preloadPreparedImagePreview/);
  assert.doesNotMatch([publishModal, submission].join("\n"), /function readVideoSourceMetadata/);
  assert.doesNotMatch([publishModal, submission].join("\n"), /async function transcribeVideoAudioForAI/);
  assert.doesNotMatch(videoAiRuntime, /from "\.\/PublishModal"/);
  assert.match(publishModal, /usePersistentMediaWorkspace\(/);
  assert.match(publishModal, /usePublishImageController\(/);
  assert.match(publishModal, /usePublishVideoController\(/);
  assert.match(publishModal, /from "\.\/publishModal\.foundations"/);
});
