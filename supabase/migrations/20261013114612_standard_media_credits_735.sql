-- Correct only the historical default Standard offer (25 images + 54 seconds).
-- Account overrides, existing jobs/orders and immutable source ledgers stay intact.
-- The credit preparation RPC adjusts an existing current period by the change
-- in its base allowance (+20 credits), once, while preserving use/reservations.
begin;
do $$
begin
  if to_regclass('public.ai_media_credit_wallets') is null
     or to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'STANDARD_MEDIA_CREDITS_DEPENDENCY_MISSING';
  end if;
end;
$$;

update public.ai_media_plan_limits
set video_monthly_limit=56,updated_at=now()
where edition='standard' and image_monthly_limit=25 and video_monthly_limit=54;

commit;
