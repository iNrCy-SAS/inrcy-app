import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(ROOT, relativePath), "utf8");

test("iNrStats detail renders real publication windows and typed empty states", () => {
  const ui = read("app/dashboard/stats/stats.ui.tsx");
  const metrics = read("app/dashboard/stats/stats.shared.metrics.ts");
  const client = read("app/dashboard/stats/StatsClient.tsx");

  assert.match(ui, /stats\.publicationTrackingAvailable/);
  assert.match(ui, /stats\.publications\.week/);
  assert.match(ui, /stats\.publications\.month/);
  assert.match(ui, /stats\.publications\.year/);
  assert.match(ui, /publicationTypes\?\.\[type\]\?\.year/);
  assert.match(ui, /publications_none_12m/);
  assert.match(ui, /publication_types_unavailable/);
  assert.match(ui, /publication_tracking_unavailable/);
  assert.match(ui, /stats\.publicationHistoryComplete === false/);
  assert.match(ui, /publication_type_unknown_count/);
  assert.match(metrics, /hasOwnProperty\.call\(\(raw as any\)\.publications \|\| \{\}, "year"\)/);
  assert.match(metrics, /hasOwnProperty\.call\(raw, "publicationTypes"\)/);
  assert.match(metrics, /typeof \(raw as any\)\.publicationHistoryComplete === "boolean"/);
  assert.match(client, /buildInrcyActivityStats\("inr_search", sharedActivityOverview\)/);
});

test("publication type labels are complete in every stats catalogue", () => {
  const requiredKeys = [
    "publications_completed",
    "publication_volume",
    "publication_types_12m",
    "publication_type_text",
    "publication_type_image",
    "publication_type_video",
    "publication_type_classic",
    "publication_type_reel",
    "publication_type_story",
    "publication_type_short",
    "publication_type_pin",
    "publication_type_unknown_count",
    "publications_none_12m",
    "publication_types_unavailable",
    "publication_tracking_unavailable",
    "publication_history_partial",
    "12_months_short",
  ];
  const localeDirs = readdirSync(path.join(ROOT, "messages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  assert.equal(localeDirs.length, 9);
  for (const locale of localeDirs) {
    const catalogue = JSON.parse(read(`messages/${locale}/stats.json`)) as Record<string, unknown>;
    for (const key of requiredKeys) {
      assert.equal(typeof catalogue[key], "string", `${locale} misses ${key}`);
      assert.ok(String(catalogue[key]).trim(), `${locale}.${key} must not be empty`);
    }
  }
});

test("Pinterest surfaces its existing live business metrics and preserves real zeros", () => {
  const metrics = read("app/dashboard/stats/stats.shared.metrics.ts");
  const pinterest = read("lib/pinterestAnalytics.ts");

  for (const field of ["impressions", "engagements", "pin_clicks", "outbound_clicks", "saves"]) {
    assert.match(pinterest, new RegExp(`\\b${field}\\b`));
    assert.match(metrics, new RegExp(`\\b${field}\\b`));
  }
  assert.match(metrics, /options\.available === undefined && n <= 0/);
  assert.match(metrics, /metric_outbound_clicks/);
  assert.match(metrics, /metric_saves/);
});

test("GMB keeps provider-exposed zeros and Facebook surfaces reliable post clicks", () => {
  const metrics = read("app/dashboard/stats/stats.shared.metrics.ts");
  const facebook = read("lib/facebookInsights.ts");

  assert.match(metrics, /function gmbMetricAvailable/);
  assert.match(metrics, /available: gmbMetricAvailable\(metrics, \["callClicks"/);
  assert.doesNotMatch(metrics, /totals\.(?:impressions|callClicks|directionRequests|websiteClicks) > 0/);
  assert.match(facebook, /if \(name === "post_clicks"\) addNumeric\(totals, "clicks", v\)/);
  assert.match(metrics, /metricKeyExists\(m, \["clicks", "post_clicks_sum"\]\)/);
});

test("publication details reuse the compact no-scroll row and logos fill one bubble", () => {
  const css = read("app/dashboard/stats/stats.module.css");

  assert.match(css, /\.publicationsActivityLayout\s*\{[\s\S]*?grid-template-columns: minmax\(260px, 0\.84fr\) minmax\(340px, 1\.16fr\)/);
  assert.match(css, /\.publicationWindowGrid\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.publicationTypeChips\s*\{[\s\S]*?justify-content: space-evenly/);
  assert.match(css, /\.statsWorkspaceChannel \.channelStatsPanel \.cubeBody[\s\S]*?overflow: hidden !important/);
  assert.match(css, /\.statsWorkspaceChannel \.channelStatsTitleIconBubble\s*\{[\s\S]*?overflow: hidden !important/);
  assert.match(css, /\.statsWorkspaceChannel \.channelStatsTitleIcon\s*\{[\s\S]*?width: 100% !important;[\s\S]*?height: 100% !important;[\s\S]*?object-fit: cover !important/);
});

test("global navigation and detail pages follow the dashboard channel order", () => {
  const client = read("app/dashboard/stats/StatsClient.tsx");
  const start = client.indexOf("const baseModels: CubeModel[] = [");
  const end = client.indexOf("\n    ];", start);
  assert.ok(start >= 0 && end > start, "baseModels declaration must remain discoverable");
  const baseModels = client.slice(start, end);
  const orderedMarkers = [
    "buildInrBadgeCubeModel(",
    'buildCubeModel("site_web"',
    'buildCubeModel("gmb"',
    "buildInrSearchCubeModel(",
    'buildCubeModel("facebook"',
    'buildCubeModel("instagram"',
    'buildCubeModel("linkedin"',
    'buildCubeModel("tiktok"',
    'buildCubeModel("youtube_shorts"',
    'buildCubeModel("pinterest"',
    'buildCubeModel("x"',
    "buildMailCubeModel(",
    'buildCubeModel("site_inrcy"',
  ];

  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const index = baseModels.indexOf(marker);
    assert.ok(index > previousIndex, `${marker} is out of dashboard order`);
    previousIndex = index;
  }
  assert.match(baseModels, /\.\.\.\(!standardMode \? \[buildMailCubeModel/);
});
