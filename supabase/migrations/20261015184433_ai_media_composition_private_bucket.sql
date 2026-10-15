begin;

-- Internal paid inputs include WAV and JSON, which the media library rejects.
-- Keep the media-library allowlist unchanged and use an isolated private bucket.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('inrcy-ai-composition','inrcy-ai-composition',false,134217728,
  array['video/mp4','image/png','audio/wav','audio/mpeg','audio/ogg','audio/aac','application/json']::text[]);

-- Restrictive rules also deny broad existing permissive Storage policies.
-- service_role remains the only application role that can use this bucket.
create policy ai_media_composition_objects_internal_only on storage.objects
  as restrictive for all to anon,authenticated
  using(bucket_id<>'inrcy-ai-composition') with check(bucket_id<>'inrcy-ai-composition');
create policy ai_media_composition_bucket_internal_only on storage.buckets
  as restrictive for all to anon,authenticated
  using(id<>'inrcy-ai-composition') with check(id<>'inrcy-ai-composition');

-- Existing checkpoints and older writers retain their actual bucket.
alter table public.ai_media_composition_checkpoints add column storage_bucket text not null default 'inrcy-pro-media'
  check(storage_bucket in ('inrcy-pro-media','inrcy-ai-composition'));

create function public.start_ai_media_composition_checkpoint_v2(p_account_id uuid,p_job_id uuid,p_actor_auth_user_id uuid,p_lease_token uuid)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
begin
  perform public.start_ai_media_composition_checkpoint(p_account_id,p_job_id,p_actor_auth_user_id,p_lease_token);
  update public.ai_media_composition_checkpoints c set storage_bucket='inrcy-ai-composition'
    where c.job_id=p_job_id and c.account_id=p_account_id and c.lease_token=p_lease_token
      and ((c.state='uploading' and c.manifest_path is null) or c.storage_bucket='inrcy-ai-composition');
  if not found then raise exception 'AI_MEDIA_COMPOSITION_BUCKET_CONFLICT'; end if;
  return true;
end $$;
revoke all on function public.start_ai_media_composition_checkpoint_v2(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_ai_media_composition_checkpoint_v2(uuid,uuid,uuid,uuid) to service_role;

-- Preserve v1 RPC signatures for the version still running during deployment.
create function public.claim_ai_media_composition_checkpoint_v2()
returns table(account_id uuid,job_id uuid,actor_auth_user_id uuid,manifest_path text,lease_token uuid,attempts integer,storage_bucket text)
language plpgsql volatile security invoker set search_path='' as $$
declare candidate record; claimed public.ai_media_composition_checkpoints%rowtype; v_job_status text;
begin
  perform public.expire_ai_media_composition_checkpoints();
  for candidate in select c.job_id,c.account_id from public.ai_media_composition_checkpoints c
    where c.state='ready' and c.lease_until<=now() and c.expires_at>now() and c.attempts<3
    order by c.lease_until,c.created_at,c.job_id limit 25 loop
    perform public.ai_media_credit_lock(candidate.account_id);
    select j.status into v_job_status from public.ai_media_generation_jobs j where j.id=candidate.job_id and j.account_id=candidate.account_id
      and j.status in ('reserved','processing','completed') for update;
    if not found then continue; end if;
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
    if found then return query select claimed.account_id,claimed.job_id,claimed.actor_auth_user_id,
      claimed.manifest_path,claimed.lease_token,claimed.attempts,claimed.storage_bucket; return; end if;
  end loop;
end
$$;
revoke all on function public.claim_ai_media_composition_checkpoint_v2() from public,anon,authenticated;
grant execute on function public.claim_ai_media_composition_checkpoint_v2() to service_role;

-- An older worker downloads from the library bucket and must not claim new inputs.
do $$ declare source text; needle text := 'where c.state=''ready'' and c.lease_until<=now() and c.expires_at>now() and c.attempts<3'; begin
  select pg_get_functiondef('public.claim_ai_media_composition_checkpoint()'::regprocedure) into source;
  if strpos(source,needle)=0 then raise exception 'AI_MEDIA_COMPOSITION_LEGACY_CLAIM_DRIFT'; end if;
  execute replace(source,needle,needle||' and c.storage_bucket=''inrcy-pro-media''');
end $$;

create function public.list_expired_ai_media_composition_objects_v2(p_batch_size integer default 100)
returns table(storage_bucket text,storage_path text) language sql stable security definer set search_path='' as $$
  select o.bucket_id::text,o.name::text from storage.objects o
    where o.bucket_id in ('inrcy-pro-media','inrcy-ai-composition') and o.created_at<now()-interval '25 hours'
      and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/_composition-recovery/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(manifest[.]json|clip-[01][.]mp4|overlay-[01][.]png|narration[.](wav|mp3|ogg|aac)|soundtrack[.]wav)$'
    order by o.created_at,o.id limit least(100,greatest(1,coalesce(p_batch_size,100)));
$$;
revoke all on function public.list_expired_ai_media_composition_objects_v2(integer) from public,anon,authenticated;
grant execute on function public.list_expired_ai_media_composition_objects_v2(integer) to service_role;
comment on function public.list_expired_ai_media_composition_objects_v2(integer) is 'Internal legacy and dedicated bucket inventory. Only the Storage API deletes objects.';
commit;
