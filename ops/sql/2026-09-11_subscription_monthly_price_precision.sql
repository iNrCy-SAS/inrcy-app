-- Stripe annual and multi-month prices can have a fractional monthly
-- equivalent (for example 730 EUR/year = 60.83 EUR/month). Preserve it.

begin;

alter table public.subscriptions
  alter column monthly_price_eur type numeric(12, 2)
  using round(monthly_price_eur::numeric, 2);

comment on column public.subscriptions.monthly_price_eur is
  'Monthly EUR reference derived from the authoritative billing provider, with cent precision.';

do $$
declare
  invalid_count integer;
begin
  select count(*)
  into invalid_count
  from public.subscriptions
  where monthly_price_eur < 0;

  if invalid_count <> 0 then
    raise exception
      'Safety check failed: % subscriptions have a negative monthly price',
      invalid_count;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_monthly_price_eur_nonnegative'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_monthly_price_eur_nonnegative
      check (monthly_price_eur is null or monthly_price_eur >= 0)
      not valid;
  end if;
end
$$;

alter table public.subscriptions
  validate constraint subscriptions_monthly_price_eur_nonnegative;

commit;
