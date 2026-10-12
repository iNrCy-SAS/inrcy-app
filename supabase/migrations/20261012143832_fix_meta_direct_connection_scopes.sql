begin;
set local lock_timeout = '10s';

-- The live integrations column is scopes (plural). Keep the deployed legacy
-- payload's scope key compatible while accepting the canonical scopes key.
-- Guards, the service-only grant and the atomic connection/config update remain intact.
create or replace function public.save_meta_direct_connection(
  p_account_id uuid,p_channel text,p_integration jsonb,p_settings jsonb,p_admin_pilot boolean default true
) returns void language plpgsql security invoker set search_path=pg_catalog,public
as $function$
begin
  if p_channel not in ('instagram','threads') or p_channel is null
    or jsonb_typeof(p_integration) is distinct from 'object'
    or jsonb_typeof(p_settings) is distinct from 'object'
    or (p_integration->>'user_id') is distinct from p_account_id::text
    or (p_integration->>'provider') is distinct from p_channel
    or (p_integration->>'source') is distinct from p_channel
    or (p_integration->>'product') is distinct from p_channel
    or (p_integration->>'status') is distinct from 'connected'
    or nullif(p_integration->>'access_token_enc','') is null
    or nullif(p_integration->>'resource_id','') is null
    or (p_channel='instagram' and (p_integration#>>'{meta,auth_mode}') is distinct from 'instagram_login')
    or (p_channel='threads' and (p_integration#>>'{meta,auth_mode}') is distinct from 'threads_login') then
    raise exception 'Invalid Meta connection';
  end if;
  if p_admin_pilot is distinct from false and not exists(select 1 from public.profiles where user_id=p_account_id
    and (role='admin' or user_id='670b527d-5e08-42b4-ba95-e58e812339eb'::uuid)) then
    raise exception 'Meta channels are restricted to ADMIN accounts during review';
  end if;
  if exists(select 1 from public.pro_tools_configs where user_id=p_account_id
    and (jsonb_typeof(settings) is distinct from 'object'
      or (settings?p_channel and jsonb_typeof(settings->p_channel) is distinct from 'object'))) then
    raise exception 'Existing channel settings need explicit reconciliation';
  end if;
  insert into public.integrations(user_id,provider,category,source,product,status,resource_id,resource_label,
    display_name,access_token_enc,refresh_token_enc,expires_at,scopes,meta,updated_at)
  values(p_account_id,p_channel,'social',p_channel,p_channel,'connected',p_integration->>'resource_id',
    p_integration->>'resource_label',p_integration->>'display_name',p_integration->>'access_token_enc',null,
    (p_integration->>'expires_at')::timestamptz,coalesce(p_integration->>'scopes',p_integration->>'scope'),p_integration->'meta',now())
  on conflict(user_id,provider,source,product) do update set
    status=excluded.status,resource_id=excluded.resource_id,resource_label=excluded.resource_label,
    display_name=excluded.display_name,access_token_enc=excluded.access_token_enc,refresh_token_enc=null,
    expires_at=excluded.expires_at,scopes=excluded.scopes,meta=excluded.meta,updated_at=now();
  insert into public.pro_tools_configs(user_id,settings,updated_at)
  values(p_account_id,jsonb_build_object(p_channel,p_settings),now())
  on conflict(user_id) do update set
    settings=jsonb_set(public.pro_tools_configs.settings,array[p_channel],
      coalesce(public.pro_tools_configs.settings->p_channel,'{}'::jsonb)||p_settings,true),updated_at=now();
  update public.profiles set stats_version=coalesce(stats_version,0)+1,
    stats_cache_epoch=coalesce(stats_cache_epoch,0)+1 where user_id=p_account_id;
end;
$function$;
revoke all on function public.save_meta_direct_connection(uuid,text,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.save_meta_direct_connection(uuid,text,jsonb,jsonb,boolean) to service_role;

commit;
