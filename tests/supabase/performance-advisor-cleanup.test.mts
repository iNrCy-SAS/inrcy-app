import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../ops/sql/2026-08-19_performance_advisor_cleanup.sql",
    import.meta.url,
  ),
  "utf8",
);

const initPlanPolicies = [
  "inrcy_account_members_select_self",
  "inrcy_multi_account_config_select_self",
  "mobile_shortcuts_select_own_membership",
  "mobile_shortcuts_insert_own_membership",
  "subscriptions_select_own",
  "mailbox_reputation_state_select_own",
  "publication_workspaces_insert_accessible",
];

const redundantConstraints = [
  "business_profiles_user_id_unique",
  "inrcy_site_configs_user_id_unique",
  "pro_tools_configs_user_id_unique",
  "profiles_user_id_unique",
  "subscriptions_user_id_unique",
];

const duplicateIndexesToDrop = [
  "idx_crm_contacts_user_created_at",
  "idx_crm_contacts_user_id",
  "idx_crm_contacts_user_phone",
  "idx_daily_metrics_summary_user_snapshot_date",
  "idx_integrations_user_id",
  "loyalty_ledger_unique_source",
  "idx_notifications_user_created_at",
  "idx_publication_deliveries_pub",
  "idx_publications_user_id",
  "idx_site_articles_user_id",
  "stats_cache_lookup",
  "stats_cache_user_source_range_unique",
];

test("all seven init-plan warnings are replaced with cached auth.uid calls", () => {
  for (const policy of initPlanPolicies) {
    assert.match(migration, new RegExp(`drop policy if exists ${policy}`, "i"));
    assert.match(migration, new RegExp(`create policy ${policy}`, "i"));
  }

  assert.ok((migration.match(/\(select auth\.uid\(\)\)/g) || []).length >= 9);
  const withoutComments = migration
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(withoutComments, /(?<!select )auth\.uid\(\)/);
});

test("boutique order access keeps the same OR semantics in one policy", () => {
  assert.match(migration, /drop policy if exists staff_select_all_orders/i);
  assert.match(migration, /drop policy if exists users_select_own_orders/i);
  assert.match(migration, /create policy boutique_orders_select_authorized/i);
  assert.match(
    migration,
    /public\.is_staff\(\)[\s\S]{0,100}\bor\b[\s\S]{0,100}public\.inrcy_can_access_account\(user_id\)/i,
  );
});

test("redundant UNIQUE constraints are removed only behind equivalent primary keys", () => {
  for (const constraint of redundantConstraints) {
    assert.match(migration, new RegExp(constraint));
  }
  assert.match(migration, /v_primary\.contype <> 'p'/i);
  assert.match(migration, /v_redundant\.contype <> 'u'/i);
  assert.match(migration, /v_primary\.conkey is distinct from v_redundant\.conkey/i);
  assert.match(migration, /alter table %s drop constraint %I/i);
});

test("exact duplicate indexes retain one verified equivalent index", () => {
  assert.equal(duplicateIndexesToDrop.length, 12);
  for (const index of duplicateIndexesToDrop) {
    assert.match(migration, new RegExp(`public\\.${index.replaceAll("_", "_")}`));
  }

  for (const semanticCheck of [
    "indrelid",
    "indisunique",
    "indisexclusion",
    "indnkeyatts",
    "indnatts",
    "indkey",
    "indcollation",
    "indclass",
    "indoption",
    "indexprs",
    "indpred",
  ]) {
    assert.match(migration, new RegExp(semanticCheck));
  }
  assert.match(migration, /Indexes % and % are no longer exact duplicates/i);
  assert.match(migration, /drop index %s/i);
});
