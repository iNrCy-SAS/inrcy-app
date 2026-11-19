import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('Basique historical and 50-credit monthly allowances use the common wallet without unlocking agents', async (t) => {
  const db = await createMediaCreditDatabase({ preferences: true });
  const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
  const migration = async name => db.exec((await readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8')).replaceAll('\r\n','\n'));
  const account = async () => {
    const id=randomUUID(),actor=randomUUID();
    await db.query('insert into auth.users values($1),($2)',[id,actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)',[id]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')",[id,actor]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)",[id]);
    return {id,actor};
  };
  const quota = (a,edition='basic') => one('select * from public.get_ai_media_generation_quota_v4($1,$2,$3)',[a.id,a.actor,edition]);
  const reserve = (a,edition='basic',kind='image',amount=7,key=randomUUID()) => one("select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,$5,'studio',$6,$7,3600,null,'{}')",[a.id,a.actor,key,'a'.repeat(64),kind,edition,amount]);
  const buy = async a => {
    const order=await one("select * from public.create_ai_media_video_credit_order($1,$2,'video_50',$3,'price_test')",[a.id,a.actor,randomUUID()]);
    await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_test',false)",[order.id,a.id]);
    await one("select public.fulfill_ai_media_video_credit_order($1,$2,$3,$4,'cus_test',false,$5,$6,'eur',$7,0,'[]')",[order.id,a.id,`cs_${order.id.replaceAll('-','')}`,`pi_${order.id.replaceAll('-','')}`,order.amount_ht_cents,order.amount_ht_cents,`evt_${randomUUID()}`]);
    return order;
  };
  const fail = (a,j) => one("select * from public.fail_ai_media_generation_v3($1,$2,'synthetic_failure','synthetic','{}')",[a.id,j.job_id]);
  try {
    await db.exec(`create type public.subscription_plan as enum ('Trial','Standard','Premium','Founder');
      alter table public.subscriptions add column plan public.subscription_plan not null default 'Standard',
        add column scheduled_plan public.subscription_plan, add column requested_plan public.subscription_plan,
        add column app_edition text not null default 'standard';
      alter table public.subscriptions add constraint subscriptions_app_edition_check check(app_edition in ('standard','premium','founder'));
      create table public.business_dna_analysis_plan_limits(edition text primary key,monthly_limit integer,
        constraint business_dna_analysis_plan_limits_edition_check check(edition in ('standard','premium','founder','admin')));
      create table public.inr_agent_actions(id uuid primary key,user_id uuid,status text,automation_key text,action_type text,metadata jsonb);`);
    const originalTrigger = (await readFile(new URL('../../supabase/migrations/20261003173649_subscription_plan_authoritative.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
    const start=originalTrigger.indexOf('create or replace function public.sync_subscription_app_edition_from_plan()');
    const end=originalTrigger.indexOf('$$;',start)+3;
    await db.exec(originalTrigger.slice(start,end));
    await db.exec('create trigger subscription_edition before insert or update on public.subscriptions for each row execute function public.sync_subscription_app_edition_from_plan()');
    for(const name of ['20261013100955_unified_media_credits','20261013114612_standard_media_credits_735','20261016150636_inr_agent_automatic_media_credit_overdraft']) await migration(name);
    const before=await db.query("select * from public.ai_media_plan_limits where edition <> 'basic' order by edition");
    await migration('20261026143000_basic_subscription_plan');
    await migration('20261026143100_basic_subscription_entitlements');
    assert.deepEqual((await db.query("select * from public.ai_media_plan_limits where edition <> 'basic' order by edition")).rows,before.rows);

    await t.test('Trial remains Standard and paid Basic resolves Basic',async()=>{
      const a=await account();
      await db.query("update public.subscriptions set plan='Trial',app_edition='basic' where user_id=$1",[a.id]);
      assert.equal((await one('select app_edition from public.subscriptions where user_id=$1',[a.id])).app_edition,'standard');
      await db.query("update public.subscriptions set plan='Basic' where user_id=$1",[a.id]);
      assert.equal((await one('select app_edition from public.subscriptions where user_id=$1',[a.id])).app_edition,'basic');
    });
    await t.test('included allowances and other offers are unchanged',async()=>{
      const a=await account();
      assert.equal((await quota(a)).included_remaining_count,0);
      assert.equal((await reserve(a)).outcome,'quota_reached');
      assert.equal((await quota(await account(),'standard')).included_remaining_count,735);
      assert.equal((await quota(await account(),'premium')).included_remaining_count,2530);
      assert.equal((await quota(await account(),'founder')).included_remaining_count,1790);
    });
    await t.test('a purchased pack funds generation, preserving account isolation',async()=>{
      const a=await account(),other=await account();
      const order=await one("select * from public.create_ai_media_video_credit_order($1,$2,'video_50',$3,'price_test')",[a.id,a.actor,randomUUID()]);
      await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_test',false)",[order.id,a.id]);
      await one("select public.fulfill_ai_media_video_credit_order($1,$2,$3,$4,'cus_test',false,$5,$6,'eur','evt_basic_test',0,'[]')",[order.id,a.id,`cs_${order.id.replaceAll('-','')}`,`pi_${order.id.replaceAll('-','')}`,order.amount_ht_cents,order.amount_ht_cents]);
      const before=await quota(a);
      assert.equal(before.included_remaining_count,0);
      assert.equal(before.purchased_remaining_count,500);
      assert.equal((await reserve(a)).outcome,'reserved');
      assert.equal((await quota(a)).purchased_remaining_count,493);
      assert.equal((await quota(other)).purchased_remaining_count,0);
      await assert.rejects(one('select * from public.get_ai_media_generation_quota_v4($1,$2,\'basic\')',[a.id,other.actor]),/ACTOR|ACCESS|AUTH|DENIED/);
    });
    await t.test('no allowance is carried from Standard after downgrading to Basique',async()=>{
      const a=await account();
      assert.equal((await quota(a,'standard')).included_remaining_count,735);
      assert.equal((await quota(a)).included_remaining_count,0);
      assert.equal((await reserve(a)).outcome,'quota_reached');
    });
    await t.test('explicit per-account zero overrides still disable generation',async()=>{
      for(const edition of ['basic','standard']) {
        const a=await account();
        await db.query('insert into public.ai_media_account_limits(account_id,image_monthly_limit_override) values($1,0)',[a.id]);
        assert.equal((await reserve(a,edition)).outcome,'premium_required');
      }
    });
    await t.test('Basique cannot borrow for an editorial agent or forge an allowance',async()=>{
      const a=await account();
      for(const [action,override] of [[randomUUID(),null],[null,735]]) {
        await assert.rejects(one("select * from public.ai_media_credit_reserve_for_context($1,$2,$3,$4,$5,'image','booster','basic',7,3600,$6,'{}')",[action,a.id,a.actor,randomUUID(),'a'.repeat(64),override]),/AI_MEDIA_BASIC_AGENT_DENIED/);
      }
    });

    const existing=await account(),paid=await account();
    assert.equal((await quota(existing)).included_remaining_count,0);
    await buy(paid);
    const paidJob=await reserve(paid,'basic','video',22);
    const paidOrderBefore=await db.query('select * from public.ai_media_video_credit_orders where account_id=$1',[paid.id]);
    const paidJobBefore=await one('select * from public.ai_media_generation_jobs where id=$1',[paidJob.job_id]);
    const legacyLedgerBefore=await db.query("select * from public.ai_media_credit_ledger where account_id=$1 and kind='migration'",[existing.id]);
    const offersBefore=await db.query("select * from public.ai_media_plan_limits where edition<>'basic' order by edition");
    await migration('20261116134533_shared_monthly_media_credit_pools');
    await migration('20261119110412_basic_monthly_media_credits_50');

    await t.test('first-time Basic wallets receive 50 immediately and the initial ledger agrees',async()=>{
      const a=await account(),q=await quota(a);
      assert.equal(q.included_limit_count,50);
      assert.equal(q.included_remaining_count,50);
      assert.equal(q.purchased_remaining_count,0);
      assert.equal(q.studio_enabled,true);
      assert.equal((await one("select included_allocated_delta from public.ai_media_credit_ledger where account_id=$1 and kind='migration'",[a.id])).included_allocated_delta,50);
      assert.deepEqual(await one("select * from public.ai_media_credit_plan($1,'basic')",[a.id]),{base_limit:50,rollover_cap:50,studio_enabled:true});
    });
    await t.test('existing Basic wallets receive exactly one uplift, preserving their historical ledger',async()=>{
      assert.equal((await quota(existing)).included_remaining_count,50);
      const j=await reserve(existing);
      assert.equal(j.outcome,'reserved');
      assert.equal((await quota(existing)).included_remaining_count,43);
      await migration('20261119110412_basic_monthly_media_credits_50');
      assert.equal((await quota(existing)).included_remaining_count,43);
      assert.deepEqual((await db.query("select * from public.ai_media_credit_ledger where account_id=$1 and kind='migration'",[existing.id])).rows,legacyLedgerBefore.rows);
      await fail(existing,j);
      assert.equal((await quota(existing)).included_remaining_count,50);
    });
    await t.test('the uplift does not change a purchased reservation, paid order or historical job',async()=>{
      const q=await quota(paid);
      assert.equal(q.included_remaining_count,50);
      assert.equal(q.purchased_remaining_count,478);
      assert.equal(q.purchased_reserved_count,22);
      assert.deepEqual((await db.query('select * from public.ai_media_video_credit_orders where account_id=$1',[paid.id])).rows,paidOrderBefore.rows);
      assert.deepEqual(await one('select * from public.ai_media_generation_jobs where id=$1',[paidJob.job_id]),paidJobBefore);
      await fail(paid,paidJob);
      assert.equal((await quota(paid)).purchased_remaining_count,500);
    });
    await t.test('images and videos share the 50 credits and purchases fund only the shortfall',async()=>{
      const a=await account();
      await buy(a);
      const first=await reserve(a,'basic','image',7);
      const second=await reserve(a,'basic','video',60);
      assert.equal(first.outcome,'reserved');
      assert.equal(second.outcome,'reserved');
      const q=await quota(a);
      assert.equal(q.included_reserved_count,50);
      assert.equal(q.purchased_reserved_count,17);
      assert.equal(q.remaining_count,483);
      await fail(a,second);await fail(a,first);
      assert.equal((await quota(a)).remaining_count,550);
      const noPurchase=await account();
      assert.equal((await reserve(noPurchase,'basic','video',51)).outcome,'quota_reached');
      const video=await reserve(noPurchase,'basic','video',22);
      assert.equal(video.outcome,'reserved');
      assert.equal((await quota(noPurchase)).included_remaining_count,28);
    });
    await t.test('monthly recharge uses the normal period rollover and preserves purchased credits',async()=>{
      const a=await account();await buy(a);await quota(a);
      await db.query("update public.ai_media_credit_periods set period_start=(date_trunc('month',timezone('UTC',now()))-interval '1 month')::date,used_count=7 where account_id=$1",[a.id]);
      const q=await quota(a);
      assert.equal(q.included_remaining_count,50);
      assert.equal(q.purchased_remaining_count,500);
      assert.equal((await quota(a)).remaining_count,550);
      assert.equal((await one("select count(*)::int n from public.ai_media_credit_ledger where account_id=$1 and kind='recharge'",[a.id])).n,1);
    });
    await t.test('downgrade and upgrade preserve the current month consumption',async()=>{
      const a=await account();await quota(a,'standard');
      await db.query('update public.ai_media_credit_periods set used_count=7 where account_id=$1',[a.id]);
      assert.equal((await quota(a)).included_remaining_count,43);
      assert.equal((await quota(a,'standard')).included_remaining_count,728);
      assert.equal((await quota(a)).included_remaining_count,43);
      assert.deepEqual((await db.query("select * from public.ai_media_plan_limits where edition<>'basic' order by edition")).rows,offersBefore.rows);
    });
    await t.test('explicit media disables, account isolation and agent restrictions remain enforced',async()=>{
      const a=await account(),other=await account();
      await db.query('insert into public.ai_media_account_limits(account_id,video_monthly_limit_override) values($1,0)',[a.id]);
      assert.equal((await quota(a)).included_remaining_count,50);
      assert.equal((await reserve(a,'basic','video',22)).outcome,'premium_required');
      assert.equal((await reserve(a)).outcome,'reserved');
      await assert.rejects(one("select * from public.get_ai_media_generation_quota_v4($1,$2,'basic')",[a.id,other.actor]),/ACTOR|ACCESS|AUTH|DENIED/);
      for(const [action,override] of [[randomUUID(),null],[null,735]]) {
        await assert.rejects(one("select * from public.ai_media_credit_reserve_for_context($1,$2,$3,$4,$5,'image','booster','basic',7,3600,$6,'{}')",[action,a.id,a.actor,randomUUID(),'a'.repeat(64),override]),/AI_MEDIA_BASIC_AGENT_DENIED/);
      }
    });
    await t.test('explicit shared pools retain one configured allowance instead of one bonus per member',async()=>{
      const a=await account(),b=await account(),pool=randomUUID();
      await db.query("update public.inrcy_account_members set auth_user_id=$2 where account_id=$1",[b.id,a.actor]);b.actor=a.actor;
      await quota(a);await quota(b);
      await db.query("insert into public.ai_media_credit_pools(id,owner_auth_user_id,label,monthly_limit,rollover_cap) values($1,$2,'Synthetic Basic pool',50,50)",[pool,a.actor]);
      await db.query('insert into public.ai_media_credit_pool_members(account_id,pool_id) values($1,$3),($2,$3)',[a.id,b.id,pool]);
      assert.equal((await quota(a)).included_remaining_count,50);
      assert.equal((await quota(b)).included_remaining_count,50);
      await reserve(a);
      assert.equal((await quota(b)).included_remaining_count,43);
    });
  } finally { await db.close(); }
});
