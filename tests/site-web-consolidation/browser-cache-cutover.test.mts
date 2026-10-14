import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as cacheContract from "../../lib/dashboardCacheKeys.ts";
import { DASHBOARD_CHANNEL_KEYS } from "../../lib/dashboardChannels.ts";

const snapshotDate = "2026-10-11";
const syncedAt = Date.now();

function harness() {
  const storage = new Map<string, string>();
  const browserCache = {
    readAccountCacheValue: (key: string) => storage.get(key) ?? null,
    writeAccountCacheValue: (key: string, value: string) => storage.set(key, value),
    removeAccountCacheValue: (key: string) => storage.delete(key),
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/dashboardCacheKeys": cacheContract,
    "@/lib/browserAccountCache": browserCache,
    "@/lib/dashboardChannels": { DASHBOARD_CHANNEL_KEYS },
    "@/lib/stats/snapshotWindow": { getDefaultSnapshotDate: () => snapshotDate },
    "@/lib/inrstats/channelBlocks": {},
    "@/lib/generator/channelBlocks": {},
    "./stats.shared.core": { safeNum: (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback },
  };
  const load = <TExports extends object>(file: string): TExports => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const loaded = { exports: {} as TExports };
    vm.runInNewContext(compiled, {
      module: loaded, exports: loaded.exports, Date,
      require: (name: string) => {
        if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    }, { filename: file });
    return loaded.exports;
  };
  return {
    storage,
    generator: load<typeof import("../../app/dashboard/dashboard.client-cache.ts")>("app/dashboard/dashboard.client-cache.ts"),
    stats: load<typeof import("../../app/dashboard/stats/stats.shared.cache.ts")>("app/dashboard/stats/stats.shared.cache.ts"),
    checks: load<typeof import("../../lib/dailyStatsRefreshClient.ts")>("lib/dailyStatsRefreshClient.ts"),
  };
}

function currentGenerator() {
  return { syncedAt, snapshotDate, payload: { leads: { today: 1, week: 2, month: 3 }, details: { opportunities: { month: 12 } }, generatorBlocks: { site_web: { opportunities: { month: 12 } } } } };
}

function currentCube() {
  return {
    syncedAt, snapshotDate,
    overviews: Object.fromEntries(DASHBOARD_CHANNEL_KEYS.map((key) => [key, { meta: { snapshotDate } }])),
    blocks: Object.fromEntries(DASHBOARD_CHANNEL_KEYS.map((key) => [key, { capturedLeads: { week: 1, month: 2 } }])),
  };
}

test("same-day generator totals and freshness ignore the old cache namespace", () => {
  const { storage, generator } = harness();
  storage.set("inrcy_generator_kpis_v1", JSON.stringify(currentGenerator()));
  storage.set("inrcy_opp30_total_v1", "999");
  assert.equal(generator.readGeneratorCache(), null);
  assert.equal(generator.getInitialOppTotal(), null);
  assert.equal(generator.hasFreshLocalGeneratorSnapshot(), false);

  storage.set(cacheContract.DASHBOARD_CACHE_KEYS.generatorKpis, JSON.stringify(currentGenerator()));
  assert.equal(generator.getInitialOppTotal(), 12);
  assert.equal(generator.hasFreshLocalGeneratorSnapshot(), true);
});

test("a copied generator snapshot with the retired cube still forces refresh", () => {
  const { storage, generator } = harness();
  const stale = currentGenerator();
  (stale.payload.generatorBlocks as Record<string, unknown>).site_inrcy = { opportunities: { month: 987 } };
  storage.set(cacheContract.DASHBOARD_CACHE_KEYS.generatorKpis, JSON.stringify(stale));
  assert.equal(generator.readGeneratorCache(), null);
  assert.equal(generator.hasFreshLocalGeneratorSnapshot(), false);
});

test("same-day Stats cube and summary snapshots require the current namespace and catalogue", () => {
  const { storage, stats } = harness();
  const cube = currentCube();
  const summary = { syncedAt, snapshotDate, total: 12, byCube: { site_web: 12 } };
  storage.set("inrcy_stats_cube_snapshot_v1:30", JSON.stringify(cube));
  storage.set("inrcy_stats_summary_snapshot_v2:30", JSON.stringify(summary));
  assert.equal(stats.hasFreshLocalPeriodSnapshot(30), false);
  assert.equal(stats.getLocalPeriodSyncAt(30), 0);

  storage.set(stats.cubeSessionKey(30), JSON.stringify(cube));
  storage.set(stats.summarySessionKey(30), JSON.stringify(summary));
  assert.equal(stats.hasFreshLocalPeriodSnapshot(30), true);
  assert.equal(stats.getLocalPeriodSyncAt(30), syncedAt);

  const stale = { ...summary, total: 999, byCube: { site_web: 12, site_inrcy: 987 } };
  storage.set(stats.summarySessionKey(30), JSON.stringify(stale));
  assert.equal(stats.parseCachedSummarySnapshot(JSON.stringify(stale)), null);
  assert.equal(stats.hasFreshLocalPeriodSnapshot(30), false);
  assert.equal(stats.parseCachedCubeSnapshot(JSON.stringify({ ...cube, overviews: { ...cube.overviews, site_inrcy: {} } })), null);
});

test("old daily and server check markers cannot skip a same-day refresh after cutover", () => {
  const { storage, checks } = harness();
  const marker = JSON.stringify({ checkedAt: Date.now(), snapshotDate, syncAt: syncedAt });
  storage.set("inrcy_daily_stats_bootstrap_ui_v1", marker);
  storage.set("inrcy_dashboard_server_cache_check_ui_v1", marker);
  storage.set("inrcy_stats_server_cache_check_ui_v1", marker);
  assert.equal(checks.wasDailyStatsRefreshBootstrapCheckedRecently(), false);
  assert.equal(checks.wasServerCacheSyncCheckedRecently("dashboard", { ttlMs: 60_000 }), false);
  assert.equal(checks.wasServerCacheSyncCheckedRecently("stats", { ttlMs: 60_000 }), false);

  checks.markDailyStatsRefreshBootstrapChecked();
  checks.markServerCacheSyncChecked("dashboard");
  assert.equal(checks.wasDailyStatsRefreshBootstrapCheckedRecently(), true);
  assert.equal(checks.wasServerCacheSyncCheckedRecently("dashboard", { ttlMs: 60_000 }), true);
});
