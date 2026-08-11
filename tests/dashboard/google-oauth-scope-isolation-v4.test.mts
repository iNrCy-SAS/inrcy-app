import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const ROUTES = [
  "app/api/integrations/google/start/route.ts",
  "app/api/integrations/google-stats/start/route.ts",
  "app/api/integrations/google-business/start/route.ts",
  "app/api/integrations/youtube-shorts/start/route.ts",
] as const;

test("every Google OAuth product remains isolated from historical account grants", () => {
  for (const routePath of ROUTES) {
    assert.doesNotMatch(
      read(routePath),
      /include_granted_scopes/,
      `${routePath} must not merge legacy Google grants`,
    );
  }
});

test("Gmail, Stats and Google Business request only their own reviewed scopes", () => {
  const gmail = read(ROUTES[0]);
  const stats = read(ROUTES[1]);
  const business = read(ROUTES[2]);

  assert.match(gmail, /auth\/gmail\.send/);
  assert.match(gmail, /auth\/userinfo\.email/);
  assert.doesNotMatch(gmail, /gmail\.readonly|gmail\.modify|analytics\.readonly|business\.manage/);

  assert.match(stats, /auth\/analytics\.readonly/);
  assert.match(stats, /auth\/webmasters\.readonly/);
  assert.match(stats, /auth\/userinfo\.email/);
  assert.doesNotMatch(stats, /auth\/gmail|auth\/business\.manage|auth\/youtube/);

  assert.match(business, /auth\/business\.manage/);
  assert.match(business, /auth\/userinfo\.email/);
  assert.doesNotMatch(business, /auth\/gmail|auth\/analytics|auth\/webmasters|auth\/youtube/);
});

test("YouTube scopes are code-reviewed and cannot be enlarged by a Vercel variable", () => {
  const oauth = read("lib/youtubeShortsOAuth.ts");

  for (const scope of [
    "youtube.upload",
    "youtube.readonly",
    "yt-analytics.readonly",
    "userinfo.email",
  ]) {
    assert.ok(oauth.includes(scope), `missing reviewed YouTube scope ${scope}`);
  }

  assert.match(oauth, /return YOUTUBE_SHORTS_DEFAULT_SCOPES\.join\(" "\)/);
  assert.doesNotMatch(oauth, /YOUTUBE_SHORTS_SCOPES\s*\|\|/);
  assert.doesNotMatch(oauth, /GOOGLE_YOUTUBE_SHORTS_SCOPES/);
});

test("Google provider auth failures discovered by Stats disable publication immediately", () => {
  const overview = read("lib/stats/buildOverview.ts");

  assert.match(overview, /channel: "gmb"[\s\S]*stage: "stats_provider_metrics"/);
  assert.match(overview, /channel: "youtube_shorts"[\s\S]*stage: "stats_provider_metrics"/);
  assert.match(overview, /sourcesStatus\.gmb\.connected = false/);
  assert.match(overview, /sourcesStatus\.youtube_shorts\.connected = false/);
  assert.match(overview, /needs_reconnect: reconnectPersisted/);
});
