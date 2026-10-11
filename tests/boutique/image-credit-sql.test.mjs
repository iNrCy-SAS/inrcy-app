import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('image credits use real quota RPCs and an independent persistent wallet', async (t) => {
  const db = await createMediaCreditDatabase();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const account = async (role = 'owner') => {
    const id = randomUUID(), actor = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [id, actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)', [id]);
    await db.query('insert into public.inrcy_account_members values($1,$2,$3)', [id, actor, role]);
    await db.query("insert into public.subscriptions(user_id,start_date) values($1,date_trunc('month',now())::date)", [id]);
    return { id, actor };
  };
  const quota = async (a, kind = 'image', edition = 'standard') => (await db.query(
    'select * from public.get_ai_media_generation_quota_v3($1,$2,$3)', [a.id, a.actor, edition])).rows.find(row => row.media_kind === kind);
  const order = (a, key = randomUUID(), pack = 'image_20') => one(
    'select * from public.create_ai_media_image_credit_order($1,$2,$3,$4,$5)', [a.id, a.actor, pack, key, `price_${pack}`]);
  const paid = (a, o, refunded = 0, disputes = []) => one(`select public.fulfill_ai_media_image_credit_order(
    $1,$2,$3,$4,'cus_test',false,$5,$6,'eur','evt_paid',$7,$8::jsonb) as granted`,
    [o.id, a.id, `cs_${o.id.replaceAll('-', '')}`, `pi_${o.id.replaceAll('-', '')}`, o.amount_ht_cents,
      Math.round(o.amount_ht_cents * 1.2), refunded, JSON.stringify(disputes)]);
  const refund = (o, amount) => one('select public.refund_ai_media_image_credit_order($1,$2,$3,$4) as changed',
    [o.id, `pi_${o.id.replaceAll('-', '')}`, amount, `evt_refund_${amount}`]);
  const snapshot = (o, status, amount = Math.round(o.amount_ht_cents * 1.2), currency = 'eur', id = `du_${o.id.replaceAll('-', '')}`) => ({
    id, charge_id: `ch_${o.id.replaceAll('-', '')}`, amount, currency, status,
  });
  const dispute = (a, o, state) => one('select public.reconcile_ai_media_image_credit_dispute($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as changed',
    [o.id, a.id, `pi_${o.id.replaceAll('-', '')}`, state.id, state.charge_id, state.amount,
      Math.round(o.amount_ht_cents * 1.2), state.currency, state.status, `evt_${state.id}_${state.status}`]);
  const wallet = a => one('select granted_images,revoked_images,used_images,reserved_images,held_images,dispute_revoked_images from public.ai_media_image_credit_balances where account_id=$1', [a.id]);
  const reserve = (a, key = randomUUID(), surface = 'studio') => one(
    `select * from public.reserve_ai_media_generation_v2($1,$2,$3,$4,'image',$5,'standard',1,3600,null,'{}')`,
    [a.id, a.actor, key, 'a'.repeat(64), surface]);
  const fail = (a, j) => one("select * from public.fail_ai_media_generation_v2($1,$2,'provider_failure','synthetic failure','{}')", [a.id, j.job_id]);
  const complete = async (a, j, draft = false) => {
    const media = randomUUID();
    await db.query(`insert into public.pro_media_library(id,user_id,account_id,client_media_key,media_type,source,upload_protocol,upload_status,is_active)
      values($1,$2,$2,$3,'image',$4,'server_legacy','uploaded',$5)`,
    [media, a.id, `ai-media:${j.job_id}`, draft ? 'ai_media_generation_draft' : 'ai_media_generation', !draft]);
    return one("select * from public.complete_ai_media_generation_v2($1,$2,$3,'{}')", [a.id, j.job_id, media]);
  };
  const exhaustMonthly = async a => {
    const q = await quota(a);
    await db.query("update public.ai_media_monthly_usage set used_count=$2 where account_id=$1 and media_kind='image' and period_start=$3",
      [a.id, q.included_limit_count, q.period_start]);
  };
  try {
    await t.test('three server packs match accepted HT prices and included plans stay unchanged', async () => {
      assert.deepEqual((await db.query('select images,amount_ht_cents from public.ai_media_image_credit_packs order by images')).rows,
        [{ images: 20, amount_ht_cents: 500 }, { images: 50, amount_ht_cents: 1000 }, { images: 100, amount_ht_cents: 1900 }]);
      for (const [edition, images, seconds] of [['standard', 25, 54], ['premium', 70, 204], ['founder', 50, 144]]) {
        const a = await account();
        assert.equal((await quota(a, 'image', edition)).included_limit_count, images);
        assert.equal((await quota(a, 'video', edition)).included_limit_count, seconds);
      }
    });
    await t.test('SQL purchase checks owner/admin, active subscription and actor account', async () => {
      const a = await account('member'), b = await account();
      await assert.rejects(order(a), /PURCHASE_ACCESS_DENIED/);
      await assert.rejects(order({ id: b.id, actor: a.actor }), /ACCOUNT_ACCESS_DENIED/);
      await db.query("update public.inrcy_account_members set role='admin' where account_id=$1", [a.id]);
      assert.equal((await order(a)).account_id, a.id);
      await db.query("update public.subscriptions set status='canceled' where user_id=$1", [a.id]);
      await assert.rejects(order(a), /ACTIVE_SUBSCRIPTION_REQUIRED/);
    });
    await t.test('order replay cannot change pack or actor and freezes checkout parameters', async () => {
      const a = await account(), o = await order(a, 'same-image-intent');
      assert.equal((await order(a, 'same-image-intent')).id, o.id);
      await assert.rejects(order(a, 'same-image-intent', 'image_100'), /IDEMPOTENCY_CONFLICT/);
      const another = randomUUID();
      await db.query('insert into auth.users values($1)', [another]);
      await db.query("insert into public.inrcy_account_members values($1,$2,'admin')", [a.id, another]);
      await assert.rejects(order({ id: a.id, actor: another }, 'same-image-intent'), /IDEMPOTENCY_CONFLICT/);
      const prepare = params => one('select * from public.prepare_ai_media_image_credit_checkout($1,$2,$3,\'cus_test\',false)', [o.id, a.id, params]);
      assert.equal((await prepare('mode=payment')).checkout_params, (await prepare('tampered=true')).checkout_params);
    });
    await t.test('verified payment is credited exactly once, in its own account and wallet', async () => {
      const a = await account(), b = await account(), o = await order(a);
      await assert.rejects(paid(b, o), /ORDER_NOT_FOUND/);
      assert.equal((await paid(a, o)).granted, true);
      assert.equal((await paid(a, o)).granted, false);
      assert.equal((await quota(a)).remaining_count, 45);
      assert.equal((await quota(a)).purchased_remaining_count, 20);
      assert.equal((await quota(b)).purchased_remaining_count, 0);
      assert.equal((await quota(a, 'video')).purchased_remaining_count, 0);
      assert.equal((await one("select count(*)::integer n from public.ai_media_image_credit_ledger where order_id=$1 and kind='purchase'", [o.id])).n, 1);
      await assert.rejects(one("select public.fulfill_ai_media_video_credit_order($1,$2,'cs_cross','pi_cross','cus_test',false,500,600,'eur','evt_cross',0)", [o.id, a.id]), /ORDER_NOT_FOUND/);
    });
    await t.test('forged fulfillment amount or checkout binding cannot grant images', async () => {
      const a = await account(), o = await order(a);
      await one("select * from public.prepare_ai_media_image_credit_checkout($1,$2,'mode=payment','cus_test',false)", [o.id, a.id]);
      await assert.rejects(one("select public.fulfill_ai_media_image_credit_order($1,$2,'cs_bad','pi_bad','cus_other',true,1,1,'eur','evt_bad',0)", [o.id, a.id]), /PAYMENT_SCOPE_MISMATCH/);
      assert.equal((await quota(a)).purchased_remaining_count, 0);
    });
    await t.test('included allowance and rollover are consumed before bought images', async () => {
      const a = await account(), o = await order(a); await paid(a, o);
      const included = await reserve(a); await complete(a, included);
      assert.equal((await one('select purchased_quota_amount from public.ai_media_generation_jobs where id=$1', [included.job_id])).purchased_quota_amount, 0);
      assert.equal((await quota(a)).included_used_count, 1);
      assert.equal((await quota(a)).purchased_remaining_count, 20);
      await exhaustMonthly(a);
      const purchased = await reserve(a, 'one-purchased-image');
      assert.equal((await one('select purchased_quota_amount from public.ai_media_generation_jobs where id=$1', [purchased.job_id])).purchased_quota_amount, 1);
      assert.equal((await quota(a)).included_reserved_count, 0);
      assert.equal((await quota(a)).purchased_reserved_count, 1);
      assert.equal((await reserve(a, 'one-purchased-image')).job_id, purchased.job_id);
      await assert.rejects(db.query('update public.ai_media_generation_jobs set purchased_quota_amount=0 where id=$1', [purchased.job_id]), /IMMUTABLE/);
      await complete(a, purchased);
      assert.deepEqual(await wallet(a), { granted_images: 20, revoked_images: 0, used_images: 1, reserved_images: 0, held_images: 0, dispute_revoked_images: 0 });
      assert.equal((await quota(a, 'video')).used_count, 0);
    });
    await t.test('failed generation releases a bought image and repeated failure is harmless', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      const j = await reserve(a); await fail(a, j); await fail(a, j);
      assert.equal((await quota(a)).purchased_remaining_count, 20);
      assert.equal((await wallet(a)).reserved_images, 0);
      assert.equal((await wallet(a)).used_images, 0);
      assert.equal((await quota(a)).included_used_count, 25);
    });
    await t.test('temporary generated image draft is consumed once; later save never double counts', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      const j = await reserve(a); await complete(a, j, true);
      const media = await one('select output_media_id from public.ai_media_generation_jobs where id=$1', [j.job_id]);
      await one("select * from public.complete_ai_media_generation_v2($1,$2,$3,'{}')", [a.id, j.job_id, media.output_media_id]);
      assert.equal((await quota(a)).purchased_remaining_count, 19);
      assert.equal((await wallet(a)).used_images, 1);
    });
    await t.test('both expiry paths release only their purchased image reservation', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      for (const global of [false, true]) {
        const j = await reserve(a);
        await db.query("update public.ai_media_generation_jobs set reservation_expires_at=now()-interval '1 second' where id=$1", [j.job_id]);
        if (global) await db.query('select public.expire_ai_media_generation_reservations(1000)');
        else await db.query('select public.ai_media_expire_account_reservations($1,1000)', [a.id]);
        assert.equal((await quota(a)).purchased_remaining_count, 20);
        assert.equal((await wallet(a)).reserved_images, 0);
      }
    });
    await t.test('multiple requests cannot logically reserve a twenty-first bought image', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      // PGlite serializes queries: this checks reservation accounting, not a
      // claim about independent concurrent PostgreSQL network connections.
      const jobs = await Promise.all(Array.from({ length: 21 }, () => reserve(a)));
      assert.equal(jobs.filter(j => j.outcome === 'quota_reached').length, 1);
      assert.equal((await wallet(a)).reserved_images, 20);
      for (const j of jobs.filter(j => j.job_id)) await fail(a, j);
    });
    await t.test('partial/refunded repeated events revoke cumulatively with integer image rounding', async () => {
      const a = await account(), o = await order(a); await paid(a, o);
      assert.equal((await refund(o, 301)).changed, true);
      assert.equal((await wallet(a)).revoked_images, 10);
      assert.equal((await refund(o, 300)).changed, false);
      assert.equal((await refund(o, 301)).changed, false);
      await refund(o, 600);
      assert.equal((await quota(a)).purchased_remaining_count, 0);
      assert.equal((await quota(a)).included_remaining_count, 25);
    });
    await t.test('refund at first grant is atomic and early refunds require replay', async () => {
      const a = await account(), o = await order(a);
      await assert.rejects(refund(o, 600), /AWAIT.*FULFILLMENT/);
      await paid(a, o, 600);
      assert.equal((await wallet(a)).granted_images, 20);
      assert.equal((await wallet(a)).revoked_images, 20);
      assert.equal((await quota(a)).purchased_remaining_count, 0);
    });
    await t.test('after consumption, refunds create only purchased debt; a new pack settles it', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      await complete(a, await reserve(a)); await refund(o, 600);
      assert.equal((await quota(a)).purchased_debt_count, 1);
      assert.equal((await quota(a)).included_limit_count, 25);
      await paid(a, await order(a));
      assert.equal((await quota(a)).purchased_debt_count, 0);
      assert.equal((await quota(a)).purchased_remaining_count, 19);
    });
    await t.test('month2 restores included images without counting lifetime bought consumption as monthly usage', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      await complete(a, await reserve(a));
      const definition = (await one("select pg_get_functiondef('public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure) body")).body;
      await db.exec(definition.replaceAll('pg_catalog.now()', "(pg_catalog.now()+interval '1 month')"));
      try {
        const q = await quota(a);
        assert.equal(q.included_limit_count, 25); assert.equal(q.included_used_count, 0);
        assert.equal(q.included_remaining_count, 25); assert.equal(q.purchased_remaining_count, 19);
        assert.equal(q.used_count, 1); assert.equal(q.remaining_count, 44);
      } finally { await db.exec(definition); }
    });
    await t.test('a monthly rollover does not mutate image wallet or video wallet', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      const q = await quota(a), before = await wallet(a);
      const video = await one('select * from public.ai_media_video_credit_balances where account_id=$1', [a.id]);
      const next = await one("select * from public.ai_media_prepare_monthly_rollover($1,'image',25,70,($2::date+interval '1 month')::date)", [a.id, q.period_start]);
      assert.equal(next.limit_count, 25); assert.equal(next.used_count, 0);
      assert.deepEqual(await wallet(a), before);
      assert.deepEqual(await one('select * from public.ai_media_video_credit_balances where account_id=$1', [a.id]), video);
    });
    await t.test('open contestation holds only purchased images, then won/prevented releases them', async () => {
      for (const terminal of ['won', 'prevented', 'warning_closed']) {
        const a = await account(), o = await order(a); await paid(a, o);
        const held = snapshot(o, 'needs_response');
        assert.equal((await dispute(a, o, held)).changed, true);
        assert.equal((await dispute(a, o, held)).changed, false);
        assert.equal((await quota(a)).purchased_held_count, 20);
        assert.equal((await quota(a)).included_remaining_count, 25);
        await dispute(a, o, snapshot(o, terminal));
        assert.equal((await quota(a)).purchased_held_count, 0);
        assert.equal((await quota(a)).purchased_remaining_count, 20);
      }
    });
    await t.test('dispute before fulfillment is durable; bought images never become temporarily spendable', async () => {
      for (const status of ['under_review', 'lost']) {
        const a = await account(), o = await order(a); await dispute(a, o, snapshot(o, status)); await paid(a, o);
        assert.equal((await quota(a)).purchased_remaining_count, 0);
        assert.equal((await quota(a)).included_remaining_count, 25);
        const w = await wallet(a);
        assert.equal(status === 'lost' ? w.dispute_revoked_images : w.held_images, 20);
      }
    });
    await t.test('refund and dispute loss/win compose without double revocation or CHECK failure', async () => {
      for (const first of ['needs_response', 'lost']) {
        const a = await account(), o = await order(a); await paid(a, o); await dispute(a, o, snapshot(o, first));
        await refund(o, 300); await dispute(a, o, snapshot(o, 'lost'));
        let w = await wallet(a); assert.equal(w.revoked_images, 10); assert.equal(w.dispute_revoked_images, 10); assert.equal(w.held_images, 0);
        await dispute(a, o, snapshot(o, 'won'));
        w = await wallet(a); assert.equal(w.revoked_images, 10); assert.equal(w.dispute_revoked_images, 0);
        assert.equal((await quota(a)).purchased_remaining_count, 10);
        await refund(o, 600); assert.equal((await quota(a)).purchased_remaining_count, 0);
      }
    });
    await t.test('released contestation never regresses due to stale holds, losses or fulfillment snapshots', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await dispute(a, o, snapshot(o, 'lost'));
      await dispute(a, o, snapshot(o, 'won'));
      await dispute(a, o, snapshot(o, 'under_review')); await dispute(a, o, snapshot(o, 'lost'));
      await paid(a, o, 0, [snapshot(o, 'lost')]);
      assert.equal((await quota(a)).purchased_remaining_count, 20);
      assert.equal((await wallet(a)).dispute_revoked_images, 0);
    });
    await t.test('a paid job already in flight can finish after dispute loss with purchased-only debt', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      const j = await reserve(a); await dispute(a, o, snapshot(o, 'lost')); await complete(a, j);
      const q = await quota(a);
      assert.equal(q.purchased_debt_count, 1); assert.equal(q.included_used_count, 25);
      assert.equal((await wallet(a)).reserved_images, 0); assert.equal((await wallet(a)).used_images, 1);
    });
    await t.test('temporary suspension deficit is distinct from refund/loss debt', async () => {
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      await complete(a, await reserve(a)); await dispute(a, o, snapshot(o, 'under_review'));
      let q = await quota(a); assert.equal(q.purchased_debt_count, 0); assert.equal(q.purchased_suspended_deficit_count, 1);
      await dispute(a, o, snapshot(o, 'won'));
      q = await quota(a); assert.equal(q.purchased_suspended_deficit_count, 0); assert.equal(q.purchased_remaining_count, 19);
    });
    await t.test('partial and currency-adjusted disputes are capped at unrefunded images', async () => {
      const a = await account(), o = await order(a); await paid(a, o);
      await dispute(a, o, snapshot(o, 'needs_response', 151));
      assert.equal((await wallet(a)).held_images, 6);
      await dispute(a, o, snapshot(o, 'lost', 1000, 'usd', 'dp_currency'));
      assert.equal((await wallet(a)).dispute_revoked_images, 20);
      await refund(o, 300);
      const w = await wallet(a); assert.equal(w.revoked_images, 10); assert.equal(w.dispute_revoked_images, 10);
    });
    await t.test('image/video guards route each paid job to exactly one ledger', async () => {
      const guards = (await db.query(`select tgname,pg_get_triggerdef(oid) definition from pg_trigger
        where tgname in ('ai_media_image_credit_job_ledger','ai_media_video_credit_job_ledger') order by tgname`)).rows;
      assert.equal(guards.length, 2);
      assert.match(guards[0].definition, /WHEN.*media_kind.*image/); assert.match(guards[1].definition, /WHEN.*media_kind.*video/);
      const a = await account(), o = await order(a); await paid(a, o); await exhaustMonthly(a);
      const j = await reserve(a); await complete(a, j);
      assert.equal((await one('select count(*)::integer n from public.ai_media_image_credit_ledger where job_id=$1', [j.job_id])).n, 2);
      assert.equal((await one('select count(*)::integer n from public.ai_media_video_credit_ledger where job_id=$1', [j.job_id])).n, 0);
    });
    await t.test('five image tables use RLS; clients cannot grant, write wallets or call server RPCs', async () => {
      const a = await account(), b = await account(); await paid(a, await order(a)); await paid(b, await order(b));
      assert.equal((await one("select count(*)::integer n from pg_class where relname like 'ai_media_image_credit_%' and relkind='r' and relrowsecurity")).n, 5);
      for (const signature of [
        'public.create_ai_media_image_credit_order(uuid,uuid,text,text,text)',
        'public.prepare_ai_media_image_credit_checkout(uuid,uuid,text,text,boolean)',
        'public.fulfill_ai_media_image_credit_order(uuid,uuid,text,text,text,boolean,integer,integer,text,text,integer,jsonb)',
        'public.refund_ai_media_image_credit_order(uuid,text,integer,text)',
        'public.reconcile_ai_media_image_credit_dispute(uuid,uuid,text,text,text,integer,integer,text,text,text)',
        'public.refresh_ai_media_image_credit_dispute_totals(uuid,text,text,integer)',
        'public.ai_media_image_credit_metrics(uuid)',
        'public.ai_media_purchased_credit_metrics(uuid,text)',
      ]) assert.deepEqual(await one("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') client,has_function_privilege('service_role',$1,'execute') server", [signature]),
        { anon: false, client: false, server: true });
      await db.query("select set_config('test.auth_user',$1,false)", [a.actor]); await db.exec('set role authenticated');
      assert.deepEqual((await db.query('select distinct account_id from public.ai_media_image_credit_orders')).rows, [{ account_id: a.id }]);
      await assert.rejects(db.query('update public.ai_media_image_credit_orders set images=100'), /permission denied/);
      await assert.rejects(db.query('select * from public.ai_media_image_credit_balances'), /permission denied/);
      await db.exec('reset role'); await db.exec('set role service_role');
      assert.equal((await paid(a, await order(a, randomUUID(), 'image_100'))).granted, true);
      assert.equal((await quota(a)).purchased_remaining_count, 120);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});
