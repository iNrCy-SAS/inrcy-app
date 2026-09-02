begin transaction read only;

do $$
declare
  v_get_definition text;
  v_reserve_definition text;
begin
  if to_regclass('public.ai_media_account_limits') is null then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: table absente.';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'ai_media_account_limits'
      and c.relrowsecurity
  ) then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: RLS inactive.';
  end if;

  if not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'standard' and image_monthly_limit = 20 and video_monthly_limit = 5 and studio_enabled
  ) or not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'premium' and image_monthly_limit = 30 and video_monthly_limit = 6 and studio_enabled
  ) or not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'founder' and image_monthly_limit = 30 and video_monthly_limit = 6 and studio_enabled
  ) then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: plafonds de forfait incorrects.';
  end if;

  select pg_get_functiondef('public.get_ai_media_generation_quota(uuid,uuid,text)'::regprocedure)
    into v_get_definition;
  select pg_get_functiondef('public.reserve_ai_media_generation(uuid,uuid,text,text,text,text,text,integer,integer,jsonb)'::regprocedure)
    into v_reserve_definition;

  if position('ai_media_account_limits' in v_get_definition) = 0
     or position('image_monthly_limit_override' in v_get_definition) = 0
     or position('video_monthly_limit_override' in v_get_definition) = 0 then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: lecture quota non branchee aux overrides.';
  end if;

  if position('ai_media_account_limits' in v_reserve_definition) = 0
     or position('image_monthly_limit_override' in v_reserve_definition) = 0
     or position('video_monthly_limit_override' in v_reserve_definition) = 0
     or position('p_limit_override' in v_reserve_definition) = 0 then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: reservation non branchee aux overrides.';
  end if;

  if has_table_privilege('authenticated', 'public.ai_media_account_limits', 'SELECT')
     or has_table_privilege('anon', 'public.ai_media_account_limits', 'SELECT') then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: acces client direct detecte.';
  end if;

  if not has_table_privilege('service_role', 'public.ai_media_account_limits', 'SELECT')
     or not has_table_privilege('service_role', 'public.ai_media_account_limits', 'INSERT')
     or not has_table_privilege('service_role', 'public.ai_media_account_limits', 'UPDATE')
     or not has_table_privilege('service_role', 'public.ai_media_account_limits', 'DELETE') then
    raise exception 'AI_MEDIA_ACCOUNT_LIMITS_POSTFLIGHT_FAILED: droits service_role incomplets.';
  end if;
end;
$$;

rollback;
