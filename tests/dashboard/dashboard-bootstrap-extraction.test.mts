import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const client = read("app/dashboard/DashboardClient.tsx");
const foundations = read("app/dashboard/dashboard.bootstrap-cache.ts");

test("DashboardClient delegates boot caches to the extracted foundations module", () => {
  assert.match(client, /from "\.\/dashboard\.bootstrap-cache"/);
  assert.doesNotMatch(client, /function readCachedBubbleAccessMap\(/);
  assert.doesNotMatch(client, /function readCachedDashboardChannelState\(/);
  assert.match(foundations, /export function readCachedBubbleAccessMap\(/);
  assert.match(foundations, /export function readCachedDashboardChannelState\(/);

  const importedFoundations = client.match(
    /import\s*\{([^}]*)\}\s*from "\.\/dashboard\.bootstrap-cache";/,
  );
  assert.ok(importedFoundations, "DashboardClient must import the extracted foundations");
  assert.match(importedFoundations[1], /\bsanitizeCachedInrBadgeProfile\b/);
  assert.match(importedFoundations[1], /\btype SiteBubbleProgress\b/);
});

test("the extracted dashboard foundations keep fail-closed and cache-only boundaries", () => {
  assert.doesNotMatch(foundations, /site_inrcy|siteInrcy|SiteInrcy/);
  assert.match(foundations, /GENERATOR_POWER_SETTLE_MS = 700/);
  assert.doesNotMatch(foundations, /\bfetch\s*\(/);
  assert.doesNotMatch(foundations, /createClient\s*\(/);
  assert.doesNotMatch(foundations, /\.from\s*\(/);
  assert.doesNotMatch(foundations, /\buse(?:State|Effect|Memo|Callback|Ref)\b/);
});
