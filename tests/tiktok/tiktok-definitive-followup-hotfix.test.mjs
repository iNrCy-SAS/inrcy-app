import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("TikTok cron watcher route exists and is protected", async () => {
  const route = await read("app/api/cron/tiktok-publications/route.ts");
  const watcher = await read("lib/tiktokPendingPublicationWatcher.ts");
  assert.match(route, /isAuthorizedCronRequest/);
  assert.match(route, /processPendingTiktokPublications/);
  assert.match(watcher, /fetchTiktokPublishStatus/);
  assert.match(watcher, /publication_deliveries/);
  assert.match(watcher, /app_events/);
});

test("TikTok watcher targets processing deliveries and refreshes the whole publication balance", async () => {
  const watcher = await read("lib/tiktokPendingPublicationWatcher.ts");
  assert.match(watcher, /buildAsyncPublicationAggregate/);
  assert.match(watcher, /summary: aggregate\.summary/);
  assert.match(watcher, /outcome: aggregate\.outcome/);
  assert.match(watcher, /externalCompletedAt/);
  assert.match(watcher, /\.from\("publication_deliveries"\)[\s\S]*\.eq\("status", "processing"\)/);
  assert.match(watcher, /\.in\("id", publicationIds\)/);
  assert.doesNotMatch(watcher, /\.limit\(500\)/);
  assert.match(watcher, /WATCHER_CONCURRENCY/);
});

test("TikTok initial status wait covers the normal photo download window", async () => {
  const source = await read("lib/tiktokPublish.ts");
  assert.match(source, /const delays = \[0, 1500, 2500, 3500, 4500, 5500, 6500\]/);
  assert.match(source, /watcher cron prend ensuite le relais/);
});

test("TikTok photos are materialized once in stable storage", async () => {
  const route = await read("app/api/media/tiktok/route.ts");
  assert.match(route, /cachedVariantPath/);
  assert.match(route, /tiktok-ready\//);
  assert.match(route, /downloadCachedVariant/);
  assert.match(route, /persistCachedVariant/);
  assert.match(route, /upsert: true/);
});

test("TikTok photo URLs are prewarmed before Direct Post init", async () => {
  const publish = await read("app/api/booster/publish-now/route.ts");
  const prewarmAt = publish.indexOf("const prewarmResults");
  const directPostAt = publish.indexOf("const tiktokResult = isVideo");
  assert.ok(prewarmAt >= 0);
  assert.ok(directPostAt > prewarmAt);
  assert.match(
    publish.slice(prewarmAt, directPostAt),
    /method: rangeGet \? "GET" : "HEAD"/,
  );
  assert.match(publish.slice(prewarmAt, directPostAt), /Range: "bytes=0-0"/);
  assert.match(publish.slice(prewarmAt, directPostAt), /image\/jpeg/);
  assert.match(publish.slice(prewarmAt, directPostAt), /image\/webp/);
});
