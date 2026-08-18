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
    /readCachedDashboardOptionalBoolean\("inrBadgeProfileReady"\)/,
  );
  assert.match(
    dashboardClientSource,
    /profileCheckReady \|\| lastKnownInrBadgeProfileReady !== null/,
  );
  assert.match(
    dashboardClientSource,
    /profileCheckReady[\s\S]*\? !profileIncomplete[\s\S]*: lastKnownInrBadgeProfileReady === true/,
  );
  assert.match(
    dashboardClientSource,
    /mergeCachedDashboardChannelState\(\{ inrBadgeProfileReady: nextReady \}\)/,
  );
});

test("iNrBadge still falls back to synchronization only when no known state exists", () => {
  assert.match(
    fluxBubblesSource,
    /if \(!inrBadgeProfileCheckReady\) \{[\s\S]*text: copy\.status\.syncing/,
  );
  assert.equal(dashboardMessages.status.syncing, "Synchronisation…");
  assert.match(
    dashboardClientSource,
    /inrBadgeProfileCheckReady,/,
  );
});

test("iNrBadge actions stay disabled only while neither cache nor profile check is ready", () => {
  assert.match(
    fluxBubblesSource,
    /\(m\.key === "inrbadge" \? !inrBadgeProfileCheckReady : false\)/,
  );
  assert.match(
    fluxBubblesSource,
    /if \(m\.key === "inrbadge"\) \{[\s\S]*if \(!inrBadgeProfileCheckReady\) return;/,
  );
});
