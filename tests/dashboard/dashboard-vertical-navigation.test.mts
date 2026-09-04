import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const dashboard = read("app/dashboard/DashboardClient.tsx");
const channels = read("app/dashboard/_components/DashboardChannelsSection.tsx");
const modules = read("app/dashboard/_components/DashboardModulesCard.tsx");
const boosterLayer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const routing = read("app/dashboard/_hooks/useDashboardPanelRouting.ts");
const layout = read("app/dashboard/layout.tsx");
const memory = read("app/dashboard/_components/DashboardScrollMemory.tsx");
const scroll = read("app/dashboard/dashboard.scroll.ts");
const css = read("app/dashboard/dashboard.module.css");

test("le cockpit relie les zones haute et outils par deux commandes accessibles", () => {
  assert.match(dashboard, /id=\{DASHBOARD_TOP_ANCHOR_ID\}/);
  assert.match(dashboard, /window\.matchMedia\("\(max-width: 700px\), \(hover: none\) and \(pointer: coarse\)"\)/);
  assert.match(dashboard, /DASHBOARD_GEARBOX_ANCHOR_ID/);
  assert.match(dashboard, /scrollToDashboardAnchor\(targetAnchor\)/);
  assert.match(dashboard, /aria-label=\{dashboardCopy\.quickNavigation\.goToTools\}/);
  assert.match(channels, /id=\{DASHBOARD_TOOLS_ANCHOR_ID\}/);
  assert.match(modules, /id=\{DASHBOARD_GEARBOX_ANCHOR_ID\}/);
  assert.match(channels, /scrollToDashboardAnchor\(DASHBOARD_TOP_ANCHOR_ID\)/);
  assert.match(channels, /aria-label=\{t\.quickNavigation\.goToTop\}/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.dashboardQuickJump/);
});

test("la hauteur du dashboard est mémorisée universellement, sans rustine par outil", () => {
  assert.match(layout, /<DashboardScrollMemory \/>/);
  assert.match(memory, /pathname === DASHBOARD_HOME_PATH/);
  assert.match(memory, /window\.addEventListener\("scroll", onScroll/);
  assert.match(memory, /window\.addEventListener\("pagehide", persistLastKnownPosition\)/);
  assert.match(memory, /document\.addEventListener\("pointerdown", persistCurrentPosition, true\)/);
  assert.match(memory, /document\.addEventListener\("keydown", onNavigationKey, true\)/);
  assert.match(memory, /rememberDashboardScrollPosition\(lastKnownScrollTop\.current\)/);
  assert.match(memory, /restoreDashboardScrollPosition\(\)/);
  assert.doesNotMatch(routing, /rememberDashboardScrollPosition|restoreDashboardScrollPosition/);
  assert.doesNotMatch(dashboard, /rememberDashboardScrollPosition|restoreDashboardScrollPosition/);
  assert.doesNotMatch(boosterLayer, /rememberDashboardScrollPosition|restoreDashboardScrollPosition/);
  assert.match(scroll, /sessionStorage\.setItem\([\s\S]*?DASHBOARD_SCROLL_STORAGE_KEY/);
  assert.doesNotMatch(scroll, /removeItem\(DASHBOARD_SCROLL_STORAGE_KEY/);
  assert.match(scroll, /new ResizeObserver\(attemptRestore\)/);
  assert.match(scroll, /maxTop >= targetTop - 2/);
  assert.match(scroll, /window\.scrollTo\(\{ top: reachableTop, left: 0, behavior: "auto" \}\)/);
});
