-- Independent paid video wallet. Included monthly quota keeps its own rollover.
-- No Stripe/Supabase production mutation is performed by preparing this file.
begin;

do $$
begin
  if to_regclass('public.ai_media_generation_jobs') is null
     or to_regprocedure('public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)') is null then
    raise exception 'VIDEO_CREDITS_PREFLIGHT_FAILED';
  end if;
  if (select count(*) from public.ai_media_plan_limits where edition in ('standard','premium')) <> 2
     or exists (select 1 from public.ai_media_plan_limits where
       (edition = 'standard' and video_monthly_limit not in (48,54))
       or (edition = 'premium' and video_monthly_limit not in (196,204))) then
    raise exception 'VIDEO_CREDITS_UNEXPECTED_MONTHLY_LIMITS';
  end if;
end;
$$;

update public.ai_media_plan_limits
set video_monthly_limit = case edition when 'standard' then 54 when 'premium' then 204 end,
    updated_at = pg_catalog.now()
where edition in ('standard','premium');

create table public.ai_media_video_credit_packs (
  pack_key text primary key,
  seconds integer not null check (seconds > 0),
  amount_ht_cents integer not null check (amount_ht_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  active boolean not null default true
);
insert into public.ai_media_video_credit_packs(pack_key,seconds,amount_ht_cents)
values ('video_50',50,800),('video_100',100,1500),('video_200',200,2900),('video_500',500,6900);

create table public.ai_media_video_credit_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.inrcy_accounts(id) on delete restrict,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  request_key text not null check (length(request_key) between 8 and 180),
  pack_key text not null references public.ai_media_video_credit_packs(pack_key),
  seconds integer not null check (seconds > 0),
  amount_ht_cents integer not null check (amount_ht_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  tax_behavior text not null default 'exclusive' check (tax_behavior = 'exclusive'),
  status text not null default 'pending' check (status in ('pending','paid','refunded','expired','failed')),
  stripe_price_id text not null check (stripe_price_id ~ '^price_[a-zA-Z0-9_]+$'),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_customer_id text,
  stripe_livemode boolean,
  amount_total_cents integer,
  refunded_amount_cents integer not null default 0 check (refunded_amount_cents >= 0),
  revoked_seconds integer not null default 0 check (revoked_seconds >= 0 and revoked_seconds <= seconds),
  held_seconds integer not null default 0 check (held_seconds >= 0 and held_seconds <= seconds),
  dispute_revoked_seconds integer not null default 0 check (dispute_revoked_seconds >= 0 and dispute_revoked_seconds <= seconds),
  granted_at timestamptz,
  checkout_attempted_at timestamptz,
  checkout_params text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,request_key)
);
create index ai_media_video_credit_orders_account_created_idx
on public.ai_media_video_credit_orders(account_id,created_at desc);

create table public.ai_media_video_credit_balances (
  account_id uuid primary key references public.inrcy_accounts(id) on delete restrict,
  granted_seconds integer not null default 0 check (granted_seconds >= 0),
  revoked_seconds integer not null default 0 check (revoked_seconds >= 0 and revoked_seconds <= granted_seconds),
  used_seconds integer not null default 0 check (used_seconds >= 0),
  reserved_seconds integer not null default 0 check (reserved_seconds >= 0),
  held_seconds integer not null default 0 check (held_seconds >= 0),
  dispute_revoked_seconds integer not null default 0 check (dispute_revoked_seconds >= 0),
  check (revoked_seconds + dispute_revoked_seconds <= granted_seconds),
  updated_at timestamptz not null default now()
);
-- A refund after consumption may leave a paid-credit debt. It never removes
-- the subscription allowance; subsequent purchases repay that paid-credit debt.
create table public.ai_media_video_credit_ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.inrcy_accounts(id) on delete restrict,
  order_id uuid references public.ai_media_video_credit_orders(id) on delete restrict,
  job_id uuid references public.ai_media_generation_jobs(id) on delete restrict,
  entry_key text not null unique,
  kind text not null check (kind in ('purchase','refund','reservation','completion','release','dispute_hold','dispute_loss','dispute_release')),
  granted_delta integer not null default 0,
  revoked_delta integer not null default 0,
  used_delta integer not null default 0,
  reserved_delta integer not null default 0,
  held_delta integer not null default 0,
  dispute_revoked_delta integer not null default 0,
  stripe_event_id text,
  created_at timestamptz not null default now()
);
create index ai_media_video_credit_ledger_account_created_idx
on public.ai_media_video_credit_ledger(account_id,created_at desc);

create table public.ai_media_video_credit_disputes (
  stripe_dispute_id text primary key check (stripe_dispute_id ~ '^d[up]_[a-zA-Z0-9_]+$'),
  order_id uuid not null references public.ai_media_video_credit_orders(id) on delete restrict,
  account_id uuid not null references public.inrcy_accounts(id) on delete restrict,
  stripe_charge_id text not null check (stripe_charge_id ~ '^ch_[a-zA-Z0-9_]+$'),
  stripe_payment_intent_id text not null check (stripe_payment_intent_id ~ '^pi_[a-zA-Z0-9_]+$'),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  stripe_status text not null check (stripe_status in ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented')),
  effect text not null check (effect in ('held','lost','released')),
  affected_seconds integer not null check (affected_seconds >= 0),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
create index ai_media_video_credit_disputes_order_idx on public.ai_media_video_credit_disputes(order_id);

alter table public.ai_media_video_credit_packs enable row level security;
alter table public.ai_media_video_credit_orders enable row level security;
alter table public.ai_media_video_credit_balances enable row level security;
alter table public.ai_media_video_credit_ledger enable row level security;
alter table public.ai_media_video_credit_disputes enable row level security;
revoke all on public.ai_media_video_credit_packs,public.ai_media_video_credit_orders,
  public.ai_media_video_credit_balances,public.ai_media_video_credit_ledger,public.ai_media_video_credit_disputes from public,anon,authenticated;
grant select,insert,update on public.ai_media_video_credit_packs,public.ai_media_video_credit_orders,
  public.ai_media_video_credit_balances,public.ai_media_video_credit_disputes to service_role;
grant select,insert on public.ai_media_video_credit_ledger to service_role;
grant usage,select on sequence public.ai_media_video_credit_ledger_id_seq to service_role;
-- History can only be read for an account the authenticated actor can access.
grant select on public.ai_media_video_credit_orders,public.ai_media_video_credit_ledger,public.ai_media_video_credit_disputes to authenticated;
create policy video_credit_orders_read on public.ai_media_video_credit_orders for select to authenticated
using (public.inrcy_can_access_account(account_id));
create policy video_credit_disputes_read on public.ai_media_video_credit_disputes for select to authenticated
using (public.inrcy_can_access_account(account_id));
create policy video_credit_ledger_read on public.ai_media_video_credit_ledger for select to authenticated
using (public.inrcy_can_access_account(account_id));

alter table public.ai_media_generation_jobs add column purchased_quota_amount integer not null default 0
  check (purchased_quota_amount >= 0 and purchased_quota_amount <= quota_amount
         and (media_kind = 'video' or purchased_quota_amount = 0));
comment on column public.ai_media_generation_jobs.purchased_quota_amount is
  'Immutable portion of this reservation financed by purchased seconds; remainder belongs to the monthly allowance.';

create function public.ai_media_video_credit_metrics(p_account_id uuid)
returns table(credit_limit integer,credit_used integer,credit_reserved integer,credit_remaining integer,credit_debt integer,credit_held integer,credit_suspended_deficit integer)
language plpgsql volatile security invoker set search_path = '' as $$
declare v_balance public.ai_media_video_credit_balances%rowtype;
begin
  insert into public.ai_media_video_credit_balances(account_id) values(p_account_id) on conflict do nothing;
  select b.* into v_balance from public.ai_media_video_credit_balances b where b.account_id = p_account_id for update;
  return query select
    greatest(v_balance.granted_seconds-v_balance.revoked_seconds-v_balance.dispute_revoked_seconds-v_balance.held_seconds,v_balance.used_seconds+v_balance.reserved_seconds),
    v_balance.used_seconds,v_balance.reserved_seconds,
    greatest(v_balance.granted_seconds-v_balance.revoked_seconds-v_balance.dispute_revoked_seconds-v_balance.held_seconds-v_balance.used_seconds-v_balance.reserved_seconds,0),
    greatest(v_balance.used_seconds+v_balance.reserved_seconds-v_balance.granted_seconds+v_balance.revoked_seconds+v_balance.dispute_revoked_seconds,0),
    v_balance.held_seconds,
    greatest(v_balance.used_seconds+v_balance.reserved_seconds-v_balance.granted_seconds+v_balance.revoked_seconds+v_balance.dispute_revoked_seconds+v_balance.held_seconds,0)
      -greatest(v_balance.used_seconds+v_balance.reserved_seconds-v_balance.granted_seconds+v_balance.revoked_seconds+v_balance.dispute_revoked_seconds,0);
end;
$$;
revoke all on function public.ai_media_video_credit_metrics(uuid) from public,anon,authenticated;
grant execute on function public.ai_media_video_credit_metrics(uuid) to service_role;

create function public.create_ai_media_video_credit_order(
  p_account_id uuid,p_actor_auth_user_id uuid,p_pack_key text,p_request_key text,p_stripe_price_id text
)
returns setof public.ai_media_video_credit_orders
language plpgsql volatile security invoker set search_path = '' as $$
declare v_pack public.ai_media_video_credit_packs%rowtype; v_order public.ai_media_video_credit_orders%rowtype;
begin
  perform public.ai_media_assert_account_actor(p_account_id,p_actor_auth_user_id);
  if not exists (select 1 from public.inrcy_account_members m where m.account_id=p_account_id
    and m.auth_user_id=p_actor_auth_user_id and m.role in ('owner','admin')) then
    raise exception 'VIDEO_CREDITS_PURCHASE_ACCESS_DENIED';
  end if;
  if not exists (select 1 from public.subscriptions s where s.user_id=p_account_id and s.status in ('active','trialing')) then
    raise exception 'VIDEO_CREDITS_ACTIVE_SUBSCRIPTION_REQUIRED';
  end if;
  if length(coalesce(p_request_key,'')) not between 8 and 180 then raise exception 'VIDEO_CREDITS_INVALID_REQUEST_KEY'; end if;
  select p.* into v_pack from public.ai_media_video_credit_packs p where p.pack_key=p_pack_key and p.active;
  if not found then raise exception 'VIDEO_CREDITS_UNKNOWN_PACK'; end if;
  insert into public.ai_media_video_credit_orders(account_id,actor_auth_user_id,request_key,pack_key,seconds,amount_ht_cents,stripe_price_id)
  values(p_account_id,p_actor_auth_user_id,p_request_key,p_pack_key,v_pack.seconds,v_pack.amount_ht_cents,p_stripe_price_id)
  on conflict(account_id,request_key) do nothing;
  select o.* into v_order from public.ai_media_video_credit_orders o where o.account_id=p_account_id and o.request_key=p_request_key for update;
  if v_order.pack_key<>p_pack_key or v_order.stripe_price_id<>p_stripe_price_id
     or v_order.actor_auth_user_id<>p_actor_auth_user_id then raise exception 'VIDEO_CREDITS_IDEMPOTENCY_CONFLICT'; end if;
  return next v_order;
end;
$$;
revoke all on function public.create_ai_media_video_credit_order(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_ai_media_video_credit_order(uuid,uuid,text,text,text) to service_role;

create function public.prepare_ai_media_video_credit_checkout(
  p_order_id uuid,p_account_id uuid,p_params text,p_customer_id text,p_livemode boolean
)
returns setof public.ai_media_video_credit_orders
language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_video_credit_orders%rowtype;
begin
  select o.* into v_order from public.ai_media_video_credit_orders o where o.id=p_order_id and o.account_id=p_account_id for update;
  if not found then raise exception 'VIDEO_CREDITS_ORDER_NOT_FOUND'; end if;
  if v_order.granted_at is not null then raise exception 'VIDEO_CREDITS_ALREADY_PAID'; end if;
  if v_order.checkout_params is null then
    update public.ai_media_video_credit_orders o set checkout_params=p_params,checkout_attempted_at=now(),
      stripe_customer_id=p_customer_id,stripe_livemode=p_livemode,updated_at=now()
    where o.id=v_order.id returning o.* into v_order;
  end if;
  return next v_order;
end;
$$;
revoke all on function public.prepare_ai_media_video_credit_checkout(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.prepare_ai_media_video_credit_checkout(uuid,uuid,text,text,boolean) to service_role;

-- The caller holds the order before locking its shared wallet. Refunds and
-- disputes compose without removing the same purchased seconds twice.
create function public.refresh_ai_media_video_credit_dispute_totals(
  p_order_id uuid,p_entry_key text,p_stripe_event_id text,p_refunded_seconds integer default null
)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_video_credit_orders%rowtype; v_loss integer; v_held integer;
  v_loss_delta integer; v_held_delta integer; v_available integer;
begin
  select o.* into v_order from public.ai_media_video_credit_orders o where o.id=p_order_id for update;
  if not found then raise exception 'VIDEO_CREDITS_ORDER_NOT_FOUND'; end if;
  if v_order.granted_at is null then return; end if;
  v_available:=v_order.seconds-coalesce(p_refunded_seconds,v_order.revoked_seconds);
  if v_available<0 or v_available>v_order.seconds then raise exception 'VIDEO_CREDITS_DISPUTE_SCOPE_MISMATCH'; end if;
  select least(coalesce(sum(d.affected_seconds),0),v_available)::integer into v_loss
  from public.ai_media_video_credit_disputes d where d.order_id=p_order_id and d.effect='lost';
  select least(coalesce(sum(d.affected_seconds),0),v_available-v_loss)::integer into v_held
  from public.ai_media_video_credit_disputes d where d.order_id=p_order_id and d.effect='held';
  v_loss_delta:=v_loss-v_order.dispute_revoked_seconds; v_held_delta:=v_held-v_order.held_seconds;
  if v_loss_delta=0 and v_held_delta=0 then return; end if;
  update public.ai_media_video_credit_balances b
  set dispute_revoked_seconds=b.dispute_revoked_seconds+v_loss_delta,held_seconds=b.held_seconds+v_held_delta,updated_at=now()
  where b.account_id=v_order.account_id;
  if not found then raise exception 'VIDEO_CREDITS_DISPUTE_WALLET_MISSING'; end if;
  update public.ai_media_video_credit_orders o set dispute_revoked_seconds=v_loss,held_seconds=v_held,updated_at=now() where o.id=p_order_id;
  insert into public.ai_media_video_credit_ledger(account_id,order_id,entry_key,kind,held_delta,dispute_revoked_delta,stripe_event_id)
  values(v_order.account_id,p_order_id,p_entry_key,
    case when v_loss_delta>0 then 'dispute_loss' when v_held_delta>0 then 'dispute_hold' else 'dispute_release' end,
    v_held_delta,v_loss_delta,p_stripe_event_id);
end;
$$;
revoke all on function public.refresh_ai_media_video_credit_dispute_totals(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.refresh_ai_media_video_credit_dispute_totals(uuid,text,text,integer) to service_role;

create function public.reconcile_ai_media_video_credit_dispute(
  p_order_id uuid,p_account_id uuid,p_payment_intent_id text,p_dispute_id text,p_charge_id text,
  p_amount_cents integer,p_charge_amount_cents integer,p_currency text,p_status text,p_stripe_event_id text
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_video_credit_orders%rowtype; v_old public.ai_media_video_credit_disputes%rowtype;
  v_effect text; v_seconds integer; v_version integer;
begin
  select o.* into v_order from public.ai_media_video_credit_orders o where o.id=p_order_id and o.account_id=p_account_id for update;
  if not found then raise exception 'VIDEO_CREDITS_ORDER_NOT_FOUND'; end if;
  if p_dispute_id is null or p_dispute_id !~ '^d[up]_[a-zA-Z0-9_]+$'
     or p_charge_id is null or p_charge_id !~ '^ch_[a-zA-Z0-9_]+$'
     or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[a-zA-Z0-9_]+$'
     or (v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id<>p_payment_intent_id)
     or p_amount_cents is null or p_amount_cents<=0 or p_charge_amount_cents is null or p_charge_amount_cents<v_order.amount_ht_cents
     or (v_order.amount_total_cents is not null and v_order.amount_total_cents<>p_charge_amount_cents)
     or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_status is null or p_status not in ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented') then
    raise exception 'VIDEO_CREDITS_DISPUTE_SCOPE_MISMATCH';
  end if;
  v_effect:=case when p_status='lost' then 'lost' when p_status in ('won','warning_closed','prevented') then 'released' else 'held' end;
  -- Currency conversion or a disputed amount above the original charge is
  -- possible. An unconvertible currency safely suspends the whole paid pack.
  v_seconds:=case when p_currency<>v_order.currency then v_order.seconds else
    least(v_order.seconds::bigint,(v_order.seconds::bigint*p_amount_cents+p_charge_amount_cents-1)/p_charge_amount_cents)::integer end;
  select d.* into v_old from public.ai_media_video_credit_disputes d where d.stripe_dispute_id=p_dispute_id for update;
  if found then
    if v_old.order_id<>p_order_id or v_old.stripe_charge_id<>p_charge_id or v_old.stripe_payment_intent_id<>p_payment_intent_id then
      raise exception 'VIDEO_CREDITS_DISPUTE_SCOPE_MISMATCH';
    end if;
    -- Reads may arrive out of order even when they reread Stripe. A released
    -- dispute never regresses to a hold/loss; a late reinstatement may reverse
    -- lost to won. A new dispute uses a new Stripe ID.
    if v_old.effect='released' and v_effect<>'released' then return false; end if;
    if v_old.effect='lost' and v_effect='held' then return false; end if;
    if v_old.stripe_status=p_status and v_old.amount_cents=p_amount_cents and v_old.currency=p_currency then return false; end if;
    v_version:=v_old.version+1;
    update public.ai_media_video_credit_disputes d set amount_cents=p_amount_cents,currency=p_currency,stripe_status=p_status,
      effect=v_effect,affected_seconds=v_seconds,version=v_version,updated_at=now() where d.stripe_dispute_id=p_dispute_id;
  else
    v_version:=1;
    insert into public.ai_media_video_credit_disputes(stripe_dispute_id,order_id,account_id,stripe_charge_id,stripe_payment_intent_id,
      amount_cents,currency,stripe_status,effect,affected_seconds)
    values(p_dispute_id,p_order_id,p_account_id,p_charge_id,p_payment_intent_id,p_amount_cents,p_currency,p_status,v_effect,v_seconds);
  end if;
  perform public.refresh_ai_media_video_credit_dispute_totals(p_order_id,'dispute:'||p_dispute_id||':'||v_version::text,p_stripe_event_id);
  return true;
end;
$$;
revoke all on function public.reconcile_ai_media_video_credit_dispute(uuid,uuid,text,text,text,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_ai_media_video_credit_dispute(uuid,uuid,text,text,text,integer,integer,text,text,text) to service_role;

create function public.fulfill_ai_media_video_credit_order(
  p_order_id uuid,p_account_id uuid,p_checkout_session_id text,p_payment_intent_id text,
  p_customer_id text,p_livemode boolean,p_amount_subtotal_cents integer,p_amount_total_cents integer,
  p_currency text,p_stripe_event_id text,p_refunded_amount_cents integer default 0,p_disputes jsonb default '[]'::jsonb
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_video_credit_orders%rowtype; v_dispute jsonb; v_granted boolean:=false;
begin
  select o.* into v_order from public.ai_media_video_credit_orders o where o.id=p_order_id and o.account_id=p_account_id for update;
  if not found then raise exception 'VIDEO_CREDITS_ORDER_NOT_FOUND'; end if;
  if p_checkout_session_id !~ '^cs_[a-zA-Z0-9_]+$' or p_payment_intent_id !~ '^pi_[a-zA-Z0-9_]+$'
     or p_customer_id !~ '^cus_[a-zA-Z0-9_]+$' or p_livemode is null
     or p_amount_subtotal_cents is distinct from v_order.amount_ht_cents
     or p_amount_total_cents is null or p_amount_total_cents < p_amount_subtotal_cents or p_currency is distinct from v_order.currency
     or p_refunded_amount_cents is null or p_refunded_amount_cents < 0 or p_refunded_amount_cents > p_amount_total_cents
     or p_disputes is null or jsonb_typeof(p_disputes)<>'array' or jsonb_array_length(p_disputes)>100
     or (v_order.amount_total_cents is not null and v_order.amount_total_cents<>p_amount_total_cents)
     or (v_order.stripe_checkout_session_id is not null and v_order.stripe_checkout_session_id<>p_checkout_session_id)
     or (v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id<>p_payment_intent_id)
     or (v_order.stripe_customer_id is not null and v_order.stripe_customer_id<>p_customer_id)
     or (v_order.stripe_livemode is not null and v_order.stripe_livemode<>p_livemode) then
    raise exception 'VIDEO_CREDITS_PAYMENT_SCOPE_MISMATCH';
  end if;
  if v_order.granted_at is null then
  insert into public.ai_media_video_credit_balances(account_id) values(p_account_id) on conflict do nothing;
  update public.ai_media_video_credit_balances b
  set granted_seconds=b.granted_seconds+v_order.seconds,updated_at=now() where b.account_id=p_account_id;
  insert into public.ai_media_video_credit_ledger(account_id,order_id,entry_key,kind,granted_delta,stripe_event_id)
  values(p_account_id,v_order.id,'purchase:'||v_order.id::text,'purchase',v_order.seconds,p_stripe_event_id);
  update public.ai_media_video_credit_orders o
  set status='paid',granted_at=now(),stripe_checkout_session_id=p_checkout_session_id,
    stripe_payment_intent_id=p_payment_intent_id,stripe_customer_id=p_customer_id,stripe_livemode=p_livemode,
    amount_total_cents=p_amount_total_cents,updated_at=now() where o.id=v_order.id;
    v_granted:=true;
  end if;
  if p_refunded_amount_cents > 0 then perform public.refund_ai_media_video_credit_order(v_order.id,p_payment_intent_id,p_refunded_amount_cents,p_stripe_event_id); end if;
  for v_dispute in select value from jsonb_array_elements(p_disputes) loop
    perform public.reconcile_ai_media_video_credit_dispute(v_order.id,p_account_id,p_payment_intent_id,
      v_dispute->>'id',v_dispute->>'charge_id',(v_dispute->>'amount')::integer,p_amount_total_cents,
      v_dispute->>'currency',v_dispute->>'status',p_stripe_event_id);
  end loop;
  -- Disputes received before the initial credit remain durable. Even a
  -- repeated state must be projected onto the newly funded wallet atomically.
  if v_granted then perform public.refresh_ai_media_video_credit_dispute_totals(v_order.id,'dispute-initial:'||v_order.id::text,p_stripe_event_id); end if;
  return v_granted;
end;
$$;
revoke all on function public.fulfill_ai_media_video_credit_order(uuid,uuid,text,text,text,boolean,integer,integer,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.fulfill_ai_media_video_credit_order(uuid,uuid,text,text,text,boolean,integer,integer,text,text,integer,jsonb) to service_role;

create function public.refund_ai_media_video_credit_order(
  p_order_id uuid,p_payment_intent_id text,p_refunded_amount_cents integer,p_stripe_event_id text
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_video_credit_orders%rowtype; v_revoked integer; v_delta integer;
begin
  select o.* into v_order from public.ai_media_video_credit_orders o where o.id=p_order_id for update;
  if not found then raise exception 'VIDEO_CREDITS_ORDER_NOT_FOUND'; end if;
  -- A refund arriving before fulfillment must be retried, never acknowledged
  -- without a durable revocation. Fulfillment also reconciles current refunds.
  if v_order.granted_at is null then raise exception 'VIDEO_CREDITS_REFUND_AWAITS_FULFILLMENT'; end if;
  if v_order.stripe_payment_intent_id is distinct from p_payment_intent_id
     or p_refunded_amount_cents is null or p_refunded_amount_cents < 0
     or p_refunded_amount_cents > v_order.amount_total_cents then raise exception 'VIDEO_CREDITS_REFUND_SCOPE_MISMATCH'; end if;
  if p_refunded_amount_cents <= v_order.refunded_amount_cents then return false; end if;
  v_revoked := (v_order.seconds::bigint*p_refunded_amount_cents/v_order.amount_total_cents)::integer;
  v_delta := v_revoked-v_order.revoked_seconds;
  perform public.refresh_ai_media_video_credit_dispute_totals(v_order.id,'refund-dispute:'||v_order.id::text||':'||p_refunded_amount_cents::text,p_stripe_event_id,v_revoked);
  update public.ai_media_video_credit_balances b
  set revoked_seconds=b.revoked_seconds+v_delta,updated_at=now() where b.account_id=v_order.account_id;
  insert into public.ai_media_video_credit_ledger(account_id,order_id,entry_key,kind,revoked_delta,stripe_event_id)
  values(v_order.account_id,v_order.id,'refund:'||v_order.id::text||':'||p_refunded_amount_cents::text,'refund',v_delta,p_stripe_event_id);
  update public.ai_media_video_credit_orders o set refunded_amount_cents=p_refunded_amount_cents,revoked_seconds=v_revoked,
    status=case when p_refunded_amount_cents=o.amount_total_cents then 'refunded' else 'paid' end,updated_at=now() where o.id=v_order.id;
  return true;
end;
$$;
revoke all on function public.refund_ai_media_video_credit_order(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.refund_ai_media_video_credit_order(uuid,text,integer,text) to service_role;

create function public.ai_media_video_credit_job_ledger()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_kind text; v_used integer:=0; v_reserved integer:=0;
begin
  if tg_op='UPDATE' and new.purchased_quota_amount is distinct from old.purchased_quota_amount then
    raise exception 'AI_MEDIA_QUOTA_LEDGER_IMMUTABLE';
  end if;
  if new.purchased_quota_amount=0 then return new; end if;
  if tg_op='INSERT' then
    if new.status<>'reserved' then raise exception 'VIDEO_CREDITS_INVALID_INITIAL_JOB_STATUS'; end if;
    v_kind:='reservation'; v_reserved:=new.purchased_quota_amount;
    update public.ai_media_video_credit_balances b set reserved_seconds=b.reserved_seconds+v_reserved,updated_at=now()
    where b.account_id=new.account_id and b.granted_seconds-b.revoked_seconds-b.dispute_revoked_seconds-b.held_seconds-b.used_seconds-b.reserved_seconds>=v_reserved;
  elsif old.status in ('reserved','processing') and new.status in ('completed','failed','expired') then
    v_kind:=case when new.status='completed' then 'completion' else 'release' end;
    v_used:=case when new.status='completed' then new.purchased_quota_amount else 0 end;
    v_reserved:=-new.purchased_quota_amount;
    update public.ai_media_video_credit_balances b set used_seconds=b.used_seconds+v_used,
      reserved_seconds=b.reserved_seconds+v_reserved,updated_at=now()
    where b.account_id=new.account_id and b.reserved_seconds>=new.purchased_quota_amount;
  else return new;
  end if;
  if not found then raise exception 'VIDEO_CREDITS_RESERVATION_INVARIANT_BROKEN'; end if;
  insert into public.ai_media_video_credit_ledger(account_id,job_id,entry_key,kind,used_delta,reserved_delta)
  values(new.account_id,new.id,'job:'||new.id::text||':'||v_kind,v_kind,v_used,v_reserved);
  return new;
end;
$$;
revoke all on function public.ai_media_video_credit_job_ledger() from public,anon,authenticated;
grant execute on function public.ai_media_video_credit_job_ledger() to service_role;
create trigger ai_media_video_credit_job_ledger after insert or update of status,purchased_quota_amount
on public.ai_media_generation_jobs for each row execute function public.ai_media_video_credit_job_ledger();

-- Targeted changes to audited existing quota RPCs. Fail closed on drift rather
-- than replacing unrelated quota/prompt rules or omitting newer image rules.
do $$
declare v_source text; v_signature text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure) into v_source;
  v_source := replace(v_source,E'\r\n',E'\n');
  v_old := E'  media_kind := ''video'';\n  quota_unit := ''second'';';
  v_new := E'  if v_video_base > 0 then\n    select v_video_limit+c.credit_limit,v_video_used+c.credit_used,v_video_reserved+c.credit_reserved\n      into v_video_limit,v_video_used,v_video_reserved\n    from public.ai_media_video_credit_metrics(p_account_id) c;\n  end if;\n  media_kind := ''video'';\n  quota_unit := ''second'';';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_QUOTA_FUNCTION_DRIFT'; end if;
  execute replace(v_source,v_old,v_new);

  select pg_get_functiondef('public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure) into v_source;
  v_source := replace(v_source,E'\r\n',E'\n');
  v_old:=E'  v_expires_at timestamptz;';
  v_new:=E'  v_expires_at timestamptz;\n  v_purchased integer := 0;\n  v_monthly_limit integer;\n  v_credits record;';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_RESERVE_DECLARATION_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  v_old:=E'  v_limit := coalesce(p_limit_override, v_rollover_limit);';
  v_new:=E'  v_limit := coalesce(p_limit_override, v_rollover_limit);\n  v_monthly_limit := v_limit;\n  if v_media_kind = ''video'' and p_limit_override is null and v_base_limit > 0 then\n    select * into v_credits from public.ai_media_video_credit_metrics(p_account_id);\n    v_purchased := greatest(p_quota_amount - greatest(v_limit-v_used-v_reserved,0),0);\n    v_limit := v_limit+v_credits.credit_limit;\n    v_used := v_used+v_credits.credit_used;\n    v_reserved := v_reserved+v_credits.credit_reserved;\n  end if;';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_RESERVE_BALANCE_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  v_old:=E'    monthly_limit,\n    quota_period_start,';
  v_new:=E'    monthly_limit,\n    purchased_quota_amount,\n    quota_period_start,';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_RESERVE_INSERT_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  v_old:=E'    v_limit,\n    v_period_start,\n    v_quota_unit,';
  v_new:=E'    v_monthly_limit,\n    v_purchased,\n    v_period_start,\n    v_quota_unit,';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_RESERVE_VALUES_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  v_old:='set reserved_count = u.reserved_count + p_quota_amount';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_RESERVE_COUNTER_DRIFT'; end if;
  v_source:=replace(v_source,v_old,'set reserved_count = u.reserved_count + p_quota_amount - v_purchased');
  -- Replayed jobs retain their immutable split and read today's wallet metrics.
  v_old:=E'    limit_count := v_job.monthly_limit;\n    used_count := v_used;';
  v_new:=E'    v_limit := v_job.monthly_limit;\n    if v_job.media_kind = ''video'' and v_job.monthly_limit > 0 then\n      select v_limit+c.credit_limit,v_used+c.credit_used,v_reserved+c.credit_reserved\n        into v_limit,v_used,v_reserved from public.ai_media_video_credit_metrics(p_account_id) c;\n    end if;\n    limit_count := v_limit;\n    used_count := v_used;';
  if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_RESERVE_REPLAY_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  v_source:=replace(v_source,'remaining_count := greatest(v_job.monthly_limit - v_used - v_reserved, 0);','remaining_count := greatest(v_limit - v_used - v_reserved, 0);');
  execute v_source;

  foreach v_signature in array array[
    'public.complete_ai_media_generation_v2(uuid,uuid,uuid,jsonb)',
    'public.fail_ai_media_generation_v2(uuid,uuid,text,text,jsonb)',
    'public.ai_media_expire_account_reservations(uuid,integer)',
    'public.expire_ai_media_generation_reservations(integer)',
    'public.ai_media_complete_temporary_draft_quota()'
  ] loop
    select pg_get_functiondef(v_signature::regprocedure) into v_source;
  v_source := replace(v_source,E'\r\n',E'\n');
    if strpos(v_source,'u.reserved_count - v_job.quota_amount')=0 then raise exception 'VIDEO_CREDITS_TERMINAL_FUNCTION_DRIFT: %',v_signature; end if;
    v_source:=replace(v_source,'u.used_count + v_job.quota_amount','u.used_count + (v_job.quota_amount - v_job.purchased_quota_amount)');
    v_source:=replace(v_source,'u.reserved_count - v_job.quota_amount','u.reserved_count - (v_job.quota_amount - v_job.purchased_quota_amount)');
    v_source:=replace(v_source,'u.reserved_count >= v_job.quota_amount','u.reserved_count >= (v_job.quota_amount - v_job.purchased_quota_amount)');
    v_source:=replace(v_source,'v_reserved < v_job.quota_amount','v_reserved < (v_job.quota_amount - v_job.purchased_quota_amount)');
    if v_signature like 'public.complete_%' or v_signature like 'public.fail_%' then
      v_old:=E'  limit_count := v_job.monthly_limit;\n  used_count := v_used;';
      v_new:=E'  limit_count := v_job.monthly_limit;\n  if v_job.media_kind = ''video'' and v_job.monthly_limit > 0 then\n    select limit_count+c.credit_limit,v_used+c.credit_used,v_reserved+c.credit_reserved\n      into limit_count,v_used,v_reserved from public.ai_media_video_credit_metrics(p_account_id) c;\n  end if;\n  used_count := v_used;';
      if strpos(v_source,v_old)=0 then raise exception 'VIDEO_CREDITS_TERMINAL_PRESENTATION_DRIFT'; end if;
      v_source:=replace(v_source,v_old,v_new);
      v_source:=replace(v_source,'remaining_count := greatest(v_job.monthly_limit - v_used - v_reserved, 0);','remaining_count := greatest(limit_count - v_used - v_reserved, 0);');
    end if;
    execute v_source;
  end loop;
end;
$$;

create function public.get_ai_media_generation_quota_v3(p_account_id uuid,p_actor_auth_user_id uuid,p_edition text)
returns table(account_id uuid,edition text,studio_enabled boolean,media_kind text,quota_unit text,
  limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz,
  included_remaining_count integer,purchased_remaining_count integer,purchased_reserved_count integer,purchased_debt_count integer,
  purchased_held_count integer,purchased_suspended_deficit_count integer,
  included_limit_count integer,included_used_count integer,included_reserved_count integer)
-- Monthly-only counters remain honest after purchased usage spans months.
language plpgsql volatile security invoker set search_path = '' as $$
declare v_quota record; v_credits record;
begin
  -- v2 enforces account membership, expires jobs, prepares monthly rollover and
  -- locks the wallet. Both the total and its breakdown belong to one transaction.
  for v_quota in select * from public.get_ai_media_generation_quota_v2(p_account_id,p_actor_auth_user_id,p_edition) loop
    account_id:=v_quota.account_id; edition:=v_quota.edition; studio_enabled:=v_quota.studio_enabled;
    media_kind:=v_quota.media_kind; quota_unit:=v_quota.quota_unit; limit_count:=v_quota.limit_count;
    used_count:=v_quota.used_count; reserved_count:=v_quota.reserved_count; remaining_count:=v_quota.remaining_count;
    period_start:=v_quota.period_start; reset_at:=v_quota.reset_at;
    select u.allocated_limit,u.used_count,u.reserved_count
      into included_limit_count,included_used_count,included_reserved_count
    from public.ai_media_monthly_usage u
    where u.account_id=p_account_id and u.media_kind=v_quota.media_kind and u.period_start=v_quota.period_start;
    if not found then raise exception 'VIDEO_CREDITS_MONTHLY_BREAKDOWN_MISSING'; end if;
    purchased_remaining_count:=0; purchased_reserved_count:=0; purchased_debt_count:=0;
    purchased_held_count:=0; purchased_suspended_deficit_count:=0;
    if media_kind='video' then
      select * into v_credits from public.ai_media_video_credit_metrics(p_account_id);
      purchased_remaining_count:=least(v_credits.credit_remaining,remaining_count);
      purchased_reserved_count:=v_credits.credit_reserved; purchased_debt_count:=v_credits.credit_debt;
      purchased_held_count:=v_credits.credit_held; purchased_suspended_deficit_count:=v_credits.credit_suspended_deficit;
    end if;
    included_remaining_count:=greatest(remaining_count-purchased_remaining_count,0);
    return next;
  end loop;
end;
$$;
revoke all on function public.get_ai_media_generation_quota_v3(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.get_ai_media_generation_quota_v3(uuid,uuid,text) to service_role;

commit;
