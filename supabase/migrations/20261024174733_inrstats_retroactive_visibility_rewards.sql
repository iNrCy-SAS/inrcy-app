-- Historical provider reports establish loyalty eligibility only. They never
-- insert past values into inrstats_visibility_snapshots.
create table if not exists public.inrstats_visibility_reward_history (
  user_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  channel_key text not null check (channel_key in ('gmb','facebook','instagram','threads','linkedin','site_web')),
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on and ends_on - starts_on between 6 and 89),
  source text not null check (source in ('provider_report','trusted_cache')),
  recorded_at timestamptz not null default now(),
  primary key (user_id,channel_key,starts_on,ends_on)
);
alter table public.inrstats_visibility_reward_history enable row level security;
revoke all on public.inrstats_visibility_reward_history from public,anon,authenticated;
grant select,insert on public.inrstats_visibility_reward_history to service_role;
comment on table public.inrstats_visibility_reward_history is 'Verified dated provider coverage for retroactive shop loyalty bonuses, separate from observed visibility scores.';

alter table public.inrstats_visibility_tracking add column if not exists reward_history_checked_at timestamptz;

-- Import legacy caches only if the database disallows all browser mutations.
-- Otherwise the server must request fresh provider reports before crediting.
create or replace function public.inrstats_reward_cache_is_trusted()
returns boolean language sql security invoker set search_path = '' as $$
  select exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='stats_cache' and c.relrowsecurity
      and not exists (
        select 1 from pg_catalog.pg_policy p where p.polrelid=c.oid and p.polcmd in ('*','a','w','d')
          and (0=any(p.polroles) or (select oid from pg_catalog.pg_roles where rolname='anon')=any(p.polroles)
            or (select oid from pg_catalog.pg_roles where rolname='authenticated')=any(p.polroles))
      )
  );
$$;
revoke all on function public.inrstats_reward_cache_is_trusted() from public,anon,authenticated;
grant execute on function public.inrstats_reward_cache_is_trusted() to service_role;

create or replace function public.award_inrstats_visibility_milestones(p_user_id uuid,p_tier text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  account_day date;
  first_day date;
  last_day date;
  start_day date;
  multiplier numeric;
  milestone record;
  observations integer;
  max_gap integer;
  historical boolean;
  earned integer;
  total_earned integer := 0;
begin
  multiplier := case p_tier when 'basic' then 0.5 when 'standard' then 1 when 'premium' then 1.5 else null end;
  if multiplier is null then raise exception 'invalid_visibility_reward_tier' using errcode='22023'; end if;
  select (created_at at time zone 'Europe/Paris')::date into account_day from public.inrcy_accounts where id=p_user_id;
  if account_day is null or account_day > today then return 0; end if;
  select min(observed_on),max(observed_on) into first_day,last_day
    from public.inrstats_visibility_snapshots where user_id=p_user_id and channel_key='all' and model_version='v1'
      and observed_on between account_day and today;
  for milestone in select * from (values (1,50),(3,100),(6,200),(12,500)) as reward(months,base_amount) loop
    if (account_day + make_interval(months=>milestone.months))::date > today then continue; end if;
    if exists (select 1 from public.loyalty_ledger where user_id=p_user_id and action_key='stats_evolution_milestone' and source_id='visibility-'||milestone.months||'m') then continue; end if;
    -- Merge overlapping/adjacent reports across channels. Multiple caches of
    -- one month never become three months, and missing months remain gaps.
    with coverage as (
      select greatest(starts_on,account_day) as starts_on,ends_on from public.inrstats_visibility_reward_history
      where user_id=p_user_id and ends_on between account_day and today
    ), prior as (
      select *,max(ends_on) over(order by starts_on,ends_on rows between unbounded preceding and 1 preceding) as previous_end from coverage
    ), numbered as (
      select *,sum(case when previous_end is null or starts_on>previous_end+1 then 1 else 0 end) over(order by starts_on,ends_on) as block from prior
    ), blocks as (
      select min(starts_on) as starts_on,max(ends_on) as ends_on from numbered group by block
    ) select exists(select 1 from blocks where (starts_on+make_interval(months=>milestone.months))::date<=ends_on+1) into historical;
    if not historical then
      if first_day is null or last_day<today or (first_day+make_interval(months=>milestone.months))::date>today then continue; end if;
      start_day := greatest(first_day,(today-make_interval(months=>milestone.months))::date);
      select count(*),coalesce(max(day_gap),0) into observations,max_gap from (
        select observed_on-lag(observed_on) over(order by observed_on) as day_gap from public.inrstats_visibility_snapshots
        where user_id=p_user_id and channel_key='all' and model_version='v1' and observed_on between start_day and today
      ) history;
      if observations<ceil((today-start_day+1)*0.8) or max_gap>7 then continue; end if;
    end if;
    with awarded as (
      insert into public.loyalty_ledger(user_id,action_key,source_id,amount,label,meta)
      values(p_user_id,'stats_evolution_milestone','visibility-'||milestone.months||'m',round(milestone.base_amount*multiplier),
        'iNr’Stats — '||milestone.months||' mois de suivi',
        jsonb_build_object('origin','inrstats_visibility','months',milestone.months,'base_amount',milestone.base_amount,'tier',p_tier,'tier_multiplier',multiplier,
          'eligibility_source',case when historical then 'historical_provider_reports' else 'recorded_index' end))
      on conflict(user_id,action_key,source_id) do nothing returning amount
    ), credited as (
      insert into public.loyalty_balance as balance(user_id,balance)
        select p_user_id,sum(amount) from awarded having count(*)>0
      on conflict(user_id) do update set balance=balance.balance+excluded.balance,updated_at=now()
      returning 1
    ) select count(*) into earned from credited;
    total_earned := total_earned+earned;
  end loop;
  return total_earned;
end;
$$;
revoke all on function public.award_inrstats_visibility_milestones(uuid,text) from public,anon,authenticated;
grant execute on function public.award_inrstats_visibility_milestones(uuid,text) to service_role;

-- Existing professionals with stored reports join the same bounded capture
-- queue. No scores or credit amounts are created merely from account age.
insert into public.inrstats_visibility_tracking(user_id)
select a.id from public.inrcy_accounts a
where a.created_at + interval '1 month' <= now()
  and exists(select 1 from public.stats_cache c where c.user_id=a.id and c.source in ('overview','overview_last_good'))
on conflict(user_id) do nothing;
