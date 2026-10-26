import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const initial = readFileSync(new URL("../../supabase/migrations/20261025232515_inr_assistant_durable_memory.sql", import.meta.url), "utf8");
const retention = readFileSync(new URL("../../supabase/migrations/20261025235832_inr_assistant_two_month_retention.sql", import.meta.url), "utf8");
const ACCOUNT = randomUUID(), OTHER_ACCOUNT = randomUUID(), ACTOR = randomUUID(), COLLEAGUE = randomUUID();
const CONVERSATION = randomUUID(), OLD_ONLY = randomUUID(), OLD = randomUUID(), RECENT = randomUUID();

test("two-month migration hides expired prose and titles immediately under real PostgreSQL RLS, before a server cleanup", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.inrcy_accounts(id uuid primary key);
      create table public.inrcy_account_members(account_id uuid,auth_user_id uuid);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create function public.inrcy_can_access_account(uuid) returns boolean language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.inrcy_account_members where account_id=$1 and auth_user_id=auth.uid()) $$;
      create function public.inrcy_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      grant usage on schema auth to authenticated;
      grant execute on function public.inrcy_can_access_account(uuid) to authenticated;
      insert into auth.users values('${ACTOR}'),('${COLLEAGUE}');
      insert into public.inrcy_accounts values('${ACCOUNT}'),('${OTHER_ACCOUNT}');
      insert into public.inrcy_account_members values('${ACCOUNT}','${ACTOR}'),('${ACCOUNT}','${COLLEAGUE}');
    `);
    await db.exec(initial);
    // Fixed boundaries in one transaction allow an exact inclusivity assertion.
    await db.exec("begin");
    const cutoff = "(((now() at time zone 'UTC')-interval '2 months') at time zone 'UTC')";
    for (const [turn, conversation, relative, text, actor, account] of [
      [OLD, CONVERSATION, "- interval '1 microsecond'", "EXPIRED TITLE AND PROSE", ACTOR, ACCOUNT],
      [randomUUID(), OLD_ONLY, "- interval '1 day'", "EXPIRED ONLY CONVERSATION", ACTOR, ACCOUNT],
      [RECENT, CONVERSATION, "", "Current publication plan", ACTOR, ACCOUNT],
      [randomUUID(), randomUUID(), "+ interval '1 day'", "COLLEAGUE PRIVATE", COLLEAGUE, ACCOUNT],
      [randomUUID(), randomUUID(), "+ interval '1 day'", "FOREIGN ACCOUNT PRIVATE", ACTOR, OTHER_ACCOUNT],
    ]) await db.query(`insert into public.inr_assistant_turns(account_id,actor_user_id,conversation_id,turn_id,lease_id,user_text,assistant_text,status,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,'Stored answer','completed',${cutoff} ${relative},now())`, [account, actor, conversation, turn, randomUUID(), text]);
    await db.exec(retention.replace(/^begin;|^commit;/gm, ""));
    assert.equal((await db.query("select * from public.inr_assistant_turns")).rows.length, 5, "Migration itself must never delete prose");
    await db.query("select set_config('test.actor',$1,false)", [ACTOR]);
    await db.exec("set role authenticated");
    const read = await db.query<{ turn_id: string }>("select turn_id from public.inr_assistant_turns");
    assert.deepEqual(read.rows.map(row => row.turn_id), [RECENT], "Exact threshold remains readable; creation time governs expiry despite recent updates");
    assert.equal((await db.query("update public.inr_assistant_turns set assistant_text='Revived' where turn_id=$1 returning turn_id", [OLD])).rows.length, 0);
    const listing = await db.query<{ conversation_id: string; title: string }>("select * from public.inrcy_list_assistant_conversations($1,20)", [ACCOUNT]);
    assert.deepEqual(listing.rows.map(row => [row.conversation_id, row.title]), [[CONVERSATION, "Current publication plan"]]);
    assert.equal((await db.query("select turn_id from public.inr_assistant_turns where search_document @@ websearch_to_tsquery('simple','EXPIRED')")).rows.length, 0);
    await db.exec("savepoint denied_delete");
    await assert.rejects(db.query("delete from public.inr_assistant_turns"), /permission denied/);
    await db.exec("rollback to savepoint denied_delete");
    await db.exec("reset role; set role anon");
    await db.exec("savepoint denied_anon");
    await assert.rejects(db.query("select * from public.inr_assistant_turns"), /permission denied/);
    await db.exec("rollback to savepoint denied_anon");
    await db.exec("reset role; set role service_role");
    const deleted = await db.query(`delete from public.inr_assistant_turns where created_at < ${cutoff} returning turn_id`);
    assert.equal(deleted.rows.length, 2, "Protected server cleanup removes expired rows only");
    await db.exec("reset role");
    assert.equal((await db.query("select * from public.inr_assistant_turns")).rows.length, 3);
    assert.equal((await db.query<{ prosecdef: boolean }>("select prosecdef from pg_proc where oid='public.inrcy_list_assistant_conversations(uuid,integer)'::regprocedure")).rows[0].prosecdef, false);
    assert.doesNotMatch(retention, /\b(?:delete from|truncate|drop table|security definer)\b/i);
    await db.exec("rollback");
  } finally { await db.close(); }
});
