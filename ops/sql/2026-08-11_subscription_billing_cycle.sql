-- Explicit Stripe billing cadence for cancellation and display rules.
-- Additive, transactional, and price-neutral.

begin;

alter table public.subscriptions
  add column if not exists billing_cycle text;

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_cycle_check;

alter table public.subscriptions
  add constraint subscriptions_billing_cycle_check
  check (billing_cycle is null or billing_cycle in ('monthly', 'yearly'));

comment on column public.subscriptions.billing_cycle is
  'Cadence Stripe officielle: monthly ou yearly. NULL uniquement avant souscription ou en attente de resynchronisation.';

do $$
declare
  invalid_count integer;
begin
  select count(*)
  into invalid_count
  from public.subscriptions
  where billing_cycle is not null
    and billing_cycle not in ('monthly', 'yearly');

  if invalid_count <> 0 then
    raise exception 'Safety check failed: % invalid billing cycles', invalid_count;
  end if;
end
$$;

commit;
