-- iNrCy -- fiabilisation du provisioning des nouveaux comptes
--
-- Cette migration est volontairement "future only" : elle ne parcourt et ne
-- modifie aucun compte existant. Elle garantit en revanche que toute nouvelle
-- identité AUTH et tout nouvel établissement reçoivent, dans la transaction de
-- création, leur compte métier, leur membership, leur configuration multicompte
-- et un onboarding v1 en attente sur l'étape Profil.

begin;

do $$
begin
  if to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.inrcy_account_members') is null
     or to_regclass('public.inrcy_multi_account_config') is null
     or to_regclass('public.inrcy_onboarding_states') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.app_bubble_access') is null
     or to_regprocedure('private.inrcy_create_establishment(text)') is null then
    raise exception 'Missing account/onboarding prerequisites.';
  end if;

  if current_setting('server_version_num')::integer < 140000 then
    raise exception 'PostgreSQL 14 or newer is required.';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to service_role;

-- Ne crée que la ligne manquante. Un état existant (in_progress, deferred ou
-- completed) n'est jamais réinitialisé.
create or replace function private.inrcy_ensure_account_onboarding(
  p_account_id uuid
)
returns public.inrcy_onboarding_states
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_state public.inrcy_onboarding_states%rowtype;
begin
  if p_account_id is null or not exists (
    select 1
    from public.inrcy_accounts a
    where a.id = p_account_id
  ) then
    raise exception 'INRCY_ACCOUNT_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.inrcy_onboarding_states (
    account_id,
    version,
    status,
    current_step
  )
  values (p_account_id, 1, 'pending', 'profile')
  on conflict (account_id) do nothing;

  select s.*
    into v_state
  from public.inrcy_onboarding_states s
  where s.account_id = p_account_id;

  if not found then
    raise exception 'INRCY_ONBOARDING_PROVISIONING_FAILED' using errcode = 'P0001';
  end if;

  return v_state;
end;
$$;

alter function private.inrcy_ensure_account_onboarding(uuid) owner to postgres;
revoke all on function private.inrcy_ensure_account_onboarding(uuid)
  from public, anon, authenticated;
grant execute on function private.inrcy_ensure_account_onboarding(uuid)
  to service_role;

-- Provisionneur canonique et idempotent. Le verrou sur la configuration
-- sérialise aussi le choix du membership par défaut.
create or replace function private.inrcy_ensure_account_provisioning(
  p_auth_user_id uuid,
  p_account_id uuid,
  p_display_name text,
  p_is_default boolean default false
)
returns public.inrcy_onboarding_states
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_email text;
  v_display_name text;
  v_existing_creator uuid;
  v_state public.inrcy_onboarding_states%rowtype;
begin
  if p_auth_user_id is null or p_account_id is null then
    raise exception 'INRCY_PROVISIONING_ID_MISSING' using errcode = 'P0001';
  end if;

  select u.email
    into v_auth_email
  from auth.users u
  where u.id = p_auth_user_id
  for key share;

  if not found then
    raise exception 'INRCY_AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_display_name := left(
    coalesce(
      nullif(btrim(p_display_name), ''),
      nullif(btrim(v_auth_email), ''),
      'Établissement principal'
    ),
    120
  );

  insert into public.inrcy_multi_account_config (
    auth_user_id,
    multi_account_enabled,
    max_establishments
  )
  values (p_auth_user_id, false, 1)
  on conflict (auth_user_id) do nothing;

  perform 1
  from public.inrcy_multi_account_config c
  where c.auth_user_id = p_auth_user_id
  for update;

  if not found then
    raise exception 'INRCY_MULTI_ACCOUNT_CONFIG_PROVISIONING_FAILED' using errcode = 'P0001';
  end if;

  insert into public.inrcy_accounts (
    id,
    display_name,
    created_by_auth_user_id
  )
  values (p_account_id, v_display_name, p_auth_user_id)
  on conflict (id) do nothing;

  update public.inrcy_accounts a
  set created_by_auth_user_id = p_auth_user_id
  where a.id = p_account_id
    and a.created_by_auth_user_id is null;

  select a.created_by_auth_user_id
    into v_existing_creator
  from public.inrcy_accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'INRCY_ACCOUNT_PROVISIONING_FAILED' using errcode = 'P0001';
  end if;

  if v_existing_creator is not null and v_existing_creator <> p_auth_user_id then
    raise exception 'INRCY_ACCOUNT_OWNER_CONFLICT' using errcode = 'P0001';
  end if;

  insert into public.inrcy_account_members (
    auth_user_id,
    account_id,
    role,
    is_default
  )
  select
    p_auth_user_id,
    p_account_id,
    'owner',
    coalesce(p_is_default, false) and not exists (
      select 1
      from public.inrcy_account_members existing_default
      where existing_default.auth_user_id = p_auth_user_id
        and existing_default.is_default
    )
  on conflict (auth_user_id, account_id) do nothing;

  if coalesce(p_is_default, false) then
    update public.inrcy_account_members m
    set
      role = 'owner',
      is_default = case
        when m.is_default then true
        when not exists (
          select 1
          from public.inrcy_account_members existing_default
          where existing_default.auth_user_id = p_auth_user_id
            and existing_default.is_default
        ) then true
        else false
      end,
      updated_at = now()
    where m.auth_user_id = p_auth_user_id
      and m.account_id = p_account_id;
  end if;

  if not exists (
    select 1
    from public.inrcy_account_members m
    where m.auth_user_id = p_auth_user_id
      and m.account_id = p_account_id
  ) then
    raise exception 'INRCY_ACCOUNT_MEMBERSHIP_PROVISIONING_FAILED' using errcode = 'P0001';
  end if;

  insert into public.profiles (user_id, updated_at)
  values (p_account_id, now())
  on conflict (user_id) do nothing;

  insert into public.app_bubble_access (user_id, bubble_key, enabled)
  values (p_account_id, 'inr_agent', true)
  on conflict (user_id, bubble_key) do update
    set enabled = true;

  v_state := private.inrcy_ensure_account_onboarding(p_account_id);
  return v_state;
end;
$$;

alter function private.inrcy_ensure_account_provisioning(uuid, uuid, text, boolean)
  owner to postgres;
revoke all on function private.inrcy_ensure_account_provisioning(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function private.inrcy_ensure_account_provisioning(uuid, uuid, text, boolean)
  to service_role;

-- RPC service-role : réparation/vérification explicite juste après une invitation.
create or replace function public.inrcy_ensure_auth_account_provisioned(
  p_auth_user_id uuid,
  p_display_name text default null
)
returns public.inrcy_onboarding_states
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.inrcy_ensure_account_provisioning(
    p_auth_user_id,
    p_auth_user_id,
    p_display_name,
    true
  );
$$;

revoke all on function public.inrcy_ensure_auth_account_provisioned(uuid, text)
  from public, anon, authenticated;
grant execute on function public.inrcy_ensure_auth_account_provisioned(uuid, text)
  to service_role;

-- RPC service-role : auto-réparation ciblée d'un onboarding absent.
create or replace function public.inrcy_ensure_account_onboarding_state(
  p_account_id uuid
)
returns public.inrcy_onboarding_states
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.inrcy_ensure_account_onboarding(p_account_id);
$$;

revoke all on function public.inrcy_ensure_account_onboarding_state(uuid)
  from public, anon, authenticated;
grant execute on function public.inrcy_ensure_account_onboarding_state(uuid)
  to service_role;

-- Tout auth.users INSERT est désormais atomique : si le socle métier ne peut
-- pas être créé, l'invitation elle-même n'est pas validée partiellement.
create or replace function public.inrcy_provision_auth_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_display_name text;
  v_unused public.inrcy_onboarding_states%rowtype;
begin
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'company_legal_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.email), ''),
    'Établissement principal'
  );

  v_unused := private.inrcy_ensure_account_provisioning(
    new.id,
    new.id,
    v_display_name,
    true
  );

  return new;
end;
$$;

alter function public.inrcy_provision_auth_account() owner to postgres;
revoke all on function public.inrcy_provision_auth_account()
  from public, anon, authenticated;

-- Sur Supabase hébergé, auth.users appartient à supabase_auth_admin : le rôle
-- postgres de l'éditeur SQL peut remplacer la fonction appelée, mais ne doit ni
-- recréer ni activer lui-même le trigger. Le trigger a été installé par la
-- migration multicompte initiale ; CREATE OR REPLACE FUNCTION conserve son OID,
-- donc le trigger existant appelle immédiatement la version fiabilisée ci-dessus.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'inrcy_provision_auth_account_after_insert'
      and t.tgfoid = 'public.inrcy_provision_auth_account()'::regprocedure
      and t.tgtype = 5
      and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'INRCY_AUTH_PROVISIONING_TRIGGER_MISSING';
  end if;
end;
$$;

-- Le trigger compte reste une seconde protection pour tout futur chemin qui
-- insérerait directement un établissement.
create or replace function public.inrcy_provision_onboarding_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_unused public.inrcy_onboarding_states%rowtype;
begin
  v_unused := private.inrcy_ensure_account_onboarding(new.id);
  return new;
end;
$$;

alter function public.inrcy_provision_onboarding_state() owner to postgres;
revoke all on function public.inrcy_provision_onboarding_state()
  from public, anon, authenticated;

create or replace trigger inrcy_provision_onboarding_state_after_insert
after insert on public.inrcy_accounts
for each row execute function public.inrcy_provision_onboarding_state();

alter table public.inrcy_accounts
  enable trigger inrcy_provision_onboarding_state_after_insert;

-- L'établissement secondaire utilise le même provisionneur dans la même
-- transaction que le contrôle de quota. Il ne dépend donc plus du seul trigger.
create or replace function private.inrcy_create_establishment(p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_enabled boolean;
  v_max integer;
  v_current_count integer;
  v_account_id uuid := gen_random_uuid();
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_unused public.inrcy_onboarding_states%rowtype;
begin
  if v_auth_user_id is null then
    raise exception 'INRCY_AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if length(v_display_name) < 2 or length(v_display_name) > 120 then
    raise exception 'INRCY_ESTABLISHMENT_NAME_INVALID' using errcode = 'P0001';
  end if;

  insert into public.inrcy_multi_account_config (
    auth_user_id,
    multi_account_enabled,
    max_establishments
  )
  values (v_auth_user_id, false, 1)
  on conflict (auth_user_id) do nothing;

  select c.multi_account_enabled, c.max_establishments
    into v_enabled, v_max
  from public.inrcy_multi_account_config c
  where c.auth_user_id = v_auth_user_id
  for update;

  if not coalesce(v_enabled, false) then
    raise exception 'INRCY_MULTICOMPTE_DISABLED' using errcode = 'P0001';
  end if;

  select count(*)::integer
    into v_current_count
  from public.inrcy_account_members m
  where m.auth_user_id = v_auth_user_id;

  if v_current_count >= greatest(coalesce(v_max, 1), 1) then
    raise exception 'INRCY_ESTABLISHMENT_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  v_unused := private.inrcy_ensure_account_provisioning(
    v_auth_user_id,
    v_account_id,
    v_display_name,
    false
  );

  return v_account_id;
end;
$$;

alter function private.inrcy_create_establishment(text) owner to postgres;
revoke all on function private.inrcy_create_establishment(text)
  from public, anon;
grant execute on function private.inrcy_create_establishment(text)
  to authenticated, service_role;

-- Garde-fous de migration : les deux couvertures universelles doivent être
-- présentes et actives avant le COMMIT.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and t.tgname = 'inrcy_provision_auth_account_after_insert'
      and t.tgfoid = 'public.inrcy_provision_auth_account()'::regprocedure
      and t.tgtype = 5
      and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'inrcy_accounts'
      and t.tgname = 'inrcy_provision_onboarding_state_after_insert'
      and t.tgfoid = 'public.inrcy_provision_onboarding_state()'::regprocedure
      and t.tgtype = 5
      and not t.tgisinternal
      and t.tgenabled in ('O', 'A')
  ) then
    raise exception 'Account/onboarding provisioning triggers are not active.';
  end if;
end;
$$;

commit;
