begin transaction read only;

select
  target.function_oid is not null as function_exists,
  p.oid::regprocedure as function_signature,
  pg_get_userbyid(p.proowner) as function_owner,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  coalesce(p.proconfig @> array['search_path=""'], false)
    as function_empty_search_path
from (
  values (
    to_regprocedure(
      'public.inrcy_set_facebook_publication_preferences(uuid,jsonb)'
    )
  )
) as target(function_oid)
left join pg_proc as p on p.oid = target.function_oid;

select
  coalesce(
    has_function_privilege('authenticated', target.function_oid, 'EXECUTE'),
    false
  ) as authenticated_can_execute,
  coalesce(
    has_function_privilege('anon', target.function_oid, 'EXECUTE'),
    false
  ) as anon_can_execute,
  coalesce(
    has_function_privilege('service_role', target.function_oid, 'EXECUTE'),
    false
  ) as service_role_can_execute
from (
  values (
    to_regprocedure(
      'public.inrcy_set_facebook_publication_preferences(uuid,jsonb)'
    )
  )
) as target(function_oid);

select
  has_table_privilege('authenticated', 'public.pro_tools_configs', 'SELECT')
    as authenticated_can_select,
  has_table_privilege('authenticated', 'public.pro_tools_configs', 'INSERT')
    as authenticated_can_insert,
  has_table_privilege('authenticated', 'public.pro_tools_configs', 'UPDATE')
    as authenticated_can_update;

select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'pro_tools_configs';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'pro_tools_configs'
  and cmd in ('SELECT', 'INSERT', 'UPDATE', 'ALL')
order by cmd, policyname;

select
  coalesce(bool_or(
    cmd in ('UPDATE', 'ALL')
    and ('authenticated' = any(roles) or 'public' = any(roles))
    and coalesce(qual, '') ~* 'inrcy_can_access_account'
    and coalesce(with_check, '') ~* 'inrcy_can_access_account'
  ), false) as authenticated_update_is_account_scoped
from pg_policies
where schemaname = 'public'
  and tablename = 'pro_tools_configs';

commit;
