import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('Standard receives 735 credits, with one current-period uplift and unchanged custom allowances and legacy jobs',async()=>{
 const db=await createMediaCreditDatabase({preferences:true});
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
 const account=async()=>{
  const id=randomUUID(),actor=randomUUID();
  await db.query('insert into auth.users values($1),($2)',[id,actor]);
  await db.query('insert into public.inrcy_accounts(id) values($1)',[id]);
  await db.query("insert into public.inrcy_account_members values($1,$2,'owner')",[id,actor]);
  await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)",[id]);
  return {id,actor};
 };
 const quota=a => one("select * from public.get_ai_media_generation_quota_v4($1,$2,'standard')",[a.id,a.actor]);
 try {
  const old=await account(),custom=await account();
  await db.query('insert into public.ai_media_account_limits(account_id,video_monthly_limit_override) values($1,54)',[custom.id]);
  const job=await one("select * from public.reserve_ai_media_generation_v2($1,$2,'legacy-before-correction',$3,'video','studio','standard',8,3600,null,'{}')",[old.id,old.actor,'a'.repeat(64)]);
  await db.exec(await readFile(new URL('../../supabase/migrations/20261013100955_unified_media_credits.sql',import.meta.url),'utf8'));
  assert.equal((await quota(old)).included_limit_count,715);assert.equal((await quota(old)).included_reserved_count,80);
  assert.equal((await quota(custom)).included_limit_count,715);
  const sourceLedger=await db.query("select * from public.ai_media_credit_ledger where account_id=$1 and kind='migration'",[old.id]);
  const originalJob=await one('select * from public.ai_media_generation_jobs where id=$1',[job.job_id]);
  const migration=await readFile(new URL('../../supabase/migrations/20261013114612_standard_media_credits_735.sql',import.meta.url),'utf8');
  await db.exec(migration);
  assert.equal((await one("select video_monthly_limit from public.ai_media_plan_limits where edition='standard'")).video_monthly_limit,56);
  const corrected=await quota(old);assert.equal(corrected.included_limit_count,735);
  assert.equal(corrected.included_reserved_count,80);assert.equal(corrected.remaining_count,655);
  await quota(old);await db.exec(migration);assert.equal((await quota(old)).included_limit_count,735);
  assert.deepEqual((await db.query("select * from public.ai_media_credit_ledger where account_id=$1 and kind='migration'",[old.id])).rows,sourceLedger.rows);
  assert.deepEqual(await one('select * from public.ai_media_generation_jobs where id=$1',[job.job_id]),originalJob);
  assert.equal((await quota(custom)).included_limit_count,715);
  const fresh=await account();assert.equal((await quota(fresh)).included_limit_count,735);
  await one("select * from public.fail_ai_media_generation_v3($1,$2,'test','synthetic','{}')",[old.id,job.job_id]);
  assert.equal((await quota(old)).remaining_count,735);
  // Preserve a deliberately customized plan row rather than resetting it.
  await db.query("update public.ai_media_plan_limits set video_monthly_limit=60 where edition='standard'");
  await db.exec(migration);
  assert.equal((await one("select video_monthly_limit from public.ai_media_plan_limits where edition='standard'")).video_monthly_limit,60);
 } finally {await db.close();}
});
