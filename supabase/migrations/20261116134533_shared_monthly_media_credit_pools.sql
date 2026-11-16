-- Included media credits can be shared by explicitly configured establishments.
-- Jobs, generated media, purchased credits and their refunds remain account-scoped.
begin;

do $$ begin
  if to_regprocedure('public.ai_media_credit_prepare(uuid,uuid,text)') is null
    or to_regprocedure('public.ai_media_credit_counter(uuid,date)') is null
    or to_regprocedure('public.ai_media_credit_release_included(uuid,date,integer,boolean)') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='ai_media_credit_periods' and column_name='carried_debt_count') then
    raise exception 'AI_MEDIA_CREDIT_POOL_DEPENDENCY_MISSING';
  end if;
end $$;

create table public.ai_media_credit_pools (
  id uuid primary key default gen_random_uuid(),
  owner_auth_user_id uuid not null references auth.users(id) on delete restrict,
  label text not null check(length(btrim(label)) between 1 and 160),
  monthly_limit integer not null check(monthly_limit between 1 and 1000000),
  rollover_cap integer not null check(rollover_cap between monthly_limit and 2000000),
  starts_on date not null default date_trunc('month',timezone('UTC',now()))::date,
  created_at timestamptz not null default now(),
  check(starts_on=date_trunc('month',starts_on)::date)
);
create index ai_media_credit_pools_owner_idx on public.ai_media_credit_pools(owner_auth_user_id);
create table public.ai_media_credit_pool_members (
  account_id uuid primary key references public.inrcy_accounts(id) on delete restrict,
  pool_id uuid not null references public.ai_media_credit_pools(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index ai_media_credit_pool_members_pool_idx on public.ai_media_credit_pool_members(pool_id,account_id);
create table public.ai_media_credit_pool_periods (
  pool_id uuid not null references public.ai_media_credit_pools(id) on delete restrict,
  period_start date not null,
  allocated_limit integer not null check(allocated_limit>=0),
  base_limit integer not null check(base_limit>=0),
  rollover_cap integer not null check(rollover_cap>=base_limit),
  carried_debt_count integer not null default 0 check(carried_debt_count>=0),
  created_at timestamptz not null default now(),
  primary key(pool_id,period_start),
  check(period_start=date_trunc('month',period_start)::date)
);
alter table public.ai_media_credit_pools enable row level security;
alter table public.ai_media_credit_pool_members enable row level security;
alter table public.ai_media_credit_pool_periods enable row level security;
revoke all on public.ai_media_credit_pools from public,anon,authenticated;
revoke all on public.ai_media_credit_pool_members from public,anon,authenticated;
revoke all on public.ai_media_credit_pool_periods from public,anon,authenticated;
grant select,insert,update on public.ai_media_credit_pools to service_role;
grant select,insert,update on public.ai_media_credit_pool_members to service_role;
grant select,insert,update on public.ai_media_credit_pool_periods to service_role;

-- Capture the exact native implementations. Public entry-point OIDs are preserved
-- by CREATE OR REPLACE, so cached callers cannot retain the unpooled counter.
do $$ declare v_signature text; v_alias text; v_source text; v_header text; begin
  for v_signature,v_alias in select * from (values
    ('public.ai_media_credit_prepare(uuid,uuid,text)','ai_media_credit_prepare_unpooled_v1'),
    ('public.ai_media_credit_counter(uuid,date)','ai_media_credit_counter_unpooled_v1'),
    ('public.ai_media_credit_release_included(uuid,date,integer,boolean)','ai_media_credit_release_included_unpooled_v1')
  ) x(signature,alias) loop
    select pg_get_functiondef(v_signature::regprocedure) into v_source;
    v_header:=split_part(v_source,'(',1);
    if v_header not like 'CREATE OR REPLACE FUNCTION public.%' then raise exception 'AI_MEDIA_CREDIT_POOL_NATIVE_HEADER_DRIFT'; end if;
    execute 'CREATE OR REPLACE FUNCTION public.'||v_alias||substr(v_source,length(v_header)+1);
  end loop;
end $$;

create function public.ai_media_credit_pool_for_account(p_account_id uuid) returns uuid
language plpgsql stable security invoker set search_path='' as $$
declare v_pool uuid; v_owner uuid;
begin
  select m.pool_id,p.owner_auth_user_id into v_pool,v_owner
    from public.ai_media_credit_pool_members m join public.ai_media_credit_pools p on p.id=m.pool_id
    where m.account_id=p_account_id;
  if not found then return null; end if;
  if (select count(*) from public.ai_media_credit_pool_members where pool_id=v_pool)<2
    or exists(select 1 from public.ai_media_credit_pool_members m where m.pool_id=v_pool
      and not exists(select 1 from public.inrcy_account_members a where a.account_id=m.account_id and a.auth_user_id=v_owner and a.role='owner')) then
    raise exception 'AI_MEDIA_CREDIT_POOL_MEMBERSHIP_INVALID';
  end if;
  return v_pool;
end $$;

create function public.ai_media_credit_pool_guard_member() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_pool uuid;
begin
  if tg_op='UPDATE' and new is not distinct from old then return new; end if;
  v_pool:=case when tg_op='DELETE' then old.pool_id else new.pool_id end;
  perform 1 from public.ai_media_credit_pools where id=v_pool for update;
  if exists(select 1 from public.ai_media_credit_pool_periods where pool_id=v_pool)
    or (tg_op='UPDATE' and exists(select 1 from public.ai_media_credit_pool_periods where pool_id=old.pool_id)) then
    raise exception 'AI_MEDIA_CREDIT_POOL_MEMBERSHIP_FROZEN';
  end if;
  if tg_op='DELETE' then return old; end if;
  select owner_auth_user_id into v_owner from public.ai_media_credit_pools where id=new.pool_id;
  if not exists(select 1 from public.inrcy_account_members where account_id=new.account_id and auth_user_id=v_owner and role='owner') then
    raise exception 'AI_MEDIA_CREDIT_POOL_OWNER_MISMATCH';
  end if;
  if not exists(select 1 from public.ai_media_credit_wallets where account_id=new.account_id)
    or not exists(select 1 from public.ai_media_credit_periods where account_id=new.account_id and period_start=date_trunc('month',timezone('UTC',now()))::date) then
    raise exception 'AI_MEDIA_CREDIT_POOL_ACCOUNT_NOT_READY';
  end if;
  return new;
end $$;
create trigger ai_media_credit_pool_guard_member before insert or update or delete on public.ai_media_credit_pool_members
  for each row execute function public.ai_media_credit_pool_guard_member();

create function public.ai_media_credit_pool_guard_owner() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.owner_auth_user_id is distinct from old.owner_auth_user_id and exists(select 1 from public.ai_media_credit_pool_members where pool_id=old.id) then
    raise exception 'AI_MEDIA_CREDIT_POOL_OWNER_IMMUTABLE';
  end if;
  if new.starts_on is distinct from old.starts_on and exists(select 1 from public.ai_media_credit_pool_periods where pool_id=old.id) then
    raise exception 'AI_MEDIA_CREDIT_POOL_START_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger ai_media_credit_pool_guard_owner before update on public.ai_media_credit_pools
  for each row execute function public.ai_media_credit_pool_guard_owner();

create or replace function public.ai_media_credit_lock(p_account_id uuid) returns void
language plpgsql volatile security invoker set search_path='' as $$
declare v_pool uuid;
begin
  v_pool:=public.ai_media_credit_pool_for_account(p_account_id);
  if v_pool is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_pool::text),pg_catalog.hashtext('ai-media-credit-pool-v1'));
  end if;
  -- Preserve the native lock as well: a pool operation always locks pool, then
  -- its own wallet. Completion, expiry, manual and automatic paths share it.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_account_id::text),pg_catalog.hashtext('ai-media-credits-v1'));
end $$;

create function public.ai_media_credit_pool_usage(p_pool_id uuid,p_period date)
returns table(used_count integer,reserved_count integer)
language sql stable security invoker set search_path='' as $$
  select (coalesce(sum(p.used_count-p.carried_debt_count),0)+coalesce((select s.carried_debt_count from public.ai_media_credit_pool_periods s where s.pool_id=p_pool_id and s.period_start=p_period),0))::integer,
    coalesce(sum(p.reserved_count),0)::integer
  from public.ai_media_credit_pool_members m join public.ai_media_credit_periods p on p.account_id=m.account_id and p.period_start=p_period
  where m.pool_id=p_pool_id;
$$;

create or replace function public.ai_media_credit_prepare(p_account_id uuid,p_actor_auth_user_id uuid,p_edition text)
returns date language plpgsql volatile security invoker set search_path='' as $$
declare v_period date; v_pool uuid; v_config public.ai_media_credit_pools%rowtype;
  v_current public.ai_media_credit_pool_periods%rowtype; v_previous public.ai_media_credit_pool_periods%rowtype;
  v_usage record; v_gap integer; v_debt integer; v_limit integer; v_member record;
begin
  -- Native actor validation, legacy import and lock order are retained exactly.
  v_period:=public.ai_media_credit_prepare_unpooled_v1(p_account_id,p_actor_auth_user_id,p_edition);
  v_pool:=public.ai_media_credit_pool_for_account(p_account_id);
  if v_pool is null then return v_period; end if;
  select * into v_config from public.ai_media_credit_pools where id=v_pool for update;
  if v_config.starts_on>v_period then raise exception 'AI_MEDIA_CREDIT_POOL_NOT_STARTED'; end if;
  select * into v_current from public.ai_media_credit_pool_periods where pool_id=v_pool and period_start=v_period for update;
  if found then
    if v_current.base_limit<>v_config.monthly_limit or v_current.rollover_cap<>v_config.rollover_cap then
      select * into v_usage from public.ai_media_credit_pool_usage(v_pool,v_period);
      update public.ai_media_credit_pool_periods set
        allocated_limit=greatest(least(allocated_limit,v_usage.used_count+v_usage.reserved_count),
          least(carried_debt_count+v_config.rollover_cap,greatest(allocated_limit+v_config.monthly_limit-base_limit,0))),
        base_limit=v_config.monthly_limit,rollover_cap=v_config.rollover_cap
        where pool_id=v_pool and period_start=v_period;
    end if;
  else
    select * into v_previous from public.ai_media_credit_pool_periods where pool_id=v_pool and period_start<v_period order by period_start desc limit 1 for update;
    if found then
      select * into v_usage from public.ai_media_credit_pool_usage(v_pool,v_previous.period_start);
      v_gap:=(extract(year from v_period)::integer-extract(year from v_previous.period_start)::integer)*12
        +extract(month from v_period)::integer-extract(month from v_previous.period_start)::integer;
      v_debt:=greatest(v_usage.used_count+v_usage.reserved_count-v_previous.allocated_limit,0);
      v_limit:=(v_debt::bigint+least(v_config.rollover_cap::bigint,
        v_previous.allocated_limit::bigint-v_usage.used_count-v_usage.reserved_count+v_config.monthly_limit::bigint*v_gap))::integer;
    else
      v_gap:=(extract(year from v_period)::integer-extract(year from v_config.starts_on)::integer)*12
        +extract(month from v_period)::integer-extract(month from v_config.starts_on)::integer+1;
      v_limit:=least(v_config.rollover_cap::bigint,v_config.monthly_limit::bigint*v_gap)::integer;
      select coalesce(sum(p.carried_debt_count),0)::integer into v_debt
        from public.ai_media_credit_periods p join public.ai_media_credit_pool_members m on m.account_id=p.account_id
        where m.pool_id=v_pool and p.period_start=v_period;
    end if;
    insert into public.ai_media_credit_pool_periods(pool_id,period_start,allocated_limit,base_limit,rollover_cap,carried_debt_count)
      values(v_pool,v_period,v_limit,v_config.monthly_limit,v_config.rollover_cap,v_debt);
  end if;
  -- Either establishment can recover expired holds from the common reserve.
  -- Completion/expiry still uses each job's original account and own assets.
  for v_member in select account_id from public.ai_media_credit_pool_members where pool_id=v_pool order by account_id loop
    perform public.expire_ai_media_credit_reservations(1000,v_member.account_id);
  end loop;
  return v_period;
end $$;

create or replace function public.ai_media_credit_counter(p_account_id uuid,p_period_start date)
returns table(quota_unit text,limit_count integer,used_count integer,reserved_count integer,remaining_count integer,
  period_start date,reset_at timestamptz,included_remaining_count integer,purchased_remaining_count integer,purchased_reserved_count integer,
  purchased_debt_count integer,purchased_held_count integer,purchased_suspended_deficit_count integer,
  included_limit_count integer,included_used_count integer,included_reserved_count integer)
language plpgsql stable security invoker set search_path='' as $$
declare v_pool uuid; v_own record; v_period public.ai_media_credit_pool_periods%rowtype; v_usage record; v_remaining integer;
begin
  v_pool:=public.ai_media_credit_pool_for_account(p_account_id);
  if v_pool is null then
    return query select * from public.ai_media_credit_counter_unpooled_v1(p_account_id,p_period_start); return;
  end if;
  if p_period_start<(select p.starts_on from public.ai_media_credit_pools p where p.id=v_pool) then
    return query select * from public.ai_media_credit_counter_unpooled_v1(p_account_id,p_period_start); return;
  end if;
  select * into v_own from public.ai_media_credit_counter_unpooled_v1(p_account_id,p_period_start);
  select * into v_period from public.ai_media_credit_pool_periods where pool_id=v_pool and ai_media_credit_pool_periods.period_start=p_period_start;
  if not found then raise exception 'AI_MEDIA_CREDIT_POOL_PERIOD_NOT_READY'; end if;
  select * into v_usage from public.ai_media_credit_pool_usage(v_pool,p_period_start);
  v_remaining:=v_period.allocated_limit-v_usage.used_count-v_usage.reserved_count;
  return query select 'credit'::text,v_period.allocated_limit+(v_own.limit_count-v_own.included_limit_count),
    v_usage.used_count+(v_own.used_count-v_own.included_used_count),v_usage.reserved_count+(v_own.reserved_count-v_own.included_reserved_count),
    v_remaining+v_own.purchased_remaining_count,p_period_start,v_own.reset_at,
    v_remaining,v_own.purchased_remaining_count,v_own.purchased_reserved_count,
    v_own.purchased_debt_count,v_own.purchased_held_count,v_own.purchased_suspended_deficit_count,
    v_period.allocated_limit,v_usage.used_count,v_usage.reserved_count;
end $$;

create or replace function public.ai_media_credit_release_included(p_account_id uuid,p_period date,p_amount integer,p_complete boolean)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare v_pool uuid; v_current date:=date_trunc('month',timezone('UTC',now()))::date;
  v_record public.ai_media_credit_pool_periods%rowtype; v_starts date; v_amount integer; v_debt_refund integer;
  v_own_debt_before integer; v_own_debt_after integer;
begin
  if p_amount>0 and not p_complete and p_period<v_current then
    select carried_debt_count into v_own_debt_before from public.ai_media_credit_periods
      where account_id=p_account_id and period_start=v_current;
  end if;
  perform public.ai_media_credit_release_included_unpooled_v1(p_account_id,p_period,p_amount,p_complete);
  if p_amount=0 or p_complete or p_period>=v_current then return; end if;
  v_pool:=public.ai_media_credit_pool_for_account(p_account_id);
  if v_pool is null then return; end if;
  select starts_on into v_starts from public.ai_media_credit_pools where id=v_pool;
  select * into v_record from public.ai_media_credit_pool_periods where pool_id=v_pool and period_start=v_current for update;
  if not found then return; end if;
  -- A pre-pool reservation can repay imported debt, but cannot manufacture
  -- rollover from the former independent allowances that were not pooled.
  if p_period<v_starts then
    select carried_debt_count into v_own_debt_after from public.ai_media_credit_periods
      where account_id=p_account_id and period_start=v_current;
    v_amount:=least(p_amount,v_record.carried_debt_count,greatest(coalesce(v_own_debt_before,0)-coalesce(v_own_debt_after,0),0));
  else
    v_amount:=p_amount;
  end if;
  v_debt_refund:=least(v_amount,v_record.carried_debt_count);
  update public.ai_media_credit_pool_periods set carried_debt_count=carried_debt_count-v_debt_refund,
    allocated_limit=greatest(allocated_limit-v_debt_refund,
      least(carried_debt_count-v_debt_refund+rollover_cap,allocated_limit+v_amount-v_debt_refund))
    where pool_id=v_pool and period_start=v_current;
end $$;

create function public.get_ai_media_credit_pool_context(p_account_id uuid,p_actor_auth_user_id uuid)
returns table(pool_id uuid,member_count integer,monthly_limit integer)
language plpgsql stable security invoker set search_path='' as $$
declare v_pool uuid;
begin
  perform public.ai_media_assert_account_actor(p_account_id,p_actor_auth_user_id);
  v_pool:=public.ai_media_credit_pool_for_account(p_account_id);
  if v_pool is null then return; end if;
  return query select p.id,(select count(*)::integer from public.ai_media_credit_pool_members m where m.pool_id=p.id),p.monthly_limit
    from public.ai_media_credit_pools p where p.id=v_pool;
end $$;

do $$ declare v_function record; begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'ai_media_credit_pool_%' or p.proname in
      ('ai_media_credit_lock','ai_media_credit_prepare','ai_media_credit_counter','ai_media_credit_release_included',
       'ai_media_credit_prepare_unpooled_v1','ai_media_credit_counter_unpooled_v1','ai_media_credit_release_included_unpooled_v1','get_ai_media_credit_pool_context')) loop
    execute format('revoke all on function %s from public,anon,authenticated',v_function.signature);
    execute format('grant execute on function %s to service_role',v_function.signature);
  end loop;
end $$;
comment on table public.ai_media_credit_pools is 'Explicit shared included allowance; prices and purchased credits remain independent. Backend-managed only.';
comment on table public.ai_media_credit_pool_members is 'A stable set of establishments with one common owner. Frozen once a pool period exists to preserve historical attribution.';
comment on table public.ai_media_credit_pool_periods is 'One monthly included allocation and carried debt per shared pool. Real account usage is aggregated, never moved or duplicated.';
notify pgrst,'reload schema';
commit;
