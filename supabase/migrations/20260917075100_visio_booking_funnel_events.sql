create table if not exists public.visio_booking_funnel_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  prospect_user_id uuid not null,
  event_name text not null check (
    event_name in (
      'modal_viewed',
      'booking_started',
      'availability_loaded',
      'slot_selected',
      'booking_submitted',
      'booking_completed',
      'modal_skipped',
      'modal_closed',
      'availability_failed',
      'booking_failed'
    )
  ),
  source text not null default 'wordpress_signup',
  session_id uuid,
  step smallint check (step between 1 and 3),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists visio_booking_funnel_events_prospect_time_idx
  on public.visio_booking_funnel_events (prospect_user_id, occurred_at desc);

create index if not exists visio_booking_funnel_events_name_time_idx
  on public.visio_booking_funnel_events (event_name, occurred_at desc);

alter table public.visio_booking_funnel_events enable row level security;

revoke all on table public.visio_booking_funnel_events from public, anon, authenticated;
grant select, insert, update, delete on table public.visio_booking_funnel_events to service_role;
