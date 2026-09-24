-- iNr'ADS: les écritures passent uniquement par les routes serveur Premium.
create table if not exists public.ads_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  provider text not null check (provider in ('meta', 'google')),
  ad_account_id text not null,
  currency text not null default 'EUR' check (currency = 'EUR'),
  name text not null,
  daily_budget_cents integer not null check (daily_budget_cents between 500 and 50000),
  end_date date not null,
  draft jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'publishing', 'active', 'needs_review')),
  provider_resources jsonb not null default '{}'::jsonb,
  last_error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ads_campaigns_user_created_idx
  on public.ads_campaigns (user_id, created_at desc);

alter table public.ads_campaigns enable row level security;
revoke all on public.ads_campaigns from anon, authenticated;
grant select, insert, update on public.ads_campaigns to service_role;

comment on table public.ads_campaigns is 'Brouillons et journaux de publication iNr’ADS, jamais accessibles directement au navigateur.';
