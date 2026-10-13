import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('new recharge prices change future snapshots while a legacy paid order still grants its original rights',async()=>{
  const db=await createMediaCreditDatabase({preferences:true});
  const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
  const account=randomUUID(),actor=randomUUID();
  try {
    await db.query('insert into auth.users values($1),($2)',[account,actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)',[account]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')",[account,actor]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)",[account]);
    const create=(pack,key=randomUUID()) => one('select * from public.create_ai_media_video_credit_order($1,$2,$3,$4,$5)',[account,actor,pack,key,`price_${pack}`]);
    const old=await create('video_50');assert.equal(old.amount_ht_cents,800);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261013100955_unified_media_credits.sql',import.meta.url),'utf8'));
    const migration=await readFile(new URL('../../supabase/migrations/20261013113745_media_credit_recharge_pricing.sql',import.meta.url),'utf8');
    await db.exec(migration);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261013114612_standard_media_credits_735.sql',import.meta.url),'utf8'));
    assert.deepEqual(await one('select * from public.ai_media_video_credit_orders where id=$1',[old.id]),old);
    for(const [pack,seconds,price] of [['video_50',50,1900],['video_100',100,3500],['video_200',200,6500],['video_500',500,15500]]) {
      const fresh=await create(pack);assert.equal(fresh.amount_ht_cents,price);assert.equal(fresh.seconds,seconds);
      assert.equal(fresh.currency,'eur');assert.equal(fresh.tax_behavior,'exclusive');
    }
    await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_legacy',false)",[old.id,account]);
    const settle=() => one("select public.fulfill_ai_media_video_credit_order($1,$2,'cs_legacy','pi_legacy','cus_legacy',false,800,960,'eur','evt_legacy',0,'[]') granted",[old.id,account]);
    assert.equal((await settle()).granted,true);assert.equal((await settle()).granted,false);
    const quota=await one("select * from public.get_ai_media_generation_quota_v4($1,$2,'standard')",[account,actor]);
    assert.equal(quota.purchased_remaining_count,500);assert.equal(quota.included_remaining_count,735);
    assert.equal((await one('select * from public.ai_media_video_credit_orders where id=$1',[old.id])).amount_ht_cents,800);
    await db.exec(migration);
    assert.equal((await one('select amount_ht_cents from public.ai_media_video_credit_orders where id=$1',[old.id])).amount_ht_cents,800);
  } finally { await db.close(); }
});
