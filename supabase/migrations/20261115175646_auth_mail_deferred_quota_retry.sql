begin;

-- An explicit HTTP 429 is a known refusal, not an unknown acceptance. Keep its
-- retry date apart from pending requests inspected by the stale-pending cron.
alter table public.auth_email_deliveries add column if not exists retry_at timestamptz;
alter table public.auth_email_deliveries drop constraint if exists auth_email_deliveries_status_check;
alter table public.auth_email_deliveries add constraint auth_email_deliveries_status_check
  check (status in ('pending', 'deferred', 'accepted', 'sent', 'delayed', 'acceptance_uncertain', 'delivered', 'failed', 'bounced', 'suppressed', 'complained'));
alter table public.auth_email_deliveries drop constraint if exists auth_email_deliveries_deferred_retry_check;
alter table public.auth_email_deliveries add constraint auth_email_deliveries_deferred_retry_check
  check (status <> 'deferred' or (retry_at is not null and status_rank = 0 and provider_message_id is null));

create or replace function public.reserve_auth_email_delivery(
  p_delivery_key text, p_supabase_hook_id text, p_message_sequence smallint,
  p_user_id uuid, p_recipient_email text, p_action_type text
)
returns setof public.auth_email_deliveries
language sql volatile security invoker set search_path = pg_catalog as $$
  insert into public.auth_email_deliveries as delivery (
    delivery_key, supabase_hook_id, message_sequence, user_id, recipient_email,
    action_type, send_attempt_count, last_send_attempt_at
  ) values (p_delivery_key, p_supabase_hook_id, p_message_sequence, p_user_id,
    lower(p_recipient_email), p_action_type, 1, now())
  on conflict (delivery_key) do update set
    send_attempt_count = case when delivery.status = 'deferred' and delivery.retry_at > now()
      then delivery.send_attempt_count else least(delivery.send_attempt_count + 1, 20) end,
    last_send_attempt_at = case when delivery.status = 'deferred' and delivery.retry_at > now()
      then delivery.last_send_attempt_at else now() end,
    status = case when delivery.status = 'deferred' and delivery.retry_at <= now()
      then 'pending' else delivery.status end,
    retry_at = case when delivery.status = 'deferred' and delivery.retry_at <= now()
      then null else delivery.retry_at end,
    updated_at = case when delivery.status = 'deferred' and delivery.retry_at > now()
      then delivery.updated_at else now() end
  returning delivery.*;
$$;
revoke all on function public.reserve_auth_email_delivery(text, text, smallint, uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_auth_email_delivery(text, text, smallint, uuid, text, text) to service_role;

create or replace function public.defer_auth_email_delivery(
  p_delivery_key text, p_error_code text, p_error_message text, p_retry_at timestamptz
)
returns setof public.auth_email_deliveries
language plpgsql volatile security invoker set search_path = pg_catalog as $$
begin
  if p_retry_at is null then
    raise exception 'A deferred authentication email requires a retry date';
  end if;
  return query update public.auth_email_deliveries as delivery set
    status = 'deferred', retry_at = greatest(p_retry_at, now() + interval '1 second'),
    last_error_code = left(nullif(p_error_code, ''), 120),
    last_error_message = left(nullif(p_error_message, ''), 500),
    updated_at = now()
  where delivery.delivery_key = p_delivery_key
    and delivery.status in ('pending', 'deferred') and delivery.status_rank = 0
    and delivery.provider_message_id is null
  returning delivery.*;
  if not found then
    -- A concurrent positive webhook or permanent failure always wins.
    return query select delivery.* from public.auth_email_deliveries as delivery
      where delivery.delivery_key = p_delivery_key;
  end if;
end;
$$;
revoke all on function public.defer_auth_email_delivery(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.defer_auth_email_delivery(text, text, text, timestamptz) to service_role;

-- Only the existing encrypted welcome outbox can replay a complete email. Raw
-- Supabase hook OTPs and token hashes are never copied into this retry queue.
alter table public.signup_welcome_credentials add column if not exists retry_at timestamptz;
create or replace function public.claim_signup_welcome_credentials(p_limit integer default 10)
returns setof public.signup_welcome_credentials language sql security invoker set search_path = '' as $$
  update public.signup_welcome_credentials target set lease_until = now() + interval '2 minutes'
  from (
    select id from public.signup_welcome_credentials
    where ready_at is not null and user_id is not null and encrypted_password is not null
      and delivered_at is null and blocked_at is null and expires_at > now()
      and (retry_at is null or retry_at <= now())
      and (lease_until is null or lease_until < now())
    order by ready_at limit greatest(1, least(coalesce(p_limit, 10), 20))
    for update skip locked
  ) pending where pending.id = target.id returning target.*;
$$;
revoke all on function public.claim_signup_welcome_credentials(integer) from public, anon, authenticated;
grant execute on function public.claim_signup_welcome_credentials(integer) to service_role;

commit;
