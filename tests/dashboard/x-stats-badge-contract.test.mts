import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_INRBADGE_SHARE_SETTINGS,
  normalizeInrBadgeShareSettings,
} from "../../lib/inrBadgeSettings.ts";
import {
  INR_AGENT_DEFAULT_SETTINGS,
  INR_AGENT_LABELS,
  INR_AGENT_THEMES,
} from "../../lib/inrAgentSettings.ts";
import { computeInertiaSnapshot, type InertiaChannels } from "../../lib/loyalty/inertia.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("X is a first-class local statistics cube without an invented remote analytics call", () => {
  const metrics = read("lib/metrics/computeMetrics.ts");
  const shared = read("lib/stats/buildOverview.shared.ts");
  const overview = read("lib/stats/buildOverview.ts");

  assert.match(metrics, /export const CUBES:[\s\S]*?["']x["']/);
  assert.match(metrics, /export const EMPTY_CUBE_RECORD:[\s\S]*?x:\s*0/);
  assert.match(metrics, /export const INCLUDE_BY_CUBE:[\s\S]*?x:\s*["']x["']/);
  assert.match(shared, /export const INRCY_PUBLISHABLE_CHANNELS:[\s\S]*?["']x["']/);
  assert.match(overview, /const xLocalPublicationStats:/);
  assert.match(overview, /sourcesStatus\.x\.metrics[\s\S]*?mergeXLocalPublicationStats/);
  assert.match(overview, /Aucun appel analytics X/);
  assert.doesNotMatch(overview, /fetchXAnalytics|xApiGet|\/2\/users\/[^\s"']+\/tweets/);
});

test("X is persisted in iNrBadge sharing and rendered on the public badge", () => {
  assert.equal(DEFAULT_INRBADGE_SHARE_SETTINGS.x, true);
  assert.equal(normalizeInrBadgeShareSettings({}).x, true);
  assert.equal(normalizeInrBadgeShareSettings({ x: false }).x, false);

  const settings = read("app/dashboard/settings/_components/InrBadgeSettingsContent.tsx");
  const badge = read("app/badge/[slug]/page.tsx");
  const analytics = read("lib/inrBadgeAnalytics.ts");
  assert.match(settings, /key: "x"/);
  assert.match(settings, /canShareChannel\(channels\.x \|\| \{ connected: false \}\)/);
  assert.match(badge, /shareSettings\.x/);
  assert.match(badge, /iconSrc: "\/icons\/x\.svg"/);
  assert.match(badge, /trackingAction: "x"/);
  assert.match(analytics, /x: InrBadgeStatsPeriod/);
  assert.match(analytics, /"x",[\s\S]*?"tiktok"/);
  assert.match(analytics, /x: zeroPeriod\(\)/);
});

test("X contributes to the loyalty inertia exactly like another connected social channel", () => {
  const channels: InertiaChannels = {
    site_inrcy: false,
    site_web: false,
    gmb: false,
    facebook: false,
    instagram: false,
    linkedin: false,
    x: true,
    tiktok: false,
    youtube_shorts: false,
  };
  const snapshot = computeInertiaSnapshot(channels);

  assert.equal(snapshot.totalChannels, 9);
  assert.equal(snapshot.connectedCount, 1);
  assert.equal(snapshot.bonus, 0.5);
  assert.deepEqual(
    snapshot.breakdown.find((item) => item.key === "x"),
    { key: "x", label: "X", bonus: 0.5, connected: true },
  );
});

test("X identity and diagnostics remain connected to canonical channel state", () => {
  const identities = read("app/api/stats/channel-identities/route.ts");
  const inrSearch = read("lib/inrSearchPublic.ts");
  const inrSearchOrbit = read("app/entreprises/[slug]/InrSearchSocialOrbit.tsx");
  const inrSearchStyles = read("app/entreprises/[slug]/inrSearchPublic.module.css");
  const inrSearchAnalytics = read("app/entreprises/[slug]/InrSearchAnalyticsClient.tsx");
  const inrSearchLeadForm = read("app/entreprises/[slug]/InrSearchLeadForm.tsx");
  const inrSearchAnalyticsServer = read("lib/inrSearchAnalytics.ts");
  const diagnostics = read("lib/channelPublishDiagnostics.ts");

  assert.match(identities, /xUsername[\s\S]*?@\$\{xUsername\}/);
  assert.match(identities, /states\.x\.profile_url/);
  assert.match(inrSearch, /key: "x", label: "X", url: normalizeExternalUrl\(channelStates\.x\.profile_url\)/);
  assert.match(inrSearchOrbit, /x: "\/icons\/x\.svg"/);
  assert.match(inrSearchStyles, /\.social_x\s*\{/);
  assert.match(inrSearchAnalytics, /x\\\.com\|twitter\\\.com/);
  assert.match(inrSearchLeadForm, /x\\\.com\|twitter\\\.com/);
  assert.match(inrSearchAnalyticsServer, /"linkedin",\s*"x",\s*"tiktok"/);
  assert.match(diagnostics, /x: \{ provider: "x", source: "x", product: "x" \}/);
  assert.match(diagnostics, /x: "X à reconnecter\. Rendez-vous dans Canaux\."/);
});

test("the automatic iNrAgent statistics report keeps X in its default theme set", () => {
  assert.ok(INR_AGENT_THEMES.includes("x"));
  assert.equal(INR_AGENT_LABELS.themes.x, "X");
  assert.ok(INR_AGENT_DEFAULT_SETTINGS.automations.stats.allowedThemes.includes("x"));

  const reportRoute = read("app/api/agent/actions/send-stats-report/route.ts");
  assert.match(reportRoute, /x: "X"/);
  assert.match(reportRoute, /Object\.prototype\.hasOwnProperty\.call\(channelLabels, theme\)/);
});

test("X is preserved throughout the daily stats payload and the summary navigation", () => {
  const refreshClient = read("lib/dailyStatsRefreshClient.ts");
  const statsUi = read("app/dashboard/stats/stats.ui.tsx");

  assert.match(refreshClient, /\| "x"/);
  assert.match(statsUi, /onScrollTo\("x"\)/);
  assert.match(statsUi, /centralByCube\.x/);
});

test("every X bubble reuses one lightweight, uncropped logo without an embedded outline", () => {
  const svg = read("public/icons/x.svg");
  const dashboard = read("app/dashboard/dashboard.constants.ts");
  const agent = read("app/dashboard/agent/_lib/agent.config.ts");
  const badge = read("app/badge/[slug]/page.tsx");

  assert.ok(Buffer.byteLength(svg, "utf8") < 800);
  assert.match(svg, /viewBox="0 0 128 128"/);
  assert.match(svg, /<circle[^>]*r="60"[^>]*fill="#05070c"/);
  assert.doesNotMatch(svg, /stroke=|stroke-width=/);
  assert.match(dashboard, /import xBubbleIcon from "\.\.\/\.\.\/public\/icons\/x\.svg"/);
  assert.match(agent, /x: \{ name: "X", src: "\/icons\/x\.svg" \}/);
  assert.match(badge, /iconSrc: "\/icons\/x\.svg"/);
});
