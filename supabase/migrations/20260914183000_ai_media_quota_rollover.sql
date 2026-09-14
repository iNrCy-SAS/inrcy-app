begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null
     or to_regclass('public.ai_media_account_limits') is null
     or to_regclass('public.ai_media_monthly_usage') is null
     or to_regclass('public.ai_media_generation_jobs') is null
     or to_regclass('public.subscriptions') is null then
    raise exception 'AI_MEDIA_ROLLOVER_PREFLIGHT_FAILED: socle quota media IA incomplet.';
  end if;

  if to_regprocedure('public.ai_media_assert_account_actor(uuid,uuid)') is null
     or to_regprocedure('public.ai_media_expire_account_reservations(uuid,integer)') is null
     or to_regprocedure('public.get_ai_media_generation_quota(uuid,uuid,text)') is null
     or to_regprocedure('public.reserve_ai_media_generation(uuid,uuid,text,text,text,text,text,integer,integer,jsonb)') is null then
    raise exception 'AI_MEDIA_ROLLOVER_PREFLIGHT_FAILED: RPC quota media IA incompletes.';
  end if;
end;
$$;

alter table public.ai_media_monthly_usage
  add column if not exists base_limit integer not null default 0,
  add column if not exists allocated_limit integer not null default 0,
  add column if not exists carried_count integer not null default 0,
  add column if not exists rollover_cap integer not null default 0,
  add column if not exists rollover_version smallint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_monthly_usage'::regclass
      and conname = 'ai_media_monthly_usage_base_limit_check'
  ) then
    alter table public.ai_media_monthly_usage
      add constraint ai_media_monthly_usage_base_limit_check
      check (base_limit between 0 and 10000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_monthly_usage'::regclass
      and conname = 'ai_media_monthly_usage_allocated_limit_check'
  ) then
    alter table public.ai_media_monthly_usage
      add constraint ai_media_monthly_usage_allocated_limit_check
      check (allocated_limit between 0 and 10000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_monthly_usage'::regclass
      and conname = 'ai_media_monthly_usage_carried_count_check'
  ) then
    alter table public.ai_media_monthly_usage
      add constraint ai_media_monthly_usage_carried_count_check
      check (carried_count between 0 and 10000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_monthly_usage'::regclass
      and conname = 'ai_media_monthly_usage_rollover_cap_check'
  ) then
    alter table public.ai_media_monthly_usage
      add constraint ai_media_monthly_usage_rollover_cap_check
      check (rollover_cap between 0 and 10000);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_monthly_usage'::regclass
      and conname = 'ai_media_monthly_usage_rollover_version_check'
  ) then
    alter table public.ai_media_monthly_usage
      add constraint ai_media_monthly_usage_rollover_version_check
      check (rollover_version in (0, 1));
  end if;
end;
$$;

comment on column public.ai_media_monthly_usage.base_limit is
  'Recharge mensuelle du forfait ou de la limite propre au compte, figee pour cette periode.';
comment on column public.ai_media_monthly_usage.allocated_limit is
  'Credits totaux utilisables pendant la periode apres report, avant deduction des usages et reservations.';
comment on column public.ai_media_monthly_usage.carried_count is
  'Part de allocated_limit issue des periodes precedentes.';
comment on column public.ai_media_monthly_usage.rollover_cap is
  'Plafond de cagnotte applique a la periode. Le socle commercial est 70 images et 20 videos.';
comment on column public.ai_media_monthly_usage.rollover_version is
  '0 = compteur historique non reporte; 1 = periode initialisee par la cagnotte glissante.';

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
set search_path = public, pg_temp
as $$
declare
  v_media_kind text := lower(btrim(coalesce(p_media_kind, '')));
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
     or p_period_start <> date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_PERIOD';
  end if;

  -- Un plafond personnalise superieur reste prioritaire et n'est jamais rabote.
  v_effective_cap := greatest(p_rollover_cap, p_base_limit);

  -- Une seule transaction peut initialiser/recharger ce compte et ce type.
  perform pg_advisory_xact_lock(
    hashtext(p_account_id::text),
    hashtext('ai-media-rollover:' || v_media_kind)
  );

  select u.*
    into v_current
  from public.ai_media_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = p_period_start
    and u.media_kind = v_media_kind
  for update;

  if found then
    if v_current.rollover_version = 0 then
      -- Demarrage sans cadeau retroactif: le mois courant garde uniquement
      -- sa recharge normale et ses consommations deja enregistrees.
      v_limit := case
        when p_base_limit = 0 then 0
        else greatest(p_base_limit, v_current.used_count + v_current.reserved_count)
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
      -- Une hausse de forfait credite immediatement la difference. Une baisse
      -- ne retire pas des credits deja acquis; elle s'applique aux recharges
      -- suivantes. La valeur 0 conserve son sens historique: desactivation.
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

  select u.*
    into v_previous
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
      ((extract(year from p_period_start)::integer
        - extract(year from v_previous.period_start)::integer) * 12)
      + (extract(month from p_period_start)::integer
        - extract(month from v_previous.period_start)::integer);

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
    -- Aucun passage par le Studio n'est requis pour cumuler: l'ancre est le
    -- mois de deploiement du report ou, pour un nouvel abonne, son mois de
    -- debut d'abonnement. Les usages historiques connus sont deduits mois par
    -- mois afin que les credits ecrases par un ancien plafond ne reapparaissent
    -- jamais plus tard.
    select greatest(
      date '2026-09-01',
      date_trunc(
        'month',
        coalesce(s.start_date, a.created_at::date)::timestamp
      )::date
    )
      into v_credit_start
    from public.inrcy_accounts a
    left join public.subscriptions s
      on s.user_id = a.id
    where a.id = p_account_id;

    if v_credit_start is null then
      raise exception 'AI_MEDIA_ROLLOVER_ACCOUNT_ANCHOR_MISSING';
    end if;

    v_limit := 0;
    v_credit_month := v_credit_start;
    while v_credit_month <= p_period_start loop
      v_limit := least(v_effective_cap, v_limit + p_base_limit);

      if v_credit_month < p_period_start then
        select coalesce(sum(u.used_count + u.reserved_count), 0)::integer
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
  )
  values (
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
set search_path = public, pg_temp
as $$
declare
  v_current_period date := date_trunc('month', timezone('UTC', now()))::date;
  v_refund integer;
begin
  if old.rollover_version <> 1
     or old.period_start >= v_current_period then
    return new;
  end if;

  v_refund :=
    (old.used_count + old.reserved_count)
    - (new.used_count + new.reserved_count);

  if v_refund <= 0 then
    return new;
  end if;

  -- Cas limite du changement de mois: si une reservation du mois precedent
  -- echoue apres l'ouverture de la nouvelle cagnotte, son credit est restitue
  -- au mois courant sans jamais depasser le plafond.
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

drop trigger if exists ai_media_monthly_usage_restore_late_rollover_refund
on public.ai_media_monthly_usage;
create trigger ai_media_monthly_usage_restore_late_rollover_refund
after update of used_count, reserved_count on public.ai_media_monthly_usage
for each row execute function public.ai_media_restore_late_rollover_refund();

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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := ((date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC');
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
begin
  perform public.ai_media_assert_account_actor(p_account_id, p_actor_auth_user_id);
  perform public.ai_media_expire_account_reservations(p_account_id, 1000);

  select p.* into v_plan
  from public.ai_media_plan_limits p
  where p.edition = lower(btrim(coalesce(p_edition, '')));

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
    20,
    v_period_start
  ) prepared;

  account_id := p_account_id;
  edition := v_plan.edition;
  studio_enabled := v_plan.studio_enabled;
  media_kind := 'image';
  limit_count := v_image_limit;
  used_count := v_image_used;
  reserved_count := v_image_reserved;
  remaining_count := greatest(v_image_limit - v_image_used - v_image_reserved, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;

  media_kind := 'video';
  limit_count := v_video_limit;
  used_count := v_video_used;
  reserved_count := v_video_reserved;
  remaining_count := greatest(v_video_limit - v_video_used - v_video_reserved, 0);
  return next;
end;
$$;

revoke all on function public.get_ai_media_generation_quota(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_ai_media_generation_quota(uuid, uuid, text)
to service_role;

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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_fingerprint text := lower(btrim(coalesce(p_request_fingerprint, '')));
  v_media_kind text := lower(btrim(coalesce(p_media_kind, '')));
  v_surface text := lower(btrim(coalesce(p_surface, '')));
  v_edition text := lower(btrim(coalesce(p_edition, '')));
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := ((date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC');
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

  if length(v_request_key) not between 8 and 180 then
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
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'AI_MEDIA_INVALID_METADATA';
  end if;

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

  -- Serialise tous les appels concurrents portant la meme cle du meme compte.
  perform pg_advisory_xact_lock(hashtext(p_account_id::text), hashtext(v_request_key));

  select j.* into v_job
  from public.ai_media_generation_jobs j
  where j.account_id = p_account_id
    and j.request_key = v_request_key
  for update;

  if found then
    if v_job.request_fingerprint <> v_fingerprint
       or v_job.media_kind <> v_media_kind
       or v_job.surface <> v_surface then
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
    case when v_media_kind = 'image' then 70 else 20 end,
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

  -- L'override ponctuel admin reste un fusible hors quota commercial.
  v_limit := coalesce(p_limit_override, v_rollover_limit);

  if v_surface = 'studio' and not v_plan.studio_enabled then
    outcome := 'premium_required';
    job_id := null;
    job_status := null;
    is_replay := false;
    reservation_expires_at := null;
    media_kind := v_media_kind;
    limit_count := v_limit;
    used_count := v_used;
    reserved_count := v_reserved;
    remaining_count := greatest(v_limit - v_used - v_reserved, 0);
    period_start := v_period_start;
    reset_at := v_reset_at;
    return next;
    return;
  end if;

  if v_used + v_reserved >= v_limit then
    outcome := 'quota_reached';
    job_id := null;
    job_status := null;
    is_replay := false;
    reservation_expires_at := null;
    media_kind := v_media_kind;
    limit_count := v_limit;
    used_count := v_used;
    reserved_count := v_reserved;
    remaining_count := 0;
    period_start := v_period_start;
    reset_at := v_reset_at;
    return next;
    return;
  end if;

  v_expires_at := now() + make_interval(secs => p_reservation_ttl_seconds);

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
    status,
    reservation_expires_at,
    metadata
  )
  values (
    p_account_id,
    p_actor_auth_user_id,
    v_request_key,
    v_fingerprint,
    v_media_kind,
    v_surface,
    v_plan.edition,
    v_limit,
    v_period_start,
    'reserved',
    v_expires_at,
    p_metadata
  )
  returning * into v_job;

  update public.ai_media_monthly_usage u
  set reserved_count = u.reserved_count + 1
  where u.account_id = p_account_id
    and u.period_start = v_period_start
    and u.media_kind = v_media_kind;

  outcome := 'reserved';
  job_id := v_job.id;
  job_status := v_job.status;
  is_replay := false;
  reservation_expires_at := v_expires_at;
  media_kind := v_media_kind;
  limit_count := v_limit;
  used_count := v_used;
  reserved_count := v_reserved + 1;
  remaining_count := greatest(v_limit - v_used - v_reserved - 1, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;
end;
$$;

revoke all on function public.reserve_ai_media_generation(uuid, uuid, text, text, text, text, text, integer, integer, jsonb)
from public, anon, authenticated;
grant execute on function public.reserve_ai_media_generation(uuid, uuid, text, text, text, text, text, integer, integer, jsonb)
to service_role;

do $$
declare
  v_get_definition text;
  v_reserve_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_monthly_usage'
      and column_name = 'rollover_version'
  ) then
    raise exception 'AI_MEDIA_ROLLOVER_VERIFICATION_FAILED: colonnes absentes.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.ai_media_monthly_usage'::regclass
      and tgname = 'ai_media_monthly_usage_restore_late_rollover_refund'
      and not tgisinternal
  ) then
    raise exception 'AI_MEDIA_ROLLOVER_VERIFICATION_FAILED: trigger de restitution absent.';
  end if;

  select pg_get_functiondef('public.get_ai_media_generation_quota(uuid,uuid,text)'::regprocedure)
    into v_get_definition;
  select pg_get_functiondef(
    'public.reserve_ai_media_generation(uuid,uuid,text,text,text,text,text,integer,integer,jsonb)'::regprocedure
  ) into v_reserve_definition;

  if position('ai_media_prepare_monthly_rollover' in v_get_definition) = 0
     or position('v_image_base' in v_get_definition) = 0
     or position('v_video_base' in v_get_definition) = 0
     or position('70' in v_get_definition) = 0
     or position('20' in v_get_definition) = 0
     or position('ai_media_prepare_monthly_rollover' in v_reserve_definition) = 0
     or position('then 70 else 20 end' in v_reserve_definition) = 0 then
    raise exception 'AI_MEDIA_ROLLOVER_VERIFICATION_FAILED: RPC non branchees aux plafonds 70/20.';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.ai_media_prepare_monthly_rollover(uuid,text,integer,integer,date)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.ai_media_prepare_monthly_rollover(uuid,text,integer,integer,date)',
       'EXECUTE'
     ) then
    raise exception 'AI_MEDIA_ROLLOVER_VERIFICATION_FAILED: helper expose au client.';
  end if;
end;
$$;

commit;
