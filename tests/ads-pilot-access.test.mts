import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardClientSource = readFileSync(
  new URL("../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const channelsSource = readFileSync(
  new URL("../app/dashboard/_components/DashboardChannelsSection.tsx", import.meta.url),
  "utf8",
);
const modulesSource = readFileSync(
  new URL("../app/dashboard/_components/DashboardModulesCard.tsx", import.meta.url),
  "utf8",
);
const adsServerSource = readFileSync(new URL("../lib/adsServer.ts", import.meta.url), "utf8");
const adsPageSource = readFileSync(new URL("../app/dashboard/ads/page.tsx", import.meta.url), "utf8");
const adsCallbackSource = readFileSync(
  new URL("../app/api/ads/oauth/[provider]/callback/route.ts", import.meta.url),
  "utf8",
);

test("iNr’ADS ouvre Meta, Google, Pinterest et ChatGPT Ads aux professionnels Premium et conserve le verrou pilote des autres canaux", () => {
  assert.match(dashboardClientSource, /isAdmin=\{isAdmin\}/);
  assert.match(channelsSource, /adsPilotEnabled inrAgentEnabled/);
  assert.match(modulesSource, /path: "\/dashboard\/ads"[^\n]*premiumOnly: true, unavailable: !adsPilotEnabled/);
  assert.match(modulesSource, /disabled=\{Boolean\(standardMode && tool\.premiumOnly\) \|\| tool\.unavailable/);
  assert.match(modulesSource, /onClick=\{standardMode && tool\.premiumOnly \? \(\) => startPanelOpening\("abonnement"\)/);
  assert.match(adsServerSource, /isAdsPilotAdmin/);
  assert.match(adsServerSource, /getDashboardEditionForAccountId\(activeUserId\)/);
  assert.match(adsServerSource, /isAdsChannelUserAllowed/);
  assert.match(adsServerSource, /INRCY_ADS_COMING_SOON/);
  assert.match(adsServerSource, /GOOGLE_ADS_API_VERSION/);
  assert.match(adsServerSource, /"login-customer-id"/);
  assert.match(adsPageSource, /isAdsPilotAdmin/);
  assert.match(adsPageSource, /isAdsUserAllowed\(data\.user\.id, accountScope\.activeUserId\)/);
  assert.match(adsPageSource, /initialChannel=\{channel \|\| "google"\}/);
  assert.match(adsCallbackSource, /isAdsChannelUserAllowed/);
});
