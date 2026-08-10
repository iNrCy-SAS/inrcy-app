import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const dashboard = read("app/dashboard/DashboardClient.tsx");
const topbar = read("app/dashboard/_components/DashboardTopbar.tsx");
const bottomNav = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
const notifications = read("app/dashboard/_hooks/useDashboardNotifications.ts");
const pendingCount = read("app/dashboard/_hooks/useInrAgentPendingCount.ts");
const stats = read("app/dashboard/stats/stats.client-hooks.ts");

test("permanent dashboard pollers stop while the document is hidden and resume immediately", () => {
  for (const [name, source] of [
    ["dashboard inr-search", dashboard],
    ["notifications", notifications],
    ["stats inr-search", stats],
  ] as const) {
    assert.match(source, /document\.hidden/,
      `${name} must explicitly guard hidden documents`);
    assert.match(source, /const stopPolling = \(\) =>/,
      `${name} must own an explicit interval teardown`);
    assert.match(source, /if \(document\.hidden\) \{[\s\S]*?stopPolling\(\)/,
      `${name} must stop its interval as soon as the tab is hidden`);
    assert.match(source, /document\.addEventListener\("visibilitychange"/,
      `${name} must restart from a visibility event`);
  }

  assert.match(dashboard, /syncIfVisible\(\);[\s\S]*?startPolling\(\)/);
  assert.match(notifications, /run\(\);[\s\S]*?startPolling\(\)/);
  assert.match(stats, /handler\(\);[\s\S]*?startPolling\(\)/);
});

test("iNrSearch refreshes use a bounded cadence and never overlap", () => {
  assert.match(stats, /const INR_SEARCH_ANALYTICS_POLL_MS = 120_000/);
  assert.match(
    stats,
    /window\.setInterval\(handler, INR_SEARCH_ANALYTICS_POLL_MS\)/,
  );
  assert.match(stats, /inrSearchStatsRequestRef = useRef<Promise<void> \| null>/);
  assert.match(stats, /if \(existingRequest\) return existingRequest/);
  assert.match(stats, /inrcy:inr-search-settings-updated/);

  assert.match(
    dashboard,
    /inrSearchSettingsRequestRef = useRef<Promise<void> \| null>/,
  );
  assert.match(
    dashboard,
    /const syncInrSearch = \(\) => \{[\s\S]*?if \(existingRequest\) return existingRequest/,
  );
  assert.match(
    dashboard,
    /requestAccountId !== getActiveBrowserUserId\(\)/,
  );
});

test("topbar and mobile navigation consume one shared account-scoped pending-count source", () => {
  assert.match(topbar, /useInrAgentPendingCount\([^)]*\)/);
  assert.match(bottomNav, /useInrAgentPendingCount\([^)]*\)/);
  assert.doesNotMatch(topbar, /\/api\/agent\/actions\/pending-count/);
  assert.doesNotMatch(bottomNav, /\/api\/agent\/actions\/pending-count/);

  assert.equal(
    (pendingCount.match(/fetch\("\/api\/agent\/actions\/pending-count"/g) || []).length,
    1,
  );
  assert.match(pendingCount, /const listeners = new Set/);
  assert.match(pendingCount, /requestPromisesByAccount = new Map/);
  assert.match(pendingCount, /readAccountCacheValue\([\s\S]*?accountId/);
  assert.match(pendingCount, /writeAccountCacheValue\([\s\S]*?accountId/);
  assert.match(pendingCount, /if \(document\.hidden\) \{[\s\S]*?stopPolling\(\)/);
  assert.match(pendingCount, /void refreshInrAgentPendingCount\(\);[\s\S]*?startPolling\(\)/);
  assert.match(pendingCount, /ACTIVE_INRCY_ACCOUNT_EVENT/);
});
