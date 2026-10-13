import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { FULL_PRODUCT_REVIEWER_ACCOUNT_ID } from "../../lib/reviewerAccess.ts";

const REVIEWER = FULL_PRODUCT_REVIEWER_ACCOUNT_ID;
const USER = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const ADMIN = "00000000-0000-4000-8000-000000000004";
const read = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const migration = read("20261013195831_reviewer_role_meta_pilot_access.sql");
const signatures = ["public.save_meta_direct_connection(uuid,text,jsonb,jsonb,boolean)", "public.disconnect_meta_direct_connection(uuid,text,boolean)", "public.inrcy_set_threads_publication_preferences(uuid,jsonb,boolean)"];
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.inrcy_accounts(id uuid primary key);
    create table public.profiles(user_id uuid primary key,role text constraint profiles_role_check check(role in ('user','staff','admin')),stats_version bigint default 0,stats_cache_epoch integer default 0);
    create table public.subscriptions(user_id uuid primary key,plan text);
    create table public.inrcy_account_members(account_id uuid,auth_user_id uuid,role text);
    create table public.app_bubble_access(user_id uuid,bubble_key text,enabled boolean,updated_at timestamptz default now(),primary key(user_id,bubble_key));
    create table public.pro_tools_configs(user_id uuid primary key,settings jsonb,updated_at timestamptz default now());
    create table public.integrations(user_id uuid,provider text,category text,source text,product text,status text,resource_id text,resource_label text,display_name text,access_token_enc text,refresh_token_enc text,expires_at timestamptz,scopes text,meta jsonb,updated_at timestamptz,unique(user_id,provider,source,product));
    create function public.create_default_bubble_access() returns trigger language plpgsql as $$ begin return new; end; $$;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function public.protect_profile_role_from_client() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
    declare v_jwt_role text:=coalesce(auth.jwt()->>'role',''); v_trusted boolean:=current_user in ('postgres','service_role') or v_jwt_role='service_role';
    begin
      if v_trusted then return new; end if;
      if tg_op='INSERT' and new.role is not null and new.role<>'user' then raise exception 'Client role assignment denied'; end if;
      if tg_op='UPDATE' and new.role is distinct from old.role then raise exception 'Client role change denied'; end if;
      return new;
    end;
    $$;
    create trigger trg_protect_profile_role_from_client before insert or update on public.profiles for each row execute function public.protect_profile_role_from_client();
    insert into public.inrcy_accounts values ('${REVIEWER}'),('${USER}'),('${OTHER}'),('${ADMIN}');
    insert into public.profiles(user_id,role) values ('${REVIEWER}','user'),('${USER}','user'),('${OTHER}','user'),('${ADMIN}','admin');
    insert into public.subscriptions values ('${REVIEWER}','Premium'),('${USER}','Standard');
    insert into public.inrcy_account_members values ('${REVIEWER}','${REVIEWER}','owner'),('${USER}','${USER}','owner');
    grant usage on schema public to service_role;
    grant usage on schema public,auth to authenticated;
    grant select,insert,update on public.profiles to authenticated;
    grant all on public.profiles,public.pro_tools_configs,public.integrations,public.app_bubble_access to service_role;
    grant select on public.inrcy_accounts to service_role;
  `);
  await db.exec(read("20261012115509_meta_direct_channels_admin_pilot.sql"));
  await db.exec(read("20261012143832_fix_meta_direct_connection_scopes.sql"));
  await db.exec(read("20261012160212_threads_ghost_publication_preferences.sql"));
  return db;
}
const integration = (account: string, channel: string) => ({ user_id: account,provider:channel,source:channel,product:channel,status:"connected",resource_id:"123456",resource_label:"fixture",display_name:channel,access_token_enc:"encrypted-fixture",scopes:"fixture-scope",meta:{auth_mode:channel==="instagram"?"instagram_login":"threads_login"} });
const save = (db:PGlite, account:string, channel:string) => db.query("select public.save_meta_direct_connection($1,$2,$3::jsonb,$4::jsonb,true)",[account,channel,JSON.stringify(integration(account,channel)),JSON.stringify({connected:true,username:"fixture"})]);

test("Reviewer migration changes no existing roles, plans, company memberships or bubble visibility", async () => {
  const db=await fixture();
  try {
    const tables=["profiles","subscriptions","inrcy_account_members","app_bubble_access"];
    const before=await Promise.all(tables.map(table=>db.query(`select * from public.${table} order by 1`)));
    await db.exec(migration);
    await db.exec(migration);
    for(let i=0;i<tables.length;i++) assert.deepEqual((await db.query(`select * from public.${tables[i]} order by 1`)).rows,before[i].rows);
    await db.query("update public.profiles set role='reviewer' where user_id=$1",[REVIEWER]);
    await assert.rejects(db.query("update public.profiles set role='unsupported' where user_id=$1",[USER]),/profiles_role_check/);
    assert.deepEqual((await db.query("select plan from subscriptions where user_id=$1",[REVIEWER])).rows,[{plan:"Premium"}]);
  } finally {await db.close();}
});

test("Only the approved REVIEWER can save/disconnect direct accounts and configure Threads", async () => {
  const db=await fixture();
  try {
    await db.exec(migration);
    await db.query("update public.profiles set role='reviewer' where user_id in ($1,$2)",[REVIEWER,OTHER]);
    await db.exec("set role service_role");
    for(const channel of ["instagram","threads"]) await save(db,REVIEWER,channel);
    const preferences={version:1,ghostEnabled:true,defaultMode:"ghost"};
    assert.deepEqual((await db.query("select public.inrcy_set_threads_publication_preferences($1,$2::jsonb,true) as p",[REVIEWER,JSON.stringify(preferences)])).rows,[{p:preferences}]);
    for(const account of [USER,OTHER]) {
      await assert.rejects(save(db,account,"threads"),/restricted to ADMIN/);
      await assert.rejects(db.query("select public.disconnect_meta_direct_connection($1,'threads',true)",[account]),/restricted to ADMIN/);
      await assert.rejects(db.query("select public.inrcy_set_threads_publication_preferences($1,$2::jsonb,true)",[account,JSON.stringify(preferences)]),/restricted to ADMIN/);
    }
    await save(db,ADMIN,"threads");
    await db.query("select public.disconnect_meta_direct_connection($1,'threads',true)",[REVIEWER]);
    assert.equal((await db.query<{n:number}>("select count(*)::int as n from integrations where user_id=$1 and provider='threads'",[REVIEWER])).rows[0].n,0);
  } finally {await db.close();}
});

test("Existing service-only grants and invoker security remain intact", async () => {
  const db=await fixture();
  try {
    await db.exec(migration);
    for(const signature of signatures) {
      for(const role of ["anon","authenticated"]) assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,signature])).rows[0].allowed,false);
      assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege('service_role',$1,'EXECUTE') as allowed",[signature])).rows[0].allowed,true);
      assert.equal((await db.query<{prosecdef:boolean}>("select prosecdef from pg_proc where oid=$1::regprocedure",[signature])).rows[0].prosecdef,false);
    }
  } finally {await db.close();}
});

test("Unexpected pilot function definitions abort instead of being silently rewritten", async () => {
  const db=await fixture();
  try {
    await db.exec("create or replace function public.disconnect_meta_direct_connection(p_account_id uuid,p_channel text,p_admin_pilot boolean default true) returns void language plpgsql security invoker as $$ begin raise exception 'unexpected fixture'; end; $$;");
    await assert.rejects(db.exec(migration),/Unexpected Meta pilot guard/);
    await db.exec("rollback");
    await assert.rejects(db.query("update profiles set role='reviewer' where user_id=$1",[REVIEWER]),/profiles_role_check/);
  } finally {await db.close();}
});

test("Migration preserves the existing client role-write guard, including reviewer escalation denial", async () => {
  const db=await fixture();
  try {
    const definition=(await db.query<{definition:string}>("select pg_get_functiondef('public.protect_profile_role_from_client()'::regprocedure) as definition")).rows[0].definition;
    await db.exec(migration);
    assert.equal((await db.query<{definition:string}>("select pg_get_functiondef('public.protect_profile_role_from_client()'::regprocedure) as definition")).rows[0].definition,definition);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("update public.profiles set role='reviewer' where user_id=$1",[USER]),/Client role change denied/);
    await assert.rejects(db.query("insert into public.profiles(user_id,role) values ('00000000-0000-4000-8000-000000000099','reviewer')"),/Client role assignment denied/);
    await db.exec("reset role; set role service_role");
    await db.query("update public.profiles set role='reviewer' where user_id=$1",[REVIEWER]);
    await db.exec("reset role; set role authenticated");
    await assert.rejects(db.query("update public.profiles set role='admin' where user_id=$1",[REVIEWER]),/Client role change denied/);
    assert.deepEqual((await db.query<{role:string}>("select role from public.profiles where user_id=$1",[REVIEWER])).rows,[{role:"reviewer"}]);
  } finally {await db.close();}
});
