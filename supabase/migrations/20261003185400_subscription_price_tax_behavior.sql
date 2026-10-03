-- monthly_price_eur is the monthly equivalent of the Stripe Price amount.
-- A Price may include tax or exclude it; the amount alone cannot say which.
alter table public.subscriptions
  add column if not exists monthly_price_tax_behavior text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_monthly_price_tax_behavior_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_monthly_price_tax_behavior_check
      check (monthly_price_tax_behavior in ('inclusive', 'exclusive'));
  end if;
end $$;

comment on column public.subscriptions.monthly_price_tax_behavior is
  'Tax behavior of the Stripe Price represented by monthly_price_eur: inclusive (TTC), exclusive (HT), or NULL when unverified.';

-- Verified against the live Stripe Price details on 2026-10-03. These Price
-- IDs can be shared by several subscribers, so backfill by Price rather than
-- by account. No billed amount or Stripe subscription is modified here.
update public.subscriptions
set monthly_price_tax_behavior = 'exclusive'
where stripe_price_id = 'price_1UDBoLAluLVg8J6jU2ZuAvnQ'
  and monthly_price_tax_behavior is distinct from 'exclusive';

update public.subscriptions
set monthly_price_tax_behavior = 'inclusive'
where stripe_price_id = 'price_1U308bAluLVg8J6jbtaQb1OQ'
  and monthly_price_tax_behavior is distinct from 'inclusive';
