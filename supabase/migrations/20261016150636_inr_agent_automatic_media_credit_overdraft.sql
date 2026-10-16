-- Automatic iNr'Agent preparation may advance included credits. Manual
-- reservations remain strictly funded. Debt survives every monthly recharge.
begin;
do $$ begin
  if to_regclass('public.inr_agent_actions') is null or to_regclass('public.ai_media_credit_wallets') is null then
    raise exception 'AI_MEDIA_OVERDRAFT_DEPENDENCY_MISSING';
  end if;
end $$;
alter table public.ai_media_credit_periods add column carried_debt_count integer not null default 0
  check(carried_debt_count>=0 and carried_debt_count<=used_count);
comment on column public.ai_media_credit_periods.carried_debt_count is 'Debt inherited at monthly recharge, included in used_count; a late failed reservation can restore it exactly once.';

create or replace function public.ai_media_credit_prepare(p_account_id uuid,p_actor_auth_user_id uuid,p_edition text)
returns date language plpgsql volatile security invoker set search_path='' as $$
declare v_period date:=date_trunc('month',timezone('UTC',now()))::date;
  v_plan record; v_image record; v_video record; v_previous public.ai_media_credit_periods%rowtype;
  v_current public.ai_media_credit_periods%rowtype; v_gap integer; v_limit integer; v_debt integer;
begin
  perform public.ai_media_assert_account_actor(p_account_id,p_actor_auth_user_id);
  select * into v_plan from public.ai_media_credit_plan(p_account_id,p_edition);
  -- Acquire legacy locks BEFORE the credit lock on the first import only.
  -- Legacy completions acquire their old rows then the bridge credit lock.
  if not exists(select 1 from public.ai_media_credit_wallets where account_id=p_account_id) then
    select * into v_image from public.get_ai_media_generation_quota_v3(p_account_id,p_actor_auth_user_id,p_edition) where media_kind='image';
    select * into v_video from public.get_ai_media_generation_quota_v3(p_account_id,p_actor_auth_user_id,p_edition) where media_kind='video';
    perform public.ai_media_credit_lock(p_account_id);
    if not exists(select 1 from public.ai_media_credit_wallets where account_id=p_account_id) then
      insert into public.ai_media_credit_wallets(account_id) values(p_account_id);
      insert into public.ai_media_credit_periods(account_id,period_start,allocated_limit,base_limit,rollover_cap,used_count,reserved_count)
      values(p_account_id,v_period,v_image.included_limit_count*7+v_video.included_limit_count*10,v_plan.base_limit,v_plan.rollover_cap,
        v_image.included_used_count*7+v_video.included_used_count*10,v_image.included_reserved_count*7+v_video.included_reserved_count*10);
      insert into public.ai_media_credit_legacy_sources(account_id,source_kind,conversion_key,factor,original_snapshot)
      values(p_account_id,'image','media-credits-v1:'||p_account_id::text||':image',7,to_jsonb(v_image)),
            (p_account_id,'video','media-credits-v1:'||p_account_id::text||':video',10,to_jsonb(v_video));
      insert into public.ai_media_credit_legacy_job_bridge(job_id,account_id,period_start,included_amount)
      select j.id,j.account_id,j.quota_period_start,(j.quota_amount-j.purchased_quota_amount)*case j.media_kind when 'image' then 7 else 10 end
      from public.ai_media_generation_jobs j where j.account_id=p_account_id and j.quota_unit<>'credit' and j.status in ('reserved','processing');
      insert into public.ai_media_credit_ledger(account_id,entry_key,kind,included_allocated_delta,metadata)
      values(p_account_id,'media-credits-v1:'||p_account_id::text,'migration',v_image.included_limit_count*7+v_video.included_limit_count*10,
        jsonb_build_object('image_factor',7,'video_factor',10,'source_orders_unchanged',true));
    end if;
  else
    perform public.ai_media_credit_lock(p_account_id);
  end if;
  select * into v_current from public.ai_media_credit_periods where account_id=p_account_id and period_start=v_period for update;
  if found then
    if v_current.base_limit<>v_plan.base_limit or v_current.rollover_cap<>v_plan.rollover_cap then
      update public.ai_media_credit_periods set
        allocated_limit=greatest(least(allocated_limit,used_count+reserved_count),least(carried_debt_count+v_plan.rollover_cap,greatest(allocated_limit+v_plan.base_limit-base_limit,0))),
        base_limit=v_plan.base_limit,rollover_cap=v_plan.rollover_cap
      where account_id=p_account_id and period_start=v_period;
    end if;
  else
    select * into v_previous from public.ai_media_credit_periods where account_id=p_account_id and period_start<v_period
      order by period_start desc limit 1 for update;
    if not found then raise exception 'AI_MEDIA_CREDIT_PERIOD_MISSING'; end if;
    v_gap:=(extract(year from v_period)::integer-extract(year from v_previous.period_start)::integer)*12
      +extract(month from v_period)::integer-extract(month from v_previous.period_start)::integer;
    v_debt:=greatest(v_previous.used_count+v_previous.reserved_count-v_previous.allocated_limit,0);
    -- Repay debt using all elapsed monthly allowances before capping a
    -- positive balance, including when the account was unused for months.
    v_limit:=(v_debt::bigint+least(v_plan.rollover_cap::bigint,
      v_previous.allocated_limit::bigint-v_previous.used_count-v_previous.reserved_count+v_plan.base_limit::bigint*v_gap))::integer;
    insert into public.ai_media_credit_periods(account_id,period_start,allocated_limit,base_limit,rollover_cap,used_count,carried_debt_count)
      values(p_account_id,v_period,v_limit,v_plan.base_limit,v_plan.rollover_cap,v_debt,v_debt);
    insert into public.ai_media_credit_ledger(account_id,entry_key,kind,included_allocated_delta,included_used_delta,metadata)
      values(p_account_id,'recharge:'||p_account_id::text||':'||v_period::text,'recharge',v_limit,v_debt,
        jsonb_build_object('period_start',v_period,'months',v_gap,'carried_debt',v_debt));
  end if;
  return v_period;
end $$;

create or replace function public.ai_media_credit_counter(p_account_id uuid,p_period_start date)
returns table(quota_unit text,limit_count integer,used_count integer,reserved_count integer,remaining_count integer,
  period_start date,reset_at timestamptz,included_remaining_count integer,purchased_remaining_count integer,purchased_reserved_count integer,
  purchased_debt_count integer,purchased_held_count integer,purchased_suspended_deficit_count integer,
  included_limit_count integer,included_used_count integer,included_reserved_count integer)
language plpgsql stable security invoker set search_path='' as $$
declare v_period public.ai_media_credit_periods%rowtype; v_wallet public.ai_media_credit_wallets%rowtype;
  v_funding integer; v_held integer; v_legacy_used integer; v_legacy_reserved integer; v_paid_used integer; v_paid_reserved integer; v_paid_limit integer;
begin
  select * into v_period from public.ai_media_credit_periods where account_id=p_account_id and ai_media_credit_periods.period_start=p_period_start;
  select * into v_wallet from public.ai_media_credit_wallets where account_id=p_account_id;
  if v_period.account_id is null or v_wallet.account_id is null then raise exception 'AI_MEDIA_CREDIT_WALLET_NOT_READY'; end if;
  -- Read-only source aggregation: there is no second copy of purchased rights.
  select coalesce(sum(x.funding),0)::integer,coalesce(sum(x.held),0)::integer,
    coalesce(sum(x.used),0)::integer,coalesce(sum(x.reserved),0)::integer
  into v_funding,v_held,v_legacy_used,v_legacy_reserved from (
    select (granted_seconds-revoked_seconds-dispute_revoked_seconds)*10 as funding,held_seconds*10 as held,
      used_seconds*10 as used,reserved_seconds*10 as reserved from public.ai_media_video_credit_balances where account_id=p_account_id
    union all
    select (granted_images-revoked_images-dispute_revoked_images)*7,held_images*7,used_images*7,reserved_images*7
      from public.ai_media_image_credit_balances where account_id=p_account_id
  ) x;
  v_paid_used:=v_legacy_used+v_wallet.purchased_used;
  v_paid_reserved:=v_legacy_reserved+v_wallet.purchased_reserved;
  v_paid_limit:=greatest(v_funding-v_held,v_paid_used+v_paid_reserved);
  return query select 'credit'::text,v_period.allocated_limit+v_paid_limit,v_period.used_count+v_paid_used,v_period.reserved_count+v_paid_reserved,
    (v_period.allocated_limit-v_period.used_count-v_period.reserved_count)+greatest(v_funding-v_held-v_paid_used-v_paid_reserved,0),
    p_period_start,((p_period_start+interval '1 month')::timestamp at time zone 'UTC'),
    (v_period.allocated_limit-v_period.used_count-v_period.reserved_count),greatest(v_funding-v_held-v_paid_used-v_paid_reserved,0),v_paid_reserved,
    greatest(v_paid_used+v_paid_reserved-v_funding,0),v_held,
    greatest(v_paid_used+v_paid_reserved-v_funding+v_held,0)-greatest(v_paid_used+v_paid_reserved-v_funding,0),
    v_period.allocated_limit,v_period.used_count,v_period.reserved_count;
end $$;

create or replace function public.ai_media_credit_release_included(p_account_id uuid,p_period date,p_amount integer,p_complete boolean)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare v_current date:=date_trunc('month',timezone('UTC',now()))::date; v_debt_refund integer; v_allocated_before integer; v_allocated_after integer;
begin
  if p_amount=0 then return; end if;
  update public.ai_media_credit_periods set reserved_count=reserved_count-p_amount,
    used_count=used_count+case when p_complete then p_amount else 0 end
    where account_id=p_account_id and period_start=p_period and reserved_count>=p_amount;
  if not found then raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN'; end if;
  if not p_complete and p_period<v_current then
    select least(p_amount,carried_debt_count),allocated_limit into v_debt_refund,v_allocated_before
      from public.ai_media_credit_periods where account_id=p_account_id and period_start=v_current for update;
    if found then
      update public.ai_media_credit_periods set used_count=used_count-v_debt_refund,
        carried_debt_count=carried_debt_count-v_debt_refund,
        -- The allocation includes the inherited debt offset. Reduce that
        -- offset too when a late refund would exceed the normal rollover cap.
        allocated_limit=greatest(allocated_limit-v_debt_refund,
          least(carried_debt_count-v_debt_refund+rollover_cap,allocated_limit+p_amount-v_debt_refund))
        where account_id=p_account_id and period_start=v_current returning allocated_limit into v_allocated_after;
      insert into public.ai_media_credit_ledger(account_id,entry_key,kind,included_used_delta,included_allocated_delta,metadata)
        values(p_account_id,'late-credit-release:'||pg_catalog.gen_random_uuid()::text,'release',-v_debt_refund,v_allocated_after-v_allocated_before,
          jsonb_build_object('source_period',p_period,'target_period',v_current,'amount',p_amount,'carried_debt_refunded',v_debt_refund));
    end if;
  end if;
end $$;

create or replace function public.ai_media_credit_reserve_for_context(p_editorial_action_id uuid,p_account_id uuid,p_actor_auth_user_id uuid,p_request_key text,p_request_fingerprint text,
  p_media_kind text,p_surface text,p_edition text,p_quota_amount integer,p_reservation_ttl_seconds integer default 900,p_limit_override integer default null,p_metadata jsonb default '{}')
returns table(outcome text,job_id uuid,job_status text,is_replay boolean,reservation_expires_at timestamptz,media_kind text,quota_unit text,quota_amount integer,
  limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz)
language plpgsql volatile security invoker set search_path='' as $$
declare v_period date; v_job public.ai_media_generation_jobs%rowtype; v_counter record; v_plan record; v_included integer; v_purchased integer; v_kind_limit integer;
begin
  if p_request_key is null or length(btrim(p_request_key)) not between 8 and 180 then raise exception 'AI_MEDIA_INVALID_REQUEST_KEY'; end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'AI_MEDIA_INVALID_FINGERPRINT'; end if;
  if p_media_kind is null or p_media_kind not in ('image','video') then raise exception 'AI_MEDIA_INVALID_KIND'; end if;
  if p_surface is null or p_surface not in ('studio','booster') then raise exception 'AI_MEDIA_INVALID_SURFACE'; end if;
  if p_quota_amount is null or p_quota_amount not between 1 and 1000000 then raise exception 'AI_MEDIA_INVALID_QUOTA_AMOUNT'; end if;
  if p_reservation_ttl_seconds is null or p_reservation_ttl_seconds not between 60 and 86400 then raise exception 'AI_MEDIA_INVALID_RESERVATION_TTL'; end if;
  if p_limit_override is not null and p_limit_override not between 1 and 1000000 then raise exception 'AI_MEDIA_INVALID_LIMIT_OVERRIDE'; end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'AI_MEDIA_INVALID_METADATA'; end if;
  -- Only the trusted server may call this RPC, and borrowing additionally
  -- requires an actual claimed automatic calendar slot owned by this account.
  if p_editorial_action_id is not null and (p_surface<>'booster' or not exists(
    select 1 from public.inr_agent_actions a where a.id=p_editorial_action_id and a.user_id=p_account_id
      and a.automation_key='publish' and a.action_type='publication' and a.status='executing'
      and a.metadata->>'editorialPlan'='true' and a.metadata->>'editorialState'='generating'
  )) then raise exception 'AI_MEDIA_AUTOMATIC_CREDIT_CONTEXT_DENIED'; end if;
  p_metadata:=p_metadata||jsonb_build_object('automatic_editorial_action_id',p_editorial_action_id,'credit_overdraft_allowed',p_editorial_action_id is not null);
  v_period:=public.ai_media_credit_prepare(p_account_id,p_actor_auth_user_id,p_edition);
  select j.* into v_job from public.ai_media_generation_jobs j where j.account_id=p_account_id and j.request_key=btrim(p_request_key);
  if found then
    if v_job.request_fingerprint<>p_request_fingerprint or v_job.media_kind<>p_media_kind or v_job.surface<>p_surface
      or v_job.quota_unit<>'credit' or v_job.quota_amount<>p_quota_amount then raise exception 'AI_MEDIA_IDEMPOTENCY_CONFLICT'; end if;
    return query select 'replayed'::text,v_job.id,v_job.status,true,v_job.reservation_expires_at,v_job.media_kind,'credit'::text,v_job.quota_amount,
      c.limit_count,c.used_count,c.reserved_count,c.remaining_count,c.period_start,c.reset_at from public.ai_media_credit_counter(p_account_id,v_period) c;
    return;
  end if;
  select * into v_plan from public.ai_media_credit_plan(p_account_id,p_edition);
  select case p_media_kind when 'image' then coalesce(a.image_monthly_limit_override,p.image_monthly_limit)
    else coalesce(a.video_monthly_limit_override,p.video_monthly_limit) end into v_kind_limit
  from public.ai_media_plan_limits p left join public.ai_media_account_limits a on a.account_id=p_account_id where p.edition=p_edition;
  -- A zero override intentionally disabled a media kind before the cutover.
  -- Sharing funds must not silently re-enable that account capability.
  if v_kind_limit=0 or (p_surface='studio' and not v_plan.studio_enabled) then
    return query select 'premium_required'::text,null::uuid,null::text,false,null::timestamptz,p_media_kind,'credit'::text,p_quota_amount,
      c.limit_count,c.used_count,c.reserved_count,c.remaining_count,c.period_start,c.reset_at from public.ai_media_credit_counter(p_account_id,v_period) c;
    return;
  end if;
  if p_limit_override is not null then
    update public.ai_media_credit_periods set allocated_limit=greatest(allocated_limit,p_limit_override) where account_id=p_account_id and ai_media_credit_periods.period_start=v_period;
  end if;
  select * into v_counter from public.ai_media_credit_counter(p_account_id,v_period);
  if p_editorial_action_id is null and v_counter.remaining_count<p_quota_amount then
    return query select 'quota_reached'::text,null::uuid,null::text,false,null::timestamptz,p_media_kind,'credit'::text,p_quota_amount,
      v_counter.limit_count,v_counter.used_count,v_counter.reserved_count,v_counter.remaining_count,v_period,v_counter.reset_at;
    return;
  end if;
  v_included:=least(p_quota_amount,greatest(v_counter.included_remaining_count,0));
  v_purchased:=least(p_quota_amount-v_included,greatest(v_counter.purchased_remaining_count,0));
  -- Funding is used first; only an authorized automatic request can reach
  -- this line with a shortfall. The advance stays in the included balance.
  v_included:=p_quota_amount-v_purchased;
  insert into public.ai_media_generation_jobs(account_id,actor_auth_user_id,request_key,request_fingerprint,media_kind,surface,edition,
    monthly_limit,quota_period_start,quota_unit,quota_amount,purchased_quota_amount,status,reservation_expires_at,metadata)
  values(p_account_id,p_actor_auth_user_id,btrim(p_request_key),p_request_fingerprint,p_media_kind,p_surface,p_edition,
    greatest(v_counter.limit_count,1),v_period,'credit',p_quota_amount,0,'reserved',now()+make_interval(secs=>p_reservation_ttl_seconds),p_metadata)
    returning * into v_job;
  insert into public.ai_media_credit_reservations(job_id,account_id,period_start,included_amount,purchased_amount)
    values(v_job.id,p_account_id,v_period,v_included,v_purchased);
  update public.ai_media_credit_periods p set reserved_count=p.reserved_count+v_included where p.account_id=p_account_id and p.period_start=v_period;
  update public.ai_media_credit_wallets set purchased_reserved=purchased_reserved+v_purchased,updated_at=now() where account_id=p_account_id;
  insert into public.ai_media_credit_ledger(account_id,job_id,entry_key,kind,included_reserved_delta,purchased_reserved_delta,metadata)
    values(p_account_id,v_job.id,'job:'||v_job.id::text||':reservation','reservation',v_included,v_purchased,p_metadata);
  return query select 'reserved'::text,v_job.id,v_job.status,false,v_job.reservation_expires_at,p_media_kind,'credit'::text,p_quota_amount,
    c.limit_count,c.used_count,c.reserved_count,c.remaining_count,c.period_start,c.reset_at from public.ai_media_credit_counter(p_account_id,v_period) c;
end $$;

create or replace function public.reserve_ai_media_generation_v3(p_account_id uuid,p_actor_auth_user_id uuid,p_request_key text,p_request_fingerprint text,
  p_media_kind text,p_surface text,p_edition text,p_quota_amount integer,p_reservation_ttl_seconds integer default 900,p_limit_override integer default null,p_metadata jsonb default '{}')
returns table(outcome text,job_id uuid,job_status text,is_replay boolean,reservation_expires_at timestamptz,media_kind text,quota_unit text,quota_amount integer,
  limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz)
language sql volatile security invoker set search_path='' as $$
  select * from public.ai_media_credit_reserve_for_context(null::uuid,p_account_id,p_actor_auth_user_id,p_request_key,p_request_fingerprint,p_media_kind,p_surface,p_edition,p_quota_amount,p_reservation_ttl_seconds,p_limit_override,p_metadata);
$$;

create or replace function public.reserve_inr_agent_media_generation_v1(p_editorial_action_id uuid,p_account_id uuid,p_actor_auth_user_id uuid,p_request_key text,p_request_fingerprint text,
  p_media_kind text,p_surface text,p_edition text,p_quota_amount integer,p_reservation_ttl_seconds integer default 900,p_limit_override integer default null,p_metadata jsonb default '{}')
returns table(outcome text,job_id uuid,job_status text,is_replay boolean,reservation_expires_at timestamptz,media_kind text,quota_unit text,quota_amount integer,
  limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz)
language sql volatile security invoker set search_path='' as $$
  select * from public.ai_media_credit_reserve_for_context(p_editorial_action_id,p_account_id,p_actor_auth_user_id,p_request_key,p_request_fingerprint,p_media_kind,p_surface,p_edition,p_quota_amount,p_reservation_ttl_seconds,p_limit_override,p_metadata);
$$;

revoke all on function public.ai_media_credit_reserve_for_context(uuid,uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.ai_media_credit_reserve_for_context(uuid,uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb) to service_role;
revoke all on function public.reserve_inr_agent_media_generation_v1(uuid,uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_inr_agent_media_generation_v1(uuid,uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb) to service_role;
-- CREATE OR REPLACE retains the existing private ACLs of all old RPCs.
notify pgrst,'reload schema';
commit;
