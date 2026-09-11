import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");

test("Business DNA keeps Admin at 16 and the latest migration sets every commercial edition to 3", () => {
  const quota = read("lib/businessDnaAnalysisQuota.ts");
  const route = read("app/api/ai-memory/analyze-channels/route.ts");
  const migration = read("ops/sql/2026-09-09_business_dna_plan_limits_4_admin_16.sql");
  const postflight = read(
    "ops/sql/2026-09-09_business_dna_plan_limits_4_admin_16_postflight_read_only.sql",
  );
  const currentMigration = read(
    "supabase/migrations/20260911190000_business_dna_automatic_analysis.sql",
  );

  assert.match(quota, /DashboardEdition \| "admin"/);
  assert.match(quota, /value === "founder" \|\| value === "admin"/);
  assert.match(quota, /params\.edition === "admin"/);
  assert.match(quota, /error\.code === "business_dna_quota_invalid_edition"/);
  assert.match(quota, /edition: "founder"/);
  assert.match(route, /isAdminUserForAi\(supabase, authUserId\)/);
  assert.match(route, /edition:\s*isAdmin \? "admin" : "standard"/);
  assert.match(route, /const quotaEdition: BusinessDnaAnalysisQuotaEdition = isAdmin \? "admin" : "standard"/);

  assert.match(migration, /check \(edition in \('standard', 'premium', 'founder', 'admin'\)\)/);
  assert.match(migration, /\('standard', 4\)/);
  assert.match(migration, /\('premium', 4\)/);
  assert.match(migration, /\('founder', 4\)/);
  assert.match(migration, /\('admin', 16\)/);
  assert.doesNotMatch(
    migration,
    /business_dna_analysis_monthly_usage\s+(?:set|values|delete|truncate)/i,
    "changing a plan limit must not erase the month's existing usage",
  );

  assert.match(postflight, /begin transaction read only;/i);
  assert.match(postflight, /edition = 'premium' and monthly_limit = 4/);
  assert.match(postflight, /edition = 'founder' and monthly_limit = 4/);
  assert.match(postflight, /edition = 'admin' and monthly_limit = 16/);

  assert.match(currentMigration, /\('standard', 3\)/);
  assert.match(currentMigration, /\('premium', 3\)/);
  assert.match(currentMigration, /\('founder', 3\)/);
  assert.match(currentMigration, /\('admin', 16\)/);
});
