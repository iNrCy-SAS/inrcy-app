begin transaction read only;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_plan_limits'
      and column_name = 'video_max_duration_seconds'
      and is_nullable = 'NO'
  ) then
    raise exception 'AI_MEDIA_VIDEO_DURATIONS_POSTFLIGHT_FAILED: colonne forfait absente ou nullable.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_account_limits'
      and column_name = 'video_max_duration_seconds_override'
  ) then
    raise exception 'AI_MEDIA_VIDEO_DURATIONS_POSTFLIGHT_FAILED: colonne override absente.';
  end if;

  if not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'standard'
      and image_monthly_limit = 20
      and video_monthly_limit = 5
      and studio_enabled
      and video_max_duration_seconds = 8
  ) or not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'premium'
      and image_monthly_limit = 30
      and video_monthly_limit = 6
      and studio_enabled
      and video_max_duration_seconds = 24
  ) or not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'founder'
      and image_monthly_limit = 30
      and video_monthly_limit = 6
      and studio_enabled
      and video_max_duration_seconds = 24
  ) then
    raise exception 'AI_MEDIA_VIDEO_DURATIONS_POSTFLIGHT_FAILED: valeurs forfait incorrectes.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_media_plan_limits'::regclass
      and conname = 'ai_media_plan_limits_video_duration_check'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_media_account_limits'::regclass
      and conname = 'ai_media_account_limits_video_duration_check'
  ) then
    raise exception 'AI_MEDIA_VIDEO_DURATIONS_POSTFLIGHT_FAILED: contraintes absentes.';
  end if;
end;
$$;

select
  edition,
  image_monthly_limit,
  video_monthly_limit,
  video_max_duration_seconds,
  studio_enabled
from public.ai_media_plan_limits
order by edition;

rollback;
