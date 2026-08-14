import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../ops/sql/2026-08-14_security_advisor_function_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const dailyStatsRoute = readFileSync(
  new URL("../../app/api/stats/daily-refresh/route.ts", import.meta.url),
  "utf8",
);

const searchPathFunctions = [
  "set_updated_at()",
  "enforce_max_4_mail_accounts()",
  "set_widget_domain_registry_updated_at()",
  "set_stats_snapshot_updated_at()",
  "cleanup_old_stats_snapshots()",
  "update_updated_at_column()",
  "normalize_widget_domain(text)",
  "set_notification_preferences_updated_at()",
  "is_staff()",
  "lock_inrcy_site_fields()",
  "set_execution_idempotency_locks_updated_at()",
  "set_pro_media_library_updated_at()",
  "touch_updated_at()",
];

const privateFunctions = [
  "cleanup_old_stats_snapshots()",
  "bump_profile_version(uuid,text)",
  "inrcy_bump_inrsend_for_agent_actions()",
  "inrcy_bump_inrsend_for_app_events()",
  "inrcy_bump_inrsend_for_mail_campaigns()",
  "inrcy_bump_inrsend_for_scheduled_actions()",
  "inrcy_bump_inrsend_for_send_items()",
  "inrcy_bump_inrsend_version(jsonb)",
  "inrcy_bump_publications_for_async_job_finalization()",
  "inrcy_bump_publications_for_delivery_deletes()",
  "inrcy_bump_publications_for_delivery_inserts()",
  "inrcy_bump_publications_for_delivery_updates()",
  "inrcy_bump_stats_version_from_user_id_v4()",
  "inrcy_patch_app_event_payload(uuid,uuid,text,jsonb)",
  "inrcy_provision_onboarding_state()",
  "inrcy_validate_media_job_scope()",
  "inrcy_validate_media_storage_scope()",
  "inrcy_validate_media_variant_scope()",
  "inrcy_validate_publication_workspace_media()",
];

test("legacy functions receive a fixed search_path", () => {
  assert.match(
    migration,
    /alter function %s set search_path = pg_catalog, public/i,
  );
  for (const signature of searchPathFunctions) {
    assert.match(migration, new RegExp(`public\\.${signature.replace(/[()]/g, "\\$&")}`));
  }
});

test("trigger-only and server-only functions leave the public API", () => {
  assert.match(
    migration,
    /revoke all on function %s from public, anon, authenticated/i,
  );
  assert.match(migration, /grant execute on function %s to service_role/i);
  for (const signature of privateFunctions) {
    assert.match(migration, new RegExp(`public\\.${signature.replace(/[()]/g, "\\$&")}`));
  }
});

test("authenticated business RPCs keep an explicit signed-in-only allow-list", () => {
  const privateSection = migration.slice(
    migration.indexOf("These functions are invoked"),
    migration.indexOf("These guarded RPCs"),
  );
  const guardedSection = migration.slice(migration.indexOf("These guarded RPCs"));
  const guardedFunctions = [
    "allocate_invoice_number",
    "claim_daily_stats_refresh",
    "complete_daily_stats_refresh",
    "release_daily_stats_refresh_claim",
    "inrcy_can_access_account",
    "inrcy_can_access_account_text",
    "inrcy_can_access_publication_workspace",
    "inrcy_create_establishment",
    "inrcy_save_onboarding_state",
  ];

  for (const signature of guardedFunctions) {
    assert.doesNotMatch(privateSection, new RegExp(`public\\.${signature}\\(`));
    assert.match(guardedSection, new RegExp(`public\\.${signature}\\(`));
  }
  assert.match(
    guardedSection,
    /revoke all on function %s from public, anon/i,
  );
  assert.match(
    guardedSection,
    /grant execute on function %s to authenticated, service_role/i,
  );
});

test("profile version bumps run only through the trusted server client", () => {
  assert.match(dailyStatsRoute, /import \{ supabaseAdmin \} from "@\/lib\/supabaseAdmin"/);
  assert.match(
    dailyStatsRoute,
    /supabaseAdmin\.rpc\("bump_profile_version"/,
  );
  assert.doesNotMatch(
    dailyStatsRoute,
    /supabase\.rpc\("bump_profile_version"/,
  );
});

test("future postgres functions are private-by-default", () => {
  assert.match(
    migration,
    /alter default privileges for role postgres in schema public\s+revoke execute on functions from anon, authenticated/i,
  );
});

test("pg_trgm leaves the exposed public schema", () => {
  assert.match(migration, /e\.extname = 'pg_trgm'/i);
  assert.match(migration, /e\.extrelocatable/i);
  assert.match(migration, /alter extension pg_trgm set schema extensions/i);
});
