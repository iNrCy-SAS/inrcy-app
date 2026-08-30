import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const dashboardBootstrapSource = readFileSync(
  new URL("../../app/dashboard/dashboard.bootstrap-cache.ts", import.meta.url),
  "utf8",
);
const fluxBubblesSource = readFileSync(
  new URL("../../app/dashboard/dashboard.flux-bubbles.ts", import.meta.url),
  "utf8",
);

test("Site iNrCy keeps a display-only confirmed state during the authoritative check", () => {
  assert.match(
    dashboardBootstrapSource,
    /function readCachedSiteInrcyDisplayAccess\(\): boolean \{[\s\S]*return parsed\.site_inrcy === true;/,
  );
  assert.match(
    fluxBubblesSource,
    /const displayAccessEnabled = m\.key === "site_inrcy" && !siteInrcyAccessReady[\s\S]*\? siteInrcyDisplayAccess[\s\S]*: accessEnabled;/,
  );
  assert.match(
    fluxBubblesSource,
    /const \{ status: bubbleStatus, text: bubbleStatusText \} = displayAccessEnabled/,
  );
});

test("the cached visual state never unlocks Site iNrCy actions", () => {
  assert.match(fluxBubblesSource, /if \(!accessEnabled\) return;/);
  assert.match(fluxBubblesSource, /configureDisabled:\s*!accessEnabled/);
  assert.match(fluxBubblesSource, /canViewSpecial: accessEnabled \? canViewSpecial : false/);
});

test("generator power waits for the real channel refresh and site progress waits for authoritative access", () => {
  assert.match(
    dashboardClientSource,
    /const generatorPowerReady = siteConnectionsReady && profileCheckReady && activityCheckReady;/,
  );
  assert.match(
    dashboardClientSource,
    /if \(!siteConnectionsReady \|\| !bubbleAccessReady\) return;[\s\S]*writeUiCacheValue\(SITE_BUBBLE_PROGRESS_CACHE_KEY/,
  );
});

test("cached channel hydration restores visuals without impersonating a completed server refresh", () => {
  assert.match(
    dashboardClientSource,
    /useBrowserLayoutEffect\(\(\) => \{[\s\S]*applyDashboardChannelState\(initialDashboardChannelState\);[\s\S]*setOfficialChannelStatesReady\(true\);/,
  );
  assert.match(
    dashboardClientSource,
    /canonicalChannelStatesReadyRef = useRef\(Boolean\(initialServerOfficialDashboardState\)\)/,
  );
});
