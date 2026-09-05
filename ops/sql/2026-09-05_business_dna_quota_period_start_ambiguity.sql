-- Forward-only hotfix for the Business DNA monthly analysis quota.
--
-- The function returns a column named `period_start`. In PL/pgSQL that output
-- column is also a variable, so `ON CONFLICT (account_id, period_start)` can be
-- resolved ambiguously. Referencing the existing primary-key constraint avoids
-- the collision without changing, deleting or backfilling any customer data.

create or replace function public.consume_business_dna_analysis_quota(
  p_account_id uuid,
  p_actor_auth_user_id uuid,
  p_edition text
)
returns table (
  outcome text,
  edition text,
  limit_count integer,
  used_count integer,
  remaining_count integer,
  period_start date,
  reset_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_edition text := lower(btrim(coalesce(p_edition, '')));
  v_limit integer;
  v_used integer;
  v_period_start date := date_trunc('month', timezone('UTC', now()))::date;
  v_reset_at timestamptz := ((date_trunc('month', timezone('UTC', now())) + interval '1 month') at time zone 'UTC');
begin
  perform public.business_dna_assert_account_actor(p_account_id, p_actor_auth_user_id);

  select p.monthly_limit into v_limit
  from public.business_dna_analysis_plan_limits p
  where p.edition = v_edition;
  if not found then
    raise exception 'BUSINESS_DNA_INVALID_EDITION';
  end if;

  insert into public.business_dna_analysis_monthly_usage (
    account_id,
    period_start,
    used_count
  ) values (
    p_account_id,
    v_period_start,
    0
  ) on conflict on constraint business_dna_analysis_monthly_usage_pkey do nothing;

  select u.used_count into v_used
  from public.business_dna_analysis_monthly_usage u
  where u.account_id = p_account_id
    and u.period_start = v_period_start
  for update;

  if v_used >= v_limit then
    outcome := 'quota_reached';
  else
    update public.business_dna_analysis_monthly_usage u
    set used_count = u.used_count + 1
    where u.account_id = p_account_id
      and u.period_start = v_period_start
    returning u.used_count into v_used;
    outcome := 'consumed';
  end if;

  edition := v_edition;
  limit_count := v_limit;
  used_count := v_used;
  remaining_count := greatest(v_limit - v_used, 0);
  period_start := v_period_start;
  reset_at := v_reset_at;
  return next;
end;
$$;

revoke all on function public.consume_business_dna_analysis_quota(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.consume_business_dna_analysis_quota(uuid, uuid, text)
to service_role;

notify pgrst, 'reload schema';
