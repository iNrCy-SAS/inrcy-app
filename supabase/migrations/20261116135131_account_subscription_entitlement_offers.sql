begin;

-- An approved establishment contract is distinct from the legacy AUTH-level
-- subscription. No new authentication identity or Stripe payment is created.
create table public.inrcy_account_subscriptions (
  account_id uuid primary key references public.inrcy_accounts(id) on delete restrict,
  auth_user_id uuid not null references auth.users(id) on delete restrict,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text not null unique check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
  plan public.subscription_plan not null default 'Premium',
  app_edition text not null default 'premium' check (app_edition='premium'),
  status public.stripe_subscription_status not null,
  monthly_price_eur numeric not null check (monthly_price_eur>=0),
  monthly_price_tax_behavior text not null check (monthly_price_tax_behavior in ('exclusive','inclusive')),
  billing_cycle text not null check (billing_cycle in ('monthly','yearly')),
  billing_provider text not null default 'stripe' check (billing_provider='stripe'),
  contact_email text,
  start_date date not null,
  next_renewal_date date,
  cancel_requested_at timestamptz,
  end_date date,
  entitlement_offer text not null check (length(btrim(entitlement_offer))>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inrcy_account_subscription_premium_offer check (plan='Premium')
);
create index inrcy_account_subscriptions_payer_idx on public.inrcy_account_subscriptions(auth_user_id);
alter table public.inrcy_account_subscriptions enable row level security;
revoke all on public.inrcy_account_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.inrcy_account_subscriptions to service_role;

-- Offer configuration is private. All current writers run as service_role or
-- database-owned auth provisioning; clients cannot grant themselves a benefit.
create function public.inrcy_preserve_account_subscription_offer() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.inrcy_account_subscriptions s
    join public.inrcy_account_members m on m.account_id=s.account_id and m.auth_user_id=s.auth_user_id and m.role='owner'
    where s.account_id=new.user_id and s.auth_user_id=new.user_id
      and s.stripe_subscription_id=new.stripe_subscription_id
      and s.stripe_customer_id=new.stripe_customer_id) then
    new.plan:='Premium'::public.subscription_plan;
    new.app_edition:='premium';
  end if;
  return new;
end $$;
revoke all on function public.inrcy_preserve_account_subscription_offer() from public,anon,authenticated;
grant execute on function public.inrcy_preserve_account_subscription_offer() to service_role;
-- Runs after the existing plan->edition normalizer, keeping them consistent.
create trigger zzz_inrcy_preserve_account_subscription_offer
before insert or update on public.subscriptions
for each row execute function public.inrcy_preserve_account_subscription_offer();

create function public.inrcy_account_subscription_offer_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.inrcy_account_members m where m.account_id=new.account_id
      and m.auth_user_id=new.auth_user_id and m.role='owner') then
    raise exception 'ACCOUNT_SUBSCRIPTION_OWNER_REQUIRED';
  end if;
  new.updated_at:=now();
  return new;
end $$;
revoke all on function public.inrcy_account_subscription_offer_guard() from public,anon,authenticated;
grant execute on function public.inrcy_account_subscription_offer_guard() to service_role;
create trigger inrcy_account_subscription_offer_guard
before insert or update on public.inrcy_account_subscriptions
for each row execute function public.inrcy_account_subscription_offer_guard();

comment on table public.inrcy_account_subscriptions is 'Private approved per-establishment Stripe bindings and negotiated functional rights; amounts remain Stripe-authoritative.';
notify pgrst,'reload schema';
commit;
