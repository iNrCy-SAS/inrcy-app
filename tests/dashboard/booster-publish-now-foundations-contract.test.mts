import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const route = read("app/api/booster/publish-now/route.ts");
const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const serverPreparation = read(
  "app/api/booster/publish-now/publishNow.server-preparation.ts",
);

const expectedDeclarations = [
  "ChannelKey",
  "JsonRecord",
  "asRecord",
  "IMMEDIATE_PUBLISH_DUPLICATE_LOOKAHEAD_MINUTES",
  "formatDuplicateScheduledAt",
  "buildImmediateDuplicateMessage",
  "PUBLISH_IDEMPOTENCY_SCOPE",
  "PUBLISH_IDEMPOTENCY_TTL_MS",
  "buildPublishIdempotencyKey",
  "buildPublishIdempotencyMetadata",
  "buildResultsSummary",
  "slugify",
  "ImagePayload",
  "PublicationMediaType",
  "ChannelMediaMode",
  "VideoPayload",
  "PersistedVideoAttachment",
  "BOOSTER_MAX_VIDEO_SOURCE_BYTES",
  "BOOSTER_MAX_VIDEO_SOURCE_MB_LABEL",
  "normalizePublicationMediaType",
  "normalizeChannelMediaMode",
  "normalizeTiktokPublicationSettings",
  "EditableImageAttachment",
  "PostPayload",
  "PostByChannel",
  "ImagesByChannel",
  "ImageSet",
  "buildAsyncPreparedImagePayloads",
  "buildQueuedPublicationSummary",
  "imageExtensionFromMime",
  "normalizeHashtag",
  "normalizePublicHttpUrl",
  "isExpired",
  "ImageOptimizationFormats",
  "EMPTY_IMAGE_FORMATS",
  "hasFinalImageGeometryDecision",
  "getRequiredImageFormatsForChannel",
  "mergeImageFormats",
  "buildEditableImageAttachments",
];

test("publish-now imports its deterministic foundations from one server module", () => {
  assert.match(route, /from "\.\/publishNow\.foundations"/);
  for (const declaration of expectedDeclarations) {
    assert.match(
      foundations,
      new RegExp(`\\b${declaration}\\b`),
      `missing foundation declaration: ${declaration}`,
    );
  }
});

test("the foundations module remains free of network, database and dispatch side effects", () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\bsupabaseAdmin\b/,
    /\bNextResponse\b/,
    /\brequireUser\b/,
    /\benforceRateLimit\b/,
    /\bacquireExecutionIdempotencyLock\b/,
    /\bcompleteExecutionIdempotencyLock\b/,
    /\bfailExecutionIdempotencyLock\b/,
    /\bprepareBoosterImagesByChannelOnServer\b/,
    /\bprepareBoosterVideoVariantsOnServer\b/,
    /\btryDecryptToken\b/,
    /\brandomUUID\b/,
    /\bafter\s*\(/,
    /\bsupabaseAdmin\s*\.\s*from\s*\(/,
    /\.storage\b/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(foundations, pattern);
  }
});

test("server preparation is isolated while dispatch and durable execution stay in the route", () => {
  const preparationMarkers = [
    "buildInstagramPublishTokenCandidates",
    "normalizeVideoPayload",
    "uploadImageSet",
    "getLatestIntegrationRow",
  ];
  for (const marker of preparationMarkers) {
    assert.match(serverPreparation, new RegExp(`\\b${marker}\\b`));
    assert.match(route, new RegExp(`\\b${marker}\\b`));
    assert.doesNotMatch(foundations, new RegExp(`\\b${marker}\\b`));
  }

  const routeOnlyMarkers = [
    "resolveWorkspacePublicationConsumption",
    "prepareBoosterImagesByChannelOnServer",
    "prepareBoosterVideoVariantsOnServer",
    "acquireExecutionIdempotencyLock",
    "finalizeAsyncPublicationIfReady",
    "facebookPublishToPage",
    "instagramPublishImagesBestEffortWithTokenFallback",
    "linkedinPublishText",
    "tiktokDirectPostPhotos",
    "uploadYoutubeShort",
    "createPinterestImagePin",
    "gmbCreateLocalPost",
  ];
  for (const marker of routeOnlyMarkers) {
    assert.match(route, new RegExp(`\\b${marker}\\b`));
    assert.doesNotMatch(serverPreparation, new RegExp(`\\b${marker}\\b`));
    assert.doesNotMatch(foundations, new RegExp(`\\b${marker}\\b`));
  }
});
