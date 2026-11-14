begin;
set local lock_timeout = '10s';

-- Match getMyRole/viewerIsAdmin exactly. This is not a subscription or an
-- establishment-membership role. No account, role or saved setting is changed.
create or replace function public.inrcy_is_inr_agent_admin_account(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user_id is not null and (
    p_user_id = '670b527d-5e08-42b4-ba95-e58e812339eb'::uuid
    or exists (select 1 from public.profiles where user_id = p_user_id and role = 'admin')
  );
$$;

create or replace function public.inrcy_inr_agent_admin_opt_in_valid(p_opt_in jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if jsonb_typeof(p_opt_in) is distinct from 'object'
     or p_opt_in -> 'version' is distinct from '1'::jsonb
     or jsonb_typeof(p_opt_in -> 'id') is distinct from 'string'
     or jsonb_typeof(p_opt_in -> 'enabledAt') is distinct from 'string'
     or (p_opt_in ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (p_opt_in ->> 'enabledAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    return false;
  end if;
  perform (p_opt_in ->> 'id')::uuid, (p_opt_in ->> 'enabledAt')::timestamptz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.inrcy_inr_agent_admin_marker_valid(p_user_id uuid, p_marker jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
begin
  if p_user_id is null
     or jsonb_typeof(p_marker) is distinct from 'object'
     or p_marker -> 'version' is distinct from '1'::jsonb
     or jsonb_typeof(p_marker -> 'optInId') is distinct from 'string'
     or jsonb_typeof(p_marker -> 'accountId') is distinct from 'string'
     or jsonb_typeof(p_marker -> 'preparedAt') is distinct from 'string'
     or (p_marker ->> 'optInId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (p_marker ->> 'accountId') is distinct from p_user_id::text
     or (p_marker ->> 'preparedAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
    return false;
  end if;
  perform (p_marker ->> 'optInId')::uuid, (p_marker ->> 'preparedAt')::timestamptz;
  return true;
exception when others then
  return false;
end;
$$;

-- The current role, enabled settings and consent are checked together at each
-- automatic action/job write. A valid cron secret is not an admin grant.
create or replace function public.inrcy_inr_agent_admin_publish_authorized(p_user_id uuid, p_marker jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_opt_in jsonb;
begin
  if not public.inrcy_is_inr_agent_admin_account(p_user_id)
     or not public.inrcy_inr_agent_admin_marker_valid(p_user_id, p_marker) then
    return false;
  end if;
  select automation.metadata -> 'adminPublishOptIn' into v_opt_in
    from public.inr_agent_settings as global_settings
    join public.inr_agent_automation_settings as automation using (user_id)
   where global_settings.user_id = p_user_id and global_settings.global_enabled = true
     and automation.automation_key = 'publish' and automation.enabled = true
     and automation.validation_mode = 'admin_automatic_publish';
  if not found or not public.inrcy_inr_agent_admin_opt_in_valid(v_opt_in) then return false; end if;
  return coalesce((v_opt_in ->> 'id') = (p_marker ->> 'optInId')
    and (p_marker ->> 'preparedAt')::timestamptz >= (v_opt_in ->> 'enabledAt')::timestamptz, false);
exception when others then
  return false;
end;
$$;

alter table public.inr_agent_automation_settings drop constraint if exists inr_agent_frequency_check;
alter table public.inr_agent_automation_settings add constraint inr_agent_frequency_check check (
  frequency in ('weekly','twice_weekly','three_times_weekly','biweekly','three_times_monthly','monthly','quarterly','one_off')
  or (frequency = 'daily' and automation_key = 'publish')
);

alter table public.inr_agent_automation_settings drop constraint if exists inr_agent_validation_mode_check;
alter table public.inr_agent_automation_settings add constraint inr_agent_validation_mode_check check (
  (automation_key = 'publish' and validation_mode in ('notify_before_validation','admin_automatic_publish'))
  or (automation_key <> 'publish' and validation_mode in ('validation_required','draft_only','notify_before_validation','automatic_report'))
);

create or replace function public.inrcy_guard_inr_agent_admin_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.frequency = 'daily' or new.validation_mode = 'admin_automatic_publish' then
    if new.automation_key is distinct from 'publish'
       or not public.inrcy_is_inr_agent_admin_account(new.user_id) then
      raise exception 'INR_AGENT_ADMIN_OPTIONS_REQUIRED' using errcode = '42501';
    end if;
  end if;
  if new.validation_mode = 'admin_automatic_publish' then
    if new.enabled is distinct from true
       or not exists (select 1 from public.inr_agent_settings where user_id = new.user_id and global_enabled = true)
       or not public.inrcy_inr_agent_admin_opt_in_valid(new.metadata -> 'adminPublishOptIn') then
      raise exception 'INR_AGENT_ADMIN_OPT_IN_REQUIRED' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inr_agent_admin_settings_guard on public.inr_agent_automation_settings;
create trigger inr_agent_admin_settings_guard before insert or update on public.inr_agent_automation_settings
for each row execute function public.inrcy_guard_inr_agent_admin_settings();

-- Retain the existing manual editorial branch. Terminal history and safe
-- parking do not need a still-active automatic grant; reactivation does.
alter table public.inr_agent_actions drop constraint if exists inr_agent_editorial_manual_validation_check;
alter table public.inr_agent_actions add constraint inr_agent_editorial_manual_validation_check check (
  status in ('completed','failed','refused','cancelled')
  or not coalesce(automation_key = 'publish' and coalesce(metadata, '{}'::jsonb) @> '{"editorialPlan":true}'::jsonb, false)
  or (validation_required = true and execution_policy = 'manual_validation')
  or (
    automation_key = 'publish' and action_type = 'publication' and target_tool = 'booster'
    and validation_required = false and execution_policy = 'automatic_after_settings' and validated_at is null
    and (not (coalesce(metadata, '{}'::jsonb) ? 'adminAutomaticPublishManualReview') or metadata -> 'adminAutomaticPublishManualReview' = 'false'::jsonb)
    and public.inrcy_inr_agent_admin_marker_valid(user_id, metadata -> 'adminAutomaticPublish')
  )
);

create or replace function public.inrcy_guard_inr_agent_admin_action()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (
    old.metadata -> 'adminAutomaticPublishManualReview' = 'true'::jsonb
    or (old.automation_key = 'publish' and old.execution_policy = 'automatic_after_settings'
      and new.validation_required = true and new.execution_policy = 'manual_validation')
    or (old.automation_key = 'publish' and old.execution_policy is distinct from 'automatic_after_settings' and (
      old.status in ('pending_validation','prepared','scheduled','validated','completed','failed','refused','cancelled')
      or old.metadata ->> 'editorialState' = 'ready'
      or nullif(old.metadata ->> 'editorialGeneratedAt','') is not null
      or old.payload -> 'editorialPlan' ->> 'state' = 'ready'
      or (jsonb_typeof(old.payload -> 'postByChannel') = 'object' and old.payload -> 'postByChannel' <> '{}'::jsonb)
      or (jsonb_typeof(old.payload -> 'publishPayload' -> 'postByChannel') = 'object' and old.payload -> 'publishPayload' -> 'postByChannel' <> '{}'::jsonb)
      or case when jsonb_typeof(old.image_assets) = 'array' then jsonb_array_length(old.image_assets) > 0 else false end
    ))
  ) then
    new.metadata := (case when jsonb_typeof(new.metadata) = 'object' then new.metadata else '{}'::jsonb end)
      || '{"adminAutomaticPublishManualReview":true}'::jsonb;
  end if;
  if new.automation_key = 'publish' and new.execution_policy = 'automatic_after_settings'
     and (new.status in ('completed','failed','refused','cancelled')
       or (tg_op = 'UPDATE' and old.status in ('completed','failed','refused','cancelled'))) then
    if tg_op <> 'UPDATE' then
      raise exception 'INR_AGENT_ADMIN_TERMINAL_PROVENANCE_DENIED' using errcode = '42501';
    end if;
    if row(new.user_id,new.automation_key,new.action_type,new.target_tool,new.validation_required,new.execution_policy,new.validated_at,new.metadata -> 'adminAutomaticPublish')
       is distinct from row(old.user_id,old.automation_key,old.action_type,old.target_tool,old.validation_required,old.execution_policy,old.validated_at,old.metadata -> 'adminAutomaticPublish') then
      raise exception 'INR_AGENT_ADMIN_TERMINAL_PROVENANCE_DENIED' using errcode = '42501';
    end if;
  end if;
  if new.status in ('completed','failed','refused','cancelled')
     or (new.validation_required = true and new.execution_policy = 'manual_validation') then
    return new;
  end if;
  if new.automation_key = 'publish' and new.execution_policy = 'automatic_after_settings' then
    if new.action_type is distinct from 'publication' or new.target_tool is distinct from 'booster'
       or new.validation_required is distinct from false or new.validated_at is not null
       or (new.metadata -> 'adminAutomaticPublishManualReview' is not null and new.metadata -> 'adminAutomaticPublishManualReview' is distinct from 'false'::jsonb)
       or not public.inrcy_inr_agent_admin_publish_authorized(new.user_id, new.metadata -> 'adminAutomaticPublish') then
      raise exception 'INR_AGENT_ADMIN_AUTOMATIC_PUBLICATION_DENIED' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inr_agent_admin_action_guard on public.inr_agent_actions;
create trigger inr_agent_admin_action_guard before insert or update on public.inr_agent_actions
for each row execute function public.inrcy_guard_inr_agent_admin_action();

create or replace function public.inrcy_guard_inr_agent_admin_scheduled_publication()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source_action_id uuid;
begin
  if new.status not in ('scheduled','running') or new.source <> 'automatic'
     or not coalesce(new.automation_key = 'publish' or (new.action_type = 'publication' and new.target_tool = 'booster'), false) then
    return new;
  end if;
  if new.automation_key is distinct from 'publish' or new.action_type is distinct from 'publication' or new.target_tool is distinct from 'booster'
     or not public.inrcy_inr_agent_admin_publish_authorized(new.user_id, new.payload -> 'adminAutomaticPublish')
     or jsonb_typeof(new.payload -> 'sourceActionId') is distinct from 'string'
     or (new.payload ->> 'sourceActionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INR_AGENT_ADMIN_AUTOMATIC_SCHEDULE_DENIED' using errcode = '42501';
  end if;
  v_source_action_id := (new.payload ->> 'sourceActionId')::uuid;
  if not exists (
    select 1 from public.inr_agent_actions as action
    where action.id = v_source_action_id and action.user_id = new.user_id
      and action.automation_key = 'publish' and action.action_type = 'publication' and action.target_tool = 'booster'
      and action.status in ('prepared','executing','scheduled','failed','completed')
      and action.validation_required = false and action.execution_policy = 'automatic_after_settings' and action.validated_at is null
      and (not (coalesce(action.metadata, '{}'::jsonb) ? 'adminAutomaticPublishManualReview') or action.metadata -> 'adminAutomaticPublishManualReview' = 'false'::jsonb)
      and (action.metadata -> 'adminAutomaticPublish') = (new.payload -> 'adminAutomaticPublish')
  ) then
    raise exception 'INR_AGENT_ADMIN_AUTOMATIC_SOURCE_ACTION_DENIED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists inr_agent_admin_scheduled_publication_guard on public.inr_agent_scheduled_actions;
create trigger inr_agent_admin_scheduled_publication_guard before insert or update on public.inr_agent_scheduled_actions
for each row execute function public.inrcy_guard_inr_agent_admin_scheduled_publication();

-- Keep the deployed signature, transaction semantics, empty search_path and
-- service-role-only EXECUTE. Only an explicit admin mode escapes manual mode.
create or replace function public.inrcy_save_inr_agent_settings(p_global jsonb, p_automations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_saved_automations integer := 0;
begin
  if jsonb_typeof(p_global) is distinct from 'object' then
    raise exception 'p_global must be a JSON object';
  end if;
  if jsonb_typeof(p_automations) is distinct from 'array' then
    raise exception 'p_automations must be a JSON array';
  end if;
  v_user_id := nullif(p_global ->> 'user_id', '')::uuid;
  if v_user_id is null then raise exception 'user_id is required'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_automations) as source(item)
    where item ->> 'frequency' = 'daily' or item ->> 'validation_mode' = 'admin_automatic_publish'
  ) and not public.inrcy_is_inr_agent_admin_account(v_user_id) then
    raise exception 'INR_AGENT_ADMIN_OPTIONS_REQUIRED' using errcode = '42501';
  end if;

  insert into public.inr_agent_settings(user_id,global_enabled,tone,timezone,metadata,updated_at)
  values (
    v_user_id, coalesce((p_global ->> 'global_enabled')::boolean,false),
    coalesce(nullif(p_global ->> 'tone',''),'professional'), coalesce(nullif(p_global ->> 'timezone',''),'Europe/Paris'),
    coalesce(p_global -> 'metadata','{}'::jsonb), coalesce(nullif(p_global ->> 'updated_at','')::timestamptz,now())
  ) on conflict (user_id) do update set global_enabled=excluded.global_enabled,tone=excluded.tone,
    timezone=excluded.timezone,metadata=excluded.metadata,updated_at=excluded.updated_at;

  insert into public.inr_agent_automation_settings(
    user_id,automation_key,enabled,frequency,day_of_week,time,validation_mode,allowed_channels,allowed_themes,
    use_image_bank,image_required,recipient_scope,source_strategy,last_prepared_at,last_executed_at,next_run_at,metadata,updated_at
  ) select
    (item ->> 'user_id')::uuid, item ->> 'automation_key', coalesce((item ->> 'enabled')::boolean,false),
    item ->> 'frequency', (item ->> 'day_of_week')::smallint, item ->> 'time',
    case when item ->> 'automation_key' = 'publish' then
      case when item ->> 'validation_mode' = 'admin_automatic_publish' then 'admin_automatic_publish' else 'notify_before_validation' end
      else item ->> 'validation_mode' end,
    coalesce(array(select jsonb_array_elements_text(coalesce(item -> 'allowed_channels','[]'::jsonb))),array[]::text[]),
    coalesce(array(select jsonb_array_elements_text(coalesce(item -> 'allowed_themes','[]'::jsonb))),array[]::text[]),
    coalesce((item ->> 'use_image_bank')::boolean,true), coalesce((item ->> 'image_required')::boolean,false),
    coalesce(nullif(item ->> 'recipient_scope',''),'none'), coalesce(nullif(item ->> 'source_strategy',''),'mixed'),
    nullif(item ->> 'last_prepared_at','')::timestamptz, nullif(item ->> 'last_executed_at','')::timestamptz,
    nullif(item ->> 'next_run_at','')::timestamptz, coalesce(item -> 'metadata','{}'::jsonb),
    coalesce(nullif(item ->> 'updated_at','')::timestamptz,now())
  from jsonb_array_elements(p_automations) as source(item)
  where (item ->> 'user_id')::uuid = v_user_id
  on conflict (user_id,automation_key) do update set
    enabled=excluded.enabled,frequency=excluded.frequency,day_of_week=excluded.day_of_week,time=excluded.time,
    validation_mode=excluded.validation_mode,allowed_channels=excluded.allowed_channels,allowed_themes=excluded.allowed_themes,
    use_image_bank=excluded.use_image_bank,image_required=excluded.image_required,recipient_scope=excluded.recipient_scope,
    source_strategy=excluded.source_strategy,last_prepared_at=excluded.last_prepared_at,last_executed_at=excluded.last_executed_at,
    next_run_at=excluded.next_run_at,metadata=excluded.metadata,updated_at=excluded.updated_at;

  get diagnostics v_saved_automations = row_count;
  if v_saved_automations <> jsonb_array_length(p_automations) then
    raise exception 'automation rows do not all belong to user %',v_user_id;
  end if;
  return jsonb_build_object('saved',true,'userId',v_user_id,'automationCount',v_saved_automations);
end;
$$;

revoke all on function public.inrcy_is_inr_agent_admin_account(uuid),
  public.inrcy_inr_agent_admin_opt_in_valid(jsonb),public.inrcy_inr_agent_admin_marker_valid(uuid,jsonb),
  public.inrcy_inr_agent_admin_publish_authorized(uuid,jsonb),public.inrcy_guard_inr_agent_admin_settings(),
  public.inrcy_guard_inr_agent_admin_action(),public.inrcy_guard_inr_agent_admin_scheduled_publication(),
  public.inrcy_save_inr_agent_settings(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.inrcy_is_inr_agent_admin_account(uuid),
  public.inrcy_inr_agent_admin_opt_in_valid(jsonb),public.inrcy_inr_agent_admin_marker_valid(uuid,jsonb),
  public.inrcy_inr_agent_admin_publish_authorized(uuid,jsonb),public.inrcy_guard_inr_agent_admin_settings(),
  public.inrcy_guard_inr_agent_admin_action(),public.inrcy_guard_inr_agent_admin_scheduled_publication(),
  public.inrcy_save_inr_agent_settings(jsonb,jsonb) to service_role;

commit;
