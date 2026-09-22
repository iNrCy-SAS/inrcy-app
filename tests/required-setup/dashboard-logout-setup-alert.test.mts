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

test("the setup alert is cancelled and rechecked while logout is in progress", () => {
  const hook = read("app/dashboard/_hooks/useDashboardSetupAlert.ts");

  assert.match(hook, /BROWSER_SIGN_OUT_START_EVENT/);
  assert.match(hook, /isBrowserSignOutInProgress\(\) \|\|/);
  assert.match(
    hook,
    /window\.addEventListener\(BROWSER_SIGN_OUT_START_EVENT, cancelPendingAlert\)/,
  );
  assert.match(
    hook,
    /if \(isBrowserSignOutInProgress\(\)\) return;[\s\S]*?confirmInrcy\(\{/,
  );
});
