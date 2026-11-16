import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('shared included media allowance uses real SQL with isolated establishments and purchases', async t => {
  const db=await createMediaCreditDatabase({preferences:true});
  const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  const month=(await one("select date_trunc('month',timezone('UTC',now()))::date::text d")).d;
  const previous=(await one("select (date_trunc('month',timezone('UTC',now()))-interval '1 month')::date::text d")).d;
  const actor=async()=>{const id=randomUUID();await db.query('insert into auth.users values($1)',[id]);return id;};
  const account=async(owner)=>{
    owner??=await actor();
    const id=randomUUID();
    await db.query('insert into public.inrcy_accounts(id) values($1)',[id]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')",[id,owner]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)",[id]);
    return {id,actor:owner};
  };
  const quota=(a,edition='premium')=>one('select * from public.get_ai_media_generation_quota_v4($1,$2,$3)',[a.id,a.actor,edition]);
  const reserve=(a,amount=7,key=randomUUID(),metadata={})=>one("select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,'image','studio','premium',$5,3600,null,$6)",[a.id,a.actor,key,'a'.repeat(64),amount,JSON.stringify(metadata)]);
  const fail=(a,j)=>one("select * from public.fail_ai_media_generation_v3($1,$2,'test_failure','synthetic','{}')",[a.id,j.job_id]);
  const complete=async(a,j)=>{
    const id=randomUUID();
    await db.query("insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status) values($1,$2,$2,$3,'image','ai_media_generation','server_legacy','uploaded')",[id,a.id,`synthetic:${j.job_id}`]);
    return one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')",[a.id,j.job_id,id]);
  };
  const group=async(usedA=0,usedB=0)=>{
    const owner=await actor(),a=await account(owner),b=await account(owner),id=randomUUID();
    await quota(a,'standard');await quota(b,'standard');
    await db.query('update public.ai_media_credit_periods set used_count=$2 where account_id=$1 and period_start=$3',[a.id,usedA,month]);
    await db.query('update public.ai_media_credit_periods set used_count=$2 where account_id=$1 and period_start=$3',[b.id,usedB,month]);
    await db.query("insert into public.ai_media_credit_pools(id,owner_auth_user_id,label,monthly_limit,rollover_cap) values($1,$2,'Synthetic two-account pool',2530,5850)",[id,owner]);
    await db.query('insert into public.ai_media_credit_pool_members(account_id,pool_id) values($1,$3),($2,$3)',[a.id,b.id,id]);
    return {id,owner,a,b};
  };
  const oldPeriod=async(g,{usedA=2000,usedB=500,reservedB=0,at=previous}={})=>{
    await db.query('update public.ai_media_credit_pools set starts_on=$2 where id=$1',[g.id,at]);
    await db.query('update public.ai_media_credit_periods set period_start=$3,allocated_limit=2530,base_limit=2530,rollover_cap=5850,used_count=$2 where account_id=$1',[g.a.id,usedA,at]);
    await db.query('update public.ai_media_credit_periods set period_start=$4,allocated_limit=2530,base_limit=2530,rollover_cap=5850,used_count=$2,reserved_count=$3 where account_id=$1',[g.b.id,usedB,reservedB,at]);
    await db.query('insert into public.ai_media_credit_pool_periods(pool_id,period_start,allocated_limit,base_limit,rollover_cap) values($1,$2,2530,2530,5850)',[g.id,at]);
  };
  const oldJob=async(g,amount)=>{
    const j=await one("insert into public.ai_media_generation_jobs(account_id,actor_auth_user_id,request_key,request_fingerprint,media_kind,surface,edition,monthly_limit,quota_period_start,quota_unit,quota_amount,purchased_quota_amount,status,reservation_expires_at,metadata) values($1,$2,$3,$4,'image','booster','premium',2530,$5,'credit',$6,0,'reserved',now()+interval '1 hour','{}') returning id job_id",[g.b.id,g.owner,randomUUID(),'b'.repeat(64),previous,amount]);
    await db.query('insert into public.ai_media_credit_reservations values($1,$2,$3,$4,0)',[j.job_id,g.b.id,previous,amount]);return j;
  };
  try {
    await db.exec("create table public.inr_agent_actions(id uuid primary key,user_id uuid,status text,automation_key text,action_type text,metadata jsonb);grant select on public.inr_agent_actions to service_role;");
    await db.exec('create schema storage;create table storage.objects(id uuid primary key,bucket_id text,name text,created_at timestamptz);');
    await db.exec('grant select on public.pro_media_library to service_role;');
    for(const file of ['20261013100955_unified_media_credits','20261013114612_standard_media_credits_735','20261015174302_ai_media_reliability_finalization_and_temp_cleanup','20261016150636_inr_agent_automatic_media_credit_overdraft'])
      await db.exec(await readFile(new URL(`../../supabase/migrations/${file}.sql`,import.meta.url),'utf8'));
    const outside=await account(),before=await quota(outside,'standard');
    const functions=await db.query("select proname,prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('ai_media_credit_prepare','ai_media_credit_counter','ai_media_credit_release_included','ai_media_credit_finish','reserve_inr_agent_media_generation_v1') order by proname");
    const migration=await readFile(new URL('../../supabase/migrations/20261116134533_shared_monthly_media_credit_pools.sql',import.meta.url),'utf8');
    assert.doesNotMatch(migration, /cc19ec05|b5874caf|Guerlin|Sajemma/);
    await db.exec(migration);

    await t.test('native bodies and every account outside an explicit pool are unchanged',async()=>{
      assert.deepEqual(await quota(outside,'standard'),before);
      for(const row of functions.rows) {
        const name=['ai_media_credit_prepare','ai_media_credit_counter','ai_media_credit_release_included'].includes(row.proname)?`${row.proname}_unpooled_v1`:row.proname;
        assert.equal((await one("select prosrc from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name])).prosrc,row.prosrc);
      }
    });
    await t.test('one 2530-credit allocation retains the 42 + 49 already used on the two accounts',async()=>{
      const g=await group(42,49);
      assert.equal((await quota(g.a)).included_remaining_count,2439);
      assert.equal((await quota(g.b)).included_remaining_count,2439);
      assert.equal((await quota(g.b)).included_limit_count,2530);
      assert.equal((await one('select count(*)::int n from public.ai_media_credit_pool_periods where pool_id=$1',[g.id])).n,1);
      const context=await one('select * from public.get_ai_media_credit_pool_context($1,$2)',[g.b.id,g.owner]);
      assert.deepEqual(context,{pool_id:g.id,member_count:2,monthly_limit:2530});
      const key=randomUUID(),j=await reserve(g.a,7,key);
      assert.equal((await reserve(g.a,7,key)).is_replay,true);
      assert.equal((await quota(g.b)).included_remaining_count,2432);
      await complete(g.a,j);
      const second=await reserve(g.b,14);
      assert.equal((await quota(g.a)).included_remaining_count,2418);
      await fail(g.b,second);await fail(g.b,second);
      assert.equal((await quota(g.a)).included_remaining_count,2432);
      assert.equal((await quota(g.a)).included_used_count,98);
      assert.equal((await quota(g.b)).included_reserved_count,0);
    });
    await t.test('different establishments cannot each reserve the last shared credits',async()=>{
      const g=await group(2523,0);
      const attempts=await Promise.all([reserve(g.a),reserve(g.b)]);
      assert.deepEqual(attempts.map(x=>x.outcome).sort(),['quota_reached','reserved']);
      assert.equal((await quota(g.a)).remaining_count,0);
      assert.equal((await quota(g.b)).reserved_count,7);
      const lock=await one("select pg_get_functiondef('public.ai_media_credit_lock(uuid)'::regprocedure) body");
      assert.ok(lock.body.indexOf('ai-media-credit-pool-v1')<lock.body.indexOf('ai-media-credits-v1'));
    });
    await t.test('expiry from either account releases the other account hold once',async()=>{
      const g=await group(),j=await reserve(g.b,21);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1",[j.job_id]);
      assert.equal((await quota(g.a)).included_remaining_count,2530);
      assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1',[j.job_id])).status,'expired');
      assert.equal((await quota(g.b)).included_remaining_count,2530);
    });
    await t.test('purchased credits and their consumption stay on the paying establishment',async()=>{
      const g=await group(2530,0);
      await quota(g.a);await quota(g.b);
      const order=await one("select * from public.create_ai_media_video_credit_order($1,$2,'video_50',$3,'price_synthetic')",[g.b.id,g.owner,randomUUID()]);
      await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_synthetic',false)",[order.id,g.b.id]);
      await one("select public.fulfill_ai_media_video_credit_order($1,$2,$3,$4,'cus_synthetic',false,$5,$6,'eur','evt_synthetic',0,'[]')",[order.id,g.b.id,`cs_${order.id.replaceAll('-','')}`,`pi_${order.id.replaceAll('-','')}`,order.amount_ht_cents,Math.round(order.amount_ht_cents*1.2)]);
      assert.equal((await quota(g.a)).remaining_count,0);
      assert.equal((await quota(g.b)).purchased_remaining_count,500);
      const j=await reserve(g.b,14);await complete(g.b,j);
      assert.equal((await quota(g.a)).purchased_remaining_count,0);
      assert.equal((await quota(g.b)).purchased_remaining_count,486);
      assert.equal((await quota(g.a)).included_used_count,2530);
    });
    await t.test('monthly recharge is granted once and preserves a shared unused balance',async()=>{
      const g=await group();await oldPeriod(g);
      assert.equal((await quota(g.a)).included_remaining_count,2560);
      assert.equal((await quota(g.b)).included_remaining_count,2560);
      assert.equal((await one('select count(*)::int n from public.ai_media_credit_pool_periods where pool_id=$1',[g.id])).n,2);
    });
    await t.test('skipped months recharge only one allowance and enforce the shared rollover cap',async()=>{
      const g=await group(),at=(await one("select (date_trunc('month',timezone('UTC',now()))-interval '6 months')::date::text d")).d;
      await oldPeriod(g,{usedA:500,usedB:250,at});
      assert.equal((await quota(g.a)).included_remaining_count,5850);
      assert.equal((await quota(g.b)).included_remaining_count,5850);
      assert.equal((await one('select count(*)::int n from public.ai_media_credit_pool_periods where pool_id=$1',[g.id])).n,2);
    });
    await t.test('shared advances carry once even when neither individual account exceeded its own former allowance',async()=>{
      const g=await group();await oldPeriod(g,{usedA:2000,usedB:630});
      assert.equal((await quota(g.a)).included_remaining_count,2430);
      assert.equal((await quota(g.b)).included_remaining_count,2430);
      assert.equal((await quota(g.a)).included_used_count,100);
    });
    await t.test('an individual native carried debt is not added a second time to the pool debt',async()=>{
      const g=await group();await oldPeriod(g,{usedA:2700,usedB:0});
      assert.equal((await quota(g.a)).included_remaining_count,2360);
      assert.equal((await quota(g.b)).included_remaining_count,2360);
      assert.equal((await quota(g.a)).included_used_count,170);
    });
    await t.test('late cancellation repays the shared carried debt and restores rollover only once',async()=>{
      const g=await group();await oldPeriod(g,{usedA:2000,usedB:0,reservedB:700});
      const j=await oldJob(g,700);
      assert.equal((await quota(g.a)).included_remaining_count,2360);
      await fail(g.b,j);await fail(g.b,j);
      assert.equal((await quota(g.a)).included_remaining_count,3060);
      assert.equal((await quota(g.b)).included_remaining_count,3060);
      assert.equal((await quota(g.a)).included_used_count,0);
    });
    await t.test('pre-pool reservations refund only the original account imported debt, never another account debt or an old independent allowance',async()=>{
      for(const ownDebt of [false,true]) {
        const g=await group(),debtor=ownDebt?g.b:g.a;
        await db.query('update public.ai_media_credit_periods set used_count=100,carried_debt_count=100 where account_id=$1',[debtor.id]);
        await db.query('insert into public.ai_media_credit_periods(account_id,period_start,allocated_limit,base_limit,rollover_cap,used_count,reserved_count) values($1,$2,735,735,2170,$3,200)',[g.b.id,previous,ownDebt?635:0]);
        const j=await oldJob(g,200);
        assert.equal((await quota(g.a)).included_remaining_count,2430);
        await fail(g.b,j);await fail(g.b,j);
        assert.equal((await quota(g.a)).included_remaining_count,ownDebt?2530:2430);
        assert.equal((await quota(g.b)).included_remaining_count,ownDebt?2530:2430);
      }
    });
    await t.test('only the native claimed Agent action may advance shared credits',async()=>{
      const g=await group(2530,0),action=randomUUID();
      assert.equal((await reserve(g.a,7,randomUUID(),{credit_overdraft_allowed:true})).outcome,'quota_reached');
      await db.query("insert into public.inr_agent_actions values($1,$2,'executing','publish','publication','{\"editorialPlan\":true,\"editorialState\":\"generating\"}')",[action,g.b.id]);
      const j=await one("select * from public.reserve_inr_agent_media_generation_v1($1,$2,$3,$4,$5,'image','booster','premium',7,3600,null,'{}')",[action,g.b.id,g.owner,randomUUID(),'c'.repeat(64)]);
      assert.equal(j.remaining_count,-7);assert.equal((await quota(g.a)).remaining_count,-7);
      await fail(g.b,j);assert.equal((await quota(g.a)).remaining_count,0);
    });
    await t.test('configuration is private, members remain stable and an unrelated actor has no access',async()=>{
      const g=await group(),other=await account();await quota(g.a);
      await assert.rejects(db.query('select * from public.get_ai_media_credit_pool_context($1,$2)',[g.a.id,other.actor]),/ACCOUNT_ACCESS_DENIED/);
      await assert.rejects(db.query('insert into public.ai_media_credit_pool_members values($1,$2,now())',[other.id,g.id]),/MEMBERSHIP_FROZEN/);
      await assert.rejects(db.query('update public.ai_media_credit_pool_members set account_id=$2 where account_id=$1',[g.a.id,other.id]),/MEMBERSHIP_FROZEN/);
      await assert.rejects(db.query('delete from public.ai_media_credit_pool_members where account_id=$1',[g.b.id]),/MEMBERSHIP_FROZEN/);
      await assert.rejects(db.query("update public.ai_media_credit_pools set starts_on=starts_on-interval '1 month' where id=$1",[g.id]),/START_IMMUTABLE/);
      await assert.rejects(db.query('update public.ai_media_credit_pools set owner_auth_user_id=$2 where id=$1',[g.id,other.actor]),/OWNER_IMMUTABLE/);
      const security=await db.query("select proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and (proname like 'ai_media_credit_pool_%' or proname like '%_unpooled_v1' or proname='get_ai_media_credit_pool_context')");
      for(const fn of security.rows){assert.equal(fn.prosecdef,false);assert.deepEqual(fn.proconfig,['search_path=""']);}
      await db.exec('set role authenticated');
      await assert.rejects(db.query('select * from public.ai_media_credit_pools'),/permission denied/);
      await assert.rejects(db.query('update public.ai_media_credit_pool_members set pool_id=pool_id'),/permission denied/);
      await assert.rejects(db.query('select * from public.get_ai_media_credit_pool_context($1,$2)',[g.a.id,g.owner]),/permission denied/);
      await db.exec('reset role');
      await db.exec('set role service_role');
      try {
        assert.equal((await quota(g.a)).included_remaining_count,2530);
        const j=await reserve(g.b,7);assert.equal(j.outcome,'reserved');
        assert.equal((await quota(g.a)).remaining_count,2523);
        await fail(g.b,j);assert.equal((await quota(g.a)).remaining_count,2530);
        await assert.rejects(db.query('select * from public.get_ai_media_credit_pool_context($1,$2)',[g.a.id,other.actor]),/ACCOUNT_ACCESS_DENIED/);
      }finally{await db.exec('reset role');}
      await db.query("update public.inrcy_account_members set role='member' where account_id=$1",[g.b.id]);
      await assert.rejects(quota(g.a),/MEMBERSHIP_INVALID/);
      assert.deepEqual(await quota(outside,'standard'),before);
    });
  }finally{await db.close();}
});
