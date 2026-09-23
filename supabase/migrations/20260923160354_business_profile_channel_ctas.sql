-- Per-channel CTA preferences for Booster Publier and iNr'Agent.
-- Keep legacy preferred_cta untouched for backward compatibility.
alter table public.business_profiles
  add column if not exists ai_channel_ctas jsonb not null default '{}'::jsonb;

comment on column public.business_profiles.ai_channel_ctas is
  'Explicit per-channel CTA choices; empty object means no configured CTA.';
