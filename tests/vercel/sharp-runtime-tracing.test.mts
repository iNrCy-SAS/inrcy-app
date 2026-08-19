import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nextConfig = readFileSync(
  new URL("../../next.config.ts", import.meta.url),
  "utf8",
);

test("Vercel functions retain Sharp and its native libvips packages", () => {
  assert.match(nextConfig, /outputFileTracingIncludes/);
  assert.match(nextConfig, /node_modules\/sharp\/\*\*\/\*/);
  assert.match(nextConfig, /node_modules\/@img\/\*\*\/\*/);

  for (const route of [
    "/api/cron/*",
    "/api/booster/**/*",
    "/api/media-pipeline/**/*",
    "/api/media-library/**/*",
    "/api/inrsend/**/*",
  ]) {
    assert.ok(nextConfig.includes(`"${route}": sharpRuntimeFiles`), route);
  }
});

test("HEIC conversion remains a traced Node runtime dependency", () => {
  assert.match(
    nextConfig,
    /serverExternalPackages:\s*\["heic-convert"\]/,
  );
});
