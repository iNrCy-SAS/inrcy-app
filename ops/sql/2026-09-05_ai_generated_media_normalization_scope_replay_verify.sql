-- Vérification lecture seule après le replay ciblé.

select
  j.job_type,
  j.error_code,
  count(*) as remaining_failed_jobs
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
  )
group by j.job_type, j.error_code
order by j.job_type;

select
  job_type,
  status,
  count(*) as replayed_jobs
from public.media_processing_jobs
where status in ('queued', 'retry_wait', 'processing')
  and error_code is null
  and updated_at >= now() - interval '30 minutes'
  and job_type in ('image_normalize_v1', 'video_normalize_v1')
group by job_type, status
order by job_type, status;
