import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = (file: string) => readFileSync(new URL("../../" + file, import.meta.url), "utf8");
test("the website cache cannot restore the retired channel", () => {
  const bootstrap = read("app/dashboard/dashboard.bootstrap-cache.ts");
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  assert.doesNotMatch(bootstrap, /site_inrcy|siteInrcy|SiteInrcy/);
  assert.doesNotMatch(dashboard, /site_inrcy|siteInrcy|SiteInrcy|inrcy_site_configs/);
  assert.ok(bootstrap.includes("DASHBOARD_CACHE_KEYS.channelState"));
  assert.ok(bootstrap.includes("DASHBOARD_CACHE_KEYS.siteProgress"));
});
test("the historical deep link redirects to Site Web", () => {
  const routing = read("app/dashboard/_hooks/useDashboardPanelRouting.ts");
  assert.ok(routing.includes('rawPanel === "site_inrcy"'));
  assert.ok(routing.includes('params.set("panel", rawPanel === "site_inrcy" ? "site_web" : "inr_search")'));
});
