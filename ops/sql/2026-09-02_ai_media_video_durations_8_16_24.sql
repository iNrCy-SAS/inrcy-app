-- UNIQUE SQL REQUIRED FOR THE 8/16/24 VIDEO ROLLOUT.
-- Additive and idempotent: account-specific image/video overrides are kept.
begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null
     or to_regclass('public.ai_media_account_limits') is null then
    raise exception 'AI_MEDIA_VIDEO_DURATIONS_PREFLIGHT_FAILED: executez d abord le socle quotas et le patch des limites par compte.';
  end if;
end;
$$;

alter table public.ai_media_plan_limits
  add column if not exists video_max_duration_seconds integer;

alter table public.ai_media_account_limits
  add column if not exists video_max_duration_seconds_override integer;

update public.ai_media_plan_limits as plan
set image_monthly_limit = expected.image_limit,
    video_monthly_limit = expected.video_limit,
    studio_enabled = true,
    video_max_duration_seconds = expected.max_duration,
    updated_at = now()
from (
  values
    ('standard'::text, 20, 5, 8),
    ('premium'::text, 30, 6, 24),
    ('founder'::text, 30, 6, 24)
) as expected(edition, image_limit, video_limit, max_duration)
where plan.edition = expected.edition
  and (
    plan.image_monthly_limit is distinct from expected.image_limit
    or plan.video_monthly_limit is distinct from expected.video_limit
    or plan.studio_enabled is distinct from true
    or plan.video_max_duration_seconds is distinct from expected.max_duration
  );

-- Une éventuelle édition interne historique ne doit pas empêcher le passage
-- NOT NULL. Elle reçoit le plafond prudent de 24 s sans modifier ses quotas.
update public.ai_media_plan_limits
set video_max_duration_seconds = 24,
    updated_at = now()
where video_max_duration_seconds is null;

alter table public.ai_media_plan_limits
  alter column video_max_duration_seconds set default 24,
  alter column video_max_duration_seconds set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_plan_limits'::regclass
      and conname = 'ai_media_plan_limits_video_duration_check'
  ) then
    alter table public.ai_media_plan_limits
      add constraint ai_media_plan_limits_video_duration_check
      check (video_max_duration_seconds in (8, 16, 24));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.ai_media_account_limits'::regclass
      and conname = 'ai_media_account_limits_video_duration_check'
  ) then
    alter table public.ai_media_account_limits
      add constraint ai_media_account_limits_video_duration_check
      check (
        video_max_duration_seconds_override is null
        or video_max_duration_seconds_override in (8, 16, 24)
      );
  end if;
end;
$$;

comment on column public.ai_media_plan_limits.video_max_duration_seconds is
  'Duree maximale video IA du forfait. Valeurs natives iNrCy autorisees: 8, 16 ou 24 secondes.';
comment on column public.ai_media_account_limits.video_max_duration_seconds_override is
  'NULL = forfait; 8, 16 ou 24 = duree maximale video IA propre a cet etablissement.';

do $$
begin
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
    raise exception 'AI_MEDIA_VIDEO_DURATIONS_VERIFICATION_FAILED: politiques forfait incorrectes.';
  end if;
end;
$$;

commit;
