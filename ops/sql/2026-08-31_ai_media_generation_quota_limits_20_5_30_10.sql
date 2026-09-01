-- Calibre les plafonds mensuels par établissement après l'installation média IA.
-- Standard : 20 images / 5 vidéos. Premium : 30 images / 10 vidéos.
-- Founder conserve 150 images / 12 vidéos.
-- Migration additive et idempotente : aucun objet ni historique n'est supprimé.

begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'AI_MEDIA_QUOTA_LIMITS_PATCH_PREREQUISITE_MISSING: public.ai_media_plan_limits';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_plan_limits'
      and column_name = 'image_monthly_limit'
      and data_type = 'integer'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_plan_limits'
      and column_name = 'video_monthly_limit'
      and data_type = 'integer'
  ) then
    raise exception 'AI_MEDIA_QUOTA_LIMITS_PATCH_PREREQUISITE_MISSING: limit columns';
  end if;

  if (select count(*) from public.ai_media_plan_limits) <> 3
     or not exists (
       select 1 from public.ai_media_plan_limits
       where edition = 'standard'
         and (image_monthly_limit, video_monthly_limit) in ((40, 3), (20, 5))
     )
     or not exists (
       select 1 from public.ai_media_plan_limits
       where edition = 'premium'
         and (image_monthly_limit, video_monthly_limit) in ((100, 9), (30, 10))
     )
     or not exists (
       select 1 from public.ai_media_plan_limits
       where edition = 'founder'
         and image_monthly_limit = 150
         and video_monthly_limit = 12
     ) then
    raise exception 'AI_MEDIA_QUOTA_LIMITS_PATCH_PLAN_CONTRACT_MISMATCH';
  end if;
end
$$;

update public.ai_media_plan_limits
set
  image_monthly_limit = 20,
  video_monthly_limit = 5,
  updated_at = now()
where edition = 'standard'
  and (image_monthly_limit, video_monthly_limit) is distinct from (20, 5);

update public.ai_media_plan_limits
set
  image_monthly_limit = 30,
  video_monthly_limit = 10,
  updated_at = now()
where edition = 'premium'
  and (image_monthly_limit, video_monthly_limit) is distinct from (30, 10);

do $$
begin
  if not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'standard'
      and image_monthly_limit = 20
      and video_monthly_limit = 5
  ) or not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'premium'
      and image_monthly_limit = 30
      and video_monthly_limit = 10
  ) or not exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'founder'
      and image_monthly_limit = 150
      and video_monthly_limit = 12
  ) then
    raise exception 'AI_MEDIA_QUOTA_LIMITS_PATCH_VERIFICATION_FAILED';
  end if;
end
$$;

commit;
