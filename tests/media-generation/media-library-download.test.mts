import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("media library exposes a real per-file download action", () => {
  const client = read("app/dashboard/mediatheque/MediaLibraryClient.tsx");
  const styles = read("app/dashboard/mediatheque/mediaLibrary.module.css");

  assert.match(client, /function buildMediaDownloadUrl/);
  assert.match(client, /download=1/);
  assert.match(client, /className=\{styles\.mediaRowDownload\}/);
  assert.match(client, /download=\{item\.original_file_name \|\| true\}/);
  assert.match(client, /aria-label=\{i18nT\("ai_generator_download"\)\}/);
  assert.match(styles, /\.mediaRowDownload\{/);
  assert.match(styles, /\.mediaRowActions\{/);
});

test("private downloads stream from Storage with an attachment filename", () => {
  const route = read("app/api/media-library/items/[id]/content/route.ts");

  assert.match(route, /searchParams\.get\("download"\) === "1"/);
  assert.match(route, /buildDownloadFileName\(row\)/);
  assert.match(route, /searchParams\.set\("download", buildDownloadFileName\(row\)\)/);
  assert.match(route, /signedUrl = downloadUrl\.toString\(\)/);
  assert.match(route, /Location: signedUrl/);
  assert.match(route, /status: 307/);
  assert.doesNotMatch(route, /\.download\(storagePath\)/);
});
