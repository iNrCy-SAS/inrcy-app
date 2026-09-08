import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createOperationScopedLoader } from "../../lib/stats/operationScopedLoader.ts";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("an operation-scoped loader coalesces concurrent and sequential consumers", async () => {
  let loads = 0;
  const load = createOperationScopedLoader(async () => {
    loads += 1;
    await Promise.resolve();
    return { marker: Symbol("activity") };
  });

  const [first, second, third] = await Promise.all([load(), load(), load()]);
  const fourth = await load();

  assert.equal(loads, 1);
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  assert.strictEqual(third, fourth);
});

test("cube overviews share one lazy publication-activity loader", () => {
  const activity = read("lib/stats/buildOverview.activity.ts");
  const overview = read("lib/stats/buildOverview.ts");
  const metrics = read("lib/metrics/computeMetrics.ts");

  assert.match(activity, /createOperationScopedLoader\(\(\) => loadInrcyPublishedActivityStats/);
  assert.match(overview, /args\.inrcyPublishedActivityLoader\?\.\(\)/);
  assert.match(
    metrics,
    /const inrcyPublishedActivityLoader =[\s\S]*?createInrcyPublishedActivityLoader\(\{ supabase, userId \}\)[\s\S]*?CUBES\.map/,
  );
  assert.match(metrics, /buildStatsOverview\(\{[\s\S]*?inrcyPublishedActivityLoader,[\s\S]*?\}\)/);
});

test("multi-period server operations propagate the same loader and keep it request-local", () => {
  const bulk = read("app/api/stats/dashboard-bulk/route.ts");
  const refresh = read("app/api/stats/daily-refresh/route.ts");
  const summary = read("lib/metrics/summary.ts");
  const helper = read("lib/stats/operationScopedLoader.ts");

  for (const source of [bulk, refresh, summary]) {
    assert.match(source, /const inrcyPublishedActivityLoader = createInrcyPublishedActivityLoader/);
    assert.ok(
      (source.match(/\binrcyPublishedActivityLoader\b/g) || []).length >= 3,
      "the operation must pass its one loader to every period load",
    );
  }

  assert.doesNotMatch(helper, /globalThis|new Map|new WeakMap|unstable_cache/);
});
