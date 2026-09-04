begin;

-- iNrAgent prépare les publications, mais le professionnel garde toujours le
-- dernier mot. Cette migration neutralise aussi les anciens réglages et jobs
-- automatiques qui auraient été créés avant cette politique.
update public.inr_agent_automation_settings
set validation_mode = 'notify_before_validation',
    updated_at = now()
where automation_key = 'publish'
  and validation_mode is distinct from 'notify_before_validation';

update public.inr_agent_actions
set validation_required = true,
    execution_policy = 'manual_validation',
    status = case
      -- Ne retire jamais une validation manuelle déjà donnée par le pro.
      -- Seuls les anciens états issus d'une politique automatique sont ramenés
      -- dans la file de validation.
      when status in ('prepared', 'scheduled', 'validated')
        and (
          validation_required is distinct from true
          or execution_policy is distinct from 'manual_validation'
        )
        then 'pending_validation'
      else status
    end,
    validated_at = case
      when status in ('prepared', 'scheduled', 'validated')
        and (
          validation_required is distinct from true
          or execution_policy is distinct from 'manual_validation'
        )
        then null
      else validated_at
    end,
    payload = case
      when status in ('prepared', 'scheduled', 'validated')
        and (
          validation_required is distinct from true
          or execution_policy is distinct from 'manual_validation'
        )
        then coalesce(payload, '{}'::jsonb) - 'scheduledExecution'
      else payload
    end,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'manualValidationEnforcedAt', now(),
      'manualValidationReason', 'safe_editorial_workflow'
    ),
    updated_at = now()
where automation_key = 'publish'
  and coalesce(metadata, '{}'::jsonb) @> '{"editorialPlan": true}'::jsonb
  and status not in ('completed', 'refused', 'cancelled');

do $$
begin
  if to_regclass('public.inr_agent_scheduled_actions') is not null then
    update public.inr_agent_scheduled_actions
    set status = 'cancelled',
        last_error = 'Publication automatique annulée : validation manuelle iNrAgent obligatoire.',
        updated_at = now()
    where source = 'automatic'
      and status in ('scheduled', 'running')
      and (target_tool = 'booster' or action_type = 'publication');
  end if;
end $$;

alter table public.inr_agent_automation_settings
  alter column validation_mode set default 'notify_before_validation';

alter table public.inr_agent_automation_settings
  drop constraint if exists inr_agent_validation_mode_check;

alter table public.inr_agent_automation_settings
  add constraint inr_agent_validation_mode_check
  check (
    (automation_key = 'publish' and validation_mode = 'notify_before_validation')
    or
    (automation_key <> 'publish' and validation_mode in (
      'validation_required',
      'draft_only',
      'notify_before_validation',
      'automatic_report'
    ))
  );

alter table public.inr_agent_actions
  drop constraint if exists inr_agent_editorial_manual_validation_check;

alter table public.inr_agent_actions
  add constraint inr_agent_editorial_manual_validation_check
  check (
    not (
      automation_key = 'publish'
      and coalesce(metadata, '{}'::jsonb) @> '{"editorialPlan": true}'::jsonb
    )
    or (
      validation_required = true
      and execution_policy = 'manual_validation'
    )
  );

-- Une seule fonction enregistre la configuration globale et les réglages des
-- actions. PostgreSQL annule tout si une seule ligne est invalide : aucun état
-- "moitié ancien / moitié nouveau" ne peut subsister.
create or replace function public.inrcy_save_inr_agent_settings(
  p_global jsonb,
  p_automations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_saved_automations integer := 0;
begin
  if jsonb_typeof(coalesce(p_global, '{}'::jsonb)) <> 'object' then
    raise exception 'p_global must be a JSON object';
  end if;
  if jsonb_typeof(coalesce(p_automations, '[]'::jsonb)) <> 'array' then
    raise exception 'p_automations must be a JSON array';
  end if;

  v_user_id := nullif(p_global ->> 'user_id', '')::uuid;
  if v_user_id is null then
    raise exception 'user_id is required';
  end if;

  insert into public.inr_agent_settings (
    user_id,
    global_enabled,
    tone,
    timezone,
    metadata,
    updated_at
  ) values (
    v_user_id,
    coalesce((p_global ->> 'global_enabled')::boolean, false),
    coalesce(nullif(p_global ->> 'tone', ''), 'professional'),
    coalesce(nullif(p_global ->> 'timezone', ''), 'Europe/Paris'),
    coalesce(p_global -> 'metadata', '{}'::jsonb),
    coalesce(nullif(p_global ->> 'updated_at', '')::timestamptz, now())
  )
  on conflict (user_id) do update set
    global_enabled = excluded.global_enabled,
    tone = excluded.tone,
    timezone = excluded.timezone,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

  insert into public.inr_agent_automation_settings (
    user_id,
    automation_key,
    enabled,
    frequency,
    day_of_week,
    time,
    validation_mode,
    allowed_channels,
    allowed_themes,
    use_image_bank,
    image_required,
    recipient_scope,
    source_strategy,
    last_prepared_at,
    last_executed_at,
    next_run_at,
    metadata,
    updated_at
  )
  select
    (item ->> 'user_id')::uuid,
    item ->> 'automation_key',
    coalesce((item ->> 'enabled')::boolean, false),
    item ->> 'frequency',
    (item ->> 'day_of_week')::smallint,
    item ->> 'time',
    case
      when item ->> 'automation_key' = 'publish'
        then 'notify_before_validation'
      else item ->> 'validation_mode'
    end,
    coalesce(
      array(select jsonb_array_elements_text(coalesce(item -> 'allowed_channels', '[]'::jsonb))),
      array[]::text[]
    ),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(item -> 'allowed_themes', '[]'::jsonb))),
      array[]::text[]
    ),
    coalesce((item ->> 'use_image_bank')::boolean, true),
    coalesce((item ->> 'image_required')::boolean, false),
    coalesce(nullif(item ->> 'recipient_scope', ''), 'none'),
    coalesce(nullif(item ->> 'source_strategy', ''), 'mixed'),
    nullif(item ->> 'last_prepared_at', '')::timestamptz,
    nullif(item ->> 'last_executed_at', '')::timestamptz,
    nullif(item ->> 'next_run_at', '')::timestamptz,
    coalesce(item -> 'metadata', '{}'::jsonb),
    coalesce(nullif(item ->> 'updated_at', '')::timestamptz, now())
  from jsonb_array_elements(p_automations) as source(item)
  where (item ->> 'user_id')::uuid = v_user_id
  on conflict (user_id, automation_key) do update set
    enabled = excluded.enabled,
    frequency = excluded.frequency,
    day_of_week = excluded.day_of_week,
    time = excluded.time,
    validation_mode = excluded.validation_mode,
    allowed_channels = excluded.allowed_channels,
    allowed_themes = excluded.allowed_themes,
    use_image_bank = excluded.use_image_bank,
    image_required = excluded.image_required,
    recipient_scope = excluded.recipient_scope,
    source_strategy = excluded.source_strategy,
    last_prepared_at = excluded.last_prepared_at,
    last_executed_at = excluded.last_executed_at,
    next_run_at = excluded.next_run_at,
    metadata = excluded.metadata,
    updated_at = excluded.updated_at;

  get diagnostics v_saved_automations = row_count;
  if v_saved_automations <> jsonb_array_length(p_automations) then
    raise exception 'automation rows do not all belong to user %', v_user_id;
  end if;

  return jsonb_build_object(
    'saved', true,
    'userId', v_user_id,
    'automationCount', v_saved_automations
  );
end;
$$;

revoke all on function public.inrcy_save_inr_agent_settings(jsonb, jsonb)
from public, anon, authenticated;
grant execute on function public.inrcy_save_inr_agent_settings(jsonb, jsonb)
to service_role;

commit;
