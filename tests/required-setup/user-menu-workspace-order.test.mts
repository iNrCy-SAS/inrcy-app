import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/_components/DashboardTopbar.tsx", import.meta.url),
  "utf8",
);
const responsiveSource = readFileSync(
  new URL("../../app/dashboard/_components/ResponsiveBottomNav.tsx", import.meta.url),
  "utf8",
);
const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);

test("the desktop account entry consolidates settings and leaves workspace tools in their dedicated navigation", () => {
  assert.match(source, /data-dashboard-action="account"/);
  assert.match(source, /setUserMenuOpen\(false\); openPanel\("compte"\)/);
  assert.doesNotMatch(source, /openPanel\("(?:preferences|profil|ia|ai_memory)"\)/);
  assert.doesNotMatch(source, /onNavigateCta\("\/dashboard(?:\?action=channels|\/generer-media)"\)/);
  assert.match(dashboardClientSource, /<DashboardTopbar/);
});

test("the mobile space menu consolidates account settings without repeating cockpit setup", () => {
  assert.match(responsiveSource, /openDashboardPanel\("compte"\)/);
  assert.doesNotMatch(responsiveSource, /openDashboardPanel\("preferences"\)/);
  assert.doesNotMatch(responsiveSource, /label=\{t\.userMenu\.profile\}/);
  assert.doesNotMatch(responsiveSource, /label=\{t\.userMenu\.(?:ai|aiMemory|mediaGenerator)\}/);
  assert.doesNotMatch(responsiveSource, /label=\{t\.hero\.channelOverviewTitle\}/);
  assert.match(responsiveSource, /getDashboardMobileMenu\(dashboardEdition\)/);
  assert.match(responsiveSource, /navigate\(option\.href\)/);
});

test("the relocated channel shortcut continues targeting the shared connections modal", () => {
  const shortcuts = readFileSync(new URL("../../lib/mobileShortcutPolicy.ts", import.meta.url), "utf8");
  assert.match(shortcuts, /id: "channels", href: "\/dashboard\?action=channels"/);
  assert.match(dashboardClientSource, /if \(action === "channels"\)/);
  assert.match(dashboardClientSource, /<DashboardChannelsSection/);
  assert.match(dashboardClientSource, /onCloseChannels=\{closeChannelConnections\}/);
});
