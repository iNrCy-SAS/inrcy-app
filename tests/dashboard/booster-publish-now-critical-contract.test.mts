import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function assertBefore(source: string, first: RegExp, second: RegExp, message: string) {
  const firstMatch = source.match(first);
  const secondMatch = source.match(second);
  assert.ok(firstMatch?.index !== undefined, `Missing first marker: ${first}`);
  assert.ok(secondMatch?.index !== undefined, `Missing second marker: ${second}`);
  assert.ok(firstMatch.index < secondMatch.index, message);
}

const route = read("app/api/booster/publish-now/route.ts");
const foundations = read("app/api/booster/publish-now/publishNow.foundations.ts");
const channelContext = read(
  "app/api/booster/publish-now/publishNow.channel-context.ts",
);
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const statusRoute = read(
  "app/api/booster/publications/[publicationId]/status/route.ts",
);
const recoveryCron = read("app/api/cron/booster-publications/route.ts");
const executionIdempotency = read("lib/executionIdempotency.ts");
const ingress = read("lib/boosterPublicationIngress.ts");
const imageServerPreparation = read("lib/boosterImageServerPreparation.ts");

const channelMarkers = [
  'ch === "inrcy_site"',
  'ch === "site_web"',
  'ch === "inr_search"',
  'ch === "gmb"',
  'ch === "facebook"',
  'ch === "instagram"',
  'ch === "linkedin"',
  'ch === "tiktok"',
  'ch === "youtube_shorts"',
  'ch === "pinterest"',
];

test("publish-now keeps user auth, rate limiting and cron-only async dispatch", () => {
  assert.match(route, /isAuthorizedCronRequest\(req\)/);
  assert.match(route, /getCronUserIdFromRequest\(req\)/);
  assert.match(route, /requireUser\(\)/);
  assert.match(route, /name:\s*"booster_publish"/);
  assert.match(route, /limit:\s*20/);
  assert.match(route, /internalAsyncRequested && !internalAsyncDispatch/);
  assert.match(route, /code:\s*"async_dispatch_unauthorized"/);
  assert.match(route, /selected\.length !== 1/);
  assert.match(route, /code:\s*"async_dispatch_invalid"/);
});

test("strict media cutover consumes the workspace and never silently falls back", () => {
  assert.match(route, /resolveWorkspacePublicationConsumption\(/);
  assert.match(route, /body\.mediaPipelineCutoverV1 === true/);
  assert.match(route, /isLegacyMediaTransportCutoverEnabled\(\)/);
  assert.match(route, /code:\s*"media_workspace_required"/);
  assert.match(route, /code:\s*"workspace_media_mismatch"/);
  assert.match(route, /if \(strictMediaCutover\) \{[\s\S]*return NextResponse\.json/);
  assert.match(route, /consumptionSource:\s*strictMediaCutover\s*\?\s*"workspace_cutover_v1"/);
});

test("server image preparation covers 1-11 channels with one shared call", () => {
  assert.match(route, /prepareBoosterImagesByChannelOnServer\(/);
  assert.equal(
    (route.match(/prepareBoosterImagesByChannelOnServer\(/g) || []).length,
    1,
  );
  assert.match(route, /channels:\s*imageChannels/);
  assert.match(route, /workspaceId:\s*mediaWorkspaceId/);
  assert.match(route, /imageChannels\.forEach\(\(channel\)/);
  assert.match(route, /code:\s*"workspace_image_preparation_failed"/);
  assert.match(
    route,
    /imagePreparation\.warnings\.filter\([\s\S]*warning\.channel === channel/,
  );
  assert.match(
    imageServerPreparation,
    /await Promise\.all\(channels\.map\(async \(channel\)/,
  );
  assert.match(
    imageServerPreparation,
    /inputPromise \|\|= resolveImageBuffer\(image\)/,
  );
  assert.match(
    imageServerPreparation,
    /cachedVariantsPromise \|\|= loadCachedChannelImageVariants/,
  );
  assert.match(route, /pickCompleteChannelImageUrls/);
  assert.match(channelContext, /never borrow a fallback from another channel/i);
});

test("video publication keeps the request path fast and isolates invalid channels", () => {
  assert.match(route, /prepareBoosterVideoVariantsOnServer\(/);
  assert.match(
    route,
    /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/,
  );
  assert.doesNotMatch(route, /preparePublicationVariants\(true\)/);
  assert.match(route, /Only the durable preparation worker may run FFmpeg/);
  assert.match(route, /buildVideoTransformSignature\(/);
  assert.match(route, /validateVideoPublicationForChannel\(/);
  assert.match(route, /canPublishVideoSourceDirectly\(/);
  assert.doesNotMatch(route, /requiresPreparedNetworkVideoVariant\(/);
  assert.match(route, /preflightFailuresByChannel/);
  assert.match(route, /buildBoosterPublicationDispatchPlan\(/);
  assert.match(route, /usesOriginalSource && sourceDirectlyPublishable/);
  assert.match(channelContext, /if \(usesOriginalSource\)/);
  assert.match(
    channelContext,
    /if \(!variant\?\.publicUrl \|\| !variant\?\.storagePath\) \{\s*return null;\s*\}/,
  );
});

test("scheduled duplicate protection runs before parent idempotency acquisition", () => {
  assert.match(route, /findSimilarUpcomingScheduledPublication\(/);
  assert.match(route, /IMMEDIATE_PUBLISH_DUPLICATE_LOOKAHEAD_MINUTES/);
  assert.match(route, /skipScheduledDuplicateCheck !== true/);
  assert.match(route, /allowDuplicateImmediatePublish !== true/);
  assert.match(route, /code:\s*"scheduled_publication_duplicate"/);
  assertBefore(
    route,
    /findSimilarUpcomingScheduledPublication\(/,
    /acquireExecutionIdempotencyLock\(\{/,
    "duplicate detection must happen before acquiring the parent lock",
  );
});

test("parent idempotency replays completed executions and blocks concurrent retries", () => {
  assert.match(foundations, /PUBLISH_IDEMPOTENCY_SCOPE = "booster_publish"/);
  assert.match(foundations, /PUBLISH_IDEMPOTENCY_TTL_MS = 30 \* 60 \* 1000/);
  assert.match(route, /buildCompletedExecutionResponse\(publishIdempotency\.lock\)/);
  assert.match(route, /buildRunningExecutionResponse\(publishIdempotency\.lock\)/);
  assert.match(route, /status:\s*425/);
  assert.match(route, /"Retry-After":\s*"60"/);
  assert.match(executionIdempotency, /status:\s*"running"/);
  assert.match(executionIdempotency, /status:\s*"completed"/);
  assert.match(executionIdempotency, /status:\s*"failed"/);
});

test("the browser request durably persists the parent and channel placeholders before 202", () => {
  assert.match(route, /const ingress = await enqueueBoosterPublication\(/);
  assert.match(
    route,
    /return NextResponse\.json\(ingress\.response, \{ status: 202 \}\)/,
  );
  assert.match(ingress, /const rows = \[/);
  assert.match(ingress, /type: BOOSTER_ASYNC_JOB_EVENT_TYPE/);
  assert.match(ingress, /\.\.\.params\.channels\.map\(\(channel\) => \(\{/);
  assert.match(ingress, /type: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(ingress, /supabaseAdmin\.from\("app_events"\)\.insert\(rows\)/);
  assertBefore(
    route,
    /const ingress = await enqueueBoosterPublication\(/,
    /after\(async \(\) =>/,
    "durable ingress must complete before best-effort worker dispatch",
  );
});

test("async fan-out creates one technical event per channel and strips workspace transport", () => {
  assert.match(route, /const channelEventIds = Object\.fromEntries/);
  assert.match(ingress, /BOOSTER_ASYNC_JOB_EVENT_TYPE/);
  assert.match(route, /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(route, /channels:\s*\[channel\]/);
  assert.match(route, /mediaPipelineCutoverV1:\s*false/);
  assert.match(route, /images:\s*\[\]/);
  assert.match(route, /imagesByChannel:\s*\{[\s\S]*preparedImagesByChannel\[channel\]/);
  assert.match(route, /const queuedChannelRows = durableChannelRows\.filter/);
  assert.match(route, /payload:\s*preflightFailure/);
  assert.match(route, /status:\s*"failed"/);
  assert.match(route, /status:\s*"queued"/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /\{ status:\s*202 \}/);

  const requestStart = route.indexOf("const channelDispatchRequest = {");
  const requestEnd = route.indexOf("return {", requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  const channelRequest = route.slice(requestStart, requestEnd);
  assert.doesNotMatch(channelRequest, /mediaWorkspaceId|mediaWorkspaceClientKey/);
  assert.doesNotMatch(channelRequest, /\.\.\.body/);
});

test("each async channel worker owns an independent lock and durable delivery state", () => {
  assert.match(route, /scope:\s*BOOSTER_ASYNC_CHANNEL_SCOPE/);
  assert.match(route, /const channelIdempotencyKey =/);
  assert.match(route, /idempotencyKey:\s*channelIdempotencyKey/);
  assert.match(route, /`\$\{publicationId\}:\$\{channel\}`/);
  assert.match(route, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(route, /status:\s*"processing"/);
  assert.match(route, /updateAsyncChannelEvent\(/);
  assert.match(route, /finalizeAsyncPublicationIfReady\(/);
  assert.match(recoveryCron, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(recoveryCron, /PROCESSING_RECOVERY_GRACE_MS/);
  assert.match(recoveryCron, /MAX_ASYNC_DISPATCH_ATTEMPTS/);
  assert.match(recoveryCron, /async_dispatch_exhausted/);
});

test("all ten supported channels keep an explicit server branch", () => {
  for (const marker of channelMarkers) {
    assert.ok(route.includes(marker), `missing channel branch: ${marker}`);
  }
  assert.match(route, /facebookPublishVideoToPage|facebookPublishToPage/);
  assert.match(route, /instagramPublishVideoWithTokenFallback|instagramPublishPhotoWithTokenFallback/);
  assert.match(route, /linkedinPublishVideo|linkedinPublishMultiImage|linkedinPublishText/);
  assert.match(route, /tiktokDirectPostVideoFileUpload|tiktokDirectPostPhotos/);
  assert.match(route, /uploadYoutubeShort/);
  assert.match(route, /createPinterestVideoPin|createPinterestImagePin/);
  assert.match(route, /gmbCreateLocalPost/);
});

test("channel completion updates delivery, event, lock and aggregate finalization", () => {
  assert.match(route, /const channelResult = Object\.keys\(asRecord\(results\[channel\]\)\)\.length/);
  assert.match(route, /code:\s*"missing_channel_result"/);
  assert.match(route, /status:\s*channelSucceeded \? "completed" : "failed"/);
  assert.match(route, /completeExecutionIdempotencyLock\(\{/);
  assert.match(route, /finalizeAsyncPublicationIfReady\(\{/);
  assert.match(route, /finalized:\s*finalization\.finalized === true/);
});

test("final aggregation never increments business events when every channel failed", () => {
  assert.match(route, /const summary = buildResultsSummary\(results, selected\)/);
  assert.match(route, /if \(summary\.successCount <= 0\)/);
  assert.match(route, /failureStage:\s*"publish_results"/);
  assert.match(route, /failExecutionIdempotencyLock\(\{/);
  assert.match(route, /channels:\s*summary\.successChannels/);
  assertBefore(
    route,
    /if \(summary\.successCount <= 0\)/,
    /Log publication \/ valorisation event uniquement après succès réel/,
    "the all-failed guard must precede the final business event",
  );
});

test("every async business outcome terminalizes the parent lock before the final event", () => {
  assert.match(route, /syncMediaWorkspaceLifecycle\("published"/);
  assert.match(route, /successfulChannels:\s*summary\.successChannels/);
  assert.match(route, /completeExecutionIdempotencyLock\(\{[\s\S]*result:\s*responsePayload/);
  assert.match(asyncPublication, /const status = summary\.allFailed[\s\S]*"partial"/);
  const finalizerStart = asyncPublication.indexOf(
    "async function finalizeClaimedAsyncPublication",
  );
  const finalizerEnd = asyncPublication.indexOf(
    "export async function finalizeAsyncPublicationIfReady",
    finalizerStart,
  );
  assert.ok(finalizerStart >= 0 && finalizerEnd > finalizerStart);
  const finalizer = asyncPublication.slice(finalizerStart, finalizerEnd);
  assert.match(finalizer, /completeExecutionIdempotencyLockOrThrow\(\{/);
  assert.match(finalizer, /ok:\s*!aggregate\.summary\.allFailed/);
  assert.doesNotMatch(finalizer, /failExecutionIdempotencyLock\(/);
  assertBefore(
    finalizer,
    /completeExecutionIdempotencyLockOrThrow\(\{/,
    /\.update\(\{ type: finalEventType, payload: finalPayload \}\)/,
    "the terminal lock must be durable before the parent becomes a final event",
  );
  assert.match(
    executionIdempotency,
    /completeExecutionIdempotencyLockOrThrow[\s\S]*?\.select\("id"\)[\s\S]*?if \(!data\) throw new Error\("execution_idempotency_lock_missing"\)/,
  );
  assert.match(asyncPublication, /channel events are purely technical/i);
  assert.match(asyncPublication, /\.delete\(\)[\s\S]*BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
});

test("unhandled async channel exceptions still close all durable state", () => {
  assert.match(route, /if \(asyncFailureContext\)/);
  assert.match(route, /code:\s*"async_channel_unhandled_exception"/);
  assert.match(route, /publication_deliveries"\)[\s\S]*status:\s*"failed"/);
  assert.match(route, /updateAsyncChannelEvent\(\{/);
  assert.match(route, /completeExecutionIdempotencyLock\(\{/);
  assert.match(route, /finalizeAsyncPublicationIfReady\(\{/);
});

test("status polling reads the async aggregate instead of rerunning publication", () => {
  assert.match(statusRoute, /readAsyncPublicationStatus\(/);
  assert.match(asyncPublication, /export async function readAsyncPublicationStatus/);
  assert.match(asyncPublication, /pendingCount/);
  assert.match(asyncPublication, /TERMINAL_CHANNEL_STATUSES/);
  assert.match(asyncPublication, /type !== BOOSTER_ASYNC_JOB_EVENT_TYPE/);
});
