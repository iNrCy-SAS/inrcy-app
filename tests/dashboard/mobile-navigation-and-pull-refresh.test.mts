import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isMostlyHorizontalPull,
  supportsCustomPullToRefresh,
} from "../../lib/mobilePullToRefresh.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("custom pull-to-refresh covers phones, tablets and foldables by capability", () => {
  assert.equal(
    supportsCustomPullToRefresh({
      maxTouchPoints: 5,
      primaryPointerCoarse: true,
      anyPointerCoarse: true,
      hoverNone: true,
    }),
    true,
  );

  assert.equal(
    supportsCustomPullToRefresh({
      maxTouchPoints: 10,
      primaryPointerCoarse: false,
      anyPointerCoarse: true,
      hoverNone: false,
    }),
    true,
    "a tablet with an attached mouse must keep its touch gesture",
  );

  assert.equal(
    supportsCustomPullToRefresh({
      maxTouchPoints: 0,
      primaryPointerCoarse: false,
      anyPointerCoarse: false,
      hoverNone: false,
    }),
    false,
    "a narrow desktop window is not a mobile touch device",
  );
});

test("horizontal gestures are rejected before taking over native scrolling", () => {
  assert.equal(isMostlyHorizontalPull(80, 30), true);
  assert.equal(isMostlyHorizontalPull(20, 80), false);
});

test("mobile navigation uses the shared 650 ms loading controller", () => {
  const navigation = read("app/dashboard/_components/ResponsiveBottomNav.tsx");

  assert.match(navigation, /useDelayedPendingAction/);
  assert.match(navigation, /modal:publish/);
  assert.match(navigation, /publishLoadingVisible \? i18nT\("chargement_01cba1df"\)/);
  assert.match(navigation, /shortcutLoadingVisible \? i18nT\("chargement_01cba1df"\)/);
  assert.match(navigation, /panel:ia/);
  assert.match(navigation, /resolveHrefDestination\("\/dashboard\/mediatheque"\)/);
  assert.match(navigation, /data-disable-pull-refresh/);
  assert.match(navigation, /requestDashboardToolWarmup/);
});

test("dashboard pull-to-refresh is universal and protected by unsaved-change guards", () => {
  const pull = read("app/_components/PullToRefresh.tsx");
  const globalLayout = read("app/layout.tsx");
  const dashboardLayout = read("app/dashboard/layout.tsx");
  const dashboardBridge = read("app/dashboard/_components/DashboardPullToRefresh.tsx");
  const globalCss = read("app/globals.css");

  assert.doesNotMatch(pull, /isIosSafari/);
  assert.match(pull, /\(any-pointer: coarse\)/);
  assert.match(pull, /touchmove", onTouchMove, \{ passive: false \}/);
  assert.match(pull, /event\.preventDefault\(\)/);
  assert.match(pull, /beforeRefresh/);
  assert.match(pull, /\[role="menu"\]/);
  assert.match(globalLayout, /<PullToRefresh disabledOnDashboard \/>/);
  assert.match(dashboardLayout, /<DashboardPullToRefresh \/>/);
  assert.match(dashboardBridge, /requestNavigation\(\(\) => undefined\)/);
  assert.match(globalCss, /inrcy-pull-refresh-enabled/);
  assert.doesNotMatch(globalCss, /min-width: 769px[\s\S]*globalPullRefreshIndicator/);
});
