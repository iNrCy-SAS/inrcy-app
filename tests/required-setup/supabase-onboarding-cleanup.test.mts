import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../../ops/sql/2026-09-01_remove_dashboard_onboarding.sql",
  import.meta.url,
);

test("the Supabase teardown rewires provisioning before removing onboarding data", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const coreFunction = sql.indexOf("private.inrcy_ensure_account_core(");
  const authTriggerRewire = sql.indexOf("create or replace function public.inrcy_provision_auth_account()");
  const establishmentRewire = sql.indexOf("create or replace function private.inrcy_create_establishment");
  const tableDrop = sql.indexOf("drop table if exists public.inrcy_onboarding_states;");

  assert.ok(coreFunction >= 0);
  assert.ok(authTriggerRewire > coreFunction);
  assert.ok(establishmentRewire > authTriggerRewire);
  assert.ok(tableDrop > establishmentRewire);
  assert.match(sql, /returns void/i);
  assert.match(sql, /perform private\.inrcy_ensure_account_core/i);
  assert.doesNotMatch(sql, /drop table[^;]+cascade/i);
});

test("the Supabase teardown removes every obsolete runtime object explicitly", async () => {
  const sql = await readFile(migrationPath, "utf8");

  for (const expected of [
    "inrcy_provision_onboarding_state_after_insert",
    "public.inrcy_provision_onboarding_state()",
    "public.inrcy_ensure_account_onboarding_state(uuid)",
    "public.inrcy_save_onboarding_state(uuid, text, text, smallint)",
    "private.inrcy_ensure_account_provisioning(uuid, uuid, text, boolean)",
    "private.inrcy_ensure_account_onboarding(uuid)",
    "private.inrcy_save_onboarding_state(uuid, text, text, smallint)",
    "public.inrcy_onboarding_states",
  ]) {
    assert.ok(sql.includes(expected), `missing explicit teardown for ${expected}`);
  }

  assert.match(sql, /INRCY_AUTH_PROVISIONING_TRIGGER_MISSING/);
  assert.match(sql, /INRCY_ACCOUNT_PROVISIONING_REWIRE_FAILED/);
});
