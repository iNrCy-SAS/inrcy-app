import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  buildScheduledPublicationRequest,
  interpretScheduledPublicationResponse,
} from "../../lib/inrAgentScheduledPublication.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

const scheduleRoute = read("app/api/agent/scheduled-actions/route.ts");
const executeNowRoute = read(
  "app/api/agent/scheduled-actions/[id]/execute/route.ts",
);
const cronRoute = read("app/api/cron/inr-agent-scheduled-actions/route.ts");
const historyRoute = read("app/api/inrsend/history/route.ts");
const agentScheduleRoute = read("app/api/agent/actions/schedule/route.ts");
const agentExecuteRoute = read("app/api/agent/actions/execute/route.ts");

test("a mixed schedule keeps five image channels and five video channels intact", () => {
  const imageChannels = [
    "inrcy_site",
    "site_web",
    "inr_search",
    "gmb",
    "instagram",
  ];
  const videoChannels = [
    "facebook",
    "linkedin",
    "tiktok",
    "youtube_shorts",
    "pinterest",
  ];
  const channels = [...imageChannels, ...videoChannels];
  const mediaModeByChannel = Object.fromEntries([
    ...imageChannels.map((channel) => [channel, "images"]),
    ...videoChannels.map((channel) => [channel, "video"]),
  ]);
  const postByChannel = Object.fromEntries(
    channels.map((channel, index) => [
      channel,
      {
        title: `Titre ${channel}`,
        content: `Texte spécifique ${index}`,
        cta: `CTA ${index}`,
        hashtags: [`canal${index}`],
      },
    ]),
  );
  const imageSettingsByChannel = Object.fromEntries(
    imageChannels.map((channel, index) => [channel, { format: "square", index }]),
  );
  const videoSettingsByChannel = Object.fromEntries(
    videoChannels.map((channel, index) => [channel, { format: "vertical", index }]),
  );
  const videoFormatByChannel = Object.fromEntries(
    videoChannels.map((channel) => [channel, "9:16"]),
  );
  const imagesByChannel = Object.fromEntries(
    imageChannels.map((channel, index) => [
      channel,
      [{ storagePath: `scheduled/${channel}-${index}.jpg` }],
    ]),
  );
  const publishPayload = {
    mediaWorkspaceId: "workspace-mixed-10",
    mediaModeByChannel,
    postByChannel,
    imageSettingsByChannel,
    videoSettingsByChannel,
    videoFormatByChannel,
    videoAdaptationModeByChannel: Object.fromEntries(
      videoChannels.map((channel) => [channel, "fit"]),
    ),
    imagesByChannel,
    video: { storagePath: "scheduled/source-video.mp4" },
    channels,
    source: "booster_scheduled",
  };

  const request = buildScheduledPublicationRequest({
    id: "schedule-mixed-10",
    automation_key: "publish",
    channels,
    payload: {
      kind: "manual_publish_schedule",
      publishPayload,
    },
  });

  assert.ok(request);
  assert.equal(request.idempotencyKey, "scheduled_publication:schedule-mixed-10");
  assert.equal(request.body.mediaWorkspaceId, "workspace-mixed-10");
  assert.deepEqual(request.body.channels, channels);
  assert.deepEqual(request.body.selectedChannels, channels);
  assert.deepEqual(request.body.mediaModeByChannel, mediaModeByChannel);
  assert.deepEqual(request.body.postByChannel, postByChannel);
  assert.deepEqual(request.body.imageSettingsByChannel, imageSettingsByChannel);
  assert.deepEqual(request.body.videoSettingsByChannel, videoSettingsByChannel);
  assert.deepEqual(request.body.videoFormatByChannel, videoFormatByChannel);
  assert.deepEqual(request.body.imagesByChannel, imagesByChannel);
});

test("a durable 202 is processing, persists its publication id and is not retried", () => {
  const result = interpretScheduledPublicationResponse({
    httpStatus: 202,
    httpOk: true,
    idempotencyKey: "scheduled_publication:schedule-202",
    responsePayload: {
      ok: true,
      done: false,
      queued: true,
      asyncDispatch: true,
      status: "preparing",
      publication_id: "publication-202",
      summary: { pendingCount: 3 },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "processing");
  assert.equal(result.publicationId, "publication-202");
  assert.equal(result.entrusted, true);
  assert.equal(result.historyPersisted, true);
  assert.equal(result.retriable, undefined);
});

test("running idempotency resumes safely and accepts a known durable parent", () => {
  const knownParent = interpretScheduledPublicationResponse({
    httpStatus: 425,
    httpOk: false,
    idempotencyKey: "scheduled_publication:schedule-running",
    responsePayload: {
      ok: false,
      idempotencyPending: true,
      code: "execution_already_running",
      queued: true,
      asyncDispatch: true,
      publication_id: "publication-running",
    },
  });
  assert.equal(knownParent.ok, true);
  assert.equal(knownParent.status, "processing");
  assert.equal(knownParent.publicationId, "publication-running");

  const unknownParent = interpretScheduledPublicationResponse({
    httpStatus: 425,
    httpOk: false,
    idempotencyKey: "scheduled_publication:schedule-running",
    retryAfter: "60",
    responsePayload: {
      ok: false,
      idempotencyPending: true,
      code: "execution_already_running",
    },
  });
  assert.equal(unknownParent.ok, false);
  assert.equal(unknownParent.retriable, true);
  assert.equal(unknownParent.preserveAttemptCount, true);
  assert.equal(unknownParent.retryAfterSeconds, 60);
});

test("cron and execute-now share the durable request and own their claims", () => {
  assert.match(scheduleRoute, /const scheduledPayload = \{/);
  assert.match(scheduleRoute, /\.\.\.\(scheduleRequestId \? \{ scheduleRequestId \} : \{\}\)/);
  assert.match(scheduleRoute, /payload:\s*scheduledPayload/);
  assert.match(cronRoute, /buildScheduledPublicationRequest\(row\)/);
  assert.match(cronRoute, /interpretScheduledPublicationResponse\(\{/);
  assert.match(cronRoute, /status: result\.status/);
  assert.match(cronRoute, /entrusted: result\.entrusted === true/);
  assert.match(cronRoute, /\.eq\("status", "running"\)/);
  assert.match(cronRoute, /\.eq\("updated_at", row\.updated_at\)/);

  assert.match(executeNowRoute, /buildScheduledPublicationRequest\(row\)/);
  assert.match(executeNowRoute, /publishNowBooster\(/);
  assert.match(executeNowRoute, /interpretScheduledPublicationResponse\(\{/);
  assert.match(executeNowRoute, /scheduled_action_already_running/);
  assert.match(executeNowRoute, /dispatch\.status === "processing" \? 202 : 200/);
});

test("iNrSend shows the durable parent while processing and the terminal aggregate", () => {
  assert.match(historyRoute, /String\(e\.type \|\| ""\) === "publish_async_job"/);
  assert.match(historyRoute, /isAsyncPublication[\s\S]{0,1200}: "processing"/);
  assert.match(historyRoute, /publicationHistoryIdentity/);
  assert.match(historyRoute, /executionStatus === "processing" \|\| execution\.entrusted === true/);
  assert.match(historyRoute, /\.in\("type", \[[\s\S]{0,120}"publish_async_job"/);
  assert.doesNotMatch(historyRoute, /MAX_ITERATIONS = 5000|fetchAllRows/);
});

test("iNrAgent refuses a silent partial publication when a selected channel lacks media", () => {
  assert.match(agentScheduleRoute, /const blockedChannels = selectedChannels\.filter/);
  assert.match(agentScheduleRoute, /Programmation complète impossible : média requis/);
  assert.match(agentExecuteRoute, /const blockedChannels = selectedChannels\.filter/);
  assert.match(agentExecuteRoute, /INR_AGENT_PUBLICATION_MEDIA_REQUIRED/);
  assert.match(agentExecuteRoute, /status: 409/);
});
