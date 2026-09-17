import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const route = read("app/api/booster/publish-now/route.ts");
const serverPreparation = read(
  "app/api/booster/publish-now/publishNow.server-preparation.ts",
);

const exportedPreparationHelpers = [
  "buildInstagramPublishTokenCandidates",
  "normalizeVideoPayload",
  "isGoogleBusinessImageError",
  "uploadImageSet",
  "getLatestIntegrationRow",
];

test("publish-now imports one dedicated server preparation module", () => {
  assert.match(route, /from "\.\/publishNow\.server-preparation"/);
  for (const helper of exportedPreparationHelpers) {
    assert.match(
      serverPreparation,
      new RegExp(`export (?:async )?function ${helper}\\b`),
      `missing exported server helper: ${helper}`,
    );
    assert.match(route, new RegExp(`\\b${helper}\\b`));
  }
});

test("server preparation owns storage and transformation but never dispatch", () => {
  const requiredPreparationMarkers = [
    "createSafeStorageSignedUrl",
    "toExactStorageArrayBuffer",
    "optimizeForInstagram",
    "optimizeForSocialFeed",
    "optimizeForGoogleBusiness",
    "supabaseAdmin.storage",
  ];
  for (const marker of requiredPreparationMarkers) {
    assert.match(serverPreparation, new RegExp(marker.replace(".", "\\.")));
  }

  const forbiddenDispatchMarkers = [
    "NextResponse",
    "requireUser",
    "enforceRateLimit",
    "acquireExecutionIdempotencyLock",
    "completeExecutionIdempotencyLock",
    "failExecutionIdempotencyLock",
    "finalizeAsyncPublicationIfReady",
    "facebookPublishToPage",
    "instagramPublishImagesBestEffortWithTokenFallback",
    "linkedinPublishText",
    "tiktokDirectPostPhotos",
    "uploadYoutubeShort",
    "createPinterestImagePin",
    "gmbCreateLocalPost",
  ];
  for (const marker of forbiddenDispatchMarkers) {
    assert.doesNotMatch(serverPreparation, new RegExp(`\\b${marker}\\b`));
  }
});

test("the HTTP handler and every channel dispatch remain in the route", () => {
  assert.match(route, /async function publishNowHandler\(req: Request\)/);
  assert.match(route, /export const POST = withApi\(/);
  for (const marker of [
    "facebookPublishToPage",
    "instagramPublishImagesBestEffortWithTokenFallback",
    "linkedinPublishText",
    "tiktokDirectPostPhotos",
    "uploadYoutubeShort",
    "createPinterestImagePin",
    "gmbCreateLocalPost",
  ]) {
    assert.match(route, new RegExp(`\\b${marker}\\b`));
  }
});
