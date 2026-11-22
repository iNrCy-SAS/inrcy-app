begin;

-- Store digests of mailbox identities, timestamps and byte counts only. The
-- same Microsoft mailbox can be connected to more than one iNrCy account.
create table public.outlook_mail_transfer_aliases (
  email_key text primary key,
  mailbox_key text not null
);
create table public.outlook_mail_transfer_events (
  mailbox_key text not null,
  reserved_at timestamptz not null,
  expires_at timestamptz not null,
  payload_bytes integer not null check (payload_bytes between 0 and 100000000),
  min_interval_ms integer not null check (min_interval_ms between 0 and 300000)
);
create index outlook_mail_transfer_mailbox_expiry_idx
  on public.outlook_mail_transfer_events(mailbox_key, expires_at);
create index outlook_mail_transfer_expiry_idx on public.outlook_mail_transfer_events(expires_at);
create index outlook_mail_transfer_legacy_expiry_idx on public.outlook_mail_transfer_events(expires_at)
  where mailbox_key like 'outlook-email:%';
alter table public.outlook_mail_transfer_aliases enable row level security;
alter table public.outlook_mail_transfer_events enable row level security;
revoke all on public.outlook_mail_transfer_aliases, public.outlook_mail_transfer_events from public, anon, authenticated;
grant select, insert, update on public.outlook_mail_transfer_aliases to service_role;
grant select, insert, update, delete on public.outlook_mail_transfer_events to service_role;

create function public.lock_outlook_mail_transfer_identity(p_integration_id uuid, p_user_id uuid)
returns text language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_graph_id text;
  v_email text;
  v_email_key text;
  v_mailbox_key text;
  v_observed_key text;
begin
  select nullif(btrim(i.provider_account_id), ''), nullif(lower(btrim(i.account_email)), '')
    into v_graph_id, v_email from public.integrations i
   where i.id = p_integration_id and i.user_id = p_user_id
     and i.provider = 'microsoft' and i.category = 'mail' and i.status = 'connected';
  if not found or (v_graph_id is null and v_email is null) then return null; end if;

  -- Lock an email first and a Graph id second, always in the same order.
  -- A legacy account may reconnect with its Graph id during a live window.
  if v_email is not null then
    v_email_key := 'outlook-email:' || encode(sha256(convert_to(v_email, 'UTF8')), 'hex');
    perform pg_advisory_xact_lock(hashtextextended(v_email_key, 0));
    if v_graph_id is null then
      select a.mailbox_key into v_mailbox_key from public.outlook_mail_transfer_aliases a
       where a.email_key = v_email_key;
      if v_mailbox_key is null then
        select nullif(btrim(i.provider_account_id), '') into v_graph_id from public.integrations i
         where i.provider = 'microsoft' and i.category = 'mail' and i.status = 'connected'
           and lower(btrim(i.account_email)) = v_email and nullif(btrim(i.provider_account_id), '') is not null
         order by i.id limit 1;
      end if;
    end if;
  end if;

  if v_graph_id is not null then
    v_mailbox_key := 'outlook-id:' || encode(sha256(convert_to(v_graph_id, 'UTF8')), 'hex');
  end if;
  if v_mailbox_key is null then return v_email_key; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_mailbox_key, 0));
  if v_email_key is not null then
    insert into public.outlook_mail_transfer_aliases as a (email_key, mailbox_key) values (v_email_key, v_mailbox_key)
      on conflict (email_key) do update set mailbox_key = excluded.mailbox_key
      where a.mailbox_key <> excluded.mailbox_key;
    update public.outlook_mail_transfer_events set mailbox_key = v_mailbox_key
     where mailbox_key = v_email_key and expires_at > clock_timestamp();
  end if;
  -- Another connection to this mailbox may be used first after a legacy
  -- address reconnects. Link any still-live email-only events immediately.
  if v_graph_id is not null and exists (select 1 from public.outlook_mail_transfer_events e
      where e.mailbox_key like 'outlook-email:%' and e.expires_at > clock_timestamp()) then
    for v_observed_key in
      select distinct 'outlook-email:' || encode(sha256(convert_to(lower(btrim(i.account_email)), 'UTF8')), 'hex')
        from public.integrations i where i.provider = 'microsoft' and i.category = 'mail' and i.status = 'connected'
        and btrim(i.provider_account_id) = v_graph_id and nullif(btrim(i.account_email), '') is not null
        order by 1
    loop
      update public.outlook_mail_transfer_events set mailbox_key = v_mailbox_key
       where mailbox_key = v_observed_key and expires_at > clock_timestamp();
      if found then
        insert into public.outlook_mail_transfer_aliases (email_key, mailbox_key) values (v_observed_key, v_mailbox_key)
          on conflict (email_key) do nothing;
      end if;
    end loop;
  end if;
  return v_mailbox_key;
end $$;

create function public.reserve_outlook_mail_transfer(
  p_integration_id uuid, p_user_id uuid, p_payload_bytes integer, p_min_interval_ms integer
) returns table (allowed boolean, retry_at timestamptz, reason text)
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_mailbox_key text;
  v_now timestamptz;
  v_used bigint;
  v_cooldown timestamptz;
  v_cadence timestamptz;
  v_byte_retry timestamptz;
  v_retry timestamptz;
begin
  if p_payload_bytes is null or p_payload_bytes not between 1 and 100000000
     or p_min_interval_ms is null or p_min_interval_ms not between 0 and 300000 then
    return query select false, null::timestamptz, 'invalid_payload'::text;
    return;
  end if;
  v_mailbox_key := public.lock_outlook_mail_transfer_identity(p_integration_id, p_user_id);
  if v_mailbox_key is null then
    return query select false, null::timestamptz, 'unknown_mailbox'::text;
    return;
  end if;
  v_now := clock_timestamp();
  -- Bounded pruning also cleans mailboxes that stopped sending. Skip entries
  -- another transaction is already pruning or transferring to a Graph id.
  delete from public.outlook_mail_transfer_events e where e.ctid in (
    select expired.ctid from public.outlook_mail_transfer_events expired
     where expired.expires_at <= v_now order by expired.expires_at limit 128 for update skip locked
  );
  select coalesce(sum(e.payload_bytes), 0),
         max(e.expires_at) filter (where e.payload_bytes = 0),
         max(e.reserved_at + greatest(e.min_interval_ms, p_min_interval_ms) * interval '1 millisecond')
           filter (where e.payload_bytes > 0 and p_min_interval_ms > 0)
    into v_used, v_cooldown, v_cadence from public.outlook_mail_transfer_events e
   where e.mailbox_key = v_mailbox_key and e.expires_at > v_now;
  if v_used + p_payload_bytes > 100000000 then
    select min(expiry.expires_at) into v_byte_retry from (
      select e.expires_at, sum(e.payload_bytes) over (order by e.expires_at) as freed
        from public.outlook_mail_transfer_events e
       where e.mailbox_key = v_mailbox_key and e.expires_at > v_now and e.payload_bytes > 0
    ) expiry where expiry.freed >= v_used + p_payload_bytes - 100000000;
  end if;
  v_retry := greatest(v_cooldown, v_cadence, v_byte_retry);
  if v_retry > v_now then
    return query select false, v_retry, case when v_cooldown is not null then 'provider_cooldown' else 'pacing' end;
    return;
  end if;
  insert into public.outlook_mail_transfer_events(mailbox_key, reserved_at, expires_at, payload_bytes, min_interval_ms)
    values (v_mailbox_key, v_now, v_now + interval '5 minutes', p_payload_bytes, p_min_interval_ms);
  return query select true, null::timestamptz, 'reserved'::text;
end $$;

create function public.defer_outlook_mail_transfer(p_integration_id uuid, p_user_id uuid, p_retry_at timestamptz)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_mailbox_key text;
  v_now timestamptz;
begin
  if p_retry_at is null or not isfinite(p_retry_at) then return false; end if;
  v_mailbox_key := public.lock_outlook_mail_transfer_identity(p_integration_id, p_user_id);
  v_now := clock_timestamp();
  if v_mailbox_key is null or p_retry_at <= v_now then return false; end if;
  -- A zero-byte event represents a provider cooldown. Keeping the longest
  -- deadline also covers out-of-order responses to consecutive Graph calls.
  if not exists (select 1 from public.outlook_mail_transfer_events e where e.mailbox_key = v_mailbox_key
                   and e.payload_bytes = 0 and e.expires_at >= p_retry_at) then
    insert into public.outlook_mail_transfer_events(mailbox_key, reserved_at, expires_at, payload_bytes, min_interval_ms)
      values (v_mailbox_key, v_now, p_retry_at, 0, 0);
  end if;
  return true;
end $$;

revoke all on function public.lock_outlook_mail_transfer_identity(uuid,uuid),
  public.reserve_outlook_mail_transfer(uuid,uuid,integer,integer),
  public.defer_outlook_mail_transfer(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.lock_outlook_mail_transfer_identity(uuid,uuid),
  public.reserve_outlook_mail_transfer(uuid,uuid,integer,integer),
  public.defer_outlook_mail_transfer(uuid,uuid,timestamptz) to service_role;

commit;
