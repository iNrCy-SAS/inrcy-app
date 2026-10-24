-- One observed value per account/channel/day. Past days are never reconstructed.
create table if not exists public.inrstats_visibility_snapshots (
  user_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  channel_key text not null check (channel_key in ('all','inrbadge','inr_search','site_web','gmb','facebook','instagram','threads','linkedin','x','mails','tiktok','youtube_shorts','pinterest')),
  model_version text not null,
  observed_on date not null,
  observed_at timestamptz not null,
  source_snapshot_date date,
  score double precision not null check (score >= 0 and score < 1000000000),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  primary key (user_id, channel_key, model_version, observed_on)
);
alter table public.inrstats_visibility_snapshots enable row level security;
revoke all on public.inrstats_visibility_snapshots from public, anon, authenticated;
grant select, insert, update on public.inrstats_visibility_snapshots to service_role;
comment on table public.inrstats_visibility_snapshots is 'Server-computed daily visibility index and its observed inputs. No backfilled estimates.';

create table if not exists public.inrstats_visibility_tracking (
  user_id uuid primary key references public.inrcy_accounts(id) on delete cascade,
  started_at timestamptz not null default now(),
  next_capture_at timestamptz not null default now(),
  last_captured_on date
);
create index if not exists inrstats_visibility_tracking_due_idx on public.inrstats_visibility_tracking (next_capture_at, user_id);
alter table public.inrstats_visibility_tracking enable row level security;
revoke all on public.inrstats_visibility_tracking from public, anon, authenticated;
grant select, insert, update on public.inrstats_visibility_tracking to service_role;

create or replace function public.record_inrstats_visibility_snapshot(
  p_user_id uuid, p_observed_at timestamptz, p_source_snapshot_date date, p_rows jsonb
) returns integer language plpgsql security invoker set search_path = '' as $$
declare
  capture_day date := (now() at time zone 'Europe/Paris')::date;
  affected integer;
begin
  if p_observed_at is null or abs(extract(epoch from (p_observed_at - now()))) > 300
    or (p_observed_at at time zone 'Europe/Paris')::date <> capture_day then
    raise exception 'visibility_observation_must_be_current' using errcode = '22023';
  end if;
  if p_source_snapshot_date is not null and p_source_snapshot_date not in (capture_day, capture_day - 1) then
    raise exception 'visibility_source_must_be_current' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) <> 14
    or (select count(distinct item->>'channel_key') from jsonb_array_elements(p_rows) item) <> 14
    or not exists (select 1 from jsonb_array_elements(p_rows) item where item->>'channel_key' = 'all') then
    raise exception 'visibility_invalid_channel_set' using errcode = '22023';
  end if;
  insert into public.inrstats_visibility_snapshots as current (
    user_id, channel_key, model_version, observed_on, observed_at, source_snapshot_date, score, inputs
  ) select p_user_id, item->>'channel_key', 'v1', capture_day, p_observed_at, p_source_snapshot_date,
      (item->>'score')::double precision, item->'inputs'
    from jsonb_array_elements(p_rows) item
  on conflict (user_id, channel_key, model_version, observed_on) do update
    set observed_at = excluded.observed_at, source_snapshot_date = excluded.source_snapshot_date,
      score = excluded.score, inputs = excluded.inputs
    where current.observed_on = capture_day and current.observed_at < excluded.observed_at;
  get diagnostics affected = row_count;
  insert into public.inrstats_visibility_tracking (user_id, next_capture_at, last_captured_on)
    values (p_user_id, ((capture_day + 1)::timestamp at time zone 'Europe/Paris') + interval '6 hours', capture_day)
    on conflict (user_id) do update set next_capture_at = excluded.next_capture_at, last_captured_on = excluded.last_captured_on;
  return affected;
end;
$$;
revoke all on function public.record_inrstats_visibility_snapshot(uuid,timestamptz,date,jsonb) from public, anon, authenticated;
grant execute on function public.record_inrstats_visibility_snapshot(uuid,timestamptz,date,jsonb) to service_role;

create or replace function public.claim_inrstats_visibility_accounts(p_limit integer default 6)
returns table (user_id uuid) language sql security invoker set search_path = '' as $$
  with due as (
    select t.user_id from public.inrstats_visibility_tracking t
    where t.next_capture_at <= now()
    order by t.next_capture_at, t.user_id
    limit greatest(1, least(p_limit, 6)) for update skip locked
  ) update public.inrstats_visibility_tracking t
    set next_capture_at = now() + interval '15 minutes'
    from due where t.user_id = due.user_id returning t.user_id;
$$;
revoke all on function public.claim_inrstats_visibility_accounts(integer) from public, anon, authenticated;
grant execute on function public.claim_inrstats_visibility_accounts(integer) to service_role;

-- Reuse the existing shop loyalty ledger and balance. No AI credit grants.
-- Only the server can choose a tier; amount and eligibility are calculated here.
create or replace function public.award_inrstats_visibility_milestones(p_user_id uuid, p_tier text)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  capture_day date := (now() at time zone 'Europe/Paris')::date;
  first_day date;
  last_day date;
  start_day date;
  multiplier numeric;
  milestone record;
  observations integer;
  max_gap integer;
  earned integer;
  total_earned integer := 0;
begin
  multiplier := case p_tier when 'basic' then 0.5 when 'standard' then 1 when 'premium' then 1.5 else null end;
  if multiplier is null then raise exception 'invalid_visibility_reward_tier' using errcode = '22023'; end if;
  select min(observed_on), max(observed_on) into first_day, last_day
    from public.inrstats_visibility_snapshots
    where user_id = p_user_id and channel_key = 'all' and model_version = 'v1';
  if first_day is null or last_day < capture_day then return 0; end if;
  for milestone in select * from (values (1,50),(3,100),(6,200),(12,500)) as reward(months,base_amount) loop
    if (first_day + make_interval(months => milestone.months))::date > capture_day then continue; end if;
    start_day := greatest(first_day, (capture_day - make_interval(months => milestone.months))::date);
    select count(*), coalesce(max(day_gap),0) into observations, max_gap from (
      select observed_on - lag(observed_on) over (order by observed_on) as day_gap
      from public.inrstats_visibility_snapshots
      where user_id = p_user_id and channel_key = 'all' and model_version = 'v1'
        and observed_on between start_day and capture_day
    ) history;
    if observations < ceil((capture_day - start_day + 1) * 0.8) or max_gap > 7 then continue; end if;
    -- The ledger insertion and balance increment commit in the same transaction.
    with awarded as (
      insert into public.loyalty_ledger (user_id,action_key,source_id,amount,label,meta)
      values (p_user_id,'stats_evolution_milestone','visibility-' || milestone.months || 'm',
        round(milestone.base_amount * multiplier),
        'iNr’Stats — ' || milestone.months || ' mois de suivi',
        jsonb_build_object('origin','inrstats_visibility','months',milestone.months,'base_amount',milestone.base_amount,'tier',p_tier,'tier_multiplier',multiplier))
      on conflict (user_id,action_key,source_id) do nothing returning amount
    ), credited as (
      insert into public.loyalty_balance as balance (user_id,balance)
        select p_user_id,sum(amount) from awarded having count(*) > 0
      on conflict (user_id) do update set balance = balance.balance + excluded.balance
      returning 1
    ) select count(*) into earned from credited;
    total_earned := total_earned + earned;
  end loop;
  return total_earned;
end;
$$;
revoke all on function public.award_inrstats_visibility_milestones(uuid,text) from public,anon,authenticated;
grant execute on function public.award_inrstats_visibility_milestones(uuid,text) to service_role;
