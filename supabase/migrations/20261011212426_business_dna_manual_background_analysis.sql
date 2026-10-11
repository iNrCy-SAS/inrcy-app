begin;

-- Une seule analyse manuelle en cours par établissement. Aucun document,
-- prompt, secret ou résultat ADN privé n'est copié dans cette file technique.
create table public.business_dna_manual_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references public.inrcy_accounts(id) on delete cascade,
  actor_auth_user_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  quota_period_start date not null,
  quota_refunded boolean not null default false,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object' and length(result::text) <= 48000),
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '15 minutes',
  lock_token uuid,
  updated_at timestamptz not null default now(),
  constraint business_dna_manual_job_lock_check check (
    (status = 'running' and lock_token is not null and started_at is not null)
    or (status <> 'running' and lock_token is null)
  )
);

create index business_dna_manual_analysis_jobs_pending_idx
on public.business_dna_manual_analysis_jobs (status, created_at, expires_at)
where status in ('queued', 'running');

alter table public.business_dna_manual_analysis_jobs enable row level security;
revoke all on public.business_dna_manual_analysis_jobs from public, anon, authenticated, service_role;
grant select, insert, update on public.business_dna_manual_analysis_jobs to service_role;

create trigger business_dna_manual_analysis_jobs_touch_updated_at
before update on public.business_dna_manual_analysis_jobs
for each row execute function public.inrcy_touch_updated_at();

create function public.start_business_dna_manual_analysis_job(
  p_account_id uuid, p_actor_auth_user_id uuid, p_edition text
)
returns table (outcome text, job jsonb, quota jsonb)
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_job public.business_dna_manual_analysis_jobs%rowtype;
  v_quota record;
begin
  perform public.business_dna_assert_account_actor(p_account_id, p_actor_auth_user_id);
  if p_edition is null or p_edition not in ('standard', 'admin') then
    raise exception 'BUSINESS_DNA_INVALID_EDITION';
  end if;
  -- Le verrou de l'établissement protège aussi deux premiers lancements
  -- simultanés, avant même que la ligne de tâche existe.
  perform 1 from public.inrcy_accounts a where a.id = p_account_id for update;
  select j.* into v_job from public.business_dna_manual_analysis_jobs j
  where j.account_id = p_account_id for update;
  if found and v_job.status in ('queued', 'running') then
    select * into v_quota from public.get_business_dna_analysis_quota(p_account_id, p_actor_auth_user_id, p_edition);
    return query select 'existing'::text, to_jsonb(v_job), to_jsonb(v_quota);
    return;
  end if;

  -- Réservation et création sont atomiques : jamais deux quotas consommés
  -- pour le même travail, même si la réponse navigateur est perdue.
  select * into v_quota from public.consume_business_dna_analysis_quota(p_account_id, p_actor_auth_user_id, p_edition);
  if v_quota.outcome = 'quota_reached' then
    return query select 'quota_reached'::text, null::jsonb, to_jsonb(v_quota) - 'outcome';
    return;
  end if;
  insert into public.business_dna_manual_analysis_jobs as j (
    account_id, actor_auth_user_id, quota_period_start
  ) values (p_account_id, p_actor_auth_user_id, v_quota.period_start)
  on conflict (account_id) do update set
    id = gen_random_uuid(), actor_auth_user_id = excluded.actor_auth_user_id,
    status = 'queued', quota_period_start = excluded.quota_period_start,
    quota_refunded = false, result = '{}'::jsonb, error_message = null,
    created_at = now(), started_at = null, completed_at = null,
    expires_at = now() + interval '15 minutes', lock_token = null
  returning j.* into v_job;
  return query select 'created'::text, to_jsonb(v_job), to_jsonb(v_quota) - 'outcome';
end;
$$;

create function public.claim_business_dna_manual_analysis_job(p_job_id uuid)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_job public.business_dna_manual_analysis_jobs%rowtype;
begin
  select j.* into v_job from public.business_dna_manual_analysis_jobs j
  where j.id = p_job_id and j.status = 'queued' and j.expires_at > now()
  for update skip locked;
  if not found then return null; end if;
  perform public.business_dna_assert_account_actor(v_job.account_id, v_job.actor_auth_user_id);
  update public.business_dna_manual_analysis_jobs j
  set status = 'running', started_at = now(), lock_token = gen_random_uuid(),
      expires_at = now() + interval '450 seconds'
  where j.id = p_job_id returning j.* into v_job;
  return to_jsonb(v_job);
end;
$$;

create function public.complete_business_dna_manual_analysis_job(
  p_job_id uuid, p_lock_token uuid, p_status text,
  p_result jsonb default '{}'::jsonb, p_error_message text default null
)
returns text
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_job public.business_dna_manual_analysis_jobs%rowtype;
begin
  if p_status is null or p_status not in ('succeeded', 'failed') then raise exception 'BUSINESS_DNA_INVALID_JOB_STATUS'; end if;
  select j.* into v_job from public.business_dna_manual_analysis_jobs j
  where j.id = p_job_id for update;
  if not found then return 'not_found'; end if;
  if v_job.status in ('succeeded', 'failed') then return 'already_completed'; end if;
  if (v_job.status = 'running' and v_job.lock_token is distinct from p_lock_token)
     or (p_status = 'succeeded' and (v_job.status <> 'running' or v_job.expires_at <= now())) then
    return 'claim_lost';
  end if;
  if p_status = 'failed' and not v_job.quota_refunded then
    -- Le mois réellement réservé reste ciblé, même si la tâche échoue au
    -- passage au mois suivant. Le verrou de tâche rend ce remboursement unique.
    update public.business_dna_analysis_monthly_usage u
    set used_count = greatest(u.used_count - 1, 0)
    where u.account_id = v_job.account_id and u.period_start = v_job.quota_period_start;
  end if;
  update public.business_dna_manual_analysis_jobs j set
    status = p_status, result = coalesce(p_result, '{}'::jsonb),
    error_message = left(p_error_message, 500), completed_at = now(), lock_token = null,
    quota_refunded = (p_status = 'failed')
  where j.id = p_job_id;
  return 'completed';
end;
$$;

create function public.expire_business_dna_manual_analysis_jobs(p_limit integer default 10)
returns integer
language plpgsql security invoker set search_path = public, pg_temp
as $$
declare v_job record; v_count integer := 0;
begin
  for v_job in
    select j.id, j.lock_token from public.business_dna_manual_analysis_jobs j
    where j.status in ('queued', 'running') and j.expires_at <= now()
    order by j.expires_at limit greatest(1, least(p_limit, 20)) for update skip locked
  loop
    perform public.complete_business_dna_manual_analysis_job(
      v_job.id, v_job.lock_token, 'failed', '{}'::jsonb,
      'L’analyse n’a pas pu terminer sur le serveur. Votre quota a été restitué ; vous pouvez la relancer.'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.start_business_dna_manual_analysis_job(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.claim_business_dna_manual_analysis_job(uuid) from public, anon, authenticated;
revoke all on function public.complete_business_dna_manual_analysis_job(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.expire_business_dna_manual_analysis_jobs(integer) from public, anon, authenticated;
grant execute on function public.start_business_dna_manual_analysis_job(uuid, uuid, text) to service_role;
grant execute on function public.claim_business_dna_manual_analysis_job(uuid) to service_role;
grant execute on function public.complete_business_dna_manual_analysis_job(uuid, uuid, text, jsonb, text) to service_role;
grant execute on function public.expire_business_dna_manual_analysis_jobs(integer) to service_role;

notify pgrst, 'reload schema';
commit;
