import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ACCOUNT, ACTOR, asset, AUDIO, memory, OTHER, PHOTO } from "./studio-references-fixture.mts";

test("actual Studio memory SQL preserves account namespaces and enforces membership, assets and service-only access", async t => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table public.inrcy_accounts(id uuid primary key);
      create table public.inrcy_account_members(account_id uuid,auth_user_id uuid,primary key(account_id,auth_user_id));
      create table public.pro_tools_configs(user_id uuid primary key references public.inrcy_accounts(id),settings jsonb not null default '{}',updated_at timestamptz default now());
      create table public.pro_media_library(id uuid primary key,user_id uuid,media_type text,mime_type text,is_active boolean,bucket_name text,storage_path text,source text);
      alter table public.pro_tools_configs enable row level security;
      grant select,insert,update on public.pro_tools_configs to service_role;
      grant select on public.inrcy_account_members,public.pro_media_library to service_role;`);
    await db.query("insert into public.inrcy_accounts values($1),($2)", [ACCOUNT, OTHER]);
    await db.query("insert into public.inrcy_account_members values($1,$2)", [ACCOUNT, ACTOR]);
    const original = { business_dna: { tone: "warm" }, ai_media_generator: { version: 1, blocks: { 6: { saved: true } } }, threads: { publicationPreferences: { version: 1 } } };
    await db.query("insert into public.pro_tools_configs(user_id,settings) values($1,$3),($2,$3)", [ACCOUNT, OTHER, JSON.stringify(original)]);
    for (const row of [asset(PHOTO, "image"), asset(AUDIO, "audio")]) {
      await db.query("insert into public.pro_media_library values($1,$2,$3,$4,$5,$6,$7,$8)", [row.id, row.user_id, row.media_type, row.mime_type, row.is_active, row.bucket_name, row.storage_path, row.source]);
    }
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261116204339_studio_reference_memory.sql", import.meta.url), "utf8"));
    const write = (value: unknown = memory(), account = ACCOUNT, actor = ACTOR) => db.query<{ memory: unknown }>("select public.inrcy_set_studio_references($1,$2,$3) as memory", [account, actor, value === null ? null : JSON.stringify(value)]);
    const settings = async (account = ACCOUNT) => (await db.query<{ settings: Record<string, unknown> }>("select settings from public.pro_tools_configs where user_id=$1", [account])).rows[0].settings;

    await t.test("the production SQL runs under service_role and alters only the selected account namespace", async () => {
      await db.exec("set role service_role");
      const result = await write(); assert.deepEqual(result.rows[0].memory, memory());
      assert.deepEqual(await settings(), { ...original, studio_references: memory() });
      assert.deepEqual(await settings(OTHER), original);
      await db.exec("reset role");
    });
    await t.test("a foreign or absent actor cannot write even through a service call", async () => {
      await assert.rejects(write(memory(), ACCOUNT, OTHER), /ACCOUNT_FORBIDDEN/);
      await assert.rejects(write(memory(), OTHER), /ACCOUNT_FORBIDDEN/);
      assert.deepEqual(await settings(OTHER), original);
    });
    await t.test("foreign, inactive, wrong-type, draft and unsafe-path assets are refused atomically", async () => {
      for (const [column, value] of [["user_id", OTHER], ["is_active", false], ["media_type", "video"], ["source", "ai_media_generation_draft"], ["storage_path", `users/${ACCOUNT}/image/../secret.jpg`], ["bucket_name", "public-media"]] as const) {
        const row = asset(PHOTO, "image");
        await db.query(`update public.pro_media_library set ${column}=$1 where id=$2`, [value, PHOTO]);
        await assert.rejects(write(), /MEDIA_UNAVAILABLE/);
        assert.deepEqual((await settings()).studio_references, memory());
        await db.query(`update public.pro_media_library set ${column}=$1 where id=$2`, [row[column], PHOTO]);
      }
    });
    await t.test("untrusted JSON and broken voice bindings never enter storage", async () => {
      const broken = memory(); broken.voices[0].target = null;
      for (const row of [{ ...memory(), identityConsent: true }, { ...memory(), references: ["bad"] }, { ...memory(), voices: [{ ...memory().voices[0], path: "temporary.wav" }] }, broken]) {
        await assert.rejects(write(row), /STUDIO_REFERENCES_INVALID/);
      }
      assert.deepEqual((await settings()).studio_references, memory());
    });
    await t.test("future versions and malformed existing settings survive rejected replacement and forgetting", async () => {
      for (const existing of [["malformed"], { ...original, studio_references: { version: 2, future: true } }]) {
        await db.query("update public.pro_tools_configs set settings=$1 where user_id=$2", [JSON.stringify(existing), ACCOUNT]);
        for (const replacement of [memory(), null]) await assert.rejects(write(replacement), /SETTINGS_INVALID|VERSION_UNSUPPORTED/);
        assert.deepEqual(await settings(), existing);
      }
      await db.query("update public.pro_tools_configs set settings=$1 where user_id=$2", [JSON.stringify({ ...original, studio_references: memory() }), ACCOUNT]);
    });
    await t.test("forgetting is idempotent and never deletes a permanent media or another namespace", async () => {
      await write(null); await write(null);
      assert.deepEqual(await settings(), original);
      assert.equal((await db.query<{ count: number }>("select count(*)::int as count from public.pro_media_library")).rows[0].count, 2);
    });
    await t.test("browser roles cannot call the RPC and the function does not bypass RLS", async () => {
      const access = await db.query<{ role: string; allowed: boolean }>("select r as role,has_function_privilege(r,'public.inrcy_set_studio_references(uuid,uuid,jsonb)','execute') as allowed from unnest(array['anon','authenticated','service_role']) r");
      assert.deepEqual(access.rows, [{ role: "anon", allowed: false }, { role: "authenticated", allowed: false }, { role: "service_role", allowed: true }]);
      assert.equal((await db.query<{ elevated: boolean }>("select prosecdef as elevated from pg_proc where oid='public.inrcy_set_studio_references(uuid,uuid,jsonb)'::regprocedure")).rows[0].elevated, false);
      await db.exec("set role authenticated");
      await assert.rejects(write(), /permission denied/);
      await db.exec("reset role");
    });
  } finally { await db.close(); }
});
