-- Native store billing for iNrCy.
-- Additive migration: Stripe identifiers, prices and existing trial dates are preserved.

begin;

alter table public.subscriptions
  add column if not exists billing_provider text,
  add column if not exists native_product_id text,
  add column if not exists native_transaction_id text,
  add column if not exists native_original_transaction_id text,
  add column if not exists native_expires_at timestamptz,
  add column if not exists native_will_renew boolean,
  add column if not exists native_cancel_requested_at timestamptz,
  add column if not exists native_billing_issue_at timestamptz,
  add column if not exists native_last_event_at timestamptz,
  add column if not exists native_last_event_id text,
  add column if not exists native_environment text,
  add column if not exists native_entitlement_ids jsonb not null default '[]'::jsonb;

-- Existing paid Stripe accounts retain Stripe as their authoritative source.
update public.subscriptions
set billing_provider = 'stripe',
    updated_at = now()
where billing_provider is null
  and stripe_subscription_id is not null;

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_provider_check;

alter table public.subscriptions
  add constraint subscriptions_billing_provider_check
  check (billing_provider is null or billing_provider in ('stripe', 'app_store', 'play_store'));

comment on column public.subscriptions.billing_provider is
  'Source de facturation autoritaire du compte: Stripe sur le web, app_store sur iOS, play_store sur Android.';

comment on column public.subscriptions.native_entitlement_ids is
  'Entitlements RevenueCat actifs au dernier événement reçu, conservés pour audit et resynchronisation.';

create index if not exists subscriptions_billing_provider_idx
  on public.subscriptions (billing_provider, status);

-- Idempotency and retry ledger for RevenueCat webhooks. The payload is kept
-- only for technical support and replay diagnostics; no payment method is stored.
create table if not exists public.revenuecat_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts >= 1),
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text,
  payload jsonb not null default '{}'::jsonb
);

create index if not exists revenuecat_webhook_events_status_received_idx
  on public.revenuecat_webhook_events (status, last_received_at desc);

alter table public.revenuecat_webhook_events enable row level security;
revoke all on table public.revenuecat_webhook_events from anon, authenticated;
grant all on table public.revenuecat_webhook_events to service_role;

comment on table public.revenuecat_webhook_events is
  'Technical idempotency ledger for verified RevenueCat subscription events.';

do $$
declare
  invalid_count integer;
begin
  select count(*)
  into invalid_count
  from public.subscriptions
  where billing_provider is not null
    and billing_provider not in ('stripe', 'app_store', 'play_store');

  if invalid_count <> 0 then
    raise exception 'Safety check failed: % subscriptions have an invalid billing provider', invalid_count;
  end if;
end
$$;

commit;
