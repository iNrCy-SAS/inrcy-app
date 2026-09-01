-- iNrCy -- retrait définitif du parcours automatique Étape 1 / 2 / 3
--
-- Cette migration conserve le provisioning des comptes, profils et accès aux
-- bulles. Elle retire uniquement l'ancien état d'onboarding, après avoir
-- recâblé tous les chemins de création qui en dépendaient.
--
-- IMPORTANT : la table supprimée contient des données historiques. Exécuter
-- cette migration seulement après déploiement du runtime sans onboarding.

begin;

do $$
begin
  if to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.inrcy_account_members') is null
     or to_regclass('public.inrcy_multi_account_config') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.app_bubble_access') is null
     or to_regprocedure('public.inrcy_provision_auth_account()') is null
     or to_regprocedure('private.inrcy_create_establishment(text)') is null then
    raise exception 'Missing account provisioning prerequisites.';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to service_role;

-- Provisionneur canonique sans état de parcours. Il reste idempotent et garde
-- les garanties historiques de verrouillage, de quota et d'isolation compte.
create or replace function private.inrcy_ensure_account_core(
  p_auth_user_id uuid,
  p_account_id uuid,
  p_display_name text,
  p_is_default boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
declare
  v_auth_email text;
  v_display_name text;
  v_existing_creator uuid;
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
end;
$$;

alter function private.inrcy_ensure_account_core(uuid, uuid, text, boolean)
  owner to postgres;
revoke all on function private.inrcy_ensure_account_core(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function private.inrcy_ensure_account_core(uuid, uuid, text, boolean)
  to service_role;

-- Le trigger auth.users garde exactement la même fonction cible et donc le
-- même OID. Supabase n'a pas besoin de recréer le trigger auth protégé.
create or replace function public.inrcy_provision_auth_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'company_legal_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.email), ''),
    'Établissement principal'
  );

  perform private.inrcy_ensure_account_core(
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

-- Le multi-compte conserve le même contrat public (UUID du nouvel
-- établissement), mais ne crée plus aucune ligne de parcours.
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

  perform private.inrcy_ensure_account_core(
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

-- Le runtime ignore la valeur de retour de cette RPC. Un UUID stable remplace
-- l'ancien type composite, qui empêchait la suppression de la table.
drop function if exists public.inrcy_ensure_auth_account_provisioned(uuid, text);
create function public.inrcy_ensure_auth_account_provisioned(
  p_auth_user_id uuid,
  p_display_name text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
begin
  perform private.inrcy_ensure_account_core(
    p_auth_user_id,
    p_auth_user_id,
    p_display_name,
    true
  );
  return p_auth_user_id;
end;
$$;

alter function public.inrcy_ensure_auth_account_provisioned(uuid, text)
  owner to postgres;
revoke all on function public.inrcy_ensure_auth_account_provisioned(uuid, text)
  from public, anon, authenticated;
grant execute on function public.inrcy_ensure_auth_account_provisioned(uuid, text)
  to service_role;

-- Retrait explicite, sans CASCADE : toute dépendance oubliée fait échouer et
-- annule la transaction au lieu de supprimer accidentellement un autre objet.
drop trigger if exists inrcy_provision_onboarding_state_after_insert
  on public.inrcy_accounts;
drop function if exists public.inrcy_provision_onboarding_state();
drop function if exists public.inrcy_ensure_account_onboarding_state(uuid);
drop function if exists public.inrcy_save_onboarding_state(uuid, text, text, smallint);
drop function if exists private.inrcy_ensure_account_provisioning(uuid, uuid, text, boolean);
drop function if exists private.inrcy_ensure_account_onboarding(uuid);
drop function if exists private.inrcy_save_onboarding_state(uuid, text, text, smallint);
drop table if exists public.inrcy_onboarding_states;

-- Garde-fous finaux : provisioning intact, ancien système entièrement absent.
do $$
begin
  if to_regprocedure('private.inrcy_ensure_account_core(uuid,uuid,text,boolean)') is null
     or to_regprocedure('private.inrcy_create_establishment(text)') is null
     or to_regprocedure('public.inrcy_ensure_auth_account_provisioned(uuid,text)') is null then
    raise exception 'INRCY_ACCOUNT_PROVISIONING_REWIRE_FAILED';
  end if;

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

  if to_regclass('public.inrcy_onboarding_states') is not null
     or to_regprocedure('public.inrcy_provision_onboarding_state()') is not null
     or to_regprocedure('public.inrcy_ensure_account_onboarding_state(uuid)') is not null
     or to_regprocedure('public.inrcy_save_onboarding_state(uuid,text,text,smallint)') is not null
     or to_regprocedure('private.inrcy_ensure_account_onboarding(uuid)') is not null
     or to_regprocedure('private.inrcy_save_onboarding_state(uuid,text,text,smallint)') is not null then
    raise exception 'INRCY_ONBOARDING_OBJECTS_STILL_PRESENT';
  end if;
end;
$$;

commit;
