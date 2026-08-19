import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canContinueWithIsolatedVideoPreparationFailures,
  isVideoPreparationReady,
  shouldRetryVideoVariantGeneration,
} from "../../lib/boosterVideoPreparationRecovery.ts";

const ROOT = new URL("../../", import.meta.url);

async function read(relativePath: string) {
  return await readFile(new URL(relativePath, ROOT), "utf8");
}

test("missing or incompatible variants are recoverable", () => {
  assert.equal(shouldRetryVideoVariantGeneration([]), true);
  assert.equal(
    shouldRetryVideoVariantGeneration([{ reason: "variant_missing" }]),
    true,
  );
  assert.equal(
    shouldRetryVideoVariantGeneration([{ reason: "video_format_invalid" }]),
    true,
  );
  assert.equal(
    shouldRetryVideoVariantGeneration([{ reason: "video_duration_unknown" }]),
    true,
  );
});

test("hard duration constraints are not transcoded pointlessly", () => {
  assert.equal(
    shouldRetryVideoVariantGeneration([
      { reason: "video_duration_too_long" },
      { reason: "video_duration_too_short" },
      { reason: "video_duration_long_upload_not_allowed" },
    ]),
    false,
  );
  assert.equal(
    shouldRetryVideoVariantGeneration([
      { reason: "video_duration_too_long" },
      { reason: "variant_missing" },
    ]),
    true,
  );
});

test("a partial preparation can continue only when failures are isolated by channel", () => {
  assert.equal(
    isVideoPreparationReady({
      ok: true,
      status: "ready",
      invalidSignatures: [],
    }),
    true,
  );
  assert.equal(
    canContinueWithIsolatedVideoPreparationFailures({
      ok: false,
      status: "partial",
      invalidChannels: [
        { channel: "pinterest", reason: "video_duration_too_long" },
      ],
    }),
    true,
  );
  assert.equal(
    canContinueWithIsolatedVideoPreparationFailures({
      ok: false,
      status: "partial",
      invalidChannels: [{ reason: "video_duration_too_long" }],
    }),
    false,
  );
  assert.equal(
    canContinueWithIsolatedVideoPreparationFailures({
      ok: false,
      status: "failed",
      invalidChannels: [{ channel: "pinterest" }],
    }),
    false,
  );
});

test("immediate publication defers video work while scheduling keeps one recovery", async () => {
  const modal = await read("app/dashboard/booster/publier/PublishModal.tsx");
  assert.match(modal, /options\?\.generateMissingVideoVariants === false/);
  assert.doesNotMatch(modal, /startBackgroundVideoPrewarm/);
  assert.doesNotMatch(modal, /prepareCutoverVideoVariants/);
  const immediatePublish = modal.slice(
    modal.indexOf("const runPublish = async"),
    modal.indexOf("const onSavePublicationDraft = async"),
  );
  assert.doesNotMatch(
    immediatePublish,
    /ensureCutoverVideoVariantsReady|prewarmPersistentMediaWorkspace/,
  );
  assert.match(
    modal,
    /shouldRetryVideoVariantGeneration[\s\S]*generateMissingVideoVariants:\s*true/,
  );
  assert.match(modal, /generateMissingVideoVariants:\s*true/);
  assert.match(modal, /allowPartialChannelFailures:\s*true/);
  assert.match(modal, /canContinueWithIsolatedVideoPreparationFailures/);
  assert.match(modal, /deferTechnicalPreparationUntilPublish=/);
});

test("duration-invalid channels turn red before dispatch and are reported as failed", async () => {
  const shared = await read(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
  );
  const modal = await read("app/dashboard/booster/publier/PublishModal.tsx");
  const layer = await read(
    "app/dashboard/_components/DashboardBoosterModalLayer.tsx",
  );
  const mediaPanel = await read(
    "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
  );
  const previewPanel = await read(
    "app/dashboard/booster/publier/components/PublishPreviewPanel.tsx",
  );

  assert.match(
    shared,
    /validateVideoDurationForChannel/,
  );
  assert.match(shared, /durationValidation\.message/);
  assert.match(shared, /durationValidation\.reason/);
  assert.match(shared, /mediaBlockers\.push\(message\)/);
  assert.match(modal, /const preflightFailedChannels = reviewItems/);
  assert.match(modal, /item\.blockerCodes\?\.\[0\]/);
  assert.match(
    modal,
    /tone:\s*reviewItem\?\.mediaBlockers\?\.length[\s\S]*\("blocked" as const\)/,
  );
  assert.match(modal, /message:\s*reviewItem\?\.blockers\?\.\[0\]/);
  assert.match(
    mediaPanel,
    /if \(readinessTone === "blocked"\) return "blocked"/,
  );
  assert.match(mediaPanel, /role="alert"/);
  assert.match(mediaPanel, /i18nT\("media_incompatible_pour_value_20130e10"/);
  assert.match(mediaPanel, /activeMediaBlockers\.map/);
  assert.match(previewPanel, /tab\.message \|\| "Canal incompatible/);
  assert.match(layer, /mergePreflightFailuresIntoPublicationSummary/);
  assert.doesNotMatch(layer, /status:\s*"skipped"/);
});

test("only the durable preparation worker may generate variants and failures stay isolated", async () => {
  const route = await read("app/api/booster/publish-now/route.ts");
  assert.match(
    route,
    /preparePublicationVariants\(\s*internalAsyncPreparationDispatch,?\s*\)/,
  );
  assert.doesNotMatch(route, /preparePublicationVariants\(true\)/);
  assert.match(route, /Only the durable preparation worker may run FFmpeg/);
  assert.match(route, /preflightFailuresByChannel/);
  assert.match(route, /buildBoosterPublicationDispatchPlan/);
});

test("safe video preparation errors are no longer hidden as a generic action failure", async () => {
  const errors = await read("lib/userFacingErrors.ts");
  assert.match(errors, /variante vidéo/);
  assert.match(errors, /doit être préparée en mp4/);
  const safeBlock = errors.indexOf('"variante vidéo"');
  const genericPublishBlock = errors.indexOf('"photo upload failed"');
  assert.ok(safeBlock >= 0 && genericPublishBlock > safeBlock);
});


test("heavy work stays in prewarm while an explicit adaptation never falls back to the source", async () => {
  const prewarm = await read("app/api/media-pipeline/workspace/prewarm/route.ts");
  assert.match(
    prewarm,
    /allowsOriginalVideoFallback[\s\S]*sourceValidation\.ok/,
  );
  const route = await read("app/api/booster/publish-now/route.ts");
  const channelContext = await read(
    "app/api/booster/publish-now/publishNow.channel-context.ts",
  );
  const collectStart = route.indexOf("const collectInvalidVideoChannels");
  const collectEnd = route.indexOf(
    "// Only the durable preparation worker may run FFmpeg",
    collectStart,
  );
  assert.ok(collectStart >= 0 && collectEnd > collectStart);
  const adaptationValidation = route.slice(collectStart, collectEnd);
  assert.doesNotMatch(route, /requiresPreparedNetworkVideoVariant/);
  assert.doesNotMatch(adaptationValidation, /sourceValidation/);
  assert.match(adaptationValidation, /reason:\s*"video_variant_required"/);
  assert.match(route, /usesOriginalSource && sourceDirectlyPublishable/);
  assert.match(channelContext, /const usesOriginalSource = settings\.format === "original"/);
  assert.match(
    channelContext,
    /if \(usesOriginalSource\) \{\s*return sourceValidation\.ok \? publicationVideo : null;\s*\}/,
  );
  assert.match(
    channelContext,
    /if \(!variant\?\.publicUrl \|\| !variant\?\.storagePath\) \{\s*return null;\s*\}/,
  );
  assert.doesNotMatch(route, /generationAttempted:\s*boolean/);
});

test("video variant planning deduplicates before the ten-signature cap", async () => {
  const server = await read("lib/boosterVideoVariantServer.ts");
  assert.match(server, /MAX_VARIANTS_PER_REQUEST = 10/);
  assert.match(
    server,
    /buildVideoTransformPlan\(params\.variants\)\.slice\([\s\S]*MAX_VARIANTS_PER_REQUEST/,
  );
  assert.doesNotMatch(
    server,
    /buildVideoTransformPlan\([\s\S]{0,80}params\.variants\.slice/,
  );
});

test("dedicated Google cached derivatives are validated without poisoning shared social variants", async () => {
  const server = await read("lib/boosterVideoVariantServer.ts");
  assert.match(server, /const validatesDedicatedChannel =/);
  assert.match(server, /const cachedValidation = validatesDedicatedChannel && variant\.channel/);
  assert.match(
    server,
    /if \(cachedValidation\.ok\) \{[\s\S]*readyVariants\.push\(cachedVariant\);[\s\S]*else \{[\s\S]*missingPlan\.push\(variant\)/,
  );
});
