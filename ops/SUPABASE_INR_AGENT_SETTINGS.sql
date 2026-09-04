-- iNr'Agent V2 - configuration globale + réglages par automatisation
-- À exécuter dans Supabase SQL Editor.
-- Migration compatible avec l'ancienne table inr_agent_settings.

create extension if not exists pgcrypto;

create table if not exists public.inr_agent_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  global_enabled boolean not null default false,
  tone text not null default 'professional',
  timezone text not null default 'Europe/Paris',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colonnes V2 ajoutées si la table existait déjà en V1.
alter table public.inr_agent_settings add column if not exists global_enabled boolean not null default false;
alter table public.inr_agent_settings add column if not exists tone text not null default 'professional';
alter table public.inr_agent_settings add column if not exists timezone text not null default 'Europe/Paris';
alter table public.inr_agent_settings add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.inr_agent_settings add column if not exists created_at timestamptz not null default now();
alter table public.inr_agent_settings add column if not exists updated_at timestamptz not null default now();

-- Compatibilité V1 : si l'ancienne colonne enabled existe, on la migre vers global_enabled.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inr_agent_settings'
      and column_name = 'enabled'
  ) then
    update public.inr_agent_settings
    set global_enabled = coalesce(enabled, global_enabled)
    where global_enabled is distinct from coalesce(enabled, global_enabled);
  end if;
end $$;

alter table public.inr_agent_settings drop constraint if exists inr_agent_settings_tone_check;
alter table public.inr_agent_settings
  add constraint inr_agent_settings_tone_check
  check (tone in ('professional', 'friendly', 'premium', 'local', 'dynamic'));

create table if not exists public.inr_agent_automation_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  automation_key text not null,
  enabled boolean not null default false,
  frequency text not null default 'weekly',
  day_of_week smallint not null default 1,
  time text not null default '09:00',
  validation_mode text not null default 'notify_before_validation',
  allowed_channels text[] not null default array[]::text[],
  allowed_themes text[] not null default array[]::text[],
  use_image_bank boolean not null default true,
  image_required boolean not null default false,
  recipient_scope text not null default 'none',
  source_strategy text not null default 'mixed',
  last_prepared_at timestamptz,
  last_executed_at timestamptz,
  next_run_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inr_agent_automation_settings_unique unique (user_id, automation_key),
  constraint inr_agent_automation_key_check check (automation_key in ('publish', 'grow', 'loyalty', 'stats')),
  constraint inr_agent_frequency_check check (frequency in ('weekly', 'twice_weekly', 'three_times_weekly', 'biweekly', 'three_times_monthly', 'monthly', 'quarterly', 'one_off')),
  constraint inr_agent_day_check check (day_of_week between 0 and 6),
  constraint inr_agent_time_check check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  constraint inr_agent_validation_mode_check check (
    (automation_key = 'publish' and validation_mode = 'notify_before_validation')
    or
    (automation_key <> 'publish' and validation_mode in ('validation_required', 'draft_only', 'notify_before_validation', 'automatic_report'))
  ),
  constraint inr_agent_recipient_scope_check check (recipient_scope in ('none', 'all_crm', 'clients', 'prospects', 'recent_contacts', 'inactive_contacts', 'manual_selection')),
  constraint inr_agent_source_strategy_check check (source_strategy in ('published_history', 'templates', 'stats_snapshot', 'mixed'))
);

update public.inr_agent_automation_settings
set validation_mode = 'notify_before_validation', updated_at = now()
where automation_key = 'publish'
  and validation_mode is distinct from 'notify_before_validation';

alter table public.inr_agent_automation_settings
  alter column validation_mode set default 'notify_before_validation';
alter table public.inr_agent_automation_settings
  drop constraint if exists inr_agent_validation_mode_check;
alter table public.inr_agent_automation_settings
  add constraint inr_agent_validation_mode_check
  check (
    (automation_key = 'publish' and validation_mode = 'notify_before_validation')
    or
    (automation_key <> 'publish' and validation_mode in ('validation_required', 'draft_only', 'notify_before_validation', 'automatic_report'))
  );

create index if not exists idx_inr_agent_automation_settings_user
on public.inr_agent_automation_settings (user_id, automation_key);

create index if not exists idx_inr_agent_automation_settings_due
on public.inr_agent_automation_settings (enabled, next_run_at)
where enabled = true;

alter table public.inr_agent_settings enable row level security;
alter table public.inr_agent_automation_settings enable row level security;

drop policy if exists "Users can read own inr agent settings" on public.inr_agent_settings;
create policy "Users can read own inr agent settings"
on public.inr_agent_settings
for select
using (auth.uid() = user_id);

drop policy if exists "Users can read own inr agent automation settings" on public.inr_agent_automation_settings;
create policy "Users can read own inr agent automation settings"
on public.inr_agent_automation_settings
for select
using (auth.uid() = user_id);

-- Les insert/update passent par l'API serveur avec supabaseAdmin.
-- Les 4 automatisations attendues sont : publish, grow, loyalty, stats.


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
  if p_global is null or jsonb_typeof(p_global) <> 'object' then
    raise exception 'p_global must be a JSON object';
  end if;
  if p_automations is null or jsonb_typeof(p_automations) <> 'array' then
    raise exception 'p_automations must be a JSON array';
  end if;

  v_user_id := nullif(p_global ->> 'user_id', '')::uuid;
  if v_user_id is null then
    raise exception 'user_id is required';
  end if;

  insert into public.inr_agent_settings (
    user_id, global_enabled, tone, timezone, metadata, updated_at
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
    user_id, automation_key, enabled, frequency, day_of_week, time,
    validation_mode, allowed_channels, allowed_themes, use_image_bank,
    image_required, recipient_scope, source_strategy, last_prepared_at,
    last_executed_at, next_run_at, metadata, updated_at
  )
  select
    v_user_id,
    source.automation_key,
    source.enabled,
    source.frequency,
    source.day_of_week,
    source.time,
    case
      when source.automation_key = 'publish' then 'notify_before_validation'
      else source.validation_mode
    end,
    coalesce(source.allowed_channels, array[]::text[]),
    coalesce(source.allowed_themes, array[]::text[]),
    source.use_image_bank,
    source.image_required,
    source.recipient_scope,
    source.source_strategy,
    source.last_prepared_at,
    source.last_executed_at,
    source.next_run_at,
    coalesce(source.metadata, '{}'::jsonb),
    coalesce(source.updated_at, now())
  from jsonb_populate_recordset(
    null::public.inr_agent_automation_settings,
    p_automations
  ) as source
  where source.user_id = v_user_id
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
