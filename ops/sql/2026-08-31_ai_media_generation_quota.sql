-- iNrCy -- Quotas mensuels de generation de medias IA.
--
-- Regles de securite importantes :
--   * le quota appartient exclusivement a l'etablissement actif (account_id) ;
--   * une cle de requete est idempotente a l'interieur de cet etablissement ;
--   * une reservation devient une consommation uniquement apres enregistrement
--     du media final dans la mediatheque du meme etablissement ;
--   * les RPC d'ecriture sont uniquement accessibles au service_role.
--
-- Installation strictement additive et first-run : toute collision cible
-- provoque AI_MEDIA_INSTALL_COLLISION avant la premiere ecriture. Ne jamais
-- rejouer ce fichier ; toute evolution passe par une nouvelle migration datee.

begin;

do $$
declare
  v_collisions text;
  v_missing_columns text;
  v_missing_roles text;
begin
  select string_agg(
    format('%s:%s', c.object_type, c.object_identity),
    ', '
    order by c.object_type, c.object_identity
  )
  into v_collisions
  from (
    select
      case r.relkind
        when 'r' then 'table'
        when 'p' then 'partitioned_table'
        when 'i' then 'index'
        when 'S' then 'sequence'
        when 'v' then 'view'
        when 'm' then 'materialized_view'
        else 'relation_' || r.relkind::text
      end as object_type,
      format('%I.%I', n.nspname, r.relname) as object_identity
    from pg_class r
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and left(r.relname, 9) = 'ai_media_'

    union all

    select
      'function',
      format(
        '%I.%I(%s)',
        n.nspname,
        p.proname,
        pg_get_function_identity_arguments(p.oid)
      )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        left(p.proname, 9) = 'ai_media_'
        or p.proname in (
          'get_ai_media_generation_quota',
          'reserve_ai_media_generation',
          'complete_ai_media_generation',
          'fail_ai_media_generation',
          'expire_ai_media_generation_reservations'
        )
      )

    union all

    select
      'trigger',
      format('%I.%I trigger %I', n.nspname, r.relname, t.tgname)
    from pg_trigger t
    join pg_class r on r.oid = t.tgrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
      and left(t.tgname, 9) = 'ai_media_'

    union all

    select
      'policy',
      format('%I.%I policy %I', n.nspname, r.relname, p.polname)
    from pg_policy p
    join pg_class r on r.oid = p.polrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and left(p.polname, 9) = 'ai_media_'

    union all

    select
      'constraint',
      format('%I.%I constraint %I', n.nspname, r.relname, k.conname)
    from pg_constraint k
    join pg_class r on r.oid = k.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and left(k.conname, 9) = 'ai_media_'
  ) c;

  if v_collisions is not null then
    raise exception 'AI_MEDIA_INSTALL_COLLISION: installation first-run refusee; objets existants: %', v_collisions;
  end if;

  if to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.inrcy_account_members') is null
     or to_regclass('public.pro_media_library') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('public.inrcy_can_access_account(uuid)') is null then
    raise exception 'AI_MEDIA_PREFLIGHT_FAILED: appliquer le socle multicompte, auth.users et le registre media avant les quotas IA.';
  end if;

  if to_regprocedure('public.inrcy_touch_updated_at()') is null then
    raise exception 'AI_MEDIA_PREFLIGHT_FAILED: public.inrcy_touch_updated_at() est absente.';
  end if;

  if to_regprocedure('gen_random_uuid()') is null
     and not exists (
       select 1 from pg_extension e where e.extname = 'pgcrypto'
     ) then
    raise exception 'AI_MEDIA_PREFLIGHT_FAILED: gen_random_uuid() ou l extension pgcrypto est absente.';
  end if;

  select string_agg(
    format('%I.%I.%I (%s)', r.schema_name, r.table_name, r.column_name, r.udt_name),
    ', '
    order by r.schema_name, r.table_name, r.column_name
  )
  into v_missing_columns
  from (
    values
      ('auth', 'users', 'id', 'uuid'),
      ('public', 'inrcy_accounts', 'id', 'uuid'),
      ('public', 'inrcy_account_members', 'auth_user_id', 'uuid'),
      ('public', 'inrcy_account_members', 'account_id', 'uuid'),
      ('public', 'pro_media_library', 'id', 'uuid'),
      ('public', 'pro_media_library', 'user_id', 'uuid'),
      ('public', 'pro_media_library', 'account_id', 'uuid'),
      ('public', 'pro_media_library', 'client_media_key', 'text'),
      ('public', 'pro_media_library', 'media_type', 'text'),
      ('public', 'pro_media_library', 'source', 'text'),
      ('public', 'pro_media_library', 'upload_protocol', 'text'),
      ('public', 'pro_media_library', 'upload_status', 'text'),
      ('public', 'pro_media_library', 'is_active', 'bool')
  ) as r(schema_name, table_name, column_name, udt_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = r.schema_name
      and c.table_name = r.table_name
      and c.column_name = r.column_name
      and c.udt_name = r.udt_name
  );

  if v_missing_columns is not null then
    raise exception 'AI_MEDIA_PREFLIGHT_FAILED: colonnes absentes ou de type incorrect: %', v_missing_columns;
  end if;

  select string_agg(r.role_name, ', ' order by r.role_name)
  into v_missing_roles
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
  where not exists (
    select 1 from pg_roles p where p.rolname = r.role_name
  );

  if v_missing_roles is not null then
    raise exception 'AI_MEDIA_PREFLIGHT_FAILED: roles Supabase absents: %', v_missing_roles;
  end if;
end;
$$;

create table public.ai_media_plan_limits (
  edition text primary key,
  image_monthly_limit integer not null,
  video_monthly_limit integer not null,
  studio_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_media_plan_limits_edition_check
    check (edition in ('standard', 'premium', 'founder')),
  constraint ai_media_plan_limits_image_check
    check (image_monthly_limit between 1 and 10000),
  constraint ai_media_plan_limits_video_check
    check (video_monthly_limit between 1 and 10000)
);

insert into public.ai_media_plan_limits (
  edition,
  image_monthly_limit,
  video_monthly_limit,
  studio_enabled
)
values
  ('standard', 40, 3, false),
  ('premium', 100, 9, true),
  ('founder', 150, 12, true);

create table public.ai_media_monthly_usage (
  account_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  period_start date not null,
  media_kind text not null,
  used_count integer not null default 0,
  reserved_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, period_start, media_kind),
  constraint ai_media_monthly_usage_kind_check
    check (media_kind in ('image', 'video')),
  constraint ai_media_monthly_usage_used_check check (used_count >= 0),
  constraint ai_media_monthly_usage_reserved_check check (reserved_count >= 0)
);

create table public.ai_media_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  request_key text not null,
  request_fingerprint text not null,
  media_kind text not null,
  surface text not null,
  edition text not null,
  monthly_limit integer not null,
  quota_period_start date not null,
  status text not null default 'reserved',
  reservation_expires_at timestamptz not null,
  output_media_id uuid references public.pro_media_library(id) on delete set null,
  provider text,
  model text,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  reserved_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_media_generation_jobs_account_request_unique
    unique (account_id, request_key),
  constraint ai_media_generation_jobs_request_key_check
    check (length(btrim(request_key)) between 8 and 180),
  constraint ai_media_generation_jobs_fingerprint_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint ai_media_generation_jobs_kind_check
    check (media_kind in ('image', 'video')),
  constraint ai_media_generation_jobs_surface_check
    check (surface in ('booster', 'studio')),
  constraint ai_media_generation_jobs_edition_check
    check (edition in ('standard', 'premium', 'founder')),
  constraint ai_media_generation_jobs_limit_check
    check (monthly_limit between 1 and 10000),
  constraint ai_media_generation_jobs_status_check
    check (status in ('reserved', 'processing', 'completed', 'failed', 'expired')),
  constraint ai_media_generation_jobs_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint ai_media_generation_jobs_terminal_state_check check (
    -- output_media_id est obligatoire au moment du complete, mais peut devenir
    -- null ensuite via ON DELETE SET NULL si le pro supprime le media physique.
    (status = 'completed' and completed_at is not null)
    or (status in ('failed', 'expired') and failed_at is not null)
    or (status in ('reserved', 'processing') and output_media_id is null)
  )
);

create index ai_media_generation_jobs_account_created_idx
  on public.ai_media_generation_jobs (account_id, created_at desc);

create index ai_media_generation_jobs_expiration_idx
  on public.ai_media_generation_jobs (reservation_expires_at, account_id)
  where status in ('reserved', 'processing');

comment on table public.ai_media_monthly_usage is
  'Compteurs calendaires UTC strictement par etablissement et type de media.';
comment on table public.ai_media_generation_jobs is
  'Ledger durable et idempotent des reservations et consommations de medias IA.';
comment on column public.ai_media_generation_jobs.request_key is
  'Cle d idempotence serveur, unique uniquement dans le compte actif.';
comment on column public.ai_media_generation_jobs.output_media_id is
  'Media final sauvegarde dans pro_media_library pour le meme account_id.';

create trigger ai_media_plan_limits_touch_updated_at
before update on public.ai_media_plan_limits
for each row execute function public.inrcy_touch_updated_at();

create trigger ai_media_monthly_usage_touch_updated_at
before update on public.ai_media_monthly_usage
for each row execute function public.inrcy_touch_updated_at();

create trigger ai_media_generation_jobs_touch_updated_at
before update on public.ai_media_generation_jobs
for each row execute function public.inrcy_touch_updated_at();

alter table public.ai_media_plan_limits enable row level security;
alter table public.ai_media_monthly_usage enable row level security;
alter table public.ai_media_generation_jobs enable row level security;

create policy ai_media_plan_limits_authenticated_read
on public.ai_media_plan_limits
for select
to authenticated
using (true);

create policy ai_media_monthly_usage_account_read
on public.ai_media_monthly_usage
for select
to authenticated
using (public.inrcy_can_access_account(account_id));

create policy ai_media_generation_jobs_account_read
on public.ai_media_generation_jobs
for select
to authenticated
using (public.inrcy_can_access_account(account_id));

revoke all on public.ai_media_plan_limits from anon, authenticated;
revoke all on public.ai_media_monthly_usage from anon, authenticated;
revoke all on public.ai_media_generation_jobs from anon, authenticated;

grant select on public.ai_media_plan_limits to authenticated;
grant select on public.ai_media_monthly_usage to authenticated;
grant select on public.ai_media_generation_jobs to authenticated;

grant all on public.ai_media_plan_limits to service_role;
grant all on public.ai_media_monthly_usage to service_role;
grant all on public.ai_media_generation_jobs to service_role;

-- Validation explicite de l'association auth -> etablissement. Les RPC sont
-- service-role only, donc auth.uid() n'est pas disponible pour cette verification.
create function public.ai_media_assert_account_actor(
  p_account_id uuid,
  p_actor_auth_user_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
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

revoke all on function public.ai_media_assert_account_actor(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ai_media_assert_account_actor(uuid, uuid) to service_role;

-- Nettoyage paresseux borne : chaque lecture/reservation remet d'abord a jour
-- les reservations expirees du compte concerne. Le cron global reste utile
-- pour nettoyer les comptes inactifs, mais son retard ne bloque jamais un pro.
create function public.ai_media_expire_account_reservations(
  p_account_id uuid,
  p_batch_size integer default 1000
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
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
      and j.reservation_expires_at <= now()
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
      and m.source = 'ai_media_generation'
      and m.upload_protocol = 'server_legacy'
      and m.upload_status = 'uploaded'
      and m.is_active is true
    limit 1;

    if v_media_id is not null then
      -- Le provider et Storage ont reussi, mais l'appel complete a pu tomber.
      -- Recuperer ce media evite de rendre un credit deja reellement consomme.
      update public.ai_media_monthly_usage u
      set used_count = u.used_count + 1,
          reserved_count = u.reserved_count - 1
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count > 0;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'completed',
            output_media_id = v_media_id,
            completed_at = now(),
            failed_at = null,
            error_code = null,
            error_message = null,
            metadata = j.metadata || jsonb_build_object(
              'quota_recovered_from_library', true,
              'quota_recovered_at', now()
            )
        where j.id = v_job.id
          and j.status in ('reserved', 'processing');
      end if;
    else
      update public.ai_media_monthly_usage u
      set reserved_count = u.reserved_count - 1
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count > 0;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'expired',
            failed_at = now(),
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

revoke all on function public.ai_media_expire_account_reservations(uuid, integer) from public, anon, authenticated;
grant execute on function public.ai_media_expire_account_reservations(uuid, integer) to service_role;

create function public.get_ai_media_generation_quota(
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
begin
  perform public.ai_media_assert_account_actor(p_account_id, p_actor_auth_user_id);
  perform public.ai_media_expire_account_reservations(p_account_id, 1000);

  select p.* into v_plan
  from public.ai_media_plan_limits p
  where p.edition = lower(btrim(coalesce(p_edition, '')));

  if not found then
    raise exception 'AI_MEDIA_INVALID_EDITION';
  end if;

  return query
  with kinds(media_kind, limit_count) as (
    values
      ('image'::text, v_plan.image_monthly_limit),
      ('video'::text, v_plan.video_monthly_limit)
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

create function public.reserve_ai_media_generation(
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
  if p_limit_override is not null and p_limit_override not between 1 and 10000 then
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

create function public.complete_ai_media_generation(
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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_used integer;
  v_reserved integer;
begin
  if p_account_id is null or p_job_id is null or p_media_id is null then
    raise exception 'AI_MEDIA_INVALID_COMPLETION';
  end if;

  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
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

    if not found or v_reserved < 1 then
      raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN';
    end if;

    update public.ai_media_monthly_usage u
    set used_count = u.used_count + 1,
        reserved_count = u.reserved_count - 1
    where u.account_id = p_account_id
      and u.period_start = v_job.quota_period_start
      and u.media_kind = v_job.media_kind
    returning u.used_count, u.reserved_count into v_used, v_reserved;

    update public.ai_media_generation_jobs j
    set status = 'completed',
        output_media_id = p_media_id,
        metadata = j.metadata || p_metadata,
        completed_at = now(),
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

revoke all on function public.complete_ai_media_generation(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.complete_ai_media_generation(uuid, uuid, uuid, jsonb) to service_role;

create function public.fail_ai_media_generation(
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
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.ai_media_generation_jobs%rowtype;
  v_used integer;
  v_reserved integer;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
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

    if not found or v_reserved < 1 then
      raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN';
    end if;

    update public.ai_media_monthly_usage u
    set reserved_count = u.reserved_count - 1
    where u.account_id = p_account_id
      and u.period_start = v_job.quota_period_start
      and u.media_kind = v_job.media_kind
    returning u.used_count, u.reserved_count into v_used, v_reserved;

    update public.ai_media_generation_jobs j
    set status = 'failed',
        metadata = j.metadata || p_metadata,
        failed_at = now(),
        error_code = nullif(left(btrim(coalesce(p_error_code, '')), 120), ''),
        error_message = nullif(left(btrim(coalesce(p_error_message, '')), 2000), '')
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

revoke all on function public.fail_ai_media_generation(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fail_ai_media_generation(uuid, uuid, text, text, jsonb) to service_role;

-- A appeler periodiquement depuis un cron serveur. SKIP LOCKED permet plusieurs
-- workers sans double liberation d'une meme reservation.
create function public.expire_ai_media_generation_reservations(
  p_batch_size integer default 100
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
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
      and j.reservation_expires_at <= now()
    order by j.reservation_expires_at
    limit p_batch_size
    for update skip locked
  loop
    v_media_id := null;
    select m.id into v_media_id
    from public.pro_media_library m
    where m.user_id = v_job.account_id
      and m.client_media_key = 'ai-media:' || v_job.id::text
      and m.media_type = v_job.media_kind
      and m.source = 'ai_media_generation'
      and m.upload_protocol = 'server_legacy'
      and m.upload_status = 'uploaded'
      and m.is_active is true
    limit 1;

    if v_media_id is not null then
      update public.ai_media_monthly_usage u
      set used_count = u.used_count + 1,
          reserved_count = u.reserved_count - 1
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count > 0;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'completed',
            output_media_id = v_media_id,
            completed_at = now(),
            failed_at = null,
            error_code = null,
            error_message = null,
            metadata = j.metadata || jsonb_build_object(
              'quota_recovered_from_library', true,
              'quota_recovered_at', now()
            )
        where j.id = v_job.id
          and j.status in ('reserved', 'processing');
      end if;
    else
      update public.ai_media_monthly_usage u
      set reserved_count = u.reserved_count - 1
      where u.account_id = v_job.account_id
        and u.period_start = v_job.quota_period_start
        and u.media_kind = v_job.media_kind
        and u.reserved_count > 0;

      if found then
        update public.ai_media_generation_jobs j
        set status = 'expired',
            failed_at = now(),
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

revoke all on function public.expire_ai_media_generation_reservations(integer) from public, anon, authenticated;
grant execute on function public.expire_ai_media_generation_reservations(integer) to service_role;

commit;
