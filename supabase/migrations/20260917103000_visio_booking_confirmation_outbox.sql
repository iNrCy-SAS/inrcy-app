begin;

-- Confirmation premium destinée au professionnel. Elle est distincte de
-- l'invitation Google Agenda et n'est envoyée qu'après création du lien Meet.
create table if not exists public.visio_booking_confirmation_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  google_event_id text not null,
  prospect_user_id uuid not null,
  recipient_email text not null,
  prospect_name text not null,
  company text not null default '',
  assigned_member_id text not null default '',
  assigned_member_name text not null,
  date_label text not null,
  time_label text not null,
  meet_url text not null default '',
  calendar_url text not null default '',
  subject text not null default '',
  body_text text not null default '',
  body_html text not null default '',
  status text not null default 'awaiting_google',
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 12,
  next_attempt_at timestamptz,
  lock_token uuid,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  provider_message_id text,
  accepted_recipients text[] not null default '{}',
  rejected_recipients text[] not null default '{}',
  accepted_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visio_booking_confirmation_outbox_dedupe_check
    check (dedupe_key ~ '^v1:[0-9a-f]{64}$'),
  constraint visio_booking_confirmation_outbox_status_check
    check (status in ('awaiting_google', 'pending', 'processing', 'retry_wait', 'accepted', 'dead')),
  constraint visio_booking_confirmation_outbox_attempt_check
    check (attempt_count between 0 and max_attempts and max_attempts between 1 and 50),
  constraint visio_booking_confirmation_outbox_recipient_check
    check (recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

comment on table public.visio_booking_confirmation_outbox is
  'Livraison idempotente et relançable des confirmations premium de rendez-vous visio.';

create index if not exists visio_booking_confirmation_outbox_due_idx
on public.visio_booking_confirmation_outbox (next_attempt_at, id)
where status in ('pending', 'retry_wait');

create index if not exists visio_booking_confirmation_outbox_lease_idx
on public.visio_booking_confirmation_outbox (lock_expires_at, id)
where status = 'processing';

create index if not exists visio_booking_confirmation_outbox_event_idx
on public.visio_booking_confirmation_outbox (google_event_id, created_at desc);

create or replace function public.visio_booking_confirmation_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.visio_booking_confirmation_touch_updated_at()
from public, anon, authenticated;
grant execute on function public.visio_booking_confirmation_touch_updated_at()
to service_role;

drop trigger if exists visio_booking_confirmation_outbox_touch_updated_at
on public.visio_booking_confirmation_outbox;
create trigger visio_booking_confirmation_outbox_touch_updated_at
before update on public.visio_booking_confirmation_outbox
for each row execute function public.visio_booking_confirmation_touch_updated_at();

alter table public.visio_booking_confirmation_outbox enable row level security;
revoke all on public.visio_booking_confirmation_outbox from public, anon, authenticated;
grant select, insert, update, delete on public.visio_booking_confirmation_outbox
to service_role;

create or replace function public.claim_visio_booking_confirmations(
  p_limit integer default 10,
  p_lock_token uuid default gen_random_uuid(),
  p_google_event_id text default null,
  p_lease_seconds integer default 300
)
returns setof public.visio_booking_confirmation_outbox
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  with candidates as (
    select queued.id
    from public.visio_booking_confirmation_outbox as queued
    where (p_google_event_id is null or queued.google_event_id = p_google_event_id)
      and (
        (
          queued.status in ('pending', 'retry_wait')
          and queued.attempt_count < queued.max_attempts
          and coalesce(queued.next_attempt_at, queued.created_at) <= now()
        )
        or (
          queued.status = 'processing'
          and coalesce(queued.lock_expires_at, queued.locked_at, queued.created_at) <= now()
        )
      )
    order by coalesce(queued.next_attempt_at, queued.lock_expires_at, queued.created_at), queued.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 25)
  )
  update public.visio_booking_confirmation_outbox as queued
  set status = 'processing',
      attempt_count = case
        when queued.status = 'processing' then queued.attempt_count
        else queued.attempt_count + 1
      end,
      lock_token = coalesce(p_lock_token, gen_random_uuid()),
      locked_at = now(),
      lock_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 300), 30), 900)
      ),
      updated_at = now()
  from candidates
  where queued.id = candidates.id
  returning queued.*;
$$;

revoke all on function public.claim_visio_booking_confirmations(integer, uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.claim_visio_booking_confirmations(integer, uuid, text, integer)
to service_role;

commit;
