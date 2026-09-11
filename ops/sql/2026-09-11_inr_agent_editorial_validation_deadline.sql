begin;

-- Le cron parcourt uniquement les publications éditoriales encore en attente.
-- Cet index garde le contrôle des échéances rapide lorsque le volume augmente.
create index if not exists idx_inr_agent_actions_editorial_validation_due
  on public.inr_agent_actions (scheduled_for asc)
  where status = 'pending_validation'
    and automation_key = 'publish'
    and action_type = 'publication'
    and target_tool = 'booster'
    and execution_policy = 'manual_validation'
    and validation_required = true
    and coalesce(metadata, '{}'::jsonb) @> '{"editorialPlan": true}'::jsonb;

-- Une validation et l'arrivée à échéance prennent le même verrou de ligne.
-- Une seule issue peut donc gagner : programmation complète ou refus complet.
create or replace function public.inrcy_confirm_editorial_publication_schedule(
  p_action_id uuid,
  p_user_id uuid,
  p_rows jsonb,
  p_schedule_selections jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
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

commit;
