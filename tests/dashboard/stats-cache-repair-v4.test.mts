import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("one shared V4 schema invalidates overview, summary signature and direct memory caches", () => {
  const schema = read("lib/stats/cacheSchema.ts");
  const overviewKey = read("lib/stats/buildOverview.connections.ts");
  const signature = read("lib/stats/connectionSignature.ts");
  const metrics = read("lib/metrics/computeMetrics.ts");

  assert.match(schema, /INRCY_STATS_CACHE_SCHEMA_VERSION = "v4-2026-08-12"/);
  assert.match(overviewKey, /cache_schema:\$\{INRCY_STATS_CACHE_SCHEMA_VERSION\}/);
  assert.match(signature, /"stats_cache_schema", INRCY_STATS_CACHE_SCHEMA_VERSION/);
  assert.match(metrics, /schema=\$\{INRCY_STATS_CACHE_SCHEMA_VERSION\}/);
});

test("the all-account SQL repair is idempotent and preserves recovery evidence", () => {
  const sql = read("ops/sql/2026-08-12_stats_oauth_account_repair_v4.sql");
  const cacheUpdate = sql.slice(
    sql.indexOf("update public.stats_cache"),
    sql.indexOf("-- Release today's daily lock"),
  );

  assert.match(sql, /where coalesce\(stats_cache_epoch, 0\) < 4/);
  assert.match(sql, /stats_cache_epoch = 4/);
  assert.match(sql, /alter column stats_cache_epoch set default 4/);
  assert.match(sql, /stats_version = coalesce\(profile_row\.stats_version, 0\) \+ 1/);
  assert.match(sql, /last_completed_snapshot_date = null/);

  for (const replaceable of ["overview", "metrics_summary", "linkedin_metrics"]) {
    assert.ok(cacheUpdate.includes(`'${replaceable}'`), `missing transient cache ${replaceable}`);
  }
  for (const protectedSource of [
    "overview_last_good",
    "linkedin_metrics_last_good",
    "linkedin_opportunity_last_good",
    "linkedin_quota_guard",
  ]) {
    assert.ok(!cacheUpdate.includes(`'${protectedSource}'`), `must preserve ${protectedSource}`);
  }
});

test("the repair reinstalls one realtime Stats authority for every channel family", () => {
  const sql = read("ops/sql/2026-08-12_stats_oauth_account_repair_v4.sql");
  const verify = read("ops/sql/2026-08-12_stats_oauth_account_repair_v4_verify.sql");

  for (const table of ["integrations", "inrcy_site_configs", "pro_tools_configs"]) {
    assert.match(sql, new RegExp(`public\\.${table}`));
    assert.match(verify, new RegExp(`'${table}'`));
  }
  assert.match(sql, /inrcy_bump_stats_version_from_user_id_v4/);
  assert.match(sql, /alter publication supabase_realtime add table public\.profiles/);
  assert.match(verify, /MIGRATION_APPLIED/);
});
