import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
const root = new URL('../../', import.meta.url);
const migration = 'supabase/migrations/20261116135131_account_subscription_entitlement_offers.sql';
const dateOnly = value => new Date(value).toISOString().slice(0,10);
const foreignKeyRestriction = error => ['23001','23503'].includes(error.code);

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.auth_user',true),'')::uuid $$;
      grant usage on schema auth to anon,authenticated,service_role;
      create type public.subscription_plan as enum ('Trial','Basic','Standard','Premium','Founder');
      create type public.stripe_subscription_status as enum
        ('trialing','active','past_due','canceled','unpaid','incomplete','incomplete_expired','paused','trial_expired');
      create table public.subscriptions(
        user_id uuid primary key references auth.users(id) on delete cascade,
        stripe_customer_id text,stripe_subscription_id text,stripe_price_id text,
        plan public.subscription_plan not null default 'Trial',
        scheduled_plan public.subscription_plan,requested_plan public.subscription_plan,
        app_edition text not null default 'standard',
        status public.stripe_subscription_status not null default 'trialing',
        monthly_price_eur numeric,monthly_price_tax_behavior text,billing_cycle text,
        start_date date,next_renewal_date date,cancel_requested_at timestamptz,end_date date,
        constraint subscriptions_app_edition_check check(app_edition in('standard','premium','founder'))
      );
      alter table public.subscriptions enable row level security;
      create policy subscriptions_select_own on public.subscriptions for select to authenticated
        using((select auth.uid())=user_id);
      grant select on public.subscriptions to authenticated;
      grant select,insert,update,delete on public.subscriptions to service_role;
    `);

    // Load the actual account/member FK definitions, the existing normalizer,
    // its Basic amendment, and finally the new migration, without SQL mocks.
    const foundation = await readFile(new URL('ops/sql/2026-07-05_multicompte_step1_foundation.sql', root), 'utf8');
    await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.inrcy_accounts'), foundation.indexOf('create table if not exists public.inrcy_multi_account_config')));
    await db.exec(`
      grant select on public.inrcy_accounts,public.inrcy_account_members to service_role;
      grant select on public.inrcy_account_members to authenticated;
      alter table public.inrcy_account_members enable row level security;
      create policy membership_select_own on public.inrcy_account_members for select to authenticated
        using(auth_user_id=(select auth.uid()));
    `);
    const authoritative = await readFile(new URL('supabase/migrations/20261003173649_subscription_plan_authoritative.sql', root), 'utf8');
    const normalizerStart = authoritative.indexOf('create or replace function public.sync_subscription_app_edition_from_plan()');
    await db.exec(authoritative.slice(normalizerStart, authoritative.indexOf('update public.subscriptions s', normalizerStart)));
    const basic = await readFile(new URL('supabase/migrations/20261026143100_basic_subscription_entitlements.sql', root), 'utf8');
    await db.exec(basic.slice(basic.indexOf('alter table public.subscriptions'), basic.indexOf('alter table public.ai_media_plan_limits')));

    // Supabase can grant default table access to API roles. The migration must
    // revoke those privileges itself rather than rely on an empty test database.
    await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role');
    await db.exec(await readFile(new URL(migration, root), 'utf8'));
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
    const asRole = async (role, work) => {
      assert.ok(['anon','authenticated','service_role'].includes(role));
      await db.exec(`set role ${role}`);
      try { return await work(); } finally { await db.exec('reset role'); }
    };
    const tenant = async () => {
      const actor = randomUUID(), secondary = randomUUID();
      const key = actor.replaceAll('-', '');
      await db.query('insert into auth.users values($1)', [actor]);
      await db.query(`insert into public.inrcy_accounts(id,display_name,created_by_auth_user_id)
        values($1,'Primary establishment',$1),($2,'Secondary establishment',$1)`, [actor,secondary]);
      await db.query(`insert into public.inrcy_account_members(auth_user_id,account_id,role,is_default)
        values($1,$1,'owner',true),($1,$2,'owner',false)`, [actor,secondary]);
      const customer = `cus_${key}`, primarySub = `sub_Primary${key}`, secondarySub = `sub_Secondary${key}`, price = 'price_Standard58';
      await asRole('service_role', () => db.query(`insert into public.subscriptions
        (user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan,status,
          monthly_price_eur,monthly_price_tax_behavior,billing_cycle,start_date,next_renewal_date)
        values($1,$2,$3,$4,'Standard','active',58,'exclusive','monthly','2026-11-10','2026-12-10')`, [actor,customer,primarySub,price]));
      return { actor, secondary, customer, primarySub, secondarySub, price };
    };
    const offer = (account, options = {}) => {
      const secondary = options.accountId === account.secondary;
      return asRole('service_role', () => one(`insert into public.inrcy_account_subscriptions
        (account_id,auth_user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan,app_edition,status,
          monthly_price_eur,monthly_price_tax_behavior,billing_cycle,start_date,next_renewal_date,entitlement_offer)
        values($1,$2,$3,$4,$5,$6,$7,'active',58,'exclusive','monthly',$8,$9,'approved_two_establishment_offer') returning *`,
      [options.accountId ?? account.actor, options.authUserId ?? account.actor,
        options.customer ?? account.customer, options.subscription ?? (secondary ? account.secondarySub : account.primarySub),
        options.price ?? account.price,options.plan ?? 'Premium',options.edition ?? 'premium',
        secondary ? '2026-11-16' : '2026-11-10',secondary ? '2026-12-16' : '2026-12-10']));
    };
    const patchStandard = (account, changes = {}) => asRole('service_role', () => one(`update public.subscriptions set
      plan='Standard',app_edition='standard',stripe_customer_id=$2,stripe_subscription_id=$3,
      stripe_price_id='price_Standard58',monthly_price_eur=58,monthly_price_tax_behavior='exclusive',
      status=$4,next_renewal_date='2027-01-10' where user_id=$1 returning *`,
    [account.actor, changes.customer ?? account.customer, changes.subscription ?? account.primarySub,changes.status ?? 'active']));
    return { db, one, asRole, tenant, offer, patchStandard };
  } catch (error) { await db.close(); throw error; }
}

test('approved establishment offers execute real PostgreSQL constraints, ownership, RLS and legacy triggers', async (t) => {
  const { db,one,asRole,tenant,offer,patchStandard } = await fixture();
  try {
    await t.test('a secondary account without auth identity receives its own binding without creating a login or legacy subscription', async () => {
      const a = await tenant();
      const authBefore = await one('select count(*)::int count from auth.users');
      const primary = await offer(a);
      const secondary = await offer(a,{accountId:a.secondary});
      assert.equal(primary.stripe_subscription_id,a.primarySub);
      assert.equal(secondary.stripe_subscription_id,a.secondarySub);
      assert.equal(primary.auth_user_id,secondary.auth_user_id);
      assert.equal(secondary.account_id,a.secondary);
      assert.equal(primary.monthly_price_eur,'58');
      assert.equal(secondary.monthly_price_eur,'58');
      assert.equal(primary.monthly_price_tax_behavior,'exclusive');
      assert.equal(secondary.monthly_price_tax_behavior,'exclusive');
      assert.equal(dateOnly(primary.start_date),'2026-11-10');
      assert.equal(dateOnly(secondary.start_date),'2026-11-16');
      assert.deepEqual(await one('select count(*)::int count from auth.users'),authBefore);
      assert.equal((await one('select count(*)::int count from auth.users where id=$1',[a.secondary])).count,0);
      assert.equal((await one('select count(*)::int count from public.subscriptions where user_id=$1',[a.secondary])).count,0);
      await assert.rejects(asRole('service_role', () => db.query("insert into public.subscriptions(user_id,plan) values($1,'Premium')",[a.secondary])), {code:'23503'}, 'the real auth FK rejects a fabricated secondary login');
    });

    await t.test('only a real owner may be the payer and both insert and update enforce ownership', async () => {
      const a = await tenant(), b = await tenant();
      await assert.rejects(offer(a,{accountId:a.secondary,authUserId:b.actor}), /ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
      await db.query("insert into public.inrcy_account_members(auth_user_id,account_id,role) values($1,$2,'admin')",[b.actor,a.secondary]);
      await assert.rejects(offer(a,{accountId:a.secondary,authUserId:b.actor}), /ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
      await db.query("update public.inrcy_account_members set role='member' where auth_user_id=$1 and account_id=$2",[b.actor,a.secondary]);
      await assert.rejects(offer(a,{accountId:a.secondary,authUserId:b.actor}), /ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
      await offer(a,{accountId:a.secondary});
      await assert.rejects(asRole('service_role', () => db.query('update public.inrcy_account_subscriptions set auth_user_id=$2 where account_id=$1',[a.secondary,b.actor])), /ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED/);
      assert.equal((await one('select auth_user_id from public.inrcy_account_subscriptions where account_id=$1',[a.secondary])).auth_user_id,a.actor);
    });

    await t.test('API clients cannot read or self-award offers, including the legitimate owner', async () => {
      const a = await tenant(); await offer(a);
      await db.query("select set_config('test.auth_user',$1,false)",[a.actor]);
      const security = await one(`select relrowsecurity from pg_class where oid='public.inrcy_account_subscriptions'::regclass`);
      assert.equal(security.relrowsecurity,true);
      for (const role of ['anon','authenticated']) {
        const grants = await one(`select has_table_privilege($1,'public.inrcy_account_subscriptions','SELECT') read,
          has_table_privilege($1,'public.inrcy_account_subscriptions','INSERT') insert,
          has_table_privilege($1,'public.inrcy_account_subscriptions','UPDATE') update,
          has_table_privilege($1,'public.inrcy_account_subscriptions','DELETE') delete`,[role]);
        assert.deepEqual(grants,{read:false,insert:false,update:false,delete:false});
        for (const sql of ['select * from public.inrcy_account_subscriptions',
          "update public.inrcy_account_subscriptions set plan='Premium'",
          'delete from public.inrcy_account_subscriptions']) {
          await assert.rejects(asRole(role, () => db.query(sql)), {code:'42501'});
        }
        for (const signature of ['public.inrcy_account_subscription_offer_guard()','public.inrcy_preserve_account_subscription_offer()']) {
          assert.equal((await one('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).allowed,false);
        }
      }
      assert.equal((await asRole('service_role', () => one('select count(*)::int count from public.inrcy_account_subscriptions where account_id=$1',[a.actor]))).count,1);
      assert.deepEqual((await asRole('authenticated', () => db.query('select user_id from public.subscriptions'))).rows,[{user_id:a.actor}], 'legacy owner-only SELECT still works');
    });

    await t.test('RLS independently denies client access even if an accidental table grant reappears', async () => {
      const a = await tenant(); await offer(a);
      await db.query("select set_config('test.auth_user',$1,false)",[a.actor]);
      await db.exec('grant select,insert,update,delete on public.inrcy_account_subscriptions to authenticated');
      try {
        assert.deepEqual((await asRole('authenticated', () => db.query('select * from public.inrcy_account_subscriptions'))).rows,[]);
        await asRole('authenticated', () => db.query('update public.inrcy_account_subscriptions set monthly_price_eur=0'));
        await asRole('authenticated', () => db.query('delete from public.inrcy_account_subscriptions'));
        const source = await one('select * from public.inrcy_account_subscriptions where account_id=$1',[a.actor]);
        assert.equal(source.monthly_price_eur,'58');
        await assert.rejects(asRole('authenticated', () => db.query(`insert into public.inrcy_account_subscriptions
          select $1,auth_user_id,stripe_customer_id,'sub_SelfAward',stripe_price_id,plan,app_edition,status,
          monthly_price_eur,monthly_price_tax_behavior,billing_cycle,billing_provider,contact_email,start_date,
          next_renewal_date,cancel_requested_at,end_date,entitlement_offer,created_at,updated_at
          from json_populate_record(null::public.inrcy_account_subscriptions,$2::json)`,[a.secondary,JSON.stringify(source)])), {code:'42501'});
      } finally { await db.exec('revoke all on public.inrcy_account_subscriptions from authenticated'); }
    });

    await t.test('the late trigger preserves approved Premium after the actual legacy Standard normalizer and keeps both 58 euro contracts', async () => {
      const a = await tenant(); await offer(a); await offer(a,{accountId:a.secondary});
      const names = (await db.query(`select tgname from pg_trigger where tgrelid='public.subscriptions'::regclass
        and not tgisinternal order by tgname`)).rows.map(row=>row.tgname);
      assert.ok(names.indexOf('trg_sync_subscription_app_edition_from_plan') < names.indexOf('zzz_inrcy_preserve_account_subscription_offer'));
      const legacy = await patchStandard(a);
      assert.equal(legacy.plan,'Premium');
      assert.equal(legacy.app_edition,'premium');
      assert.equal(legacy.stripe_subscription_id,a.primarySub);
      assert.equal(legacy.stripe_customer_id,a.customer);
      assert.equal(legacy.stripe_price_id,a.price);
      assert.equal(legacy.monthly_price_eur,'58');
      assert.equal(legacy.monthly_price_tax_behavior,'exclusive');
      assert.equal(legacy.billing_cycle,'monthly');
      assert.equal(dateOnly(legacy.next_renewal_date),'2027-01-10');
      const offers = (await db.query('select plan,app_edition,monthly_price_eur,stripe_subscription_id from public.inrcy_account_subscriptions where auth_user_id=$1 order by start_date',[a.actor])).rows;
      assert.deepEqual(offers.map(row=>[row.plan,row.app_edition,row.monthly_price_eur]),[['Premium','premium','58'],['Premium','premium','58']]);
      assert.deepEqual(offers.map(row=>row.stripe_subscription_id),[a.primarySub,a.secondarySub]);
    });

    await t.test('preservation requires the exact approved owner, customer and primary subscription', async () => {
      const a = await tenant(); await offer(a); await offer(a,{accountId:a.secondary});
      for (const changes of [{customer:'cus_Different'}, {subscription:'sub_Different'}, {subscription:a.secondarySub}]) {
        const row = await patchStandard(a,changes);
        assert.equal(row.plan,'Standard'); assert.equal(row.app_edition,'standard');
        assert.equal(row.monthly_price_eur,'58');
      }
      assert.equal((await patchStandard(a)).plan,'Premium');
      await db.query("update public.inrcy_account_members set role='admin' where account_id=$1 and auth_user_id=$1",[a.actor]);
      assert.equal((await patchStandard(a)).plan,'Standard', 'loss of ownership revokes the preservation condition');
    });

    await t.test('a matching insert is normalized, while cancellation status and dates remain Stripe-authoritative', async () => {
      const a = await tenant(); await offer(a);
      await asRole('service_role', () => db.query('delete from public.subscriptions where user_id=$1',[a.actor]));
      const row = await asRole('service_role', () => one(`insert into public.subscriptions
        (user_id,stripe_customer_id,stripe_subscription_id,plan,app_edition,status,monthly_price_eur,cancel_requested_at,end_date)
        values($1,$2,$3,'Standard','standard','canceled',58,'2026-11-20T12:00:00Z','2026-12-10') returning *`,[a.actor,a.customer,a.primarySub]));
      assert.equal(row.plan,'Premium'); assert.equal(row.app_edition,'premium');
      assert.equal(row.status,'canceled'); assert.equal(row.monthly_price_eur,'58');
      assert.equal(dateOnly(row.end_date),'2026-12-10');
      assert.equal(new Date(row.cancel_requested_at).toISOString(),'2026-11-20T12:00:00.000Z');
    });

    await t.test('unrelated accounts and editions keep the established behavior and cannot reuse another account offer', async () => {
      const approved = await tenant(), other = await tenant(); await offer(approved);
      const before = await one('select * from public.subscriptions where user_id=$1',[other.actor]);
      await patchStandard(approved);
      assert.deepEqual(await one('select * from public.subscriptions where user_id=$1',[other.actor]),before);
      const spoofed = await patchStandard(other,{customer:approved.customer,subscription:approved.primarySub});
      assert.equal(spoofed.plan,'Standard'); assert.equal(spoofed.app_edition,'standard');
      for (const [plan,edition] of [['Trial','standard'],['Basic','basic'],['Standard','standard'],['Premium','premium'],['Founder','founder']]) {
        const updated = await asRole('service_role', () => one(`update public.subscriptions set plan=$2::public.subscription_plan,
          app_edition='standard' where user_id=$1 returning plan,app_edition`,[other.actor,plan]));
        assert.deepEqual(updated,{plan,app_edition:edition});
      }
    });

    await t.test('database constraints reject duplicate bindings, invalid Stripe identifiers and unsupported offer editions', async () => {
      const a = await tenant(); await offer(a);
      await assert.rejects(offer(a,{accountId:a.secondary,subscription:a.primarySub}),{code:'23505'});
      for (const options of [{subscription:'not_a_subscription'},{customer:'invalid'},{price:'invalid'}, {plan:'Standard'}, {edition:'standard'}]) {
        await assert.rejects(offer(a,{accountId:a.secondary,...options}),{code:'23514'});
      }
      assert.equal((await one('select count(*)::int count from public.inrcy_account_subscriptions where auth_user_id=$1',[a.actor])).count,1);
      await assert.rejects(db.query('delete from public.inrcy_accounts where id=$1',[a.actor]), foreignKeyRestriction);
      await assert.rejects(db.query('delete from auth.users where id=$1',[a.actor]), foreignKeyRestriction);
    });
  } finally { await db.close(); }
});
