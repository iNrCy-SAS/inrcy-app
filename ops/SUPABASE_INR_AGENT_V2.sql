-- iNr'Agent V2 - script complet : réglages + actions
-- Tu peux exécuter ce fichier entier dans Supabase SQL Editor.

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

-- iNr'Agent V2 - actions préparées, validées, refusées ou exécutées
-- À exécuter dans Supabase SQL Editor.
-- Migration compatible avec l'ancienne table inr_agent_actions.

create extension if not exists pgcrypto;

create table if not exists public.inr_agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  automation_key text,
  action_type text not null default 'custom',
  target_tool text not null default 'agent',
  title text not null,
  summary text,
  preview_text text,
  target_channels text[] not null default array[]::text[],
  target_themes text[] not null default array[]::text[],
  recipients jsonb not null default '[]'::jsonb,
  image_assets jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  validation_required boolean not null default true,
  execution_policy text not null default 'manual_validation',
  status text not null default 'pending_validation',
  scheduled_for timestamptz,
  prepared_at timestamptz not null default now(),
  validated_at timestamptz,
  refused_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Colonnes V2 ajoutées si la table existait déjà en V1.
alter table public.inr_agent_actions add column if not exists automation_key text;
alter table public.inr_agent_actions add column if not exists target_themes text[] not null default array[]::text[];
alter table public.inr_agent_actions add column if not exists recipients jsonb not null default '[]'::jsonb;
alter table public.inr_agent_actions add column if not exists image_assets jsonb not null default '[]'::jsonb;
alter table public.inr_agent_actions add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.inr_agent_actions add column if not exists validation_required boolean not null default true;
alter table public.inr_agent_actions add column if not exists execution_policy text not null default 'manual_validation';
alter table public.inr_agent_actions add column if not exists prepared_at timestamptz not null default now();
alter table public.inr_agent_actions add column if not exists validated_at timestamptz;
alter table public.inr_agent_actions add column if not exists refused_at timestamptz;
alter table public.inr_agent_actions add column if not exists completed_at timestamptz;
alter table public.inr_agent_actions add column if not exists last_error text;
alter table public.inr_agent_actions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.inr_agent_actions add column if not exists created_at timestamptz not null default now();
alter table public.inr_agent_actions add column if not exists updated_at timestamptz not null default now();

-- Si V1 utilisait metadata pour stocker l'aperçu métier, on garde metadata et on initialise payload.
update public.inr_agent_actions
set payload = metadata
where payload = '{}'::jsonb
  and metadata is not null
  and metadata <> '{}'::jsonb;

-- Remplacement des anciens checks pour accepter la V2.
alter table public.inr_agent_actions drop constraint if exists inr_agent_actions_action_type_check;
alter table public.inr_agent_actions drop constraint if exists inr_agent_actions_target_tool_check;
alter table public.inr_agent_actions drop constraint if exists inr_agent_actions_status_check;
alter table public.inr_agent_actions drop constraint if exists inr_agent_actions_automation_key_check;
alter table public.inr_agent_actions drop constraint if exists inr_agent_actions_execution_policy_check;

alter table public.inr_agent_actions
  add constraint inr_agent_actions_action_type_check
  check (action_type in ('publication', 'campaign', 'stats_report', 'mailing', 'review_request', 'loyalty', 'custom'));

alter table public.inr_agent_actions
  add constraint inr_agent_actions_target_tool_check
  check (target_tool in ('booster', 'mails', 'propulser', 'fideliser', 'inrstats', 'agent'));

alter table public.inr_agent_actions
  add constraint inr_agent_actions_status_check
  check (status in ('prepared', 'pending_validation', 'pending', 'draft', 'scheduled', 'validated', 'refused', 'executing', 'completed', 'failed', 'cancelled'));

alter table public.inr_agent_actions
  add constraint inr_agent_actions_automation_key_check
  check (automation_key is null or automation_key in ('publish', 'grow', 'loyalty', 'stats'));

alter table public.inr_agent_actions
  add constraint inr_agent_actions_execution_policy_check
  check (execution_policy in ('manual_validation', 'draft_only', 'automatic_after_settings', 'report_only'));

create index if not exists idx_inr_agent_actions_user_status
on public.inr_agent_actions (user_id, status, created_at desc);

create index if not exists idx_inr_agent_actions_user_created
on public.inr_agent_actions (user_id, created_at desc);

create index if not exists idx_inr_agent_actions_user_automation
on public.inr_agent_actions (user_id, automation_key, status, created_at desc);

create index if not exists idx_inr_agent_actions_scheduled
on public.inr_agent_actions (scheduled_for, status)
where status in ('scheduled', 'validated');

alter table public.inr_agent_actions enable row level security;

drop policy if exists "Users can read own inr agent actions" on public.inr_agent_actions;
create policy "Users can read own inr agent actions"
on public.inr_agent_actions
for select
using (auth.uid() = user_id);

-- Les insert/update/delete passent par l'API serveur avec supabaseAdmin.
-- payload contiendra les données exécutables : postByChannel, image, campaign, recipients, pdfReport, etc.

-- Exemple de test à adapter avec un user_id réel :
-- insert into public.inr_agent_actions (
--   user_id, automation_key, action_type, target_tool, title, summary, preview_text,
--   target_channels, target_themes, payload, validation_required, execution_policy, status
-- ) values (
--   '00000000-0000-0000-0000-000000000000',
--   'publish', 'publication', 'booster', 'Publication de la semaine',
--   'Aperçu prêt pour Facebook, Instagram, Google Business et Site iNrCy.',
--   'Cette semaine, mettez en avant une réalisation récente et invitez vos clients à vous contacter.',
--   array['facebook', 'instagram', 'gmb', 'site_inrcy'], array['conseils'],
--   '{"postByChannel": {}}'::jsonb, true, 'manual_validation', 'pending_validation'
-- );
