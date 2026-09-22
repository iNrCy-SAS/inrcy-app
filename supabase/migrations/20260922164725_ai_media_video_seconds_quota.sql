-- Les images restent comptees a l'unite. Les videos utilisent desormais leur
-- duree de sortie (8, 16 ou 24 secondes) comme unite de quota. Le ledger du job
-- fige cette quantite pour que reserve/complete/fail/expiration soient exacts,
-- y compris lors d'un changement de mois.
begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null
     or to_regclass('public.ai_media_account_limits') is null
     or to_regclass('public.ai_media_monthly_usage') is null
     or to_regclass('public.ai_media_generation_jobs') is null
     or to_regclass('public.pro_media_library') is null
     or to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.inrcy_account_members') is null
     or to_regclass('public.subscriptions') is null then
    raise exception 'AI_MEDIA_SECONDS_PREFLIGHT_FAILED: socle quota media IA incomplet.';
  end if;

  if to_regprocedure('public.ai_media_assert_account_actor(uuid,uuid)') is null
     or to_regprocedure('public.ai_media_prepare_monthly_rollover(uuid,text,integer,integer,date)') is null
     or to_regprocedure('public.ai_media_expire_account_reservations(uuid,integer)') is null
     or to_regprocedure('public.expire_ai_media_generation_reservations(integer)') is null
     or to_regprocedure('public.complete_ai_media_generation(uuid,uuid,uuid,jsonb)') is null
     or to_regprocedure('public.fail_ai_media_generation(uuid,uuid,text,text,jsonb)') is null then
    raise exception 'AI_MEDIA_SECONDS_PREFLIGHT_FAILED: RPC quota media IA incompletes.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.ai_media_plan_limits'::regclass
      and a.attname = 'video_max_duration_seconds'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'AI_MEDIA_SECONDS_PREFLIGHT_FAILED: durees video 8/16/24 absentes.';
  end if;
end;
$$;

-- Evite qu'une conversion historique d'un ancien compteur "videos" en
-- secondes soit prise pour un remboursement tardif par le trigger de report.
drop trigger if exists ai_media_monthly_usage_restore_late_rollover_refund
on public.ai_media_monthly_usage;

alter table public.ai_media_generation_jobs
  add column if not exists quota_unit text not null default 'item',
  add column if not exists quota_amount integer not null default 1;

-- Chaque ancien job video possede deja duration_seconds dans ses metadonnees.
-- Les tres vieux jobs incomplets utilisent 8 secondes, ancien minimum facture.
update public.ai_media_generation_jobs j
set quota_unit = case when j.media_kind = 'video' then 'second' else 'item' end,
    quota_amount = case
      when j.media_kind = 'image' then 1
      when (j.metadata ->> 'duration_seconds') ~ '^(8|16|24)$'
        then (j.metadata ->> 'duration_seconds')::integer
      else 8
    end,
    monthly_limit = case
      when j.media_kind = 'video' then least(10000, j.monthly_limit * 8)
      else j.monthly_limit
    end;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ai_media_generation_jobs'::regclass
      and conname = 'ai_media_generation_jobs_quota_unit_check'
  ) then
    alter table public.ai_media_generation_jobs
      add constraint ai_media_generation_jobs_quota_unit_check
      check (quota_unit in ('item', 'second'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.ai_media_generation_jobs'::regclass
      and conname = 'ai_media_generation_jobs_quota_amount_check'
  ) then
    alter table public.ai_media_generation_jobs
      add constraint ai_media_generation_jobs_quota_amount_check
      check (
        (media_kind = 'image' and quota_unit = 'item' and quota_amount = 1)
        or
        (media_kind = 'video' and quota_unit = 'second' and quota_amount in (8, 16, 24))
      );
  end if;
end;
$$;

comment on column public.ai_media_generation_jobs.quota_unit is
  'Unite immuable du ledger quota: item pour une image, second pour une video.';
comment on column public.ai_media_generation_jobs.quota_amount is
  'Quantite immuable reservee puis consommee ou restituee: 1 image ou 8/16/24 secondes video.';
comment on column public.ai_media_plan_limits.video_monthly_limit is
  'Recharge mensuelle video exprimee en secondes de sortie.';
comment on column public.ai_media_account_limits.video_monthly_limit_override is
  'NULL = forfait; 0 = video IA desactivee; valeur positive = secondes video mensuelles.';
comment on column public.ai_media_monthly_usage.used_count is
  'Quantite consommee: nombre d images pour image, secondes de sortie pour video.';
comment on column public.ai_media_monthly_usage.reserved_count is
  'Quantite reservee: nombre d images pour image, secondes de sortie pour video.';

-- Les overrides existants etaient exprimes en nombre de videos. Une ancienne
-- video vaut au minimum 8 secondes pour ne jamais offrir de credits lors de la
-- bascule. Les plafonds commerciaux sont ensuite fixes ci-dessous.
update public.ai_media_account_limits l
set video_monthly_limit_override = case
      when l.video_monthly_limit_override is null then null
      else least(10000, l.video_monthly_limit_override * 8)
    end
where l.video_monthly_limit_override is not null;

update public.ai_media_plan_limits p
set video_monthly_limit = case p.edition
      when 'standard' then 48
      when 'premium' then 144
      when 'founder' then 144
      else p.video_monthly_limit
    end,
    video_max_duration_seconds = case
      when p.edition in ('standard', 'premium', 'founder') then 24
      else p.video_max_duration_seconds
    end,
    updated_at = pg_catalog.now()
where p.edition in ('standard', 'premium', 'founder');

-- Reconstitue les secondes depuis le ledger. greatest(ancien * 8, ledger)
-- couvre les tres vieux compteurs sans job et ne rend jamais du quota deja
-- depense. Le report historique est converti au meme taux conservateur.
with job_totals as (
  select
    j.account_id,
    j.quota_period_start as period_start,
    coalesce(
      pg_catalog.sum(j.quota_amount) filter (where j.status = 'completed'),
      0
    )::integer as used_amount,
    coalesce(
      pg_catalog.sum(j.quota_amount) filter (where j.status in ('reserved', 'processing')),
      0
    )::integer as reserved_amount
  from public.ai_media_generation_jobs j
  where j.media_kind = 'video'
  group by j.account_id, j.quota_period_start
), converted as (
  select
    u.account_id,
    u.period_start,
    least(10000, greatest(u.used_count * 8, coalesce(t.used_amount, 0)))::integer
      as used_amount,
    least(10000, greatest(u.reserved_count * 8, coalesce(t.reserved_amount, 0)))::integer
      as reserved_amount,
    least(10000, u.base_limit * 8)::integer as base_amount,
    least(10000, u.allocated_limit * 8)::integer as allocated_amount,
    least(10000, u.carried_count * 8)::integer as carried_amount,
    least(10000, u.rollover_cap * 8)::integer as cap_amount
  from public.ai_media_monthly_usage u
  left join job_totals t
    on t.account_id = u.account_id
   and t.period_start = u.period_start
  where u.media_kind = 'video'
)
update public.ai_media_monthly_usage u
set used_count = c.used_amount,
    reserved_count = c.reserved_amount,
    base_limit = c.base_amount,
    allocated_limit = least(
      10000,
      greatest(c.allocated_amount, c.used_amount + c.reserved_amount)
    )::integer,
    carried_count = least(
      10000,
      greatest(
        greatest(c.allocated_amount, c.used_amount + c.reserved_amount)
          - c.base_amount,
        0
      )
    )::integer,
    rollover_cap = least(
      10000,
      greatest(c.cap_amount, c.base_amount)
    )::integer
from converted c
where u.account_id = c.account_id
  and u.period_start = c.period_start
  and u.media_kind = 'video';

create or replace function public.ai_media_protect_job_quota_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quota_unit is distinct from old.quota_unit
     or new.quota_amount is distinct from old.quota_amount then
    raise exception 'AI_MEDIA_QUOTA_LEDGER_IMMUTABLE';
  end if;
  return new;
end;
$$;

revoke all on function public.ai_media_protect_job_quota_ledger()
from public, anon, authenticated;
grant execute on function public.ai_media_protect_job_quota_ledger()
to service_role;

drop trigger if exists ai_media_generation_jobs_protect_quota_ledger
on public.ai_media_generation_jobs;
create trigger ai_media_generation_jobs_protect_quota_ledger
before update of quota_unit, quota_amount
on public.ai_media_generation_jobs
for each row execute function public.ai_media_protect_job_quota_ledger();

create or replace function public.ai_media_assert_account_actor(
  p_account_id uuid,
  p_actor_auth_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_account_id is null or p_actor_auth_user_id is null then
    raise exception 'AI_MEDIA_ACCOUNT_ACCESS_DENIED';
  end if;

  if not exists (
    select 1
    from public.inrcy_account_members m
    where m.account_id = p_account_id
      and m.auth_user_id = p_actor_auth_user_id
  ) then
    raise exception 'AI_MEDIA_ACCOUNT_ACCESS_DENIED';
  end if;
end;
$$;

revoke all on function public.ai_media_assert_account_actor(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.ai_media_assert_account_actor(uuid, uuid)
to service_role;

create or replace function public.ai_media_prepare_monthly_rollover(
  p_account_id uuid,
  p_media_kind text,
  p_base_limit integer,
  p_rollover_cap integer,
  p_period_start date
)
returns table (
  limit_count integer,
  used_count integer,
  reserved_count integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_media_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_media_kind, '')));
  v_effective_cap integer;
  v_limit integer;
  v_previous_remaining integer;
  v_months_gap integer;
  v_credit_start date;
  v_credit_month date;
  v_period_spend integer;
  v_current public.ai_media_monthly_usage%rowtype;
  v_previous public.ai_media_monthly_usage%rowtype;
begin
  if p_account_id is null then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_ACCOUNT';
  end if;
  if v_media_kind not in ('image', 'video') then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_KIND';
  end if;
  if p_base_limit is null or p_base_limit not between 0 and 10000 then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_BASE_LIMIT';
  end if;
  if p_rollover_cap is null or p_rollover_cap not between 0 and 10000 then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_CAP';
  end if;
  if p_period_start is null
     or p_period_start <> pg_catalog.date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_PERIOD';
  end if;

  v_effective_cap := greatest(p_rollover_cap, p_base_limit);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_account_id::text),
    pg_catalog.hashtext('ai-media-rollover:' || v_media_kind)
  );

  select u.* into v_current
  from public.ai_media_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = p_period_start
    and u.media_kind = v_media_kind
  for update;

  if found then
    if v_current.rollover_version = 0 then
      v_limit := case
        when p_base_limit = 0 then 0
        else greatest(
          p_base_limit,
          v_current.used_count + v_current.reserved_count
        )
      end;

      update public.ai_media_monthly_usage u
      set base_limit = p_base_limit,
          allocated_limit = v_limit,
          carried_count = 0,
          rollover_cap = v_effective_cap,
          rollover_version = 1
      where u.account_id = p_account_id
        and u.period_start = p_period_start
        and u.media_kind = v_media_kind
      returning u.* into v_current;
    elsif v_current.base_limit is distinct from p_base_limit
       or v_current.rollover_cap is distinct from v_effective_cap then
      v_limit := v_current.allocated_limit;
      if p_base_limit = 0 then
        v_limit := 0;
      elsif p_base_limit > v_current.base_limit then
        v_limit := greatest(
          v_current.used_count + v_current.reserved_count,
          least(
            v_effective_cap,
            v_current.allocated_limit + (p_base_limit - v_current.base_limit)
          )
        );
      end if;

      update public.ai_media_monthly_usage u
      set base_limit = p_base_limit,
          allocated_limit = v_limit,
          carried_count = greatest(v_limit - p_base_limit, 0),
          rollover_cap = v_effective_cap
      where u.account_id = p_account_id
        and u.period_start = p_period_start
        and u.media_kind = v_media_kind
      returning u.* into v_current;
    end if;

    limit_count := v_current.allocated_limit;
    used_count := v_current.used_count;
    reserved_count := v_current.reserved_count;
    return next;
    return;
  end if;

  select u.* into v_previous
  from public.ai_media_monthly_usage u
  where u.account_id = p_account_id
    and u.media_kind = v_media_kind
    and u.period_start < p_period_start
    and u.rollover_version = 1
  order by u.period_start desc
  limit 1
  for update;

  if p_base_limit = 0 then
    v_limit := 0;
  elsif found then
    v_months_gap :=
      ((pg_catalog.date_part('year', p_period_start)::integer
        - pg_catalog.date_part('year', v_previous.period_start)::integer) * 12)
      + (pg_catalog.date_part('month', p_period_start)::integer
        - pg_catalog.date_part('month', v_previous.period_start)::integer);

    if v_months_gap < 1 then
      raise exception 'AI_MEDIA_ROLLOVER_PERIOD_ORDER_BROKEN';
    end if;

    v_previous_remaining := greatest(
      v_previous.allocated_limit
        - v_previous.used_count
        - v_previous.reserved_count,
      0
    );
    v_limit := least(
      v_effective_cap::bigint,
      v_previous_remaining::bigint
        + (p_base_limit::bigint * v_months_gap::bigint)
    )::integer;
  else
    select greatest(
      date '2026-09-01',
      pg_catalog.date_trunc(
        'month',
        coalesce(s.start_date, a.created_at::date)::timestamp
      )::date
    ) into v_credit_start
    from public.inrcy_accounts a
    left join public.subscriptions s on s.user_id = a.id
    where a.id = p_account_id;

    if v_credit_start is null then
      raise exception 'AI_MEDIA_ROLLOVER_ACCOUNT_ANCHOR_MISSING';
    end if;

    v_limit := 0;
    v_credit_month := v_credit_start;
    while v_credit_month <= p_period_start loop
      v_limit := least(v_effective_cap, v_limit + p_base_limit);

      if v_credit_month < p_period_start then
        select coalesce(pg_catalog.sum(u.used_count + u.reserved_count), 0)::integer
          into v_period_spend
        from public.ai_media_monthly_usage u
        where u.account_id = p_account_id
          and u.media_kind = v_media_kind
          and u.period_start = v_credit_month;

        v_limit := greatest(v_limit - v_period_spend, 0);
      end if;

      v_credit_month := (v_credit_month + interval '1 month')::date;
    end loop;
  end if;

  insert into public.ai_media_monthly_usage (
    account_id,
    period_start,
    media_kind,
    used_count,
    reserved_count,
    base_limit,
    allocated_limit,
    carried_count,
    rollover_cap,
    rollover_version
  ) values (
    p_account_id,
    p_period_start,
    v_media_kind,
    0,
    0,
    p_base_limit,
    v_limit,
    greatest(v_limit - p_base_limit, 0),
    v_effective_cap,
    1
  )
  returning * into v_current;

  limit_count := v_current.allocated_limit;
  used_count := v_current.used_count;
  reserved_count := v_current.reserved_count;
  return next;
end;
$$;

revoke all on function public.ai_media_prepare_monthly_rollover(uuid, text, integer, integer, date)
from public, anon, authenticated;
grant execute on function public.ai_media_prepare_monthly_rollover(uuid, text, integer, integer, date)
to service_role;

create or replace function public.ai_media_restore_late_rollover_refund()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_current_period date := pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('UTC', pg_catalog.now())
  )::date;
  v_refund integer;
begin
  if old.rollover_version <> 1 or old.period_start >= v_current_period then
    return new;
  end if;

  v_refund :=
    (old.used_count + old.reserved_count)
    - (new.used_count + new.reserved_count);

  if v_refund <= 0 then
    return new;
  end if;

  update public.ai_media_monthly_usage u
  set allocated_limit = case
        when u.allocated_limit >= u.rollover_cap then u.allocated_limit
        else least(u.rollover_cap, u.allocated_limit + v_refund)
      end,
      carried_count = greatest(
        (
          case
            when u.allocated_limit >= u.rollover_cap then u.allocated_limit
            else least(u.rollover_cap, u.allocated_limit + v_refund)
          end
        ) - u.base_limit,
        0
      )
  where u.account_id = new.account_id
    and u.period_start = v_current_period
    and u.media_kind = new.media_kind
    and u.rollover_version = 1;

  return new;
end;
$$;

revoke all on function public.ai_media_restore_late_rollover_refund()
from public, anon, authenticated;
grant execute on function public.ai_media_restore_late_rollover_refund()
to service_role;

create trigger ai_media_monthly_usage_restore_late_rollover_refund
after update of used_count, reserved_count on public.ai_media_monthly_usage
for each row execute function public.ai_media_restore_late_rollover_refund();

create or replace function public.get_ai_media_generation_quota_v2(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_edition text
)
returns table (
  account_id uuid,
  edition text,
  studio_enabled boolean,
  media_kind text,
  quota_unit text,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_period_start date := pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('UTC', pg_catalog.now())
  )::date;
  v_reset_at timestamptz := (
    (pg_catalog.date_trunc('month', pg_catalog.timezone('UTC', pg_catalog.now())) + interval '1 month')
    at time zone 'UTC'
  );
  v_plan public.ai_media_plan_limits%rowtype;
  v_account_limits public.ai_media_account_limits%rowtype;
  v_image_base integer;
  v_video_base integer;
  v_image_limit integer;
  v_video_limit integer;
  v_image_used integer;
  v_video_used integer;
  v_image_reserved integer;
  v_video_reserved integer;
  v_video_rollover_cap integer;
begin
  perform public.ai_media_assert_account_actor(p_account_id, p_actor_auth_user_id);
  perform public.ai_media_expire_account_reservations(p_account_id, 1000);

  select p.* into v_plan
  from public.ai_media_plan_limits p
  where p.edition = pg_catalog.lower(pg_catalog.btrim(coalesce(p_edition, '')));

  if not found then
    raise exception 'AI_MEDIA_INVALID_EDITION';
  end if;

  select l.* into v_account_limits
  from public.ai_media_account_limits l
  where l.account_id = p_account_id;

  v_image_base := coalesce(
    v_account_limits.image_monthly_limit_override,
    v_plan.image_monthly_limit
  );
  v_video_base := coalesce(
    v_account_limits.video_monthly_limit_override,
    v_plan.video_monthly_limit
  );
  v_video_rollover_cap := case
    when v_plan.edition = 'standard' then 168
    else 480
  end;

  select prepared.limit_count, prepared.used_count, prepared.reserved_count
    into v_image_limit, v_image_used, v_image_reserved
  from public.ai_media_prepare_monthly_rollover(
    p_account_id,
    'image',
    v_image_base,
    70,
    v_period_start
  ) prepared;

  select prepared.limit_count, prepared.used_count, prepared.reserved_count
    into v_video_limit, v_video_used, v_video_reserved
  from public.ai_media_prepare_monthly_rollover(
    p_account_id,
    'video',
    v_video_base,
    v_video_rollover_cap,
    v_period_start
  ) prepared;

  account_id := p_account_id;
  edition := v_plan.edition;
  studio_enabled := v_plan.studio_enabled;
  media_kind := 'image';
  quota_unit := 'item';
  limit_count := v_image_limit;
  used_count := v_image_used;
  reserved_count := v_image_reserved;
  remaining_count := greatest(v_image_limit - v_image_used - v_image_reserved, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;

  media_kind := 'video';
  quota_unit := 'second';
  limit_count := v_video_limit;
  used_count := v_video_used;
  reserved_count := v_video_reserved;
  remaining_count := greatest(v_video_limit - v_video_used - v_video_reserved, 0);
  return next;
end;
$$;

revoke all on function public.get_ai_media_generation_quota_v2(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_ai_media_generation_quota_v2(uuid, uuid, text)
to service_role;

-- Compatibilite de lecture pendant le deploiement applicatif. Les compteurs
-- restent nommes *_count dans v1, mais la ligne video est deja en secondes.
create or replace function public.get_ai_media_generation_quota(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_edition text
)
returns table (
  account_id uuid,
  edition text,
  studio_enabled boolean,
  media_kind text,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    q.account_id,
    q.edition,
    q.studio_enabled,
    q.media_kind,
    q.limit_count,
    q.used_count,
    q.reserved_count,
    q.remaining_count,
    q.period_start,
    q.reset_at
  from public.get_ai_media_generation_quota_v2(
    p_account_id,
    p_actor_auth_user_id,
    p_edition
  ) q;
$$;

revoke all on function public.get_ai_media_generation_quota(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_ai_media_generation_quota(uuid, uuid, text)
to service_role;

create or replace function public.reserve_ai_media_generation_v2(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_request_key text,
  p_request_fingerprint text,
  p_media_kind text,
  p_surface text,
  p_edition text,
  p_quota_amount integer,
  p_reservation_ttl_seconds integer default 3600,
  p_limit_override integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  outcome text,
  job_id uuid,
  job_status text,
  is_replay boolean,
  reservation_expires_at timestamptz,
  media_kind text,
  quota_unit text,
  quota_amount integer,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request_key text := pg_catalog.btrim(coalesce(p_request_key, ''));
  v_fingerprint text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_request_fingerprint, '')));
  v_media_kind text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_media_kind, '')));
  v_surface text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_surface, '')));
  v_edition text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_edition, '')));
  v_quota_unit text;
  v_period_start date := pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('UTC', pg_catalog.now())
  )::date;
  v_reset_at timestamptz := (
    (pg_catalog.date_trunc('month', pg_catalog.timezone('UTC', pg_catalog.now())) + interval '1 month')
    at time zone 'UTC'
  );
  v_plan public.ai_media_plan_limits%rowtype;
  v_account_limits public.ai_media_account_limits%rowtype;
  v_job public.ai_media_generation_jobs%rowtype;
  v_base_limit integer;
  v_rollover_cap integer;
  v_rollover_limit integer;
  v_limit integer;
  v_used integer;
  v_reserved integer;
  v_expires_at timestamptz;
begin
  perform public.ai_media_assert_account_actor(p_account_id, p_actor_auth_user_id);

  if pg_catalog.length(v_request_key) not between 8 and 180 then
    raise exception 'AI_MEDIA_INVALID_REQUEST_KEY';
  end if;
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'AI_MEDIA_INVALID_FINGERPRINT';
  end if;
  if v_media_kind not in ('image', 'video') then
    raise exception 'AI_MEDIA_INVALID_KIND';
  end if;
  if v_surface not in ('booster', 'studio') then
    raise exception 'AI_MEDIA_INVALID_SURFACE';
  end if;
  if p_reservation_ttl_seconds not between 60 and 86400 then
    raise exception 'AI_MEDIA_INVALID_RESERVATION_TTL';
  end if;
  if p_limit_override is not null and p_limit_override not between 0 and 10000 then
    raise exception 'AI_MEDIA_INVALID_LIMIT_OVERRIDE';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'AI_MEDIA_INVALID_METADATA';
  end if;
  if p_quota_amount is null
     or (v_media_kind = 'image' and p_quota_amount <> 1)
     or (v_media_kind = 'video' and p_quota_amount not in (8, 16, 24)) then
    raise exception 'AI_MEDIA_INVALID_QUOTA_AMOUNT';
  end if;

  v_quota_unit := case when v_media_kind = 'video' then 'second' else 'item' end;

  select p.* into v_plan
  from public.ai_media_plan_limits p
  where p.edition = v_edition;

  if not found then
    raise exception 'AI_MEDIA_INVALID_EDITION';
  end if;

  select l.* into v_account_limits
  from public.ai_media_account_limits l
  where l.account_id = p_account_id;

  perform public.ai_media_expire_account_reservations(p_account_id, 1000);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_account_id::text),
    pg_catalog.hashtext(v_request_key)
  );

  select j.* into v_job
  from public.ai_media_generation_jobs j
  where j.account_id = p_account_id
    and j.request_key = v_request_key
  for update;

  if found then
    if v_job.request_fingerprint <> v_fingerprint
       or v_job.media_kind <> v_media_kind
       or v_job.surface <> v_surface
       or v_job.quota_unit <> v_quota_unit
       or v_job.quota_amount <> p_quota_amount then
      raise exception 'AI_MEDIA_IDEMPOTENCY_CONFLICT';
    end if;

    select coalesce(u.used_count, 0), coalesce(u.reserved_count, 0)
      into v_used, v_reserved
    from (values (1)) sentinel(n)
    left join public.ai_media_monthly_usage u
      on u.account_id = p_account_id
     and u.period_start = v_job.quota_period_start
     and u.media_kind = v_job.media_kind;

    outcome := 'replayed';
    job_id := v_job.id;
    job_status := v_job.status;
    is_replay := true;
    reservation_expires_at := v_job.reservation_expires_at;
    media_kind := v_job.media_kind;
    quota_unit := v_job.quota_unit;
    quota_amount := v_job.quota_amount;
    limit_count := v_job.monthly_limit;
    used_count := v_used;
    reserved_count := v_reserved;
    remaining_count := greatest(v_job.monthly_limit - v_used - v_reserved, 0);
    period_start := v_job.quota_period_start;
    reset_at := ((v_job.quota_period_start + interval '1 month')::timestamp at time zone 'UTC');
    return next;
    return;
  end if;

  v_base_limit := coalesce(
    case when v_media_kind = 'image'
      then v_account_limits.image_monthly_limit_override
      else v_account_limits.video_monthly_limit_override
    end,
    case when v_media_kind = 'image'
      then v_plan.image_monthly_limit
      else v_plan.video_monthly_limit
    end
  );
  v_rollover_cap := greatest(
    case
      when v_media_kind = 'image' then 70
      when v_plan.edition = 'standard' then 168
      else 480
    end,
    v_base_limit
  );

  select prepared.limit_count, prepared.used_count, prepared.reserved_count
    into v_rollover_limit, v_used, v_reserved
  from public.ai_media_prepare_monthly_rollover(
    p_account_id,
    v_media_kind,
    v_base_limit,
    v_rollover_cap,
    v_period_start
  ) prepared;

  v_limit := coalesce(p_limit_override, v_rollover_limit);

  if v_surface = 'studio' and not v_plan.studio_enabled then
    outcome := 'premium_required';
    job_id := null;
    job_status := null;
    is_replay := false;
    reservation_expires_at := null;
    media_kind := v_media_kind;
    quota_unit := v_quota_unit;
    quota_amount := p_quota_amount;
    limit_count := v_limit;
    used_count := v_used;
    reserved_count := v_reserved;
    remaining_count := greatest(v_limit - v_used - v_reserved, 0);
    period_start := v_period_start;
    reset_at := v_reset_at;
    return next;
    return;
  end if;

  if v_used + v_reserved + p_quota_amount > v_limit then
    outcome := 'quota_reached';
    job_id := null;
    job_status := null;
    is_replay := false;
    reservation_expires_at := null;
    media_kind := v_media_kind;
    quota_unit := v_quota_unit;
    quota_amount := p_quota_amount;
    limit_count := v_limit;
    used_count := v_used;
    reserved_count := v_reserved;
    remaining_count := greatest(v_limit - v_used - v_reserved, 0);
    period_start := v_period_start;
    reset_at := v_reset_at;
    return next;
    return;
  end if;

  v_expires_at := pg_catalog.now()
    + pg_catalog.make_interval(secs => p_reservation_ttl_seconds);

  insert into public.ai_media_generation_jobs (
    account_id,
    actor_auth_user_id,
    request_key,
    request_fingerprint,
    media_kind,
    surface,
    edition,
    monthly_limit,
    quota_period_start,
    quota_unit,
    quota_amount,
    status,
    reservation_expires_at,
    metadata
  ) values (
    p_account_id,
    p_actor_auth_user_id,
    v_request_key,
    v_fingerprint,
    v_media_kind,
    v_surface,
    v_plan.edition,
    v_limit,
    v_period_start,
    v_quota_unit,
    p_quota_amount,
    'reserved',
    v_expires_at,
    p_metadata
  )
  returning * into v_job;

  update public.ai_media_monthly_usage u
  set reserved_count = u.reserved_count + p_quota_amount
  where u.account_id = p_account_id
    and u.period_start = v_period_start
    and u.media_kind = v_media_kind;

  outcome := 'reserved';
  job_id := v_job.id;
  job_status := v_job.status;
  is_replay := false;
  reservation_expires_at := v_expires_at;
  media_kind := v_media_kind;
  quota_unit := v_quota_unit;
  quota_amount := p_quota_amount;
  limit_count := v_limit;
  used_count := v_used;
  reserved_count := v_reserved + p_quota_amount;
  remaining_count := greatest(
    v_limit - v_used - v_reserved - p_quota_amount,
    0
  );
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;
end;
$$;

revoke all on function public.reserve_ai_media_generation_v2(
  uuid, uuid, text, text, text, text, text, integer, integer, integer, jsonb
)
from public, anon, authenticated;
grant execute on function public.reserve_ai_media_generation_v2(
  uuid, uuid, text, text, text, text, text, integer, integer, integer, jsonb
)
to service_role;

-- Wrapper v1: le serveur historique fournit deja duration_seconds. Le fallback
-- 8 s est limite aux appels sans cette metadonnee pendant la fenetre de rollout.
create or replace function public.reserve_ai_media_generation(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_request_key text,
  p_request_fingerprint text,
  p_media_kind text,
  p_surface text,
  p_edition text,
  p_reservation_ttl_seconds integer default 3600,
  p_limit_override integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  outcome text,
  job_id uuid,
  job_status text,
  is_replay boolean,
  reservation_expires_at timestamptz,
  media_kind text,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    r.outcome,
    r.job_id,
    r.job_status,
    r.is_replay,
    r.reservation_expires_at,
    r.media_kind,
    r.limit_count,
    r.used_count,
    r.reserved_count,
    r.remaining_count,
    r.period_start,
    r.reset_at
  from public.reserve_ai_media_generation_v2(
    p_account_id,
    p_actor_auth_user_id,
    p_request_key,
    p_request_fingerprint,
    p_media_kind,
    p_surface,
    p_edition,
    case
      when pg_catalog.lower(pg_catalog.btrim(coalesce(p_media_kind, ''))) = 'image' then 1
      when (p_metadata ->> 'duration_seconds') ~ '^(8|16|24)$'
        then (p_metadata ->> 'duration_seconds')::integer
      else 8
    end,
    p_reservation_ttl_seconds,
    p_limit_override,
    p_metadata
  ) r;
$$;

revoke all on function public.reserve_ai_media_generation(
  uuid, uuid, text, text, text, text, text, integer, integer, jsonb
)
from public, anon, authenticated;
grant execute on function public.reserve_ai_media_generation(
  uuid, uuid, text, text, text, text, text, integer, integer, jsonb
)
to service_role;

create or replace function public.complete_ai_media_generation_v2(
  p_account_id uuid,
  p_job_id uuid,
  p_media_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  job_id uuid,
  job_status text,
  media_kind text,
  quota_unit text,
  quota_amount integer,
  media_id uuid,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_used integer;
  v_reserved integer;
begin
  if p_account_id is null or p_job_id is null or p_media_id is null then
    raise exception 'AI_MEDIA_INVALID_COMPLETION';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'AI_MEDIA_INVALID_METADATA';
  end if;

  select j.* into v_job
  from public.ai_media_generation_jobs j
  where j.id = p_job_id
    and j.account_id = p_account_id
  for update;

  if not found then
    raise exception 'AI_MEDIA_JOB_NOT_FOUND';
  end if;

  if v_job.status = 'completed' then
    if v_job.output_media_id is distinct from p_media_id then
      raise exception 'AI_MEDIA_COMPLETION_CONFLICT';
    end if;
  elsif v_job.status in ('failed', 'expired') then
    raise exception 'AI_MEDIA_JOB_TERMINAL';
  else
    if not exists (
      select 1
      from public.pro_media_library m
      where m.id = p_media_id
        and m.user_id = p_account_id
        and m.media_type = v_job.media_kind
        and m.upload_status = 'uploaded'
    ) then
      raise exception 'AI_MEDIA_OUTPUT_SCOPE_MISMATCH';
    end if;

    select u.used_count, u.reserved_count
      into v_used, v_reserved
    from public.ai_media_monthly_usage u
    where u.account_id = p_account_id
      and u.period_start = v_job.quota_period_start
      and u.media_kind = v_job.media_kind
    for update;

    if not found or v_reserved < v_job.quota_amount then
      raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN';
    end if;

    update public.ai_media_monthly_usage u
    set used_count = u.used_count + v_job.quota_amount,
        reserved_count = u.reserved_count - v_job.quota_amount
    where u.account_id = p_account_id
      and u.period_start = v_job.quota_period_start
      and u.media_kind = v_job.media_kind
    returning u.used_count, u.reserved_count into v_used, v_reserved;

    update public.ai_media_generation_jobs j
    set status = 'completed',
        output_media_id = p_media_id,
        metadata = j.metadata || p_metadata,
        completed_at = pg_catalog.now(),
        error_code = null,
        error_message = null
    where j.id = v_job.id
    returning * into v_job;
  end if;

  if v_used is null or v_reserved is null then
    select coalesce(u.used_count, 0), coalesce(u.reserved_count, 0)
      into v_used, v_reserved
    from (values (1)) sentinel(n)
    left join public.ai_media_monthly_usage u
      on u.account_id = p_account_id
     and u.period_start = v_job.quota_period_start
     and u.media_kind = v_job.media_kind;
  end if;

  job_id := v_job.id;
  job_status := v_job.status;
  media_kind := v_job.media_kind;
  quota_unit := v_job.quota_unit;
  quota_amount := v_job.quota_amount;
  media_id := v_job.output_media_id;
  limit_count := v_job.monthly_limit;
  used_count := v_used;
  reserved_count := v_reserved;
  remaining_count := greatest(v_job.monthly_limit - v_used - v_reserved, 0);
  period_start := v_job.quota_period_start;
  reset_at := ((v_job.quota_period_start + interval '1 month')::timestamp at time zone 'UTC');
  return next;
end;
$$;

revoke all on function public.complete_ai_media_generation_v2(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_ai_media_generation_v2(uuid, uuid, uuid, jsonb)
to service_role;

create or replace function public.complete_ai_media_generation(
  p_account_id uuid,
  p_job_id uuid,
  p_media_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  job_id uuid,
  job_status text,
  media_kind text,
  media_id uuid,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    r.job_id,
    r.job_status,
    r.media_kind,
    r.media_id,
    r.limit_count,
    r.used_count,
    r.reserved_count,
    r.remaining_count,
    r.period_start,
    r.reset_at
  from public.complete_ai_media_generation_v2(
    p_account_id,
    p_job_id,
    p_media_id,
    p_metadata
  ) r;
$$;

revoke all on function public.complete_ai_media_generation(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.complete_ai_media_generation(uuid, uuid, uuid, jsonb)
to service_role;

create or replace function public.fail_ai_media_generation_v2(
  p_account_id uuid,
  p_job_id uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  job_id uuid,
  job_status text,
  media_kind text,
  quota_unit text,
  quota_amount integer,
  media_id uuid,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_used integer;
  v_reserved integer;
begin
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'AI_MEDIA_INVALID_METADATA';
  end if;

  select j.* into v_job
  from public.ai_media_generation_jobs j
  where j.id = p_job_id
    and j.account_id = p_account_id
  for update;

  if not found then
    raise exception 'AI_MEDIA_JOB_NOT_FOUND';
  end if;

  if v_job.status in ('reserved', 'processing') then
    select u.used_count, u.reserved_count
      into v_used, v_reserved
    from public.ai_media_monthly_usage u
    where u.account_id = p_account_id
      and u.period_start = v_job.quota_period_start
      and u.media_kind = v_job.media_kind
    for update;

    if not found or v_reserved < v_job.quota_amount then
      raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN';
    end if;

    update public.ai_media_monthly_usage u
    set reserved_count = u.reserved_count - v_job.quota_amount
    where u.account_id = p_account_id
      and u.period_start = v_job.quota_period_start
      and u.media_kind = v_job.media_kind
    returning u.used_count, u.reserved_count into v_used, v_reserved;

    update public.ai_media_generation_jobs j
    set status = 'failed',
        metadata = j.metadata || p_metadata,
        failed_at = pg_catalog.now(),
        error_code = nullif(
          pg_catalog.left(pg_catalog.btrim(coalesce(p_error_code, '')), 120),
          ''
        ),
        error_message = nullif(
          pg_catalog.left(pg_catalog.btrim(coalesce(p_error_message, '')), 2000),
          ''
        )
    where j.id = v_job.id
    returning * into v_job;
  else
    select coalesce(u.used_count, 0), coalesce(u.reserved_count, 0)
      into v_used, v_reserved
    from (values (1)) sentinel(n)
    left join public.ai_media_monthly_usage u
      on u.account_id = p_account_id
     and u.period_start = v_job.quota_period_start
     and u.media_kind = v_job.media_kind;
  end if;

  job_id := v_job.id;
  job_status := v_job.status;
  media_kind := v_job.media_kind;
  quota_unit := v_job.quota_unit;
  quota_amount := v_job.quota_amount;
  media_id := v_job.output_media_id;
  limit_count := v_job.monthly_limit;
  used_count := v_used;
  reserved_count := v_reserved;
  remaining_count := greatest(v_job.monthly_limit - v_used - v_reserved, 0);
  period_start := v_job.quota_period_start;
  reset_at := ((v_job.quota_period_start + interval '1 month')::timestamp at time zone 'UTC');
  return next;
end;
$$;

revoke all on function public.fail_ai_media_generation_v2(uuid, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.fail_ai_media_generation_v2(uuid, uuid, text, text, jsonb)
to service_role;

create or replace function public.fail_ai_media_generation(
  p_account_id uuid,
  p_job_id uuid,
  p_error_code text default null,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  job_id uuid,
  job_status text,
  media_kind text,
  media_id uuid,
  limit_count integer,
  used_count integer,
  reserved_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select
    r.job_id,
    r.job_status,
    r.media_kind,
    r.media_id,
    r.limit_count,
    r.used_count,
    r.reserved_count,
    r.remaining_count,
    r.period_start,
    r.reset_at
  from public.fail_ai_media_generation_v2(
    p_account_id,
    p_job_id,
    p_error_code,
    p_error_message,
    p_metadata
  ) r;
$$;

revoke all on function public.fail_ai_media_generation(uuid, uuid, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.fail_ai_media_generation(uuid, uuid, text, text, jsonb)
to service_role;

create or replace function public.ai_media_expire_account_reservations(
  p_account_id uuid,
  p_batch_size integer default 1000
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_media_id uuid;
  v_expired integer := 0;
begin
  if p_account_id is null or p_batch_size not between 1 and 10000 then
    raise exception 'AI_MEDIA_INVALID_EXPIRATION_REQUEST';
  end if;

  for v_job in
    select j.*
    from public.ai_media_generation_jobs j
    where j.account_id = p_account_id
      and j.status in ('reserved', 'processing')
      and j.reservation_expires_at <= pg_catalog.now()
    order by j.reservation_expires_at, j.id
    limit p_batch_size
    for update skip locked
  loop
    v_media_id := null;
    select m.id into v_media_id
    from public.pro_media_library m
    where m.user_id = v_job.account_id
      and m.client_media_key = 'ai-media:' || v_job.id::text
      and m.media_type = v_job.media_kind
      and m.source in ('ai_media_generation', 'ai_media_generation_draft')
      and m.upload_protocol = 'server_legacy'
      and m.upload_status = 'uploaded'
      and (m.is_active is true or m.source = 'ai_media_generation_draft')
    limit 1;

    if v_media_id is not null then
      update public.ai_media_monthly_usage u
      set used_count = u.used_count + v_job.quota_amount,
          reserved_count = u.reserved_count - v_job.quota_amount
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count >= v_job.quota_amount;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'completed',
            output_media_id = v_media_id,
            completed_at = pg_catalog.now(),
            failed_at = null,
            error_code = null,
            error_message = null,
            metadata = j.metadata || pg_catalog.jsonb_build_object(
              'quota_recovered_from_library', true,
              'quota_recovered_at', pg_catalog.now()
            )
        where j.id = v_job.id
          and j.status in ('reserved', 'processing');
      end if;
    else
      update public.ai_media_monthly_usage u
      set reserved_count = u.reserved_count - v_job.quota_amount
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count >= v_job.quota_amount;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'expired',
            failed_at = pg_catalog.now(),
            error_code = 'reservation_expired',
            error_message = 'La reservation de quota a expire avant la finalisation du media.'
        where j.id = v_job.id
          and j.status in ('reserved', 'processing');

        if found then
          v_expired := v_expired + 1;
        end if;
      end if;
    end if;
  end loop;

  return v_expired;
end;
$$;

revoke all on function public.ai_media_expire_account_reservations(uuid, integer)
from public, anon, authenticated;
grant execute on function public.ai_media_expire_account_reservations(uuid, integer)
to service_role;

create or replace function public.expire_ai_media_generation_reservations(
  p_batch_size integer default 100
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_media_id uuid;
  v_expired integer := 0;
begin
  if p_batch_size not between 1 and 1000 then
    raise exception 'AI_MEDIA_INVALID_BATCH_SIZE';
  end if;

  for v_job in
    select j.*
    from public.ai_media_generation_jobs j
    where j.status in ('reserved', 'processing')
      and j.reservation_expires_at <= pg_catalog.now()
    order by j.reservation_expires_at, j.account_id, j.id
    limit p_batch_size
    for update skip locked
  loop
    v_media_id := null;
    select m.id into v_media_id
    from public.pro_media_library m
    where m.user_id = v_job.account_id
      and m.client_media_key = 'ai-media:' || v_job.id::text
      and m.media_type = v_job.media_kind
      and m.source in ('ai_media_generation', 'ai_media_generation_draft')
      and m.upload_protocol = 'server_legacy'
      and m.upload_status = 'uploaded'
      and (m.is_active is true or m.source = 'ai_media_generation_draft')
    limit 1;

    if v_media_id is not null then
      update public.ai_media_monthly_usage u
      set used_count = u.used_count + v_job.quota_amount,
          reserved_count = u.reserved_count - v_job.quota_amount
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count >= v_job.quota_amount;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'completed',
            output_media_id = v_media_id,
            completed_at = pg_catalog.now(),
            failed_at = null,
            error_code = null,
            error_message = null,
            metadata = j.metadata || pg_catalog.jsonb_build_object(
              'quota_recovered_from_library', true,
              'quota_recovered_at', pg_catalog.now()
            )
        where j.id = v_job.id
          and j.status in ('reserved', 'processing');
      end if;
    else
      update public.ai_media_monthly_usage u
      set reserved_count = u.reserved_count - v_job.quota_amount
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count >= v_job.quota_amount;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'expired',
            failed_at = pg_catalog.now(),
            error_code = 'reservation_expired',
            error_message = 'La reservation de quota a expire avant la finalisation du media.'
        where j.id = v_job.id
          and j.status in ('reserved', 'processing');

        if found then
          v_expired := v_expired + 1;
        end if;
      end if;
    end if;
  end loop;

  return v_expired;
end;
$$;

revoke all on function public.expire_ai_media_generation_reservations(integer)
from public, anon, authenticated;
grant execute on function public.expire_ai_media_generation_reservations(integer)
to service_role;

create or replace function public.ai_media_complete_temporary_draft_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_job_id uuid;
  v_used integer;
  v_reserved integer;
begin
  if new.source <> 'ai_media_generation_draft'
     or new.is_active is distinct from false
     or new.upload_status <> 'uploaded' then
    return new;
  end if;

  if new.client_media_key is null
     or new.client_media_key !~ '^ai-media:[0-9a-fA-F-]{36}$' then
    raise exception 'AI_MEDIA_DRAFT_JOB_KEY_INVALID';
  end if;
  v_job_id := pg_catalog.substr(new.client_media_key, 10)::uuid;

  select j.* into v_job
  from public.ai_media_generation_jobs j
  where j.id = v_job_id
    and j.account_id = new.user_id
  for update;

  if not found then
    raise exception 'AI_MEDIA_DRAFT_JOB_NOT_FOUND';
  end if;
  if v_job.media_kind <> new.media_type then
    raise exception 'AI_MEDIA_DRAFT_KIND_MISMATCH';
  end if;

  if v_job.status = 'completed' then
    if v_job.output_media_id is distinct from new.id then
      raise exception 'AI_MEDIA_DRAFT_COMPLETION_CONFLICT';
    end if;
    return new;
  end if;
  if v_job.status in ('failed', 'expired') then
    raise exception 'AI_MEDIA_DRAFT_JOB_TERMINAL';
  end if;

  select u.used_count, u.reserved_count
    into v_used, v_reserved
  from public.ai_media_monthly_usage u
  where u.account_id = v_job.account_id
    and u.period_start = v_job.quota_period_start
    and u.media_kind = v_job.media_kind
  for update;

  if not found or v_reserved < v_job.quota_amount then
    raise exception 'AI_MEDIA_DRAFT_RESERVATION_INVARIANT_BROKEN';
  end if;

  update public.ai_media_monthly_usage u
  set used_count = u.used_count + v_job.quota_amount,
      reserved_count = u.reserved_count - v_job.quota_amount
  where u.account_id = v_job.account_id
    and u.period_start = v_job.quota_period_start
    and u.media_kind = v_job.media_kind;

  update public.ai_media_generation_jobs j
  set status = 'completed',
      output_media_id = new.id,
      completed_at = pg_catalog.now(),
      failed_at = null,
      error_code = null,
      error_message = null,
      metadata = j.metadata || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'temporary_draft_created', true,
        'temporary_draft_created_at', pg_catalog.now(),
        'model', new.media_metadata #>> '{gateway,model}',
        'prompt_version', new.media_metadata #>> '{provenance,prompt_version}',
        'prompt_sha256', new.media_metadata #>> '{provenance,prompt_sha256}',
        'soundtrack_id', new.media_metadata #>> '{soundtrack,id}'
      ))
  where j.id = v_job.id;

  return new;
end;
$$;

revoke all on function public.ai_media_complete_temporary_draft_quota()
from public, anon, authenticated;

drop trigger if exists ai_media_complete_temporary_draft_quota
on public.pro_media_library;
create trigger ai_media_complete_temporary_draft_quota
after insert or update of source, is_active, upload_status
on public.pro_media_library
for each row execute function public.ai_media_complete_temporary_draft_quota();

comment on column public.ai_media_monthly_usage.rollover_cap is
  'Plafond de cagnotte dans l unite du media: 70 images; 168 s Standard; 480 s Premium/Founder.';
comment on function public.reserve_ai_media_generation_v2(
  uuid, uuid, text, text, text, text, text, integer, integer, integer, jsonb
) is
  'Reserve atomiquement 1 image ou 8/16/24 secondes video et fige cette quantite dans le ledger du job.';

do $$
declare
  v_signature text;
  v_definition text;
begin
  if not exists (
    select 1 from public.ai_media_plan_limits p
    where p.edition = 'standard'
      and p.video_monthly_limit = 48
      and p.video_max_duration_seconds = 24
  ) or not exists (
    select 1 from public.ai_media_plan_limits p
    where p.edition = 'premium'
      and p.video_monthly_limit = 144
      and p.video_max_duration_seconds = 24
  ) or not exists (
    select 1 from public.ai_media_plan_limits p
    where p.edition = 'founder'
      and p.video_monthly_limit = 144
      and p.video_max_duration_seconds = 24
  ) then
    raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: forfaits incorrects.';
  end if;

  if exists (
    select 1
    from public.ai_media_generation_jobs j
    where (j.media_kind = 'image' and (j.quota_unit <> 'item' or j.quota_amount <> 1))
       or (j.media_kind = 'video' and (j.quota_unit <> 'second' or j.quota_amount not in (8, 16, 24)))
  ) then
    raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: ledger invalide.';
  end if;

  foreach v_signature in array array[
    'public.get_ai_media_generation_quota_v2(uuid,uuid,text)',
    'public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)',
    'public.complete_ai_media_generation_v2(uuid,uuid,uuid,jsonb)',
    'public.fail_ai_media_generation_v2(uuid,uuid,text,text,jsonb)',
    'public.ai_media_expire_account_reservations(uuid,integer)',
    'public.expire_ai_media_generation_reservations(integer)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: fonction absente %', v_signature;
    end if;
    if pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: privileges invalides %', v_signature;
    end if;

    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
      into v_definition;
    if pg_catalog.strpos(v_definition, 'SET search_path TO ''''') = 0 then
      raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: search_path non vide %', v_signature;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ai_media_generation_jobs'::regclass
      and t.tgname = 'ai_media_generation_jobs_protect_quota_ledger'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: trigger immuable absent.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.ai_media_monthly_usage'::regclass
      and t.tgname = 'ai_media_monthly_usage_restore_late_rollover_refund'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception 'AI_MEDIA_SECONDS_VERIFICATION_FAILED: remboursement tardif absent.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
