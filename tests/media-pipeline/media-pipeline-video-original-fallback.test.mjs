import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("strict scheduling snapshots verified originals and the durable worker prepares variants before publishing", async () => {
  const [modal, prewarm, publishRoute, channelContext, workspaceHook, scheduleRoute, snapshot] = await Promise.all([
    read("app/dashboard/booster/publier/PublishModal.tsx"),
    read("app/api/media-pipeline/workspace/prewarm/route.ts"),
    read("app/api/booster/publish-now/route.ts"),
    read("app/api/booster/publish-now/publishNow.channel-context.ts"),
    read("app/dashboard/booster/publier/usePersistentMediaWorkspace.ts"),
    read("app/api/agent/scheduled-actions/route.ts"),
    read("lib/scheduledPublicationMediaSnapshot.ts"),
  ]);
  const publish = `${publishRoute}\n${channelContext}`;

  assert.doesNotMatch([modal, submission].join("\n"), /startBackgroundVideoPrewarm/);
  assert.doesNotMatch([modal, submission].join("\n"), /directOriginalAvailable/);
  const schedule = submission.slice(
    submission.indexOf("const performSchedulePublication = async"),
    submission.indexOf("function publishImmediateChannelsAfterSchedule"),
  );
  assert.match(
    modal,
    /await verifyPersistentWorkspaceSources\(sourceExpectations,\s*\{\s*signal: readinessSignal/,
  );
  assert.match(schedule, /await waitForPersistentWorkspaceReadiness\(\s*"schedule"[\s\S]{0,400}requiredScheduleMediaTypes/);
  assert.doesNotMatch(schedule, /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/);
  const verifiedSources = schedule.indexOf("await waitForPersistentWorkspaceReadiness(");
  const submissionIndex = schedule.indexOf("await postBoosterScheduledAction(");
  assert.ok(verifiedSources >= 0 && submissionIndex > verifiedSources, "durable source verification precedes recording the schedule");
  assert.match(schedule, /mediaPipelineCutoverV1:\s*mediaPipelineCutoverEnabled/);
  assert.match(schedule, /videoSettingsByChannel:[\s\S]{0,150}scheduleVideoSettingsByChannel/);
  assert.match(scheduleRoute, /await snapshotScheduledPublicationWorkspace\([\s\S]*applyScheduledPublicationMediaSnapshot\(/);
  assert.match(snapshot, /media_id:\s*link\.media_id/);
  assert.match(snapshot, /media_settings:\s*asRecord\(link\.media_settings\)/);
  assert.match(snapshot, /channel_settings:\s*asRecord\(link\.channel_settings\)/);
  assert.doesNotMatch([modal, submission].join("\n"), /prepareCutoverVideoVariants/);
  const immediatePublish = submission.slice(
    submission.indexOf("const runPublish = async"),
    submission.indexOf("const performSchedulePublication = async"),
  );
  assert.doesNotMatch(
    immediatePublish,
    /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/,
  );
  assert.match(
    immediatePublish,
    /if \(shouldBuildVideoFallbackPayload\)[\s\S]*preparePublicationVideoVariants\(/,
  );
  assert.match(
    prewarm,
    /allowsOriginalVideoFallback\(request\.channel\)[\s\S]{0,120}sourceValidation\.ok/,
  );
  assert.match(
    prewarm,
    /const allowOriginalVideoFallback =[\s\S]{0,80}!strictMediaCutover && body\?\.allowOriginalVideoFallback === true/,
  );
  assert.match(prewarm, /const ready = invalidChannels\.length === 0/);
  assert.doesNotMatch(publishRoute, /requiresPreparedNetworkVideoVariant/);
  assert.match(
    publishRoute,
    /usesOriginalSource && sourceDirectlyPublishable[\s\S]*return \[\]/,
  );
  assert.match(publishRoute, /reason:\s*"video_variant_required"/);
  assert.match(publishRoute, /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/);
  assert.match(publish, /const usesOriginalSource = settings\.format === "original"/);
  assert.match(
    publish,
    /if \(usesOriginalSource\) \{\s*return sourceValidation\.ok \? publicationVideo : null;\s*\}/,
  );
  assert.match(
    publish,
    /if \(!variant\?\.publicUrl \|\| !variant\?\.storagePath\) \{\s*return null;\s*\}/,
  );
  assert.doesNotMatch(publish, /preparePublicationVariants\(true\)/);
  assert.doesNotMatch(publish, /if \(!variantResult\.ok \|\| invalidVideoChannels\.length > 0\)/);
  assert.doesNotMatch(workspaceHook, /background video prewarm skipped/);
});
