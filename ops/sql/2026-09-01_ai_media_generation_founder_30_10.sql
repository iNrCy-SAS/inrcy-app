-- Aligne les plafonds finaux du Studio média IA avec le code déployé.
-- Standard : 20 images / 5 vidéos.
-- Premium et Founder : 30 images / 10 vidéos.
-- Migration additive et idempotente : aucun compte, média ni historique supprimé.

begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'AI_MEDIA_FOUNDER_30_10_PREREQUISITE_MISSING';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_plan_limits'
      and column_name = 'image_monthly_limit'
      and data_type = 'integer'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_plan_limits'
      and column_name = 'video_monthly_limit'
      and data_type = 'integer'
  ) or not exists (
    select 1 from public.ai_media_plan_limits where edition = 'standard'
  ) or not exists (
    select 1 from public.ai_media_plan_limits where edition = 'premium'
  ) or not exists (
    select 1 from public.ai_media_plan_limits where edition = 'founder'
  ) then
    raise exception 'AI_MEDIA_FINAL_QUOTAS_PREREQUISITE_MISSING';
  end if;
end
$$;

update public.ai_media_plan_limits
set
  image_monthly_limit = case edition
    when 'standard' then 20
    when 'premium' then 30
    when 'founder' then 30
  end,
  video_monthly_limit = case edition
    when 'standard' then 5
    when 'premium' then 10
    when 'founder' then 10
  end,
  updated_at = now()
where edition in ('standard', 'premium', 'founder')
  and (image_monthly_limit, video_monthly_limit) is distinct from (
    case edition when 'standard' then 20 else 30 end,
    case edition when 'standard' then 5 else 10 end
  );

do $$
begin
  if (
    select count(*)
    from public.ai_media_plan_limits
    where studio_enabled = true
      and (
        (edition = 'standard' and image_monthly_limit = 20 and video_monthly_limit = 5)
        or (edition = 'premium' and image_monthly_limit = 30 and video_monthly_limit = 10)
        or (edition = 'founder' and image_monthly_limit = 30 and video_monthly_limit = 10)
      )
  ) <> 3 then
    raise exception 'AI_MEDIA_FINAL_QUOTAS_VERIFICATION_FAILED';
  end if;
end
$$;

commit;
