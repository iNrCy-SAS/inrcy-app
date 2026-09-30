-- Image recharge only. Existing usage, reservations, account overrides and
-- rollover caps remain untouched; the existing rollover RPC applies the delta.
begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'AI_MEDIA_IMAGE_LIMITS_MISSING_TABLE';
  end if;
  if (select count(*) from public.ai_media_plan_limits
      where edition in ('standard', 'premium', 'founder')) <> 3 then
    raise exception 'AI_MEDIA_IMAGE_LIMITS_MISSING_PLANS';
  end if;
  if exists (
    select 1 from public.ai_media_plan_limits
    where (edition = 'standard' and image_monthly_limit not in (20, 25))
       or (edition in ('premium', 'founder') and image_monthly_limit not in (30, 50))
  ) then
    raise exception 'AI_MEDIA_IMAGE_LIMITS_UNEXPECTED_BASE';
  end if;
end;
$$;

update public.ai_media_plan_limits
set image_monthly_limit = case edition
  when 'standard' then 25
  when 'premium' then 50
  when 'founder' then 50
end
where edition in ('standard', 'premium', 'founder')
  and image_monthly_limit is distinct from case edition
    when 'standard' then 25
    when 'premium' then 50
    when 'founder' then 50
  end;

do $$
begin
  if (select count(*) from public.ai_media_plan_limits
      where (edition = 'standard' and image_monthly_limit = 25)
         or (edition in ('premium', 'founder') and image_monthly_limit = 50)) <> 3 then
    raise exception 'AI_MEDIA_IMAGE_LIMITS_POSTFLIGHT_FAILED';
  end if;
end;
$$;

commit;
