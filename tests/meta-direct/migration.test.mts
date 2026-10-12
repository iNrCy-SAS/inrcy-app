/* eslint-disable @typescript-eslint/no-explicit-any -- SQL JSON fixtures retain their heterogeneous runtime shapes. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const HARD_ADMIN = "670b527d-5e08-42b4-ba95-e58e812339eb";
const sql = readFileSync(new URL("../../supabase/migrations/20261012115509_meta_direct_channels_admin_pilot.sql", import.meta.url), "utf8");
async function rows(db: PGlite, query: string, args: unknown[] = []) { return (await db.query<Record<string, any>>(query, args)).rows; }
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.profiles(user_id uuid primary key, role text, stats_version integer default 0, stats_cache_epoch integer default 0);
    create table public.app_bubble_access(user_id uuid,bubble_key text,enabled boolean,updated_at timestamptz default now(),primary key(user_id,bubble_key));
    create table public.pro_tools_configs(user_id uuid primary key,settings jsonb,updated_at timestamptz default now());
    create table public.integrations(id uuid primary key default gen_random_uuid(),user_id uuid,provider text,category text,source text,product text,status text,resource_id text,resource_label text,display_name text,access_token_enc text,refresh_token_enc text,expires_at timestamptz,scope text,meta jsonb,updated_at timestamptz default now(),unique(user_id,provider,source,product));
    create function public.create_default_bubble_access() returns trigger language plpgsql as $$ begin return new; end; $$;
    create trigger default_bubbles after insert on public.profiles for each row execute function public.create_default_bubble_access();
    insert into public.profiles(user_id,role) values ('${ADMIN}','admin'),('${USER}','user'),('${HARD_ADMIN}','user');
    insert into public.app_bubble_access(user_id,bubble_key,enabled) values ('${ADMIN}','facebook',true),('${USER}','facebook',true);
    insert into public.pro_tools_configs(user_id,settings) values ('${ADMIN}','{"instagram":{"publicationPreferences":{"reels":true},"connected":true},"threads":{"publicationPreferences":{"reply_control":"followers_only"}},"site_web":{"url":"https://preserved.example"},"generalPreferences":{"language":"fr-FR"}}'),('${USER}','{"site_web":{"url":"https://user.example"}}');
    insert into public.integrations(user_id,provider,category,source,product,status,resource_id,access_token_enc,meta) values
      ('${ADMIN}','facebook','social','facebook','facebook','connected','facebook-page','facebook-cipher','{"page_name":"Keep"}'),
      ('${ADMIN}','instagram','social','instagram','instagram','connected','legacy-ig','legacy-cipher','{"page_id":"legacy-page","publication_preferences":{"reels":true}}');
    grant usage on schema public to service_role;
    grant all on public.profiles,public.pro_tools_configs,public.integrations,public.app_bubble_access to service_role;
  `);
  await db.exec(sql); return db;
}
function integration(account: string, channel: "instagram" | "threads", resourceId = "direct-profile") { return { user_id: account, provider: channel, source: channel, product: channel, status: "connected", resource_id: resourceId, resource_label: "brand", display_name: channel, access_token_enc: "fixture-encrypted-token", expires_at: "2030-01-01T00:00:00Z", scope: "fixture-scope", meta: { auth_mode: channel === "instagram" ? "instagram_login" : "threads_login", publication_preferences: { reels: true } } }; }
async function save(db: PGlite, account: string, channel: "instagram" | "threads", settings: any = { accountConnected: true, connected: true, username: "brand", url: "https://public.example" }, data = integration(account, channel)) {
  return db.query("select public.save_meta_direct_connection($1::uuid,$2::text,$3::jsonb,$4::jsonb,true)", [account, channel, JSON.stringify(data), JSON.stringify(settings)]);
}

test("Migration seeds Threads only for ADMIN/allow-listed accounts and enforces server-only function execution", async () => {
  const db = await fixture();
  try {
    const bubbles = await rows(db, "select user_id,enabled from public.app_bubble_access where bubble_key='threads' order by user_id");
    assert.equal(bubbles.find(row => row.user_id === ADMIN)?.enabled, true); assert.equal(bubbles.find(row => row.user_id === USER)?.enabled, false); assert.equal(bubbles.find(row => row.user_id === HARD_ADMIN)?.enabled, true);
    const signatures = ["public.save_meta_direct_connection(uuid,text,jsonb,jsonb,boolean)", "public.disconnect_meta_direct_connection(uuid,text,boolean)", "public.create_default_bubble_access()"];
    for (const role of ["anon", "authenticated"]) for (const signature of signatures) assert.equal((await rows(db, "select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature]))[0].allowed, false);
    for (const signature of signatures.slice(0, 2)) assert.equal((await rows(db, "select has_function_privilege('service_role',$1,'EXECUTE') as allowed", [signature]))[0].allowed, true);
    await db.exec("set role authenticated"); await assert.rejects(save(db, ADMIN, "threads"), /permission denied/); await db.exec("reset role");
    await db.exec(sql); assert.equal((await rows(db, "select count(*)::integer as n from public.app_bubble_access where bubble_key='threads'"))[0].n, 3);
    const newAdmin = "00000000-0000-4000-8000-000000000003", newUser = "00000000-0000-4000-8000-000000000004";
    await db.query("insert into public.profiles(user_id,role) values ($1,'admin'),($2,'user')", [newAdmin, newUser]);
    assert.equal((await rows(db, "select enabled from public.app_bubble_access where user_id=$1 and bubble_key='threads'", [newAdmin]))[0].enabled, true);
    assert.equal((await rows(db, "select enabled from public.app_bubble_access where user_id=$1 and bubble_key='threads'", [newUser]))[0].enabled, false);
  } finally { await db.close(); }
});

test("Atomic save/disconnect preserve other tool sections, preferences and the Facebook integration", async () => {
  const db = await fixture();
  try {
    const facebookBefore = (await rows(db, "select * from public.integrations where provider='facebook'"))[0];
    await save(db, ADMIN, "threads"); await save(db, ADMIN, "instagram");
    const settings = (await rows(db, "select settings from public.pro_tools_configs where user_id=$1", [ADMIN]))[0].settings;
    assert.deepEqual(settings.site_web, { url: "https://preserved.example" }); assert.deepEqual(settings.generalPreferences, { language: "fr-FR" });
    assert.deepEqual(settings.instagram.publicationPreferences, { reels: true }); assert.deepEqual(settings.threads.publicationPreferences, { reply_control: "followers_only" });
    assert.equal(settings.threads.connected, true); assert.equal(settings.instagram.connected, true);
    assert.deepEqual((await rows(db, "select * from public.integrations where provider='facebook'"))[0], facebookBefore);
    assert.equal((await rows(db, "select stats_version from public.profiles where user_id=$1", [ADMIN]))[0].stats_version, 2);
    await db.query("select public.disconnect_meta_direct_connection($1,'threads',true)", [ADMIN]);
    const after = (await rows(db, "select settings from public.pro_tools_configs where user_id=$1", [ADMIN]))[0].settings;
    assert.equal(after.threads.connected, false); assert.equal(after.threads.username, null); assert.deepEqual(after.threads.publicationPreferences, settings.threads.publicationPreferences); assert.deepEqual(after.site_web, settings.site_web);
    assert.deepEqual((await rows(db, "select * from public.integrations where provider='facebook'"))[0], facebookBefore);
    assert.equal((await rows(db, "select count(*)::integer as n from public.integrations where provider='threads'"))[0].n, 0);
  } finally { await db.close(); }
});

test("USER saves/disconnects and legacy Facebook Instagram disconnect are refused without changing rows", async () => {
  const db = await fixture();
  try {
    const before = await rows(db, "select * from public.integrations order by provider");
    await assert.rejects(save(db, USER, "threads"), /restricted to ADMIN/);
    await assert.rejects(db.query("select public.disconnect_meta_direct_connection($1,'threads',true)", [USER]), /restricted to ADMIN/);
    await assert.rejects(db.query("select public.disconnect_meta_direct_connection($1,'instagram',true)", [ADMIN]), /Facebook connection/);
    assert.deepEqual(await rows(db, "select * from public.integrations order by provider"), before);
    assert.equal((await rows(db, "select stats_version from public.profiles where user_id=$1", [USER]))[0].stats_version, 0);
    await assert.rejects(save(db, ADMIN, "threads", {}, integration(USER, "threads")), /Invalid Meta connection/);
  } finally { await db.close(); }
});

test("Malformed UI configuration causes save rollback and preserves the existing OAuth slot and versions", async () => {
  const db = await fixture();
  try {
    for (const value of [null, [], "malformed", { instagram: null }, { instagram: [] }]) {
      await db.query("update public.pro_tools_configs set settings=$2::jsonb where user_id=$1", [ADMIN, value === null ? null : JSON.stringify(value)]);
      const before = await rows(db, "select * from public.integrations order by provider");
      await assert.rejects(save(db, ADMIN, "instagram"), /explicit reconciliation/);
      assert.deepEqual(await rows(db, "select * from public.integrations order by provider"), before);
      assert.equal((await rows(db, "select stats_version from public.profiles where user_id=$1", [ADMIN]))[0].stats_version, 0);
    }
  } finally { await db.close(); }
});

test("Malformed UI configuration also prevents partial disconnect of a valid direct OAuth slot", async () => {
  const db = await fixture();
  try {
    await save(db, ADMIN, "instagram");
    for (const value of [null, [], "malformed", { instagram: null }, { instagram: [] }]) {
      await db.query("update public.pro_tools_configs set settings=$2::jsonb where user_id=$1", [ADMIN, value === null ? null : JSON.stringify(value)]);
      await assert.rejects(db.query("select public.disconnect_meta_direct_connection($1,'instagram',true)", [ADMIN]), /explicit reconciliation/);
      assert.equal((await rows(db, "select count(*)::integer as n from public.integrations where provider='instagram'"))[0].n, 1);
      assert.equal((await rows(db, "select stats_version from public.profiles where user_id=$1", [ADMIN]))[0].stats_version, 1);
    }
  } finally { await db.close(); }
});
