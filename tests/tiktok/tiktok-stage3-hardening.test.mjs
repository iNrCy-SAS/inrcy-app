import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publishLib = readFileSync(new URL("../../lib/tiktokPublish.ts", import.meta.url), "utf8");
const publishNow = readFileSync(new URL("../../app/api/booster/publish-now/route.ts", import.meta.url), "utf8");
const retryRoute = readFileSync(new URL("../../app/api/inrsend/publications/[publicationId]/tiktok/retry/route.ts", import.meta.url), "utf8");
const statusRoute = readFileSync(new URL("../../app/api/inrsend/publications/[publicationId]/tiktok/status/route.ts", import.meta.url), "utf8");
const detailsModal = readFileSync(new URL("../../app/dashboard/mails/_components/MailboxDetailsModal.tsx", import.meta.url), "utf8");
const channelActions = readFileSync(new URL("../../lib/inrsend/publicationChannelActions.ts", import.meta.url), "utf8");
const mailboxPhase1 = readFileSync(new URL("../../app/dashboard/mails/_lib/mailboxPhase1.tsx", import.meta.url), "utf8");

test("TikTok video publication is FILE_UPLOAD only", () => {
  assert.match(publishNow, /tiktokDirectPostVideoFileUpload/);
  assert.doesNotMatch(publishNow, /\btiktokDirectPostVideo\s*\(/);
  assert.match(publishNow, /tiktok_video_file_upload_required/);
  assert.match(retryRoute, /tiktokDirectPostVideoFileUpload/);
  assert.doesNotMatch(retryRoute, /\btiktokDirectPostVideo\s*\(/);
  assert.match(retryRoute, /tiktok_video_file_upload_required/);
});

test("legacy URL video entry point is a defensive refusal", () => {
  const videoFunction = publishLib.slice(
    publishLib.indexOf("export async function tiktokDirectPostVideo"),
    publishLib.indexOf("export async function tiktokDirectPostVideoFileUpload"),
  );
  assert.match(videoFunction, /FILE_UPLOAD_ONLY/);
  assert.doesNotMatch(videoFunction, /source:\s*"PULL_FROM_URL"/);
});

test("photo publication keeps its supported URL transfer", () => {
  const photoFunction = publishLib.slice(publishLib.indexOf("export async function tiktokDirectPostPhotos"));
  assert.match(photoFunction, /source:\s*"PULL_FROM_URL"/);
  assert.match(photoFunction, /photo_images/);
});

test("status fetch errors are no longer disguised as processing", () => {
  assert.match(publishLib, /status:\s*"STATUS_FETCH_ERROR"/);
  assert.match(publishLib, /statusFetchFailed:\s*true/);
  assert.doesNotMatch(publishLib, /status:\s*"STATUS_FETCH_PENDING"/);
  assert.match(statusRoute, /tiktok_status_fetch_error/);
  assert.match(statusRoute, /tiktok_fail_reason/);
});

test("TikTok status progress and stalled state are persisted", () => {
  assert.match(publishLib, /uploadedBytes/);
  assert.match(publishLib, /publiclyAvailablePostIds/);
  assert.match(statusRoute, /tiktok_status_progress_at/);
  assert.match(statusRoute, /tiktok_stalled/);
  assert.match(statusRoute, /15 \* 60 \* 1000/);
});

test("TikTok status polling resolves the durable async child before terminal history exists", () => {
  const loader = statusRoute.slice(
    statusRoute.indexOf("async function loadTiktokEventContext"),
    statusRoute.indexOf("async function persistTerminalParentTiktokResult"),
  );
  assert.match(loader, /\.eq\("id", publicationId\)/);
  assert.match(loader, /BOOSTER_ASYNC_JOB_EVENT_TYPE/);
  assert.match(loader, /parentPayload\.channelEventIds/);
  assert.match(loader, /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(loader, /result:\s*asRecord\(channelPayload\.result\)/);
  assert.doesNotMatch(loader, /\.limit\(200\)/);

  assert.match(statusRoute, /updateAsyncChannelEvent\(/);
  assert.match(statusRoute, /finalizeAsyncPublicationIfReady\(/);
  assert.match(statusRoute, /buildAsyncPublicationAggregate\(results, selectedChannels\)/);
  assert.match(statusRoute, /if \(!updatedChannelPayload\)[\s\S]{0,500}persistTerminalParentTiktokResult/);
});

test("iNrSend automatically polls pending TikTok publications", () => {
  assert.match(detailsModal, /getTiktokAutoPollTarget/);
  assert.match(detailsModal, /tiktokAutoPollInFlightRef/);
  assert.match(detailsModal, /20_000/);
  assert.match(detailsModal, /60_000/);
  assert.match(detailsModal, /i18nT\("motif_technique_tiktok_4641189f"\)/);
});

test("iNrSend can cancel a pending TikTok publication locally", () => {
  assert.match(detailsModal, /cancelPendingTiktokPublication/);
  assert.match(detailsModal, /body:\s*JSON\.stringify\(\{ action: "cancel_pending" \}\)/);
  assert.match(detailsModal, /i18nT\("annuler_la_publication_e7d30046"\)/);
  assert.match(channelActions, /isPendingTiktokResult/);
  assert.match(channelActions, /buildCancelledPayload/);
  assert.match(channelActions, /remote_cancellation_supported:\s*false/);
  assert.match(channelActions, /status:\s*"deleted"/);
});

test("cancelled TikTok publications are terminal for status and retry flows", () => {
  assert.match(statusRoute, /isTiktokCancelledResult/);
  assert.match(statusRoute, /status:\s*"CANCELLED"/);
  assert.match(retryRoute, /tiktok_publication_cancelled/);
  assert.match(detailsModal, /"CANCELLED", "CANCELED"/);
  assert.match(mailboxPhase1, /isCancelledChannelResult/);
  assert.match(mailboxPhase1, /channelCancelledDot/);
});
