begin;
set local lock_timeout = '5s';

-- Return only the two product entitlements. An operator's own privileges and
-- the publication consent are checked separately. Browser roles cannot call this.
create function public.inrcy_inr_agent_publication_plan_rights(p_user_id uuid)
returns table(can_use_high_frequency boolean, can_publish_without_validation boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_plan text;
  v_active boolean;
  v_owner_id uuid;
  v_owners uuid[];
begin
  can_use_high_frequency := false;
  can_publish_without_validation := false;
  if p_user_id is null then return next; return; end if;

  -- A private establishment contract has precedence even when inactive. Its
  -- binding must still match the owner, including after a membership change.
  select a.plan::text,
         (a.status = 'active' or (a.status = 'trialing' and
           (a.start_date::timestamp at time zone 'UTC') + interval '21 days' > now())),
         a.auth_user_id
    into v_plan, v_active, v_owner_id
    from public.inrcy_account_subscriptions a where a.account_id = p_user_id;
  if found then
    if not exists (select 1 from public.inrcy_account_members m where m.account_id = p_user_id
      and m.auth_user_id = v_owner_id and m.role = 'owner') then return next; return; end if;
  else
    select array_agg(m.auth_user_id) into v_owners
      from public.inrcy_account_members m where m.account_id = p_user_id and m.role = 'owner';
    if cardinality(v_owners) > 1 then return next; return; end if;
    v_owner_id := coalesce(v_owners[1], p_user_id);
    -- Legacy accounts may store the subscription on their own UUID.
    select s.plan::text, (s.status = 'active' or (s.status = 'trialing' and
           coalesce(s.trial_end_at, (s.start_date::timestamp at time zone 'UTC') + interval '21 days') > now()))
      into v_plan, v_active from public.subscriptions s
      where s.user_id in (v_owner_id, p_user_id)
      order by (s.user_id = v_owner_id) desc limit 1;
  end if;
  if v_active is true then
    can_use_high_frequency := coalesce(v_plan in ('Premium','Founder'), false);
    can_publish_without_validation := coalesce(v_plan in ('Trial','Standard','Premium','Founder'), false);
  end if;
  return next;
end;
$$;
revoke all on function public.inrcy_inr_agent_publication_plan_rights(uuid) from public, anon, authenticated;
grant execute on function public.inrcy_inr_agent_publication_plan_rights(uuid) to service_role;

alter table public.inr_agent_automation_settings drop constraint inr_agent_frequency_check;
alter table public.inr_agent_automation_settings add constraint inr_agent_frequency_check check (
  frequency in ('weekly','twice_weekly','three_times_weekly','biweekly','three_times_monthly','monthly','quarterly','one_off')
  or (frequency in ('daily','five_times_weekly') and automation_key = 'publish')
);

create or replace function public.inrcy_guard_inr_agent_admin_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_high_frequency boolean := new.frequency in ('daily', 'five_times_weekly');
  v_automatic boolean := new.validation_mode = 'admin_automatic_publish';
  v_rights record;
begin
  if v_high_frequency or v_automatic then
    if new.automation_key is distinct from 'publish' then
      raise exception 'INR_AGENT_ADMIN_OPTIONS_REQUIRED' using errcode = '42501';
    end if;
    if not public.inrcy_is_inr_agent_admin_account(new.user_id) then
      select * into v_rights from public.inrcy_inr_agent_publication_plan_rights(new.user_id);
      if (v_high_frequency and not v_rights.can_use_high_frequency)
         or (v_automatic and not v_rights.can_publish_without_validation) then
        raise exception 'INR_AGENT_ADMIN_OPTIONS_REQUIRED' using errcode = '42501';
      end if;
    end if;
  end if;
  if v_automatic and (new.enabled is distinct from true
    or not exists (select 1 from public.inr_agent_settings where user_id = new.user_id and global_enabled = true)
    or not public.inrcy_inr_agent_admin_opt_in_valid(new.metadata -> 'adminPublishOptIn')) then
    raise exception 'INR_AGENT_ADMIN_OPT_IN_REQUIRED' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Existing action and scheduled-job triggers both recheck this function on write.
create or replace function public.inrcy_inr_agent_admin_publish_authorized(p_user_id uuid, p_marker jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_opt_in jsonb;
begin
  if not public.inrcy_inr_agent_admin_marker_valid(p_user_id, p_marker) then return false; end if;
  if not public.inrcy_is_inr_agent_admin_account(p_user_id)
     and not (select can_publish_without_validation from public.inrcy_inr_agent_publication_plan_rights(p_user_id)) then
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

-- The same row-level trigger handles RPC saves and direct writes. Exceptions
-- still roll back the complete settings save, including its global settings.
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

notify pgrst, 'reload schema';
commit;
