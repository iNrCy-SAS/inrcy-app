import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BUSINESS_DNA_DASHBOARD_CHANNELS,
  buildBusinessDnaDashboardChannelAvailability,
  projectBusinessDnaDashboardChannelStatus,
} from "../../lib/businessDnaChannelAvailability.ts";

const projectRoot = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, projectRoot), "utf8");

test("Business DNA projects the canonical Dashboard connection states", () => {
  assert.equal(projectBusinessDnaDashboardChannelStatus({ connected: true }), "connected");
  assert.equal(projectBusinessDnaDashboardChannelStatus({ connected: false }), "not_connected");
  assert.equal(
    projectBusinessDnaDashboardChannelStatus({ connected: true, requiresUpdate: true }),
    "needs_reconnect",
  );
  assert.equal(
    projectBusinessDnaDashboardChannelStatus({ connected: true, connection_status: "needs_update" }),
    "needs_reconnect",
  );
  assert.equal(
    projectBusinessDnaDashboardChannelStatus({ connected: true, expired: true }),
    "needs_reconnect",
  );
});

test("the DNA availability response exposes the nine requested analysis channels in order", () => {
  const channelStates = Object.fromEntries(
    BUSINESS_DNA_DASHBOARD_CHANNELS
      .map(({ key }, index) => [key, { connected: index % 2 === 0 }]),
  );
  const result = buildBusinessDnaDashboardChannelAvailability({ channelStates });

  assert.deepEqual(
    result.map(({ key }) => key),
    [
      "site_web",
      "gmb",
      "facebook",
      "instagram",
      "linkedin",
      "tiktok",
      "youtube_shorts",
      "pinterest",
      "site_inrcy",
    ],
  );
  assert.equal(result.length, 9);
  assert.equal(result.every(({ analyzable }) => analyzable), true);
});

test("the nine pills remain present when every channel is disconnected", () => {
  const result = buildBusinessDnaDashboardChannelAvailability({ channelStates: {} });
  const visibleKeys: readonly string[] = result.map(({ key }) => key);

  assert.equal(result.length, 9);
  assert.equal(result.every(({ status }) => status === "not_connected"), true);
  assert.equal(visibleKeys.includes("inrbadge"), false);
  assert.equal(visibleKeys.includes("inr_search"), false);
  assert.equal(visibleKeys.includes("mails"), false);
});

test("the analysis endpoint and hero use current Dashboard states, not the last analysis result", () => {
  const route = read("app/api/ai-memory/analyze-channels/route.ts");
  const content = read("app/dashboard/settings/_components/AiMemoryContent.tsx");

  assert.match(route, /getChannelConnectionStates\(supabase, activeUserId\)/);
  assert.match(route, /buildBusinessDnaDashboardChannelAvailability/);
  assert.match(route, /\{ ok: true, quota, channels \}/);
  assert.match(content, /parseAnalysisChannels\(quotaPayload\.channels\)/);
  assert.match(content, /data-business-dna-channel-states/);
  assert.match(content, /data-channel-status=\{channel\.status\}/);
  assert.match(content, /useState<BusinessDnaDashboardChannelAvailability\[\]>\(disconnectedAnalysisChannels\)/);
  assert.match(content, /if \(!Array\.isArray\(value\)\) return disconnectedAnalysisChannels\(\)/);
  assert.doesNotMatch(content, /analysisChannels\.filter\(/);
});

test("all Dashboard locales explain connection and analysis coverage states", () => {
  const locales = ["fr-FR", "en-GB", "es-ES", "de-DE", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
  const requiredKeys = [
    "analysisChannelsAria",
    "analysisChannelConnected",
    "analysisChannelDisconnected",
    "analysisChannelReconnect",
    "analysisChannelIncluded",
    "analysisChannelNotIncluded",
    "analysisChannelTooltip",
  ];

  for (const locale of locales) {
    const catalog = JSON.parse(read(`messages/${locale}/dashboard.json`)) as {
      aiMemory?: Record<string, unknown>;
    };
    for (const key of requiredKeys) {
      assert.equal(
        typeof catalog.aiMemory?.[key],
        "string",
        `${locale} is missing dashboard.aiMemory.${key}`,
      );
    }
  }
});
