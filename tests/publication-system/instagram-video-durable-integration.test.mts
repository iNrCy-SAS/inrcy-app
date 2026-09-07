import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

function assertOrdered(source: string, markers: string[]) {
  let previous = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker, previous + 1);
    assert.ok(index > previous, `marker is missing or out of order: ${marker}`);
    previous = index;
  }
}

const route = read("app/api/booster/publish-now/route.ts");
const cron = read("app/api/cron/booster-publications/route.ts");
const phases = read("lib/instagramVideoPublishPhases.ts");
const channelContext = read(
  "app/api/booster/publish-now/publishNow.channel-context.ts",
);
const instagramBranch = sliceBetween(
  route,
  'if (ch === "instagram")',
  'if (ch === "linkedin")',
);
const continuationHelper = sliceBetween(
  route,
  "async function queueInstagramVideoContinuation",
  "async function getTiktokAccessToken",
);
const dispatchJob = sliceBetween(
  cron,
  "async function dispatchChannelJob",
  "export async function GET",
);

test("Instagram video dispatch is phased and the monolithic long poll is gone", () => {
  assert.match(route, /from "@\/lib\/instagramVideoPublishPhases"/);
  assert.match(instagramBranch, /instagramCreateVideoCheckpointWithTokenFallback/);
  assert.match(instagramBranch, /instagramPollVideoCheckpointWithTokenFallback/);
  assert.match(instagramBranch, /instagramPublishVideoCheckpointWithTokenFallback/);
  assert.doesNotMatch(route, /instagramPublishVideoWithTokenFallback/);
  assert.doesNotMatch(phases, /\bsleep\s*\(|setTimeout\s*\(|maxAttempts|initialDelayMs/);
});

test("the exact provider container survives every create, poll and publish restart", () => {
  assert.match(instagramBranch, /body\._instagramVideoCheckpoint/);
  assert.match(instagramBranch, /parseInstagramVideoPublishCheckpoint\(rawCheckpoint\)/);
  assert.match(instagramBranch, /expectedRequestFingerprint/);
  assert.match(instagramBranch, /instagram_video_checkpoint_invalid/);

  const createCommit = instagramBranch.indexOf(
    "// Commit the provider container before the first status request.",
  );
  const firstCommittedPoll = instagramBranch.indexOf(
    "await instagramPollVideoCheckpointWithTokenFallback",
    createCommit,
  );
  assert.ok(createCommit >= 0);
  assert.ok(firstCommittedPoll > createCommit);
  assert.match(
    instagramBranch.slice(createCommit, firstCommittedPoll),
    /persistInstagramVideoCheckpoint\(/,
  );

  const readyCommit = instagramBranch.indexOf(
    "// Commit FINISHED before the only media_publish request.",
  );
  const committedPublish = instagramBranch.indexOf(
    "await instagramPublishVideoCheckpointWithTokenFallback",
    readyCommit,
  );
  assert.ok(readyCommit > firstCommittedPoll);
  assert.ok(committedPublish > readyCommit);
  assert.match(
    instagramBranch.slice(readyCommit, committedPublish),
    /persistInstagramVideoCheckpoint\(/,
  );
});

test("durable Instagram identity is independent from expiring signed URLs", () => {
  assert.match(route, /buildInstagramVideoSourceIdentity/);
  assertOrdered(instagramBranch, [
    "const videoSourceIdentity = buildInstagramVideoSourceIdentity",
    "const expectedRequestFingerprint",
    "videoSourceIdentity,",
    "const compatibleRequestFingerprints",
    "await instagramCreateVideoCheckpointWithTokenFallback",
    "videoSourceIdentity,",
  ]);
  assert.match(
    instagramBranch,
    /bucket:\s*instagramPublishVideo\.bucket[\s\S]*storagePath:\s*instagramPublishVideo\.storagePath/,
  );
  assert.match(
    instagramBranch,
    /expectedRequestFingerprint,[\s\S]*compatibleRequestFingerprints/,
  );
  assert.match(phases, /const INSTAGRAM_VIDEO_CHECKPOINT_VERSION = 3 as const/);
  assert.match(phases, /checkpoint\.version === 1/);
  assert.match(
    phases,
    /videoSourceIdentity[\s\S]*Preserve the exact v1 canonical request/,
  );
  assert.match(
    channelContext,
    /publicUrl:\s*variant\.publicUrl,[\s\S]*bucket:\s*"booster",[\s\S]*storagePath:/,
  );
});

test("processing phases durably queue a fast 202 continuation and release the worker", () => {
  assertOrdered(continuationHelper, [
    "await persistInstagramVideoCheckpoint",
    'status: "queued"',
    "await setDelivery",
    "await failExecutionIdempotencyLock",
    "asyncFailureContext = null",
    "status: 202",
  ]);
  assert.match(continuationHelper, /instagramVideoNextPollAt/);
  assert.match(continuationHelper, /Retry-After/);
  assert.match(continuationHelper, /done:\s*false/);
  assert.match(continuationHelper, /queued:\s*true/);

  // A new key per durable continuation prevents a failed lock-release write
  // from imposing the generic five-minute channel TTL on the next poll.
  assert.match(route, /_instagramVideoContinuationAttempt/);
  assert.match(
    route,
    /`\$\{publicationId\}:\$\{channel\}:video:\$\{instagramVideoContinuationAttempt\}`/,
  );
});

test("cron continuations keep their own bounded counter and never spend transport retries", () => {
  assert.match(cron, /instagramVideoCheckpoint/);
  assert.match(cron, /_instagramVideoCheckpoint/);
  assert.match(cron, /instagramContinuationAttempt/);
  assert.match(cron, /MAX_INSTAGRAM_VIDEO_CONTINUATION_ATTEMPTS/);
  assert.match(dispatchJob, /job\.instagramVideoNextPollAt > Date\.now\(\)/);
  assert.match(
    dispatchJob,
    /instagramContinuationAttempt:\s*job\.instagramContinuationAttempt \+ 1/,
  );
  assert.match(
    dispatchJob,
    /_instagramVideoContinuationAttempt:\s*job\.instagramContinuationAttempt \+ 1/,
  );
  assert.match(dispatchJob, /:\s*\{ attempt: job\.attempt \+ 1 \}/);
  assert.doesNotMatch(
    sliceBetween(
      dispatchJob,
      "...(job.instagramVideoContinuation",
      "lastDispatchAt:",
    ),
    /attempt:\s*job\.attempt \+ 1[\s\S]*instagramContinuationAttempt/,
  );
});

test("ambiguous publish state is committed before terminal failure", () => {
  assert.match(phases, /state:\s*"publish_unknown"/);
  assert.match(phases, /requestMayHaveSucceeded:\s*true/);
  assert.match(phases, /retryable:\s*false/);
  assertOrdered(instagramBranch, [
    "// Terminal provider states are durable too.",
    "await persistInstagramVideoCheckpoint",
    "const rawVideoError",
    'status: "failed"',
  ]);
  assert.match(
    instagramBranch,
    /instagramVideoContinuation:\s*false[\s\S]*instagramVideoNextPollAt:\s*null/,
  );
});
