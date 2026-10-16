import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('automatic editorial credit advances use real SQL, isolated from manual generation', async (t) => {
  const db = await createMediaCreditDatabase({ preferences: true });
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const account = async () => {
    const id = randomUUID(), actor = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [id, actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)', [id]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')", [id, actor]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)", [id]);
    return { id, actor };
  };
  const quota = (a) => one("select * from public.get_ai_media_generation_quota_v4($1,$2,'standard')", [a.id, a.actor]);
  const slot = async (a, overrides = {}) => {
    const row = { id: randomUUID(), user_id: a.id, status: 'executing', automation_key: 'publish', action_type: 'publication', metadata: {editorialPlan:true,editorialState:'generating'}, ...overrides };
    await db.query('insert into public.inr_agent_actions values($1,$2,$3,$4,$5,$6)', [row.id,row.user_id,row.status,row.automation_key,row.action_type,JSON.stringify(row.metadata)]);
    return row.id;
  };
  const manual = (a, amount, {key = randomUUID(), surface = 'studio', metadata = {}} = {}) => one(
    "select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,'image',$5,'standard',$6,3600,null,$7)",
    [a.id,a.actor,key,'a'.repeat(64),surface,amount,JSON.stringify(metadata)]);
  const automatic = (a, action, amount, key = randomUUID(), surface = 'booster') => one(
    "select * from public.reserve_inr_agent_media_generation_v1($1,$2,$3,$4,$5,'image',$6,'standard',$7,3600,null,'{}')",
    [action,a.id,a.actor,key,'b'.repeat(64),surface,amount]);
  const fail = (a,j) => one("select * from public.fail_ai_media_generation_v3($1,$2,'test_failure','synthetic failure','{}')", [a.id,j.job_id]);
  const complete = async (a,j) => {
    const media = randomUUID();
    await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
      values($1,$2,$2,$3,'image','ai_media_generation','server_legacy','uploaded',true)`, [media,a.id,`ai-media:${j.job_id}`]);
    return one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [a.id,j.job_id,media]);
  };
  const exhaust = async (a, remaining = 0) => {
    await quota(a);
    await db.query('update public.ai_media_credit_periods set used_count=allocated_limit-$2 where account_id=$1', [a.id,remaining]);
  };
  // Seed a genuine previous period rather than altering the functions' clock.
  const history = async (a, debt, months = 1, pending = false) => {
    const period = (await one("select (date_trunc('month',now())-make_interval(months=>$1))::date::text value", [months])).value;
    await db.query('insert into public.ai_media_credit_wallets(account_id) values($1)',[a.id]);
    await db.query(`insert into public.ai_media_credit_periods(account_id,period_start,allocated_limit,base_limit,rollover_cap,used_count,reserved_count)
      select $1,$2,base_limit,base_limit,rollover_cap,base_limit+$3,$4 from public.ai_media_credit_plan($1,'standard')`, [a.id,period,pending?0:debt,pending?debt:0]);
    if (!pending) return null;
    const job = await one(`insert into public.ai_media_generation_jobs(account_id,actor_auth_user_id,request_key,request_fingerprint,media_kind,surface,edition,monthly_limit,
      quota_period_start,quota_unit,quota_amount,purchased_quota_amount,status,reservation_expires_at,metadata)
      values($1,$2,$3,$4,'image','booster','standard',735,$5,'credit',$6,0,'reserved',now()+interval '1 hour','{}') returning id job_id`,
      [a.id,a.actor,randomUUID(),'c'.repeat(64),period,debt]);
    await db.query('insert into public.ai_media_credit_reservations values($1,$2,$3,$4,0)',[job.job_id,a.id,period,debt]);
    return job;
  };
  const buy = async (a) => {
    const o=await one("select * from public.create_ai_media_video_credit_order($1,$2,'video_50',$3,'price_video_50')",[a.id,a.actor,randomUUID()]);
    await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_test',false)",[o.id,a.id]);
    await one("select public.fulfill_ai_media_video_credit_order($1,$2,$3,$4,'cus_test',false,$5,$6,'eur','evt_test',0,'[]')",[o.id,a.id,`cs_${o.id.replaceAll('-','')}`,`pi_${o.id.replaceAll('-','')}`,o.amount_ht_cents,Math.round(o.amount_ht_cents*1.2)]);
  };
  try {
    await db.exec(`create table public.inr_agent_actions(id uuid primary key,user_id uuid,status text,automation_key text,action_type text,metadata jsonb);
      grant select on public.inr_agent_actions to service_role;`);
    for (const name of ['20261013100955_unified_media_credits','20261013114612_standard_media_credits_735'])
      await db.exec(await readFile(new URL(`../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
    const finalization = await readFile(new URL('../../supabase/migrations/20261015174302_ai_media_reliability_finalization_and_temp_cleanup.sql',import.meta.url),'utf8');
    const start = finalization.indexOf('create or replace function public.ai_media_credit_finish(');
    await db.exec(finalization.slice(start,finalization.indexOf('end $$;',start)+'end $$;'.length));
    const finishBefore = await one("select pg_get_functiondef('public.ai_media_credit_finish(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure) body");
    await db.exec(await readFile(new URL('../../supabase/migrations/20261016150636_inr_agent_automatic_media_credit_overdraft.sql',import.meta.url),'utf8'));
    assert.deepEqual(await one("select pg_get_functiondef('public.ai_media_credit_finish(uuid,uuid,uuid,text,text,text,jsonb)'::regprocedure) body"), finishBefore);

    await t.test('manual remains funded, including forged automatic metadata and manual Agent calls',async()=>{
      const a=await account();await exhaust(a);const action=await slot(a);
      for (const surface of ['studio','booster']) {
        const j=await manual(a,7,{surface,metadata:{credit_overdraft_allowed:true,automatic_editorial_action_id:action}});
        assert.equal(j.outcome,'quota_reached');assert.equal(j.job_id,null);
      }
      assert.equal((await one('select count(*)::int n from public.ai_media_generation_jobs where account_id=$1',[a.id])).n,0);
      const j=await automatic(a,action,7);
      assert.equal(j.outcome,'reserved');assert.equal(j.remaining_count,-7);
      assert.equal((await quota(a)).included_remaining_count,-7);
      await complete(a,j);assert.equal((await quota(a)).remaining_count,-7);
      assert.equal((await automatic(a,action,21)).remaining_count,-28);
    });
    await t.test('only a claimed, correctly scoped editorial action may borrow',async()=>{
      const a=await account(),other=await account();await exhaust(a);
      for (const overrides of [{user_id:other.id},{status:'draft'},{status:'failed'},{automation_key:'boost'},{action_type:'email'},{metadata:{editorialPlan:false,editorialState:'generating'}},{metadata:{editorialPlan:true,editorialState:'ready'}}]) {
        await assert.rejects(automatic(a,await slot(a,overrides),7),/AUTOMATIC_CREDIT_CONTEXT_DENIED/);
      }
      await assert.rejects(automatic(a,randomUUID(),7),/AUTOMATIC_CREDIT_CONTEXT_DENIED/);
      await assert.rejects(automatic(a,await slot(a),7,randomUUID(),'studio'),/AUTOMATIC_CREDIT_CONTEXT_DENIED/);
      assert.equal((await quota(a)).remaining_count,0);
    });
    await t.test('private invoker RPCs reject browser roles; service-role still verifies account ownership',async()=>{
      const a=await account();await exhaust(a);const action=await slot(a);
      const names=['ai_media_credit_reserve_for_context','reserve_inr_agent_media_generation_v1'];
      const fns=(await db.query("select proname,prosecdef,proconfig from pg_proc where proname=any($1)",[names])).rows;
      assert.equal(fns.length,2);for(const f of fns){assert.equal(f.prosecdef,false);assert.deepEqual(f.proconfig,['search_path=""']);}
      for (const role of ['anon','authenticated']) {
        await db.exec(`set role ${role}`);
        try { await assert.rejects(automatic(a,action,7),/permission denied/);await assert.rejects(manual(a,7),/permission denied/); }
        finally { await db.exec('reset role'); }
      }
      await db.exec('set role service_role');
      try { assert.equal((await automatic(a,action,7)).remaining_count,-7); }
      finally { await db.exec('reset role'); }
      await assert.rejects(automatic({...a,actor:randomUUID()},action,7),/ACCOUNT_ACCESS_DENIED/);
    });
    await t.test('idempotency, concurrent claims and failed/expired jobs cannot double charge an advance',async()=>{
      const a=await account();await exhaust(a);const action=await slot(a),key=randomUUID();
      const [first,replay]=await Promise.all([automatic(a,action,21,key),automatic(a,action,21,key)]);
      assert.equal(first.job_id,replay.job_id);assert.equal((await quota(a)).remaining_count,-21);
      await assert.rejects(automatic(a,action,22,key),/IDEMPOTENCY_CONFLICT/);
      await fail(a,first);await fail(a,first);assert.equal((await quota(a)).remaining_count,0);
      const expired=await automatic(a,action,70);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1",[expired.job_id]);
      await db.query('select public.expire_ai_media_credit_reservations(100)');
      assert.equal((await quota(a)).remaining_count,0);
      assert.equal((await one("select count(*)::int n from public.ai_media_credit_ledger where job_id=$1 and entry_key like '%:terminal'",[first.job_id])).n,1);
    });
    await t.test('existing funds are spent first, and a purchased pack offsets debt for manual affordability',async()=>{
      const a=await account();await exhaust(a);const action=await slot(a);
      await complete(a,await automatic(a,action,100));await buy(a);
      assert.equal((await quota(a)).remaining_count,400);
      assert.equal((await manual(a,401)).outcome,'quota_reached');
      const manualJob=await manual(a,400);assert.equal(manualJob.outcome,'reserved');
      assert.deepEqual(await one('select included_amount,purchased_amount from public.ai_media_credit_reservations where job_id=$1',[manualJob.job_id]),{included_amount:0,purchased_amount:400});
      await complete(a,manualJob);assert.equal((await quota(a)).remaining_count,0);
      const j=await automatic(a,action,140);
      assert.deepEqual(await one('select included_amount,purchased_amount from public.ai_media_credit_reservations where job_id=$1',[j.job_id]),{included_amount:40,purchased_amount:100});
      assert.equal((await quota(a)).remaining_count,-140);
      await fail(a,j);assert.equal((await quota(a)).remaining_count,0);
    });
    await t.test('monthly allowance repays debt, including debt larger than a refill and elapsed months',async()=>{
      for(const [debt,months,expected] of [[200,1,535],[2000,1,-1265],[2000,2,-530],[10000,12,735*12-10000],[10000,20,2170],[0,1,735],[0,6,2170]]) {
        const a=await account();await history(a,debt,months);
        assert.equal((await quota(a)).remaining_count,expected,`${debt}/${months}`);
        assert.equal((await quota(a)).remaining_count,expected,'reading twice must not refill twice');
        assert.equal((await one("select count(*)::int n from public.ai_media_credit_ledger where account_id=$1 and kind='recharge'",[a.id])).n,1);
      }
    });
    await t.test('late failures restore advances once, keeping the positive rollover cap',async()=>{
      for(const [debt,months] of [[200,1],[2000,1],[10000,12],[10000,20]]) {
        const a=await account(),j=await history(a,debt,months,true);
        const before=await quota(a);assert.equal(before.remaining_count,Math.min(2170,735*months-debt));
        await fail(a,j);await fail(a,j);
        assert.equal((await quota(a)).remaining_count,Math.min(2170,735*months));
        assert.equal((await one("select carried_debt_count from public.ai_media_credit_periods where account_id=$1 and period_start=date_trunc('month',now())::date",[a.id])).carried_debt_count,0);
      }
    });
    await t.test('a late successful job does not charge inherited debt a second time',async()=>{
      const a=await account(),j=await history(a,2000,1,true);await quota(a);
      await complete(a,j);assert.equal((await quota(a)).remaining_count,-1265);
    });
    await t.test('plan changes and explicit media disablement do not erase debt or re-enable forbidden media',async()=>{
      const a=await account();await exhaust(a);const action=await slot(a);await complete(a,await automatic(a,action,1000));
      await db.query('insert into public.ai_media_account_limits(account_id,video_monthly_limit_override) values($1,57)',[a.id]);
      assert.equal((await quota(a)).remaining_count,-990);
      await db.query('update public.ai_media_account_limits set video_monthly_limit_override=56,image_monthly_limit_override=0 where account_id=$1',[a.id]);
      assert.equal((await quota(a)).remaining_count,-990);
      assert.equal((await automatic(a,action,7)).outcome,'premium_required');
    });
  } finally { await db.close(); }
});
