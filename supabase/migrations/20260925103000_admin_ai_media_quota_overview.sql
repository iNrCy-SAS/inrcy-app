-- Vue d'administration uniquement : facilite la recherche du quota
-- iNrStudio par établissement, propriétaire ou e-mail, sans dupliquer
-- l'identité AUTH dans les compteurs opérationnels. La vue démarre de
-- tous les établissements afin d'inclure les comptes en essai et ceux
-- qui n'ont pas encore généré de média.

begin;

do $$
begin
  if to_regclass('public.ai_media_monthly_usage') is null
     or to_regclass('public.inrcy_accounts') is null
     or to_regclass('public.inrcy_account_members') is null
     or to_regclass('public.subscriptions') is null
     or to_regclass('auth.users') is null then
    raise exception 'AI_MEDIA_ADMIN_OVERVIEW_PREFLIGHT_FAILED: tables requises absentes.';
  end if;
end;
$$;

create or replace view public.admin_ai_media_quota_overview
with (security_invoker = true)
as
with current_period as (
  select pg_catalog.date_trunc(
    'month',
    pg_catalog.timezone('UTC', pg_catalog.now())
  )::date as period_start
),
account_identity as (
  select
    a.id as account_id,
    a.display_name as account_name,
    a.created_by_auth_user_id,
    coalesce(a.created_by_auth_user_id, primary_member.auth_user_id) as primary_auth_user_id
  from public.inrcy_accounts a
  left join lateral (
    select m.auth_user_id
    from public.inrcy_account_members m
    where m.account_id = a.id
    order by
      case m.role
        when 'owner' then 0
        when 'admin' then 1
        else 2
      end,
      m.is_default desc,
      m.created_at asc
    limit 1
  ) primary_member on true
),
current_usage as (
  select
    usage.account_id,
    usage.period_start,
    max(usage.base_limit) filter (where usage.media_kind = 'image') as image_base_limit,
    max(usage.allocated_limit) filter (where usage.media_kind = 'image') as image_limit,
    max(usage.used_count) filter (where usage.media_kind = 'image') as image_used_count,
    max(usage.reserved_count) filter (where usage.media_kind = 'image') as image_reserved_count,
    max(usage.base_limit) filter (where usage.media_kind = 'video') as video_base_limit_seconds,
    max(usage.allocated_limit) filter (where usage.media_kind = 'video') as video_limit_seconds,
    max(usage.used_count) filter (where usage.media_kind = 'video') as video_used_seconds,
    max(usage.reserved_count) filter (where usage.media_kind = 'video') as video_reserved_seconds,
    max(usage.updated_at) as quota_updated_at
  from public.ai_media_monthly_usage usage
  join current_period period on period.period_start = usage.period_start
  group by usage.account_id, usage.period_start
)
select
  identity.account_id,
  identity.account_name,
  identity.created_by_auth_user_id,
  identity.primary_auth_user_id,
  coalesce(owner.email, latest_subscription.contact_email) as primary_email,
  latest_subscription.plan as subscription_plan,
  latest_subscription.status as subscription_status,
  latest_subscription.app_edition as subscription_edition,
  latest_subscription.trial_start_at,
  latest_subscription.trial_end_at,
  period.period_start as quota_period_start,
  (usage.account_id is not null) as quota_initialized,
  case
    when usage.account_id is null then 'not_initialized'
    when coalesce(usage.image_reserved_count, 0) > 0
      or coalesce(usage.video_reserved_seconds, 0) > 0 then 'generation_in_progress'
    else 'ready'
  end as quota_state,
  usage.image_base_limit,
  usage.image_limit,
  coalesce(usage.image_used_count, 0) as image_used_count,
  coalesce(usage.image_reserved_count, 0) as image_reserved_count,
  case
    when usage.account_id is null then null::integer
    else greatest(
      coalesce(usage.image_limit, 0)
        - coalesce(usage.image_used_count, 0)
        - coalesce(usage.image_reserved_count, 0),
      0
    )
  end as image_remaining_count,
  usage.video_base_limit_seconds,
  usage.video_limit_seconds,
  coalesce(usage.video_used_seconds, 0) as video_used_seconds,
  coalesce(usage.video_reserved_seconds, 0) as video_reserved_seconds,
  case
    when usage.account_id is null then null::integer
    else greatest(
      coalesce(usage.video_limit_seconds, 0)
        - coalesce(usage.video_used_seconds, 0)
        - coalesce(usage.video_reserved_seconds, 0),
      0
    )
  end as video_remaining_seconds,
  usage.quota_updated_at
from account_identity identity
cross join current_period period
left join lateral (
  select
    subscription.contact_email,
    subscription.plan,
    subscription.status,
    subscription.app_edition,
    subscription.trial_start_at,
    subscription.trial_end_at
  from public.subscriptions subscription
  where subscription.user_id = identity.account_id
  order by subscription.updated_at desc nulls last, subscription.start_date desc nulls last
  limit 1
) latest_subscription on true
left join auth.users owner on owner.id = identity.primary_auth_user_id
left join current_usage usage
  on usage.account_id = identity.account_id
  and usage.period_start = period.period_start;

comment on view public.admin_ai_media_quota_overview is
  'Vue admin en lecture seule : tous les établissements, abonnement/essai et quota iNrStudio courant.';

revoke all on table public.admin_ai_media_quota_overview from public, anon, authenticated;
grant select on table public.admin_ai_media_quota_overview to service_role;

commit;
