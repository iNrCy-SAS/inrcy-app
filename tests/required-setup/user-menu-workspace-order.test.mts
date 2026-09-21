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

test("the professional workspace entries stay grouped without a duplicate Profile destination", () => {
  const preferences = source.indexOf('closeAndOpen("preferences")');
  const configuration = source.indexOf('closeAndOpen("ia")');
  const channelConnections = source.indexOf('closeAndNavigate("/dashboard?action=channels")');
  const businessDna = source.indexOf('closeAndOpen("ai_memory")');

  assert.ok(preferences >= 0);
  assert.doesNotMatch(source, /closeAndOpen\("profil"\)/);
  assert.ok(preferences < channelConnections);
  assert.ok(channelConnections < businessDna);
  assert.ok(businessDna < configuration);
});

test("the responsive menu mirrors the same professional workspace order", () => {
  const preferences = responsiveSource.indexOf("label={t.userMenu.preferences}");
  const configuration = responsiveSource.indexOf("label={t.userMenu.ai}");
  const channelConnections = responsiveSource.indexOf("label={t.hero.channelOverviewTitle}");
  const businessDna = responsiveSource.indexOf("label={t.userMenu.aiMemory}");

  assert.ok(preferences >= 0);
  assert.doesNotMatch(responsiveSource, /label=\{t\.userMenu\.profile\}/);
  assert.ok(preferences < channelConnections);
  assert.ok(channelConnections < businessDna);
  assert.ok(businessDna < configuration);
  assert.match(responsiveSource, /navigate\(channelConnectionsHref\)/);
  assert.doesNotMatch(
    responsiveSource.slice(channelConnections, configuration),
    /AiConfigurationIcon/,
  );
});

test("both menu entries target the one shared channel connections modal", () => {
  assert.match(source, /\/dashboard\?action=channels/);
  assert.match(responsiveSource, /\/dashboard\?action=channels/);
  assert.match(dashboardClientSource, /if \(action === "channels"\)/);
  assert.match(dashboardClientSource, /<ChannelConnectionsModal/);
  assert.match(dashboardClientSource, /onClose=\{closeChannelConnections\}/);
});
