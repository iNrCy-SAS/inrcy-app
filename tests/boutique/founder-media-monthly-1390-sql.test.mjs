import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createMediaCreditDatabase } from '../helpers/media-credit-sql-fixture.mjs';

test('Founder recharges 1390 unified credits without rewriting existing funding or usage', async (t) => {
  const db = await createMediaCreditDatabase({ preferences: true });
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const readMigration = name => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
  const account = async () => {
    const id = randomUUID(), actor = randomUUID();
    await db.query('insert into auth.users values($1),($2)', [id, actor]);
    await db.query('insert into public.inrcy_accounts(id) values($1)', [id]);
    await db.query("insert into public.inrcy_account_members values($1,$2,'owner')", [id, actor]);
    await db.query("insert into public.subscriptions(user_id,start_date,plan) values($1,date_trunc('month',now())::date,'Founder')", [id]);
    return { id, actor };
  };
  const quota = a => one("select * from public.get_ai_media_generation_quota_v4($1,$2,'founder')", [a.id, a.actor]);
  const period = a => one('select * from public.ai_media_credit_periods where account_id=$1 order by period_start desc limit 1', [a.id]);
  const migration = await readMigration('20261111202400_founder_media_monthly_1390');
  const snapshots = async () => Object.fromEntries(await Promise.all([
    'subscriptions', 'ai_media_account_limits', 'ai_media_credit_wallets', 'ai_media_credit_periods',
    'ai_media_generation_jobs', 'ai_media_credit_ledger', 'ai_media_video_credit_orders',
    'ai_media_video_credit_balances', 'ai_media_image_credit_balances',
  ].map(async table => [table, (await db.query(`select * from public.${table} order by 1,2`)).rows])));
  try {
    // Apply the real native functions, including today's Basique branch and
    // the automatic-credit debt logic, rather than a JavaScript quota model.
    await db.exec(`create type public.subscription_plan as enum ('Trial','Standard','Premium','Founder');
      alter table public.subscriptions add column plan public.subscription_plan not null default 'Standard',
        add column scheduled_plan public.subscription_plan, add column requested_plan public.subscription_plan,
        add column app_edition text not null default 'standard';
      alter table public.subscriptions add constraint subscriptions_app_edition_check check(app_edition in ('standard','premium','founder'));
      create table public.business_dna_analysis_plan_limits(edition text primary key,monthly_limit integer,
        constraint business_dna_analysis_plan_limits_edition_check check(edition in ('standard','premium','founder','admin')));
      create table public.inr_agent_actions(id uuid primary key,user_id uuid,status text,automation_key text,action_type text,metadata jsonb);`);
    const authoritative = await readMigration('20261003173649_subscription_plan_authoritative');
    const start = authoritative.indexOf('create or replace function public.sync_subscription_app_edition_from_plan()');
    await db.exec(authoritative.slice(start, authoritative.indexOf('$$;', start) + 3));
    await db.exec('create trigger subscription_edition before insert or update on public.subscriptions for each row execute function public.sync_subscription_app_edition_from_plan()');
    for (const name of ['20261013100955_unified_media_credits', '20261013114612_standard_media_credits_735',
      '20261016150636_inr_agent_automatic_media_credit_overdraft', '20261026143000_basic_subscription_plan', '20261026143100_basic_subscription_entitlements']) {
      await db.exec(await readMigration(name));
    }
    const low = await account(), committed = await account(), debt = await account(), custom = await account(), paid = await account();
    for (const a of [low, committed, debt, paid]) assert.equal((await quota(a)).included_limit_count, 1790);
    await db.query('update public.ai_media_credit_periods set used_count=100,reserved_count=50 where account_id=$1', [low.id]);
    await db.query('update public.ai_media_credit_periods set used_count=1500,reserved_count=100 where account_id=$1', [committed.id]);
    await db.query('update public.ai_media_credit_periods set used_count=1900,reserved_count=30 where account_id=$1', [debt.id]);
    await db.query('insert into public.ai_media_account_limits(account_id,image_monthly_limit_override,video_monthly_limit_override) values($1,60,150)', [custom.id]);
    assert.equal((await quota(custom)).included_limit_count, 1920);
    const order = await one("select * from public.create_ai_media_video_credit_order($1,$2,'video_50',$3,'price_founder_test')", [paid.id, paid.actor, randomUUID()]);
    await one("select * from public.prepare_ai_media_video_credit_checkout($1,$2,'mode=payment','cus_test',false)", [order.id, paid.id]);
    await one("select public.fulfill_ai_media_video_credit_order($1,$2,$3,$4,'cus_test',false,$5,$6,'eur','evt_founder_test',0,'[]')", [order.id, paid.id, `cs_${order.id.replaceAll('-', '')}`, `pi_${order.id.replaceAll('-', '')}`, order.amount_ht_cents, Math.round(order.amount_ht_cents * 1.2)]);
    await db.query('update public.ai_media_credit_wallets set purchased_used=12,purchased_reserved=20 where account_id=$1', [paid.id]);
    const pending = await one("select * from public.reserve_ai_media_generation_v3($1,$2,'founder-existing-request',$3,'image','studio','founder',7,3600,null,'{}')", [paid.id, paid.actor, 'a'.repeat(64)]);
    assert.equal(pending.outcome, 'reserved');
    const beforePaid = await quota(paid);
    const untouched = await snapshots();
    const otherPlans = (await db.query("select * from public.ai_media_plan_limits where edition<>'founder' order by edition")).rows;
    const functions = (await db.query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in ('ai_media_credit_plan','ai_media_credit_prepare') order by proname")).rows;

    await t.test('migration changes only the Founder plan and validates the native 1390/5290 default', async () => {
      await db.exec(migration);
      assert.deepEqual(await snapshots(), untouched);
      assert.deepEqual((await db.query("select * from public.ai_media_plan_limits where edition<>'founder' order by edition")).rows, otherPlans);
      assert.deepEqual((await db.query("select proname,pg_get_functiondef(oid) body from pg_proc where proname in ('ai_media_credit_plan','ai_media_credit_prepare') order by proname")).rows, functions);
      assert.deepEqual(await one("select base_limit,rollover_cap from public.ai_media_credit_plan(null,'founder')"), { base_limit: 1390, rollover_cap: 5290 });
      for (const [edition, expected] of [['basic', 0], ['standard', 735], ['premium', 2530]]) {
        assert.equal((await one('select base_limit from public.ai_media_credit_plan(null,$1)', [edition])).base_limit, expected);
      }
    });

    await t.test('current-period reduction is once only and preserves covered use and reservations', async () => {
      const q = await quota(low);
      assert.equal(q.included_limit_count, 1390); assert.equal(q.included_used_count, 100); assert.equal(q.included_reserved_count, 50);
      assert.equal(q.included_remaining_count, 1240);
      const covered = await quota(committed);
      assert.equal(covered.included_limit_count, 1600); assert.equal(covered.included_used_count, 1500); assert.equal(covered.included_reserved_count, 100);
      assert.equal(covered.included_remaining_count, 0); assert.equal((await period(committed)).base_limit, 1390);
      const stable = await snapshots();
      await db.exec(migration); await quota(low); await quota(committed);
      assert.deepEqual(await snapshots(), stable);
    });

    await t.test('pre-existing automatic debt is retained rather than erased or deepened', async () => {
      const q = await quota(debt);
      assert.equal(q.included_limit_count, 1790); assert.equal(q.included_used_count, 1900); assert.equal(q.included_reserved_count, 30);
      assert.equal(q.included_remaining_count, -140); assert.equal((await period(debt)).base_limit, 1390);
    });

    await t.test('custom overrides, purchased funding and pending job amounts survive unchanged', async () => {
      assert.equal((await quota(custom)).included_limit_count, 1920);
      const afterPaid = await quota(paid);
      assert.equal(afterPaid.purchased_remaining_count, beforePaid.purchased_remaining_count);
      assert.equal(afterPaid.purchased_reserved_count, 20);
      assert.deepEqual((await db.query('select * from public.ai_media_credit_wallets where account_id=$1', [paid.id])).rows, untouched.ai_media_credit_wallets.filter(row => row.account_id === paid.id));
      assert.deepEqual((await db.query('select * from public.ai_media_generation_jobs where id=$1', [pending.job_id])).rows, untouched.ai_media_generation_jobs.filter(row => row.id === pending.job_id));
      assert.deepEqual((await db.query('select * from public.ai_media_video_credit_orders order by 1,2')).rows, untouched.ai_media_video_credit_orders);
      assert.deepEqual((await db.query('select * from public.subscriptions order by 1,2')).rows, untouched.subscriptions);
      assert.deepEqual((await db.query('select * from public.ai_media_account_limits order by 1,2')).rows, untouched.ai_media_account_limits);
    });

    await t.test('fresh and renewed periods use 1390 while accumulated balance remains capped at 5290', async () => {
      assert.equal((await quota(await account())).included_limit_count, 1390);
      for (const [previous, expected] of [[0, 1390], [5290, 5290]]) {
        const a = await account();
        await db.query('insert into public.ai_media_credit_wallets(account_id) values($1)', [a.id]);
        await db.query("insert into public.ai_media_credit_periods(account_id,period_start,allocated_limit,base_limit,rollover_cap) values($1,(date_trunc('month',now())-interval '1 month')::date,$2,1790,5290)", [a.id, previous]);
        const q = await quota(a);
        assert.equal(q.included_limit_count, expected); assert.equal((await period(a)).base_limit, 1390); assert.equal((await period(a)).rollover_cap, 5290);
      }
    });

    await t.test('unexpected Founder defaults fail closed instead of overwriting configuration drift', async () => {
      await db.query("update public.ai_media_plan_limits set video_monthly_limit=105 where edition='founder'");
      await assert.rejects(db.exec(migration), /AI_MEDIA_FOUNDER_RECHARGE_PLAN_DRIFT/);
      await db.exec('rollback');
      assert.equal((await one("select video_monthly_limit from public.ai_media_plan_limits where edition='founder'")).video_monthly_limit, 105);
    });
  } finally { await db.close(); }
});
