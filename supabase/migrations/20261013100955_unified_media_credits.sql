-- Unified media-credit wallet, migration source. No remote execution.
-- Legacy orders remain in their original units. Their live balances are the
-- authoritative funding sources, converted at immutable factors 7 / 10.
begin;

do $$ begin
  if to_regprocedure('public.get_ai_media_generation_quota_v3(uuid,uuid,text)') is null
     or to_regclass('public.ai_media_image_credit_balances') is null
     or to_regprocedure('public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)') is null then
    raise exception 'AI_MEDIA_CREDIT_MIGRATION_PREFLIGHT_FAILED';
  end if;
end $$;

-- Extend only the existing duration allowlist. JSON numbers, all other block
-- validations, account authorization, RLS and non-persisted consent stay intact.
do $$ declare v_source text; v_old text; v_new text; begin
  select replace(pg_get_functiondef('public.inrcy_patch_ai_media_generator_preferences(uuid,integer,boolean,jsonb)'::regprocedure),E'\r\n',E'\n') into v_source;
  v_old:='or coalesce(p_defaults ->> ''durationSeconds'' not in (''8'', ''16'', ''24''), true)';
  v_new:='or coalesce(p_defaults ->> ''durationSeconds'' !~ ''^([4-9]|[12][0-9]|30)$'', true)';
  if strpos(v_source,v_old)=0
     or strpos(v_source,'jsonb_typeof(p_defaults -> ''durationSeconds'') is distinct from ''number''')=0 then
    raise exception 'AI_MEDIA_CREDIT_PREFERENCES_DURATION_DRIFT';
  end if;
  execute replace(v_source,v_old,v_new);
end $$;

-- Duration is a capability limit, independent from the number of credit units.
-- Account-specific caps retain their original intentional restriction.
alter table public.ai_media_plan_limits drop constraint ai_media_plan_limits_video_duration_check;
alter table public.ai_media_account_limits drop constraint ai_media_account_limits_video_duration_check;
alter table public.ai_media_plan_limits add constraint ai_media_plan_limits_video_duration_check
  check(video_max_duration_seconds between 1 and 30);
alter table public.ai_media_account_limits add constraint ai_media_account_limits_video_duration_check
  check(video_max_duration_seconds_override is null or video_max_duration_seconds_override between 1 and 30);
alter table public.ai_media_plan_limits alter column video_max_duration_seconds set default 30;
update public.ai_media_plan_limits set video_max_duration_seconds=30,updated_at=now()
  where video_max_duration_seconds<>30;
comment on column public.ai_media_plan_limits.video_max_duration_seconds is 'Maximum output duration allowed by the plan (1..30 seconds); each engine further restricts its own native durations.';
comment on column public.ai_media_account_limits.video_max_duration_seconds_override is 'NULL inherits the plan; 1..30 preserves a distinct maximum duration for this account.';

alter table public.ai_media_generation_jobs drop constraint ai_media_generation_jobs_quota_unit_check;
alter table public.ai_media_generation_jobs drop constraint ai_media_generation_jobs_quota_amount_check;
alter table public.ai_media_generation_jobs drop constraint ai_media_generation_jobs_limit_check;
alter table public.ai_media_generation_jobs add constraint ai_media_generation_jobs_quota_unit_check
  check (quota_unit in ('item','second','credit'));
alter table public.ai_media_generation_jobs add constraint ai_media_generation_jobs_quota_amount_check
  check ((quota_unit='credit' and quota_amount between 1 and 1000000 and purchased_quota_amount=0)
      or (media_kind='image' and quota_unit='item' and quota_amount=1)
      or (media_kind='video' and quota_unit='second' and quota_amount in (8,16,24)));
alter table public.ai_media_generation_jobs add constraint ai_media_generation_jobs_limit_check
  check (monthly_limit between 1 and 2000000);

create table public.ai_media_credit_wallets (
  account_id uuid primary key references public.inrcy_accounts(id) on delete restrict,
  version text not null default 'media-credits-v1' check(version='media-credits-v1'),
  purchased_used integer not null default 0 check(purchased_used>=0),
  purchased_reserved integer not null default 0 check(purchased_reserved>=0),
  migrated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.ai_media_credit_periods (
  account_id uuid not null references public.ai_media_credit_wallets(account_id) on delete restrict,
  period_start date not null,
  allocated_limit integer not null check(allocated_limit>=0),
  base_limit integer not null check(base_limit>=0),
  rollover_cap integer not null check(rollover_cap>=base_limit),
  used_count integer not null default 0 check(used_count>=0),
  reserved_count integer not null default 0 check(reserved_count>=0),
  primary key(account_id,period_start)
);
create table public.ai_media_credit_legacy_sources (
  account_id uuid not null references public.ai_media_credit_wallets(account_id) on delete restrict,
  source_kind text not null check(source_kind in ('image','video')),
  conversion_key text not null unique,
  factor integer not null check((source_kind='image' and factor=7) or (source_kind='video' and factor=10)),
  original_snapshot jsonb not null,
  converted_at timestamptz not null default now(),
  primary key(account_id,source_kind)
);
create table public.ai_media_credit_reservations (
  job_id uuid primary key references public.ai_media_generation_jobs(id) on delete restrict,
  account_id uuid not null references public.ai_media_credit_wallets(account_id) on delete restrict,
  period_start date not null,
  included_amount integer not null check(included_amount>=0),
  purchased_amount integer not null check(purchased_amount>=0),
  check(included_amount+purchased_amount>0)
);
create index ai_media_credit_reservations_account_idx on public.ai_media_credit_reservations(account_id,period_start);
create table public.ai_media_credit_legacy_job_bridge (
  job_id uuid primary key references public.ai_media_generation_jobs(id) on delete restrict,
  account_id uuid not null references public.ai_media_credit_wallets(account_id) on delete restrict,
  period_start date not null,
  included_amount integer not null check(included_amount>=0),
  settled_status text check(settled_status in ('completed','failed','expired'))
);
create index ai_media_credit_legacy_job_bridge_account_idx on public.ai_media_credit_legacy_job_bridge(account_id);
create table public.ai_media_credit_ledger (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.ai_media_credit_wallets(account_id) on delete restrict,
  job_id uuid references public.ai_media_generation_jobs(id) on delete restrict,
  entry_key text not null unique,
  kind text not null check(kind in ('migration','recharge','reservation','completion','release','legacy_completion','legacy_release')),
  included_allocated_delta integer not null default 0,
  included_used_delta integer not null default 0,
  included_reserved_delta integer not null default 0,
  purchased_used_delta integer not null default 0,
  purchased_reserved_delta integer not null default 0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index ai_media_credit_ledger_account_created_idx on public.ai_media_credit_ledger(account_id,created_at desc);
create index ai_media_generation_credit_pending_idx on public.ai_media_generation_jobs(account_id,reservation_expires_at)
  where quota_unit='credit' and status in ('reserved','processing');

do $$ declare v_table text; begin
  foreach v_table in array array['ai_media_credit_wallets','ai_media_credit_periods','ai_media_credit_legacy_sources',
    'ai_media_credit_reservations','ai_media_credit_legacy_job_bridge','ai_media_credit_ledger'] loop
    execute format('alter table public.%I enable row level security',v_table);
    execute format('revoke all on public.%I from public,anon,authenticated',v_table);
    execute format('grant select,insert,update on public.%I to service_role',v_table);
    execute format('grant select on public.%I to authenticated',v_table);
    execute format('create policy %I on public.%I for select to authenticated using(public.inrcy_can_access_account(account_id))',v_table||'_read',v_table);
  end loop;
end $$;
revoke update on public.ai_media_credit_ledger,public.ai_media_credit_legacy_sources from service_role;
grant usage,select on sequence public.ai_media_credit_ledger_id_seq to service_role;

create function public.ai_media_credit_lock(p_account_id uuid) returns void
language sql volatile security invoker set search_path='' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_account_id::text),pg_catalog.hashtext('ai-media-credits-v1'));
$$;

create function public.ai_media_credit_plan(p_account_id uuid,p_edition text)
returns table(base_limit integer,rollover_cap integer,studio_enabled boolean)
language plpgsql stable security invoker set search_path='' as $$
declare v_plan public.ai_media_plan_limits%rowtype; v_overrides public.ai_media_account_limits%rowtype; v_image integer; v_video integer;
begin
  select * into v_plan from public.ai_media_plan_limits where edition=p_edition;
  if not found then raise exception 'AI_MEDIA_INVALID_EDITION'; end if;
  select * into v_overrides from public.ai_media_account_limits where account_id=p_account_id;
  v_image:=coalesce(v_overrides.image_monthly_limit_override,v_plan.image_monthly_limit);
  v_video:=coalesce(v_overrides.video_monthly_limit_override,v_plan.video_monthly_limit);
  return query select v_image*7+v_video*10,
    greatest(v_image,case when p_edition='premium' then 150 else 70 end)*7
      +greatest(v_video,case when p_edition='standard' then 168 else 480 end)*10,
    v_plan.studio_enabled;
end $$;

create function public.ai_media_credit_prepare(p_account_id uuid,p_actor_auth_user_id uuid,p_edition text)
returns date language plpgsql volatile security invoker set search_path='' as $$
declare v_period date:=date_trunc('month',timezone('UTC',now()))::date;
  v_plan record; v_image record; v_video record; v_previous public.ai_media_credit_periods%rowtype;
  v_current public.ai_media_credit_periods%rowtype; v_gap integer; v_limit integer;
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
        allocated_limit=greatest(used_count+reserved_count,least(v_plan.rollover_cap,greatest(allocated_limit+v_plan.base_limit-base_limit,0))),
        base_limit=v_plan.base_limit,rollover_cap=v_plan.rollover_cap
      where account_id=p_account_id and period_start=v_period;
    end if;
  else
    select * into v_previous from public.ai_media_credit_periods where account_id=p_account_id and period_start<v_period
      order by period_start desc limit 1 for update;
    if not found then raise exception 'AI_MEDIA_CREDIT_PERIOD_MISSING'; end if;
    v_gap:=(extract(year from v_period)::integer-extract(year from v_previous.period_start)::integer)*12
      +extract(month from v_period)::integer-extract(month from v_previous.period_start)::integer;
    v_limit:=least(v_plan.rollover_cap::bigint,greatest(v_previous.allocated_limit-v_previous.used_count-v_previous.reserved_count,0)::bigint+v_plan.base_limit::bigint*v_gap)::integer;
    insert into public.ai_media_credit_periods(account_id,period_start,allocated_limit,base_limit,rollover_cap)
      values(p_account_id,v_period,v_limit,v_plan.base_limit,v_plan.rollover_cap);
    insert into public.ai_media_credit_ledger(account_id,entry_key,kind,included_allocated_delta,metadata)
      values(p_account_id,'recharge:'||p_account_id::text||':'||v_period::text,'recharge',v_limit,jsonb_build_object('period_start',v_period,'months',v_gap));
  end if;
  return v_period;
end $$;

create function public.ai_media_credit_counter(p_account_id uuid,p_period_start date)
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
    greatest(v_period.allocated_limit-v_period.used_count-v_period.reserved_count,0)+greatest(v_funding-v_held-v_paid_used-v_paid_reserved,0),
    p_period_start,((p_period_start+interval '1 month')::timestamp at time zone 'UTC'),
    greatest(v_period.allocated_limit-v_period.used_count-v_period.reserved_count,0),greatest(v_funding-v_held-v_paid_used-v_paid_reserved,0),v_paid_reserved,
    greatest(v_paid_used+v_paid_reserved-v_funding,0),v_held,
    greatest(v_paid_used+v_paid_reserved-v_funding+v_held,0)-greatest(v_paid_used+v_paid_reserved-v_funding,0),
    v_period.allocated_limit,v_period.used_count,v_period.reserved_count;
end $$;

create function public.ai_media_credit_release_included(p_account_id uuid,p_period date,p_amount integer,p_complete boolean)
returns void language plpgsql volatile security invoker set search_path='' as $$
declare v_current date:=date_trunc('month',timezone('UTC',now()))::date;
begin
  if p_amount=0 then return; end if;
  update public.ai_media_credit_periods set reserved_count=reserved_count-p_amount,
    used_count=used_count+case when p_complete then p_amount else 0 end
    where account_id=p_account_id and period_start=p_period and reserved_count>=p_amount;
  if not found then raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN'; end if;
  if not p_complete and p_period<v_current then
    update public.ai_media_credit_periods set allocated_limit=greatest(allocated_limit,least(rollover_cap,allocated_limit+p_amount))
      where account_id=p_account_id and period_start=v_current;
  end if;
end $$;

create function public.ai_media_credit_bridge_legacy_job() returns trigger
language plpgsql volatile security invoker set search_path='' as $$
declare v_bridge public.ai_media_credit_legacy_job_bridge%rowtype; v_current date:=date_trunc('month',timezone('UTC',now()))::date;
begin
  if old.quota_unit='credit' or old.status not in ('reserved','processing') or new.status not in ('completed','failed','expired') then return new; end if;
  select * into v_bridge from public.ai_media_credit_legacy_job_bridge where job_id=new.id;
  if not found or v_bridge.settled_status is not null then return new; end if;
  perform public.ai_media_credit_lock(new.account_id);
  select * into v_bridge from public.ai_media_credit_legacy_job_bridge where job_id=new.id for update;
  if v_bridge.settled_status is not null then return new; end if;
  if exists(select 1 from public.ai_media_credit_periods where account_id=new.account_id and period_start=v_bridge.period_start) then
    perform public.ai_media_credit_release_included(new.account_id,v_bridge.period_start,v_bridge.included_amount,new.status='completed');
  elsif new.status<>'completed' then
    update public.ai_media_credit_periods set allocated_limit=greatest(allocated_limit,least(rollover_cap,allocated_limit+v_bridge.included_amount))
      where account_id=new.account_id and period_start=v_current;
  end if;
  update public.ai_media_credit_legacy_job_bridge set settled_status=new.status where job_id=new.id;
  insert into public.ai_media_credit_ledger(account_id,job_id,entry_key,kind,included_used_delta,included_reserved_delta,metadata)
    values(new.account_id,new.id,'legacy-job:'||new.id::text,case when new.status='completed' then 'legacy_completion' else 'legacy_release' end,
      case when new.status='completed' then v_bridge.included_amount else 0 end,-v_bridge.included_amount,jsonb_build_object('original_unit',new.quota_unit,'original_amount',new.quota_amount));
  return new;
end $$;
create trigger ai_media_credit_bridge_legacy_job after update of status on public.ai_media_generation_jobs
  for each row when(old.quota_unit<>'credit') execute function public.ai_media_credit_bridge_legacy_job();

create function public.get_ai_media_generation_quota_v4(p_account_id uuid,p_actor_auth_user_id uuid,p_edition text)
returns table(account_id uuid,edition text,studio_enabled boolean,wallet_ready boolean,media_kind text,quota_unit text,
  limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz,
  included_remaining_count integer,purchased_remaining_count integer,purchased_reserved_count integer,purchased_debt_count integer,
  purchased_held_count integer,purchased_suspended_deficit_count integer,included_limit_count integer,included_used_count integer,included_reserved_count integer)
language plpgsql volatile security invoker set search_path='' as $$
declare v_period date; v_studio boolean;
begin
  v_period:=public.ai_media_credit_prepare(p_account_id,p_actor_auth_user_id,p_edition);
  perform public.expire_ai_media_credit_reservations(1000,p_account_id);
  select p.studio_enabled into v_studio from public.ai_media_credit_plan(p_account_id,p_edition) p;
  return query select p_account_id,p_edition,v_studio,true,'media'::text,c.* from public.ai_media_credit_counter(p_account_id,v_period) c;
end $$;

create function public.reserve_ai_media_generation_v3(p_account_id uuid,p_actor_auth_user_id uuid,p_request_key text,p_request_fingerprint text,
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
  if v_counter.remaining_count<p_quota_amount then
    return query select 'quota_reached'::text,null::uuid,null::text,false,null::timestamptz,p_media_kind,'credit'::text,p_quota_amount,
      v_counter.limit_count,v_counter.used_count,v_counter.reserved_count,v_counter.remaining_count,v_period,v_counter.reset_at;
    return;
  end if;
  v_included:=least(p_quota_amount,v_counter.included_remaining_count); v_purchased:=p_quota_amount-v_included;
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

create function public.ai_media_credit_finish(p_account_id uuid,p_job_id uuid,p_media_id uuid,p_status text,p_error_code text,p_error_message text,p_metadata jsonb)
returns table(job_id uuid,job_status text,media_kind text,quota_unit text,quota_amount integer,media_id uuid,
  limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz)
language plpgsql volatile security invoker set search_path='' as $$
declare v_job public.ai_media_generation_jobs%rowtype; v_reservation public.ai_media_credit_reservations%rowtype; v_period date;
begin
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'AI_MEDIA_INVALID_METADATA'; end if;
  perform public.ai_media_credit_lock(p_account_id);
  select * into v_job from public.ai_media_generation_jobs j where j.id=p_job_id and j.account_id=p_account_id for update;
  if not found then raise exception 'AI_MEDIA_JOB_NOT_FOUND'; end if;
  if v_job.quota_unit<>'credit' then raise exception 'AI_MEDIA_CREDIT_UNIT_REQUIRED'; end if;
  select * into v_reservation from public.ai_media_credit_reservations where ai_media_credit_reservations.job_id=p_job_id;
  if not found or v_reservation.included_amount+v_reservation.purchased_amount<>v_job.quota_amount then raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN'; end if;
  if v_job.status='completed' then
    if p_status<>'completed' then raise exception 'AI_MEDIA_JOB_TERMINAL'; end if;
    if v_job.output_media_id is distinct from p_media_id then raise exception 'AI_MEDIA_COMPLETION_CONFLICT'; end if;
  elsif v_job.status in ('failed','expired') then
    if p_status='completed' then raise exception 'AI_MEDIA_JOB_TERMINAL'; end if;
  else
    if p_status='completed' and not exists(select 1 from public.pro_media_library m where m.id=p_media_id and m.user_id=p_account_id
      and m.media_type=v_job.media_kind and m.upload_status='uploaded') then raise exception 'AI_MEDIA_OUTPUT_SCOPE_MISMATCH'; end if;
    perform public.ai_media_credit_release_included(p_account_id,v_reservation.period_start,v_reservation.included_amount,p_status='completed');
    update public.ai_media_credit_wallets set purchased_reserved=purchased_reserved-v_reservation.purchased_amount,
      purchased_used=purchased_used+case when p_status='completed' then v_reservation.purchased_amount else 0 end,updated_at=now()
      where account_id=p_account_id and purchased_reserved>=v_reservation.purchased_amount;
    if not found then raise exception 'AI_MEDIA_RESERVATION_INVARIANT_BROKEN'; end if;
    update public.ai_media_generation_jobs set status=p_status,output_media_id=case when p_status='completed' then p_media_id else null end,
      completed_at=case when p_status='completed' then now() else null end,failed_at=case when p_status<>'completed' then now() else null end,
      error_code=case when p_status<>'completed' then p_error_code else null end,error_message=case when p_status<>'completed' then p_error_message else null end,
      metadata=metadata||p_metadata where id=p_job_id returning * into v_job;
    insert into public.ai_media_credit_ledger(account_id,job_id,entry_key,kind,included_used_delta,included_reserved_delta,purchased_used_delta,purchased_reserved_delta,metadata)
      values(p_account_id,p_job_id,'job:'||p_job_id::text||':terminal',case when p_status='completed' then 'completion' else 'release' end,
        case when p_status='completed' then v_reservation.included_amount else 0 end,-v_reservation.included_amount,
        case when p_status='completed' then v_reservation.purchased_amount else 0 end,-v_reservation.purchased_amount,p_metadata);
  end if;
  select max(p.period_start) into v_period from public.ai_media_credit_periods p where p.account_id=p_account_id;
  return query select v_job.id,v_job.status,v_job.media_kind,'credit'::text,v_job.quota_amount,v_job.output_media_id,
    c.limit_count,c.used_count,c.reserved_count,c.remaining_count,c.period_start,c.reset_at from public.ai_media_credit_counter(p_account_id,v_period) c;
end $$;

create function public.complete_ai_media_generation_v3(p_account_id uuid,p_job_id uuid,p_media_id uuid,p_metadata jsonb default '{}')
returns table(job_id uuid,job_status text,media_kind text,quota_unit text,quota_amount integer,media_id uuid,limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz)
language plpgsql volatile security invoker set search_path='' as $$
declare v_unit text; begin
  select j.quota_unit into v_unit from public.ai_media_generation_jobs j where j.id=p_job_id and j.account_id=p_account_id;
  if v_unit is null then raise exception 'AI_MEDIA_JOB_NOT_FOUND'; end if;
  if v_unit<>'credit' then return query select * from public.complete_ai_media_generation_v2(p_account_id,p_job_id,p_media_id,p_metadata);
  else return query select * from public.ai_media_credit_finish(p_account_id,p_job_id,p_media_id,'completed',null,null,p_metadata); end if;
end $$;
create function public.fail_ai_media_generation_v3(p_account_id uuid,p_job_id uuid,p_error_code text default null,p_error_message text default null,p_metadata jsonb default '{}')
returns table(job_id uuid,job_status text,media_kind text,quota_unit text,quota_amount integer,media_id uuid,limit_count integer,used_count integer,reserved_count integer,remaining_count integer,period_start date,reset_at timestamptz)
language plpgsql volatile security invoker set search_path='' as $$
declare v_unit text; begin
  select j.quota_unit into v_unit from public.ai_media_generation_jobs j where j.id=p_job_id and j.account_id=p_account_id;
  if v_unit is null then raise exception 'AI_MEDIA_JOB_NOT_FOUND'; end if;
  if v_unit<>'credit' then return query select * from public.fail_ai_media_generation_v2(p_account_id,p_job_id,p_error_code,p_error_message,p_metadata);
  else return query select * from public.ai_media_credit_finish(p_account_id,p_job_id,null,'failed',p_error_code,p_error_message,p_metadata); end if;
end $$;

-- Patch only audited legacy paths. Credit jobs have their own reservation split.
do $$ declare v_source text; v_signature text; v_old text; v_new text; begin
  foreach v_signature in array array['public.ai_media_expire_account_reservations(uuid,integer)','public.expire_ai_media_generation_reservations(integer)'] loop
    select replace(pg_get_functiondef(v_signature::regprocedure),E'\r\n',E'\n') into v_source;
    v_old:='and j.reservation_expires_at <= pg_catalog.now()';
    if strpos(v_source,v_old)=0 then raise exception 'AI_MEDIA_CREDIT_LEGACY_EXPIRY_DRIFT'; end if;
    execute replace(v_source,v_old,'and j.quota_unit <> ''credit'' '||v_old);
  end loop;
  select replace(pg_get_functiondef('public.reserve_ai_media_generation_v2(uuid,uuid,text,text,text,text,text,integer,integer,integer,jsonb)'::regprocedure),E'\r\n',E'\n') into v_source;
  v_old:='  perform public.ai_media_assert_account_actor(p_account_id, p_actor_auth_user_id);';
  v_new:=v_old||E'\n  if exists(select 1 from public.ai_media_credit_wallets where account_id=p_account_id) and not exists(select 1 from public.ai_media_generation_jobs where account_id=p_account_id and request_key=btrim(p_request_key)) then\n    raise exception ''AI_MEDIA_CREDIT_UNIT_REQUIRED'';\n  end if;';
  if strpos(v_source,v_old)=0 then raise exception 'AI_MEDIA_CREDIT_LEGACY_RESERVE_DRIFT'; end if;
  v_source:=replace(v_source,v_old,v_new);
  -- A legacy call may have started before another transaction imported the
  -- wallet. Recheck AFTER its old quota lock, in the same lock order as import.
  v_old:='  v_limit := coalesce(p_limit_override, v_rollover_limit);';
  v_new:=v_old||E'\n  perform public.ai_media_credit_lock(p_account_id);\n  if exists(select 1 from public.ai_media_credit_wallets where account_id=p_account_id) then\n    raise exception ''AI_MEDIA_CREDIT_UNIT_REQUIRED'';\n  end if;';
  if strpos(v_source,v_old)=0 then raise exception 'AI_MEDIA_CREDIT_LEGACY_RESERVE_LOCK_DRIFT'; end if;
  execute replace(v_source,v_old,v_new);
  select replace(pg_get_functiondef('public.ai_media_complete_temporary_draft_quota()'::regprocedure),E'\r\n',E'\n') into v_source;
  v_old:='  v_job_id := pg_catalog.substr(new.client_media_key, 10)::uuid;';
  v_new:=v_old||E'\n  if exists(select 1 from public.ai_media_generation_jobs where id=v_job_id and account_id=new.user_id and quota_unit=''credit'') then\n    perform public.complete_ai_media_generation_v3(new.user_id,v_job_id,new.id,jsonb_build_object(''temporary_draft_created'',true));\n    return new;\n  end if;';
  if strpos(v_source,v_old)=0 then raise exception 'AI_MEDIA_CREDIT_DRAFT_TRIGGER_DRIFT'; end if;
  execute replace(v_source,v_old,v_new);
end $$;

create function public.expire_ai_media_credit_reservations(p_batch_size integer default 100,p_account_id uuid default null)
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare v_job record; v_media uuid; v_expired integer:=0;
begin
  if p_batch_size not between 1 and 1000 then raise exception 'AI_MEDIA_INVALID_BATCH_SIZE'; end if;
  for v_job in select j.id,j.account_id from public.ai_media_generation_jobs j
    where j.quota_unit='credit' and j.status in ('reserved','processing') and j.reservation_expires_at<=now()
      and (p_account_id is null or j.account_id=p_account_id)
    order by j.account_id,j.reservation_expires_at,j.id limit p_batch_size loop
    perform public.ai_media_credit_lock(v_job.account_id);
    if not exists(select 1 from public.ai_media_generation_jobs where id=v_job.id and status in ('reserved','processing') and reservation_expires_at<=now()) then continue; end if;
    select m.id into v_media from public.pro_media_library m where m.user_id=v_job.account_id and m.client_media_key='ai-media:'||v_job.id::text
      and m.source in ('ai_media_generation','ai_media_generation_draft') and m.upload_status='uploaded' limit 1;
    if v_media is not null then perform public.complete_ai_media_generation_v3(v_job.account_id,v_job.id,v_media,'{"quota_recovered_from_library":true}');
    else
      perform public.ai_media_credit_finish(v_job.account_id,v_job.id,null,'expired','reservation_expired','La réservation de crédits a expiré.','{}');
      v_expired:=v_expired+1;
    end if;
  end loop;
  return v_expired;
end $$;

-- Immutable allocation and migration provenance are never recalculated on retry.
create function public.ai_media_credit_protect_reservation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new is distinct from old then raise exception 'AI_MEDIA_CREDIT_RESERVATION_IMMUTABLE'; end if;
  return new;
end $$;
create trigger ai_media_credit_protect_reservation before update on public.ai_media_credit_reservations
  for each row execute function public.ai_media_credit_protect_reservation();

do $$ declare v_function record; begin
  for v_function in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'ai_media_credit_%' or p.proname in ('get_ai_media_generation_quota_v4','reserve_ai_media_generation_v3',
      'complete_ai_media_generation_v3','fail_ai_media_generation_v3','expire_ai_media_credit_reservations')) loop
    execute format('revoke all on function %s from public,anon,authenticated',v_function.signature);
    execute format('grant execute on function %s to service_role',v_function.signature);
  end loop;
end $$;
comment on table public.ai_media_credit_legacy_sources is 'Unique migration provenance. Legacy source balances remain authoritative for purchases, refunds and payment disputes; historical orders are never rewritten.';
comment on table public.ai_media_credit_wallets is 'Unified media credits. Included allowance rolls over; purchased funding is derived from immutable legacy units at image x7 and video x10, less this wallet usage.';
commit;
