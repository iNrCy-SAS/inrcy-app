import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("original images bypass channel variant generation entirely", async () => {
  const [images, videos] = await Promise.all([
    read("lib/boosterImageServerPreparation.ts"),
    read("lib/boosterVideoVariantServer.ts"),
  ]);
  assert.match(images, /CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 8/);
  assert.match(images, /initialDecision\.mode === "original"[\s\S]{0,160}originalReferenceTransform/);
  assert.match(images, /"Originale" is reference-only/);
  assert.match(images, /let cachedVariantsPromise/);
  assert.doesNotMatch(images, /renderPublicationOriginal/);
  assert.doesNotMatch(images, /originalOutputPolicy/);
  assert.match(images, /getBoosterImageSafetyBackgroundMode/);
  assert.doesNotMatch(images, /\.blur\(/);
  assert.match(videos, /CHANNEL_VIDEO_VARIANT_PIPELINE_VERSION = 7/);
  assert.match(videos, /pad=\$\{w\}:\$\{h\}/);
  assert.doesNotMatch(videos, /boxblur|gblur|avgblur|smartblur/);
});

test("the site iframe follows each image or video natural ratio", async () => {
  const source = await read("app/embed/actus/_lib/render.ts");
  assert.match(source, /data-natural-media-frame/);
  assert.match(source, /--media-ratio/);
  assert.match(source, /syncNaturalMediaRatio/);
  assert.doesNotMatch(source, /\.mediaCol\{[^}]*aspect-ratio:4\/3/);
  assert.doesNotMatch(source, /\.mediaCol\{aspect-ratio:1\/1/);
});

test("Booster, iNrAgent and iNrSend keep Original as the untouched default", async () => {
  const [
    publishModal,
    publishImagesPanel,
    shared,
    agent,
    mailbox,
    mailboxPhase,
    optimizer,
    adapterModal,
  ] = await Promise.all([
    read("app/dashboard/booster/publier/PublishModal.tsx"),
    read("app/dashboard/booster/publier/components/PublishImagesPanel.tsx"),
    read("app/dashboard/booster/publier/publishModal.shared.tsx"),
    read("app/dashboard/agent/AgentClient.tsx"),
    read("app/dashboard/mails/MailboxClient.tsx"),
    read("app/dashboard/mails/_lib/mailboxPhase1.tsx"),
    read("lib/imageOptimizer.ts"),
    read("app/dashboard/_components/channel-image-adapter/modal.tsx"),
  ]);

  assert.match(publishModal, /next\[channel\] = "original"/);
  assert.doesNotMatch(
    publishModal,
    /next\[channel\] = getRecommendedVideoFormatForSource/,
  );
  assert.match(shared, /getBoosterImageSafetyBackgroundMode/);
  assert.doesNotMatch(shared, /ctx\.filter = "blur/);
  assert.match(publishImagesPanel, /getChannelSafetyBackgroundMode/);
  assert.doesNotMatch(publishImagesPanel, /backgroundMode:\s*["']blur["']/);
  assert.doesNotMatch(publishImagesPanel, /blurBackground:\s*true/);
  assert.match(agent, /getLocalizedVideoAdaptationModeLabel\([\s\S]*?boosterRuntimeT/);
  assert.doesNotMatch(agent, /Fond flouté/);
  assert.doesNotMatch(
    mailbox,
    /variant\.signature === signature \|\| variant\.channel === channel/,
  );
  assert.match(
    mailboxPhase,
    /facebook: \{ width: 1200, height: 1200, defaultFit: "contain", defaultBlurBackground: false \}/,
  );
  assert.match(
    mailboxPhase,
    /instagram: \{ width: 1080, height: 1350, defaultFit: "contain", defaultBlurBackground: false \}/,
  );
  assert.match(optimizer, /options\?\.nativeFirst !== false/);
  assert.match(optimizer, /SITE_CARD_NATIVE_MAX_SIDE/);
  assert.doesNotMatch(optimizer, /\.blur\(/);
  assert.doesNotMatch(adapterModal, /<option value="blur"/);
  assert.match(adapterModal, /<option value="white"/);
  assert.match(adapterModal, /<option value="black"/);
});
