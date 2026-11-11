-- Founder monthly recharge: 50 * 7 + 104 * 10 = 1,390 unified credits.
-- The item/second columns are the existing internal conversion source, not
-- separate customer wallets. Preserve paid funds, usage, reservations,
-- account overrides, other editions and the 5,290-credit rollover ceiling.
begin;

do $$
declare
  v_images integer;
  v_video integer;
  v_base integer;
  v_rollover integer;
begin
  if to_regprocedure('public.ai_media_credit_plan(uuid,text)') is null then
    raise exception 'AI_MEDIA_FOUNDER_RECHARGE_DEPENDENCY_MISSING';
  end if;

  select image_monthly_limit, video_monthly_limit into v_images, v_video
    from public.ai_media_plan_limits where edition = 'founder' for update;
  if not found then
    raise exception 'AI_MEDIA_FOUNDER_RECHARGE_PLAN_MISSING';
  end if;
  if v_images is distinct from 50 or v_video is null or v_video not in (144, 104) then
    raise exception 'AI_MEDIA_FOUNDER_RECHARGE_PLAN_DRIFT';
  end if;

  update public.ai_media_plan_limits
    set video_monthly_limit = 104, updated_at = now()
    where edition = 'founder' and video_monthly_limit = 144;

  -- NULL matches no account override. This native read checks the default
  -- plan without creating or changing any account, wallet or credit period.
  select base_limit, rollover_cap into v_base, v_rollover
    from public.ai_media_credit_plan(null::uuid, 'founder');
  if v_base is distinct from 1390 or v_rollover is distinct from 5290 then
    raise exception 'AI_MEDIA_FOUNDER_RECHARGE_TOTAL_DRIFT';
  end if;
end $$;

commit;
