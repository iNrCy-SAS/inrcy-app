-- iNrCy - attribution des inscriptions et état de la Conversions API Meta.
-- Idempotent : à exécuter une fois dans l'éditeur SQL Supabase avant le déploiement.

create table if not exists public.signup_attributions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  form_source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  placement text,
  site_source_name text,
  landing_page_url text,
  event_source_url text,
  referrer_url text,
  event_id text not null,
  attribution_captured_at timestamptz,
  marketing_consent boolean not null default false,
  capi_status text not null default 'skipped'
    check (capi_status in ('sent', 'failed', 'skipped')),
  capi_events_received integer,
  capi_fbtrace_id text,
  capi_error text,
  capi_test_event_code_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists signup_attributions_event_id_unique
  on public.signup_attributions (event_id)
  where event_id <> '';

create index if not exists signup_attributions_campaign_idx
  on public.signup_attributions (utm_source, utm_campaign, ad_id, created_at desc);

alter table public.signup_attributions enable row level security;
revoke all on table public.signup_attributions from anon, authenticated;
grant all on table public.signup_attributions to service_role;

comment on table public.signup_attributions is
  'Attribution first-party des inscriptions iNrCy et état technique des événements Lead Meta CAPI.';

comment on column public.signup_attributions.marketing_consent is
  'Vrai uniquement lorsque le consentement marketing Complianz était actif au moment de l’inscription.';
