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
    assert.ok(index > previous, `missing/out-of-order marker: ${marker}`);
    previous = index;
  }
}

const route = read("app/api/booster/publish-now/route.ts");
const cron = read("app/api/cron/booster-publications/route.ts");
const transport = read("lib/youtubeShortsPublish.ts");
const youtubeBranch = sliceBetween(
  route,
  'if (ch === "youtube_shorts")',
  'if (ch === "tiktok")',
);
const continuationHelper = sliceBetween(
  route,
  "async function queueYoutubeUploadContinuation",
  "async function getTiktokAccessToken",
);
const cronDispatch = sliceBetween(
  cron,
  "async function dispatchChannelJob",
  "export async function GET",
);

test("publish-now persists Location before streaming the first YouTube byte", () => {
  assert.match(youtubeBranch, /createYoutubeResumableUploadCheckpoint/);
  assert.match(youtubeBranch, /resumeYoutubeResumableUploadCheckpoint/);
  assert.match(youtubeBranch, /parseYoutubeResumableUploadCheckpoint/);
  assert.match(youtubeBranch, /body\._youtubeUploadCheckpoint/);
  assert.match(youtubeBranch, /youtube_upload_checkpoint_invalid/);
  assertOrdered(youtubeBranch, [
    "await createYoutubeResumableUploadCheckpoint",
    "// Persist Location before sending the first byte.",
    "await persistYoutubeUploadCheckpoint",
    "await resumeYoutubeResumableUploadCheckpoint",
  ]);
});

test("each acknowledged offset is durable before another chunk PUT", () => {
  const loop = sliceBetween(
    youtubeBranch,
    "while (",
    "const shouldContinueYoutubeUpload",
  );
  assertOrdered(loop, [
    "await persistYoutubeUploadCheckpoint",
    "uploadedChunksThisRun += 1",
    "await resumeYoutubeResumableUploadCheckpoint",
  ]);
  assert.match(youtubeBranch, /Date\.now\(\) \+ 35_000/);
  assert.match(youtubeBranch, /uploadedChunksThisRun >= 24/);
  assert.match(transport, /queryYoutubeResumableSession\(/);
  assert.match(transport, /Content-Range": `bytes \*\/\$\{params\.total\}`/);
});

test("YouTube continuations return 202 and release the current worker lock", () => {
  assertOrdered(continuationHelper, [
    "await persistYoutubeUploadCheckpoint",
    'status: "queued"',
    'await setDelivery("youtube_shorts"',
    "await failExecutionIdempotencyLock",
    "asyncFailureContext = null",
    "status: 202",
  ]);
  assert.match(continuationHelper, /youtubeUploadNextRunAt/);
  assert.match(route, /_youtubeUploadContinuationAttempt/);
  assert.match(
    route,
    /const channelTargetIdempotencyKey = asyncTargetKey[\s\S]*?`\$\{publicationId\}:\$\{asyncTargetKey\}`[\s\S]*?: `\$\{publicationId\}:\$\{channel\}`/,
  );
  assert.match(
    route,
    /`\$\{channelTargetIdempotencyKey\}:video:\$\{youtubeUploadContinuationAttempt\}`/,
  );
});

test("cron rehydrates the exact session and uses a counter outside transport attempts", () => {
  assert.match(cron, /payload\.youtubeUploadCheckpoint/);
  assert.match(cron, /_youtubeUploadCheckpoint/);
  assert.match(cron, /MAX_YOUTUBE_UPLOAD_CONTINUATION_ATTEMPTS/);
  assert.match(cronDispatch, /job\.youtubeUploadNextRunAt > Date\.now\(\)/);
  assert.match(
    cronDispatch,
    /youtubeContinuationAttempt:\s*job\.youtubeContinuationAttempt \+ 1/,
  );
  assert.match(
    cronDispatch,
    /_youtubeUploadContinuationAttempt:\s*job\.youtubeContinuationAttempt \+ 1/,
  );
  assert.match(cronDispatch, /:\s*\{ attempt: job\.attempt \+ 1 \}/);
  assert.match(cron, /youtube_upload_continuation_exhausted/);
});

test("300 MiB transport is streamed and ambiguous completion never starts over", () => {
  assert.doesNotMatch(transport, /\.arrayBuffer\(|\.blob\(|new Blob\(/);
  assert.match(transport, /sourceResponse\.body as unknown as BodyInit/);
  assert.match(transport, /requestMayHaveSucceeded: true/);
  assert.match(transport, /state: "upload_unknown"/);
  assert.match(youtubeBranch, /youtubeUploadContinuation:\s*false/);
  assert.match(youtubeBranch, /youtubeUploadNextRunAt:\s*null/);
});
