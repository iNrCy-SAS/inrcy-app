import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

function count(source: string, needle: string) {
  return source.split(needle).length - 1;
}

function assertOrdered(source: string, markers: string[]) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker, previous + 1);
    assert.ok(index > previous, `missing/out-of-order marker: ${marker}`);
    previous = index;
  }
}

const route = read("app/api/booster/publish-now/route.ts");
const cron = read("app/api/cron/booster-publications/route.ts");
const pinterestPublish = read("lib/pinterestPublish.ts");
const inrsendActions = read("lib/inrsend/publicationChannelActions.ts");
const pinterestBranch = sliceBetween(
  route,
  'if (ch === "pinterest")',
  'if (ch === "gmb")',
);
const durableVideoBranch = sliceBetween(
  pinterestBranch,
  "const pinterestVideoStoragePath",
  'if (mediaModeByChannel[ch] !== "images")',
);
const continuationHelper = sliceBetween(
  route,
  "async function queuePinterestVideoContinuation",
  "async function getTiktokAccessToken",
);
const cronDispatch = sliceBetween(
  cron,
  "async function dispatchChannelJob",
  "export async function GET",
);

test("async Pinterest video dispatch uses the durable protocol with stable identities", () => {
  assert.match(route, /from "@\/lib\/pinterestVideoProtocol"/);
  assert.match(durableVideoBranch, /advancePinterestVideoProtocol\(/);
  assert.match(
    durableVideoBranch,
    /const pinterestOperationId = `\$\{publicationId\}:\$\{asyncChannelEventId\}`/,
  );
  assert.match(
    durableVideoBranch,
    /operationId:\s*pinterestOperationId/,
  );
  assert.match(
    durableVideoBranch,
    /persistCheckpoint:\s*persistPinterestVideoCheckpoint/,
  );

  const fingerprint = sliceBetween(
    durableVideoBranch,
    "const pinterestSourceFingerprint",
    "const pinterestOperationId",
  );
  assertOrdered(fingerprint, [
    "pinterestVideoStoragePath",
    "pinterestVideoSize",
    "pinterestVariantIdentity",
  ]);
  assert.doesNotMatch(
    fingerprint,
    /pinterestVideoUrl|publicUrl|signedUrl|thumbnailUrl/,
  );
});

test("the video file is materialized only when the protocol requests it", () => {
  assert.equal(count(durableVideoBranch, "withPinterestVideoProtocolAsset("), 1);
  const needsFileBlock = sliceBetween(
    durableVideoBranch,
    'if (pinterestStep.state === "needs_video_file")',
    'if (\n                pinterestStep.state === "continue"',
  );
  assert.match(needsFileBlock, /withPinterestVideoProtocolAsset\(/);
  assert.match(needsFileBlock, /videoFile:\s*asset\.videoFile/);
  assert.match(needsFileBlock, /checkpoint:\s*pinterestStep\.checkpoint/);

  const beforeNeedsFile = durableVideoBranch.slice(
    0,
    durableVideoBranch.indexOf(
      'if (pinterestStep.state === "needs_video_file")',
    ),
  );
  assert.doesNotMatch(beforeNeedsFile, /withPinterestVideoProtocolAsset\(/);
  assert.doesNotMatch(beforeNeedsFile, /videoFile:\s*asset\.videoFile/);
});

test("Pinterest waiting is polled inside the short request budget before durable fallback", () => {
  assert.match(durableVideoBranch, /const pinterestPhaseDeadline = Date\.now\(\) \+ 35_000/);
  assert.match(durableVideoBranch, /pinterestStep\.state === "waiting"/);
  assert.match(durableVideoBranch, /waitMs \+ 1_000 >= remainingMs/);
  assert.match(durableVideoBranch, /respectNextPollAt:\s*false/);
  assert.match(durableVideoBranch, /setTimeout\(resolve, waitMs\)/);
  assert.match(
    durableVideoBranch,
    /pinterestStep\.state === "continue"\s*\|\|\s*pinterestStep\.state === "waiting"/,
  );
  assert.match(
    durableVideoBranch,
    /return await queuePinterestVideoContinuation\(/,
  );
  assertOrdered(continuationHelper, [
    "await persistPinterestVideoCheckpoint",
    'status: "queued"',
    'await setDelivery("pinterest"',
    "await failExecutionIdempotencyLock",
    "asyncFailureContext = null",
    "status: 202",
  ]);
  assert.match(continuationHelper, /pinterestVideoNextPollAt/);
  assert.match(continuationHelper, /Retry-After/);
  assert.match(continuationHelper, /done:\s*false/);
  assert.match(continuationHelper, /queued:\s*true/);
});

test("completed is delivered while all provider terminal failures are non-retryable", () => {
  const completed = sliceBetween(
    durableVideoBranch,
    'pinterestStep.state === "completed"',
    'pinterestStep.state === "failed"',
  );
  assert.match(completed, /pinterestVideoContinuation:\s*false/);
  assert.match(completed, /pinterestVideoNextPollAt:\s*null/);
  assert.match(completed, /status:\s*"delivered"/);
  assert.match(completed, /ok:\s*true/);

  const terminalFailure = sliceBetween(
    durableVideoBranch,
    'pinterestStep.state === "failed"',
    "const pinterestUserError =\n              \"Pinterest n'a pas pu reprendre",
  );
  assert.match(terminalFailure, /pinterestStep\.state === "expired"/);
  assert.match(terminalFailure, /pinterestStep\.state === "outcome_unknown"/);
  assert.match(terminalFailure, /pinterestVideoContinuation:\s*false/);
  assert.match(terminalFailure, /pinterestVideoNextPollAt:\s*null/);
  assert.match(terminalFailure, /status:\s*"failed"/);
  assert.match(terminalFailure, /retryable:\s*false/);
  assert.match(terminalFailure, /requestMayHaveSucceeded:\s*true/);
  assert.doesNotMatch(terminalFailure, /queuePinterestVideoContinuation/);
});

test("cron rehydrates checkpoint timing and isolates Pinterest continuation attempts", () => {
  assert.match(cron, /payload\.pinterestVideoCheckpoint/);
  assert.match(cron, /_pinterestVideoCheckpoint:\s*rawPinterestVideoCheckpoint/);
  assert.match(
    cron,
    /timestampMs\(\s*payload\.pinterestVideoNextPollAt,\s*persistedPinterestVideoCheckpoint\.nextPollAt/,
  );
  assert.match(cron, /MAX_PINTEREST_VIDEO_CONTINUATION_ATTEMPTS/);
  assert.match(
    cronDispatch,
    /job\.pinterestVideoNextPollAt > Date\.now\(\)/,
  );
  assert.match(
    cronDispatch,
    /pinterestContinuationAttempt:\s*job\.pinterestContinuationAttempt \+ 1/,
  );
  assert.match(
    cronDispatch,
    /_pinterestVideoContinuationAttempt:\s*job\.pinterestContinuationAttempt \+ 1/,
  );
  assert.match(cronDispatch, /:\s*\{ attempt: job\.attempt \+ 1 \}/);
  assert.match(cron, /pinterest_video_continuation_exhausted/);
});

test("cron never redispatches a terminal Pinterest video checkpoint", () => {
  const terminalDefinition = sliceBetween(
    cron,
    "const PINTEREST_VIDEO_TERMINAL_PHASES",
    "function timestampMs",
  );
  for (const phase of ["completed", "failed", "expired", "outcome_unknown"]) {
    assert.match(terminalDefinition, new RegExp(`"${phase}"`));
  }
  assert.match(
    cron,
    /PINTEREST_VIDEO_TERMINAL_PHASES\.has\([\s\S]*persistedPinterestVideoCheckpoint\.phase/,
  );
  assert.ok(
    count(cron, "!job.pinterestVideoTerminal") >= 2,
    "queued and recovered jobs must both exclude terminal Pinterest checkpoints",
  );
});

test("cover resolution signs the durable object in its real bucket", () => {
  const resolver = sliceBetween(
    pinterestPublish,
    "export async function resolvePinterestVideoCoverImageUrl",
    "export async function withPinterestVideoProtocolAsset",
  );
  assertOrdered(resolver, [
    "const coverStoragePath",
    "const coverBucket",
    "createSafeStorageSignedUrl(",
    "normalizePublicUrl(params.coverImageUrl)",
  ]);
  assert.match(
    resolver,
    /createSafeStorageSignedUrl\(\s*coverBucket,\s*coverStoragePath,\s*PINTEREST_COVER_SIGNED_URL_TTL_SECONDS/,
  );
  assert.doesNotMatch(resolver, /getBoosterPublicUrl/);
  assert.match(
    durableVideoBranch,
    /await resolvePinterestVideoCoverImageUrl\(\{[\s\S]*coverImageUrl:\s*channelVideo\.thumbnailUrl,[\s\S]*coverStoragePath:\s*channelVideo\.thumbnailStoragePath,[\s\S]*coverBucket:\s*channelVideo\.thumbnailBucket/,
  );
});

test("Booster sync and iNrSend preserve the thumbnail bucket for Pinterest", () => {
  assert.match(
    pinterestBranch,
    /createPinterestVideoPin\(\{[\s\S]*coverStoragePath:\s*channelVideo\.thumbnailStoragePath,[\s\S]*coverBucket:\s*channelVideo\.thumbnailBucket/,
  );
  assert.match(
    inrsendActions,
    /thumbnailBucket\?:\s*string\s*\|\s*null/,
  );
  assert.match(
    inrsendActions,
    /thumbnailBucket:\s*[\s\S]*src\.thumbnailBucket[\s\S]*src\.thumbnail_bucket[\s\S]*src\.video_thumbnail_bucket/,
  );
  assert.match(
    inrsendActions,
    /createPinterestVideoPin\(\{[\s\S]*coverStoragePath:\s*video\.thumbnailStoragePath,[\s\S]*coverBucket:\s*video\.thumbnailBucket/,
  );
});
