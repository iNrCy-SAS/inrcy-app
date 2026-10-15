begin;

create table public.ai_media_composition_checkpoints (
  job_id uuid primary key references public.ai_media_generation_jobs(id) on delete cascade,
  account_id uuid not null references public.inrcy_accounts(id) on delete cascade,
  actor_auth_user_id uuid not null references auth.users(id) on delete cascade,
  state text not null check (state in ('uploading','ready','finished','failed')),
  manifest_path text,
  lease_token uuid not null,
  lease_until timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 3),
  expires_at timestamptz not null default now()+interval '24 hours',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_media_composition_checkpoints enable row level security;
revoke all on table public.ai_media_composition_checkpoints from public,anon,authenticated;
grant select,insert,update,delete on table public.ai_media_composition_checkpoints to service_role;
create index ai_media_composition_ready_idx on public.ai_media_composition_checkpoints(lease_until,created_at) where state='ready';

create function public.has_ai_media_composition_checkpoint(p_account_id uuid,p_job_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.ai_media_composition_checkpoints c
    where c.account_id=p_account_id and c.job_id=p_job_id and c.expires_at>now()
      and ((c.state='ready' and (c.attempts<3 or c.lease_until>now()))
        or (c.state='uploading' and c.lease_until>now())));
$$;

create function public.start_ai_media_composition_checkpoint(p_account_id uuid,p_job_id uuid,p_actor_auth_user_id uuid,p_lease_token uuid)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
declare v_job public.ai_media_generation_jobs%rowtype; v_checkpoint public.ai_media_composition_checkpoints%rowtype;
begin
  if p_lease_token is null then raise exception 'AI_MEDIA_COMPOSITION_LEASE_REQUIRED'; end if;
  perform public.ai_media_credit_lock(p_account_id);
  select * into v_job from public.ai_media_generation_jobs j where j.id=p_job_id and j.account_id=p_account_id for update;
  if not found or v_job.actor_auth_user_id is distinct from p_actor_auth_user_id then raise exception 'AI_MEDIA_COMPOSITION_SCOPE_MISMATCH'; end if;
  if v_job.media_kind<>'video' or v_job.status not in ('reserved','processing') then raise exception 'AI_MEDIA_COMPOSITION_JOB_TERMINAL'; end if;
  select * into v_checkpoint from public.ai_media_composition_checkpoints c where c.job_id=p_job_id for update;
  if found then
    if v_checkpoint.lease_token<>p_lease_token or v_checkpoint.lease_until<=now() or v_checkpoint.expires_at<=now()
      or v_checkpoint.state not in ('uploading','ready') then raise exception 'AI_MEDIA_COMPOSITION_LEASE_CONFLICT'; end if;
    update public.ai_media_composition_checkpoints set lease_until=least(expires_at,now()+interval '15 minutes'),updated_at=now() where job_id=p_job_id;
  else
    insert into public.ai_media_composition_checkpoints(job_id,account_id,actor_auth_user_id,state,lease_token,lease_until)
      values(p_job_id,p_account_id,p_actor_auth_user_id,'uploading',p_lease_token,now()+interval '15 minutes');
  end if;
  update public.ai_media_generation_jobs set reservation_expires_at=greatest(reservation_expires_at,now()+interval '24 hours') where id=p_job_id;
  return true;
end $$;

create function public.ready_ai_media_composition_checkpoint(p_account_id uuid,p_job_id uuid,p_lease_token uuid,p_manifest_path text)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
begin
  if p_manifest_path is null or p_manifest_path !~ ('^'||p_account_id::text||'/_composition-recovery/'||p_job_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/manifest[.]json$') then
    raise exception 'AI_MEDIA_COMPOSITION_PATH_INVALID';
  end if;
  update public.ai_media_composition_checkpoints c set state='ready',manifest_path=p_manifest_path,updated_at=now()
    where c.job_id=p_job_id and c.account_id=p_account_id and c.lease_token=p_lease_token and c.lease_until>now()
      and c.expires_at>now() and c.state in ('uploading','ready');
  if not found then raise exception 'AI_MEDIA_COMPOSITION_LEASE_CONFLICT'; end if;
  return true;
end $$;

create function public.expire_ai_media_composition_checkpoints()
returns integer language plpgsql volatile security invoker set search_path='' as $$
declare candidate record; expired_count integer:=0;
begin
  for candidate in select c.job_id,c.account_id from public.ai_media_composition_checkpoints c
    where c.state in ('uploading','ready') and (c.expires_at<=now()
      or (c.lease_until<=now() and (c.state='uploading' or c.attempts>=3)))
    order by c.lease_until,c.job_id limit 100 loop
    perform public.ai_media_credit_lock(candidate.account_id);
    perform 1 from public.ai_media_generation_jobs j where j.id=candidate.job_id for update;
    update public.ai_media_composition_checkpoints c set state='failed',updated_at=now()
      where c.job_id=candidate.job_id and c.state in ('uploading','ready') and (c.expires_at<=now()
        or (c.lease_until<=now() and (c.state='uploading' or c.attempts>=3)));
    if found then
      update public.ai_media_generation_jobs set reservation_expires_at=least(reservation_expires_at,now())
        where id=candidate.job_id and account_id=candidate.account_id and status in ('reserved','processing');
      expired_count:=expired_count+1;
    end if;
  end loop;
  return expired_count;
end $$;

create function public.claim_ai_media_composition_checkpoint()
returns table(account_id uuid,job_id uuid,actor_auth_user_id uuid,manifest_path text,lease_token uuid,attempts integer)
language plpgsql volatile security invoker set search_path='' as $$
declare candidate record; claimed public.ai_media_composition_checkpoints%rowtype; v_job_status text;
begin
  -- Crashes during upload or during the last allowed retry cannot hold credits
  -- until tomorrow: an expired lease is safe after the Function's 800s limit.
  perform public.expire_ai_media_composition_checkpoints();
  for candidate in select c.job_id,c.account_id from public.ai_media_composition_checkpoints c
    where c.state='ready' and c.lease_until<=now() and c.expires_at>now() and c.attempts<3
    order by c.lease_until,c.created_at,c.job_id limit 25 loop
    -- Same lock order as reservation/expiry: account, job, checkpoint.
    perform public.ai_media_credit_lock(candidate.account_id);
    select j.status into v_job_status from public.ai_media_generation_jobs j where j.id=candidate.job_id and j.account_id=candidate.account_id
      and j.status in ('reserved','processing','completed') for update;
    if not found then continue; end if;
    -- The INSERT trigger may already have completed the job, then the user may
    -- have discarded its draft before our finish acknowledgement arrived.
    -- Never recreate a deliberately removed completed result.
    if v_job_status='completed' then
      update public.ai_media_composition_checkpoints c set state='finished',lease_until=now(),updated_at=now()
        where c.job_id=candidate.job_id and c.account_id=candidate.account_id and c.state='ready' and c.lease_until<=now();
      continue;
    end if;
    update public.ai_media_composition_checkpoints c set lease_token=gen_random_uuid(),
      lease_until=least(c.expires_at,now()+interval '15 minutes'),attempts=c.attempts+1,updated_at=now()
      where c.job_id=candidate.job_id and c.account_id=candidate.account_id and c.state='ready'
        and c.lease_until<=now() and c.expires_at>now()+interval '15 minutes' and c.attempts<3
      returning * into claimed;
    if found then return query select claimed.account_id,claimed.job_id,claimed.actor_auth_user_id,claimed.manifest_path,claimed.lease_token,claimed.attempts; return; end if;
  end loop;
end $$;

create function public.release_ai_media_composition_checkpoint(p_account_id uuid,p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
declare v_state text;
begin
  perform public.ai_media_credit_lock(p_account_id);
  update public.ai_media_composition_checkpoints c set lease_until=now(),updated_at=now(),
    state=case when c.state='uploading' or c.attempts>=3 or c.expires_at<=now() then 'failed' else c.state end
    where c.job_id=p_job_id and c.account_id=p_account_id and c.lease_token=p_lease_token and c.state in ('uploading','ready') returning state into v_state;
  if not found then return false; end if;
  if v_state='failed' then update public.ai_media_generation_jobs set reservation_expires_at=now()
    where id=p_job_id and account_id=p_account_id and status in ('reserved','processing'); end if;
  return true;
end $$;

-- A failed advisory upload must not expire the main request's reservation while
-- it is still composing. A ready manifest with a lost acknowledgement is kept.
create function public.abandon_ai_media_composition_checkpoint(p_account_id uuid,p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
begin
  perform public.ai_media_credit_lock(p_account_id);
  update public.ai_media_composition_checkpoints c set state='failed',lease_until=now(),updated_at=now()
    where c.job_id=p_job_id and c.account_id=p_account_id and c.lease_token=p_lease_token and c.state='uploading';
  if not found then return false; end if;
  -- Keep more than the original request's 720s deadline, but not a stranded
  -- 24h reservation if it crashes after an incomplete advisory upload.
  update public.ai_media_generation_jobs set reservation_expires_at=least(reservation_expires_at,now()+interval '15 minutes')
    where id=p_job_id and account_id=p_account_id and status in ('reserved','processing');
  return true;
end $$;

create function public.assert_ai_media_composition_lease(p_account_id uuid,p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
begin
  update public.ai_media_composition_checkpoints c set lease_until=least(c.expires_at,now()+interval '15 minutes'),updated_at=now()
    where c.account_id=p_account_id and c.job_id=p_job_id and c.lease_token=p_lease_token
      and c.lease_until>now() and c.expires_at>now() and c.state='ready';
  if not found then
    raise exception 'AI_MEDIA_COMPOSITION_LEASE_CONFLICT'; end if;
  return true;
end $$;

create function public.finish_ai_media_composition_checkpoint(p_account_id uuid,p_job_id uuid,p_lease_token uuid)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.ai_media_generation_jobs j where j.id=p_job_id and j.account_id=p_account_id and j.status='completed') then
    raise exception 'AI_MEDIA_COMPOSITION_JOB_NOT_COMPLETED'; end if;
  update public.ai_media_composition_checkpoints c set state='finished',lease_until=now(),updated_at=now()
    where c.job_id=p_job_id and c.account_id=p_account_id and c.lease_token=p_lease_token and c.state in ('ready','finished');
  return found;
end $$;

-- Defend lazy and scheduled expiry, including legacy jobs, even when a caller
-- passes an old reservation timestamp. Fail migration if upstream definitions drift.
do $$ declare signature text; source text; needle text; begin
  foreach signature in array array['public.ai_media_expire_account_reservations(uuid,integer)',
    'public.expire_ai_media_generation_reservations(integer)','public.expire_ai_media_credit_reservations(integer,uuid)'] loop
    select pg_get_functiondef(signature::regprocedure) into source;
    needle:=case when strpos(source,'and j.reservation_expires_at <= pg_catalog.now()')>0 then 'and j.reservation_expires_at <= pg_catalog.now()'
      when strpos(source,'and j.reservation_expires_at <= now()')>0 then 'and j.reservation_expires_at <= now()'
      else 'and j.reservation_expires_at<=now()' end;
    if strpos(source,needle)=0 then raise exception 'AI_MEDIA_COMPOSITION_EXPIRY_DRIFT'; end if;
    source:=replace(source,needle,needle||' and not public.has_ai_media_composition_checkpoint(j.account_id,j.id)');
    if signature='public.expire_ai_media_credit_reservations(integer,uuid)' then
      needle:='perform public.ai_media_credit_lock(v_job.account_id);';
      if strpos(source,needle)=0 then raise exception 'AI_MEDIA_COMPOSITION_EXPIRY_LOCK_DRIFT'; end if;
      source:=replace(source,needle,needle||' if public.has_ai_media_composition_checkpoint(v_job.account_id,v_job.id) then continue; end if;');
    end if;
    execute source;
  end loop;
end $$;

create function public.list_expired_ai_media_composition_objects(p_batch_size integer default 100)
returns table(storage_path text) language sql stable security definer set search_path='' as $$
  select o.name::text from storage.objects o
    where o.bucket_id='inrcy-pro-media' and o.created_at<now()-interval '25 hours'
      and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_composition-recovery/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(manifest[.]json|clip-[01][.]mp4|overlay-[01][.]png|narration[.](wav|mp3|ogg|aac)|soundtrack[.]wav)$'
    order by o.created_at,o.id limit least(100,greatest(1,coalesce(p_batch_size,100)));
$$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and (p.proname like '%ai_media_composition_checkpoint' or p.proname in ('assert_ai_media_composition_lease','list_expired_ai_media_composition_objects','expire_ai_media_composition_checkpoints')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
commit;
