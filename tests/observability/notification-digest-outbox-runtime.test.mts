import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { DashboardEdition } from "../../lib/dashboardEdition.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ID = "20000000-0000-4000-8000-000000000001", NOTICE = "30000000-0000-4000-8000-000000000001";
const notice = (patch: Row = {}): Row => ({ id: NOTICE, user_id: ACCOUNT, category: "action", kind: "launch_booster", title: "Publiez", body: "Contenu utile", cta_label: "Booster", cta_url: "/dashboard?action=publish", meta: {}, read_at: null, created_at: new Date().toISOString(), ...patch });

function fixture(options: { notices?: Row[]; smtpErrors?: unknown[]; failSentWrite?: boolean; preflightFailure?: boolean; editionFailure?: boolean } = {}) {
  const delivery: Row = { id: ID, user_id: ACCOUNT, delivery_key: `v1:${"a".repeat(64)}`, notification_ids: [NOTICE], status: "queued", retry_at: "2020-01-01T00:00:00Z", expires_at: "2099-01-01T00:00:00Z", attempt_count: 0 };
  const rows: Record<string, Row[]> = { notification_digest_deliveries: [delivery], notifications: options.notices ?? [notice()], profiles: [{ user_id: ACCOUNT, contact_email: "pro@example.invalid", first_name: "Pro", last_active_at: "2026-11-01T00:00:00Z" }], inrcy_account_members: [{ account_id: ACCOUNT, auth_user_id: "owner", role: "owner" }] };
  let edition: DashboardEdition = "premium", active = true;
  const preferences: Row = { email_enabled: true, performance_enabled: true, action_enabled: true, information_enabled: true };
  const sends: Row[] = [], accepted: Row[] = [], lookups: string[] = [], smtpErrors = [...options.smtpErrors ?? []];
  const db = {
    from(table: string) {
      assert.ok(table in rows, table); const predicates: Array<(row: Row) => boolean> = []; let patch: Row | null = null, single = false;
      const finish = () => {
        if (table === "profiles" || table === "notifications") assert.ok(predicates.some(predicate => !predicate({ user_id: "foreign" })), "account ownership is always filtered");
        const found = rows[table].filter(row => predicates.every(predicate => predicate(row)));
        if (patch) {
          assert.equal(table, "notification_digest_deliveries");
          if (patch.status === "sent" && options.failSentWrite) return { data: null, error: Error("synthetic database outage after SMTP") };
          for (const row of found) Object.assign(row, structuredClone(patch));
        }
        return { data: single ? structuredClone(found[0] ?? null) : structuredClone(found), error: null };
      };
      const query = {
        select() { return query; }, limit() { return query; },
        eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return query; },
        in(key: string, values: unknown[]) { predicates.push(row => values.includes(row[key])); return query; },
        is(key: string, value: unknown) { predicates.push(row => row[key] === value); return query; },
        gt(key: string, value: unknown) { predicates.push(row => String(row[key]) > String(value)); return query; },
        update(value: Row) { patch = value; return query; },
        maybeSingle: async () => { single = true; return finish(); },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(finish).then(resolve,reject); },
      };
      return query;
    },
    auth: { admin: { getUserById: async (id: string) => { assert.equal(id,"owner"); return { data: { user: { email: "owner@example.invalid" } }, error: null }; } } },
    async rpc(name: string, args: Row) {
      assert.equal(name,"inrcy_claim_notification_digest_deliveries"); assert.equal(args.p_limit,1); assert.equal(args.p_lease_seconds,180);
      if (delivery.status === "sending" && Date.parse(String(delivery.lease_expires_at)) <= Date.now()) Object.assign(delivery,{status:"uncertain",lease_token:null,lease_expires_at:null});
      if (!["queued","deferred"].includes(String(delivery.status)) || Date.parse(String(delivery.retry_at)) > Date.now()) return { data: [], error: null };
      Object.assign(delivery,{status:"sending",attempt_count:Number(delivery.attempt_count)+1,lease_token:`lease-${delivery.attempt_count}`,lease_expires_at:new Date(Date.now()+180000).toISOString()});
      return { data: [structuredClone(delivery)], error: null };
    },
  };
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/notifications": { readNotificationPreferences: async (id: string) => { assert.equal(id,ACCOUNT); if(options.preflightFailure) throw Error("preflight unavailable"); return { preferences: structuredClone(preferences) }; } },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async (ids: string[]) => { assert.deepEqual(ids,[ACCOUNT]); return new Set(active ? ids : []); } },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async (id: string,config:{strict?:boolean}) => { assert.equal(id,ACCOUNT); assert.equal(config.strict,true); if(options.editionFailure)throw Error("rights unavailable"); lookups.push(id); return edition; } },
    "@/lib/env": { optionalEnv: (_name: string, fallback: string) => fallback },
    "@/lib/txEmailAssets": { INRCY_EMAIL_LOGO_CID: "logo", getInrcyLogoInlineAttachments: async () => [] },
    "@/lib/txMailer": { sendTxMail: async (mail: Row) => { sends.push(mail); const error = smtpErrors.shift(); if(error) throw error; accepted.push(mail); return { messageId:"smtp-accepted",accepted:[mail.to],rejected:[] }; } },
  });
  const outbox = load<typeof import("../../lib/notificationDigestOutbox.ts")>("lib/notificationDigestOutbox.ts");
  return { delivery, rows, preferences, sends, accepted, lookups, db, outbox, setEdition(value: DashboardEdition) { edition=value; }, deactivate() {active=false;}, ready() { delivery.retry_at="2020-01-01T00:00:00Z"; } };
}

test("an SMTP-deferred digest resumes once with the same stable identity and never uses backup capacity",async () => {
  const h=fixture({smtpErrors:[Object.assign(Error("auth unavailable"),{code:"TX_MAIL_FALLBACK_DEFERRED",retryAt:new Date(Date.now()+3600000).toISOString()})]});
  const first=await h.outbox.drainNotificationDigests(); assert.equal(first.deferred,1); assert.equal(h.delivery.status,"deferred"); assert.equal(h.accepted.length,0);
  assert.equal((await h.outbox.drainNotificationDigests()).processed,0,"retry_at prevents a tight loop");
  h.ready(); const resumed=await h.outbox.drainNotificationDigests(); assert.equal(resumed.sent,1); assert.equal(h.accepted.length,1);
  assert.equal(h.sends[0].messageId,h.sends[1].messageId); assert.equal(h.sends[0].idempotencyKey,h.sends[1].idempotencyKey);
  assert.ok(h.sends.every(mail=>mail.fallbackPolicy==="defer"));
  assert.equal((await h.outbox.drainNotificationDigests()).processed,0); assert.equal(h.accepted.length,1);
});

test("concurrent workers cannot claim or send the same digest twice",async () => {
  const h=fixture(); const results=await Promise.all([h.outbox.drainNotificationDigests(),h.outbox.drainNotificationDigests()]);
  assert.equal(results.reduce((sum,result)=>sum+result.sent,0),1); assert.equal(h.accepted.length,1);
});

test("ambiguous SMTP failure and expired sending leases never enter the automatic retry path",async () => {
  const ambiguous=fixture({smtpErrors:[Object.assign(Error("timeout"),{code:"ETIMEDOUT",command:"DATA"})]});
  assert.equal((await ambiguous.outbox.drainNotificationDigests()).uncertain,1); ambiguous.ready();
  assert.equal((await ambiguous.outbox.drainNotificationDigests()).processed,0); assert.equal(ambiguous.sends.length,1);
  const crashed=fixture(); await crashed.db.rpc("inrcy_claim_notification_digest_deliveries",{p_limit:1,p_lease_seconds:180});
  crashed.delivery.lease_expires_at="2020-01-01T00:00:00Z";
  assert.equal((await crashed.outbox.drainNotificationDigests()).processed,0); assert.equal(crashed.delivery.status,"uncertain"); assert.equal(crashed.sends.length,0);
});

test("a confirmed SMTP acceptance with a failed ledger write is never delivered a second time",async () => {
  const h=fixture({failSentWrite:true}); assert.equal((await h.outbox.drainNotificationDigests()).uncertain,1);
  assert.equal(h.accepted.length,1); h.ready(); assert.equal((await h.outbox.drainNotificationDigests()).processed,0); assert.equal(h.accepted.length,1);
});

test("a downgrade before retry suppresses an obsolete mailbox recommendation and keeps the source notification",async () => {
  const source=notice({kind:"connect_channels",body:"Gmail et Microsoft",meta:{missing_channels:["Gmail","Microsoft"]}});
  const h=fixture({notices:[source],smtpErrors:[{code:"TX_MAIL_FALLBACK_DEFERRED"}]});
  assert.equal((await h.outbox.drainNotificationDigests()).deferred,1); h.setEdition("standard"); h.ready();
  assert.equal((await h.outbox.drainNotificationDigests()).skipped,1); assert.equal(h.sends.length,1); assert.deepEqual(h.rows.notifications,[source]);
});

test("current email/category preferences, activation, subscription and read state govern queued delivery",async () => {
  for(const mode of ["email_off","category_off","inactive","unactivated","read","deleted"]){
    const h=fixture();
    if(mode==="email_off")h.preferences.email_enabled=false;
    if(mode==="category_off")h.preferences.action_enabled=false;
    if(mode==="inactive")h.deactivate();
    if(mode==="unactivated")h.rows.profiles[0].last_active_at=null;
    if(mode==="read")h.rows.notifications[0].read_at=new Date().toISOString();
    if(mode==="deleted")h.rows.notifications=[];
    assert.equal((await h.outbox.drainNotificationDigests()).skipped,1,mode); assert.equal(h.sends.length,0,mode);
  }
});

test("preflight failures remain deferred and the owner email fallback resolves the active account rather than another auth user",async () => {
  const failed=fixture({preflightFailure:true}); assert.equal((await failed.outbox.drainNotificationDigests()).deferred,1); assert.equal(failed.sends.length,0);
  const owner=fixture(); owner.rows.profiles[0].contact_email=null;
  assert.equal((await owner.outbox.drainNotificationDigests()).sent,1); assert.equal(owner.accepted[0].to,"owner@example.invalid");
  const rights=fixture({editionFailure:true}); assert.equal((await rights.outbox.drainNotificationDigests()).deferred,1); assert.equal(rights.sends.length,0);
});

test("digest grouping and cron route keep stable bounded identities and require cron authorization",async () => {
  const h=fixture(); const key=h.outbox.buildNotificationDigestDeliveryKey(ACCOUNT,"2026-11-15");
  assert.match(key,/^v1:[0-9a-f]{64}$/); assert.equal(key,h.outbox.buildNotificationDigestDeliveryKey(ACCOUNT,"2026-11-15"));
  assert.notEqual(key,h.outbox.buildNotificationDigestDeliveryKey(ACCOUNT,"2026-11-17"));
  let calls=0;
  const load=runtimeModules({"next/server":{NextResponse:{json:Response.json}},"@/lib/cronAuth":{isAuthorizedCronRequest:(req:Request)=>req.headers.get("authorization")==="Bearer fixture"},"@/lib/notificationDigestOutbox":{drainNotificationDigests:async()=>{calls++;return {sent:0};}}});
  const route=load<typeof import("../../app/api/cron/notification-digests/route.ts")>("app/api/cron/notification-digests/route.ts");
  assert.equal((await route.GET(new Request("https://app.invalid/api/cron/notification-digests"))).status,401); assert.equal(calls,0);
  assert.equal((await route.GET(new Request("https://app.invalid/api/cron/notification-digests",{headers:{authorization:"Bearer fixture"}}))).status,200); assert.equal(calls,1);
  const config=JSON.parse(readFileSync(new URL("../../vercel.json",import.meta.url),"utf8"));
  assert.equal(config.crons.find((cron:Row)=>cron.path==="/api/cron/notification-digests").schedule,"*/15 * * * *");
});

test("strict account-edition lookups distinguish real Basic access from unavailable subscription evidence",async()=>{
  for(const failure of [null,"inrcy_account_members","subscriptions","profiles","missing_subscription"]){
    const tables:Record<string,Row[]>={inrcy_account_members:[{account_id:ACCOUNT,auth_user_id:"owner",role:"owner"}],subscriptions:failure==="missing_subscription"?[]:[{user_id:"owner",plan:"Premium",app_edition:"premium"}],profiles:[{user_id:ACCOUNT,role:"user"}]};
    const db={from(table:string){const query={select(){return query;},in(){return query;},then(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown){return Promise.resolve({data:tables[table],error:failure===table?Error("synthetic lookup outage"):null}).then(resolve,reject);}};return query;}};
    const server=runtimeModules({"@/lib/accountBillingSubscriptionServer":{getApprovedAccountSubscriptionsForAccounts:async()=>new Map()},"@/lib/supabaseAdmin":{supabaseAdmin:db},"next/server":{NextResponse:{json:Response.json}}})<typeof import("../../lib/dashboardEditionServer.ts")>("lib/dashboardEditionServer.ts");
    if(failure)await assert.rejects(server.getDashboardEditionForAccountId(ACCOUNT,{strict:true}),/ACCOUNT_EDITION_/);
    else{
      assert.equal(await server.getDashboardEditionForAccountId(ACCOUNT,{strict:true}),"premium");tables.subscriptions[0].plan="Basic";tables.subscriptions[0].app_edition="basic";
      assert.equal(await server.getDashboardEditionForAccountId(ACCOUNT,{strict:true}),"basic");
    }
    await assert.doesNotReject(server.getDashboardEditionForAccountId(ACCOUNT),"legacy callers keep their safe fallback behavior");
  }
});
