import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const persistentWorkspace = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const imageController = read(
  "app/dashboard/booster/publier/usePublishImageController.ts",
);
const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
const modalLayer = read(
  "app/dashboard/_components/DashboardBoosterModalLayer.tsx",
);
const publishClient = read("lib/boosterPublishClient.ts");
const scheduleClient = read("lib/boosterScheduleClient.ts");
const publishRoute = read("app/api/booster/publish-now/route.ts");
const generationRoute = read("app/api/booster/generate/route.ts");
const statusRoute = read(
  "app/api/booster/publications/[publicationId]/status/route.ts",
);
const videoFormatManager = read(
  "app/dashboard/booster/publier/components/BoosterVideoFormatManager.tsx",
);

test("PublishModal keeps the three dedicated media controllers", () => {
  assert.match(publishModal, /usePersistentMediaWorkspace\(/);
  assert.match(publishModal, /usePublishImageController\(/);
  assert.match(publishModal, /usePublishVideoController\(/);
  assert.match(publishModal, /isUnifiedMediaConsumptionClientEnabled\(\)/);
  assert.match(publishModal, /isLegacyMediaTransportCutoverClientEnabled\(\)/);
});

test("generation waits only for selected AI media while publication and scheduling always wait", () => {
  assert.match(publishModal, /const shouldPrepareMediaForAi =/);
  assert.match(
    publishModal,
    /shouldPrepareMediaForAi[\s\S]*waitForPersistentWorkspaceReadiness\([\s\S]*"generate"/,
  );
  assert.match(
    publishModal,
    /waitForPersistentWorkspaceReadiness\(\s*"publish"/,
  );
  assert.match(
    publishModal,
    /waitForPersistentWorkspaceReadiness\(\s*"schedule"/,
  );
  assert.match(publishModal, /loadMediaPublicationWorkspace\(/);
  assert.match(persistentWorkspace, /prepareMediaPublicationWorkspace\(/);
});

test("strict cutover sends workspace references instead of browser media binaries", () => {
  assert.match(publishModal, /mediaWorkspaceId:/);
  assert.match(publishModal, /mediaWorkspaceClientKey:/);
  assert.match(publishModal, /mediaPipelineCutoverV1:/);
  assert.match(
    publishModal,
    /imagesForAI:\s*mediaPipelineCutoverEnabled\s*\?\s*\[\]\s*:\s*imagesForAI/,
  );
  assert.match(publishModal, /imageCount:\s*mediaPipelineCutoverEnabled\s*\?\s*0/);
  assert.ok(
    (publishModal.match(/images:\s*\[\]/g) || []).length >= 3,
    "publish, schedule and preview payloads must keep the base binary image array empty",
  );
  assert.match(generationRoute, /strictMediaCutover/);
  assert.match(generationRoute, /mediaWorkspaceExpected/);
  assert.match(publishRoute, /strictMediaCutover/);
});

test("legacy uploads stay disabled unless a mixed publication needs the media type absent from the workspace", () => {
  assert.match(
    publishModal,
    /shouldBuildImageFallbackPayload\s*=\s*hasAnyImagePublish\s*&&\s*!workspaceCarriesImagesForPublish/,
  );
  assert.match(
    publishModal,
    /shouldBuildVideoFallbackPayload\s*=\s*hasAnyVideoPublish\s*&&\s*!workspaceCarriesVideoForPublish/,
  );
  assert.match(publishModal, /if \(shouldBuildImageFallbackPayload\)/);
  assert.match(publishModal, /if \(shouldBuildVideoFallbackPayload\)/);
  assert.match(publishModal, /uploadPublicationVideoForPublish\(\)/);
  assert.match(publishModal, /uploadOriginalImagesForPublication\(/);
});

test("cutover records the format choice and requires the workspace master for scheduling", () => {
  assert.doesNotMatch(publishModal, /directOriginalAvailable/);
  assert.match(persistentWorkspace, /preparePublicationMedia/);
  assert.doesNotMatch(publishModal, /prepareCutoverVideoVariants/);
  assert.match(publishModal, /generateMissingVideoVariants:\s*false/);
  assert.match(
    publishModal,
    /mediaPipelineCutoverV1:\s*true,[\s\S]{0,100}allowOriginalVideoFallback:\s*false/,
  );
  assert.match(
    publishModal,
    /deferTechnicalPreparationUntilPublish=\{[\s\S]*mediaPipelineCutoverEnabled/,
  );
  assert.match(
    publishModal,
    /onApplyVideoFormatForChannel=\{[\s\S]*mediaPipelineCutoverEnabled[\s\S]*\? undefined/,
  );
  assert.match(
    publishModal,
    /onApplyVideoFormatToAllChannels=\{[\s\S]*mediaPipelineCutoverEnabled[\s\S]*\? undefined/,
  );
  assert.match(
    publishModal,
    /const hasVideoPreparationBlocker =[\s\S]*!mediaPipelineCutoverEnabled/,
  );
  assert.match(
    videoFormatManager,
    /const appliedFormat = deferTechnicalPreparationUntilPublish[\s\S]*\? currentFormat/,
  );
  assert.match(
    videoFormatManager,
    /!deferTechnicalPreparationUntilPublish && preparationState/,
  );
  assert.match(
    videoFormatManager,
    /!deferTechnicalPreparationUntilPublish && onApplyFormat/,
  );
  assert.match(
    videoFormatManager,
    /!deferTechnicalPreparationUntilPublish &&[\s\S]{0,100}\(onApplyFormat \|\|/,
  );
});

test("workspace uploads are serialized, abortable and bounded", () => {
  assert.match(persistentWorkspace, /operationVersionRef/);
  assert.match(
    persistentWorkspace,
    /operationAbortRef\.current\[mediaType\]\?\.abort\(\)/,
  );
  assert.match(persistentWorkspace, /beginWorkspaceFamilyMutation/);
  assert.match(persistentWorkspace, /beginWorkspaceGlobalClear/);
  assert.match(persistentWorkspace, /replaceWorkspaceMediaFamilyStates/);
  assert.match(persistentWorkspace, /await previousTask\.catch/);
  assert.match(
    persistentWorkspace,
    /mediaType === "video"\s*\?\s*1\s*:\s*3/,
  );
  assert.match(persistentWorkspace, /activeUploadFailureRef/);
});

test("image and video source limits stay centralized", () => {
  assert.match(imageController, /BOOSTER_MAX_IMAGE_COUNT/);
  assert.match(imageController, /BOOSTER_MAX_IMAGE_BYTES/);
  assert.match(imageController, /BOOSTER_MAX_MEDIA_BYTES/);
  assert.match(shared, /INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT/);
  assert.match(shared, /INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/);
  assert.match(publishModal, /BOOSTER_MAX_VIDEO_BYTES/);
});

test("final review excludes invalid channels without blocking the ready subset", () => {
  assert.match(publishModal, /buildFinalReviewItems\(/);
  assert.match(publishModal, /getChannelPublicationRequirements\(/);
  assert.match(publishModal, /const preflightFailedChannels = reviewItems/);
  assert.match(
    publishModal,
    /const publishableChannels = reviewItems[\s\S]*item\.blockers\.length === 0/,
  );
  assert.match(publishModal, /preflightFailedChannels,/);
  assert.match(modalLayer, /mergePreflightFailuresIntoPublicationSummary/);
  assert.match(publishModal, /i18nT\("instagram_necessite_une_video_ou_au_dc42bf8d"\)/);
  assert.match(publishModal, /i18nT\("choisissez_un_tableau_pinterest_avant_de_60a6ce70"\)/);
  assert.match(publishModal, /i18nT\("pinterest_necessite_une_image_ou_une_e2a7f196"\)/);
});

test("manual publication remains idempotent, asynchronous and partially retryable", () => {
  assert.match(modalLayer, /postBoosterPublication\(/);
  assert.match(publishClient, /idempotencyKey/);
  assert.match(publishClient, /execution_already_running/);
  assert.match(publishRoute, /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(publishRoute, /\{ status: 202 \}/);
  assert.match(statusRoute, /publicationId/);
  assert.match(publishModal, /const retryFailedChannels = resultEntries/);
  assert.match(publishModal, /entry\?\.retryable !== false/);
  assert.match(
    publishModal,
    /if \(publicationComplete\) \{[\s\S]*archivePersistentMediaWorkspace/,
  );
  assert.match(
    publishModal,
    /options\?\.closeOnSuccess !== false && publicationAccepted/,
  );
});

test("scheduling preserves the workspace and separates immediate channels", () => {
  assert.match(publishModal, /postBoosterScheduledAction\(/);
  assert.match(scheduleClient, /\/api\/agent\/scheduled-actions/);
  assert.match(scheduleClient, /scheduleRequestId/);
  assert.match(publishModal, /timezone:\s*"Europe\/Paris"/);
  assert.match(publishModal, /scheduleGroups/);
  assert.match(publishModal, /immediateChannelsToPublish/);
  assert.match(publishModal, /publishImmediateChannelsAfterSchedule/);
  assert.match(publishModal, /source:\s*"booster_scheduled"/);
  assert.match(publishModal, /mediaWorkspaceId:/);
});

test("drafts reuse and restore the persistent workspace", () => {
  assert.match(publishModal, /adoptMediaWorkspace\(/);
  assert.match(publishModal, /linkPersistentWorkspaceDraft\(/);
  assert.match(publishModal, /loadMediaPublicationWorkspace\(/);
  assert.match(
    publishModal,
    /images\.length && !\(mediaPipelineCutoverEnabled && mediaWorkspaceId\)/,
  );
  assert.match(
    publishModal,
    /mediaPipelineCutoverEnabled && mediaWorkspaceId\s*\?\s*null/,
  );
});

test("network uncertainty never encourages an unsafe blind retry", () => {
  assert.match(
    publishModal,
    /L’envoi peut encore être en cours : vérifiez iNr’Send avant de relancer/,
  );
  assert.match(
    publishClient,
    /vérifiez iNr’Send avant de relancer/,
  );
});
