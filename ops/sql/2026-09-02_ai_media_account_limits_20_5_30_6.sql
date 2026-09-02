begin;

do $$
begin
  if to_regclass('public.inrcy_accounts') is null then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_PREFLIGHT_FAILED: public.inrcy_accounts est absente.';
  end if;
  if to_regclass('public.ai_media_plan_limits') is null
     or to_regclass('public.ai_media_monthly_usage') is null
     or to_regclass('public.ai_media_generation_jobs') is null then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_PREFLIGHT_FAILED: le socle quota media IA est absent.';
  end if;
  if to_regprocedure('public.inrcy_touch_updated_at()') is null then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_PREFLIGHT_FAILED: public.inrcy_touch_updated_at() est absente.';
  end if;
end;
$$;

create table public.ai_media_account_limits (
  account_id uuid primary key
    references public.inrcy_accounts(id) on delete cascade,
  image_monthly_limit_override integer,
  video_monthly_limit_override integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_media_account_limits_image_check
    check (image_monthly_limit_override is null or image_monthly_limit_override between 0 and 10000),
  constraint ai_media_account_limits_video_check
    check (video_monthly_limit_override is null or video_monthly_limit_override between 0 and 10000)
);

comment on table public.ai_media_account_limits is
  'Plafonds media IA par etablissement. NULL herite du forfait, 0 desactive le type, une valeur positive fixe le plafond mensuel exact.';
comment on column public.ai_media_account_limits.image_monthly_limit_override is
  'NULL = forfait, 0 = images IA desactivees, entier positif = plafond mensuel exact.';
comment on column public.ai_media_account_limits.video_monthly_limit_override is
  'NULL = forfait, 0 = videos IA desactivees, entier positif = plafond mensuel exact.';

create trigger ai_media_account_limits_touch_updated_at
before update on public.ai_media_account_limits
for each row execute function public.inrcy_touch_updated_at();

alter table public.ai_media_account_limits enable row level security;

revoke all on public.ai_media_account_limits from public, anon, authenticated;
grant all on public.ai_media_account_limits to service_role;

insert into public.ai_media_plan_limits (
  edition,
  image_monthly_limit,
  video_monthly_limit,
  studio_enabled
)
values
  ('standard', 20, 5, true),
  ('premium', 30, 6, true),
  ('founder', 30, 6, true)
on conflict (edition) do update
set image_monthly_limit = excluded.image_monthly_limit,
    video_monthly_limit = excluded.video_monthly_limit,
    studio_enabled = excluded.studio_enabled,
    updated_at = now();

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
  v_image_limit integer;
  v_video_limit integer;
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

  v_image_limit := coalesce(
    v_account_limits.image_monthly_limit_override,
    v_plan.image_monthly_limit
  );
  v_video_limit := coalesce(
    v_account_limits.video_monthly_limit_override,
    v_plan.video_monthly_limit
  );

  return query
  with kinds(media_kind, limit_count) as (
    values
      ('image'::text, v_image_limit),
      ('video'::text, v_video_limit)
  )
  select
    p_account_id,
    v_plan.edition,
    v_plan.studio_enabled,
    k.media_kind,
    k.limit_count,
    coalesce(u.used_count, 0)::integer,
    coalesce(u.reserved_count, 0)::integer,
    greatest(k.limit_count - coalesce(u.used_count, 0) - coalesce(u.reserved_count, 0), 0)::integer,
    v_period_start,
    v_reset_at
  from kinds k
  left join public.ai_media_monthly_usage u
    on u.account_id = p_account_id
   and u.period_start = v_period_start
   and u.media_kind = k.media_kind
  order by k.media_kind;
end;
$$;

revoke all on function public.get_ai_media_generation_quota(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.get_ai_media_generation_quota(uuid, uuid, text) to service_role;

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

  v_limit := coalesce(
    p_limit_override,
    case when v_media_kind = 'image'
      then v_account_limits.image_monthly_limit_override
      else v_account_limits.video_monthly_limit_override
    end,
    case when v_media_kind = 'image'
      then v_plan.image_monthly_limit
      else v_plan.video_monthly_limit
    end
  );

  if v_surface = 'studio' and not v_plan.studio_enabled then
    outcome := 'premium_required';
    job_id := null;
    job_status := null;
    is_replay := false;
    reservation_expires_at := null;
    media_kind := v_media_kind;
    limit_count := v_limit;
    select coalesce(u.used_count, 0), coalesce(u.reserved_count, 0)
      into v_used, v_reserved
    from (values (1)) sentinel(n)
    left join public.ai_media_monthly_usage u
      on u.account_id = p_account_id
     and u.period_start = v_period_start
     and u.media_kind = v_media_kind;
    used_count := v_used;
    reserved_count := v_reserved;
    remaining_count := greatest(v_limit - v_used - v_reserved, 0);
    period_start := v_period_start;
    reset_at := v_reset_at;
    return next;
    return;
  end if;

  insert into public.ai_media_monthly_usage (
    account_id,
    period_start,
    media_kind,
    used_count,
    reserved_count
  )
  values (p_account_id, v_period_start, v_media_kind, 0, 0)
  on conflict on constraint ai_media_monthly_usage_pkey do nothing;

  select u.used_count, u.reserved_count
    into v_used, v_reserved
  from public.ai_media_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = v_period_start
    and u.media_kind = v_media_kind
  for update;

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

revoke all on function public.reserve_ai_media_generation(uuid, uuid, text, text, text, text, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_ai_media_generation(uuid, uuid, text, text, text, text, text, integer, integer, jsonb) to service_role;

do $$
begin
  if not exists (
    select 1
    from public.ai_media_plan_limits
    where edition = 'standard'
      and image_monthly_limit = 20
      and video_monthly_limit = 5
      and studio_enabled
  ) or not exists (
    select 1
    from public.ai_media_plan_limits
    where edition = 'premium'
      and image_monthly_limit = 30
      and video_monthly_limit = 6
      and studio_enabled
  ) or not exists (
    select 1
    from public.ai_media_plan_limits
    where edition = 'founder'
      and image_monthly_limit = 30
      and video_monthly_limit = 6
      and studio_enabled
  ) then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_VERIFICATION_FAILED: plafonds de forfait incorrects.';
  end if;
end;
$$;

commit;
