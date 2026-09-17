import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const route = read("app/api/booster/publish-now/route.ts");
const channelContext = read(
  "app/api/booster/publish-now/publishNow.channel-context.ts",
);

const expectedFactories = [
  "createPublishNowVideoContext",
  "createPublishNowPostResolver",
  "createPublishNowImageContext",
];

const expectedDeclarations = [
  "getPublicationVideoForChannel",
  "buildPublicationVideoByChannel",
  "fallbackTitle",
  "fallbackContent",
  "fallbackCta",
  "fallbackHashtags",
  "getChannelPost",
  "externalImageUrls",
  "socialFeedImageUrls",
  "instagramImageUrls",
  "gmbImageUrls",
  "getChannelImageSet",
  "ChannelImageUrlKey",
  "getExpectedChannelImageCount",
  "pickCompleteChannelImageUrls",
];

test("publish-now imports a dedicated deterministic channel context", () => {
  assert.match(route, /from "\.\/publishNow\.channel-context"/);
  for (const factory of expectedFactories) {
    assert.match(
      channelContext,
      new RegExp(`export function ${factory}\\b`),
      `missing channel context factory: ${factory}`,
    );
    assert.match(route, new RegExp(`\\b${factory}\\b`));
  }
  for (const declaration of expectedDeclarations) {
    assert.match(
      channelContext,
      new RegExp(`\\b${declaration}\\b`),
      `missing channel context declaration: ${declaration}`,
    );
  }
});

test("the channel context stays deterministic and side-effect free", () => {
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
    /\bencryptToken\b/,
    /\brefreshTiktokAccessToken\b/,
    /\brefreshYoutubeShortsAccessToken\b/,
    /\bBuffer\b/,
    /\brandomUUID\b/,
    /\bafter\s*\(/,
    /\.storage\b/,
    /\bfacebookPublishToPage\b/,
    /\binstagramPublishPhotoWithTokenFallback\b/,
    /\binstagramPublishImagesBestEffortWithTokenFallback\b/,
    /\blinkedinPublishText\b/,
    /\btiktokDirectPostPhotos\b/,
    /\buploadYoutubeShort\b/,
    /\bcreatePinterestImagePin\b/,
    /\bgmbCreateLocalPost\b/,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(channelContext, pattern);
  }
});

test("network dispatch, durable delivery and token refresh stay in the route", () => {
  const routeOnlyMarkers = [
    "setDelivery",
    // The former whole-file loader was intentionally replaced by the bounded
    // range probe used by TikTok's resumable 300 MiB transport.
    "probeTikTokRangeSource",
    "getTiktokAccessToken",
    "getYoutubeShortsAccessToken",
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
    assert.doesNotMatch(channelContext, new RegExp(`\\b${marker}\\b`));
  }
});

test("per-channel content, video and explicit partial-image policy remain active", () => {
  assert.match(channelContext, /validateVideoPublicationForChannel\(/);
  assert.match(channelContext, /getVariantForChannel\(/);
  assert.match(channelContext, /limitBoosterChannelContent\(/);
  assert.match(channelContext, /sanitizeBoosterSiteText\(/);
  assert.match(channelContext, /never borrow a fallback from another channel/i);
  assert.match(channelContext, /urls\.length >= expected/);
  assert.match(channelContext, /allowPartial/);
  assert.match(route, /getPublicationVideoForChannel\(ch\)/);
  assert.match(route, /getChannelPost\(ch\)/);
  assert.match(route, /pickCompleteChannelImageUrls\(\{/);
});
