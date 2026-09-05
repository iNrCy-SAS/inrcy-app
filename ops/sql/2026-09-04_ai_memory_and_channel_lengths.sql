-- ADN entreprise + longueurs distinctes Sites/iNr'Search et Réseaux/Google Business
-- + quota mensuel atomique de l'analyse multicanal.
-- Migration additive et idempotente. À exécuter avant le déploiement du ZIP.

begin;

do $$
begin
  if to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.inrcy_account_members') is null
     or to_regprocedure('public.inrcy_can_access_account(uuid)') is null
     or to_regprocedure('public.inrcy_touch_updated_at()') is null then
    raise exception 'AI_MEMORY_PREFLIGHT_FAILED: exécuter d''abord le socle multicompte du 2026-07-05.';
  end if;
end;
$$;

alter table public.business_profiles
  add column if not exists ai_web_length text,
  add column if not exists ai_social_length text,
  add column if not exists ai_technicality_level text not null default 'balanced',
  add column if not exists ai_humor_level text not null default 'none';

-- L'ancien `detailed` devient `long` sans modifier ai_length, conservé pour les
-- anciens clients. Les nouveaux champs deviennent la source canonique.
update public.business_profiles
set
  ai_web_length = case lower(btrim(coalesce(ai_web_length, '')))
    when 'adapted' then 'adapted'
    when 'short' then 'short'
    when 'medium' then 'medium'
    when 'detailed' then 'long'
    when 'long' then 'long'
    when 'deep' then 'deep'
    else case lower(btrim(coalesce(ai_length, '')))
      when 'short' then 'short'
      when 'medium' then 'medium'
      when 'detailed' then 'long'
      when 'long' then 'long'
      when 'deep' then 'deep'
      when 'adapted' then 'adapted'
      else 'adapted'
    end
  end,
  ai_social_length = case lower(btrim(coalesce(ai_social_length, '')))
    when 'adapted' then 'adapted'
    when 'short' then 'short'
    when 'medium' then 'medium'
    when 'detailed' then 'long'
    when 'long' then 'long'
    when 'deep' then 'deep'
    else case lower(btrim(coalesce(ai_length, '')))
      when 'short' then 'short'
      when 'medium' then 'medium'
      when 'detailed' then 'long'
      when 'long' then 'long'
      when 'deep' then 'deep'
      when 'adapted' then 'adapted'
      else 'adapted'
    end
  end;

alter table public.business_profiles
  alter column ai_web_length set default 'adapted',
  alter column ai_web_length set not null,
  alter column ai_social_length set default 'adapted',
  alter column ai_social_length set not null;

alter table public.business_profiles
  drop constraint if exists business_profiles_ai_web_length_check,
  drop constraint if exists business_profiles_ai_social_length_check,
  drop constraint if exists business_profiles_ai_technicality_level_check,
  drop constraint if exists business_profiles_ai_humor_level_check;

alter table public.business_profiles
  add constraint business_profiles_ai_web_length_check
    check (ai_web_length in ('adapted', 'short', 'medium', 'long', 'deep')),
  add constraint business_profiles_ai_social_length_check
    check (ai_social_length in ('adapted', 'short', 'medium', 'long', 'deep')),
  add constraint business_profiles_ai_technicality_level_check
    check (ai_technicality_level in ('accessible', 'balanced', 'expert')),
  add constraint business_profiles_ai_humor_level_check
    check (ai_humor_level in ('none', 'light', 'present'));

comment on column public.business_profiles.ai_web_length is
  'Longueur IA pour Site iNrCy, Site web et iNr''Search : adapted, short, medium, long, deep.';
comment on column public.business_profiles.ai_social_length is
  'Longueur IA pour réseaux sociaux et Google Business : adapted, short, medium, long, deep.';
comment on column public.business_profiles.ai_technicality_level is
  'Niveau de technicité éditoriale : accessible, balanced, expert.';
comment on column public.business_profiles.ai_humor_level is
  'Présence souhaitée de l humour dans les contenus : none, light, present.';

create table if not exists public.business_ai_memories (
  account_id uuid primary key references public.inrcy_accounts(id) on delete cascade,
  schema_version smallint not null default 1,
  memory jsonb not null default '{}'::jsonb,
  completion_score smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_ai_memories_schema_version_check check (schema_version >= 1),
  constraint business_ai_memories_memory_object_check check (jsonb_typeof(memory) = 'object'),
  constraint business_ai_memories_completion_score_check check (completion_score between 0 and 100)
);

comment on table public.business_ai_memories is
  'Mémoire métier structurée utilisée pour personnaliser les générations IA d''un établissement iNrCy.';
comment on column public.business_ai_memories.memory is
  'Données structurées versionnées. Les trois blocs Premium sont filtrés côté serveur selon l''édition active.';

drop trigger if exists business_ai_memories_touch_updated_at on public.business_ai_memories;
create trigger business_ai_memories_touch_updated_at
before update on public.business_ai_memories
for each row execute function public.inrcy_touch_updated_at();

alter table public.business_ai_memories enable row level security;

revoke all on public.business_ai_memories from anon, authenticated;
grant select, insert, update on public.business_ai_memories to authenticated;
grant all on public.business_ai_memories to service_role;

drop policy if exists business_ai_memories_select_accessible on public.business_ai_memories;
create policy business_ai_memories_select_accessible
on public.business_ai_memories for select to authenticated
using (public.inrcy_can_access_account(account_id));

drop policy if exists business_ai_memories_insert_accessible on public.business_ai_memories;
create policy business_ai_memories_insert_accessible
on public.business_ai_memories for insert to authenticated
with check (public.inrcy_can_access_account(account_id));

drop policy if exists business_ai_memories_update_accessible on public.business_ai_memories;
create policy business_ai_memories_update_accessible
on public.business_ai_memories for update to authenticated
using (public.inrcy_can_access_account(account_id))
with check (public.inrcy_can_access_account(account_id));

-- Une analyse multicanal est une seule action, quel que soit le nombre de
-- sources connectées. Le plan reste en table pour permettre un ajustement
-- commercial sans modifier le code applicatif.
create table if not exists public.business_dna_analysis_plan_limits (
  edition text primary key,
  monthly_limit integer not null,
  updated_at timestamptz not null default now(),
  constraint business_dna_analysis_plan_limits_edition_check
    check (edition in ('standard', 'premium', 'founder')),
  constraint business_dna_analysis_plan_limits_monthly_limit_check
    check (monthly_limit between 1 and 1000)
);

insert into public.business_dna_analysis_plan_limits (edition, monthly_limit)
values
  ('standard', 4),
  ('premium', 16),
  ('founder', 16)
on conflict (edition) do update
set monthly_limit = excluded.monthly_limit,
    updated_at = now();

comment on table public.business_dna_analysis_plan_limits is
  'Plafonds mensuels par édition pour l''analyse IA multicanal de l''ADN entreprise.';

create table if not exists public.business_dna_analysis_monthly_usage (
  account_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  period_start date not null,
  used_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, period_start),
  constraint business_dna_analysis_monthly_usage_count_check
    check (used_count between 0 and 1000),
  constraint business_dna_analysis_monthly_usage_period_check
    check (period_start = date_trunc('month', period_start)::date)
);

comment on table public.business_dna_analysis_monthly_usage is
  'Nombre d''analyses ADN multicanal consommées par établissement et mois UTC.';

drop trigger if exists business_dna_analysis_monthly_usage_touch_updated_at
on public.business_dna_analysis_monthly_usage;
create trigger business_dna_analysis_monthly_usage_touch_updated_at
before update on public.business_dna_analysis_monthly_usage
for each row execute function public.inrcy_touch_updated_at();

alter table public.business_dna_analysis_plan_limits enable row level security;
alter table public.business_dna_analysis_monthly_usage enable row level security;

revoke all on public.business_dna_analysis_plan_limits from anon, authenticated;
revoke all on public.business_dna_analysis_monthly_usage from anon, authenticated;
grant all on public.business_dna_analysis_plan_limits to service_role;
grant all on public.business_dna_analysis_monthly_usage to service_role;

drop policy if exists business_dna_analysis_usage_select_accessible
on public.business_dna_analysis_monthly_usage;
create policy business_dna_analysis_usage_select_accessible
on public.business_dna_analysis_monthly_usage for select to authenticated
using (public.inrcy_can_access_account(account_id));

create or replace function public.business_dna_assert_account_actor(
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
  if p_account_id is null or p_actor_auth_user_id is null or not exists (
    select 1
    from public.inrcy_account_members m
    where m.account_id = p_account_id
      and m.auth_user_id = p_actor_auth_user_id
  ) then
    raise exception 'BUSINESS_DNA_ACCOUNT_ACCESS_DENIED';
  end if;
end;
$$;

revoke all on function public.business_dna_assert_account_actor(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.business_dna_assert_account_actor(uuid, uuid)
to service_role;

create or replace function public.get_business_dna_analysis_quota(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_edition text
)
returns table (
  edition text,
  limit_count integer,
  used_count integer,
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
  v_edition text := lower(btrim(coalesce(p_edition, '')));
  v_limit integer;
  v_used integer := 0;
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := ((date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC');
begin
  perform public.business_dna_assert_account_actor(p_account_id, p_actor_auth_user_id);

  select p.monthly_limit into v_limit
  from public.business_dna_analysis_plan_limits p
  where p.edition = v_edition;
  if not found then
    raise exception 'BUSINESS_DNA_INVALID_EDITION';
  end if;

  select u.used_count into v_used
  from public.business_dna_analysis_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = v_period_start;
  v_used := coalesce(v_used, 0);

  edition := v_edition;
  limit_count := v_limit;
  used_count := v_used;
  remaining_count := greatest(v_limit - v_used, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;
end;
$$;

revoke all on function public.get_business_dna_analysis_quota(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.get_business_dna_analysis_quota(uuid, uuid, text)
to service_role;

create or replace function public.consume_business_dna_analysis_quota(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_edition text
)
returns table (
  outcome text,
  edition text,
  limit_count integer,
  used_count integer,
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
  v_edition text := lower(btrim(coalesce(p_edition, '')));
  v_limit integer;
  v_used integer;
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := ((date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC');
begin
  perform public.business_dna_assert_account_actor(p_account_id, p_actor_auth_user_id);

  select p.monthly_limit into v_limit
  from public.business_dna_analysis_plan_limits p
  where p.edition = v_edition;
  if not found then
    raise exception 'BUSINESS_DNA_INVALID_EDITION';
  end if;

  insert into public.business_dna_analysis_monthly_usage (
    account_id,
    period_start,
    used_count
  ) values (
    p_account_id,
    v_period_start,
    0
  ) on conflict on constraint business_dna_analysis_monthly_usage_pkey do nothing;

  select u.used_count into v_used
  from public.business_dna_analysis_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = v_period_start
  for update;

  if v_used >= v_limit then
    outcome := 'quota_reached';
  else
    update public.business_dna_analysis_monthly_usage u
    set used_count = u.used_count + 1
    where u.account_id = p_account_id
      and u.period_start = v_period_start
    returning u.used_count into v_used;
    outcome := 'consumed';
  end if;

  edition := v_edition;
  limit_count := v_limit;
  used_count := v_used;
  remaining_count := greatest(v_limit - v_used, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;
end;
$$;

revoke all on function public.consume_business_dna_analysis_quota(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.consume_business_dna_analysis_quota(uuid, uuid, text)
to service_role;

-- Un échec technique avant production de la proposition ne consomme pas le
-- quota du professionnel. L'opération est bornée à une unité et sérialisée.
create or replace function public.refund_business_dna_analysis_quota(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_edition text
)
returns table (
  edition text,
  limit_count integer,
  used_count integer,
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
  v_edition text := lower(btrim(coalesce(p_edition, '')));
  v_limit integer;
  v_used integer := 0;
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := ((date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC');
begin
  perform public.business_dna_assert_account_actor(p_account_id, p_actor_auth_user_id);

  select p.monthly_limit into v_limit
  from public.business_dna_analysis_plan_limits p
  where p.edition = v_edition;
  if not found then
    raise exception 'BUSINESS_DNA_INVALID_EDITION';
  end if;

  update public.business_dna_analysis_monthly_usage u
  set used_count = greatest(u.used_count - 1, 0)
  where u.account_id = p_account_id
    and u.period_start = v_period_start
    and u.used_count > 0
  returning u.used_count into v_used;

  if not found then
    select coalesce(u.used_count, 0) into v_used
    from public.business_dna_analysis_monthly_usage u
    where u.account_id = p_account_id
      and u.period_start = v_period_start;
    v_used := coalesce(v_used, 0);
  end if;

  edition := v_edition;
  limit_count := v_limit;
  used_count := v_used;
  remaining_count := greatest(v_limit - v_used, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;
end;
$$;

revoke all on function public.refund_business_dna_analysis_quota(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.refund_business_dna_analysis_quota(uuid, uuid, text)
to service_role;

do $$
begin
  if exists (
    select 1
    from public.business_profiles
    where ai_web_length not in ('adapted', 'short', 'medium', 'long', 'deep')
       or ai_social_length not in ('adapted', 'short', 'medium', 'long', 'deep')
  ) then
    raise exception 'AI_MEMORY_POSTFLIGHT_FAILED: longueurs IA invalides.';
  end if;

  if not coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'business_ai_memories'
  ), false) then
    raise exception 'AI_MEMORY_POSTFLIGHT_FAILED: RLS inactive sur business_ai_memories.';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'business_ai_memories'
      and policyname = 'business_ai_memories_select_accessible'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'business_ai_memories'
      and policyname = 'business_ai_memories_insert_accessible'
  ) or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'business_ai_memories'
      and policyname = 'business_ai_memories_update_accessible'
  ) then
    raise exception 'AI_MEMORY_POSTFLIGHT_FAILED: politiques RLS incomplètes.';
  end if;

  if not exists (
    select 1
    from public.business_dna_analysis_plan_limits
    where edition = 'standard' and monthly_limit = 4
  ) or not exists (
    select 1
    from public.business_dna_analysis_plan_limits
    where edition = 'premium' and monthly_limit = 16
  ) or not exists (
    select 1
    from public.business_dna_analysis_plan_limits
    where edition = 'founder' and monthly_limit = 16
  ) then
    raise exception 'AI_MEMORY_POSTFLIGHT_FAILED: plafonds d''analyse ADN invalides.';
  end if;

  if not coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'business_dna_analysis_monthly_usage'
  ), false) then
    raise exception 'AI_MEMORY_POSTFLIGHT_FAILED: RLS inactive sur le quota d''analyse ADN.';
  end if;

  if to_regprocedure('public.get_business_dna_analysis_quota(uuid,uuid,text)') is null
     or to_regprocedure('public.consume_business_dna_analysis_quota(uuid,uuid,text)') is null
     or to_regprocedure('public.refund_business_dna_analysis_quota(uuid,uuid,text)') is null then
    raise exception 'AI_MEMORY_POSTFLIGHT_FAILED: fonctions de quota d''analyse ADN absentes.';
  end if;
end;
$$;

commit;
