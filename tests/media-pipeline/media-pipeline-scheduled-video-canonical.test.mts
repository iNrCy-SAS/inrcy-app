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

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const submission = read("app/dashboard/booster/publier/publicationSubmission.ts");
const hook = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const client = read("lib/mediaWorkspaceClient.ts");
const prewarm = read("app/api/media-pipeline/workspace/prewarm/route.ts");
const publish = read("app/api/booster/publish-now/route.ts");
const scheduleRoute = read("app/api/agent/scheduled-actions/route.ts");
const snapshot = read("lib/scheduledPublicationMediaSnapshot.ts");

test("strict scheduled video verifies durable originals before snapshot and defers adaptations to its worker", () => {
  const readiness = sliceBetween(
    modal,
    "const waitForPersistentWorkspaceReadiness = useCallback",
    "// Les captures locales",
  );
  const verifySources = sliceBetween(
    hook,
    "const verifyReadySources = useCallback",
    "const archiveWorkspace = useCallback",
  );
  const schedule = submission.slice(submission.indexOf("const performSchedulePublication = async"));
  const sourceCheck = schedule.indexOf("await waitForPersistentWorkspaceReadiness(");
  const recordSchedule = schedule.indexOf("await postBoosterScheduledAction(");

  assert.ok(sourceCheck >= 0 && recordSchedule > sourceCheck, "sources must be secured before recording any schedule");
  assert.match(schedule, /waitForPersistentWorkspaceReadiness\(\s*"schedule"/);
  assert.match(readiness, /await waitForPersistentWorkspaceIdle\(/);
  assert.match(readiness, /await verifyPersistentWorkspaceSources\(sourceExpectations/);
  assert.match(verifySources, /await loadMediaPublicationWorkspace\(/);
  assert.match(verifySources, /media\.uploadStatus === "uploaded" &&[\s\S]*media\.storagePath/);
  assert.match(verifySources, /everyExpectedSourceIsReady[\s\S]*readyPositions\.has\(position\)/);
  assert.doesNotMatch(schedule, /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/);
  assert.match(schedule, /mediaWorkspaceId:[\s\S]*unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId/);
  assert.match(schedule, /mediaPipelineCutoverV1: mediaPipelineCutoverEnabled/);
  assert.match(schedule, /videoSettingsByChannel: buildChannelUnknownRecord\(\s*scheduleVideoSettingsByChannel/);
  assert.match(scheduleRoute, /await snapshotScheduledPublicationWorkspace\(/);
  assert.match(scheduleRoute, /applyScheduledPublicationMediaSnapshot\(/);
  assert.match(snapshot, /media_id: link\.media_id/);
  assert.match(publish, /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/);
  assert.match(publish, /candidate\.signature === signature/);
  assert.match(publish, /reason: "video_variant_required"/);
  assert.match(
    publish,
    /validateVideoPublicationForChannel\(\{\s*channel: request\.channel,[\s\S]*storagePath: variant\.storagePath/,
  );
  assert.doesNotMatch(schedule, /allowOriginalVideoFallback:\s*true/);
});

test("prewarm transports and enforces the strict cutover bit", () => {
  assert.match(hook, /mediaPipelineCutoverV1:\s*settings\?\.mediaPipelineCutoverV1/);
  assert.match(client, /mediaPipelineCutoverV1:\s*params\.mediaPipelineCutoverV1 === true/);
  assert.match(
    prewarm,
    /const strictMediaCutover =[\s\S]{0,120}body\?\.mediaPipelineCutoverV1 === true[\s\S]{0,120}isLegacyMediaTransportCutoverEnabled\(\)/,
  );
  assert.match(
    prewarm,
    /const allowOriginalVideoFallback =[\s\S]{0,80}!strictMediaCutover && body\?\.allowOriginalVideoFallback === true/,
  );
});

test("rollback outside strict cutover still supports the compatible original", () => {
  assert.match(prewarm, /function allowsOriginalVideoFallback/);
  assert.match(
    prewarm,
    /allowOriginalVideoFallback &&[\s\S]{0,100}allowsOriginalVideoFallback\(request\.channel\)[\s\S]{0,80}sourceValidation\.ok/,
  );
  assert.match(prewarm, /code:\s*"video_variant_fallback_to_original"/);
});
