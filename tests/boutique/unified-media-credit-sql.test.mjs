import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('unified credit wallet runs real SQL against synthetic local accounts', async (t) => {
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
  const quota = (a, edition = 'standard') => one('select * from public.get_ai_media_generation_quota_v4($1,$2,$3)', [a.id, a.actor, edition]);
  const reserve = (a, amount, key = randomUUID(), kind = 'video', fingerprint = 'a'.repeat(64)) => one(
    "select * from public.reserve_ai_media_generation_v3($1,$2,$3,$4,$5,'studio','standard',$6,3600,null,'{\"quote_version\":\"test-v1\"}')",
    [a.id, a.actor, key, fingerprint, kind, amount]);
  const legacyReserve = (a, amount = 8, kind = 'video', key = randomUUID()) => one(
    "select * from public.reserve_ai_media_generation_v2($1,$2,$3,$4,$5,'studio','standard',$6,3600,null,'{}')",
    [a.id, a.actor, key, 'b'.repeat(64), kind, amount]);
  const fail = (a, j) => one("select * from public.fail_ai_media_generation_v3($1,$2,'test_failure','synthetic failure','{}')", [a.id, j.job_id]);
  const createMedia = async (a, j, draft = false) => {
    const id = randomUUID();
    await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
      values($1,$2,$2,$3,$4,$5,'server_legacy','uploaded',$6)`,
      [id, a.id, `ai-media:${j.job_id}`, j.media_kind, draft ? 'ai_media_generation_draft' : 'ai_media_generation', !draft]);
    return id;
  };
  const complete = async (a, j, draft = false) => {
    const media = await createMedia(a, j, draft);
    return { media, result: await one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [a.id, j.job_id, media]) };
  };
  const buy = async (a, kind = 'video') => {
    const pack = kind === 'video' ? 'video_50' : 'image_20';
    const o = await one(`select * from public.create_ai_media_${kind}_credit_order($1,$2,$3,$4,$5)`, [a.id, a.actor, pack, randomUUID(), `price_${pack}`]);
    await one(`select * from public.prepare_ai_media_${kind}_credit_checkout($1,$2,'mode=payment','cus_test',false)`, [o.id, a.id]);
    const args = [o.id, a.id, `cs_${o.id.replaceAll('-', '')}`, `pi_${o.id.replaceAll('-', '')}`, o.amount_ht_cents, Math.round(o.amount_ht_cents * 1.2)];
    const fulfill = () => one(`select public.fulfill_ai_media_${kind}_credit_order($1,$2,$3,$4,'cus_test',false,$5,$6,'eur','evt_test',0,'[]') as granted`, args);
    await fulfill();
    return { o, fulfill, kind };
  };
  const refund = (purchase, amount) => one(`select public.refund_ai_media_${purchase.kind}_credit_order($1,$2,$3,'evt_refund') as changed`,
    [purchase.o.id, `pi_${purchase.o.id.replaceAll('-', '')}`, amount]);
  const exhaustIncluded = async (a, remaining = 0) => {
    await quota(a);
    await db.query('update public.ai_media_credit_periods set used_count=allocated_limit-$2 where account_id=$1', [a.id, remaining]);
  };
  try {
    const legacy = await account();
    const legacyVideo = await legacyReserve(legacy);
    const legacyImage = await legacyReserve(legacy, 1, 'image');
    const legacyPurchase = await buy(legacy);
    await db.query('insert into public.ai_media_account_limits(account_id,video_max_duration_seconds_override) values($1,16)',[legacy.id]);
    const before = await one('select * from public.ai_media_video_credit_orders where id=$1', [legacyPurchase.o.id]);
    await db.exec(await readFile(new URL('../../supabase/migrations/20261013100955_unified_media_credits.sql', import.meta.url), 'utf8'));

    await t.test('memorized native durations are bounded numeric values and keep unrelated settings and consent guards',async()=>{
      await db.query("insert into public.pro_tools_configs(user_id,settings) values($1,'{\"unrelated\":{\"keep\":true}}')",[legacy.id]);
      await db.query("select set_config('test.auth_user',$1,false)",[legacy.actor]);
      await db.exec('set role authenticated');
      const defaults={durationSeconds:4,connectScenes:false,withText:false,withMusic:true,withNarration:true,narrationVoice:'female',identityConsent:true};
      for(const durationSeconds of [4,15,30]) {
        const result=await one('select public.inrcy_patch_ai_media_generator_preferences_v2($1,6,true,$2::jsonb) value',[legacy.id,JSON.stringify({...defaults,durationSeconds})]);
        assert.equal(result.value.blocks['6'].defaults.durationSeconds,durationSeconds);
        assert.equal(Object.hasOwn(result.value.blocks['6'].defaults,'identityConsent'),false);
      }
      for(const durationSeconds of [1,2,3,31,1.5,'15',false,null]) {
        await assert.rejects(db.query('select public.inrcy_patch_ai_media_generator_preferences_v2($1,6,true,$2::jsonb)',[legacy.id,JSON.stringify({...defaults,durationSeconds})]),/INVALID_PATCH/);
      }
      await assert.rejects(db.query('select public.inrcy_patch_ai_media_generator_preferences_v2($1,6,true,$2::jsonb)',[legacy.id,JSON.stringify({...defaults,connectScenes:'true'})]),/INVALID_PATCH/);
      await db.exec('reset role');
      const stored=await one('select settings from public.pro_tools_configs where user_id=$1',[legacy.id]);
      assert.deepEqual(stored.settings.unrelated,{keep:true});
      const definition=await one("select pg_get_functiondef('public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)'::regprocedure) body");
      assert.equal((await one("select prosecdef from pg_proc where oid='public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)'::regprocedure")).prosecdef,false);
      assert.match(definition.body,/inrcy_can_access_account/);
      assert.match(definition.body,/for update/i);
    });

    await t.test('plans permit up to 30 seconds while intentional account caps remain unchanged',async()=>{
      assert.deepEqual((await db.query('select video_max_duration_seconds from public.ai_media_plan_limits order by edition')).rows.map(row=>row.video_max_duration_seconds),[30,30,30]);
      assert.equal((await one('select video_max_duration_seconds_override value from public.ai_media_account_limits where account_id=$1',[legacy.id])).value,16);
      await db.query('update public.ai_media_account_limits set video_max_duration_seconds_override=15 where account_id=$1',[legacy.id]);
      await assert.rejects(db.query('update public.ai_media_account_limits set video_max_duration_seconds_override=31 where account_id=$1',[legacy.id]),/check constraint/);
    });

    await t.test('conversion is once only, preserving old jobs, orders and separate purchased funds', async () => {
      const q = await quota(legacy);
      assert.equal(q.quota_unit, 'credit'); assert.equal(q.wallet_ready, true);
      assert.equal(q.included_limit_count, 715); assert.equal(q.included_reserved_count, 87);
      assert.equal(q.purchased_remaining_count, 500); assert.equal(q.remaining_count, 1128);
      await quota(legacy); await quota(legacy);
      assert.equal((await one("select count(*)::integer n from public.ai_media_credit_ledger where account_id=$1 and kind='migration'", [legacy.id])).n, 1);
      assert.equal((await one('select count(*)::integer n from public.ai_media_credit_legacy_sources where account_id=$1', [legacy.id])).n, 2);
      assert.deepEqual(await one('select * from public.ai_media_video_credit_orders where id=$1', [legacyPurchase.o.id]), before);
      assert.equal((await one('select quota_unit,quota_amount from public.ai_media_generation_jobs where id=$1', [legacyVideo.job_id])).quota_amount, 8);
    });
    await t.test('in-flight legacy completion and failure settle the converted reservation without double use', async () => {
      await complete(legacy, legacyVideo, true);
      await fail(legacy, legacyImage); await fail(legacy, legacyImage);
      const q = await quota(legacy);
      assert.equal(q.included_used_count, 80); assert.equal(q.included_reserved_count, 0);
      assert.equal(q.included_remaining_count, 635); assert.equal(q.purchased_remaining_count, 500);
      await assert.rejects(legacyReserve(legacy), /CREDIT_UNIT_REQUIRED/);
      const definition=await one("select pg_get_functiondef('public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure) body");
      const quotaLock=definition.body.indexOf('from public.ai_media_prepare_monthly_rollover');
      const creditLock=definition.body.indexOf('perform public.ai_media_credit_lock',quotaLock);
      assert.ok(quotaLock>=0 && creditLock>quotaLock,'legacy reservation rechecks the cutover after locking its old quota');
    });
    const a = await account();
    await t.test('images and videos share one credit pool; exact costs are immutable and idempotent', async () => {
      assert.equal((await quota(a)).remaining_count, 715);
      const j = await reserve(a, 45, 'credit-one', 'image');
      assert.equal((await quota(a)).reserved_count, 45);
      assert.equal((await reserve(a, 45, 'credit-one', 'image')).job_id, j.job_id);
      await assert.rejects(reserve(a, 46, 'credit-one', 'image'), /IDEMPOTENCY_CONFLICT/);
      await assert.rejects(db.query('update public.ai_media_credit_reservations set included_amount=1 where job_id=$1', [j.job_id]), /IMMUTABLE/);
      const { media } = await complete(a, j, true);
      await one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [a.id, j.job_id, media]);
      assert.equal((await quota(a)).used_count, 45);
      const v = await reserve(a, 100);
      assert.equal((await quota(a)).remaining_count, 570);
      await fail(a, v); await fail(a, v);
      assert.equal((await quota(a)).remaining_count, 670);
    });
    await t.test('competing reservations cannot exceed the pool; duplicate completions charge once', async () => {
      const c = await account(); await exhaustIncluded(c, 70);
      const results = await Promise.all([reserve(c, 50), reserve(c, 50)]);
      assert.equal(results.filter((row) => row.outcome === 'reserved').length, 1);
      assert.equal(results.filter((row) => row.outcome === 'quota_reached').length, 1);
      const winner = results.find((row) => row.job_id);
      const media = await createMedia(c, winner);
      await Promise.all([one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [c.id, winner.job_id, media]),
        one("select * from public.complete_ai_media_generation_v3($1,$2,$3,'{}')", [c.id, winner.job_id, media])]);
      assert.equal((await quota(c)).remaining_count, 20);
      assert.equal((await one("select count(*)::integer n from public.ai_media_credit_ledger where job_id=$1 and kind='completion'", [winner.job_id])).n, 1);
    });
    await t.test('a zero account override preserves disabled media despite shared purchased credits',async()=>{
      const c=await account();
      await db.query('insert into public.ai_media_account_limits(account_id,image_monthly_limit_override) values($1,0)',[c.id]);
      await buy(c);
      const before=await quota(c);
      const blocked=await reserve(c,7,randomUUID(),'image');
      assert.equal(blocked.outcome,'premium_required');assert.equal(blocked.job_id,null);
      assert.equal((await quota(c)).remaining_count,before.remaining_count);
      const allowed=await reserve(c,30);assert.equal(allowed.outcome,'reserved');await fail(c,allowed);
      await db.query('update public.ai_media_account_limits set video_monthly_limit_override=0 where account_id=$1',[c.id]);
      assert.equal((await reserve(c,1)).outcome,'premium_required');
    });
    await t.test('paid funds from both legacy pack families finance either media, and split reservations', async () => {
      const c = await account(); await exhaustIncluded(c, 10);
      await buy(c); await buy(c, 'image');
      assert.equal((await quota(c)).purchased_remaining_count, 640);
      const j = await reserve(c, 50, randomUUID(), 'image');
      assert.deepEqual(await one('select included_amount,purchased_amount from public.ai_media_credit_reservations where job_id=$1', [j.job_id]), { included_amount: 10, purchased_amount: 40 });
      await complete(c, j, true);
      assert.equal((await quota(c)).purchased_remaining_count, 600);
    });
    await t.test('Stripe refunds and debt affect the shared wallet once, without taking included quota', async () => {
      const c = await account(); await exhaustIncluded(c);
      const purchase = await buy(c);
      await complete(c, await reserve(c, 300));
      assert.equal((await quota(c)).purchased_remaining_count, 200);
      assert.equal((await refund(purchase, 480)).changed, true);
      assert.equal((await refund(purchase, 480)).changed, false);
      assert.equal((await quota(c)).purchased_debt_count, 50);
      await refund(purchase, 960);
      assert.equal((await quota(c)).purchased_debt_count, 300);
      assert.equal((await purchase.fulfill()).granted, false);
      assert.equal((await quota(c)).purchased_debt_count, 300);
      await buy(c);
      assert.equal((await quota(c)).purchased_debt_count, 0);
      assert.equal((await quota(c)).purchased_remaining_count, 200);
      assert.equal((await quota(c)).included_limit_count, 715);
    });
    await t.test('payment disputes suspend purchased funding and release it when won', async () => {
      const c = await account(); await exhaustIncluded(c); const purchase = await buy(c);
      const dispute = (status) => one("select public.reconcile_ai_media_video_credit_dispute($1,$2,$3,$4,$5,960,960,'eur',$6,'evt_dispute')", [purchase.o.id, c.id,
        `pi_${purchase.o.id.replaceAll('-', '')}`, `du_${purchase.o.id.replaceAll('-', '')}`, `ch_${purchase.o.id.replaceAll('-', '')}`, status]);
      await dispute('needs_response'); assert.equal((await quota(c)).purchased_held_count, 500);
      assert.equal((await reserve(c, 1)).outcome, 'quota_reached');
      await dispute('won'); assert.equal((await quota(c)).purchased_remaining_count, 500);
    });
    await t.test('expiry recovers persisted drafts, releases failed jobs, and old expiry cannot touch credit jobs', async () => {
      const c = await account(); const j = await reserve(c, 60);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1", [j.job_id]);
      await db.query('select public.expire_ai_media_generation_reservations(1000)');
      assert.equal((await one('select status from public.ai_media_generation_jobs where id=$1', [j.job_id])).status, 'reserved');
      await db.query('select public.expire_ai_media_credit_reservations(1000,$1)', [c.id]);
      assert.equal((await quota(c)).remaining_count, 715);
      const persisted = await reserve(c, 80); await createMedia(c, persisted);
      await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1", [persisted.job_id]);
      await db.query('select public.expire_ai_media_credit_reservations(1000,$1)', [c.id]);
      assert.equal((await quota(c)).used_count, 80);
    });
    await t.test('cross-period carry excludes pending cost then restores a late failed reservation within the cap', async () => {
      const c = await account(); const j = await reserve(c, 100);
      await db.query("update public.ai_media_credit_periods set period_start=(period_start-interval '1 month')::date where account_id=$1", [c.id]);
      // Reservation split is immutable in normal operations; synthetic history is
      // seeded with the trigger disabled only inside this isolated test database.
      await db.exec('alter table public.ai_media_credit_reservations disable trigger ai_media_credit_protect_reservation');
      await db.query("update public.ai_media_credit_reservations set period_start=(period_start-interval '1 month')::date where account_id=$1", [c.id]);
      await db.exec('alter table public.ai_media_credit_reservations enable trigger ai_media_credit_protect_reservation');
      assert.equal((await quota(c)).included_remaining_count, 1330);
      await fail(c, j);
      assert.equal((await quota(c)).included_remaining_count, 1430);
      assert.equal((await quota(c)).included_limit_count, 1430);
    });
    await t.test('tenant isolation and service-only RPC permissions', async () => {
      const c = await account();
      await assert.rejects(quota({ id: c.id, actor: a.actor }), /ACCOUNT_ACCESS_DENIED/);
      await db.query("select set_config('test.auth_user',$1,false)", [a.actor]);
      await db.exec('set role authenticated');
      const visible = (await db.query('select account_id from public.ai_media_credit_wallets')).rows;
      assert.deepEqual(visible.map((row) => row.account_id), [a.id]);
      await assert.rejects(quota(a), /permission denied/);
      await db.exec('reset role; set role service_role');
      assert.equal((await quota(a)).wallet_ready, true);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
