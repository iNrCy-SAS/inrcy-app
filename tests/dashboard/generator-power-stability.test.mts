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
const dashboardStylesSource = readFileSync(
  new URL("../../app/dashboard/dashboard.module.css", import.meta.url),
  "utf8",
);

test("generator power keeps the last confirmed value while channel states settle", () => {
  assert.match(
    dashboardClientSource,
    /const generatorPower = displayedGeneratorPower \?\? 0;/,
  );
  assert.doesNotMatch(
    dashboardClientSource,
    /usingCachedGeneratorPower \? displayedGeneratorPower : computedGeneratorPower/,
  );
});

test("generator power commits only after a quiet settling window", () => {
  assert.match(
    dashboardBootstrapSource,
    /const GENERATOR_POWER_SETTLE_MS = 700;/,
  );
  assert.match(
    dashboardClientSource,
    /if \(!generatorPowerReady \|\| displayedGeneratorPower === computedGeneratorPower\) return;/,
  );
  assert.match(
    dashboardClientSource,
    /window\.setTimeout\(\(\) => \{[\s\S]*setDisplayedGeneratorPower\(computedGeneratorPower\)[\s\S]*writeUiCacheValue\(GENERATOR_POWER_CACHE_KEY, String\(computedGeneratorPower\)\)[\s\S]*\}, GENERATOR_POWER_SETTLE_MS\)/,
  );
  assert.match(
    dashboardClientSource,
    /return \(\) => window\.clearTimeout\(settleTimer\);/,
  );
});

test("OAuth returns rehydrate the account-scoped confirmed power", () => {
  assert.match(
    dashboardClientSource,
    /const hydrateActiveAccountCaches = \(activeAccountId: string\) => \{[\s\S]*const cachedChannelState = readCachedDashboardChannelState\(\);[\s\S]*mergeDashboardHydrationState\(cachedChannelState, scopedInitialServerState\)[\s\S]*applyDashboardChannelState\(hydrationState\)[\s\S]*readCachedGeneratorPowerPercent\(\)[\s\S]*setDisplayedGeneratorPower\(cachedPower\)/,
  );
  assert.match(
    dashboardClientSource,
    /setActiveBrowserUserId\(activeUserId\);[\s\S]*hydrateActiveAccountCaches\(activeUserId\);/,
  );
});

test("hard refresh reads the authoritative server account cache before first paint", () => {
  assert.match(
    dashboardClientSource,
    /const initialBrowserCacheAccountId = initialOfficialChannelStatesUserId \?\? getActiveBrowserUserId\(\);/,
  );
  assert.match(
    dashboardClientSource,
    /readCachedDashboardChannelState\(initialBrowserCacheAccountId\)/,
  );
  assert.match(
    dashboardClientSource,
    /readCachedGeneratorPowerPercent\(initialBrowserCacheAccountId\)[\s\S]*readCachedGeneratorPowerSnapshot\(initialBrowserCacheAccountId\)/,
  );
});

test("connection revalidation never commits an intermediate gauge value", () => {
  assert.match(
    dashboardClientSource,
    /const \[generatorPowerRevalidating, setGeneratorPowerRevalidating\] = useState\(false\);/,
  );
  assert.match(
    dashboardClientSource,
    /const refreshOfficialChannelStates = useCallback\(async \(\) => \{[\s\S]*setGeneratorPowerRevalidating\(true\)[\s\S]*finishPowerRevalidation/,
  );
  assert.match(
    dashboardClientSource,
    /const generatorPowerReady =[\s\S]*&& !generatorPowerRevalidating;/,
  );
});

test("cockpit bars swap confirmed values without replaying a width animation", () => {
  assert.match(
    dashboardStylesSource,
    /\.cockpitStageBar > span \{[\s\S]*transition: none;/,
  );
  assert.doesNotMatch(
    dashboardStylesSource,
    /\.cockpitStageBar > span \{[\s\S]*transition: width 320ms ease;/,
  );
});
