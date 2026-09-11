begin;

-- Trois analyses manuelles pour chaque édition commerciale. L'analyse
-- automatique mensuelle possède son propre verrou et ne touche jamais ce
-- compteur. Le plafond Admin reste réservé aux opérations internes.
alter table public.business_dna_analysis_plan_limits
  drop constraint if exists business_dna_analysis_plan_limits_edition_check;
alter table public.business_dna_analysis_plan_limits
  add constraint business_dna_analysis_plan_limits_edition_check
  check (edition in ('standard', 'premium', 'founder', 'admin'));

insert into public.business_dna_analysis_plan_limits (edition, monthly_limit)
values
  ('standard', 3),
  ('premium', 3),
  ('founder', 3),
  ('admin', 16)
on conflict (edition) do update
set monthly_limit = excluded.monthly_limit,
    updated_at = now();

create or replace function public.business_dna_scheduled_at(
  p_period_start date,
  p_day_of_month smallint,
  p_run_time time without time zone,
  p_timezone text
)
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select make_timestamptz(
    extract(year from p_period_start)::integer,
    extract(month from p_period_start)::integer,
    p_day_of_month::integer,
    extract(hour from p_run_time)::integer,
    extract(minute from p_run_time)::integer,
    0,
    p_timezone
  );
$$;

revoke all on function public.business_dna_scheduled_at(date, smallint, time without time zone, text)
from public, anon, authenticated;
grant execute on function public.business_dna_scheduled_at(date, smallint, time without time zone, text)
to service_role;

create table if not exists public.business_dna_analysis_schedules (
  account_id uuid primary key references public.inrcy_accounts(id) on delete cascade,
  enabled boolean not null default false,
  day_of_month smallint not null default 5,
  run_time time without time zone not null default '07:00',
  timezone text not null default 'Europe/Paris',
  next_run_at timestamptz,
  next_period_start date,
  retry_at timestamptz,
  last_run_period date,
  last_success_period date,
  last_status text not null default 'never',
  last_error_code text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  attempt_count integer not null default 0,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  lock_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_dna_analysis_schedules_day_check
    check (day_of_month between 1 and 28),
  constraint business_dna_analysis_schedules_timezone_check
    check (length(btrim(timezone)) between 1 and 100),
  constraint business_dna_analysis_schedules_status_check
    check (last_status in ('never', 'running', 'success', 'failed', 'skipped_no_source')),
  constraint business_dna_analysis_schedules_attempt_check
    check (attempt_count between 0 and 100),
  constraint business_dna_analysis_schedules_next_period_check
    check (next_period_start is null or next_period_start = date_trunc('month', next_period_start)::date),
  constraint business_dna_analysis_schedules_last_period_check
    check (last_run_period is null or last_run_period = date_trunc('month', last_run_period)::date),
  constraint business_dna_analysis_schedules_success_period_check
    check (last_success_period is null or last_success_period = date_trunc('month', last_success_period)::date),
  constraint business_dna_analysis_schedules_enabled_target_check
    check (
      (enabled and next_run_at is not null and next_period_start is not null)
      or not enabled
    )
);

comment on table public.business_dna_analysis_schedules is
  'Programmation mensuelle et verrou d idempotence de l analyse ADN automatique gratuite.';

create index if not exists business_dna_analysis_schedules_due_idx
on public.business_dna_analysis_schedules (
  (coalesce(retry_at, next_run_at)),
  lock_expires_at,
  account_id
)
where enabled;

create or replace function public.business_dna_validate_analysis_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception 'BUSINESS_DNA_INVALID_TIMEZONE';
  end if;

  if new.enabled and (new.next_run_at is null or new.next_period_start is null) then
    raise exception 'BUSINESS_DNA_SCHEDULE_TARGET_REQUIRED';
  end if;

  if new.next_period_start is not null
     and new.last_run_period is not null
     and new.next_period_start <= new.last_run_period then
    raise exception 'BUSINESS_DNA_AUTOMATIC_PERIOD_ALREADY_PROCESSED';
  end if;

  return new;
end;
$$;

revoke all on function public.business_dna_validate_analysis_schedule()
from public, anon, authenticated;
grant execute on function public.business_dna_validate_analysis_schedule()
to service_role;

drop trigger if exists business_dna_analysis_schedules_validate
on public.business_dna_analysis_schedules;
create trigger business_dna_analysis_schedules_validate
before insert or update on public.business_dna_analysis_schedules
for each row execute function public.business_dna_validate_analysis_schedule();

drop trigger if exists business_dna_analysis_schedules_touch_updated_at
on public.business_dna_analysis_schedules;
create trigger business_dna_analysis_schedules_touch_updated_at
before update on public.business_dna_analysis_schedules
for each row execute function public.inrcy_touch_updated_at();

alter table public.business_dna_analysis_schedules enable row level security;
revoke all on public.business_dna_analysis_schedules from anon, authenticated;
grant select on public.business_dna_analysis_schedules to authenticated;
grant all on public.business_dna_analysis_schedules to service_role;

drop policy if exists business_dna_analysis_schedules_select_accessible
on public.business_dna_analysis_schedules;
create policy business_dna_analysis_schedules_select_accessible
on public.business_dna_analysis_schedules for select to authenticated
using (public.inrcy_can_access_account(account_id));

-- L'écriture passe exclusivement par cette RPC : le professionnel peut régler
-- la date, mais jamais effacer l'historique qui garantit une seule analyse
-- automatique gratuite par mois.
drop function if exists public.upsert_business_dna_analysis_schedule(
  uuid,
  boolean,
  smallint,
  time without time zone,
  text,
  timestamptz,
  date
);

create or replace function public.upsert_business_dna_analysis_schedule(
  p_account_id uuid,
  p_enabled boolean,
  p_day_of_month smallint,
  p_run_time time without time zone,
  p_timezone text
)
returns setof public.business_dna_analysis_schedules
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.business_dna_analysis_schedules%rowtype;
  v_exists boolean := false;
  v_candidate_period date;
  v_candidate_run_at timestamptz;
begin
  if not public.inrcy_can_access_account(p_account_id) then
    raise exception 'BUSINESS_DNA_ACCOUNT_ACCESS_DENIED';
  end if;
  if p_day_of_month not between 1 and 28 then
    raise exception 'BUSINESS_DNA_INVALID_SCHEDULE_DAY';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'BUSINESS_DNA_INVALID_TIMEZONE';
  end if;
  select * into v_current
  from public.business_dna_analysis_schedules
  where account_id = p_account_id
  for update;
  v_exists := found;

  if p_enabled then
    v_candidate_period := date_trunc('month', now() at time zone p_timezone)::date;
    v_candidate_run_at := public.business_dna_scheduled_at(
      v_candidate_period,
      p_day_of_month,
      p_run_time,
      p_timezone
    );

    -- Le serveur choisit lui-même le premier mois futur non traité. Un client
    -- ne peut donc ni antidater une exécution, ni réutiliser un mois gratuit.
    while v_candidate_run_at <= now()
       or (
         v_exists
         and v_current.last_run_period is not null
         and v_candidate_period <= v_current.last_run_period
       ) loop
      v_candidate_period := (v_candidate_period + interval '1 month')::date;
      v_candidate_run_at := public.business_dna_scheduled_at(
        v_candidate_period,
        p_day_of_month,
        p_run_time,
        p_timezone
      );
    end loop;
  end if;

  insert into public.business_dna_analysis_schedules (
    account_id,
    enabled,
    day_of_month,
    run_time,
    timezone,
    next_run_at,
    next_period_start,
    retry_at
  ) values (
    p_account_id,
    p_enabled,
    p_day_of_month,
    p_run_time,
    p_timezone,
    case when p_enabled then v_candidate_run_at else null end,
    case when p_enabled then v_candidate_period else null end,
    null
  )
  on conflict (account_id) do update
  set enabled = excluded.enabled,
      day_of_month = excluded.day_of_month,
      run_time = excluded.run_time,
      timezone = excluded.timezone,
      next_run_at = case
        when public.business_dna_analysis_schedules.lock_token is not null
          then public.business_dna_analysis_schedules.next_run_at
        when excluded.enabled then excluded.next_run_at
        else null
      end,
      next_period_start = case
        when public.business_dna_analysis_schedules.lock_token is not null
          then public.business_dna_analysis_schedules.next_period_start
        when excluded.enabled then excluded.next_period_start
        else null
      end,
      retry_at = case
        when public.business_dna_analysis_schedules.lock_token is not null
          then public.business_dna_analysis_schedules.retry_at
        else null
      end;

  return query
  select s.*
  from public.business_dna_analysis_schedules s
  where s.account_id = p_account_id;
end;
$$;

revoke all on function public.upsert_business_dna_analysis_schedule(uuid, boolean, smallint, time without time zone, text)
from public, anon, authenticated;
grant execute on function public.upsert_business_dna_analysis_schedule(uuid, boolean, smallint, time without time zone, text)
to authenticated, service_role;

-- Réclamation atomique : plusieurs invocations du cron peuvent coexister sans
-- jamais lancer deux workers pour le même établissement.
create or replace function public.claim_due_business_dna_automatic_analysis(
  p_lease_seconds integer default 180
)
returns table (
  account_id uuid,
  lock_token uuid,
  scheduled_period_start date,
  scheduled_for timestamptz,
  attempt_count integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidate as (
    select s.account_id
    from public.business_dna_analysis_schedules s
    where s.enabled
      and s.next_period_start is not null
      and s.next_run_at is not null
      and (s.last_run_period is null or s.last_run_period < s.next_period_start)
      and coalesce(s.retry_at, s.next_run_at) <= now()
      and (s.lock_expires_at is null or s.lock_expires_at <= now())
    order by coalesce(s.retry_at, s.next_run_at), s.account_id
    for update skip locked
    limit 1
  ), claimed as (
    update public.business_dna_analysis_schedules s
    set last_status = 'running',
        last_error_code = null,
        attempt_count = least(s.attempt_count + 1, 100),
        locked_at = now(),
        lock_expires_at = now() + make_interval(secs => greatest(120, least(coalesce(p_lease_seconds, 180), 900))),
        lock_token = gen_random_uuid(),
        retry_at = null
    from candidate c
    where s.account_id = c.account_id
    returning s.account_id, s.lock_token, s.next_period_start, s.next_run_at, s.attempt_count
  )
  select
    c.account_id,
    c.lock_token,
    c.next_period_start,
    c.next_run_at,
    c.attempt_count
  from claimed c;
end;
$$;

revoke all on function public.claim_due_business_dna_automatic_analysis(integer)
from public, anon, authenticated;
grant execute on function public.claim_due_business_dna_automatic_analysis(integer)
to service_role;

create or replace function public.complete_business_dna_automatic_analysis(
  p_account_id uuid,
  p_lock_token uuid,
  p_outcome text,
  p_error_code text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule public.business_dna_analysis_schedules%rowtype;
  v_current_period date;
  v_next_period date;
  v_status text;
begin
  if p_outcome not in ('success', 'no_source', 'failed') then
    raise exception 'BUSINESS_DNA_INVALID_AUTOMATIC_OUTCOME';
  end if;

  select * into v_schedule
  from public.business_dna_analysis_schedules
  where account_id = p_account_id
    and lock_token = p_lock_token
  for update;
  if not found then
    raise exception 'BUSINESS_DNA_AUTOMATIC_LOCK_MISMATCH';
  end if;

  v_current_period := v_schedule.next_period_start;
  if v_current_period is null then
    raise exception 'BUSINESS_DNA_AUTOMATIC_PERIOD_MISSING';
  end if;

  v_status := case
    when p_outcome = 'success' then 'success'
    when p_outcome = 'no_source' then 'skipped_no_source'
    else 'failed'
  end;

  -- Une panne technique ne consomme jamais l'analyse mensuelle. Les reprises
  -- s'espacent progressivement, puis restent quotidiennes jusqu'au succès ou
  -- à la désactivation explicite de la programmation.
  if p_outcome = 'failed' then
    update public.business_dna_analysis_schedules
    set last_status = v_status,
        last_error_code = left(nullif(p_error_code, ''), 120),
        last_run_at = now(),
        retry_at = case
          when not enabled then null
          when attempt_count <= 1 then now() + interval '1 hour'
          when attempt_count <= 4 then now() + interval '6 hours'
          else now() + interval '24 hours'
        end,
        locked_at = null,
        lock_expires_at = null,
        lock_token = null
    where account_id = p_account_id;
    return case when v_schedule.enabled then 'retry_scheduled' else 'disabled' end;
  end if;

  v_next_period := (v_current_period + interval '1 month')::date;
  update public.business_dna_analysis_schedules
  set last_run_period = v_current_period,
      last_success_period = case
        when p_outcome = 'success' then v_current_period
        else last_success_period
      end,
      last_status = v_status,
      last_error_code = left(nullif(p_error_code, ''), 120),
      last_run_at = now(),
      last_success_at = case
        when p_outcome = 'success' then now()
        else last_success_at
      end,
      attempt_count = 0,
      next_period_start = case when enabled then v_next_period else null end,
      next_run_at = case
        when enabled then public.business_dna_scheduled_at(
          v_next_period,
          day_of_month,
          run_time,
          timezone
        )
        else null
      end,
      retry_at = null,
      locked_at = null,
      lock_expires_at = null,
      lock_token = null
  where account_id = p_account_id;

  return case when p_outcome = 'success' then 'completed' else 'period_closed' end;
end;
$$;

revoke all on function public.complete_business_dna_automatic_analysis(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.complete_business_dna_automatic_analysis(uuid, uuid, text, text)
to service_role;

commit;
