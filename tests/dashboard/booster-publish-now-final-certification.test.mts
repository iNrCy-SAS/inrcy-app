import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const route = read("app/api/booster/publish-now/route.ts");
const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const serverPreparation = read(
  "app/api/booster/publish-now/publishNow.server-preparation.ts",
);
const channelContext = read(
  "app/api/booster/publish-now/publishNow.channel-context.ts",
);
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const statusRoute = read(
  "app/api/booster/publications/[publicationId]/status/route.ts",
);
const recoveryCron = read("app/api/cron/booster-publications/route.ts");

const branchDefinitions = [
  {
    name: "inr_search",
    start: 'if (ch === "inr_search")',
    end: 'if (ch === "inrcy_site" || ch === "site_web")',
    required: [
      "ensureSystemManagedInrSearch",
      "getInrSearchPublicStatus",
      "buildInrSearchPublicUrl",
      "setDelivery",
    ],
  },
  {
    name: "sites",
    start: 'if (ch === "inrcy_site" || ch === "site_web")',
    end: 'if (ch === "facebook")',
    required: [
      "hasActiveInrcySite",
      "pickCompleteChannelImageUrls",
      '.from("site_articles")',
      "setDelivery",
    ],
  },
  {
    name: "facebook",
    start: 'if (ch === "facebook")',
    end: 'if (ch === "instagram")',
    required: [
      "facebookPublishVideoToPage",
      "facebookPublishToPage",
      "pickCompleteChannelImageUrls",
      "setDelivery",
    ],
  },
  {
    name: "instagram",
    start: 'if (ch === "instagram")',
    end: 'if (ch === "linkedin")',
    required: [
      "instagramCreateVideoCheckpointWithTokenFallback",
      "instagramPollVideoCheckpointWithTokenFallback",
      "instagramPublishVideoCheckpointWithTokenFallback",
      "instagramPublishCarouselWithTokenFallback",
      "instagramPublishPhotoWithTokenFallback",
      "buildInstagramPublishTokenCandidates",
      "setDelivery",
    ],
  },
  {
    name: "linkedin",
    start: 'if (ch === "linkedin")',
    end: 'if (ch === "youtube_shorts")',
    required: [
      "linkedinPublishVideo",
      "linkedinPublishMultiImage",
      "linkedinPublishImage",
      "linkedinPublishText",
      "linkedinResharePost",
      "setDelivery",
    ],
  },
  {
    name: "youtube_shorts",
    start: 'if (ch === "youtube_shorts")',
    end: 'if (ch === "tiktok")',
    required: [
      "isYoutubeShortsIntegrationActive",
      "getYoutubeShortsAccessToken",
      "uploadYoutubeShort",
      "setDelivery",
    ],
  },
  {
    name: "tiktok",
    start: 'if (ch === "tiktok")',
    end: 'if (ch === "pinterest")',
    required: [
      "isTiktokIntegrationActive",
      "getTiktokAccessToken",
      "tiktokDirectPostVideoFileUpload",
      "tiktokDirectPostPhotos",
      "loadFirstAvailableTikTokVideo",
      "setDelivery",
    ],
  },
  {
    name: "pinterest",
    start: 'if (ch === "pinterest")',
    end: 'if (ch === "gmb")',
    required: [
      "getPinterestAccessToken",
      "createPinterestVideoPin",
      "createPinterestImagePin",
      "setDelivery",
    ],
  },
  {
    name: "gmb",
    start: 'if (ch === "gmb")',
    end: "const unsupportedChannelMessage =",
    required: [
      "getGmbToken",
      "gmbCreateLocalPost",
      "rebuildGoogleBusinessImages",
      "gmb_media_preflight_failed",
      "publishGoogleBusiness",
      "setDelivery",
    ],
  },
] as const;

const networkPublisherMarkers = [
  "facebookPublishVideoToPage",
  "facebookPublishToPage",
  "instagramCreateVideoCheckpointWithTokenFallback",
  "instagramPollVideoCheckpointWithTokenFallback",
  "instagramPublishVideoCheckpointWithTokenFallback",
  "instagramPublishCarouselWithTokenFallback",
  "instagramPublishPhotoWithTokenFallback",
  "linkedinPublishVideo",
  "linkedinPublishMultiImage",
  "linkedinPublishImage",
  "linkedinPublishText",
  "linkedinResharePost",
  "uploadYoutubeShort",
  "tiktokDirectPostVideoFileUpload",
  "tiktokDirectPostPhotos",
  "createPinterestVideoPin",
  "createPinterestImagePin",
  "gmbCreateLocalPost",
];

test("the final publish-now route keeps one ordered explicit branch per supported destination", () => {
  let previousIndex = -1;
  for (const branch of branchDefinitions) {
    const index = route.indexOf(branch.start);
    assert.ok(index > previousIndex, `branch out of order or missing: ${branch.name}`);
    previousIndex = index;
  }
  assert.equal((route.match(/if \(ch === "facebook"\)/g) || []).length, 1);
  assert.equal((route.match(/if \(ch === "instagram"\)/g) || []).length, 1);
  assert.equal((route.match(/if \(ch === "linkedin"\)/g) || []).length, 1);
  assert.equal((route.match(/if \(ch === "youtube_shorts"\)/g) || []).length, 1);
  assert.equal((route.match(/if \(ch === "tiktok"\)/g) || []).length, 1);
  assert.equal((route.match(/if \(ch === "gmb"\)/g) || []).length, 1);
});

test("every channel branch retains its required prechecks, publisher and durable delivery update", () => {
  for (const branch of branchDefinitions) {
    const body = sliceBetween(route, branch.start, branch.end);
    for (const marker of branch.required) {
      assert.ok(body.includes(marker), `${branch.name} lost required marker: ${marker}`);
    }
    assert.match(body, /results\[ch\]/, `${branch.name} must persist an in-memory result`);
    assert.match(body, /continue;/, `${branch.name} must terminate its own dispatch branch`);
  }
});

test("network publishers remain isolated inside their own channel branches", () => {
  const ownership: Record<string, string[]> = {
    facebook: ["facebookPublishVideoToPage", "facebookPublishToPage"],
    instagram: [
      "instagramCreateVideoCheckpointWithTokenFallback",
      "instagramPollVideoCheckpointWithTokenFallback",
      "instagramPublishVideoCheckpointWithTokenFallback",
      "instagramPublishCarouselWithTokenFallback",
      "instagramPublishPhotoWithTokenFallback",
    ],
    linkedin: [
      "linkedinPublishVideo",
      "linkedinPublishMultiImage",
      "linkedinPublishImage",
      "linkedinPublishText",
      "linkedinResharePost",
    ],
    youtube_shorts: ["uploadYoutubeShort"],
    tiktok: ["tiktokDirectPostVideoFileUpload", "tiktokDirectPostPhotos"],
    pinterest: ["createPinterestVideoPin", "createPinterestImagePin"],
    gmb: ["gmbCreateLocalPost"],
  };

  for (const branch of branchDefinitions) {
    const body = sliceBetween(route, branch.start, branch.end);
    const allowed = new Set(ownership[branch.name] || []);
    for (const publisher of networkPublisherMarkers) {
      if (allowed.has(publisher)) continue;
      assert.doesNotMatch(
        body,
        new RegExp(`\\b${publisher}\\b`),
        `${branch.name} unexpectedly invokes ${publisher}`,
      );
    }
  }
});

test("the per-channel catch and unsupported fallback always produce terminal durable state", () => {
  const dispatchLoop = sliceBetween(
    route,
    "for (const ch of selected)",
    "if (internalAsyncDispatch)",
  );
  assert.match(dispatchLoop, /code:\s*"unsupported_channel"/);
  assert.match(dispatchLoop, /retryable:\s*false/);
  assert.match(dispatchLoop, /catch \(e: unknown\)/);
  assert.match(dispatchLoop, /await setDelivery\(ch, \{ status: "failed", error: msg \}\)/);
  assert.match(dispatchLoop, /raw_error:/);
});

test("the extracted modules remain bounded by their intended responsibilities", () => {
  for (const source of [foundations, channelContext]) {
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /\bsupabaseAdmin\b/);
    assert.doesNotMatch(source, /\bNextResponse\b/);
    assert.doesNotMatch(source, /\bafter\s*\(/);
  }
  assert.doesNotMatch(serverPreparation, /["\']use client["\']/);
  assert.match(serverPreparation, /from "@\/lib\/supabaseAdmin"/);
  assert.doesNotMatch(serverPreparation, /facebookPublishToPage/);
  assert.doesNotMatch(serverPreparation, /instagramPublishPhotoWithTokenFallback/);
  assert.doesNotMatch(serverPreparation, /linkedinPublishText/);
  assert.doesNotMatch(serverPreparation, /tiktokDirectPostPhotos/);
  assert.doesNotMatch(serverPreparation, /uploadYoutubeShort/);
  assert.doesNotMatch(serverPreparation, /createPinterestImagePin/);
  assert.doesNotMatch(serverPreparation, /gmbCreateLocalPost/);
});

test("async status, recovery and aggregate finalization stay connected to publish-now", () => {
  assert.match(route, /updateAsyncChannelEvent\(/);
  assert.match(route, /finalizeAsyncPublicationIfReady\(/);
  assert.match(asyncPublication, /export async function finalizeAsyncPublicationIfReady/);
  assert.match(asyncPublication, /export async function readAsyncPublicationStatus/);
  assert.match(statusRoute, /readAsyncPublicationStatus\(/);
  assert.match(recoveryCron, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(recoveryCron, /MAX_ASYNC_DISPATCH_ATTEMPTS/);
  assert.match(recoveryCron, /async_dispatch_exhausted/);
  assert.match(recoveryCron, /\/api\/booster\/publish-now/);
  assert.match(recoveryCron, /buildInternalCronHeaders\(/);
});

test("the dispatch loop preserves semantic channel isolation and safe provider fallback", () => {
  const dispatchLoop = sliceBetween(
    route,
    "for (const ch of selected)",
    "if (internalAsyncDispatch)",
  );
  assert.match(dispatchLoop, /const preflightFailure = preflightFailuresByChannel\[ch\]/);
  assert.match(dispatchLoop, /if \(preflightFailure\)/);
  assert.match(dispatchLoop, /continue/);
  assert.match(dispatchLoop, /ch === "site_web"/);
  assert.match(dispatchLoop, /if \(ch === "tiktok"\)/);
  assert.match(route, /resp\.safeTextFallback === true/);
  assert.doesNotMatch(route, /preparePublicationVariants\(true\)/);
});
