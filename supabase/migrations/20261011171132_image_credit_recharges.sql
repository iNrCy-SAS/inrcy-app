-- Purchased images have an independent persistent wallet. Monthly plans and video wallets are unchanged.
-- Generated against the deployed video-credit schema; fail closed if quota definitions have drifted.
begin;

do $$
begin
  if to_regclass('public.ai_media_video_credit_balances') is null
     or to_regprocedure('public.get_ai_media_generation_quota_v3(uuid,uuid,text)') is null
     or not exists(select 1 from information_schema.columns where table_schema='public'
       and table_name='ai_media_generation_jobs' and column_name='purchased_quota_amount') then
    raise exception 'IMAGE_CREDITS_PREFLIGHT_FAILED';
  end if;
  if (select count(*) from public.ai_media_plan_limits where edition in ('standard','premium','founder'))<>3
     or exists(select 1 from public.ai_media_plan_limits where
       (edition='standard' and (image_monthly_limit<>25 or video_monthly_limit<>54))
       or (edition='premium' and (image_monthly_limit<>70 or video_monthly_limit<>204))
       or (edition='founder' and (image_monthly_limit<>50 or video_monthly_limit<>144))) then
    raise exception 'IMAGE_CREDITS_UNEXPECTED_MONTHLY_LIMITS';
  end if;
end;
$$;

-- One immutable split per job, measured in the unit of media_kind. Existing video rows are untouched.
do $$
declare v_constraint record; v_count integer:=0;
begin
  for v_constraint in select c.conname,pg_get_constraintdef(c.oid) as definition from pg_constraint c
    where c.conrelid='public.ai_media_generation_jobs'::regclass and c.contype='c'
      and pg_get_constraintdef(c.oid) like '%purchased_quota_amount%'
  loop
    if strpos(v_constraint.definition,'media_kind')=0 or strpos(v_constraint.definition,'''video''')=0 then
      raise exception 'IMAGE_CREDITS_JOB_CONSTRAINT_DRIFT';
    end if;
    v_count:=v_count+1;
    execute format('alter table public.ai_media_generation_jobs drop constraint %I',v_constraint.conname);
  end loop;
  if v_count<>1 then raise exception 'IMAGE_CREDITS_JOB_CONSTRAINT_DRIFT'; end if;
end;
$$;
alter table public.ai_media_generation_jobs add constraint ai_media_generation_jobs_purchased_amount_check
  check(purchased_quota_amount>=0 and purchased_quota_amount<=quota_amount);
comment on column public.ai_media_generation_jobs.purchased_quota_amount is
  'Immutable purchased portion of this job, in images for image jobs or seconds for video jobs; the remainder uses the included monthly allowance.';

-- Route a purchased job to exactly one ledger, never to the other media's wallet.
drop trigger ai_media_video_credit_job_ledger on public.ai_media_generation_jobs;
create trigger ai_media_video_credit_job_ledger after insert or update of status,purchased_quota_amount
on public.ai_media_generation_jobs for each row when (new.media_kind='video')
execute function public.ai_media_video_credit_job_ledger();

create table public.ai_media_image_credit_packs (
  pack_key text primary key,
  images integer not null check (images > 0),
  amount_ht_cents integer not null check (amount_ht_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  active boolean not null default true
);
insert into public.ai_media_image_credit_packs(pack_key,images,amount_ht_cents)
values ('image_20',20,500),('image_50',50,1000),('image_100',100,1900);

create table public.ai_media_image_credit_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.inrcy_accounts(id) on delete restrict,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  request_key text not null check (length(request_key) between 8 and 180),
  pack_key text not null references public.ai_media_image_credit_packs(pack_key),
  images integer not null check (images > 0),
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
  revoked_images integer not null default 0 check (revoked_images >= 0 and revoked_images <= images),
  held_images integer not null default 0 check (held_images >= 0 and held_images <= images),
  dispute_revoked_images integer not null default 0 check (dispute_revoked_images >= 0 and dispute_revoked_images <= images),
  granted_at timestamptz,
  checkout_attempted_at timestamptz,
  checkout_params text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,request_key)
);
create index ai_media_image_credit_orders_account_created_idx
on public.ai_media_image_credit_orders(account_id,created_at desc);

create table public.ai_media_image_credit_balances (
  account_id uuid primary key references public.inrcy_accounts(id) on delete restrict,
  granted_images integer not null default 0 check (granted_images >= 0),
  revoked_images integer not null default 0 check (revoked_images >= 0 and revoked_images <= granted_images),
  used_images integer not null default 0 check (used_images >= 0),
  reserved_images integer not null default 0 check (reserved_images >= 0),
  held_images integer not null default 0 check (held_images >= 0),
  dispute_revoked_images integer not null default 0 check (dispute_revoked_images >= 0),
  check (revoked_images + dispute_revoked_images <= granted_images),
  updated_at timestamptz not null default now()
);
-- A refund after consumption may leave a paid-credit debt. It never removes
-- the subscription allowance; subsequent purchases repay that paid-credit debt.
create table public.ai_media_image_credit_ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.inrcy_accounts(id) on delete restrict,
  order_id uuid references public.ai_media_image_credit_orders(id) on delete restrict,
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
create index ai_media_image_credit_ledger_account_created_idx
on public.ai_media_image_credit_ledger(account_id,created_at desc);

create table public.ai_media_image_credit_disputes (
  stripe_dispute_id text primary key check (stripe_dispute_id ~ '^d[up]_[a-zA-Z0-9_]+$'),
  order_id uuid not null references public.ai_media_image_credit_orders(id) on delete restrict,
  account_id uuid not null references public.inrcy_accounts(id) on delete restrict,
  stripe_charge_id text not null check (stripe_charge_id ~ '^ch_[a-zA-Z0-9_]+$'),
  stripe_payment_intent_id text not null check (stripe_payment_intent_id ~ '^pi_[a-zA-Z0-9_]+$'),
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  stripe_status text not null check (stripe_status in ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented')),
  effect text not null check (effect in ('held','lost','released')),
  affected_images integer not null check (affected_images >= 0),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
create index ai_media_image_credit_disputes_order_idx on public.ai_media_image_credit_disputes(order_id);

alter table public.ai_media_image_credit_packs enable row level security;
alter table public.ai_media_image_credit_orders enable row level security;
alter table public.ai_media_image_credit_balances enable row level security;
alter table public.ai_media_image_credit_ledger enable row level security;
alter table public.ai_media_image_credit_disputes enable row level security;
revoke all on public.ai_media_image_credit_packs,public.ai_media_image_credit_orders,
  public.ai_media_image_credit_balances,public.ai_media_image_credit_ledger,public.ai_media_image_credit_disputes from public,anon,authenticated;
grant select,insert,update on public.ai_media_image_credit_packs,public.ai_media_image_credit_orders,
  public.ai_media_image_credit_balances,public.ai_media_image_credit_disputes to service_role;
grant select,insert on public.ai_media_image_credit_ledger to service_role;
grant usage,select on sequence public.ai_media_image_credit_ledger_id_seq to service_role;
-- History can only be read for an account the authenticated actor can access.
grant select on public.ai_media_image_credit_orders,public.ai_media_image_credit_ledger,public.ai_media_image_credit_disputes to authenticated;
create policy image_credit_orders_read on public.ai_media_image_credit_orders for select to authenticated
using (public.inrcy_can_access_account(account_id));
create policy image_credit_disputes_read on public.ai_media_image_credit_disputes for select to authenticated
using (public.inrcy_can_access_account(account_id));
create policy image_credit_ledger_read on public.ai_media_image_credit_ledger for select to authenticated
using (public.inrcy_can_access_account(account_id));

create function public.ai_media_image_credit_metrics(p_account_id uuid)
returns table(credit_limit integer,credit_used integer,credit_reserved integer,credit_remaining integer,credit_debt integer,credit_held integer,credit_suspended_deficit integer)
language plpgsql volatile security invoker set search_path = '' as $$
declare v_balance public.ai_media_image_credit_balances%rowtype;
begin
  insert into public.ai_media_image_credit_balances(account_id) values(p_account_id) on conflict do nothing;
  select b.* into v_balance from public.ai_media_image_credit_balances b where b.account_id = p_account_id for update;
  return query select
    greatest(v_balance.granted_images-v_balance.revoked_images-v_balance.dispute_revoked_images-v_balance.held_images,v_balance.used_images+v_balance.reserved_images),
    v_balance.used_images,v_balance.reserved_images,
    greatest(v_balance.granted_images-v_balance.revoked_images-v_balance.dispute_revoked_images-v_balance.held_images-v_balance.used_images-v_balance.reserved_images,0),
    greatest(v_balance.used_images+v_balance.reserved_images-v_balance.granted_images+v_balance.revoked_images+v_balance.dispute_revoked_images,0),
    v_balance.held_images,
    greatest(v_balance.used_images+v_balance.reserved_images-v_balance.granted_images+v_balance.revoked_images+v_balance.dispute_revoked_images+v_balance.held_images,0)
      -greatest(v_balance.used_images+v_balance.reserved_images-v_balance.granted_images+v_balance.revoked_images+v_balance.dispute_revoked_images,0);
end;
$$;
revoke all on function public.ai_media_image_credit_metrics(uuid) from public,anon,authenticated;
grant execute on function public.ai_media_image_credit_metrics(uuid) to service_role;

create function public.create_ai_media_image_credit_order(
  p_account_id uuid,p_actor_auth_user_id uuid,p_pack_key text,p_request_key text,p_stripe_price_id text
)
returns setof public.ai_media_image_credit_orders
language plpgsql volatile security invoker set search_path = '' as $$
declare v_pack public.ai_media_image_credit_packs%rowtype; v_order public.ai_media_image_credit_orders%rowtype;
begin
  perform public.ai_media_assert_account_actor(p_account_id,p_actor_auth_user_id);
  if not exists (select 1 from public.inrcy_account_members m where m.account_id=p_account_id
    and m.auth_user_id=p_actor_auth_user_id and m.role in ('owner','admin')) then
    raise exception 'IMAGE_CREDITS_PURCHASE_ACCESS_DENIED';
  end if;
  if not exists (select 1 from public.subscriptions s where s.user_id=p_account_id and s.status in ('active','trialing')) then
    raise exception 'IMAGE_CREDITS_ACTIVE_SUBSCRIPTION_REQUIRED';
  end if;
  if length(coalesce(p_request_key,'')) not between 8 and 180 then raise exception 'IMAGE_CREDITS_INVALID_REQUEST_KEY'; end if;
  select p.* into v_pack from public.ai_media_image_credit_packs p where p.pack_key=p_pack_key and p.active;
  if not found then raise exception 'IMAGE_CREDITS_UNKNOWN_PACK'; end if;
  insert into public.ai_media_image_credit_orders(account_id,actor_auth_user_id,request_key,pack_key,images,amount_ht_cents,stripe_price_id)
  values(p_account_id,p_actor_auth_user_id,p_request_key,p_pack_key,v_pack.images,v_pack.amount_ht_cents,p_stripe_price_id)
  on conflict(account_id,request_key) do nothing;
  select o.* into v_order from public.ai_media_image_credit_orders o where o.account_id=p_account_id and o.request_key=p_request_key for update;
  if v_order.pack_key<>p_pack_key or v_order.stripe_price_id<>p_stripe_price_id
     or v_order.actor_auth_user_id<>p_actor_auth_user_id then raise exception 'IMAGE_CREDITS_IDEMPOTENCY_CONFLICT'; end if;
  return next v_order;
end;
$$;
revoke all on function public.create_ai_media_image_credit_order(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.create_ai_media_image_credit_order(uuid,uuid,text,text,text) to service_role;

create function public.prepare_ai_media_image_credit_checkout(
  p_order_id uuid,p_account_id uuid,p_params text,p_customer_id text,p_livemode boolean
)
returns setof public.ai_media_image_credit_orders
language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_image_credit_orders%rowtype;
begin
  select o.* into v_order from public.ai_media_image_credit_orders o where o.id=p_order_id and o.account_id=p_account_id for update;
  if not found then raise exception 'IMAGE_CREDITS_ORDER_NOT_FOUND'; end if;
  if v_order.granted_at is not null then raise exception 'IMAGE_CREDITS_ALREADY_PAID'; end if;
  if v_order.checkout_params is null then
    update public.ai_media_image_credit_orders o set checkout_params=p_params,checkout_attempted_at=now(),
      stripe_customer_id=p_customer_id,stripe_livemode=p_livemode,updated_at=now()
    where o.id=v_order.id returning o.* into v_order;
  end if;
  return next v_order;
end;
$$;
revoke all on function public.prepare_ai_media_image_credit_checkout(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.prepare_ai_media_image_credit_checkout(uuid,uuid,text,text,boolean) to service_role;

-- The caller holds the order before locking its shared wallet. Refunds and
-- disputes compose without removing the same purchased images twice.
create function public.refresh_ai_media_image_credit_dispute_totals(
  p_order_id uuid,p_entry_key text,p_stripe_event_id text,p_refunded_images integer default null
)
returns void language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_image_credit_orders%rowtype; v_loss integer; v_held integer;
  v_loss_delta integer; v_held_delta integer; v_available integer;
begin
  select o.* into v_order from public.ai_media_image_credit_orders o where o.id=p_order_id for update;
  if not found then raise exception 'IMAGE_CREDITS_ORDER_NOT_FOUND'; end if;
  if v_order.granted_at is null then return; end if;
  v_available:=v_order.images-coalesce(p_refunded_images,v_order.revoked_images);
  if v_available<0 or v_available>v_order.images then raise exception 'IMAGE_CREDITS_DISPUTE_SCOPE_MISMATCH'; end if;
  select least(coalesce(sum(d.affected_images),0),v_available)::integer into v_loss
  from public.ai_media_image_credit_disputes d where d.order_id=p_order_id and d.effect='lost';
  select least(coalesce(sum(d.affected_images),0),v_available-v_loss)::integer into v_held
  from public.ai_media_image_credit_disputes d where d.order_id=p_order_id and d.effect='held';
  v_loss_delta:=v_loss-v_order.dispute_revoked_images; v_held_delta:=v_held-v_order.held_images;
  if v_loss_delta=0 and v_held_delta=0 then return; end if;
  update public.ai_media_image_credit_balances b
  set dispute_revoked_images=b.dispute_revoked_images+v_loss_delta,held_images=b.held_images+v_held_delta,updated_at=now()
  where b.account_id=v_order.account_id;
  if not found then raise exception 'IMAGE_CREDITS_DISPUTE_WALLET_MISSING'; end if;
  update public.ai_media_image_credit_orders o set dispute_revoked_images=v_loss,held_images=v_held,updated_at=now() where o.id=p_order_id;
  insert into public.ai_media_image_credit_ledger(account_id,order_id,entry_key,kind,held_delta,dispute_revoked_delta,stripe_event_id)
  values(v_order.account_id,p_order_id,p_entry_key,
    case when v_loss_delta>0 then 'dispute_loss' when v_held_delta>0 then 'dispute_hold' else 'dispute_release' end,
    v_held_delta,v_loss_delta,p_stripe_event_id);
end;
$$;
revoke all on function public.refresh_ai_media_image_credit_dispute_totals(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.refresh_ai_media_image_credit_dispute_totals(uuid,text,text,integer) to service_role;

create function public.reconcile_ai_media_image_credit_dispute(
  p_order_id uuid,p_account_id uuid,p_payment_intent_id text,p_dispute_id text,p_charge_id text,
  p_amount_cents integer,p_charge_amount_cents integer,p_currency text,p_status text,p_stripe_event_id text
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_image_credit_orders%rowtype; v_old public.ai_media_image_credit_disputes%rowtype;
  v_effect text; v_images integer; v_version integer;
begin
  select o.* into v_order from public.ai_media_image_credit_orders o where o.id=p_order_id and o.account_id=p_account_id for update;
  if not found then raise exception 'IMAGE_CREDITS_ORDER_NOT_FOUND'; end if;
  if p_dispute_id is null or p_dispute_id !~ '^d[up]_[a-zA-Z0-9_]+$'
     or p_charge_id is null or p_charge_id !~ '^ch_[a-zA-Z0-9_]+$'
     or p_payment_intent_id is null or p_payment_intent_id !~ '^pi_[a-zA-Z0-9_]+$'
     or (v_order.stripe_payment_intent_id is not null and v_order.stripe_payment_intent_id<>p_payment_intent_id)
     or p_amount_cents is null or p_amount_cents<=0 or p_charge_amount_cents is null or p_charge_amount_cents<v_order.amount_ht_cents
     or (v_order.amount_total_cents is not null and v_order.amount_total_cents<>p_charge_amount_cents)
     or p_currency is null or p_currency !~ '^[a-z]{3}$'
     or p_status is null or p_status not in ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented') then
    raise exception 'IMAGE_CREDITS_DISPUTE_SCOPE_MISMATCH';
  end if;
  v_effect:=case when p_status='lost' then 'lost' when p_status in ('won','warning_closed','prevented') then 'released' else 'held' end;
  -- Currency conversion or a disputed amount above the original charge is
  -- possible. An unconvertible currency safely suspends the whole paid pack.
  v_images:=case when p_currency<>v_order.currency then v_order.images else
    least(v_order.images::bigint,(v_order.images::bigint*p_amount_cents+p_charge_amount_cents-1)/p_charge_amount_cents)::integer end;
  select d.* into v_old from public.ai_media_image_credit_disputes d where d.stripe_dispute_id=p_dispute_id for update;
  if found then
    if v_old.order_id<>p_order_id or v_old.stripe_charge_id<>p_charge_id or v_old.stripe_payment_intent_id<>p_payment_intent_id then
      raise exception 'IMAGE_CREDITS_DISPUTE_SCOPE_MISMATCH';
    end if;
    -- Reads may arrive out of order even when they reread Stripe. A released
    -- dispute never regresses to a hold/loss; a late reinstatement may reverse
    -- lost to won. A new dispute uses a new Stripe ID.
    if v_old.effect='released' and v_effect<>'released' then return false; end if;
    if v_old.effect='lost' and v_effect='held' then return false; end if;
    if v_old.stripe_status=p_status and v_old.amount_cents=p_amount_cents and v_old.currency=p_currency then return false; end if;
    v_version:=v_old.version+1;
    update public.ai_media_image_credit_disputes d set amount_cents=p_amount_cents,currency=p_currency,stripe_status=p_status,
      effect=v_effect,affected_images=v_images,version=v_version,updated_at=now() where d.stripe_dispute_id=p_dispute_id;
  else
    v_version:=1;
    insert into public.ai_media_image_credit_disputes(stripe_dispute_id,order_id,account_id,stripe_charge_id,stripe_payment_intent_id,
      amount_cents,currency,stripe_status,effect,affected_images)
    values(p_dispute_id,p_order_id,p_account_id,p_charge_id,p_payment_intent_id,p_amount_cents,p_currency,p_status,v_effect,v_images);
  end if;
  perform public.refresh_ai_media_image_credit_dispute_totals(p_order_id,'dispute:'||p_dispute_id||':'||v_version::text,p_stripe_event_id);
  return true;
end;
$$;
revoke all on function public.reconcile_ai_media_image_credit_dispute(uuid,uuid,text,text,text,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_ai_media_image_credit_dispute(uuid,uuid,text,text,text,integer,integer,text,text,text) to service_role;

create function public.fulfill_ai_media_image_credit_order(
  p_order_id uuid,p_account_id uuid,p_checkout_session_id text,p_payment_intent_id text,
  p_customer_id text,p_livemode boolean,p_amount_subtotal_cents integer,p_amount_total_cents integer,
  p_currency text,p_stripe_event_id text,p_refunded_amount_cents integer default 0,p_disputes jsonb default '[]'::jsonb
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_image_credit_orders%rowtype; v_dispute jsonb; v_granted boolean:=false;
begin
  select o.* into v_order from public.ai_media_image_credit_orders o where o.id=p_order_id and o.account_id=p_account_id for update;
  if not found then raise exception 'IMAGE_CREDITS_ORDER_NOT_FOUND'; end if;
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
    raise exception 'IMAGE_CREDITS_PAYMENT_SCOPE_MISMATCH';
  end if;
  if v_order.granted_at is null then
  insert into public.ai_media_image_credit_balances(account_id) values(p_account_id) on conflict do nothing;
  update public.ai_media_image_credit_balances b
  set granted_images=b.granted_images+v_order.images,updated_at=now() where b.account_id=p_account_id;
  insert into public.ai_media_image_credit_ledger(account_id,order_id,entry_key,kind,granted_delta,stripe_event_id)
  values(p_account_id,v_order.id,'purchase:'||v_order.id::text,'purchase',v_order.images,p_stripe_event_id);
  update public.ai_media_image_credit_orders o
  set status='paid',granted_at=now(),stripe_checkout_session_id=p_checkout_session_id,
    stripe_payment_intent_id=p_payment_intent_id,stripe_customer_id=p_customer_id,stripe_livemode=p_livemode,
    amount_total_cents=p_amount_total_cents,updated_at=now() where o.id=v_order.id;
    v_granted:=true;
  end if;
  if p_refunded_amount_cents > 0 then perform public.refund_ai_media_image_credit_order(v_order.id,p_payment_intent_id,p_refunded_amount_cents,p_stripe_event_id); end if;
  for v_dispute in select value from jsonb_array_elements(p_disputes) loop
    perform public.reconcile_ai_media_image_credit_dispute(v_order.id,p_account_id,p_payment_intent_id,
      v_dispute->>'id',v_dispute->>'charge_id',(v_dispute->>'amount')::integer,p_amount_total_cents,
      v_dispute->>'currency',v_dispute->>'status',p_stripe_event_id);
  end loop;
  -- Disputes received before the initial credit remain durable. Even a
  -- repeated state must be projected onto the newly funded wallet atomically.
  if v_granted then perform public.refresh_ai_media_image_credit_dispute_totals(v_order.id,'dispute-initial:'||v_order.id::text,p_stripe_event_id); end if;
  return v_granted;
end;
$$;
revoke all on function public.fulfill_ai_media_image_credit_order(uuid,uuid,text,text,text,boolean,integer,integer,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.fulfill_ai_media_image_credit_order(uuid,uuid,text,text,text,boolean,integer,integer,text,text,integer,jsonb) to service_role;

create function public.refund_ai_media_image_credit_order(
  p_order_id uuid,p_payment_intent_id text,p_refunded_amount_cents integer,p_stripe_event_id text
)
returns boolean language plpgsql volatile security invoker set search_path = '' as $$
declare v_order public.ai_media_image_credit_orders%rowtype; v_revoked integer; v_delta integer;
begin
  select o.* into v_order from public.ai_media_image_credit_orders o where o.id=p_order_id for update;
  if not found then raise exception 'IMAGE_CREDITS_ORDER_NOT_FOUND'; end if;
  -- A refund arriving before fulfillment must be retried, never acknowledged
  -- without a durable revocation. Fulfillment also reconciles current refunds.
  if v_order.granted_at is null then raise exception 'IMAGE_CREDITS_REFUND_AWAITS_FULFILLMENT'; end if;
  if v_order.stripe_payment_intent_id is distinct from p_payment_intent_id
     or p_refunded_amount_cents is null or p_refunded_amount_cents < 0
     or p_refunded_amount_cents > v_order.amount_total_cents then raise exception 'IMAGE_CREDITS_REFUND_SCOPE_MISMATCH'; end if;
  if p_refunded_amount_cents <= v_order.refunded_amount_cents then return false; end if;
  v_revoked := (v_order.images::bigint*p_refunded_amount_cents/v_order.amount_total_cents)::integer;
  v_delta := v_revoked-v_order.revoked_images;
  perform public.refresh_ai_media_image_credit_dispute_totals(v_order.id,'refund-dispute:'||v_order.id::text||':'||p_refunded_amount_cents::text,p_stripe_event_id,v_revoked);
  update public.ai_media_image_credit_balances b
  set revoked_images=b.revoked_images+v_delta,updated_at=now() where b.account_id=v_order.account_id;
  insert into public.ai_media_image_credit_ledger(account_id,order_id,entry_key,kind,revoked_delta,stripe_event_id)
  values(v_order.account_id,v_order.id,'refund:'||v_order.id::text||':'||p_refunded_amount_cents::text,'refund',v_delta,p_stripe_event_id);
  update public.ai_media_image_credit_orders o set refunded_amount_cents=p_refunded_amount_cents,revoked_images=v_revoked,
    status=case when p_refunded_amount_cents=o.amount_total_cents then 'refunded' else 'paid' end,updated_at=now() where o.id=v_order.id;
  return true;
end;
$$;
revoke all on function public.refund_ai_media_image_credit_order(uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.refund_ai_media_image_credit_order(uuid,text,integer,text) to service_role;

create function public.ai_media_image_credit_job_ledger()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_kind text; v_used integer:=0; v_reserved integer:=0;
begin
  if tg_op='UPDATE' and new.purchased_quota_amount is distinct from old.purchased_quota_amount then
    raise exception 'AI_MEDIA_QUOTA_LEDGER_IMMUTABLE';
  end if;
  if new.purchased_quota_amount=0 then return new; end if;
  if tg_op='INSERT' then
    if new.status<>'reserved' then raise exception 'IMAGE_CREDITS_INVALID_INITIAL_JOB_STATUS'; end if;
    v_kind:='reservation'; v_reserved:=new.purchased_quota_amount;
    update public.ai_media_image_credit_balances b set reserved_images=b.reserved_images+v_reserved,updated_at=now()
    where b.account_id=new.account_id and b.granted_images-b.revoked_images-b.dispute_revoked_images-b.held_images-b.used_images-b.reserved_images>=v_reserved;
  elsif old.status in ('reserved','processing') and new.status in ('completed','failed','expired') then
    v_kind:=case when new.status='completed' then 'completion' else 'release' end;
    v_used:=case when new.status='completed' then new.purchased_quota_amount else 0 end;
    v_reserved:=-new.purchased_quota_amount;
    update public.ai_media_image_credit_balances b set used_images=b.used_images+v_used,
      reserved_images=b.reserved_images+v_reserved,updated_at=now()
    where b.account_id=new.account_id and b.reserved_images>=new.purchased_quota_amount;
  else return new;
  end if;
  if not found then raise exception 'IMAGE_CREDITS_RESERVATION_INVARIANT_BROKEN'; end if;
  insert into public.ai_media_image_credit_ledger(account_id,job_id,entry_key,kind,used_delta,reserved_delta)
  values(new.account_id,new.id,'job:'||new.id::text||':'||v_kind,v_kind,v_used,v_reserved);
  return new;
end;
$$;
revoke all on function public.ai_media_image_credit_job_ledger() from public,anon,authenticated;
grant execute on function public.ai_media_image_credit_job_ledger() to service_role;
create trigger ai_media_image_credit_job_ledger after insert or update of status,purchased_quota_amount
on public.ai_media_generation_jobs for each row when (new.media_kind='image') execute function public.ai_media_image_credit_job_ledger();


-- Fixed domain dispatch: reservation/termination lock only their monthly counter then their own wallet.
-- Payment handlers retain order -> wallet ordering and do not lock monthly quota rows.
create function public.ai_media_purchased_credit_metrics(p_account_id uuid,p_media_kind text)
returns table(credit_limit integer,credit_used integer,credit_reserved integer,credit_remaining integer,
  credit_debt integer,credit_held integer,credit_suspended_deficit integer)
language plpgsql volatile security invoker set search_path='' as $$
begin
  if p_media_kind='image' then return query select * from public.ai_media_image_credit_metrics(p_account_id);
  elsif p_media_kind='video' then return query select * from public.ai_media_video_credit_metrics(p_account_id);
  else raise exception 'AI_MEDIA_INVALID_KIND'; end if;
end;
$$;
revoke all on function public.ai_media_purchased_credit_metrics(uuid,text) from public,anon,authenticated;
grant execute on function public.ai_media_purchased_credit_metrics(uuid,text) to service_role;

do $$
declare v_source text; v_old text; v_new text; v_signature text;
begin
  select replace(pg_get_functiondef('public.get_ai_media_generation_quota_v2(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n') into v_source;
  v_old:=E'  media_kind := ''image'';\n  quota_unit := ''item'';';
  v_new:=E'  if v_image_base > 0 then\n    select v_image_limit+c.credit_limit,v_image_used+c.credit_used,v_image_reserved+c.credit_reserved\n      into v_image_limit,v_image_used,v_image_reserved\n    from public.ai_media_image_credit_metrics(p_account_id) c;\n  end if;\n  media_kind := ''image'';\n  quota_unit := ''item'';';
  if strpos(v_source,v_old)=0 then raise exception 'IMAGE_CREDITS_QUOTA_FUNCTION_DRIFT'; end if;
  execute replace(v_source,v_old,v_new);

  select replace(pg_get_functiondef('public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure),E'\r\n',E'\n') into v_source;
  v_old:=E'  if v_media_kind = ''video'' and p_limit_override is null and v_base_limit > 0 then\n    select * into v_credits from public.ai_media_video_credit_metrics(p_account_id);';
  v_new:=E'  if p_limit_override is null and v_base_limit > 0 then\n    select * into v_credits from public.ai_media_purchased_credit_metrics(p_account_id,v_media_kind);';
  if strpos(v_source,v_old)=0 then raise exception 'IMAGE_CREDITS_RESERVE_BALANCE_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  v_old:=E'    if v_job.media_kind = ''video'' and v_job.monthly_limit > 0 then\n      select v_limit+c.credit_limit,v_used+c.credit_used,v_reserved+c.credit_reserved\n        into v_limit,v_used,v_reserved from public.ai_media_video_credit_metrics(p_account_id) c;';
  v_new:=E'    if v_job.monthly_limit > 0 then\n      select v_limit+c.credit_limit,v_used+c.credit_used,v_reserved+c.credit_reserved\n        into v_limit,v_used,v_reserved from public.ai_media_purchased_credit_metrics(p_account_id,v_job.media_kind) c;';
  if strpos(v_source,v_old)=0 then raise exception 'IMAGE_CREDITS_RESERVE_REPLAY_DRIFT'; end if;
  execute replace(v_source,v_old,v_new);

  foreach v_signature in array array['public.complete_ai_media_generation_v2(uuid,uuid,uuid,jsonb)',
    'public.fail_ai_media_generation_v2(uuid,uuid,text,text,jsonb)'] loop
    select replace(pg_get_functiondef(v_signature::regprocedure),E'\r\n',E'\n') into v_source;
    v_old:=E'  if v_job.media_kind = ''video'' and v_job.monthly_limit > 0 then\n    select limit_count+c.credit_limit,v_used+c.credit_used,v_reserved+c.credit_reserved\n      into limit_count,v_used,v_reserved from public.ai_media_video_credit_metrics(p_account_id) c;';
    v_new:=E'  if v_job.monthly_limit > 0 then\n    select limit_count+c.credit_limit,v_used+c.credit_used,v_reserved+c.credit_reserved\n      into limit_count,v_used,v_reserved from public.ai_media_purchased_credit_metrics(p_account_id,v_job.media_kind) c;';
    if strpos(v_source,v_old)=0 then raise exception 'IMAGE_CREDITS_TERMINAL_PRESENTATION_DRIFT: %',v_signature; end if;
    execute replace(v_source,v_old,v_new);
  end loop;

  select replace(pg_get_functiondef('public.get_ai_media_generation_quota_v3(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n') into v_source;
  v_old:=E'    if media_kind=''video'' then\n      select * into v_credits from public.ai_media_video_credit_metrics(p_account_id);';
  v_new:=E'    if media_kind in (''image'',''video'') then\n      select * into v_credits from public.ai_media_purchased_credit_metrics(p_account_id,media_kind);';
  if strpos(v_source,v_old)=0 then raise exception 'IMAGE_CREDITS_QUOTA_BREAKDOWN_DRIFT'; end if;
  execute replace(v_source,v_old,v_new);
end;
$$;

-- No UPDATE of ai_media_plan_limits: all included quotas, caps and subscription anchors are preserved.
commit;
