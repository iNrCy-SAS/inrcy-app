begin;
set local lock_timeout = '10s';

-- This server-only RPC patches one JSON section atomically. OAuth connection
-- fields, other channels and existing Threads settings remain independent.
create or replace function public.inrcy_set_threads_publication_preferences(
  p_account_id uuid,
  p_preferences jsonb,
  p_admin_pilot boolean default true
) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public
as $function$
declare
  v_preferences jsonb;
  v_saved jsonb;
begin
  if p_account_id is null or not exists (
    select 1 from public.inrcy_accounts where id=p_account_id
  ) then
    raise exception 'Invalid Threads account';
  end if;
  if p_admin_pilot is distinct from false and not exists (
    select 1 from public.profiles where user_id=p_account_id
      and (role='admin' or user_id='670b527d-5e08-42b4-ba95-e58e812339eb'::uuid)
  ) then
    raise exception 'Threads formats are restricted to ADMIN accounts during review';
  end if;
  if jsonb_typeof(p_preferences) is distinct from 'object'
    or (p_preferences->'version') is distinct from '1'::jsonb
    or jsonb_typeof(p_preferences->'ghostEnabled') is distinct from 'boolean'
    or coalesce(p_preferences->>'defaultMode','') not in ('classic','ghost') then
    raise exception 'Invalid Threads publication preferences';
  end if;
  if p_preferences->>'defaultMode'='ghost'
    and p_preferences->'ghostEnabled'='false'::jsonb then
    raise exception 'The default Threads format must be enabled';
  end if;
  v_preferences := jsonb_build_object(
    'version',1,
    'ghostEnabled',p_preferences->'ghostEnabled',
    'defaultMode',p_preferences->>'defaultMode'
  );
  insert into public.pro_tools_configs(user_id,settings,updated_at)
  values(p_account_id,jsonb_build_object('threads',jsonb_build_object('publicationPreferences',v_preferences)),now())
  on conflict(user_id) do update set
    settings=jsonb_set(public.pro_tools_configs.settings,'{threads}',
      coalesce(public.pro_tools_configs.settings->'threads','{}'::jsonb)
        ||jsonb_build_object('publicationPreferences',v_preferences),true),
    updated_at=now()
  where jsonb_typeof(public.pro_tools_configs.settings)='object'
    and (not (public.pro_tools_configs.settings?'threads')
      or jsonb_typeof(public.pro_tools_configs.settings->'threads')='object')
  returning settings#>'{threads,publicationPreferences}' into v_saved;
  if not found then
    raise exception 'Existing Threads settings need explicit reconciliation';
  end if;
  return v_saved;
end;
$function$;

revoke all on function public.inrcy_set_threads_publication_preferences(uuid,jsonb,boolean)
  from public,anon,authenticated;
grant execute on function public.inrcy_set_threads_publication_preferences(uuid,jsonb,boolean)
  to service_role;

commit;
