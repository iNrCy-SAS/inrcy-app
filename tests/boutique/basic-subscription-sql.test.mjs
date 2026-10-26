import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('Basique has no included credits and can use purchased funds without unlocking agents', async (t) => {
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
  const reserve = (a,edition='basic',kind='image') => one("select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,$5,'studio',$6,7,3600,null,'{}')",[a.id,a.actor,randomUUID(),'a'.repeat(64),kind,edition]);
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
  } finally { await db.close(); }
});
