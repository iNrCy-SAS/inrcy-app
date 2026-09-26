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
const campaignChoicesSource = readFileSync(
  new URL("../app/dashboard/_components/DashboardCampaignChoices.tsx", import.meta.url),
  "utf8",
);
const adsServerSource = readFileSync(new URL("../lib/adsServer.ts", import.meta.url), "utf8");
const adsPageSource = readFileSync(new URL("../app/dashboard/ads/page.tsx", import.meta.url), "utf8");
const adsCallbackSource = readFileSync(
  new URL("../app/api/ads/oauth/[provider]/callback/route.ts", import.meta.url),
  "utf8",
);

test("iNr’ADS reste visible, mais est verrouillé hors compte Admin pendant la préparation", () => {
  assert.match(dashboardClientSource, /isAdmin=\{isAdmin\}/);
  assert.match(channelsSource, /adsPilotEnabled=\{isAdmin\}/);
  assert.match(campaignChoicesSource, /adsComingSoon/);
  assert.match(campaignChoicesSource, /campaign-ads-coming-soon/);
  assert.match(campaignChoicesSource, /À venir/);
  assert.match(adsServerSource, /isAdsPilotAdmin/);
  assert.match(adsServerSource, /INRCY_ADS_COMING_SOON/);
  assert.match(adsServerSource, /GOOGLE_ADS_API_VERSION/);
  assert.match(adsServerSource, /"login-customer-id"/);
  assert.match(adsPageSource, /isAdsPilotAdmin/);
  assert.match(adsCallbackSource, /isAdsPilotAdmin/);
});
