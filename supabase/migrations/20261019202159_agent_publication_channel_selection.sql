-- A channel choice never deletes the prepared content. The source action and
-- its scheduled rows share one transaction with the dispatcher's row locks.
create or replace function public.inrcy_set_agent_publication_channels(
  p_user_id uuid,
  p_action_id uuid,
  p_channels text[],
  p_expected_updated_at timestamptz,
  p_scheduled_action_id uuid default null,
  p_prepared_channel jsonb default null,
  p_tiktok_settings jsonb default null
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_action public.inr_agent_actions%rowtype;
  v_row public.inr_agent_scheduled_actions%rowtype;
  v_template public.inr_agent_scheduled_actions%rowtype;
  v_source_id uuid := p_action_id;
  v_payload jsonb;
  v_selection jsonb;
  v_available text[];
  v_selected text[];
  v_excluded text[];
  v_covered text[] := array[]::text[];
  v_ids uuid[] := array[]::uuid[];
  v_channel text;
  v_map text;
  v_publish jsonb;
  v_retained jsonb;
  v_new_id uuid;
  v_expected timestamptz;
begin
  if p_user_id is null or p_channels is null or cardinality(p_channels) > 20
    or (p_action_id is null and p_scheduled_action_id is null) then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;

  -- Read the link, then always lock source before children to avoid deadlocks.
  if p_scheduled_action_id is not null then
    select * into v_row from public.inr_agent_scheduled_actions
      where id = p_scheduled_action_id and user_id = p_user_id;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if coalesce(v_row.payload->>'sourceActionId', v_row.payload#>>'{publishPayload,inrAgentActionId}', '')
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_source_id := coalesce(v_row.payload->>'sourceActionId', v_row.payload#>>'{publishPayload,inrAgentActionId}')::uuid;
    end if;
  end if;

  if v_source_id is not null then
    select * into v_action from public.inr_agent_actions
      where id = v_source_id and user_id = p_user_id for update;
    if not found then return jsonb_build_object('outcome', 'not_found'); end if;
    if v_action.automation_key is distinct from 'publish' or v_action.action_type is distinct from 'publication'
      or v_action.target_tool is distinct from 'booster' then
      return jsonb_build_object('outcome', 'invalid_action');
    end if;
    if v_action.status not in ('prepared','pending_validation','pending','draft','validated','scheduled')
      or v_action.completed_at is not null then
      return jsonb_build_object('outcome', 'publication_started');
    end if;
    v_payload := coalesce(v_action.payload, '{}'::jsonb);
    v_expected := v_action.updated_at;
  end if;

  for v_row in select * from public.inr_agent_scheduled_actions s
    where s.user_id = p_user_id and (
      (v_source_id is not null and (s.payload->>'sourceActionId' = v_source_id::text
        or s.payload#>>'{publishPayload,inrAgentActionId}' = v_source_id::text)
        and (s.status <> 'cancelled' or s.payload->'publicationChannelSelectionPaused' = 'true'::jsonb
          or coalesce(v_action.payload#>'{scheduledExecution,scheduledActionIds}','[]'::jsonb) ? s.id::text))
      or (v_source_id is null and s.id = p_scheduled_action_id)
    ) order by s.id for update
  loop
    if v_row.action_type <> 'publication' or v_row.target_tool <> 'booster' then
      return jsonb_build_object('outcome', 'invalid_action');
    end if;
    if v_row.status in ('running','done','failed') or v_row.attempt_count > 0 or v_row.executed_at is not null then
      return jsonb_build_object('outcome', 'publication_started');
    end if;
    if v_row.status = 'cancelled' and coalesce(v_row.payload->'publicationChannelSelectionPaused','false'::jsonb) <> 'true'::jsonb then
      return jsonb_build_object('outcome', 'schedule_cancelled');
    end if;
    if v_row.scheduled_at <= v_now then
      return jsonb_build_object('outcome', 'schedule_due');
    end if;
    if v_template.id is null or v_row.scheduled_at < v_template.scheduled_at then v_template := v_row; end if;
    v_ids := array_append(v_ids, v_row.id);
    v_covered := v_covered || case when jsonb_typeof(v_row.payload->'publicationChannelSelectionRowChannels') = 'array'
      then array(select jsonb_array_elements_text(v_row.payload->'publicationChannelSelectionRowChannels')) else v_row.channels end;
    if v_row.id = p_scheduled_action_id then v_expected := v_row.updated_at; end if;
    if v_source_id is null then v_payload := v_row.payload; end if;
  end loop;
  if v_payload is null then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_action.status = 'scheduled' and cardinality(v_ids) = 0 then
    return jsonb_build_object('outcome', 'schedule_missing');
  end if;
  if p_expected_updated_at is null or v_expected is distinct from p_expected_updated_at then
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Only channels already prepared for this publication may be re-enabled.
  select coalesce(array_agg(distinct canonical order by canonical), array[]::text[]) into v_available
  from (
    select case raw when 'siteWeb' then 'site_web' when 'inrSearch' then 'inr_search'
      when 'youtube' then 'youtube_shorts' else raw end as canonical
    from (
      select unnest(coalesce(v_action.target_channels, array[]::text[]) || v_covered) as raw
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(v_payload#>'{publicationChannelSelection,availableChannels}') = 'array'
        then v_payload#>'{publicationChannelSelection,availableChannels}' else '[]'::jsonb end)
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(v_payload->'selectedChannels') = 'array'
        then v_payload->'selectedChannels' else '[]'::jsonb end)
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(v_payload->'channels') = 'array'
        then v_payload->'channels' else '[]'::jsonb end)
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(v_payload->'boosterChannels') = 'array'
        then v_payload->'boosterChannels' else '[]'::jsonb end)
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(v_payload#>'{publishPayload,channels}') = 'array'
        then v_payload#>'{publishPayload,channels}' else '[]'::jsonb end)
    ) values_in
  ) normalized
  where canonical in ('site_web','inr_search','gmb','facebook','instagram','threads','linkedin','x','tiktok','youtube_shorts','pinterest');
  if p_prepared_channel is not null then
    v_channel := p_prepared_channel->>'channel';
    if v_source_id is null or v_channel is null or v_channel = any(v_available)
      or v_channel not in ('site_web','inr_search','gmb','facebook','instagram','threads','linkedin','x','tiktok','youtube_shorts','pinterest')
      or jsonb_typeof(p_prepared_channel->'post') is distinct from 'object'
      or length(trim(coalesce(p_prepared_channel#>>'{post,content}',p_prepared_channel#>>'{post,text}',''))) = 0 then
      return jsonb_build_object('outcome','invalid_preparation');
    end if;
    v_available := array_append(v_available,v_channel);
    v_action.target_channels := array_append(v_action.target_channels,v_channel);
    v_payload := jsonb_set(v_payload,'{postByChannel}',coalesce(v_payload->'postByChannel','{}'::jsonb)
      || jsonb_build_object(v_channel,p_prepared_channel->'post'),true);
    foreach v_map in array array['imagesByChannel','videoByChannel','mediaModeByChannel','imageSettingsByChannel','videoSettingsByChannel'] loop
      if p_prepared_channel ? v_map then
        v_payload := jsonb_set(v_payload,array[v_map],coalesce(v_payload->v_map,'{}'::jsonb)
          || jsonb_build_object(v_channel,p_prepared_channel->v_map),true);
      end if;
    end loop;
    v_payload := v_payload || jsonb_build_object('selectedChannels',to_jsonb(v_available),'channels',to_jsonb(v_available),'boosterChannels',to_jsonb(v_available));
    if v_channel='tiktok' and p_prepared_channel ? 'tiktokPhotoFullScreen' then
      v_payload := jsonb_set(v_payload,'{tiktokPhotoFullScreen}',p_prepared_channel->'tiktokPhotoFullScreen',true);
    end if;
  end if;
  if p_tiktok_settings is not null then
    if not 'tiktok' = any(p_channels) or p_tiktok_settings->'musicUsageConfirmed' is distinct from 'true'::jsonb then
      return jsonb_build_object('outcome','tiktok_settings_required');
    end if;
    v_payload := jsonb_set(v_payload,'{tiktokPublicationSettings}',p_tiktok_settings,true);
  end if;
  if cardinality(v_available) = 0 or exists(select 1 from unnest(p_channels) c where c is null or not c = any(v_available)) then
    return jsonb_build_object('outcome', 'invalid_channels');
  end if;
  select coalesce(array_agg(distinct c order by c), array[]::text[]) into v_selected from unnest(p_channels) c;
  select coalesce(array_agg(c order by c), array[]::text[]) into v_excluded from unnest(v_available) c where not c = any(v_selected);
  v_selection := jsonb_build_object('version',1,'availableChannels',to_jsonb(v_available),'excludedChannels',to_jsonb(v_excluded));

  -- Re-enabling a channel omitted at validation creates its own future row.
  -- Existing per-channel schedules and immutable media snapshots stay intact.
  v_retained := coalesce(v_template.payload->'retainedPublicationPayload','{}'::jsonb) || v_payload;
  if v_template.id is not null and 'tiktok' = any(v_selected) and not 'tiktok' = any(v_covered)
    and coalesce(v_retained#>'{tiktokPublicationSettings,musicUsageConfirmed}',v_template.payload#>'{publishPayload,tiktokPublicationSettings,musicUsageConfirmed}','false'::jsonb) <> 'true'::jsonb then
    return jsonb_build_object('outcome','tiktok_settings_required');
  end if;
  if v_template.id is not null then
    foreach v_channel in array v_selected loop
      if not v_channel = any(v_covered) then
        v_publish := coalesce(v_template.payload->'publishPayload','{}'::jsonb);
        foreach v_map in array array['postByChannel','imagesByChannel','videoByChannel','mediaModeByChannel','imageSettingsByChannel','videoSettingsByChannel','videoFormatByChannel','videoAdaptationModeByChannel','imagesByPlacement'] loop
          v_publish := jsonb_set(v_publish, array[v_map],
            coalesce(v_retained->v_map, v_retained#>array['publishPayload',v_map], '{}'::jsonb)
            || coalesce(v_publish->v_map,'{}'::jsonb), true);
        end loop;
        foreach v_map in array array['instagramPublicationSettings','facebookPublicationSettings','threadsPublicationSettings','pinterestPublicationSettings','tiktokPublicationSettings','tiktokPhotoFullScreen','mediaFormatVariants'] loop
          if v_retained ? v_map then v_publish := jsonb_set(v_publish,array[v_map],v_retained->v_map,true); end if;
        end loop;
        v_new_id := gen_random_uuid();
        -- Never reuse a dispatch key from the row used as a template.
        v_publish := (v_publish - 'idempotencyKey') || jsonb_build_object('channels',jsonb_build_array(v_channel),
          'selectedChannels',jsonb_build_array(v_channel),'origin',coalesce(v_publish->'origin','{}'::jsonb) - 'idempotencyKey');
        insert into public.inr_agent_scheduled_actions(id,user_id,automation_key,action_type,target_tool,source,title,summary,scheduled_at,timezone,channels,payload,status,attempt_count,created_at,updated_at)
        values(v_new_id,p_user_id,'publish','publication','booster',v_template.source,v_template.title,v_template.summary,
          v_template.scheduled_at,v_template.timezone,array[v_channel],
          v_template.payload || jsonb_build_object('publishPayload',v_publish,'publicationChannelSelection',v_selection,
            'publicationChannelSelectionRowChannels',jsonb_build_array(v_channel),
            'publicationChannelSelectionPaused',false), 'scheduled',0,v_now,v_now);
        v_ids := array_append(v_ids,v_new_id);
      end if;
    end loop;
  end if;

  -- Store the effective channels on the row too, including for older runners.
  with scopes as (
    select s.id, case when jsonb_typeof(s.payload->'publicationChannelSelectionRowChannels')='array'
      then array(select jsonb_array_elements_text(s.payload->'publicationChannelSelectionRowChannels')) else s.channels end as original_channels
    from public.inr_agent_scheduled_actions s where s.user_id=p_user_id and s.id=any(v_ids)
  )
  update public.inr_agent_scheduled_actions s
    set payload = (case when p_tiktok_settings is not null and 'tiktok'=any(scopes.original_channels)
      then jsonb_set(s.payload,'{publishPayload}',coalesce(s.payload->'publishPayload','{}'::jsonb)
        || jsonb_build_object('tiktokPublicationSettings',p_tiktok_settings),true) else s.payload end)
      || jsonb_build_object('publicationChannelSelection',v_selection,
      'publicationChannelSelectionRowChannels',to_jsonb(scopes.original_channels),
      'publicationChannelSelectionPaused',not (scopes.original_channels && v_selected)),
      channels = array(select c from unnest(scopes.original_channels) c where c=any(v_selected)),
      status = case when scopes.original_channels && v_selected then 'scheduled' else 'cancelled' end,
      updated_at = v_now
    from scopes where s.user_id = p_user_id and s.id = scopes.id;
  if v_source_id is not null then
    update public.inr_agent_actions set
      payload = jsonb_set(v_payload,'{publicationChannelSelection}',v_selection,true),
      target_channels = v_action.target_channels, updated_at = v_now
      where id = v_source_id and user_id = p_user_id returning * into v_action;
    if cardinality(v_ids) > 0 then
      update public.inr_agent_actions set payload = jsonb_set(payload,'{scheduledExecution}',coalesce(payload->'scheduledExecution','{}'::jsonb)
        || jsonb_build_object('scheduledActionIds',to_jsonb(v_ids)),true)
        where id = v_source_id and user_id = p_user_id returning * into v_action;
    end if;
  end if;
  return jsonb_build_object('outcome','saved','action',case when v_source_id is null then null else to_jsonb(v_action) end,
    'scheduledActions',(select coalesce(jsonb_agg(to_jsonb(s) order by s.scheduled_at,s.id),'[]'::jsonb)
      from public.inr_agent_scheduled_actions s where s.user_id=p_user_id and s.id=any(v_ids)));
end;
$$;
revoke all on function public.inrcy_set_agent_publication_channels(uuid,uuid,text[],timestamptz,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.inrcy_set_agent_publication_channels(uuid,uuid,text[],timestamptz,uuid,jsonb,jsonb) to service_role;

-- Confirmation uses the same locked channel choice as the checklist.
create or replace function public.inrcy_confirm_editorial_publication_schedule(
  p_action_id uuid,
  p_user_id uuid,
  p_rows jsonb,
  p_schedule_selections jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_action public.inr_agent_actions%rowtype;
  v_scheduled_rows jsonb := '[]'::jsonb;
  v_scheduled_ids jsonb := '[]'::jsonb;
begin
  if p_action_id is null or p_user_id is null then
    return jsonb_build_object('outcome', 'invalid_request');
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('outcome', 'invalid_schedule');
  end if;

  select action_row.*
    into v_action
    from public.inr_agent_actions as action_row
   where action_row.id = p_action_id
     and action_row.user_id = p_user_id
   for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Reject a schedule built before a concurrent channel selection change.
  if exists (
    select 1 from jsonb_array_elements(p_rows) schedule_row
    where coalesce(schedule_row#>'{payload,publicationChannelSelection}', 'null'::jsonb)
      is distinct from coalesce(v_action.payload->'publicationChannelSelection', 'null'::jsonb)
  ) then
    return jsonb_build_object('outcome', 'channels_changed', 'action', to_jsonb(v_action));
  end if;

  if v_action.status = 'scheduled' then
    select coalesce(
      jsonb_agg(to_jsonb(scheduled_row) order by scheduled_row.scheduled_at, scheduled_row.id),
      '[]'::jsonb
    )
      into v_scheduled_rows
      from public.inr_agent_scheduled_actions as scheduled_row
     where scheduled_row.user_id = p_user_id
       and scheduled_row.payload @> jsonb_build_object(
         'sourceActionId',
         p_action_id::text
       );

    if jsonb_array_length(v_scheduled_rows) > 0 then
      return jsonb_build_object(
        'outcome', 'already_scheduled',
        'action', to_jsonb(v_action),
        'scheduledActions', v_scheduled_rows
      );
    end if;
  end if;

  if v_action.automation_key is distinct from 'publish'
     or v_action.action_type is distinct from 'publication'
     or v_action.target_tool is distinct from 'booster'
     or v_action.execution_policy is distinct from 'manual_validation'
     or v_action.validation_required is distinct from true
     or v_action.status is distinct from 'pending_validation'
     or not coalesce(v_action.metadata, '{}'::jsonb)
       @> '{"editorialPlan": true}'::jsonb then
    return jsonb_build_object(
      'outcome', 'not_claimable',
      'action', to_jsonb(v_action)
    );
  end if;

  if v_action.scheduled_for is null or v_action.scheduled_for <= v_now then
    update public.inr_agent_actions
       set status = 'refused',
           validated_at = null,
           refused_at = v_now,
           last_error = 'Validation non reçue avant l’échéance programmée.',
           updated_at = v_now
     where id = p_action_id
       and user_id = p_user_id
       and status = 'pending_validation'
    returning * into v_action;

    return jsonb_build_object(
      'outcome', 'expired',
      'action', to_jsonb(v_action)
    );
  end if;

  with inserted as (
    insert into public.inr_agent_scheduled_actions (
      id,
      user_id,
      automation_key,
      action_type,
      target_tool,
      source,
      title,
      summary,
      scheduled_at,
      timezone,
      channels,
      payload,
      status,
      attempt_count,
      last_error,
      executed_at,
      created_at,
      updated_at
    )
    select
      coalesce(schedule_row.id, gen_random_uuid()),
      p_user_id,
      'publish',
      'publication',
      'booster',
      'manual',
      coalesce(nullif(schedule_row.title, ''), v_action.title),
      coalesce(schedule_row.summary, v_action.summary, ''),
      v_action.scheduled_for,
      coalesce(nullif(schedule_row.timezone, ''), 'Europe/Paris'),
      schedule_row.channels,
      coalesce(schedule_row.payload, '{}'::jsonb),
      'scheduled',
      0,
      null,
      null,
      v_now,
      v_now
    from jsonb_to_recordset(p_rows) as schedule_row(
      id uuid,
      title text,
      summary text,
      timezone text,
      channels text[],
      payload jsonb
    )
    where cardinality(coalesce(schedule_row.channels, array[]::text[])) > 0
    returning *
  )
  select
    coalesce(
      jsonb_agg(to_jsonb(inserted) order by inserted.scheduled_at, inserted.id),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(to_jsonb(inserted.id) order by inserted.scheduled_at, inserted.id),
      '[]'::jsonb
    )
    into v_scheduled_rows, v_scheduled_ids
    from inserted;

  if jsonb_array_length(v_scheduled_rows) = 0 then
    raise exception 'No schedulable editorial publication channel';
  end if;

  update public.inr_agent_actions
     set status = 'scheduled',
         validated_at = v_now,
         refused_at = null,
         last_error = null,
         payload = jsonb_set(
           coalesce(payload, '{}'::jsonb),
           '{scheduledExecution}',
           jsonb_build_object(
             'scheduledActionIds', v_scheduled_ids,
             'scheduledAt', v_action.scheduled_for,
             'scheduleSelections', coalesce(p_schedule_selections, '[]'::jsonb),
             'source', 'manual',
             'createdAt', v_now
           ),
           true
         ),
         updated_at = v_now
   where id = p_action_id
     and user_id = p_user_id
     and status = 'pending_validation'
     and scheduled_for > v_now
  returning * into v_action;

  if not found then
    raise exception 'Editorial validation claim was lost';
  end if;

  return jsonb_build_object(
    'outcome', 'scheduled',
    'action', to_jsonb(v_action),
    'scheduledActions', v_scheduled_rows
  );
end;
$$;

revoke all on function public.inrcy_confirm_editorial_publication_schedule(
  uuid,
  uuid,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.inrcy_confirm_editorial_publication_schedule(
  uuid,
  uuid,
  jsonb,
  jsonb
) to service_role;
