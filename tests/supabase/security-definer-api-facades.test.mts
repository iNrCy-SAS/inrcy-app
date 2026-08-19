import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../ops/sql/2026-08-19_security_definer_api_facades.sql",
    import.meta.url,
  ),
  "utf8",
);

const invokerFunctions = [
  "claim_daily_stats_refresh\\(uuid, date, integer\\)",
  "complete_daily_stats_refresh\\(uuid, date\\)",
  "release_daily_stats_refresh_claim\\(uuid, date\\)",
  "inrcy_can_access_account\\(uuid\\)",
  "inrcy_can_access_account_text\\(text\\)",
  "inrcy_can_access_publication_workspace\\(uuid\\)",
];

const privateImplementations = [
  "allocate_invoice_number",
  "inrcy_create_establishment",
  "inrcy_save_onboarding_state",
];

test("RPCs that already operate through RLS no longer elevate the caller", () => {
  for (const signature of invokerFunctions) {
    assert.match(
      migration,
      new RegExp(`alter function public\\.${signature}\\s+security invoker`, "i"),
    );
  }
});

test("genuinely privileged implementations move behind public INVOKER facades", () => {
  assert.match(migration, /create schema if not exists private/i);
  assert.match(migration, /alter function %s set schema private/i);
  assert.match(migration, /grant usage on schema private to authenticated, service_role/i);

  for (const functionName of privateImplementations) {
    assert.match(
      migration,
      new RegExp(`private\\.${functionName}\\(`),
    );
    assert.match(
      migration,
      new RegExp(`create or replace function public\\.${functionName}\\(`),
    );
  }

  const facadeDefinitions = migration.slice(
    migration.indexOf("-- Stable public RPC contracts"),
  );
  assert.equal((facadeDefinitions.match(/security invoker/gi) || []).length, 3);
  assert.doesNotMatch(facadeDefinitions, /security definer/i);
});

test("private implementations and public facades use an explicit role allow-list", () => {
  assert.match(
    migration,
    /revoke all on function private\.allocate_invoice_number\(uuid\)[\s\S]*from public, anon/i,
  );
  assert.match(
    migration,
    /grant execute on function private\.allocate_invoice_number\(uuid\)[\s\S]*to authenticated, service_role/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.allocate_invoice_number\(uuid\)[\s\S]*from public, anon/i,
  );
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,120}\bto anon\b/i);
});

test("migration refuses missing, non-definer, or ambiguous implementations", () => {
  assert.match(migration, /Required function % is missing/i);
  assert.match(migration, /is not the expected SECURITY DEFINER implementation/i);
  assert.match(migration, /Private function % must remain SECURITY DEFINER/i);
  assert.match(migration, /Ambiguous public SECURITY DEFINER function % still exists/i);
});
