-- Read-only postflight for 2026-09-05_ai_media_generator_preferences_atomic.sql.

select
  routine_schema,
  routine_name,
  security_type,
  data_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'inrcy_patch_ai_media_generator_preferences';

select
  has_function_privilege(
    'authenticated',
    'public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)',
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)',
    'EXECUTE'
  ) as anon_can_execute,
  has_function_privilege(
    'service_role',
    'public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)',
    'EXECUTE'
  ) as service_role_can_execute;

select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'pro_tools_configs';

select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'pro_tools_configs'
  and cmd in ('SELECT', 'INSERT', 'UPDATE')
order by cmd, policyname;
