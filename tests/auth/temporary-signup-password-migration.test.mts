import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(new URL("../../supabase/migrations/20261026091546_temporary_signup_passwords.sql", import.meta.url), "utf8");
const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const WELCOME = "00000000-0000-4000-8000-000000000003";
const NOW = "2026-10-26T12:00:00.000Z";
const EXPIRES = "2026-11-25T12:00:00.000Z";

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin; create schema auth;
      create table auth.users(id uuid primary key, raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', encrypted_password text);
      create table auth.audit_log_entries(id uuid primary key default gen_random_uuid(), payload jsonb);
      grant usage on schema auth to supabase_auth_admin;
      grant select,update on auth.users to supabase_auth_admin;
      grant insert on auth.audit_log_entries to supabase_auth_admin;
      grant usage on schema public to service_role;`);
    await db.exec(sql);
    await db.exec(sql);
    return db;
  } catch (error) { await db.close(); throw error; }
}

function event(method = "password", more: Record<string, unknown> = {}) {
  return { user_id: USER, authentication_method: method, claims: { sub: USER, exp: Date.parse(EXPIRES) / 1000 + 3600, role: "authenticated", ...more } };
}
async function policy(db: PGlite, metadata: unknown, at = NOW, input = event()) {
  const result = await db.query<{ result: { claims?: Record<string, unknown>; error?: { http_code: number; message: string } } }>(
    "select inrcy_signup_private.temporary_password_claims($1::jsonb,$2::jsonb,$3::timestamptz) result", [JSON.stringify(input), JSON.stringify(metadata), at]);
  return result.rows[0].result;
}
const metadata = { version: 1, welcome_id: WELCOME, issued_at: NOW, expires_at: EXPIRES };

test("temporary credential is accepted before day30, expires at exact boundary, and caps existing token expiry", async () => {
  const db = await fixture();
  try {
    assert.equal((await policy(db, metadata)).claims?.exp, Date.parse(EXPIRES) / 1000);
    assert.ok((await policy(db, metadata, "2026-11-25T11:59:59.999Z")).claims);
    assert.match((await policy(db, metadata, EXPIRES)).error?.message || "", /temporary_password_expired/);
    assert.equal((await policy(db, metadata, "2026-11-26T12:00:00Z", event("token_refresh"))).error?.http_code, 403);
    const short = event("password", { exp: Date.parse(NOW) / 1000 + 600 });
    assert.equal((await policy(db, metadata, NOW, short)).claims?.exp, short.claims.exp);
  } finally { await db.close(); }
});

test("existing normal accounts are unchanged and malformed temporary state cannot extend access", async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await policy(db, null), { claims: event().claims });
    assert.equal((await policy(db, { version: 1, expires_at: "bad" })).error?.http_code, 403);
    assert.equal((await policy(db, { ...metadata, version: 2 })).error?.http_code, 403);
  } finally { await db.close(); }
});

test("verified recovery is allowed after expiry for at most30 minutes, including refresh", async () => {
  const db = await fixture();
  try {
    const at = "2026-11-26T12:00:00Z";
    const start = Date.parse(at) / 1000;
    const recovery = await policy(db, metadata, at, event("recovery", { exp: start + 3600 }));
    assert.equal(recovery.claims?.exp, start + 1800);
    for (const method of ["otp", "magiclink"]) {
      assert.equal((await policy(db, metadata, at, event(method, { exp: start + 3600 }))).claims?.exp, start + 1800);
      assert.ok((await policy(db, metadata, at, event("token_refresh", { exp: start + 3600, amr: [{ method, timestamp: start }] }))).claims);
    }
    const refresh = event("token_refresh", { exp: start + 3600, amr: [{ method: "recovery", timestamp: start }] });
    assert.ok((await policy(db, metadata, at, refresh)).claims);
    assert.ok((await policy(db, metadata, "2026-11-26T12:30:00Z", refresh)).error);
    assert.ok((await policy(db, metadata, at, event("token_refresh", { amr: [{ method: "password", timestamp: start }] }))).error);
  } finally { await db.close(); }
});

test("token hook reads canonical account state instead of forged or stale JWT metadata", async () => {
  const db = await fixture();
  try {
    await db.query("insert into auth.users(id,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3)", [USER, JSON.stringify({ inrcy_temporary_password: { ...metadata, expires_at: "2001-01-01T00:00:00Z" } }), "{}"]);
    await db.exec("set role supabase_auth_admin");
    const result = await db.query<{ result: { error?: unknown } }>("select public.inrcy_temporary_password_access_token_hook($1::jsonb) result", [JSON.stringify(event("password", { app_metadata: {} }))]);
    assert.ok(result.rows[0].result.error);
    await db.exec("reset role");
    await db.query("update auth.users set raw_app_meta_data='{}',raw_user_meta_data=$2 where id=$1", [USER, JSON.stringify({ inrcy_temporary_password: metadata })]);
    await db.exec("set role supabase_auth_admin");
    const normal = await db.query<{ result: { claims?: unknown } }>("select public.inrcy_temporary_password_access_token_hook($1::jsonb) result", [JSON.stringify(event())]);
    assert.ok(normal.rows[0].result.claims);
  } finally { await db.close(); }
});

test("native password-change event clears only that account; login/hash upgrade does not remove expiry", async () => {
  const db = await fixture();
  try {
    await db.query("insert into auth.users(id,raw_app_meta_data) values($1,$3),($2,$3)", [USER, OTHER, JSON.stringify({ unrelated: "keep", inrcy_temporary_password: metadata })]);
    await db.query("insert into public.signup_welcome_credentials(id,user_id,recipient_email,app_language,encrypted_password,expires_at) values($1,$2,'synthetic@example.com','fr',$3,now()+interval '30 days')", [WELCOME, USER, "x".repeat(64)]);
    await db.exec("set role supabase_auth_admin");
    await db.query("update auth.users set encrypted_password='upgraded-hash' where id=$1", [USER]);
    await db.query("insert into auth.audit_log_entries(payload) values($1)", [JSON.stringify({ action: "login", actor_id: USER })]);
    assert.ok((await db.query<{ raw_app_meta_data: Record<string, unknown> }>("select raw_app_meta_data from auth.users where id=$1", [USER])).rows[0].raw_app_meta_data.inrcy_temporary_password);
    await db.query("insert into auth.audit_log_entries(payload) values($1)", [JSON.stringify({ action: "user_updated_password", actor_id: USER })]);
    assert.deepEqual((await db.query<{ raw_app_meta_data: unknown }>("select raw_app_meta_data from auth.users where id=$1", [USER])).rows[0].raw_app_meta_data, { unrelated: "keep" });
    assert.ok((await db.query<{ raw_app_meta_data: Record<string, unknown> }>("select raw_app_meta_data from auth.users where id=$1", [OTHER])).rows[0].raw_app_meta_data.inrcy_temporary_password);
    await db.exec("reset role");
    assert.equal((await db.query<{ encrypted_password: null }>("select encrypted_password from public.signup_welcome_credentials")).rows[0].encrypted_password, null);
  } finally { await db.close(); }
});

test("anon and authenticated have no access to credentials, hook or policy; worker only claims ready unexpired rows", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.signup_welcome_credentials"), /permission denied/);
      await assert.rejects(db.query("select public.inrcy_temporary_password_access_token_hook('{}')"), /permission denied/);
      await assert.rejects(db.query("select public.claim_signup_welcome_credentials(1)"), /permission denied/);
      await db.exec("reset role");
    }
    await db.query("insert into auth.users(id) values($1)", [USER]);
    await db.query("insert into public.signup_welcome_credentials(id,user_id,recipient_email,app_language,encrypted_password,expires_at) values($1,$2,'synthetic@example.com','fr',$3,now()+interval '30 days')", [WELCOME, USER, "x".repeat(64)]);
    await db.exec("set role service_role");
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)")).rows.length, 0);
    await db.query("update public.signup_welcome_credentials set ready_at=now() where id=$1", [WELCOME]);
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)")).rows.length, 1);
    assert.equal((await db.query("select * from public.claim_signup_welcome_credentials(10)")).rows.length, 0, "active lease prevents another worker claim");
  } finally { await db.close(); }
});
