-- Vérification en lecture seule des plafonds mensuels par établissement.

begin transaction read only;

with checks(check_name, passed) as (
  values
    (
      'exactement_3_editions',
      (select count(*) = 3 from public.ai_media_plan_limits)
    ),
    (
      'standard_20_images_5_videos',
      exists (
        select 1 from public.ai_media_plan_limits
        where edition = 'standard'
          and image_monthly_limit = 20
          and video_monthly_limit = 5
          and studio_enabled = true
      )
    ),
    (
      'premium_30_images_10_videos',
      exists (
        select 1 from public.ai_media_plan_limits
        where edition = 'premium'
          and image_monthly_limit = 30
          and video_monthly_limit = 10
          and studio_enabled = true
      )
    ),
    (
      'founder_150_images_12_videos_inchange',
      exists (
        select 1 from public.ai_media_plan_limits
        where edition = 'founder'
          and image_monthly_limit = 150
          and video_monthly_limit = 12
          and studio_enabled = true
      )
    )
)
select
  case when bool_and(passed) then 'PASS' else 'FAIL' end as verdict,
  count(*)::integer as checked_objects,
  count(*) filter (where not passed)::integer as failed_count,
  coalesce(array_agg(check_name order by check_name) filter (where not passed), array[]::text[]) as failed_checks
from checks;

commit;
