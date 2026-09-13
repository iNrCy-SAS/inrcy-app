begin;

alter table public.visio_booking_internal_alert_outbox
  drop constraint if exists visio_booking_internal_alert_outbox_status_check;
alter table public.visio_booking_internal_alert_outbox
  add constraint visio_booking_internal_alert_outbox_status_check
  check (status in ('awaiting_google', 'pending', 'processing', 'retry_wait', 'accepted', 'dead'));

create or replace function public.visio_booking_internal_alert_touch_updated_at()
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

revoke all on function public.visio_booking_internal_alert_touch_updated_at()
from public, anon, authenticated;
grant execute on function public.visio_booking_internal_alert_touch_updated_at()
to service_role;

drop trigger if exists visio_booking_internal_alert_outbox_touch_updated_at
on public.visio_booking_internal_alert_outbox;
create trigger visio_booking_internal_alert_outbox_touch_updated_at
before update on public.visio_booking_internal_alert_outbox
for each row execute function public.visio_booking_internal_alert_touch_updated_at();

create or replace function public.claim_visio_booking_internal_alerts(
  p_limit integer default 10,
  p_lock_token uuid default gen_random_uuid(),
  p_google_event_id text default null,
  p_lease_seconds integer default 300
)
returns setof public.visio_booking_internal_alert_outbox
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  with candidates as (
    select queued.id
    from public.visio_booking_internal_alert_outbox as queued
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
  update public.visio_booking_internal_alert_outbox as queued
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

revoke all on function public.claim_visio_booking_internal_alerts(integer, uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.claim_visio_booking_internal_alerts(integer, uuid, text, integer)
to service_role;

commit;
