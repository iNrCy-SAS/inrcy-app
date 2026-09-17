import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

test("the JSON widget stabilizes article media before returning it", () => {
  const route = read("app/api/widgets/actus/route.ts");
  const media = read("lib/embedActusMedia.ts");
  assert.match(route, /stabilizeEmbedActusArticleMedia/);
  assert.match(route, /articles:\s*stableArticles/);
  assert.match(media, /article\.images\s*=\s*parseImageUrls/);
  assert.match(media, /article\.video_url\s*=\s*stableVideoUrl/);
  assert.match(media, /article\.video_thumbnail_url\s*=\s*stableThumbnailUrl/);
  assert.match(media, /buildStableEmbedActusMediaUrl\(params\)\s*\|\|\s*raw/);
  assert.match(media, /article\.video_path/);
  assert.match(media, /videoMetadata\.storagePath/);
  assert.match(media, /videoMetadata\.thumbnailStoragePath/);
});
