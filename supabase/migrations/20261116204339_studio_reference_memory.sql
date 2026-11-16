begin;
set local lock_timeout = '10s';

-- One private remembered set per business account. All other settings namespaces
-- and all permanent library files remain independent. No consent is persisted.
create or replace function public.inrcy_set_studio_references(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_memory jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_settings jsonb;
  v_previous jsonb;
  v_ref jsonb;
  v_voice jsonb;
  v_id uuid;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
begin
  if p_account_id is null or p_actor_auth_user_id is null or not exists (
    select 1 from public.inrcy_account_members m
    where m.account_id=p_account_id and m.auth_user_id=p_actor_auth_user_id
  ) then
    raise exception using errcode='42501', message='STUDIO_REFERENCES_ACCOUNT_FORBIDDEN';
  end if;

  if p_memory is not null then
    if jsonb_typeof(p_memory) is distinct from 'object'
      or octet_length(p_memory::text)>12000
      or exists(select 1 from jsonb_object_keys(p_memory) k where k not in ('version','references','voices','activeNarrationVoiceId'))
      or jsonb_typeof(p_memory->'references') is distinct from 'array'
      or jsonb_typeof(p_memory->'voices') is distinct from 'array'
      or not (p_memory ? 'activeNarrationVoiceId') then
      raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
    end if;
    if (p_memory->'version') is distinct from '1'::jsonb then
      raise exception using errcode='22023', message='STUDIO_REFERENCES_VERSION_UNSUPPORTED';
    end if;
    if jsonb_array_length(p_memory->'references')>5 or jsonb_array_length(p_memory->'voices')>3 then
      raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
    end if;
    for v_ref in select value from jsonb_array_elements(p_memory->'references') loop
      if jsonb_typeof(v_ref) is distinct from 'object' then
        raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
      end if;
      if exists(select 1 from jsonb_object_keys(v_ref) k where k not in ('id','mediaLibraryId','role','usage','characterName','voiceMode'))
        or coalesce(v_ref->>'id','') !~ v_uuid or coalesce(v_ref->>'mediaLibraryId','') !~ v_uuid
        or coalesce(v_ref->>'role','') not in ('character','environment','product','inspiration')
        or coalesce(v_ref->>'usage','') not in ('required','inspiration')
        or coalesce(v_ref->>'voiceMode','') not in ('ai','provided')
        or (v_ref ? 'characterName' and (jsonb_typeof(v_ref->'characterName') is distinct from 'string'
          or length(v_ref->>'characterName') not between 1 and 40 or (v_ref->>'characterName') ~ '[[:cntrl:]]'))
        or (v_ref->>'role'<>'character' and (v_ref ? 'characterName' or v_ref->>'voiceMode'<>'ai')) then
        raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
      end if;
      v_id := (v_ref->>'mediaLibraryId')::uuid;
      if not exists(select 1 from public.pro_media_library m
        where m.id=v_id and m.user_id=p_account_id and m.media_type='image' and m.is_active is true
          and m.bucket_name='inrcy-pro-media' and m.source is distinct from 'ai_media_generation_draft'
          and m.storage_path like 'users/'||p_account_id::text||'/%'
          and m.storage_path !~ '[\\%?#[:cntrl:]]' and m.storage_path !~ '(^|/)\.{1,2}(/|$)' and m.storage_path !~ '//') then
        raise exception using errcode='22023', message='STUDIO_REFERENCES_MEDIA_UNAVAILABLE';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_memory->'references') r where r->>'role'='character')>3
      or (select count(*)-count(distinct r->>'id') from jsonb_array_elements(p_memory->'references') r)>0
      or exists(select 1 from jsonb_array_elements(p_memory->'references') r where r ? 'characterName'
        group by lower(r->>'characterName') having count(*)>1) then
      raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
    end if;
    for v_voice in select value from jsonb_array_elements(p_memory->'voices') loop
      if jsonb_typeof(v_voice) is distinct from 'object' then
        raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
      end if;
      if exists(select 1 from jsonb_object_keys(v_voice) k where k not in ('id','libraryMediaId','target','gender'))
        or coalesce(v_voice->>'id','') !~ v_uuid or coalesce(v_voice->>'libraryMediaId','') !~ v_uuid
        or coalesce(v_voice->>'gender','') not in ('auto','female','male') or not (v_voice ? 'target') then
        raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
      end if;
      if v_voice->'target' is distinct from 'null'::jsonb and v_voice->'target' is distinct from '"narration"'::jsonb then
        if jsonb_typeof(v_voice->'target') is distinct from 'object' then
          raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
        end if;
        if exists(select 1 from jsonb_object_keys(v_voice->'target') k where k<>'referenceId')
          or coalesce(v_voice#>>'{target,referenceId}','') !~ v_uuid
          or not exists(select 1 from jsonb_array_elements(p_memory->'references') r
            where r->>'id'=v_voice#>>'{target,referenceId}' and r->>'role'='character' and r->>'voiceMode'='provided') then
          raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
        end if;
      end if;
      v_id := (v_voice->>'libraryMediaId')::uuid;
      if not exists(select 1 from public.pro_media_library m
        where m.id=v_id and m.user_id=p_account_id and m.media_type='audio' and m.is_active is true
          and m.mime_type in ('audio/wav','audio/mpeg') and m.bucket_name='inrcy-pro-media'
          and m.storage_path like 'users/'||p_account_id::text||'/audio/%'
          and m.storage_path !~ '[\\%?#[:cntrl:]]' and m.storage_path !~ '(^|/)\.{1,2}(/|$)' and m.storage_path !~ '//') then
        raise exception using errcode='22023', message='STUDIO_REFERENCES_MEDIA_UNAVAILABLE';
      end if;
    end loop;
    if (select count(*)-count(distinct v->>'id') from jsonb_array_elements(p_memory->'voices') v)>0
      or exists(select 1 from jsonb_array_elements(p_memory->'voices') v where jsonb_typeof(v->'target')='object'
        group by v#>>'{target,referenceId}' having count(*)>1)
      or exists(select 1 from jsonb_array_elements(p_memory->'references') r where r->>'voiceMode'='provided'
        and not exists(select 1 from jsonb_array_elements(p_memory->'voices') v where v#>>'{target,referenceId}'=r->>'id'))
      or ((p_memory->'activeNarrationVoiceId') is distinct from 'null'::jsonb and
        (coalesce(p_memory->>'activeNarrationVoiceId','') !~ v_uuid or not exists(
          select 1 from jsonb_array_elements(p_memory->'voices') v
          where v->>'id'=p_memory->>'activeNarrationVoiceId' and v->'target'='"narration"'::jsonb))) then
      raise exception using errcode='22023', message='STUDIO_REFERENCES_INVALID';
    end if;
  end if;

  insert into public.pro_tools_configs(user_id,settings,updated_at)
  values(p_account_id,'{}'::jsonb,now()) on conflict(user_id) do nothing;
  select settings into v_settings from public.pro_tools_configs where user_id=p_account_id for update;
  if jsonb_typeof(v_settings) is distinct from 'object' then
    raise exception using errcode='22023', message='STUDIO_REFERENCES_SETTINGS_INVALID';
  end if;
  v_previous := v_settings->'studio_references';
  if v_previous is not null and (jsonb_typeof(v_previous) is distinct from 'object' or not (v_previous ? 'version')) then
    raise exception using errcode='22023', message='STUDIO_REFERENCES_SETTINGS_INVALID';
  end if;
  if v_previous is not null and (v_previous->'version') is distinct from '1'::jsonb then
    raise exception using errcode='22023', message='STUDIO_REFERENCES_VERSION_UNSUPPORTED';
  end if;
  if v_previous is not null and (jsonb_typeof(v_previous->'references') is distinct from 'array'
    or jsonb_typeof(v_previous->'voices') is distinct from 'array' or not (v_previous ? 'activeNarrationVoiceId')
    or exists(select 1 from jsonb_object_keys(v_previous) k where k not in ('version','references','voices','activeNarrationVoiceId'))) then
    raise exception using errcode='22023', message='STUDIO_REFERENCES_SETTINGS_INVALID';
  end if;
  update public.pro_tools_configs set settings=case when p_memory is null then v_settings-'studio_references'
      else jsonb_set(v_settings,'{studio_references}',p_memory,true) end, updated_at=now()
    where user_id=p_account_id;
  return p_memory;
end;
$function$;

revoke all on function public.inrcy_set_studio_references(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.inrcy_set_studio_references(uuid,uuid,jsonb) to service_role;

commit;
