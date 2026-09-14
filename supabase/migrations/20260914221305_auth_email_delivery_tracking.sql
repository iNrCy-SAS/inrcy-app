begin;

-- Delivery ledger for Supabase Auth emails sent through Resend. The raw Auth
-- hook payload is deliberately never persisted because it contains OTPs and
-- token hashes. Access is restricted to the service role used by server routes.
create table if not exists public.auth_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_key text not null unique,
  supabase_hook_id text not null,
  message_sequence smallint not null default 0,
  user_id uuid not null,
  recipient_email text not null,
  action_type text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status text not null default 'pending',
  status_rank smallint not null default 0,
  send_attempt_count smallint not null default 0,
  last_send_attempt_at timestamptz,
  accepted_at timestamptz,
  sent_at timestamptz,
  delayed_at timestamptz,
  acceptance_uncertain_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  bounced_at timestamptz,
  suppressed_at timestamptz,
  complained_at timestamptz,
  last_provider_event_at timestamptz,
  last_error_code text,
  last_error_message text,
  alert_status text not null default 'none',
  alert_attempt_count smallint not null default 0,
  alert_max_attempts smallint not null default 6,
  alert_next_attempt_at timestamptz,
  alert_lock_token uuid,
  alert_locked_at timestamptz,
  alert_lock_expires_at timestamptz,
  alert_provider_message_id text,
  alert_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_email_deliveries_key_check
    check (delivery_key ~ '^v1:[0-9a-f]{64}$'),
  constraint auth_email_deliveries_hook_id_check
    check (length(supabase_hook_id) between 1 and 256),
  constraint auth_email_deliveries_sequence_check
    check (message_sequence between 0 and 2),
  constraint auth_email_deliveries_recipient_check
    check (recipient_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint auth_email_deliveries_action_check
    check (action_type in (
      'signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email',
      'reauthentication', 'password_changed_notification',
      'email_changed_notification', 'phone_changed_notification',
      'identity_linked_notification', 'identity_unlinked_notification',
      'mfa_factor_enrolled_notification', 'mfa_factor_unenrolled_notification'
    )),
  constraint auth_email_deliveries_status_check
    check (status in (
      'pending', 'accepted', 'sent', 'delayed', 'acceptance_uncertain', 'delivered',
      'failed', 'bounced', 'suppressed', 'complained'
    )),
  constraint auth_email_deliveries_rank_check
    check (status_rank between 0 and 100),
  constraint auth_email_deliveries_send_attempt_check
    check (send_attempt_count between 0 and 20),
  constraint auth_email_deliveries_alert_status_check
    check (alert_status in ('none', 'pending', 'processing', 'retry_wait', 'sent', 'dead')),
  constraint auth_email_deliveries_alert_attempt_check
    check (
      alert_attempt_count between 0 and alert_max_attempts
      and alert_max_attempts between 1 and 12
    )
);

create unique index if not exists auth_email_deliveries_provider_message_idx
on public.auth_email_deliveries (provider_message_id)
where provider_message_id is not null;

create index if not exists auth_email_deliveries_alert_due_idx
on public.auth_email_deliveries (alert_next_attempt_at, id)
where alert_status in ('pending', 'retry_wait');

create index if not exists auth_email_deliveries_alert_lease_idx
on public.auth_email_deliveries (alert_lock_expires_at, id)
where alert_status = 'processing';

create table if not exists public.auth_email_provider_events (
  svix_id text primary key,
  delivery_id uuid references public.auth_email_deliveries(id) on delete set null,
  provider_message_id text not null,
  event_type text not null,
  event_created_at timestamptz not null,
  result text not null default 'received',
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint auth_email_provider_events_svix_id_check
    check (length(svix_id) between 1 and 256),
  constraint auth_email_provider_events_type_check
    check (event_type in (
      'email.sent', 'email.delivered', 'email.delivery_delayed',
      'email.failed', 'email.bounced', 'email.suppressed', 'email.complained'
    )),
  constraint auth_email_provider_events_result_check
    check (result in ('received', 'processed', 'duplicate', 'unmatched'))
);

create index if not exists auth_email_provider_events_delivery_idx
on public.auth_email_provider_events (delivery_id, event_created_at desc);

alter table public.auth_email_deliveries enable row level security;
alter table public.auth_email_provider_events enable row level security;
revoke all on public.auth_email_deliveries from public, anon, authenticated;
revoke all on public.auth_email_provider_events from public, anon, authenticated;
grant select, insert, update, delete on public.auth_email_deliveries to service_role;
grant select, insert, update, delete on public.auth_email_provider_events to service_role;

create or replace function public.auth_email_touch_updated_at()
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

revoke all on function public.auth_email_touch_updated_at()
from public, anon, authenticated;
grant execute on function public.auth_email_touch_updated_at() to service_role;

drop trigger if exists auth_email_deliveries_touch_updated_at
on public.auth_email_deliveries;
create trigger auth_email_deliveries_touch_updated_at
before update on public.auth_email_deliveries
for each row execute function public.auth_email_touch_updated_at();

-- A stable webhook id plus recipient/sequence produces one durable delivery.
-- Replays increment the attempt counter but never create a second row.
create or replace function public.reserve_auth_email_delivery(
  p_delivery_key text,
  p_supabase_hook_id text,
  p_message_sequence smallint,
  p_user_id uuid,
  p_recipient_email text,
  p_action_type text
)
returns setof public.auth_email_deliveries
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
begin
  return query
  insert into public.auth_email_deliveries (
    delivery_key,
    supabase_hook_id,
    message_sequence,
    user_id,
    recipient_email,
    action_type,
    send_attempt_count,
    last_send_attempt_at
  ) values (
    p_delivery_key,
    p_supabase_hook_id,
    p_message_sequence,
    p_user_id,
    lower(p_recipient_email),
    p_action_type,
    1,
    now()
  )
  on conflict (delivery_key) do update
  set send_attempt_count = least(public.auth_email_deliveries.send_attempt_count + 1, 20),
      last_send_attempt_at = now(),
      updated_at = now()
  returning *;
end;
$$;

revoke all on function public.reserve_auth_email_delivery(text, text, smallint, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.reserve_auth_email_delivery(text, text, smallint, uuid, text, text)
to service_role;

create or replace function public.accept_auth_email_delivery(
  p_delivery_key text,
  p_provider_message_id text
)
returns setof public.auth_email_deliveries
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  update public.auth_email_deliveries as delivery
  set provider_message_id = coalesce(delivery.provider_message_id, nullif(p_provider_message_id, '')),
      status = case when delivery.status_rank < 10 then 'accepted' else delivery.status end,
      status_rank = greatest(delivery.status_rank, 10),
      accepted_at = coalesce(delivery.accepted_at, now()),
      last_error_code = case
        when delivery.status_rank < 50 then null
        else delivery.last_error_code
      end,
      last_error_message = case
        when delivery.status_rank < 50 then null
        else delivery.last_error_message
      end,
      updated_at = now()
  where delivery.delivery_key = p_delivery_key
  returning delivery.*;
$$;

revoke all on function public.accept_auth_email_delivery(text, text)
from public, anon, authenticated;
grant execute on function public.accept_auth_email_delivery(text, text) to service_role;

-- A transport timeout or network interruption cannot prove whether Resend
-- accepted the request. Once application retries are exhausted, stop sending
-- to the professional but retain a recoverable rank: later sent, delayed or
-- delivered events (ranks 20+) can still establish the authoritative outcome.
create or replace function public.mark_auth_email_delivery_acceptance_uncertain(
  p_delivery_key text,
  p_error_code text,
  p_error_message text
)
returns setof public.auth_email_deliveries
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  update public.auth_email_deliveries as delivery
  set status = case
        when delivery.status_rank < 20 then 'acceptance_uncertain'
        else delivery.status
      end,
      status_rank = case
        when delivery.status_rank < 20 then greatest(delivery.status_rank, 15)
        else delivery.status_rank
      end,
      acceptance_uncertain_at = case
        when delivery.status_rank < 20 then coalesce(delivery.acceptance_uncertain_at, now())
        else delivery.acceptance_uncertain_at
      end,
      last_error_code = case
        when delivery.status_rank < 20 then left(nullif(p_error_code, ''), 120)
        else delivery.last_error_code
      end,
      last_error_message = case
        when delivery.status_rank < 20 then left(nullif(p_error_message, ''), 500)
        else delivery.last_error_message
      end,
      alert_status = case
        when delivery.status_rank < 20 and delivery.alert_status = 'none' then 'pending'
        else delivery.alert_status
      end,
      alert_next_attempt_at = case
        -- Give Resend's provider webhook a short reconciliation window before
        -- notifying the administrator about an uncertain API response.
        when delivery.status_rank < 20 and delivery.alert_status = 'none'
          then now() + interval '5 minutes'
        else delivery.alert_next_attempt_at
      end,
      updated_at = now()
  where delivery.delivery_key = p_delivery_key
  returning delivery.*;
$$;

revoke all on function public.mark_auth_email_delivery_acceptance_uncertain(text, text, text)
from public, anon, authenticated;
grant execute on function public.mark_auth_email_delivery_acceptance_uncertain(text, text, text)
to service_role;

create or replace function public.fail_auth_email_delivery(
  p_delivery_key text,
  p_error_code text,
  p_error_message text
)
returns setof public.auth_email_deliveries
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  update public.auth_email_deliveries as delivery
  set status = case when delivery.status_rank < 50 then 'failed' else delivery.status end,
      status_rank = case when delivery.status_rank < 50 then 70 else delivery.status_rank end,
      failed_at = case when delivery.status_rank < 50 then coalesce(delivery.failed_at, now()) else delivery.failed_at end,
      last_error_code = left(nullif(p_error_code, ''), 120),
      last_error_message = left(nullif(p_error_message, ''), 500),
      alert_status = case
        when delivery.status_rank < 50 and delivery.alert_status = 'none' then 'pending'
        else delivery.alert_status
      end,
      alert_next_attempt_at = case
        when delivery.status_rank < 50 and delivery.alert_status = 'none' then now()
        else delivery.alert_next_attempt_at
      end,
      updated_at = now()
  where delivery.delivery_key = p_delivery_key
  returning delivery.*;
$$;

revoke all on function public.fail_auth_email_delivery(text, text, text)
from public, anon, authenticated;
grant execute on function public.fail_auth_email_delivery(text, text, text) to service_role;

-- Provider events are inserted and applied in one transaction. svix_id makes
-- the at-least-once Resend webhook idempotent. Monotonic ranks prevent an old
-- `email.sent` event from overwriting `delivered` or a terminal failure.
create or replace function public.record_auth_email_provider_event(
  p_svix_id text,
  p_provider_message_id text,
  p_delivery_key text,
  p_event_type text,
  p_event_created_at timestamptz,
  p_status text,
  p_status_rank smallint,
  p_error_code text default null,
  p_error_message text default null
)
returns table (
  delivery_id uuid,
  delivery_status text,
  alert_status text,
  event_result text
)
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  v_delivery public.auth_email_deliveries%rowtype;
  v_inserted_count integer := 0;
begin
  insert into public.auth_email_provider_events (
    svix_id,
    provider_message_id,
    event_type,
    event_created_at
  ) values (
    p_svix_id,
    p_provider_message_id,
    p_event_type,
    p_event_created_at
  )
  on conflict (svix_id) do nothing;
  get diagnostics v_inserted_count = row_count;

  select delivery.* into v_delivery
  from public.auth_email_deliveries as delivery
  where delivery.provider_message_id = p_provider_message_id
     or (p_delivery_key is not null and delivery.delivery_key = p_delivery_key)
  order by (delivery.provider_message_id = p_provider_message_id) desc
  limit 1;

  if not found then
    if v_inserted_count > 0 then
      update public.auth_email_provider_events
      set result = 'unmatched', processed_at = now()
      where svix_id = p_svix_id;
    end if;
    return query select null::uuid, null::text, null::text,
      case when v_inserted_count > 0 then 'unmatched'::text else 'duplicate'::text end;
    return;
  end if;

  if v_inserted_count = 0 then
    return query select v_delivery.id, v_delivery.status, v_delivery.alert_status, 'duplicate'::text;
    return;
  end if;

  update public.auth_email_provider_events
  set delivery_id = v_delivery.id,
      result = 'processed',
      processed_at = now()
  where svix_id = p_svix_id;

  update public.auth_email_deliveries as delivery
  set provider_message_id = coalesce(delivery.provider_message_id, p_provider_message_id),
      status = case when p_status_rank >= delivery.status_rank then p_status else delivery.status end,
      status_rank = greatest(delivery.status_rank, p_status_rank),
      sent_at = case when p_status = 'sent' then coalesce(delivery.sent_at, p_event_created_at) else delivery.sent_at end,
      delayed_at = case when p_status = 'delayed' then coalesce(delivery.delayed_at, p_event_created_at) else delivery.delayed_at end,
      delivered_at = case when p_status = 'delivered' then coalesce(delivery.delivered_at, p_event_created_at) else delivery.delivered_at end,
      failed_at = case when p_status = 'failed' then coalesce(delivery.failed_at, p_event_created_at) else delivery.failed_at end,
      bounced_at = case when p_status = 'bounced' then coalesce(delivery.bounced_at, p_event_created_at) else delivery.bounced_at end,
      suppressed_at = case when p_status = 'suppressed' then coalesce(delivery.suppressed_at, p_event_created_at) else delivery.suppressed_at end,
      complained_at = case when p_status = 'complained' then coalesce(delivery.complained_at, p_event_created_at) else delivery.complained_at end,
      last_provider_event_at = greatest(
        coalesce(delivery.last_provider_event_at, '-infinity'::timestamptz),
        p_event_created_at
      ),
      last_error_code = case
        when p_status_rank >= delivery.status_rank then left(nullif(p_error_code, ''), 120)
        else delivery.last_error_code
      end,
      last_error_message = case
        when p_status_rank >= delivery.status_rank then left(nullif(p_error_message, ''), 500)
        else delivery.last_error_message
      end,
      alert_status = case
        when delivery.status = 'acceptance_uncertain'
          and p_status in ('sent', 'delayed', 'delivered')
          and delivery.alert_status in ('pending', 'retry_wait') then 'none'
        when p_status in ('failed', 'bounced', 'suppressed', 'complained')
          and delivery.alert_status = 'none' then 'pending'
        else delivery.alert_status
      end,
      alert_next_attempt_at = case
        when delivery.status = 'acceptance_uncertain'
          and p_status in ('sent', 'delayed', 'delivered')
          and delivery.alert_status in ('pending', 'retry_wait') then null
        when p_status in ('failed', 'bounced', 'suppressed', 'complained')
          and delivery.alert_status = 'none' then now()
        else delivery.alert_next_attempt_at
      end,
      updated_at = now()
  where delivery.id = v_delivery.id
  returning delivery.* into v_delivery;

  return query select v_delivery.id, v_delivery.status, v_delivery.alert_status, 'processed'::text;
end;
$$;

revoke all on function public.record_auth_email_provider_event(text, text, text, text, timestamptz, text, smallint, text, text)
from public, anon, authenticated;
grant execute on function public.record_auth_email_provider_event(text, text, text, text, timestamptz, text, smallint, text, text)
to service_role;

create or replace function public.claim_auth_email_delivery_alerts(
  p_delivery_id uuid default null,
  p_limit integer default 1,
  p_lock_token uuid default gen_random_uuid(),
  p_lease_seconds integer default 120
)
returns setof public.auth_email_deliveries
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
begin
  -- A worker can stop after reserving a delivery (process crash, platform
  -- timeout, or a lost persistence response). Never retry the professional
  -- from this maintenance path: promote stale pending work to an observable,
  -- recoverable uncertainty that provider webhooks may still resolve.
  update public.auth_email_deliveries as delivery
  set status = 'acceptance_uncertain',
      status_rank = greatest(delivery.status_rank, 15),
      acceptance_uncertain_at = coalesce(delivery.acceptance_uncertain_at, now()),
      last_error_code = coalesce(delivery.last_error_code, 'auth_mail_pending_stale'),
      last_error_message = coalesce(
        delivery.last_error_message,
        'Authentication email reservation remained pending beyond the delivery window'
      ),
      alert_status = 'pending',
      alert_next_attempt_at = now(),
      alert_lock_token = null,
      alert_locked_at = null,
      alert_lock_expires_at = null,
      updated_at = now()
  where delivery.status = 'pending'
    and delivery.status_rank < 20
    and coalesce(delivery.last_send_attempt_at, delivery.updated_at) <= now() - interval '10 minutes'
    and (p_delivery_id is null or delivery.id = p_delivery_id);

  return query
  with cleared_positive as (
    -- A positive provider state no longer needs an internal warning. Pending
    -- alerts are cancelled immediately; an abandoned processing lease is
    -- cleared once it expires.
    update public.auth_email_deliveries as delivery
    set alert_status = 'none',
        alert_next_attempt_at = null,
        alert_lock_token = null,
        alert_locked_at = null,
        alert_lock_expires_at = null,
        updated_at = now()
    where delivery.status in ('accepted', 'sent', 'delayed', 'delivered')
      and (
        delivery.alert_status in ('pending', 'retry_wait')
        or (
          delivery.alert_status = 'processing'
          and coalesce(delivery.alert_lock_expires_at, delivery.alert_locked_at, delivery.updated_at) <= now()
        )
      )
    returning delivery.id
  ),
  exhausted_leases as (
    -- If the last alert worker died while owning its lease, close the outbox
    -- item instead of leaving it processing forever.
    update public.auth_email_deliveries as delivery
    set alert_status = 'dead',
        alert_next_attempt_at = null,
        alert_lock_token = null,
        alert_locked_at = null,
        alert_lock_expires_at = null,
        updated_at = now()
    where delivery.status in ('acceptance_uncertain', 'failed', 'bounced', 'suppressed', 'complained')
      and delivery.alert_status = 'processing'
      and delivery.alert_attempt_count >= delivery.alert_max_attempts
      and coalesce(delivery.alert_lock_expires_at, delivery.alert_locked_at, delivery.updated_at) <= now()
    returning delivery.id
  ),
  candidates as (
    select delivery.id
    from public.auth_email_deliveries as delivery
    where (p_delivery_id is null or delivery.id = p_delivery_id)
      and delivery.status in ('acceptance_uncertain', 'failed', 'bounced', 'suppressed', 'complained')
      and delivery.alert_attempt_count < delivery.alert_max_attempts
      and (
        (
          delivery.alert_status in ('pending', 'retry_wait')
          and coalesce(delivery.alert_next_attempt_at, delivery.updated_at) <= now()
        )
        or (
          delivery.alert_status = 'processing'
          and coalesce(delivery.alert_lock_expires_at, delivery.alert_locked_at, delivery.updated_at) <= now()
        )
      )
    order by coalesce(delivery.alert_next_attempt_at, delivery.updated_at), delivery.id
    for update skip locked
    limit least(greatest(coalesce(p_limit, 1), 1), 10)
  )
  update public.auth_email_deliveries as delivery
  set alert_status = 'processing',
      -- A reclaimed expired lease is a new attempt too. Counting it prevents
      -- permanently failing workers from cycling forever below max attempts.
      alert_attempt_count = least(
        delivery.alert_attempt_count + 1,
        delivery.alert_max_attempts
      ),
      alert_lock_token = coalesce(p_lock_token, gen_random_uuid()),
      alert_locked_at = now(),
      alert_lock_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 300)
      ),
      updated_at = now()
  from candidates
  where delivery.id = candidates.id
  returning delivery.*;
end;
$$;

revoke all on function public.claim_auth_email_delivery_alerts(uuid, integer, uuid, integer)
from public, anon, authenticated;
grant execute on function public.claim_auth_email_delivery_alerts(uuid, integer, uuid, integer)
to service_role;

commit;
