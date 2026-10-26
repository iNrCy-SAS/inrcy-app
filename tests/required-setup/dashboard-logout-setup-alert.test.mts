import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  beginBrowserSignOut,
  cancelBrowserSignOut,
  isBrowserSignOutInProgress,
} from "../../lib/browserSignOutState.ts";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

test("the browser sign-out guard is synchronous and reversible", () => {
  cancelBrowserSignOut();
  assert.equal(isBrowserSignOutInProgress(), false);

  beginBrowserSignOut();
  assert.equal(isBrowserSignOutInProgress(), true);

  cancelBrowserSignOut();
  assert.equal(isBrowserSignOutInProgress(), false);
});

test("desktop and mobile logout start the guard before clearing the active account", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const mobileNavigation = read(
    "app/dashboard/_components/ResponsiveBottomNav.tsx",
  );

  for (const source of [dashboard, mobileNavigation]) {
    assert.match(
      source,
      /beginBrowserSignOut\(\);[\s\S]*?setActiveBrowserUserId\(null\)/,
    );
    assert.match(
      source,
      /if \(error\) \{[\s\S]*?cancelBrowserSignOut\(\)/,
    );
  }
});

test("DashboardClient cannot launch the old automatic modal during arrival or logout", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  assert.doesNotMatch(dashboard, /useDashboardSetupAlert|openInitialChannelConnections|dashboard\/setup-intro/);
  assert.match(dashboard, /beginBrowserSignOut\(\)/);
  assert.match(dashboard, /const openUsageGuide = useCallback/);
});
