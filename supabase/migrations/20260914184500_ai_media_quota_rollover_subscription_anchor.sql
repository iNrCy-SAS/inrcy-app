-- Complete la migration de report avec une ancre d'abonnement. Ainsi un pro
-- cumule meme s'il n'ouvre pas le Studio pendant plusieurs mois, sans recevoir
-- de credits anterieurs au lancement du report ou a son abonnement.
begin;

do $$
begin
  if to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.subscriptions') is null
     or to_regclass('public.ai_media_monthly_usage') is null
     or to_regprocedure(
       'public.ai_media_prepare_monthly_rollover(uuid,text,integer,integer,date)'
     ) is null then
    raise exception 'AI_MEDIA_ROLLOVER_ANCHOR_PREFLIGHT_FAILED';
  end if;
end;
$$;

create or replace function public.ai_media_prepare_monthly_rollover(
  p_account_id uuid,
  p_media_kind text,
  p_base_limit integer,
  p_rollover_cap integer,
  p_period_start date
)
returns table (
  limit_count integer,
  used_count integer,
  reserved_count integer
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_media_kind text := lower(btrim(coalesce(p_media_kind, '')));
  v_effective_cap integer;
  v_limit integer;
  v_previous_remaining integer;
  v_months_gap integer;
  v_credit_start date;
  v_credit_month date;
  v_period_spend integer;
  v_current public.ai_media_monthly_usage%rowtype;
  v_previous public.ai_media_monthly_usage%rowtype;
begin
  if p_account_id is null then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_ACCOUNT';
  end if;
  if v_media_kind not in ('image', 'video') then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_KIND';
  end if;
  if p_base_limit is null or p_base_limit not between 0 and 10000 then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_BASE_LIMIT';
  end if;
  if p_rollover_cap is null or p_rollover_cap not between 0 and 10000 then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_CAP';
  end if;
  if p_period_start is null
     or p_period_start <> date_trunc('month', p_period_start::timestamp)::date then
    raise exception 'AI_MEDIA_ROLLOVER_INVALID_PERIOD';
  end if;

  v_effective_cap := greatest(p_rollover_cap, p_base_limit);

  perform pg_advisory_xact_lock(
    hashtext(p_account_id::text),
    hashtext('ai-media-rollover:' || v_media_kind)
  );

  select u.*
    into v_current
  from public.ai_media_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = p_period_start
    and u.media_kind = v_media_kind
  for update;

  if found then
    if v_current.rollover_version = 0 then
      v_limit := case
        when p_base_limit = 0 then 0
        else greatest(p_base_limit, v_current.used_count + v_current.reserved_count)
      end;

      update public.ai_media_monthly_usage u
      set base_limit = p_base_limit,
          allocated_limit = v_limit,
          carried_count = 0,
          rollover_cap = v_effective_cap,
          rollover_version = 1
      where u.account_id = p_account_id
        and u.period_start = p_period_start
        and u.media_kind = v_media_kind
      returning u.* into v_current;
    elsif v_current.base_limit is distinct from p_base_limit
       or v_current.rollover_cap is distinct from v_effective_cap then
      v_limit := v_current.allocated_limit;
      if p_base_limit = 0 then
        v_limit := 0;
      elsif p_base_limit > v_current.base_limit then
        v_limit := greatest(
          v_current.used_count + v_current.reserved_count,
          least(
            v_effective_cap,
            v_current.allocated_limit + (p_base_limit - v_current.base_limit)
          )
        );
      end if;

      update public.ai_media_monthly_usage u
      set base_limit = p_base_limit,
          allocated_limit = v_limit,
          carried_count = greatest(v_limit - p_base_limit, 0),
          rollover_cap = v_effective_cap
      where u.account_id = p_account_id
        and u.period_start = p_period_start
        and u.media_kind = v_media_kind
      returning u.* into v_current;
    end if;

    limit_count := v_current.allocated_limit;
    used_count := v_current.used_count;
    reserved_count := v_current.reserved_count;
    return next;
    return;
  end if;

  select u.*
    into v_previous
  from public.ai_media_monthly_usage u
  where u.account_id = p_account_id
    and u.media_kind = v_media_kind
    and u.period_start < p_period_start
    and u.rollover_version = 1
  order by u.period_start desc
  limit 1
  for update;

  if p_base_limit = 0 then
    v_limit := 0;
  elsif found then
    v_months_gap :=
      ((extract(year from p_period_start)::integer
        - extract(year from v_previous.period_start)::integer) * 12)
      + (extract(month from p_period_start)::integer
        - extract(month from v_previous.period_start)::integer);

    if v_months_gap < 1 then
      raise exception 'AI_MEDIA_ROLLOVER_PERIOD_ORDER_BROKEN';
    end if;

    v_previous_remaining := greatest(
      v_previous.allocated_limit
        - v_previous.used_count
        - v_previous.reserved_count,
      0
    );
    v_limit := least(
      v_effective_cap::bigint,
      v_previous_remaining::bigint
        + (p_base_limit::bigint * v_months_gap::bigint)
    )::integer;
  else
    select greatest(
      date '2026-09-01',
      date_trunc(
        'month',
        coalesce(s.start_date, a.created_at::date)::timestamp
      )::date
    )
      into v_credit_start
    from public.inrcy_accounts a
    left join public.subscriptions s
      on s.user_id = a.id
    where a.id = p_account_id;

    if v_credit_start is null then
      raise exception 'AI_MEDIA_ROLLOVER_ACCOUNT_ANCHOR_MISSING';
    end if;

    v_limit := 0;
    v_credit_month := v_credit_start;
    while v_credit_month <= p_period_start loop
      v_limit := least(v_effective_cap, v_limit + p_base_limit);

      if v_credit_month < p_period_start then
        select coalesce(sum(u.used_count + u.reserved_count), 0)::integer
          into v_period_spend
        from public.ai_media_monthly_usage u
        where u.account_id = p_account_id
          and u.media_kind = v_media_kind
          and u.period_start = v_credit_month;

        v_limit := greatest(v_limit - v_period_spend, 0);
      end if;

      v_credit_month := (v_credit_month + interval '1 month')::date;
    end loop;
  end if;

  insert into public.ai_media_monthly_usage (
    account_id,
    period_start,
    media_kind,
    used_count,
    reserved_count,
    base_limit,
    allocated_limit,
    carried_count,
    rollover_cap,
    rollover_version
  )
  values (
    p_account_id,
    p_period_start,
    v_media_kind,
    0,
    0,
    p_base_limit,
    v_limit,
    greatest(v_limit - p_base_limit, 0),
    v_effective_cap,
    1
  )
  returning * into v_current;

  limit_count := v_current.allocated_limit;
  used_count := v_current.used_count;
  reserved_count := v_current.reserved_count;
  return next;
end;
$$;

revoke all on function public.ai_media_prepare_monthly_rollover(uuid, text, integer, integer, date)
from public, anon, authenticated;
grant execute on function public.ai_media_prepare_monthly_rollover(uuid, text, integer, integer, date)
to service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.ai_media_prepare_monthly_rollover(uuid,text,integer,integer,date)'::regprocedure
  ) into v_definition;

  if position('public.subscriptions' in v_definition) = 0
     or position('2026-09-01' in v_definition) = 0
     or position('while v_credit_month <= p_period_start' in v_definition) = 0
     or position('sum(u.used_count + u.reserved_count)' in v_definition) = 0 then
    raise exception 'AI_MEDIA_ROLLOVER_ANCHOR_VERIFICATION_FAILED';
  end if;
end;
$$;

commit;
