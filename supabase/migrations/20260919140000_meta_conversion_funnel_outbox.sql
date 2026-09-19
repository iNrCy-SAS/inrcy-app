begin;

-- Keep the historical manual install compatible with a fresh migration replay.
create table if not exists public.signup_attributions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  form_source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  placement text,
  site_source_name text,
  landing_page_url text,
  event_source_url text,
  referrer_url text,
  event_id text not null,
  attribution_captured_at timestamptz,
  marketing_consent boolean not null default false,
  capi_status text not null default 'skipped',
  capi_events_received integer,
  capi_fbtrace_id text,
  capi_error text,
  capi_test_event_code_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists signup_attributions_event_id_unique
  on public.signup_attributions (event_id)
  where event_id <> '';

create index if not exists signup_attributions_campaign_idx
  on public.signup_attributions (utm_source, utm_campaign, ad_id, created_at desc);

alter table public.signup_attributions
  add column if not exists meta_fbp text,
  add column if not exists meta_fbc text,
  add column if not exists meta_client_user_agent text,
  add column if not exists meta_match_expires_at timestamptz,
  add column if not exists meta_consent_recorded_at timestamptz,
  add column if not exists meta_consent_source text;

alter table public.signup_attributions
  drop constraint if exists signup_attributions_capi_status_check;
alter table public.signup_attributions
  add constraint signup_attributions_capi_status_check
  check (capi_status in (
    'pending', 'processing', 'retry_wait', 'sent', 'failed', 'skipped', 'dead'
  )) not valid;
alter table public.signup_attributions
  validate constraint signup_attributions_capi_status_check;

alter table public.signup_attributions
  drop constraint if exists signup_attributions_meta_match_consent_check;
alter table public.signup_attributions
  add constraint signup_attributions_meta_match_consent_check
  check (
    marketing_consent
    or (
      meta_fbp is null
      and meta_fbc is null
      and meta_client_user_agent is null
      and meta_match_expires_at is null
    )
  ) not valid;
alter table public.signup_attributions
  validate constraint signup_attributions_meta_match_consent_check;

alter table public.signup_attributions enable row level security;
revoke all on table public.signup_attributions from public, anon, authenticated;
grant select, insert, update, delete on table public.signup_attributions to service_role;

comment on column public.signup_attributions.meta_match_expires_at is
  'Expiration RGPD des identifiants navigateur Meta consentis (90 jours maximum).';
comment on column public.signup_attributions.meta_consent_source is
  'Source du consentement marketing first-party ayant autorisé les conversions Meta.';

create table if not exists public.meta_conversion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  event_id text not null unique,
  source text not null,
  source_event_id text,
  occurred_at timestamptz not null,
  value_cents integer,
  currency text,
  status text not null default 'pending',
  attempt_count smallint not null default 0,
  max_attempts smallint not null default 10,
  next_attempt_at timestamptz,
  lock_token uuid,
  locked_at timestamptz,
  lock_expires_at timestamptz,
  sent_at timestamptz,
  events_received integer,
  fbtrace_id text,
  test_event_code_used boolean not null default false,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_conversion_events_user_event_unique unique (user_id, event_name),
  constraint meta_conversion_events_name_check
    check (event_name in ('Lead', 'CompleteRegistration', 'Subscribe')),
  constraint meta_conversion_events_id_check
    check (length(event_id) between 1 and 128),
  constraint meta_conversion_events_status_check
    check (status in ('pending', 'processing', 'retry_wait', 'sent', 'skipped', 'dead')),
  constraint meta_conversion_events_attempt_check
    check (attempt_count between 0 and max_attempts and max_attempts between 1 and 50),
  constraint meta_conversion_events_value_check
    check (value_cents is null or value_cents >= 0),
  constraint meta_conversion_events_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$')
);

comment on table public.meta_conversion_events is
  'File durable, idempotente et relançable du tunnel Meta Lead -> CompleteRegistration -> Subscribe.';

create index if not exists meta_conversion_events_due_idx
  on public.meta_conversion_events (next_attempt_at, occurred_at, id)
  where status in ('pending', 'retry_wait');

create index if not exists meta_conversion_events_lease_idx
  on public.meta_conversion_events (lock_expires_at, id)
  where status = 'processing';

create index if not exists meta_conversion_events_reporting_idx
  on public.meta_conversion_events (event_name, status, occurred_at desc);

create or replace function public.meta_conversion_events_touch_updated_at()
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

revoke all on function public.meta_conversion_events_touch_updated_at()
from public, anon, authenticated;
grant execute on function public.meta_conversion_events_touch_updated_at()
to service_role;

drop trigger if exists meta_conversion_events_touch_updated_at
on public.meta_conversion_events;
create trigger meta_conversion_events_touch_updated_at
before update on public.meta_conversion_events
for each row execute function public.meta_conversion_events_touch_updated_at();

alter table public.meta_conversion_events enable row level security;
revoke all on table public.meta_conversion_events from public, anon, authenticated;
grant select, insert, update, delete on table public.meta_conversion_events
to service_role;

create or replace function public.claim_meta_conversion_events(
  p_limit integer default 10,
  p_lock_token uuid default gen_random_uuid(),
  p_event_id text default null,
  p_lease_seconds integer default 120
)
returns setof public.meta_conversion_events
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  with candidates as (
    select queued.id
    from public.meta_conversion_events as queued
    where (p_event_id is null or queued.event_id = p_event_id)
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
  update public.meta_conversion_events as queued
  set status = 'processing',
      attempt_count = case
        when queued.status = 'processing' then queued.attempt_count
        else queued.attempt_count + 1
      end,
      lock_token = coalesce(p_lock_token, gen_random_uuid()),
      locked_at = now(),
      lock_expires_at = now() + make_interval(
        secs => least(greatest(coalesce(p_lease_seconds, 120), 30), 600)
      ),
      updated_at = now()
  from candidates
  where queued.id = candidates.id
  returning queued.*;
$$;

revoke all on function public.claim_meta_conversion_events(integer, uuid, text, integer)
from public, anon, authenticated;
grant execute on function public.claim_meta_conversion_events(integer, uuid, text, integer)
to service_role;

create or replace function public.enqueue_signup_meta_lead()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  insert into public.meta_conversion_events (
    user_id,
    event_name,
    event_id,
    source,
    source_event_id,
    occurred_at,
    value_cents,
    currency,
    status,
    next_attempt_at
  ) values (
    new.user_id,
    'Lead',
    left(coalesce(nullif(new.event_id, ''), 'inrcy-lead-' || new.user_id::text), 128),
    'wordpress_trial_signup',
    nullif(new.event_id, ''),
    coalesce(new.attribution_captured_at, new.created_at, now()),
    0,
    'EUR',
    'pending',
    now()
  )
  on conflict (user_id, event_name) do nothing;
  return new;
end;
$$;

revoke all on function public.enqueue_signup_meta_lead()
from public, anon, authenticated;
grant execute on function public.enqueue_signup_meta_lead()
to service_role;

drop trigger if exists signup_attributions_enqueue_meta_lead
on public.signup_attributions;
create trigger signup_attributions_enqueue_meta_lead
after insert on public.signup_attributions
for each row execute function public.enqueue_signup_meta_lead();

commit;
