import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("dashboard boot receives the canonical channel state from the server", () => {
  const page = read("app/dashboard/page.tsx");

  assert.match(page, /getCurrentInrcyAccountScope\(\)/);
  assert.match(page, /getChannelConnectionStates\(current\.supabase, current\.scope\.activeUserId\)/);
  assert.match(page, /initialOfficialChannelStates=\{initialOfficialChannelSnapshot\?\.states \?\? null\}/);
  assert.match(page, /initialOfficialChannelStatesUserId=\{initialOfficialChannelSnapshot\?\.activeUserId \?\? null\}/);
});

test("a complete account-scoped snapshot is rendered before the first dashboard paint", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.match(dashboard, /buildOfficialDashboardChannelState\(initialOfficialChannelStates\)/);
  assert.match(dashboard, /browserAccountId === initialOfficialChannelStatesUserId[\s\S]*readCachedDashboardChannelState\(\)/);
  assert.match(dashboard, /mergeDashboardHydrationState\(cached, initialServerOfficialDashboardState\)/);
  assert.match(dashboard, /hasCompleteOfficialDashboardChannelState\(initialDashboardChannelState\)/);
  assert.match(dashboard, /useBrowserLayoutEffect\(\(\) => \{[\s\S]*last known colours[\s\S]*applyDashboardChannelState\(initialDashboardChannelState\)/);
  assert.match(dashboard, /canonicalChannelStatesReadyRef = useRef\(Boolean\(initialServerOfficialDashboardState\)\)/);
  for (const hook of ["Facebook", "Instagram", "Linkedin", "GoogleBusiness", "Tiktok"]) {
    assert.match(
      dashboard,
      new RegExp(`use${hook}Channel\\(\\{[\\s\\S]*?initialState: initialDashboardChannelState,`),
    );
  }

  assert.match(dashboard, /initialDashboardChannelState\?\.xConnected === true/);
  assert.match(dashboard, /typeof initialDashboardChannelState\?\.inrSearchConnected === "boolean"/);
  assert.doesNotMatch(dashboard, /setXStatusReady\(false\)/);
  assert.doesNotMatch(dashboard, /fetch\("\/api\/integrations\/x\/status"/);
});

test("account cache restoration preserves the matching server snapshot", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.match(
    dashboard,
    /initialOfficialChannelStatesUserId === activeAccountId[\s\S]*mergeDashboardHydrationState\(cachedChannelState, scopedInitialServerState\)/,
  );
  assert.match(dashboard, /writeCachedDashboardChannelState\(hydrationState\)/);
  assert.doesNotMatch(
    dashboard,
    /useBrowserLayoutEffect\(\(\) => \{[\s\S]*writeCachedDashboardChannelState\(initialDashboardChannelState\)/,
  );
});

test("switching establishments restores only the new account snapshot while revalidation continues", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.match(dashboard, /canonicalChannelStatesReadyRef\.current = false;[\s\S]*const cachedChannelState = readCachedDashboardChannelState\(\);[\s\S]*setOfficialChannelStatesReady\(hasCompleteOfficialDashboardChannelState\(cachedChannelState\)\)/);
  assert.match(dashboard, /accountScope !== getActiveBrowserUserId\(\)/);
});
