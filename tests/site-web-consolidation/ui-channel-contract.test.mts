import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { APP_BUBBLE_KEYS, buildBubbleAccessMap, createDefaultBubbleAccessRows } from "../../lib/bubbleAccess.ts";
import { DASHBOARD_CHANNEL_KEYS, isDashboardChannelKey } from "../../lib/dashboardChannels.ts";
import { normalizeInrBadgeShareSettings } from "../../lib/inrBadgeSettings.ts";
import { computeInertiaSnapshot } from "../../lib/loyalty/inertia.ts";
import { BUSINESS_DNA_DASHBOARD_CHANNELS } from "../../lib/businessDnaChannelAvailability.ts";

test("all active registries contain exactly one website channel", () => {
  for (const keys of [APP_BUBBLE_KEYS, DASHBOARD_CHANNEL_KEYS, BUSINESS_DNA_DASHBOARD_CHANNELS.map(({ key }) => key)]) {
    assert.equal(keys.filter((key) => key === "site_web").length, 1);
    assert.equal(keys.some((key) => String(key) === "site_inrcy" || String(key) === "inrcy_site"), false);
  }
  assert.equal(isDashboardChannelKey("site_inrcy"), false);
  assert.equal(isDashboardChannelKey("site_web"), true);
  assert.equal(createDefaultBubbleAccessRows("account").length, APP_BUBBLE_KEYS.length);
});

test("a retired access row cannot enable the current website when its access is disabled", () => {
  const access = buildBubbleAccessMap([
    { bubble_key: "site_web", enabled: false },
    { bubble_key: "site_inrcy", enabled: true },
  ]);
  assert.equal(access.site_web, false);
  assert.equal(Object.hasOwn(access, "site_inrcy"), false);
});

test("badge preference migration keeps either previously enabled website choice", () => {
  assert.equal(normalizeInrBadgeShareSettings({ siteInrcy: true, siteWeb: false }).siteWeb, true);
  assert.equal(normalizeInrBadgeShareSettings({ siteInrcy: false, siteWeb: true }).siteWeb, true);
  assert.equal(normalizeInrBadgeShareSettings({ siteInrcy: false, siteWeb: false }).siteWeb, false);
  assert.equal(normalizeInrBadgeShareSettings({ siteInrcy: false }).siteWeb, true);
  assert.equal(Object.hasOwn(normalizeInrBadgeShareSettings({ siteInrcy: true }), "siteInrcy"), false);
});

test("the website contributes only once to loyalty channel count and bonus", () => {
  const snapshot = computeInertiaSnapshot({ site_web: true, gmb: false, facebook: false, instagram: false, linkedin: false, x: false, tiktok: false, youtube_shorts: false });
  assert.equal(snapshot.totalChannels, 8);
  assert.equal(snapshot.connectedCount, 1);
  assert.equal(snapshot.bonus, 1);
  assert.equal(snapshot.breakdown.filter(({ key }) => key === "site_web").length, 1);
});

test("the localized dashboard has no retired module and one website module", () => {
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const catalog = JSON.parse(readFileSync(new URL(`../../messages/${locale}/dashboard.json`, import.meta.url), "utf8"));
    assert.equal(Object.hasOwn(catalog.moduleCards, "site_inrcy"), false, locale);
    assert.equal(typeof catalog.moduleCards.site_web.name, "string", locale);
  }
});
