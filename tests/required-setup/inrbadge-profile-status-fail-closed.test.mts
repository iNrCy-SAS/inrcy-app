import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const fluxBubblesSource = readFileSync(
  new URL("../../app/dashboard/dashboard.flux-bubbles.ts", import.meta.url),
  "utf8",
);
const dashboardMessages = JSON.parse(
  readFileSync(new URL("../../messages/fr-FR/dashboard.json", import.meta.url), "utf8"),
) as { status: { syncing: string } };

test("iNrBadge reuses the last account-scoped authoritative state during refresh", () => {
  assert.match(
    dashboardClientSource,
    /normalizeNativeChannelStates\(initialDashboardChannelState\?\.nativeChannels\)/,
  );
  assert.match(
    dashboardClientSource,
    /setNativeChannelStates\(normalizeNativeChannelStates\(hydrationState\?\.nativeChannels\)\)/,
  );
  assert.match(
    dashboardClientSource,
    /detail\.accountId !== getActiveBrowserUserId\(\)/,
  );
  assert.match(
    dashboardClientSource,
    /inrBadgeProfileReady: nativeChannels\.inrbadge\.published/,
  );
  assert.doesNotMatch(dashboardClientSource, /lastKnownInrBadgeProfileReady/);
});

test("iNrBadge still falls back to synchronization only when no known state exists", () => {
  assert.match(
    fluxBubblesSource,
    /isNative \? \{ status: "available" as ModuleStatus, text: copy\.status\.syncing \}/,
  );
  assert.equal(dashboardMessages.status.syncing, "Synchronisation…");
  assert.match(
    dashboardClientSource,
    /const inrBadgeProfileCheckReady = nativeChannelStates !== null/,
  );
});

test("Badge configuration stays accessible before Profile completion while public actions require publication", () => {
  const native = readFileSync(new URL("../../app/dashboard/settings/_components/NativeChannelSettingsContent.tsx", import.meta.url), "utf8");
  assert.match(fluxBubblesSource, /configureDisabled: !accessEnabled/);
  assert.doesNotMatch(fluxBubblesSource, /configureDisabled:[^\n]*inrBadgeProfile/);
  assert.match(native, /loading \|\| busy \|\| !snapshot \|\| !state\?\.allowed/);
  assert.match(native, /publicView: \{ href: publicUrl, disabled: !published \|\| !publicUrl \}/);
});

test("the badge bubble retains the business essentials readiness signal", () => {
  assert.doesNotMatch(dashboardClientSource, /<ChannelConnectionsModal/);
  const workspace = readFileSync(new URL("../../app/dashboard/_components/DashboardChannelWorkspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /case "inrbadge"/);
  assert.match(workspace, /<NativeChannelSettingsContent[\s\S]*?initialStates=\{props\.nativeChannelStates\}/);
  assert.match(workspace, /companyName=\{props\.inrBadgeSettingsProps\.profile\.companyLegalName\}/);

});
