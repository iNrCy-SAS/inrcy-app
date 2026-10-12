/* eslint-disable @typescript-eslint/no-explicit-any -- Database JSON fixtures retain heterogeneous runtime shapes. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ADMIN = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const migration = readFileSync(new URL("../../supabase/migrations/20261012160212_threads_ghost_publication_preferences.sql", import.meta.url), "utf8");
const signature = "public.inrcy_set_threads_publication_preferences(uuid,jsonb,boolean)";
async function rows(db: PGlite, sql: string, args: unknown[] = []) {
  return (await db.query<Record<string, any>>(sql, args)).rows;
}
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.inrcy_accounts(id uuid primary key);
    create table public.profiles(user_id uuid primary key references public.inrcy_accounts(id),role text);
    create table public.pro_tools_configs(user_id uuid primary key references public.inrcy_accounts(id),settings jsonb,updated_at timestamptz default now());
    insert into public.inrcy_accounts values ('${ADMIN}'),('${USER}');
    insert into public.profiles values ('${ADMIN}','admin'),('${USER}','user');
    insert into public.pro_tools_configs(user_id,settings) values ('${ADMIN}','{"threads":{"connected":true,"username":"brand","reply_control":"followers_only"},"instagram":{"publicationPreferences":{"defaultMode":"reel"}},"site_web":{"url":"https://fixture.example"}}');
    grant usage on schema public to service_role;
    grant select on public.inrcy_accounts,public.profiles to service_role;
    grant all on public.pro_tools_configs to service_role;
  `);
  await db.exec(migration);
  await db.exec("set role service_role");
  return db;
}
async function save(db: PGlite, preferences: unknown, account = ADMIN, pilot = true) {
  return rows(db,"select public.inrcy_set_threads_publication_preferences($1::uuid,$2::jsonb,$3::boolean) as preferences",[account,JSON.stringify(preferences),pilot]);
}
const ghost = { version: 1, ghostEnabled: true, defaultMode: "ghost" };

test("Threads preference save is service-only and normalizes without changing connections or other tools", async () => {
  const db = await fixture();
  try {
    const before = (await rows(db,"select settings from public.pro_tools_configs where user_id=$1",[ADMIN]))[0].settings;
    const result = await save(db,{ ...ghost, unknown: "discarded" });
    assert.deepEqual(result[0].preferences,ghost);
    const after = (await rows(db,"select settings from public.pro_tools_configs where user_id=$1",[ADMIN]))[0].settings;
    assert.deepEqual(after,{ ...before, threads: { ...before.threads, publicationPreferences: ghost } });
    for (const role of ["anon","authenticated"]) assert.equal((await rows(db,"select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,signature]))[0].allowed,false);
    assert.equal((await rows(db,"select has_function_privilege('service_role',$1,'EXECUTE') as allowed",[signature]))[0].allowed,true);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(save(db,ghost),/permission denied/);
  } finally { await db.close(); }
});

test("ADMIN guard and invalid Ghost preferences preserve existing settings", async () => {
  const db = await fixture();
  try {
    const before = await rows(db,"select * from public.pro_tools_configs");
    await assert.rejects(save(db,ghost,USER),/restricted to ADMIN/);
    for (const preferences of [null,[],{}, { ...ghost,version:"1" }, { ...ghost,ghostEnabled:"true" }, { ...ghost,defaultMode:"story" }, { ...ghost,ghostEnabled:false }]) {
      await assert.rejects(save(db,preferences),/Invalid Threads publication preferences|default Threads format must be enabled/);
      assert.deepEqual(await rows(db,"select * from public.pro_tools_configs"),before);
    }
    const result = await save(db,{ version:1,ghostEnabled:false,defaultMode:"classic" });
    assert.equal(result[0].preferences.defaultMode,"classic");
  } finally { await db.close(); }
});

test("Malformed settings are rejected instead of erasing existing channel data", async () => {
  const db = await fixture();
  try {
    for (const settings of [null,[],"invalid",{ threads:null },{ threads:[] }]) {
      await db.query("update public.pro_tools_configs set settings=$2::jsonb where user_id=$1",[ADMIN,JSON.stringify(settings)]);
      const before = await rows(db,"select * from public.pro_tools_configs");
      await assert.rejects(save(db,ghost),/explicit reconciliation/);
      assert.deepEqual(await rows(db,"select * from public.pro_tools_configs"),before);
    }
  } finally { await db.close(); }
});

test("Disjoint channel updates retain each other and future release can enable an existing USER account", async () => {
  const db = await fixture();
  try {
    await db.exec("update public.pro_tools_configs set settings=jsonb_set(settings,'{instagram,publicationPreferences}', '{\"defaultMode\":\"story\"}')");
    await save(db,ghost);
    await db.exec("update public.pro_tools_configs set settings=jsonb_set(settings,'{site_web,url}', '\"https://changed.example\"')");
    await save(db,{ ...ghost,defaultMode:"classic" });
    const settings = (await rows(db,"select settings from public.pro_tools_configs where user_id=$1",[ADMIN]))[0].settings;
    assert.equal(settings.instagram.publicationPreferences.defaultMode,"story");
    assert.equal(settings.site_web.url,"https://changed.example");
    const released = await save(db,ghost,USER,false);
    assert.deepEqual(released[0].preferences,ghost);
  } finally { await db.close(); }
});
