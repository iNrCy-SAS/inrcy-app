import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function indexOfOrFail(source: string, marker: string) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Missing marker: ${marker}`);
  return index;
}

const route = read("app/api/booster/publish-now/route.ts");
const ingress = read("lib/boosterPublicationIngress.ts");
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const cron = read("app/api/cron/booster-publications/route.ts");
const imageServerPreparation = read("lib/boosterImageServerPreparation.ts");

test("the external request commits its durable job before all heavy media work", () => {
  const enqueue = indexOfOrFail(
    route,
    "const ingress = await enqueueBoosterPublication",
  );
  const workspaceRead = indexOfOrFail(
    route,
    "let workspaceConsumption: WorkspacePublicationConsumption",
  );
  const imagePreparation = indexOfOrFail(
    route,
    "imagePreparation = await prepareBoosterImagesByChannelOnServer",
  );
  const videoPreparation = indexOfOrFail(
    route,
    "const variantResult = await preparePublicationVariants",
  );
  const scheduledDuplicateRead = indexOfOrFail(
    route,
    "const duplicate = await findSimilarUpcomingScheduledPublication",
  );

  assert.ok(enqueue < workspaceRead);
  assert.ok(enqueue < imagePreparation);
  assert.ok(enqueue < videoPreparation);
  assert.ok(enqueue < scheduledDuplicateRead);
  assert.match(route, /return NextResponse\.json\(ingress\.response, \{ status: 202 \}\)/);
});

test("ingress atomically inserts one parent and one preparing placeholder per channel", () => {
  assert.match(ingress, /publicationId: candidatePublicationId/);
  assert.match(ingress, /const rows = \[/);
  assert.match(ingress, /type: BOOSTER_ASYNC_JOB_EVENT_TYPE/);
  assert.match(ingress, /\.\.\.params\.channels\.map/);
  assert.match(ingress, /type: BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(ingress, /status: "preparing"/);
  assert.match(ingress, /\.from\("app_events"\)\.insert\(rows\)/);
  assert.match(ingress, /lockResult\.state === "running"/);
  assert.match(ingress, /loadParent\(params\.userId, publicationId\)/);
});

test("preparation owns a recoverable lease and only it may generate missing video variants", () => {
  assert.match(route, /acquireAsyncPublicationPreparationLease/);
  assert.match(route, /internalAsyncPreparationDispatch/);
  assert.match(
    route,
    /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/,
  );
  assert.match(asyncPublication, /BOOSTER_ASYNC_PREPARATION_SCOPE/);
  assert.match(asyncPublication, /BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS/);
  assert.match(route, /mediaPipelineCutoverV1: false/);
});

test("media preparation failures stay isolated per channel", () => {
  assert.match(
    route,
    /prepareBoosterImagesByChannelOnServer\([\s\S]*channels: imageChannels/,
  );
  assert.match(
    imageServerPreparation,
    /Promise\.all\(channels\.map\(async \(channel\)/,
  );
  assert.match(
    imageServerPreparation,
    /catch \(error\) \{[\s\S]*warnings\.push\(\{[\s\S]*channel,/,
  );
  assert.match(
    imageServerPreparation,
    /if \(prepared\.length === channelSources\.length\) \{[\s\S]*imagesByChannel\[channel\]/,
  );
  assert.match(route, /setPreflightFailure\(channel/);
  assert.match(route, /invalidVideoChannels\.forEach/);
  assert.match(route, /const channelPreflightPlan = buildBoosterPublicationDispatchPlan/);
});

test("channel jobs contain only one channel payload and never clone the parent body", () => {
  const start = indexOfOrFail(route, "const channelDispatchRequest = {");
  const end = indexOfOrFail(route.slice(start), "skipScheduledDuplicateCheck: true") + start;
  const childRequest = route.slice(start, end);

  assert.doesNotMatch(childRequest, /\.\.\.body/);
  assert.match(childRequest, /channels: \[channel\]/);
  assert.match(childRequest, /postByChannel: \{ \[channel\]: channelPost \}/);
  assert.match(childRequest, /mediaType: channelMediaType/);
  assert.match(childRequest, /imagesByChannel: \{/);
  assert.match(
    childRequest,
    /video: channelMediaMode === "video" \? channelDispatchVideo : null/,
  );
  assert.match(childRequest, /channelMediaMode === "images"/);
  assert.match(childRequest, /channel === "tiktok"/);
  assert.match(childRequest, /channel === "pinterest"/);
  assert.match(route, /preparationRequest: null/);
});

test("recovered preparation never requeues a channel that already advanced", () => {
  assert.match(asyncPublication, /materializePreparingAsyncChannelEvent/);
  assert.match(asyncPublication, /\.eq\("payload->>status", "preparing"\)/);
  assert.match(
    asyncPublication,
    /must never put an already queued\/processing or[\s\S]*terminal channel back in the queue/,
  );
  assert.match(route, /const durableChannelRows = await Promise\.all/);
});

test("the cron independently recovers parent preparation and channel dispatch", () => {
  assert.match(cron, /BOOSTER_ASYNC_JOB_EVENT_TYPE/);
  assert.match(cron, /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(cron, /BOOSTER_ASYNC_PREPARATION_LOCK_TTL_MS/);
  assert.match(cron, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(cron, /dispatchPreparationJob/);
  assert.match(cron, /dispatchChannelJob/);
  assert.match(cron, /Math\.max\(2, job\.attempt\)/);
  assert.match(cron, /buildBoosterPreparationDispatchReference\(\{/);
  assert.match(cron, /attempt: nextPreparationAttempt/);
  assert.match(cron, /failPreparingAsyncPublicationChannels/);
});
