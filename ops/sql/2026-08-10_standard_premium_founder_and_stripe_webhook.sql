-- iNrCy commercial model: Standard / Premium / Founder.
-- Preconditions verified on 2026-08-10:
--   * public.subscriptions.app_edition is text, NOT NULL, default standard
--   * 28 Premium rows and 1 Standard test row
-- This migration is transactional and does not touch Stripe identifiers or prices.

begin;

alter table public.subscriptions
  drop constraint if exists subscriptions_app_edition_check;

-- Every historical Premium row is a Founder account. Existing Standard rows
-- (including the test account and any signup occurring during deployment) stay Standard.
update public.subscriptions
set app_edition = 'founder',
    updated_at = now()
where lower(btrim(app_edition)) = 'premium';

alter table public.subscriptions
  alter column app_edition set default 'standard',
  alter column app_edition set not null;

alter table public.subscriptions
  add constraint subscriptions_app_edition_check
  check (app_edition in ('standard', 'premium', 'founder'));

comment on column public.subscriptions.app_edition is
  'Edition commerciale iNrCy: standard, premium ou founder. Founder conserve tous les acces commerciaux actuels et futurs.';

-- Cadence explicite : l'application ne doit jamais déduire mensuel/annuel du
-- montant, car les comptes Founder peuvent avoir un tarif négocié.
alter table public.subscriptions
  add column if not exists billing_cycle text;

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_cycle_check;

alter table public.subscriptions
  add constraint subscriptions_billing_cycle_check
  check (billing_cycle is null or billing_cycle in ('monthly', 'yearly'));

comment on column public.subscriptions.billing_cycle is
  'Cadence Stripe officielle: monthly ou yearly. NULL uniquement avant souscription ou en attente de resynchronisation.';

-- Idempotency ledger for Stripe webhooks. Only the service role can use it;
-- no customer data or payment method is stored here.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts >= 1),
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  completed_at timestamptz,
  last_error text
);

create index if not exists stripe_webhook_events_status_received_idx
  on public.stripe_webhook_events (status, last_received_at desc);

alter table public.stripe_webhook_events enable row level security;
revoke all on table public.stripe_webhook_events from anon, authenticated;
grant all on table public.stripe_webhook_events to service_role;

comment on table public.stripe_webhook_events is
  'Technical idempotency ledger for verified Stripe webhook events.';

-- Safety assertions: the official test account must remain Standard and no
-- unexpected edition may survive the conversion.
do $$
declare
  test_edition text;
  invalid_count integer;
begin
  select s.app_edition
  into test_edition
  from public.subscriptions s
  join auth.users u on u.id = s.user_id
  where lower(u.email) = 'testinrcy@gmail.com';

  if test_edition is distinct from 'standard' then
    raise exception 'Safety check failed: testinrcy@gmail.com is not Standard';
  end if;

  select count(*)
  into invalid_count
  from public.subscriptions
  where app_edition is null;

  if invalid_count <> 0 then
    raise exception 'Safety check failed: % subscriptions have no edition', invalid_count;
  end if;
end
$$;

commit;
