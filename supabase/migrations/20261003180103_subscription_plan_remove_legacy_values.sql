-- Phase finale, seulement apres le deploiement du webhook qui ne recrit plus
-- Starter/Accel/Speed et apres la normalisation des lignes existantes.
begin;

-- Ne pas attendre indefiniment un verrou sur les abonnements en production.
set local lock_timeout = '5s';

do $$
declare
  v_view_sql text;
begin
  if exists (
    select 1 from public.subscriptions s
    where s.plan::text in ('Starter', 'Accel', 'Speed')
       or s.scheduled_plan::text in ('Starter', 'Accel', 'Speed')
       or s.requested_plan::text in ('Starter', 'Accel', 'Speed')
  ) then
    raise exception 'SUBSCRIPTION_PLAN_LEGACY_ROWS_REMAIN';
  end if;
  if (select pg_catalog.array_agg(e.enumlabel::text order by e.enumsortorder)
      from pg_catalog.pg_enum e
      where e.enumtypid = 'public.subscription_plan'::regtype)
       is distinct from array['Trial','Starter','Accel','Speed','Standard','Premium','Founder'] then
    raise exception 'SUBSCRIPTION_PLAN_ENUM_UNEXPECTED_VALUES';
  end if;
  if to_regclass('public.admin_ai_media_quota_overview') is null then
    raise exception 'SUBSCRIPTION_PLAN_ADMIN_QUOTA_VIEW_MISSING';
  end if;
  select pg_catalog.pg_get_viewdef('public.admin_ai_media_quota_overview'::regclass, true)
  into v_view_sql;
  if pg_catalog.length(coalesce(v_view_sql, '')) < 100 then
    raise exception 'SUBSCRIPTION_PLAN_ADMIN_QUOTA_VIEW_UNEXPECTED';
  end if;

  drop view public.admin_ai_media_quota_overview;
  -- Le trigger reference les colonnes de plan et bloque leur changement de type.
  drop trigger trg_sync_subscription_app_edition_from_plan on public.subscriptions;
  alter table public.subscriptions alter column plan drop default;
  alter type public.subscription_plan rename to subscription_plan_legacy;
  create type public.subscription_plan as enum ('Trial', 'Standard', 'Premium', 'Founder');
  alter table public.subscriptions
    alter column plan type public.subscription_plan
      using plan::text::public.subscription_plan,
    alter column requested_plan type public.subscription_plan
      using requested_plan::text::public.subscription_plan,
    alter column scheduled_plan type public.subscription_plan
      using scheduled_plan::text::public.subscription_plan;
  alter table public.subscriptions
    alter column plan set default 'Trial'::public.subscription_plan;
  drop type public.subscription_plan_legacy;

  create trigger trg_sync_subscription_app_edition_from_plan
  before insert or update of plan, scheduled_plan, requested_plan, app_edition
  on public.subscriptions
  for each row execute function public.sync_subscription_app_edition_from_plan();

  perform pg_catalog.set_config('search_path', 'public,auth,pg_catalog', true);
  execute 'create view public.admin_ai_media_quota_overview with (security_invoker=true) as '
    || v_view_sql;
  revoke all on public.admin_ai_media_quota_overview from public, anon, authenticated;
  grant all on public.admin_ai_media_quota_overview to service_role;
  comment on view public.admin_ai_media_quota_overview is
    'Vue admin en lecture seule : tous les etablissements, abonnement/essai et quota iNrStudio courant.';
end;
$$;

do $$
begin
  if (select pg_catalog.array_agg(e.enumlabel::text order by e.enumsortorder)
      from pg_catalog.pg_enum e
      where e.enumtypid = 'public.subscription_plan'::regtype)
       is distinct from array['Trial','Standard','Premium','Founder'] then
    raise exception 'SUBSCRIPTION_PLAN_ENUM_POSTFLIGHT_FAILED';
  end if;
  if to_regclass('public.admin_ai_media_quota_overview') is null then
    raise exception 'SUBSCRIPTION_PLAN_ADMIN_QUOTA_VIEW_POSTFLIGHT_FAILED';
  end if;
end;
$$;

commit;
