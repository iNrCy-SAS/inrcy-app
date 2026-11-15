begin;

-- A new cron notification and its email queue entry commit together. No historical
-- notifications are backfilled: their previous SMTP acceptance is not knowable.
create table if not exists public.notification_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  delivery_key text not null unique,
  group_key text not null,
  notification_ids uuid[] not null,
  status text not null default 'queued' check (status in ('queued','deferred','sending','sent','uncertain','skipped')),
  retry_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_id text,
  reason_code text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_digest_group_key_check check (group_key ~ '^v1:[0-9a-f]{64}$'),
  constraint notification_digest_delivery_key_check check (delivery_key ~ '^v1:[0-9a-f]{64}(:[0-9a-f-]{36})?$'),
  constraint notification_digest_items_check check (cardinality(notification_ids) between 1 and 50),
  constraint notification_digest_lease_check check (status <> 'sending' or (lease_token is not null and lease_expires_at is not null))
);
alter table public.notification_digest_deliveries enable row level security;
revoke all on table public.notification_digest_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_digest_deliveries to service_role;
create index if not exists notification_digest_due_idx on public.notification_digest_deliveries(retry_at, id) where status in ('queued','deferred');
create index if not exists notification_digest_lease_idx on public.notification_digest_deliveries(lease_expires_at) where status = 'sending';
create index if not exists notification_digest_group_idx on public.notification_digest_deliveries(user_id, group_key, created_at desc);

create or replace function public.inrcy_queue_notification_digest()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
declare
  v_group text := new.meta ->> 'digest_delivery_key';
  v_open public.notification_digest_deliveries%rowtype;
  v_key text;
begin
  if v_group is null or v_group !~ '^v1:[0-9a-f]{64}$' then return new; end if;
  -- Authenticated clients cannot turn an arbitrary notification into platform mail.
  -- The canonical notification writer is executable only by service_role.
  if not has_table_privilege(current_user, 'public.notification_digest_deliveries', 'INSERT') then return new; end if;
  if new.category not in ('performance','action','information') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || v_group, 0));
  select * into v_open from public.notification_digest_deliveries
    where user_id = new.user_id and group_key = v_group and status in ('queued','deferred')
      and cardinality(notification_ids) < 50 and expires_at > now()
    order by created_at desc, id desc limit 1 for update;
  if v_open.id is not null then
    update public.notification_digest_deliveries set
      notification_ids = case when new.id = any(notification_ids) then notification_ids else array_append(notification_ids,new.id) end,
      retry_at = greatest(retry_at, now() + interval '1 minute'), updated_at = now()
      where id = v_open.id;
  else
    v_key := v_group;
    if exists(select 1 from public.notification_digest_deliveries where delivery_key = v_key) then
      v_key := v_group || ':' || new.id::text;
    end if;
    insert into public.notification_digest_deliveries(user_id,delivery_key,group_key,notification_ids,retry_at)
      values(new.user_id,v_key,v_group,array[new.id],now() + interval '1 minute');
  end if;
  return new;
end;
$$;
revoke all on function public.inrcy_queue_notification_digest() from public, anon, authenticated;
grant execute on function public.inrcy_queue_notification_digest() to service_role;
drop trigger if exists queue_notification_digest_after_insert on public.notifications;
create trigger queue_notification_digest_after_insert after insert on public.notifications
  for each row execute function public.inrcy_queue_notification_digest();

create or replace function public.inrcy_claim_notification_digest_deliveries(
  p_limit integer default 1,
  p_lease_seconds integer default 180
) returns setof public.notification_digest_deliveries
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  -- SMTP has no cross-process idempotency guarantee. A crashed sending lease
  -- is an unknown outcome and must never be sent automatically a second time.
  update public.notification_digest_deliveries set status='uncertain',reason_code='acceptance_unknown_after_lease',
    last_error_code='DELIVERY_LEASE_EXPIRED',lease_token=null,lease_expires_at=null,updated_at=now()
    where status='sending' and lease_expires_at <= now();
  update public.notification_digest_deliveries set status='skipped',reason_code='expired',
    updated_at=now() where status in ('queued','deferred') and expires_at <= now();
  return query
    with due as (
      select id from public.notification_digest_deliveries
      where status in ('queued','deferred') and retry_at <= now() and expires_at > now()
      order by retry_at,id limit greatest(1,least(coalesce(p_limit,1),20)) for update skip locked
    )
    update public.notification_digest_deliveries d set status='sending',lease_token=gen_random_uuid(),
      lease_expires_at=now() + make_interval(secs=>greatest(120,least(coalesce(p_lease_seconds,180),900))),
      attempt_count=d.attempt_count+1,updated_at=now()
      from due where d.id=due.id returning d.*;
end;
$$;
revoke all on function public.inrcy_claim_notification_digest_deliveries(integer,integer) from public, anon, authenticated;
grant execute on function public.inrcy_claim_notification_digest_deliveries(integer,integer) to service_role;

comment on table public.notification_digest_deliveries is 'Service-only digest queue. Only new marked cron notifications enqueue. Uncertain SMTP outcomes require manual reconciliation, never automatic resend.';
commit;
