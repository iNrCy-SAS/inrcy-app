import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assistantCodeIndexSource, readAssistantCodeInventory } from "../../scripts/build-assistant-code-index.mjs";

test("the assistant source index matches the current application rather than a stale release", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const current = readAssistantCodeInventory(root);
  const saved = readFileSync(new URL("../../lib/inrAssistantCodeIndex.generated.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(saved, assistantCodeIndexSource(current), "Review changed guides and regenerate the assistant code index before release.");
  assert.ok(current.sourceFileCount > 1000);
  for (const route of ["/dashboard", "/dashboard/mediatheque", "/dashboard/booster", "/dashboard/stats", "/dashboard/configuration-ia"]) assert.ok(current.dashboardPages.includes(route), route);
  assert.ok(current.dashboardPages.every((route) => !route.startsWith("/dashboard/admin")));
  assert.ok(current.literalDashboardLinks.every((route) => route.startsWith("/dashboard") && !/(?:secret|token|password|signature)=/i.test(route)));
});
