import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync(new URL("../../supabase/migrations/20261115180154_notification_digest_deliveries.sql",import.meta.url),"utf8");
const account = "10000000-0000-4000-8000-000000000001", group = `v1:${"a".repeat(64)}`;
const id = (value:number) => `20000000-0000-4000-8000-${String(value).padStart(12,"0")}`;

test("the real digest migration queues new cron notifications atomically and keeps claims service-only",async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.inrcy_accounts(id uuid primary key); create table public.notifications(id uuid primary key,user_id uuid not null,category text,meta jsonb,created_at timestamptz default now()); grant select,insert,update on public.notifications to service_role; grant insert on public.notifications to authenticated;");
    await db.query("insert into public.inrcy_accounts values($1)",[account]);
    await db.query("insert into public.notifications(id,user_id,category,meta) values($1,$2,'action','{}')",[id(0),account]);
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query("select * from public.notification_digest_deliveries")).rows.length,0,"no historical catch-up may guess previous SMTP acceptance");
    const privileges = (await db.query("select has_table_privilege('anon','public.notification_digest_deliveries','select') as anon_read,has_table_privilege('authenticated','public.notification_digest_deliveries','insert') as client_write,has_function_privilege('authenticated','public.inrcy_claim_notification_digest_deliveries(integer,integer)','execute') as client_claim,has_function_privilege('service_role','public.inrcy_claim_notification_digest_deliveries(integer,integer)','execute') as service_claim,(select relrowsecurity from pg_class where oid='public.notification_digest_deliveries'::regclass) as rls")).rows[0];
    assert.deepEqual(privileges,{anon_read:false,client_write:false,client_claim:false,service_claim:true,rls:true});

    await db.exec("set role service_role");
    const insert = (value:number) => db.query("insert into public.notifications(id,user_id,category,meta) values($1,$2,'action',jsonb_build_object('digest_delivery_key',$3::text))",[id(value),account,group]);
    await insert(1); await insert(2);
    let queued = (await db.query<{id:string;notification_ids:string[];status:string;delivery_key:string}>("select * from public.notification_digest_deliveries order by created_at,id")).rows;
    assert.equal(queued.length,1); assert.deepEqual(queued[0].notification_ids,[id(1),id(2)]); assert.equal(queued[0].delivery_key,group);
    const firstId = queued[0].id;
    assert.equal((await db.query("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows.length,0,"wait briefly for the generating cron to assemble its categories");
    await db.query("update public.notification_digest_deliveries set retry_at=now()-interval '1 second'");
    const claimed = (await db.query<{id:string;notification_ids:string[];lease_token:string}>("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows;
    assert.equal(claimed.length,1); assert.equal(claimed[0].id,firstId); assert.ok(claimed[0].lease_token);
    assert.equal((await db.query("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows.length,0,"another worker cannot reclaim an active lease");

    await insert(3); await insert(4);
    queued = (await db.query<typeof queued[number]>("select * from public.notification_digest_deliveries order by created_at,id")).rows;
    const next = queued.find(row=>row.id!==firstId)!;
    assert.deepEqual(queued.find(row=>row.id===firstId)?.notification_ids,[id(1),id(2)],"claimed IDs are immutable");
    assert.deepEqual(next.notification_ids,[id(3),id(4)]); assert.equal(next.delivery_key,`${group}:${id(3)}`);
    await db.query("update public.notification_digest_deliveries set lease_expires_at=now()-interval '1 second' where id=$1",[firstId]);
    await db.query("update public.notification_digest_deliveries set retry_at=now()-interval '1 second' where id=$1",[next.id]);
    const nextClaim = (await db.query<{id:string}>("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows;
    assert.deepEqual(nextClaim.map(row=>row.id),[next.id]);
    assert.equal((await db.query<{status:string}>("select status from public.notification_digest_deliveries where id=$1",[firstId])).rows[0].status,"uncertain");

    await db.query("update public.notification_digest_deliveries set status='deferred',lease_token=null,lease_expires_at=null,retry_at=now()+interval '1 hour',attempt_count=100 where id=$1",[next.id]);
    assert.equal((await db.query("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows.length,0);
    await db.query("update public.notification_digest_deliveries set retry_at=now()-interval '1 second' where id=$1",[next.id]);
    assert.equal((await db.query("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows.length,1,"a known SMTP outage must not silently discard the digest after twelve hourly deferrals");
    await db.query("update public.notification_digest_deliveries set status='sent',lease_token=null,lease_expires_at=null where id=$1",[next.id]);
    await insert(5);
    const last = (await db.query<{id:string;delivery_key:string}>("select * from public.notification_digest_deliveries where status='queued'")).rows[0];
    assert.equal(last.delivery_key,`${group}:${id(5)}`);
    await db.query("update public.notification_digest_deliveries set expires_at=now()-interval '1 second' where id=$1",[last.id]);
    assert.equal((await db.query("select * from public.inrcy_claim_notification_digest_deliveries()" )).rows.length,0);
    assert.equal((await db.query<{status:string}>("select status from public.notification_digest_deliveries where id=$1",[last.id])).rows[0].status,"skipped");

    await db.exec("begin"); await insert(6); await db.exec("rollback");
    assert.equal((await db.query("select * from public.notifications where id=$1",[id(6)])).rows.length,0);
    assert.equal((await db.query("select * from public.notification_digest_deliveries where $1=any(notification_ids)",[id(6)])).rows.length,0,"a failed notification transaction cannot orphan its queue entry");
    const before = (await db.query("select * from public.notification_digest_deliveries")).rows.length;
    await db.exec("reset role; set role authenticated"); await insert(7);
    await assert.rejects(db.query("select * from public.inrcy_claim_notification_digest_deliveries()"),/permission denied/);
    await db.exec("reset role");
    assert.equal((await db.query("select * from public.notification_digest_deliveries")).rows.length,before,"a forged client marker cannot queue platform mail");
  } finally { await db.close(); }
});
