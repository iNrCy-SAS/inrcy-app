import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const dashboard = read("app/dashboard/DashboardClient.tsx");
const profileBridge = read("app/dashboard/_components/ProfileRealtimeBridge.tsx");

test("dashboard connection realtime is scoped to the active account", () => {
  for (const table of ["integrations", "pro_tools_configs"]) {
    assert.match(
      dashboard,
      new RegExp(`table: "${table}", filter: userFilter`),
      `${table} must use the active account filter`,
    );
  }
  assert.match(dashboard, /const userFilter = `user_id=eq\.\$\{userId\}`/);
  assert.match(dashboard, /const isSafeUserId =/);
  assert.doesNotMatch(
    dashboard,
    /\.channel\(`inrcy-generator-sync:[\s\S]*?table: "profiles"/,
    "ProfileRealtimeBridge owns the single profile subscription",
  );
});

test("dashboard realtime sleeps in hidden tabs and reconciles on return", () => {
  assert.match(dashboard, /document\.visibilityState === "hidden"/);
  assert.match(dashboard, /removeRealtimeChannel\(\)/);
  assert.match(dashboard, /refreshAfterVisibilityRestore = true/);
  assert.match(
    dashboard,
    /if \(refreshAfterVisibilityRestore\)[\s\S]*?latestFallbackToServerSyncThenGlobalRef\.current/,
  );
  assert.match(dashboard, /ACTIVE_INRCY_ACCOUNT_EVENT/);
});

test("profile bridge polls only as a visible-tab realtime recovery fallback", () => {
  assert.match(profileBridge, /filter: `user_id=eq\.\$\{userId\}`/);
  assert.match(
    profileBridge,
    /if \(document\.visibilityState === "hidden" \|\| channelHealthy\) return/,
  );
  assert.match(
    profileBridge,
    /channelHealthy = status === "SUBSCRIBED";[\s\S]*?stopPolling\(\)/,
  );
  assert.match(
    profileBridge,
    /document\.visibilityState === "hidden"[\s\S]*?stopPolling\(\);[\s\S]*?stopRealtime\(\)/,
  );
  assert.match(profileBridge, /void activate\(true\)/);
});
