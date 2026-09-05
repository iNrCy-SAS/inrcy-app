-- iNrCy - replay ciblé des normalisations de médias générés par le Studio IA.
--
-- IMPORTANT : exécuter uniquement après le déploiement du correctif worker qui
-- autorise les chemins privés users/<compte>/ai-generated/{image|video}/.
--
-- Idempotence : seules les lignes encore terminalisées avec les deux codes de
-- l'incident sont sélectionnées. Un second passage ne retrouve donc rien.

begin;

do $ai_generated_scope_replay$
declare
  v_job_ids uuid[] := '{}'::uuid[];
  v_media_ids uuid[] := '{}'::uuid[];
begin
  select
    coalesce(array_agg(j.id order by j.id), '{}'::uuid[]),
    coalesce(array_agg(distinct j.media_id), '{}'::uuid[])
  into v_job_ids, v_media_ids
  from public.media_processing_jobs j
  join public.pro_media_library m
    on m.id = j.media_id
   and m.user_id = j.account_id
  where j.status = 'failed'
    and m.bucket_name = 'inrcy-pro-media'
    and m.source = 'ai_media_generation'
    and (
      (
        j.job_type = 'image_normalize_v1'
        and j.error_code = 'image_source_scope_invalid'
        and m.media_type = 'image'
        and m.storage_path like
          'users/' || j.account_id::text || '/ai-generated/image/%'
      )
      or
      (
        j.job_type = 'video_normalize_v1'
        and j.error_code = 'video_source_scope_invalid'
        and m.media_type = 'video'
        and m.storage_path like
          'users/' || j.account_id::text || '/ai-generated/video/%'
      )
    );

  update public.media_variants
  set status = 'pending',
      error_code = null,
      error_message = null,
      updated_at = now()
  where status = 'failed'
    and error_code in (
      'image_source_scope_invalid',
      'video_source_scope_invalid'
    )
    and exists (
      select 1
      from public.media_processing_jobs j
      join public.pro_media_library m
        on m.id = j.media_id
       and m.user_id = j.account_id
      where j.id = any(v_job_ids)
        and j.media_id = media_variants.media_id
        and j.account_id = media_variants.account_id
        and m.bucket_name = 'inrcy-pro-media'
        and m.source = 'ai_media_generation'
        and (
          (
            j.job_type = 'image_normalize_v1'
            and m.media_type = 'image'
            and m.storage_path like
              'users/' || j.account_id::text || '/ai-generated/image/%'
          )
          or
          (
            j.job_type = 'video_normalize_v1'
            and m.media_type = 'video'
            and m.storage_path like
              'users/' || j.account_id::text || '/ai-generated/video/%'
          )
        )
    );

  update public.pro_media_library
  set processing_status = 'queued',
      publication_status = case
        when publication_status = 'failed' then 'processing'
        else publication_status
      end,
      processing_progress = 0,
      processing_error_code = null,
      processing_error_message = null,
      processing_completed_at = null,
      updated_at = now()
  where id = any(v_media_ids)
    and processing_error_code in (
      'image_source_scope_invalid',
      'video_source_scope_invalid'
    )
    and exists (
      select 1
      from public.media_processing_jobs j
      where j.id = any(v_job_ids)
        and j.media_id = pro_media_library.id
        and j.account_id = pro_media_library.user_id
    );

  update public.media_processing_jobs
  set status = 'retry_wait',
      attempt_count = 0,
      progress = 0,
      available_at = now(),
      error_code = null,
      error_message = null,
      completed_at = null,
      locked_at = null,
      lock_expires_at = null,
      locked_by = null,
      updated_at = now()
  where id = any(v_job_ids)
    and status = 'failed'
    and error_code in (
      'image_source_scope_invalid',
      'video_source_scope_invalid'
    );
end;
$ai_generated_scope_replay$;

commit;
