-- Preserve paid draft results and their final diagnostics without a second debit.
begin;
create or replace function public.ai_media_credit_finish(p_account_id uuid,p_job_id uuid,p_media_id uuid,p_status text,p_error_code text,p_error_message text,p_metadata jsonb)
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
    -- The draft INSERT trigger may have already committed the credits. Enrich
    -- only delivery diagnostics here; never run the financial transition again
    -- or allow a late completion to replace reservation/quote metadata.
    update public.ai_media_generation_jobs j
      set metadata=j.metadata || (
        select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb)
        from jsonb_each(p_metadata) e
        where e.key = any(array['model','prompt_version','prompt_sha256',
          'casting_variant_key','soundtrack_id','video_engine_result','pipeline_timings_ms'])
      )
      where j.id=p_job_id returning * into v_job;
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

revoke all on function public.ai_media_credit_finish(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ai_media_credit_finish(uuid,uuid,uuid,text,text,text,jsonb) to service_role;

-- Private provider inputs can survive a crashed Function or failed SDK remove.
-- Only enumerate expired files here; the Storage API owns the actual deletion.
create function public.list_expired_ai_media_provider_images(p_batch_size integer default 100)
returns table(storage_path text)
language sql stable security definer set search_path=''
as $$
  select o.name::text
  from storage.objects o
  where o.bucket_id='inrcy-pro-media'
    and o.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_provider-temp/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9]+\.(jpg|png|webp)$'
    and o.created_at < pg_catalog.now()-interval '2 hours'
  order by o.created_at,o.id
  limit least(100,greatest(1,coalesce(p_batch_size,100)));
$$;
revoke all on function public.list_expired_ai_media_provider_images(integer) from public,anon,authenticated;
grant execute on function public.list_expired_ai_media_provider_images(integer) to service_role;
comment on function public.list_expired_ai_media_provider_images(integer) is 'Internal cleanup inventory only. Delete returned objects through the Storage API, never by SQL.';
commit;