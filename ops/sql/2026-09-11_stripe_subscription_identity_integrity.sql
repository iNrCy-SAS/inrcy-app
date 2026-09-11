-- Prevent one Stripe subscription from being attached to several iNrCy accounts.
-- Customer IDs intentionally remain non-unique: one Stripe customer may own
-- several legitimate subscriptions, while a subscription ID is one-to-one.

begin;

do $$
declare
  duplicate_count integer;
begin
  select count(*)
  into duplicate_count
  from (
    select btrim(stripe_subscription_id)
    from public.subscriptions
    where nullif(btrim(stripe_subscription_id), '') is not null
    group by btrim(stripe_subscription_id)
    having count(*) > 1
  ) duplicates;

  if duplicate_count <> 0 then
    raise exception
      'Safety check failed: % duplicate Stripe subscription identifiers must be reconciled first',
      duplicate_count;
  end if;
end
$$;

-- Canonicalize identifiers before enforcing and relying on exact lookups.
-- Webhook queries use Stripe's trimmed identifier, so whitespace must not make
-- an otherwise valid relationship invisible.
update public.subscriptions
set
  stripe_subscription_id = nullif(btrim(stripe_subscription_id), ''),
  stripe_customer_id = nullif(btrim(stripe_customer_id), ''),
  stripe_price_id = nullif(btrim(stripe_price_id), '')
where
  stripe_subscription_id is distinct from nullif(btrim(stripe_subscription_id), '')
  or stripe_customer_id is distinct from nullif(btrim(stripe_customer_id), '')
  or stripe_price_id is distinct from nullif(btrim(stripe_price_id), '');

create unique index if not exists subscriptions_stripe_subscription_id_unique_idx
  on public.subscriptions ((btrim(stripe_subscription_id)))
  where nullif(btrim(stripe_subscription_id), '') is not null;

comment on index public.subscriptions_stripe_subscription_id_unique_idx is
  'Guarantees that a Stripe subscription belongs to at most one iNrCy account.';

commit;
