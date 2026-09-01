-- iNrCy -- Postflight READ ONLY des aperçus IA temporaires.
--
-- À exécuter après :
--   1. 2026-08-31_ai_media_generation_quota.sql ;
--   2. 2026-08-31_ai_media_generation_studio_all_plans.sql ;
--   3. 2026-08-31_ai_media_generation_temporary_drafts.sql.
-- Résultat attendu : verdict=PASS, failed_checks=[] et checked_objects=8.

begin transaction read only;

with
target_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  where p.oid = to_regprocedure(
    'public.ai_media_complete_temporary_draft_quota()'
  )
),
target_roles as (
  select
    (select oid from pg_roles where rolname = 'anon') as anon_oid,
    (select oid from pg_roles where rolname = 'authenticated') as authenticated_oid
),
checks(check_name, passed) as (
  values
    (
      'index_expiration_present',
      exists (
        select 1
        from pg_index i
        join pg_class c on c.oid = i.indexrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'pro_media_library_ai_draft_expiration_idx'
          and i.indisvalid
          and i.indisready
          and pg_get_expr(i.indpred, i.indrelid)
            like '%ai_media_generation_draft%'
      )
    ),
    (
      'function_security_definer',
      coalesce((select prosecdef from target_function), false)
    ),
    (
      'function_fixed_search_path',
      coalesce(
        (select proconfig @> array['search_path=public, pg_temp'] from target_function),
        false
      )
    ),
    (
      'function_draft_only',
      coalesce(
        (select definition like '%ai_media_generation_draft%' from target_function),
        false
      )
    ),
    (
      'function_consumes_reserved_quota',
      coalesce(
        (
          select
            definition like '%used_count = u.used_count + 1%'
            and definition like '%reserved_count = u.reserved_count - 1%'
          from target_function
        ),
        false
      )
    ),
    (
      'trigger_present_enabled_and_bound',
      exists (
        select 1
        from pg_trigger t
        where t.tgrelid = to_regclass('public.pro_media_library')
          and t.tgname = 'ai_media_complete_temporary_draft_quota'
          and not t.tgisinternal
          and t.tgenabled <> 'D'
          and t.tgfoid = to_regprocedure(
            'public.ai_media_complete_temporary_draft_quota()'
          )
      )
    ),
    (
      'trigger_covers_insert_and_update',
      exists (
        select 1
        from pg_trigger t
        where t.tgrelid = to_regclass('public.pro_media_library')
          and t.tgname = 'ai_media_complete_temporary_draft_quota'
          and pg_get_triggerdef(t.oid) like '%AFTER INSERT OR UPDATE%'
      )
    ),
    (
      'function_not_client_executable',
      coalesce(
        (
          select
            not has_function_privilege(
              r.anon_oid,
              f.oid,
              'EXECUTE'
            )
            and not has_function_privilege(
              r.authenticated_oid,
              f.oid,
              'EXECUTE'
            )
            and not exists (
              select 1
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
              where acl.grantee = 0
                and acl.privilege_type = 'EXECUTE'
            )
          from target_function f
          join pg_proc p on p.oid = f.oid
          cross join target_roles r
        ),
        false
      )
    )
),
normalized as (
  select check_name, coalesce(passed, false) as passed
  from checks
)
select
  case when bool_and(passed) then 'PASS' else 'FAIL' end as verdict,
  count(*)::integer as checked_objects,
  count(*) filter (where not passed)::integer as failed_count,
  coalesce(
    array_agg(check_name order by check_name) filter (where not passed),
    array[]::text[]
  ) as failed_checks
from normalized;

commit;
