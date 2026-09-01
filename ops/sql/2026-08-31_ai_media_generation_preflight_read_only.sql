-- iNrCy -- Preflight strict et integralement READ ONLY avant le ledger media IA.
--
-- Resultat attendu avant la toute premiere migration : verdict = READY.
-- NO-GO signifie qu'un prerequis manque ou qu'un objet cible existe deja.
-- Ce script ne cree, ne modifie et ne supprime aucun objet ni aucune donnee.

begin transaction read only;

with
required_columns(schema_name, table_name, column_name, udt_name) as (
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
),
object_checks(check_name, ok, detail) as (
  select
    'table public.inrcy_accounts',
    to_regclass('public.inrcy_accounts') is not null,
    'Socle des etablissements actif'
  union all
  select
    'table public.inrcy_account_members',
    to_regclass('public.inrcy_account_members') is not null,
    'Liaison AUTH vers etablissement actif'
  union all
  select
    'table public.pro_media_library',
    to_regclass('public.pro_media_library') is not null,
    'Registre media universel actif'
  union all
  select
    'table auth.users',
    to_regclass('auth.users') is not null,
    'Schema Supabase Auth accessible'
  union all
  select
    'function public.inrcy_can_access_account(uuid)',
    to_regprocedure('public.inrcy_can_access_account(uuid)') is not null,
    'Controle RLS multicompte disponible'
  union all
  select
    'function public.inrcy_touch_updated_at()',
    to_regprocedure('public.inrcy_touch_updated_at()') is not null,
    'Trigger updated_at multicompte disponible'
  union all
  select
    'function gen_random_uuid() ou extension pgcrypto',
    to_regprocedure('gen_random_uuid()') is not null
      or exists (select 1 from pg_extension e where e.extname = 'pgcrypto'),
    'Generation UUID disponible'
),
column_checks(check_name, ok, detail) as (
  select
    format('column %I.%I.%I', r.schema_name, r.table_name, r.column_name),
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = r.schema_name
        and c.table_name = r.table_name
        and c.column_name = r.column_name
        and c.udt_name = r.udt_name
    ),
    format('Type attendu: %s', r.udt_name)
  from required_columns r
),
role_checks(check_name, ok, detail) as (
  select
    format('role %I', r.role_name),
    exists (select 1 from pg_roles p where p.rolname = r.role_name),
    'Role Supabase requis par les GRANT/REVOKE'
  from (values ('anon'), ('authenticated'), ('service_role')) as r(role_name)
),
all_checks as (
  select * from object_checks
  union all
  select * from column_checks
  union all
  select * from role_checks
),
collisions(object_type, object_identity) as (
  select
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'partitioned_table'
      when 'i' then 'index'
      when 'S' then 'sequence'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      else 'relation_' || c.relkind::text
    end,
    format('%I.%I', n.nspname, c.relname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and left(c.relname, 9) = 'ai_media_'

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
    format('%I.%I trigger %I', n.nspname, c.relname, t.tgname)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and not t.tgisinternal
    and left(t.tgname, 9) = 'ai_media_'

  union all

  select
    'policy',
    format('%I.%I policy %I', n.nspname, c.relname, p.polname)
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and left(p.polname, 9) = 'ai_media_'

  union all

  select
    'constraint',
    format('%I.%I constraint %I', n.nspname, c.relname, k.conname)
  from pg_constraint k
  join pg_class c on c.oid = k.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and left(k.conname, 9) = 'ai_media_'
),
failed_checks as (
  select check_name, detail
  from all_checks
  where not ok
)
select
  case
    when not exists (select 1 from failed_checks)
     and not exists (select 1 from collisions)
      then 'READY'
    else 'NO-GO'
  end as verdict,
  case
    when not exists (select 1 from failed_checks)
     and not exists (select 1 from collisions)
      then 'Prerequis valides et aucun objet cible existant. La migration peut etre revue puis executee.'
    else 'Ne pas executer la migration. Corriger les prerequis ou auditer les collisions avant toute ecriture.'
  end as instruction,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('check', f.check_name, 'detail', f.detail)
        order by f.check_name
      )
      from failed_checks f
    ),
    '[]'::jsonb
  ) as failed_prerequisites,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object('type', c.object_type, 'identity', c.object_identity)
        order by c.object_type, c.object_identity
      )
      from collisions c
    ),
    '[]'::jsonb
  ) as collisions;

commit;
