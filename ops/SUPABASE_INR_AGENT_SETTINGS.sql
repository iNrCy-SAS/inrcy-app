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
  validation_mode text not null default 'validation_required',
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
  constraint inr_agent_validation_mode_check check (validation_mode in ('validation_required', 'draft_only', 'notify_before_validation', 'automatic_report')),
  constraint inr_agent_recipient_scope_check check (recipient_scope in ('none', 'all_crm', 'clients', 'prospects', 'recent_contacts', 'inactive_contacts', 'manual_selection')),
  constraint inr_agent_source_strategy_check check (source_strategy in ('published_history', 'templates', 'stats_snapshot', 'mixed'))
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
