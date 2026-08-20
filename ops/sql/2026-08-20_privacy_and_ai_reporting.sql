-- iNrCy - demandes publiques de suppression et signalements de contenus IA
-- A exécuter une seule fois dans l'éditeur SQL Supabase.

create table if not exists public.privacy_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  request_type text not null check (request_type in ('account', 'partial')),
  email text not null,
  full_name text,
  account_reference text,
  details text,
  status text not null default 'pending_verification',
  source text not null default 'public_web_form',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists privacy_deletion_requests_status_created_idx
  on public.privacy_deletion_requests (status, created_at desc);

alter table public.privacy_deletion_requests enable row level security;

-- Aucune policy publique : les écritures passent exclusivement par l'API serveur
-- et la clé service_role. Les demandes ne sont jamais lisibles depuis le navigateur.

create table if not exists public.ai_content_reports (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid,
  active_user_id uuid,
  reporter_email text,
  surface text not null,
  reason text not null,
  comment text,
  content_excerpt text,
  source_url text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_content_reports_status_created_idx
  on public.ai_content_reports (status, created_at desc);

create index if not exists ai_content_reports_auth_user_idx
  on public.ai_content_reports (auth_user_id, created_at desc);

alter table public.ai_content_reports enable row level security;

-- Même principe : insertion et consultation uniquement côté serveur.
