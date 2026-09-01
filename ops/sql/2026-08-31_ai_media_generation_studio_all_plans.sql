-- Ouvre l'atelier « Générer un média » à toutes les éditions déjà installées.
-- Migration additive et idempotente : aucun objet ni aucune donnée n'est supprimé.

begin;

do $$
begin
  if to_regclass('public.ai_media_plan_limits') is null then
    raise exception 'AI_MEDIA_STUDIO_PATCH_PREREQUISITE_MISSING: public.ai_media_plan_limits';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_media_plan_limits'
      and column_name = 'studio_enabled'
      and data_type = 'boolean'
  ) then
    raise exception 'AI_MEDIA_STUDIO_PATCH_PREREQUISITE_MISSING: studio_enabled';
  end if;

  if (
    select count(*)
    from public.ai_media_plan_limits
    where (edition, image_monthly_limit, video_monthly_limit) in (
      ('standard', 40, 3),
      ('premium', 100, 9),
      ('founder', 150, 12)
    )
  ) <> 3 then
    raise exception 'AI_MEDIA_STUDIO_PATCH_PLAN_CONTRACT_MISMATCH';
  end if;
end
$$;

update public.ai_media_plan_limits
set
  studio_enabled = true,
  updated_at = now()
where edition in ('standard', 'premium', 'founder')
  and studio_enabled is distinct from true;

do $$
begin
  if exists (
    select 1
    from public.ai_media_plan_limits
    where edition in ('standard', 'premium', 'founder')
      and studio_enabled is distinct from true
  ) then
    raise exception 'AI_MEDIA_STUDIO_PATCH_VERIFICATION_FAILED';
  end if;
end
$$;

commit;
