import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// PGLITE_MODULE permits a preinstalled, read-only runtime in constrained local
// workspaces. Normal checkouts use the pinned development dependency.
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);

test('video-credit migration and real quota RPCs with synthetic accounts', async (t) => {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const reject = (sql, args, expression) => assert.rejects(db.query(sql, args), expression);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.inrcy_accounts(id uuid primary key,created_at timestamptz not null default now());
      create table public.inrcy_account_members(account_id uuid,auth_user_id uuid,role text not null default 'owner',primary key(account_id,auth_user_id));
      create table public.subscriptions(user_id uuid primary key,start_date date,status text not null default 'active');
      create table public.pro_media_library(id uuid primary key,user_id uuid,account_id uuid,client_media_key text,media_type text,source text,
        upload_protocol text,upload_status text,is_active boolean default true,media_metadata jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.auth_user',true),'')::uuid $$;
      create function public.inrcy_can_access_account(uuid) returns boolean language sql stable security definer as $$
        select exists(select 1 from public.inrcy_account_members where account_id=$1 and auth_user_id=auth.uid()) $$;
      create function public.inrcy_touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      grant usage on schema auth to service_role,authenticated;
      grant select on public.inrcy_account_members,public.subscriptions to service_role;
    `);
    const migrations = [
      'ops/sql/2026-08-31_ai_media_generation_quota.sql',
      'ops/sql/2026-09-02_ai_media_account_limits_20_5_30_6.sql',
      'ops/sql/2026-09-02_ai_media_video_durations_8_16_24.sql',
      'supabase/migrations/20260914183000_ai_media_quota_rollover.sql',
      'supabase/migrations/20260914184500_ai_media_quota_rollover_subscription_anchor.sql',
      'supabase/migrations/20260922164725_ai_media_video_seconds_quota.sql',
      'supabase/migrations/20260930151303_ai_media_image_limits_25_50.sql',
      'supabase/migrations/20261003163341_ai_media_premium_video_196_seconds.sql',
      'supabase/migrations/20261003165614_ai_media_premium_images_70_rollover_150.sql',
      'supabase/migrations/20261011121940_video_credit_recharges.sql',
    ];
    for (const file of migrations) {
      try { await db.exec((await readFile(new URL(file, root),'utf8')).replaceAll('\r\n','\n')); }
      catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
    }
    const account = async (role = 'owner') => {
      const accountId = randomUUID(), actor = randomUUID();
      await db.query('insert into auth.users values($1),($2)',[accountId,actor]);
      await db.query('insert into public.inrcy_accounts(id) values($1)',[accountId]);
      await db.query('insert into public.inrcy_account_members values($1,$2,$3)',[accountId,actor,role]);
      await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)",[accountId]);
      return { id: accountId, actor };
    };
    const quota = async (a, edition = 'standard', kind = 'video') => (await db.query(
      'select * from public.get_ai_media_generation_quota_v3($1,$2,$3)',[a.id,a.actor,edition])).rows.find(row => row.media_kind === kind);
    const order = (a,key = randomUUID(),pack = 'video_50') => one(
      "select * from public.create_ai_media_video_credit_order($1,$2,$3,$4,$5)",[a.id,a.actor,pack,key,`price_${pack}`]);
    const paid = (a,o,refund = 0,disputes = []) => one(`select public.fulfill_ai_media_video_credit_order($1,$2,$3,$4,'cus_test',false,$5,$6,'eur','evt_test',$7,$8::jsonb) as granted`,
      [o.id,a.id,`cs_${o.id.replaceAll('-','')}`,`pi_${o.id.replaceAll('-','')}`,o.amount_ht_cents,Math.round(o.amount_ht_cents*1.2),refund,JSON.stringify(disputes)]);
    const refund = (o,amount) => one('select public.refund_ai_media_video_credit_order($1,$2,$3,$4) as changed',
      [o.id,`pi_${o.id.replaceAll('-','')}`,amount,`evt_refund_${amount}`]);
    const snapshot = (o,status,amount = Math.round(o.amount_ht_cents*1.2),currency = 'eur',id = `du_${o.id.replaceAll('-','')}`) => ({
      id,charge_id:`ch_${o.id.replaceAll('-','')}`,amount,currency,status,
    });
    const dispute = (a,o,state) => one('select public.reconcile_ai_media_video_credit_dispute($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as changed',
      [o.id,a.id,`pi_${o.id.replaceAll('-','')}`,state.id,state.charge_id,state.amount,Math.round(o.amount_ht_cents*1.2),state.currency,state.status,`evt_${state.id}_${state.status}`]);
    const wallet = a => one('select granted_seconds,revoked_seconds,used_seconds,reserved_seconds,held_seconds,dispute_revoked_seconds from public.ai_media_video_credit_balances where account_id=$1',[a.id]);
    const reserve = (a,seconds,key = randomUUID()) => one(`select * from public.reserve_ai_media_generation_v2($1,$2,$3,$4,'video','studio','standard',$5,3600,null,'{}')`,
      [a.id,a.actor,key,'a'.repeat(64),seconds]);
    const fail = (a,j) => one("select * from public.fail_ai_media_generation_v2($1,$2,'provider_failure','synthetic failure','{}')",[a.id,j.job_id]);
    const complete = async (a,j,draft = false) => {
      const media = randomUUID();
      await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
        values($1,$2,$2,$3,'video',$4,'server_legacy','uploaded',$5)`,
        [media,a.id,`ai-media:${j.job_id}`,draft ? 'ai_media_generation_draft' : 'ai_media_generation',!draft]);
      return one("select * from public.complete_ai_media_generation_v2($1,$2,$3,'{}')",[a.id,j.job_id,media]);
    };
    const exhaustMonthly = async (a) => {
      const q = await quota(a);
      await db.query("update public.ai_media_monthly_usage set used_count=$2 where account_id=$1 and media_kind='video' and period_start=$3",
        [a.id,q.limit_count-q.purchased_remaining_count,q.period_start]);
    };
    const a = await account(), b = await account();
    let purchase;

    await t.test('54/204 monthly seconds; Founder144 and existing image/rollover rules survive',async()=>{
      assert.equal((await quota(a)).limit_count,54);
      assert.equal((await quota(b,'premium')).limit_count,204);
      const founder = await account();
      assert.equal((await quota(founder,'founder')).limit_count,144);
      assert.equal((await quota(b,'premium','image')).limit_count,70);
      const definition = await one("select pg_get_functiondef('public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure) as body");
      assert.match(definition.body,/when v_plan.edition = 'premium' then 150 else 70 end/i);
    });
    await t.test('only active subscribed account owners/admins can create orders',async()=>{
      const member = await account('member');
      await reject("select * from public.create_ai_media_video_credit_order($1,$2,'video_50','blocked-member','price_video_50')",[member.id,member.actor],/PURCHASE_ACCESS_DENIED/);
      await db.query("update public.subscriptions set status='canceled' where user_id=$1",[member.id]);
      await db.query("update public.inrcy_account_members set role='owner' where account_id=$1",[member.id]);
      await assert.rejects(order(member),/ACTIVE_SUBSCRIPTION_REQUIRED/);
      await reject("select * from public.create_ai_media_video_credit_order($1,$2,'video_50','wrong-account','price_video_50')",[b.id,a.actor],/ACCOUNT_ACCESS_DENIED/);
    });
    await t.test('order creation is idempotent; same key with another pack/actor is rejected',async()=>{
      purchase = await order(a,'intent-one');
      assert.equal((await order(a,'intent-one')).id,purchase.id);
      await assert.rejects(order(a,'intent-one','video_100'),/IDEMPOTENCY_CONFLICT/);
      assert.equal((await quota(a)).purchased_remaining_count,0);
    });
    await t.test('checkout parameters are frozen for exact Stripe retry',async()=>{
      const first = await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_test',false)",[purchase.id,a.id]);
      const second = await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'tampered=true','cus_other',true)",[purchase.id,a.id]);
      assert.equal(second.checkout_params,first.checkout_params);
      assert.equal(second.stripe_customer_id,'cus_test');
      assert.equal(second.checkout_attempted_at.toISOString(),first.checkout_attempted_at.toISOString());
    });
    await t.test('payment validation rejects wrong account, amount, customer and mode without credit',async()=>{
      await assert.rejects(paid(b,purchase),/ORDER_NOT_FOUND/);
      await reject("select public.fulfill_ai_media_video_credit_order($1,$2,'cs_fake','pi_fake','cus_wrong',true,1,1,'eur','evt_bad',0)",[purchase.id,a.id],/PAYMENT_SCOPE_MISMATCH/);
      assert.equal((await quota(a)).purchased_remaining_count,0);
    });
    await t.test('verified payment grants once even with duplicate events/returns',async()=>{
      assert.equal((await paid(a,purchase)).granted,true);
      assert.equal((await paid(a,purchase)).granted,false);
      const q = await quota(a);
      assert.equal(q.included_remaining_count,54); assert.equal(q.purchased_remaining_count,50); assert.equal(q.remaining_count,104);
      assert.equal((await one("select count(*)::integer as n from public.ai_media_video_credit_ledger where kind='purchase' and order_id=$1",[purchase.id])).n,1);
      assert.equal((await quota(b)).purchased_remaining_count,0);
    });
    let mixed, paidOnly;
    await t.test('included seconds are spent first; the 8s job splits6 included+2 purchased',async()=>{
      await complete(a,await reserve(a,24)); await complete(a,await reserve(a,24));
      mixed = await reserve(a,8,'mixed-job-key');
      const row = await one('select purchased_quota_amount,monthly_limit from public.ai_media_generation_jobs where id=$1',[mixed.job_id]);
      assert.deepEqual(row,{purchased_quota_amount:2,monthly_limit:54});
      const q = await quota(a);
      assert.equal(q.included_remaining_count,0); assert.equal(q.purchased_remaining_count,48); assert.equal(q.purchased_reserved_count,2);
      assert.equal((await reserve(a,8,'mixed-job-key')).job_id,mixed.job_id);
      assert.equal((await quota(a)).purchased_reserved_count,2);
    });
    await t.test('mixed completion settles both ledgers once and protects immutable split',async()=>{
      await reject('update public.ai_media_generation_jobs set purchased_quota_amount=1 where id=$1',[mixed.job_id],/IMMUTABLE/);
      const result = await complete(a,mixed);
      assert.equal(result.used_count,56); assert.equal(result.reserved_count,0); assert.equal(result.remaining_count,48);
      const q = await quota(a); assert.equal(q.purchased_remaining_count,48); assert.equal(q.purchased_reserved_count,0);
    });
    await t.test('purchased-only failure and its replay release reservations without billing quota',async()=>{
      paidOnly = await reserve(a,16);
      assert.equal((await quota(a)).purchased_reserved_count,16);
      await fail(a,paidOnly); await fail(a,paidOnly);
      assert.equal((await quota(a)).purchased_remaining_count,48);
      assert.equal((await quota(a)).purchased_reserved_count,0);
    });
    await t.test('temporary draft consumes purchased credits before save, and final save never consumes twice',async()=>{
      const before = await quota(a);
      const draft = await reserve(a,8);
      const result = await complete(a,draft,true);
      assert.equal(result.reserved_count,0); assert.equal((await quota(a)).purchased_remaining_count,before.purchased_remaining_count-8);
      const media = await one('select output_media_id from public.ai_media_generation_jobs where id=$1',[draft.job_id]);
      await one("select * from public.complete_ai_media_generation_v2($1,$2,$3,'{}')",[a.id,draft.job_id,media.output_media_id]);
      assert.equal((await quota(a)).purchased_remaining_count,40);
    });
    await t.test('account expiry and global expiry release only their exact purchased portions',async()=>{
      for (const global of [false,true]) {
        const j = await reserve(a,16);
        await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1",[j.job_id]);
        if (global) await db.query('select public.expire_ai_media_generation_reservations(1000)');
        else await db.query('select public.ai_media_expire_account_reservations($1,1000)',[a.id]);
        assert.equal((await quota(a)).purchased_remaining_count,40); assert.equal((await quota(a)).purchased_reserved_count,0);
      }
    });
    await t.test('multiple competing requests cannot over-reserve available purchased seconds',async()=>{
      const results = await Promise.all([reserve(a,24),reserve(a,24)]);
      assert.equal(results.filter(row=>row.outcome==='quota_reached').length,1);
      assert.equal((await quota(a)).purchased_reserved_count,24);
      const winner = results.find(row=>row.job_id);
      await fail(a,winner);
    });
    await t.test('partial and reordered refunds revoke cumulatively once, then full refund yields debt',async()=>{
      assert.equal((await refund(purchase,480)).changed,true);
      assert.equal((await quota(a)).purchased_remaining_count,15);
      assert.equal((await refund(purchase,240)).changed,false);
      assert.equal((await refund(purchase,480)).changed,false);
      assert.equal((await refund(purchase,960)).changed,true);
      const q = await quota(a); assert.equal(q.purchased_remaining_count,0); assert.equal(q.purchased_debt_count,10);
      assert.equal((await one('select status from public.ai_media_video_credit_orders where id=$1',[purchase.id])).status,'refunded');
    });
    await t.test('new purchase settles paid debt, preserving independent monthly allowance',async()=>{
      const o = await order(a); await paid(a,o);
      assert.equal((await quota(a)).purchased_remaining_count,40);
      assert.equal((await quota(a)).purchased_debt_count,0);
    });
    await t.test('refund already present at initial fulfillment atomically grants and revokes, with zero spendable credit',async()=>{
      const c = await account(); const o = await order(c);
      await paid(c,o,960);
      const q = await quota(c); assert.equal(q.purchased_remaining_count,0); assert.equal(q.included_remaining_count,54);
      const o2 = await order(c);
      await assert.rejects(refund(o2,960),/AWAIT.*FULFILLMENT/);
    });
    await t.test('a month reset preserves purchased wallet and a refunded-credit debt cannot reduce included quota',async()=>{
      const c = await account(), o = await order(c); await paid(c,o); await exhaustMonthly(c);
      await complete(c,await reserve(c,8)); await refund(o,960);
      assert.equal((await quota(c)).purchased_debt_count,8);
      const before = await one('select * from public.ai_media_video_credit_balances where account_id=$1',[c.id]);
      const current = await quota(c);
      const next = await one("select * from public.ai_media_prepare_monthly_rollover($1,'video',54,168,($2::date+interval '1 month')::date)",[c.id,current.period_start]);
      assert.equal(next.limit_count,54); assert.equal(next.used_count,0);
      assert.deepEqual(await one('select * from public.ai_media_video_credit_balances where account_id=$1',[c.id]),before);
    });
    await t.test('an open dispute suspends only purchased seconds once, then won releases them',async()=>{
      const c = await account(),o = await order(c); await paid(c,o);
      const held = snapshot(o,'needs_response');
      assert.equal((await dispute(c,o,held)).changed,true);
      assert.equal((await dispute(c,o,held)).changed,false);
      let q = await quota(c);
      assert.equal(q.purchased_remaining_count,0); assert.equal(q.purchased_held_count,50);
      assert.equal(q.included_remaining_count,54); assert.equal(q.purchased_debt_count,0);
      await dispute(c,o,snapshot(o,'won'));
      q = await quota(c);
      assert.equal(q.purchased_remaining_count,50); assert.equal(q.purchased_held_count,0);
      assert.equal((await one("select count(*)::integer n from public.ai_media_video_credit_ledger where order_id=$1 and kind='dispute_hold'",[o.id])).n,1);
    });
    await t.test('disputes arriving before fulfillment survive and never make disputed credits spendable',async()=>{
      for (const status of ['under_review','lost']) {
        const c = await account(),o = await order(c);
        await dispute(c,o,snapshot(o,status));
        assert.equal((await quota(c)).purchased_remaining_count,0);
        await paid(c,o);
        const q = await quota(c);
        assert.equal(q.purchased_remaining_count,0); assert.equal(q.included_remaining_count,54);
        assert.equal((await wallet(c))[status === 'lost' ? 'dispute_revoked_seconds' : 'held_seconds'],50);
      }
      const c = await account(),o = await order(c);
      await paid(c,o,0,[snapshot(o,'needs_response')]);
      assert.equal((await quota(c)).purchased_remaining_count,0);
      assert.equal((await wallet(c)).held_seconds,50);
    });
    await t.test('refunds compose atomically with held/lost disputes without double revocation or CHECK failure',async()=>{
      for (const status of ['needs_response','lost']) {
        const c = await account(),o = await order(c); await paid(c,o);
        await dispute(c,o,snapshot(o,status));
        await refund(o,480);
        let w = await wallet(c);
        assert.equal(w.revoked_seconds,25);
        assert.equal(w.held_seconds+w.dispute_revoked_seconds,25);
        await dispute(c,o,snapshot(o,'lost'));
        w = await wallet(c); assert.equal(w.revoked_seconds+w.dispute_revoked_seconds,50);
        assert.equal(w.held_seconds,0);
        await refund(o,960);
        w = await wallet(c);
        assert.equal(w.revoked_seconds,50); assert.equal(w.dispute_revoked_seconds,0); assert.equal(w.held_seconds,0);
        await dispute(c,o,snapshot(o,'won'));
        assert.equal((await quota(c)).purchased_remaining_count,0);
        assert.equal((await quota(c)).included_remaining_count,54);
      }
      const c = await account(),o = await order(c);
      await dispute(c,o,snapshot(o,'lost'));
      await paid(c,o,480,[snapshot(o,'lost')]);
      assert.deepEqual(await wallet(c),{granted_seconds:50,revoked_seconds:25,used_seconds:0,reserved_seconds:0,held_seconds:0,dispute_revoked_seconds:25});
      await paid(c,o,960,[snapshot(o,'lost')]);
      assert.equal((await wallet(c)).revoked_seconds,50);
      assert.equal((await wallet(c)).dispute_revoked_seconds,0);
    });
    await t.test('terminal dispute progression rejects stale holds and losses but permits late reinstatement',async()=>{
      const c = await account(),o = await order(c); await paid(c,o);
      await dispute(c,o,snapshot(o,'lost'));
      assert.equal((await dispute(c,o,snapshot(o,'under_review'))).changed,false);
      await dispute(c,o,snapshot(o,'won'));
      assert.equal((await dispute(c,o,snapshot(o,'lost'))).changed,false);
      await paid(c,o,0,[snapshot(o,'lost')]);
      assert.equal((await quota(c)).purchased_remaining_count,50);
      assert.equal((await one('select stripe_status from public.ai_media_video_credit_disputes where order_id=$1',[o.id])).stripe_status,'won');
      for (const status of ['prevented','warning_closed']) {
        const d = await account(),p = await order(d); await paid(d,p);
        await dispute(d,p,snapshot(p,'warning_needs_response'));
        await dispute(d,p,snapshot(p,status));
        await dispute(d,p,snapshot(p,'lost'));
        assert.equal((await quota(d)).purchased_remaining_count,50);
      }
    });
    await t.test('in-flight jobs can finish after dispute loss, preserving monthly quota and paid debt',async()=>{
      const c = await account(),o = await order(c); await paid(c,o); await exhaustMonthly(c);
      const j = await reserve(c,16);
      await dispute(c,o,snapshot(o,'lost'));
      assert.equal((await quota(c)).purchased_debt_count,16);
      await complete(c,j);
      let q = await quota(c); assert.equal(q.purchased_reserved_count,0); assert.equal(q.purchased_debt_count,16);
      await dispute(c,o,snapshot(o,'won'));
      q = await quota(c); assert.equal(q.purchased_remaining_count,34); assert.equal(q.purchased_debt_count,0);
      const next = await one("select * from public.ai_media_prepare_monthly_rollover($1,'video',54,168,($2::date+interval '1 month')::date)",[c.id,q.period_start]);
      assert.equal(next.limit_count,54); assert.equal(next.used_count,0);
    });
    await t.test('a temporary suspended deficit is distinct from permanent paid debt and releases on win',async()=>{
      const c = await account(),o = await order(c); await paid(c,o); await exhaustMonthly(c);
      await complete(c,await reserve(c,16));
      await dispute(c,o,snapshot(o,'under_review'));
      let q = await quota(c);
      assert.equal(q.purchased_remaining_count,0); assert.equal(q.purchased_held_count,50);
      assert.equal(q.purchased_suspended_deficit_count,16); assert.equal(q.purchased_debt_count,0);
      await dispute(c,o,snapshot(o,'won'));
      q = await quota(c); assert.equal(q.purchased_remaining_count,34); assert.equal(q.purchased_suspended_deficit_count,0);
    });
    await t.test('month2 presents monthly usage separately from purchased seconds consumed in month1',async()=>{
      const c = await account(),o = await order(c); await paid(c,o); await exhaustMonthly(c);
      await complete(c,await reserve(c,16));
      let q = await quota(c);
      assert.equal(q.included_limit_count,54); assert.equal(q.included_used_count,54);
      assert.equal(q.used_count,70); assert.equal(q.purchased_remaining_count,34);
      const definition = (await one("select pg_get_functiondef('public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure) as body")).body;
      // Advance only this isolated database RPC's month, keeping actual wallet
      // and rollover functions untouched. Restore before any later checks.
      await db.exec(definition.replaceAll('pg_catalog.now()',"(pg_catalog.now()+interval '1 month')"));
      try {
        q = await quota(c);
        assert.equal(q.included_limit_count,54); assert.equal(q.included_used_count,0); assert.equal(q.included_reserved_count,0);
        assert.equal(q.included_remaining_count,54); assert.equal(q.purchased_remaining_count,34);
        assert.equal(q.used_count,16); assert.equal(q.remaining_count,88);
      } finally { await db.exec(definition); }
    });
    await t.test('partial, multiple and currency-adjusted disputes are capped to unrefunded pack seconds',async()=>{
      const c = await account(),o = await order(c); await paid(c,o);
      await dispute(c,o,snapshot(o,'needs_response',241));
      assert.equal((await wallet(c)).held_seconds,13);
      await dispute(c,o,snapshot(o,'lost',2000,'eur','dp_another'));
      let w = await wallet(c); assert.equal(w.dispute_revoked_seconds,50); assert.equal(w.held_seconds,0);
      await refund(o,480);
      w = await wallet(c); assert.equal(w.revoked_seconds,25); assert.equal(w.dispute_revoked_seconds,25);
      const d = await account(),p = await order(d); await paid(d,p);
      await dispute(d,p,snapshot(p,'under_review',1,'usd'));
      assert.equal((await wallet(d)).held_seconds,50);
      await assert.rejects(dispute(c,o,{...snapshot(o,'lost'),charge_id:'ch_wrong'}),/DISPUTE_SCOPE_MISMATCH/);
      await assert.rejects(dispute(d,o,snapshot(o,'won')),/ORDER_NOT_FOUND/);
    });
    await t.test('RPCs and wallet writes are unavailable to clients; own history uses RLS',async()=>{
      const signatures = [
        'public.create_ai_media_video_credit_order(uuid,uuid,text,text,text)',
        'public.fulfill_ai_media_video_credit_order(uuid,uuid,text,text,text,boolean,integer,integer,text,text,integer,jsonb)',
        'public.refund_ai_media_video_credit_order(uuid,text,integer,text)',
        'public.reconcile_ai_media_video_credit_dispute(uuid,uuid,text,text,text,integer,integer,text,text,text)',
        'public.refresh_ai_media_video_credit_dispute_totals(uuid,text,text,integer)',
        'public.get_ai_media_generation_quota_v3(uuid,uuid,text)',
      ];
      for (const signature of signatures) {
        const p = await one("select has_function_privilege('anon',$1,'execute') as anon,has_function_privilege('authenticated',$1,'execute') as client,has_function_privilege('service_role',$1,'execute') as server",[signature]);
        assert.deepEqual(p,{anon:false,client:false,server:true});
      }
      const policies = await one("select count(*)::integer as n from pg_class where relname like 'ai_media_video_credit_%' and relkind='r' and relrowsecurity");
      assert.equal(policies.n,5);
      await db.query("select set_config('test.auth_user',$1,false)",[a.actor]);
      await db.exec('set role authenticated');
      const visible = (await db.query('select distinct account_id from public.ai_media_video_credit_orders')).rows;
      assert.deepEqual(visible,[{account_id:a.id}]);
      await reject('update public.ai_media_video_credit_orders set seconds=500',[],/permission denied/);
      await db.exec('reset role');
      await db.exec('set role service_role');
      const server = await order(b);
      assert.equal(server.account_id,b.id);
      assert.equal((await paid(b,server)).granted,true);
      assert.equal((await quota(b)).purchased_remaining_count,50);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
