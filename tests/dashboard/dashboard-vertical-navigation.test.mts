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

test("le cockpit compact remplace les deux commandes verticales par un hub de canaux accessible", () => {
  // Keep the existing landmarks for links and scroll restoration, without the obsolete jump buttons.
  assert.match(dashboard, /id=\{DASHBOARD_TOP_ANCHOR_ID\}/);
  assert.match(channels, /id=\{DASHBOARD_TOOLS_ANCHOR_ID\}/);
  assert.match(modules, /id=\{DASHBOARD_GEARBOX_ANCHOR_ID\}/);
  assert.doesNotMatch(dashboard, /dashboardQuickJump|quickNavigation\.goToTools|scrollToDashboardAnchor/);
  assert.doesNotMatch(channels, /quickNavigation\.goToTop|scrollToDashboardAnchor/);

  assert.match(channels, /data-testid="dashboard-channels-hub"/);
  assert.match(channels, /onClick=\{\(\) => setChannelsOpen\(true\)\}/);
  assert.match(channels, /aria-haspopup="dialog"/);
  assert.match(channels, /aria-expanded=\{channelsOpen\}/);
  assert.match(channels, /getChannelTone\(item\) === "connected"/);
  assert.match(channels, /<small>\/\{summaryItems\.length\}<\/small>/);
  assert.match(channels, /channelsOpen \? <DashboardChannelsModal items=\{fluxBubbleItems\}/);
  assert.match(channels, /onClose=\{\(\) => setChannelsOpen\(false\)\}/);
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
