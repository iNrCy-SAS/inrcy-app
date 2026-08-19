import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getBoosterCreationWorkflow,
  getBoosterPublicationWorkflowSteps,
  shouldPrepareBoosterMediaForAi,
} from "../../lib/boosterCreationMode.ts";
import { decidePublicationMedia } from "../../lib/boosterPublicationMediaDecision.ts";
import { buildBoosterPublicationDispatchPlan } from "../../lib/boosterPublicationDispatchPlan.ts";
import { buildPinterestImageMediaSource } from "../../lib/pinterestImagePinPayload.ts";
import { validateVideoDurationForChannel } from "../../lib/videoPublicationPolicy.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const workspaceHook = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const generationRoute = read("app/api/booster/generate/route.ts");
const preparationRoute = read(
  "app/api/media-pipeline/workspace/prepare/route.ts",
);
const missions = read("lib/boosterMediaPipelineMissions.ts");
const imageController = read(
  "app/dashboard/booster/publier/usePublishImageController.ts",
);
const publishRoute = read("app/api/booster/publish-now/route.ts");
const publishClient = read("lib/boosterPublishClient.ts");
const agentExecuteRoute = read("app/api/agent/actions/execute/route.ts");
const scheduledExecuteRoute = read(
  "app/api/agent/scheduled-actions/[id]/execute/route.ts",
);
const scheduledActionsRoute = read("app/api/agent/scheduled-actions/route.ts");
const tiktokStatusRoute = read(
  "app/api/inrsend/publications/[publicationId]/tiktok/status/route.ts",
);
const tiktokRetryRoute = read(
  "app/api/inrsend/publications/[publicationId]/tiktok/retry/route.ts",
);
const mailboxDetails = read(
  "app/dashboard/mails/_components/MailboxDetailsModal.tsx",
);
const inrsendChannelActions = read("lib/inrsend/publicationChannelActions.ts");

test("01 - parcours IA sans média", () => {
  const workflow = getBoosterCreationWorkflow("ai");
  assert.equal(workflow.generationEnabled, true);
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "ai",
      mediaType: "images",
      hasImages: false,
      hasVideo: false,
      useImagesForAI: false,
    }),
    false,
  );
  assert.match(
    modal,
    /mediaWorkspaceExpected:[\s\S]*shouldUsePersistentMediaWorkspaceForAi[\s\S]*Boolean\(readyMediaWorkspaceId\)/,
  );
  assert.match(
    modal,
    /let readyMediaWorkspaceId = shouldUsePersistentMediaWorkspaceForAi[\s\S]*?waitForPersistentWorkspaceReadiness/,
  );
});

test("02 - parcours IA avec images", () => {
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "ai",
      mediaType: "images",
      hasImages: true,
      hasVideo: false,
      useImagesForAI: true,
    }),
    true,
  );
  assert.match(missions, /ai_preparation:\s*\["ai_preview"\]/);
  assert.match(workspaceHook, /runPreparationMission\("ai_preparation"\)/);
  assert.match(generationRoute, /if \(mediaWorkspaceId && useWorkspaceMediaForAI\)/);
});

test("03 - parcours IA avec vidéo", () => {
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "ai",
      mediaType: "video",
      hasImages: false,
      hasVideo: true,
      useImagesForAI: false,
    }),
    true,
  );
  assert.match(
    missions,
    /ai_preparation:\s*\[[\s\S]*?"frame_01"[\s\S]*?"audio_track"[\s\S]*?\]/,
  );
  assert.match(
    missions,
    /publication_preparation:\s*\["canonical", "thumbnail"\]/,
  );
  const videoMissions = missions.slice(
    missions.indexOf("BOOSTER_VIDEO_PREPARATION_KEYS"),
  );
  assert.match(
    videoMissions,
    /publication_preparation:\s*\[[^\]]*"canonical"/,
  );
  assert.match(preparationRoute, /mission === "ai_preparation"/);
  assert.match(preparationRoute, /mission === "publication_preparation"/);
});

test("04 - média ajouté après génération uniquement pour publier", () => {
  const videoStart = modal.indexOf("const addVideoFile = async");
  const videoEnd = modal.indexOf("const onVideoChange", videoStart);
  assert.ok(videoStart >= 0 && videoEnd > videoStart);
  const videoSource = modal.slice(videoStart, videoEnd);
  assert.doesNotMatch(videoSource, /setPostsByChannel\(/);
  assert.doesNotMatch(videoSource, /setContentWorkspaceOpen\(false\)/);

  const imageStart = imageController.indexOf("const addImageFiles = async");
  const imageEnd = imageController.indexOf("const onImagesChange", imageStart);
  assert.ok(imageStart >= 0 && imageEnd > imageStart);
  const imageSource = imageController.slice(imageStart, imageEnd);
  assert.doesNotMatch(imageSource, /setPostsByChannel\(/);
  assert.doesNotMatch(imageSource, /setContentWorkspaceOpen/);
});

test("05 - parcours manuel avec images sans IA", () => {
  const workflow = getBoosterCreationWorkflow("manual");
  assert.equal(workflow.generationEnabled, false);
  assert.equal(workflow.aiPreparationEnabled, false);
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "manual",
      mediaType: "images",
      hasImages: true,
      hasVideo: false,
      useImagesForAI: true,
    }),
    false,
  );
  assert.match(generationRoute, /body\.creationMode === "manual"/);
  assert.match(generationRoute, /manual_generation_forbidden/);
});

test("06 - parcours manuel avec vidéo sans IA", () => {
  assert.equal(
    shouldPrepareBoosterMediaForAi({
      mode: "manual",
      mediaType: "video",
      hasImages: false,
      hasVideo: true,
      useImagesForAI: false,
    }),
    false,
  );
  assert.match(workspaceHook, /creationModeRef\.current !== "ai"/);
  assert.match(
    workspaceHook,
    /La préparation IA est disponible uniquement dans le mode Créer avec iNrCy/,
  );
});

test("07 - changement IA vers Manuel conserve canaux et médias", () => {
  const start = modal.indexOf("const onSelectCreationMode");
  const end = modal.indexOf("const onGenerate", start);
  assert.ok(start >= 0 && end > start);
  const source = modal.slice(start, end);
  assert.match(source, /Vos canaux et vos médias seront conservés/);
  assert.match(source, /clearAiCreationWork\(\)/);
  assert.doesNotMatch(source, /clearImagesMedia\(\)/);
  assert.doesNotMatch(source, /clearVideoMedia\(/);
});

test("08 - changement Manuel vers IA et numérotation dynamique", () => {
  assert.deepEqual(getBoosterPublicationWorkflowSteps("ai"), {
    intention: 3,
    content: 4,
    media: 5,
    preview: 6,
  });
  assert.deepEqual(getBoosterPublicationWorkflowSteps("manual"), {
    intention: null,
    content: 3,
    media: 4,
    preview: 5,
  });
  assert.match(modal, /clearChannelCreationWork\(\)/);
});

test("09 - Pinterest accepte un carrousel de cinq images", () => {
  const urls = Array.from(
    { length: 5 },
    (_, index) => `https://cdn.inrcy.test/image-${index + 1}.jpg`,
  );
  const source = buildPinterestImageMediaSource(urls);
  assert.equal(source.source_type, "multiple_image_urls");
  if (source.source_type === "multiple_image_urls") {
    assert.equal(source.items.length, 5);
  }
  assert.throws(
    () => buildPinterestImageMediaSource([...urls, "https://cdn.inrcy.test/6.jpg"]),
    /au maximum 5 images/,
  );
  assert.match(publishRoute, /limit:\s*5/);
});

test("10 - une vidéo trop longue bloque uniquement son canal", () => {
  const pinterest = validateVideoDurationForChannel({
    channel: "pinterest",
    durationSeconds: 901,
  });
  assert.equal(pinterest.ok, false);
  const facebook = validateVideoDurationForChannel({
    channel: "facebook",
    durationSeconds: 901,
  });
  assert.equal(facebook.ok, true);

  const plan = buildBoosterPublicationDispatchPlan(
    ["facebook", "pinterest", "site_web"],
    {
      pinterest: {
        ok: false,
        code: "video_duration_too_long",
        error: "Pinterest bloqué.",
        retryable: false,
      },
    },
  );
  assert.deepEqual(plan.dispatchableChannels, ["facebook", "site_web"]);
  assert.deepEqual(plan.failedChannels, ["pinterest"]);
});

test("11 - un média original compatible est publié sans variante", () => {
  assert.deepEqual(decidePublicationMedia({ sourceCompatible: true }), {
    action: "use_original",
    reason: "source_compatible",
  });
  assert.doesNotMatch(publishRoute, /requiresPreparedNetworkVideoVariant/);
  assert.match(
    publishRoute,
    /const sourceDirectlyPublishable =[\s\S]*hasTrustedPublicationVideoCompatibilityProof[\s\S]*canPublishVideoSourceDirectly\([\s\S]*requireCodecProof: true/,
  );
  assert.match(
    publishRoute,
    /if \(usesOriginalSource && sourceDirectlyPublishable\) \{\s*return \[\];\s*\}/,
  );
});

test("12 - une incompatibilité réelle demande une conversion minimale", () => {
  assert.deepEqual(decidePublicationMedia({ sourceCompatible: false }), {
    action: "prepare_minimal",
    reason: "source_incompatible",
  });
  assert.equal(
    decidePublicationMedia({
      sourceCompatible: false,
      preparationPossible: false,
    }).action,
    "block_channel",
  );
  assert.match(publishRoute, /video_conversion_failed|video_conversion_or_probe_failed/);
});

test("13 - publication immédiate utilise le moteur final commun", () => {
  assert.equal((modal.match(/<PublishFooterActions/g) || []).length, 1);
  assert.match(modal, /trackEvent\("publish"/);
  assert.match(publishClient, /fetchWithBrowserDeadline\(\{/);
  assert.match(publishClient, /input:\s*"\/api\/booster\/publish-now"/);
  assert.match(publishRoute, /invalidVideoChannels\.forEach/);
  assert.match(publishRoute, /setPreflightFailure\(invalid\.channel/);
});

test("14 - publication programmée repasse par le même moteur final", () => {
  assert.match(agentExecuteRoute, /POST as publishNowBooster/);
  assert.match(agentExecuteRoute, /await publishNowBooster\(/);
  assert.match(scheduledExecuteRoute, /executeAgentAction/);
  assert.match(scheduledExecuteRoute, /kind === "manual_publish_schedule"/);
  assert.match(scheduledActionsRoute, /syncPublicationWorkspaceContext/);
});

test("15 - suivi, nouvelle tentative et annulation TikTok restent disponibles", () => {
  assert.match(mailboxDetails, /tiktok\/status/);
  assert.match(mailboxDetails, /tiktok\/retry/);
  assert.match(mailboxDetails, /cancelPendingTiktokPublication/);
  assert.match(mailboxDetails, /i18nT\("annuler_la_publication_e7d30046"\)/);
  assert.match(tiktokStatusRoute, /CANCELLED/);
  assert.match(tiktokRetryRoute, /retry/i);
});

test("16 - iNrAgent et iNrSend conservent le workspace et les variantes", () => {
  assert.match(agentExecuteRoute, /POST as publishNowBooster/);
  assert.match(scheduledActionsRoute, /mediaWorkspaceId/);
  assert.match(scheduledActionsRoute, /syncPublicationWorkspaceContext/);
  assert.match(inrsendChannelActions, /transformedVariants/);
  assert.match(
    mailboxDetails,
    /iNrSend conserve la vidéo originale comme source de travail/,
  );
  assert.match(
    mailboxDetails,
    /activeVideoDisplayAttachment = activeSourceVideoAttachment \|\| activeVideoAttachment/,
  );
});
