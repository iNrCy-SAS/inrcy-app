import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("X is a first-class Dashboard bubble gated by Bubble Access", () => {
  const constants = read("app/dashboard/dashboard.constants.ts");
  const bubbles = read("app/dashboard/dashboard.flux-bubbles.ts");
  const client = read("app/dashboard/DashboardClient.tsx");
  const access = read("lib/bubbleAccess.ts");

  assert.match(constants, /import xBubbleIcon from "\.\.\/\.\.\/public\/icons\/x\.svg"/);
  assert.match(constants, /key: "x",[\s\S]*?name: "X"/);
  assert.match(constants, /x: "Configuration — X"/);
  assert.match(access, /x: false/);
  assert.match(bubbles, /isBubbleEnabled\(bubbleAccessMap, bubbleKey\)/);
  assert.match(bubbles, /m\.key === "x"[\s\S]*?xConnected/);
  assert.match(client, /const canAccessX = isBubbleEnabled\(bubbleAccessMap, "x"\)/);
  assert.match(client, /xAccessEnabled=\{canAccessX\}/);
});

test("X configuration owns status, OAuth start and disconnect actions", () => {
  const drawer = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const routing = read("app/dashboard/_hooks/useDashboardPanelRouting.ts");
  const panel = read("app/dashboard/settings/_components/XSettingsContent.tsx");

  assert.match(routing, /\| "x"/);
  assert.match(drawer, /panel === "x" && xAccessEnabled && <XSettingsContent/);
  assert.match(panel, /fetch\("\/api\/integrations\/x\/status"/);
  assert.match(panel, /\/api\/integrations\/x\/start\?returnTo=/);
  assert.match(panel, /fetch\("\/api\/integrations\/x\/disconnect", \{ method: "POST" \}\)/);
  assert.match(panel, /inrcy:x-settings-updated/);
  assert.match(panel, /X facture son API à l'usage/);
  assert.match(panel, /publication contenant un lien peut coûter nettement plus cher/);
});
