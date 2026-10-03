-- Recharge video mensuelle Premium : 196 secondes. Les comptes Founder,
-- les overrides individuels, les usages deja comptabilises et la cagnotte
-- reportable restent inchanges.
begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'AI_MEDIA_PREMIUM_VIDEO_LIMITS_MISSING_TABLE';
  end if;
  if (select count(*) from public.ai_media_plan_limits where edition = 'premium') <> 1 then
    raise exception 'AI_MEDIA_PREMIUM_VIDEO_LIMITS_MISSING_PLAN';
  end if;
  if exists (
    select 1 from public.ai_media_plan_limits
    where edition = 'premium' and video_monthly_limit not in (144, 196)
  ) then
    raise exception 'AI_MEDIA_PREMIUM_VIDEO_LIMITS_UNEXPECTED_BASE';
  end if;
end;
$$;

update public.ai_media_plan_limits
set video_monthly_limit = 196,
    updated_at = pg_catalog.now()
where edition = 'premium'
  and video_monthly_limit is distinct from 196;

do $$
begin
  if (select count(*) from public.ai_media_plan_limits
      where edition = 'premium' and video_monthly_limit = 196) <> 1 then
    raise exception 'AI_MEDIA_PREMIUM_VIDEO_LIMITS_POSTFLIGHT_FAILED';
  end if;
end;
$$;

commit;
