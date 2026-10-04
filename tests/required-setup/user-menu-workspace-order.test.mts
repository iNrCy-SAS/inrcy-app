import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../../app/dashboard/_components/UserMenu.tsx", import.meta.url),
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

test("the desktop account menu leaves the four workspace tools in their dedicated navigation", () => {
  assert.match(source, /closeAndOpen\("preferences"\)/);
  assert.doesNotMatch(source, /closeAndOpen\("profil"\)/);
  assert.doesNotMatch(source, /closeAndOpen\("(?:ia|ai_memory)"\)/);
  assert.doesNotMatch(source, /closeAndNavigate\("\/dashboard(?:\?action=channels|\/generer-media)"\)/);
});

test("the mobile General menu keeps account settings without repeating the tool shortcuts", () => {
  assert.match(responsiveSource, /label=\{t\.userMenu\.preferences\}/);
  assert.doesNotMatch(responsiveSource, /label=\{t\.userMenu\.profile\}/);
  assert.doesNotMatch(responsiveSource, /label=\{t\.userMenu\.(?:ai|aiMemory|mediaGenerator)\}/);
  assert.doesNotMatch(responsiveSource, /label=\{t\.hero\.channelOverviewTitle\}/);
  assert.match(responsiveSource, /getDisplayedMobileShortcuts\(shortcuts, standardMode\)/);
  assert.match(responsiveSource, /navigate\(option\.href\)/);
});

test("the relocated channel shortcut continues targeting the shared connections modal", () => {
  const shortcuts = readFileSync(new URL("../../lib/mobileShortcutPolicy.ts", import.meta.url), "utf8");
  assert.match(shortcuts, /id: "channels", href: "\/dashboard\?action=channels"/);
  assert.match(dashboardClientSource, /if \(action === "channels"\)/);
  assert.match(dashboardClientSource, /<ChannelConnectionsModal/);
  assert.match(dashboardClientSource, /onClose=\{closeChannelConnections\}/);
});
