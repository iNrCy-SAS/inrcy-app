import { withUiCopy } from "../helpers/localized-ui-source.mjs";
import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import { readFileSync as readDraftSessionSource } from "node:fs";
const draftSession = readDraftSessionSource(new URL("../../app/dashboard/booster/publier/publicationDraftSession.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const generation = read("app/dashboard/booster/publier/useBoosterGeneration.ts");
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
const videoPanel = read(
  "app/dashboard/booster/publier/components/PublishVideoAdapterPanel.tsx",
);
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);
const tiktokSettingsModal = read(
  "app/dashboard/booster/publier/components/TiktokPublicationSettingsModal.tsx",
);

test("PublishModal keeps the three dedicated media controllers", () => {
  assert.match(withUiCopy(publishModal), /usePersistentMediaWorkspace\(/);
  assert.match(withUiCopy(publishModal), /usePublishImageController\(/);
  assert.match(withUiCopy(publishModal), /usePublishVideoController\(/);
  assert.match(withUiCopy(publishModal), /isUnifiedMediaConsumptionClientEnabled\(\)/);
  assert.match(withUiCopy(publishModal), /isLegacyMediaTransportCutoverClientEnabled\(\)/);
});

test("generation secures only selected AI sources while publication and scheduling secure their required sources", () => {
  assert.match(withUiCopy(generation), /const shouldPrepareMediaForAi =/);
  assert.match(
    withUiCopy(generation),
    /shouldPrepareMediaForAi[\s\S]*waitForPersistentWorkspaceReadiness\([\s\S]*"generate"/,
  );
  assert.match(
    withUiCopy(submission),
    /waitForPersistentWorkspaceReadiness\(\s*"publish"/,
  );
  assert.match(
    withUiCopy(submission),
    /waitForPersistentWorkspaceReadiness\(\s*"schedule"/,
  );
  assert.match(withUiCopy(draftSession), /loadMediaPublicationWorkspace\(/);
  assert.match(withUiCopy(persistentWorkspace), /prepareMediaPublicationWorkspace\(/);
});

test("strict cutover sends workspace references instead of browser media binaries", () => {
  assert.match(withUiCopy(submission), /mediaWorkspaceId:/);
  assert.match(withUiCopy(submission), /mediaWorkspaceClientKey:/);
  assert.match(withUiCopy(submission), /mediaPipelineCutoverV1:\s*mediaPipelineCutoverEnabled/);
  assert.match(
    withUiCopy(generation),
    /imagesForAI:\s*mediaPipelineCutoverEnabled\s*\?\s*\[\]\s*:\s*imagesForAI/,
  );
  assert.match(withUiCopy(generation), /imageCount:\s*mediaPipelineCutoverEnabled\s*\?\s*0/);
  assert.ok(
    ([publishModal, submission].join("\n").match(/images:\s*\[\]/g) || []).length >= 3,
    "publish, schedule and preview payloads must keep the base binary image array empty",
  );
  assert.match(withUiCopy(generationRoute), /strictMediaCutover/);
  assert.match(withUiCopy(generationRoute), /mediaWorkspaceExpected/);
  assert.match(withUiCopy(publishRoute), /strictMediaCutover/);
});

test("legacy uploads stay disabled unless a mixed publication needs the media type absent from the workspace", () => {
  assert.match(
    withUiCopy(submission),
    /shouldBuildImageFallbackPayload\s*=\s*hasAnyImagePublish\s*&&\s*!workspaceCarriesImagesForPublish/,
  );
  assert.match(
    withUiCopy(submission),
    /shouldBuildVideoFallbackPayload\s*=\s*hasAnyVideoPublish\s*&&\s*!workspaceCarriesVideoForPublish/,
  );
  assert.match(withUiCopy(submission), /if \(shouldBuildImageFallbackPayload\)/);
  assert.match(withUiCopy(submission), /if \(shouldBuildVideoFallbackPayload\)/);
  assert.match(withUiCopy(submission), /uploadPublicationVideoForPublish\(\)/);
  assert.match(withUiCopy(submission), /uploadOriginalImagesForPublication\(/);
});

test("cutover delegates video retouching to iNrStudio and keeps server preparation strict", () => {
  assert.doesNotMatch(withUiCopy([publishModal, submission].join("\n")), /directOriginalAvailable/);
  assert.match(withUiCopy(persistentWorkspace), /preparePublicationMedia/);
  assert.doesNotMatch(withUiCopy([publishModal, submission].join("\n")), /prepareCutoverVideoVariants/);
  assert.doesNotMatch(withUiCopy(submission), /ensureCutoverVideoVariantsReady/);
  assert.match(withUiCopy(publishRoute), /if \(strictMediaCutover && hasAnyVideoChannel && publicationVideo\)/);
  assert.match(withUiCopy(publishRoute), /requireCodecProof:\s*true/);
  assert.match(withUiCopy(publishRoute), /prepareBoosterVideoVariantsOnServer\(/);
  assert.match(withUiCopy(publishRoute), /transformedVariants: strictMediaCutover/);
  assert.match(withUiCopy(publishModal), /const openInrStudioVideoRetoucher = async/);
  assert.match(
    withUiCopy(publishModal),
    /tab: "retouch",[\s\S]{0,220}origin: "booster-publish"/,
  );
  assert.match(withUiCopy(publishModal), /mediaType: "video"/);
  assert.match(
    withUiCopy(publishModal),
    /deferVideoPreparation: mediaPipelineCutoverEnabled/,
  );
  assert.match(withUiCopy(publishModal), /onRetouchVideo=\{\(\) => void openInrStudioVideoRetoucher\(activeImageChannel\)\}/);
  assert.match(withUiCopy(videoPanel), /onRetouchVideo\(activeChannel\)/);
  assert.doesNotMatch(withUiCopy(videoPanel), /BoosterVideoFormatManager/);
  assert.match(
    withUiCopy(publishModal),
    /const hasVideoPreparationBlocker =[\s\S]*!mediaPipelineCutoverEnabled/,
  );
  assert.match(
    withUiCopy(videoFormatManager),
    /const appliedFormat = deferTechnicalPreparationUntilPublish[\s\S]*\? currentFormat/,
  );
  assert.match(
    withUiCopy(videoFormatManager),
    /!deferTechnicalPreparationUntilPublish && preparationState/,
  );
  assert.match(
    withUiCopy(videoFormatManager),
    /!deferTechnicalPreparationUntilPublish && onApplyFormat/,
  );
  assert.match(
    withUiCopy(videoFormatManager),
    /!deferTechnicalPreparationUntilPublish &&[\s\S]{0,100}\(onApplyFormat \|\|/,
  );
});

test("Booster consumes the video settings and variants returned by iNrStudio", () => {
  assert.match(withUiCopy(publishModal), /returnedRecord\.studio_video_retouch === true/);
  assert.match(withUiCopy(publishModal), /returnedRecord\.video_format/);
  assert.match(withUiCopy(publishModal), /returnedRecord\.video_adaptation_mode/);
  assert.match(withUiCopy(publishModal), /returnedRecord\.transformed_variants/);
  assert.match(withUiCopy(publishModal), /setVideoFormatByChannel/);
  assert.match(withUiCopy(publishModal), /setVideoAdaptationModeByChannel/);
  assert.match(withUiCopy(publishModal), /setVideoTransformedVariants\(mergedVariants\)/);
  assert.match(withUiCopy(publishModal), /setVideoStorageContext/);
  assert.match(withUiCopy(intentPanel), /onRetouchVideo/);
  assert.match(withUiCopy(intentPanel), /ai_generator_studio_tab_retouch/);
  assert.match(withUiCopy(publishModal), /onRetouchVideo=\{\(\) =>[\s\S]{0,100}openInrStudioVideoRetoucher\("tiktok"\)/);
  assert.match(withUiCopy(tiktokSettingsModal), /onRetouchVideo\?: \(\) => void/);
  assert.match(withUiCopy(tiktokSettingsModal), /mediaType === "video" && onRetouchVideo/);
});

test("workspace uploads are serialized, abortable and bounded", () => {
  assert.match(withUiCopy(persistentWorkspace), /operationVersionRef/);
  assert.match(
    withUiCopy(persistentWorkspace),
    /operationAbortRef\.current\[mediaType\]\?\.abort\(\)/,
  );
  assert.match(withUiCopy(persistentWorkspace), /beginWorkspaceFamilyMutation/);
  assert.match(withUiCopy(persistentWorkspace), /beginWorkspaceGlobalClear/);
  assert.match(withUiCopy(persistentWorkspace), /replaceWorkspaceMediaFamilyStates/);
  assert.match(withUiCopy(persistentWorkspace), /await previousTask\.catch/);
  assert.match(
    withUiCopy(persistentWorkspace),
    /mediaType === "video"\s*\?\s*1\s*:\s*3/,
  );
  assert.match(withUiCopy(persistentWorkspace), /activeUploadFailureRef/);
});

test("image and video source limits stay centralized", () => {
  assert.match(withUiCopy(imageController), /BOOSTER_MAX_IMAGE_COUNT/);
  assert.match(withUiCopy(imageController), /BOOSTER_MAX_IMAGE_BYTES/);
  assert.match(withUiCopy(imageController), /BOOSTER_MAX_MEDIA_BYTES/);
  assert.match(withUiCopy(shared), /INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT/);
  assert.match(withUiCopy(shared), /INR_MEDIA_VIDEO_SOURCE_MAX_BYTES/);
  assert.match(withUiCopy(publishModal), /BOOSTER_MAX_VIDEO_BYTES/);
});

test("final review excludes invalid channels without blocking the ready subset", () => {
  assert.match(withUiCopy(publishModal), /buildFinalReviewItems\(/);
  assert.match(withUiCopy(publishModal), /getChannelPublicationRequirements\(/);
  assert.match(withUiCopy(submission), /const preflightFailedChannels = reviewItems/);
  assert.match(
    withUiCopy(submission),
    /const publishableChannels = reviewItems[\s\S]*item\.blockers\.length === 0/,
  );
  assert.match(withUiCopy(submission), /preflightFailedChannels,/);
  assert.match(withUiCopy(modalLayer), /mergePreflightFailuresIntoPublicationSummary/);
  assert.match(withUiCopy(submission), /i18nT\("instagram_necessite_une_video_ou_au_dc42bf8d"\)/);
  assert.match(withUiCopy(submission), /i18nT\("choisissez_un_tableau_pinterest_avant_de_60a6ce70"\)/);
  assert.match(withUiCopy(submission), /i18nT\("pinterest_necessite_une_image_ou_une_e2a7f196"\)/);
});

test("manual publication remains idempotent, asynchronous and partially retryable", () => {
  assert.match(withUiCopy(modalLayer), /postBoosterPublication\(/);
  assert.match(withUiCopy(publishClient), /idempotencyKey/);
  assert.match(withUiCopy(publishClient), /execution_already_running/);
  assert.match(withUiCopy(publishRoute), /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(withUiCopy(publishRoute), /\{ status: 202 \}/);
  assert.match(withUiCopy(statusRoute), /publicationId/);
  assert.match(withUiCopy(submission), /const retryFailedChannels = resultEntries/);
  assert.match(withUiCopy(submission), /isRetryablePublicationEntry\(entry\)/);
  assert.match(withUiCopy(submission), /storySequenceResumeByChannel: options\?\.retryPreviousSummary\s*\? buildStorySequenceResumeByChannel\(options\.retryPreviousSummary, publishTargetChannels\)\s*: undefined/);
  assert.match(
    withUiCopy(submission),
    /if \(publicationComplete\) \{[\s\S]*archivePersistentMediaWorkspace/,
  );
  assert.match(
    withUiCopy(submission),
    /options\?\.closeOnSuccess !== false && publicationAccepted/,
  );
});

test("scheduling preserves the workspace and separates immediate channels", () => {
  assert.match(withUiCopy(submission), /postBoosterScheduledAction\(/);
  assert.match(withUiCopy(scheduleClient), /\/api\/agent\/scheduled-actions/);
  assert.match(withUiCopy(scheduleClient), /scheduleRequestId/);
  assert.match(withUiCopy(submission), /timezone:\s*"Europe\/Paris"/);
  assert.match(withUiCopy(submission), /scheduleGroups/);
  assert.match(withUiCopy(submission), /immediateChannelsToPublish/);
  assert.match(withUiCopy(publishModal), /publishImmediateChannelsAfterSchedule/);
  assert.match(withUiCopy(submission), /source:\s*"booster_scheduled"/);
  assert.match(withUiCopy(submission), /mediaWorkspaceId:/);
});

test("drafts reuse and restore the persistent workspace", () => {
  assert.match(withUiCopy(draftSession), /adoptMediaWorkspace\(/);
  assert.match(withUiCopy(draftSession), /linkPersistentWorkspaceDraft\(/);
  assert.match(withUiCopy(draftSession), /loadMediaPublicationWorkspace\(/);
  assert.match(
    withUiCopy(draftSession),
    /images\.length && !\(mediaPipelineCutoverEnabled && mediaWorkspaceId\)/,
  );
  assert.match(
    withUiCopy(draftSession),
    /mediaPipelineCutoverEnabled && mediaWorkspaceId\s*\?\s*null/,
  );
});

test("network uncertainty never encourages an unsafe blind retry", () => {
  assert.match(
    withUiCopy(submission),
    /L’envoi peut encore être en cours : vérifiez iNr’Send avant de relancer/,
  );
  assert.match(
    withUiCopy(publishClient),
    /vérifiez iNr’Send avant de relancer/,
  );
});
