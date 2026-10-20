import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261020115439_password_email_link_preflight.sql", import.meta.url), "utf8");
const USER = "00000000-0000-4000-8000-000000000001";
const TOKEN = "a".repeat(64);
type Status = { valid: boolean; expires_at?: string };

async function fixture() {
  const db = new PGlite();
  try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, confirmation_sent_at timestamptz,
      recovery_sent_at timestamptz, banned_until timestamptz, deleted_at timestamptz);
    create table auth.one_time_tokens(user_id uuid, token_type text, token_hash text, expires_at timestamptz);
    grant usage on schema public to service_role;
  `);
  await db.exec(migration);
  // Applying a migration twice must not widen grants or alter Auth state.
  await db.exec(migration);
  await db.query("insert into auth.users(id,email,confirmation_sent_at,recovery_sent_at) values($1,'invitee@example.com',now(),now())", [USER]);
  await db.query("insert into auth.one_time_tokens values($1,'confirmation_token',$2,now()+interval '24 hours')", [USER, TOKEN]);
  return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function check(db: PGlite, token = TOKEN, mode = "invite", email: string | null = "invitee@example.com") {
  const result = await db.query<{ status: Status }>("select public.inrcy_password_link_status($1,$2,$3) as status", [token, mode, email]);
  return result.rows[0].status;
}

test("preflight is repeatable, leaves Auth untouched and only returns validity and expiry", async () => {
  const db = await fixture();
  try {
    const before = await db.query("select * from auth.one_time_tokens");
    await db.exec("set role service_role");
    for (let i = 0; i < 3; i++) {
      const result = await check(db);
      assert.equal(result.valid, true);
      assert.deepEqual(Object.keys(result).sort(), ["expires_at", "valid"]);
      assert.ok(Date.parse(result.expires_at!) > Date.now());
    }
    await db.exec("reset role");
    assert.deepEqual((await db.query("select * from auth.one_time_tokens")).rows, before.rows);
  } finally { await db.close(); }
});

test("expired, consumed and replaced links are rejected before password entry", async () => {
  const db = await fixture();
  try {
    await db.exec("update auth.users set confirmation_sent_at=now()-interval '24 hours'");
    assert.deepEqual(await check(db), { valid: false });
    await db.exec("update auth.users set confirmation_sent_at=now()");
    await db.query("update auth.one_time_tokens set token_hash=$1", ["b".repeat(64)]);
    assert.deepEqual(await check(db), { valid: false });
    assert.equal((await check(db, "b".repeat(64))).valid, true);
    await db.exec("delete from auth.one_time_tokens");
    assert.deepEqual(await check(db, "b".repeat(64)), { valid: false });
  } finally { await db.close(); }
});

test("Auth's shorter expiry wins and preflight never extends a token beyond 24 hours", async () => {
  const db = await fixture();
  try {
    await db.exec("update auth.one_time_tokens set expires_at=now()-interval '1 second'");
    assert.deepEqual(await check(db), { valid: false });
    await db.exec("update auth.one_time_tokens set expires_at=null");
    assert.equal((await check(db)).valid, true, "older Auth rows fall back to the configured 24-hour sent time");
    await db.exec("update auth.users set confirmation_sent_at=null");
    assert.deepEqual(await check(db), { valid: false });
    await db.exec("update auth.users set confirmation_sent_at=now()-interval '25 hours'; update auth.one_time_tokens set expires_at=now()+interval '1 year'");
    assert.deepEqual(await check(db), { valid: false });
  } finally { await db.close(); }
});

test("mode, expected email, bans and deleted accounts cannot be bypassed", async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await check(db, TOKEN, "reset"), { valid: false });
    assert.deepEqual(await check(db, TOKEN, "invite", "other@example.com"), { valid: false });
    assert.deepEqual(await check(db, "too-short"), { valid: false });
    assert.deepEqual(await check(db, TOKEN, "signup"), { valid: false });
    assert.equal((await check(db, TOKEN, "invite", " INVITEE@EXAMPLE.COM ")).valid, true);
    await db.exec("update auth.one_time_tokens set token_type='recovery_token'");
    assert.equal((await check(db, TOKEN, "reset")).valid, true);
    await db.exec("update auth.users set banned_until=now()+interval '1 day'");
    assert.deepEqual(await check(db, TOKEN, "reset"), { valid: false });
    await db.exec("update auth.users set banned_until=null,deleted_at=now()");
    assert.deepEqual(await check(db, TOKEN, "reset"), { valid: false });
  } finally { await db.close(); }
});

test("browser roles cannot call either RPC and the server cannot read raw Auth tables", async () => {
  const db = await fixture();
  try {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(check(db), /permission denied/);
      await assert.rejects(db.query("select inrcy_auth_private.password_link_status($1,'invite',null)", [TOKEN]), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    assert.equal((await check(db)).valid, true);
    await assert.rejects(db.query("select * from auth.users"), /permission denied/);
    await assert.rejects(db.query("select * from auth.one_time_tokens"), /permission denied/);
  } finally { await db.close(); }
});
