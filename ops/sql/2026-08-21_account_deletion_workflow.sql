-- iNrCy - suppression autonome du compte à la fin de l'accès
-- À exécuter une seule fois dans l'éditeur SQL Supabase.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mode text not null check (mode in ('end_of_access', 'immediate')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'completed', 'cancelled', 'failed')),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  billing_provider text,
  subscription_cancellation_managed boolean not null default false,
  last_error text,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_requests_user_unique unique (user_id),
  constraint account_deletion_requests_provider_check check (
    billing_provider is null or billing_provider in ('stripe', 'app_store', 'play_store', 'manual', 'none')
  )
);

create index if not exists account_deletion_requests_due_idx
  on public.account_deletion_requests (status, scheduled_for);

alter table public.account_deletion_requests enable row level security;

-- Les demandes sont lues et modifiées uniquement par les routes serveur
-- utilisant la clé service_role. Aucune policy navigateur n'est nécessaire.

