import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../../supabase/migrations/20261025232515_inr_assistant_durable_memory.sql", import.meta.url), "utf8");
const ACCOUNT = randomUUID(), OTHER_ACCOUNT = randomUUID(), ACTOR = randomUUID(), COLLEAGUE = randomUUID(), OUTSIDER = randomUUID();
const CONVERSATION = randomUUID(), TURN = randomUUID();
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.inrcy_accounts(id uuid primary key);
    create table public.inrcy_account_members(account_id uuid references public.inrcy_accounts,auth_user_id uuid references auth.users,primary key(account_id,auth_user_id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function public.inrcy_can_access_account(uuid) returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.inrcy_account_members where account_id=$1 and auth_user_id=auth.uid()) $$;
    create function public.inrcy_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
    grant usage on schema auth to authenticated;
    grant execute on function public.inrcy_can_access_account(uuid) to authenticated;
    insert into auth.users values('${ACTOR}'),('${COLLEAGUE}'),('${OUTSIDER}');
    insert into public.inrcy_accounts values('${ACCOUNT}'),('${OTHER_ACCOUNT}');
    insert into public.inrcy_account_members values('${ACCOUNT}','${ACTOR}'),('${ACCOUNT}','${COLLEAGUE}'),('${OTHER_ACCOUNT}','${OUTSIDER}');
  `);
  await db.exec(migration);
  return db;
}
async function asActor(db: PGlite, actor = ACTOR) {
  await db.exec("reset role");
  await db.query("select set_config('test.actor',$1,false)", [actor]);
  await db.exec("set role authenticated");
}
async function insert(db: PGlite, options: { account?: string; actor?: string; conversation?: string; turn?: string; text?: string } = {}) {
  return db.query(`insert into public.inr_assistant_turns(account_id,actor_user_id,conversation_id,turn_id,lease_id,user_text,status)
    values($1,$2,$3,$4,$5,$6,'pending') returning *`, [options.account ?? ACCOUNT, options.actor ?? ACTOR,
    options.conversation ?? CONVERSATION, options.turn ?? TURN, randomUUID(), options.text ?? "Nos publications de Noël"]);
}

test("durable memory migration executes real PostgreSQL with private RLS and no time-based deletion", async (t) => {
  const db = await fixture();
  try {
    await t.test("authenticated actor persists and completes its own turn", async () => {
      await asActor(db);
      const row = (await insert(db)).rows[0] as Record<string, unknown>;
      assert.equal(row.status, "pending"); assert.equal(row.assistant_text, null);
      await db.query("update public.inr_assistant_turns set status='completed',assistant_text='Voici vos trois sujets' where turn_id=$1", [TURN]);
      const read = await db.query<{ status: string; assistant_text: string }>("select status,assistant_text from public.inr_assistant_turns where turn_id=$1", [TURN]);
      assert.equal(read.rows[0].status, "completed");
      assert.equal(read.rows[0].assistant_text, "Voici vos trois sujets");
    });
    await t.test("same-account colleague cannot read or change another professional's memory", async () => {
      await asActor(db, COLLEAGUE);
      assert.equal((await db.query("select * from public.inr_assistant_turns")).rows.length, 0);
      assert.equal((await db.query("update public.inr_assistant_turns set assistant_text='Stolen' returning *")).rows.length, 0);
      assert.equal((await db.query("select * from public.inrcy_list_assistant_conversations($1,20)", [ACCOUNT])).rows.length, 0);
      await assert.rejects(insert(db, { actor: ACTOR, turn: randomUUID() }), /row-level security/);
    });
    await t.test("another account, anonymous and missing auth cannot read or inject turns", async () => {
      await asActor(db, OUTSIDER);
      assert.equal((await db.query("select * from public.inr_assistant_turns")).rows.length, 0);
      await assert.rejects(insert(db, { actor: OUTSIDER, turn: randomUUID() }), /row-level security/);
      await db.exec("reset role; set role anon");
      await assert.rejects(db.query("select * from public.inr_assistant_turns"), /permission denied/);
      await assert.rejects(db.query("select * from public.inrcy_list_assistant_conversations($1,20)", [ACCOUNT]), /permission denied/);
      await db.exec("reset role"); await db.query("select set_config('test.actor','',false)"); await db.exec("set role authenticated");
      assert.equal((await db.query("select * from public.inr_assistant_turns")).rows.length, 0);
    });
    await t.test("turn identity and original question are immutable; scoped idempotency and storage bounds are enforced", async () => {
      await asActor(db);
      await assert.rejects(insert(db), /duplicate key/);
      await assert.rejects(db.query("update public.inr_assistant_turns set account_id=$1", [OTHER_ACCOUNT]), /permission denied/);
      await assert.rejects(db.query("update public.inr_assistant_turns set actor_user_id=$1", [COLLEAGUE]), /permission denied/);
      await assert.rejects(db.query("update public.inr_assistant_turns set user_text='Changed'"), /permission denied/);
      await assert.rejects(db.query("delete from public.inr_assistant_turns"), /permission denied/);
      await assert.rejects(insert(db, { turn: randomUUID(), text: "x".repeat(4_001) }), /check constraint/);
      await assert.rejects(db.query("update public.inr_assistant_turns set status='completed',assistant_text=null"), /check constraint/);
      await assert.rejects(db.query("update public.inr_assistant_turns set assistant_text=$1", ["x".repeat(60_001)]), /check constraint/);
      await assert.rejects(db.query("insert into public.inr_assistant_turns(account_id,actor_user_id,conversation_id,turn_id,lease_id,user_text,status) values($1,$2,$3,$4,$5,'Fake completed','completed')",
        [ACCOUNT, ACTOR, randomUUID(), randomUUID(), randomUUID()]), /row-level security|check constraint/);
    });
    await t.test("search is indexed and exact conversation listing includes old conversations beyond a recent-row sample", async () => {
      await asActor(db);
      const anotherConversation = randomUUID();
      const oldestTurn = randomUUID();
      for (let i = 0; i < 28; i++) await insert(db, { conversation: i < 25 ? CONVERSATION : anotherConversation, turn: i === 25 ? oldestTurn : randomUUID(), text: i === 25 ? "Projet de toiture ancien" : `Notre campagne ${i}` });
      // Distinct timestamps make the first question deterministic even when
      // many synthetic inserts finish within the same database millisecond.
      await db.exec("reset role");
      await db.query("update public.inr_assistant_turns set created_at=now()-interval '1 day' where turn_id=$1", [oldestTurn]);
      await asActor(db);
      const found = await db.query("select turn_id from public.inr_assistant_turns where account_id=$1 and search_document @@ websearch_to_tsquery('simple',$2)", [ACCOUNT, "toiture"]);
      assert.equal(found.rows.length, 1);
      const listed = await db.query<{ conversation_id: string; title: string }>("select * from public.inrcy_list_assistant_conversations($1,20)", [ACCOUNT]);
      assert.equal(listed.rows.length, 2);
      assert.ok(listed.rows.some((row) => row.conversation_id === anotherConversation && row.title === "Projet de toiture ancien"));
      await db.exec("reset role");
      const definition = await db.query<{ prosecdef: boolean }>("select prosecdef from pg_proc where oid='public.inrcy_list_assistant_conversations(uuid,integer)'::regprocedure");
      assert.equal(definition.rows[0].prosecdef, false);
      assert.ok((await db.query("select indexname from pg_indexes where tablename='inr_assistant_turns' and indexdef like '%gin%'")).rows.length > 0);
      assert.equal((await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.inr_assistant_turns'::regclass")).rows[0].relrowsecurity, true);
      assert.doesNotMatch(migration, /\b(?:cron\.schedule|delete from|drop table|truncate|interval\s+'\d+ days')\b/i);
    });
    await t.test("revoked membership immediately hides the actor's old conversations", async () => {
      await db.exec("reset role");
      await db.query("delete from public.inrcy_account_members where account_id=$1 and auth_user_id=$2", [ACCOUNT, ACTOR]);
      await asActor(db);
      assert.equal((await db.query("select * from public.inr_assistant_turns")).rows.length, 0);
      assert.equal((await db.query("select * from public.inrcy_list_assistant_conversations($1,20)", [ACCOUNT])).rows.length, 0);
    });
  } finally { await db.close(); }
});
