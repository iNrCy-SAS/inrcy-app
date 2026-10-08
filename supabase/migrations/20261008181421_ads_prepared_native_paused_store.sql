-- Allow durable, suspended TikTok/X creation without enabling their drivers.
-- Existing five connector behaviors, RLS and grants remain unchanged.
-- The application still requires explicit paused consent, fresh native proof
-- and a provider-specific flag that is closed by default.
begin;

alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_planned_channels_draft_only;

alter table public.ads_campaigns
  add constraint ads_campaigns_planned_channels_draft_only
  check (
    provider = any (array['meta'::text, 'google'::text, 'pinterest'::text, 'linkedin'::text, 'openai'::text])
    or (status = 'draft' and ad_account_id = '')
    or (
      provider in ('tiktok', 'x')
      and status in ('draft', 'publishing', 'paused', 'needs_review')
      and jsonb_typeof(draft) = 'object'
      and (draft ->> 'provider') is not distinct from provider
      and (draft ->> 'adAccountId') is not distinct from ad_account_id
      and (
        (provider = 'tiktok' and ad_account_id ~ '^[0-9]{5,30}$')
        or (provider = 'x' and ad_account_id ~ '^[A-Za-z0-9]{1,128}$')
      )
    )
  );

comment on constraint ads_campaigns_planned_channels_draft_only on public.ads_campaigns is
  'Existing live connectors are unchanged. TikTok/X support durable draft/publishing/paused/needs_review records only; this constraint does not authorize provider writes or active delivery.';

-- Freeze this exact validated definition in a service-role-only read function.
-- Missing migration, invalidated/replaced constraint, or a reverted definition
-- yields false instead of discovering schema support with an UPDATE attempt.
do $migration$
declare
  expected_definition text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid)
    into strict expected_definition
    from pg_catalog.pg_constraint as c
   where c.conrelid = 'public.ads_campaigns'::pg_catalog.regclass
     and c.conname = 'ads_campaigns_planned_channels_draft_only'
     and c.convalidated;

  execute pg_catalog.format($function$
    create or replace function public.inrcy_ads_prepared_paused_store_ready()
    returns boolean
    language sql
    stable
    security invoker
    set search_path = ''
    as $body$
      select exists (
        select 1 from pg_catalog.pg_constraint as c
         where c.conrelid = 'public.ads_campaigns'::pg_catalog.regclass
           and c.conname = 'ads_campaigns_planned_channels_draft_only'
           and c.convalidated
           and pg_catalog.pg_get_constraintdef(c.oid) = %L
      );
    $body$;
  $function$, expected_definition);
end;
$migration$;

revoke all on function public.inrcy_ads_prepared_paused_store_ready()
  from public, anon, authenticated;
grant execute on function public.inrcy_ads_prepared_paused_store_ready()
  to service_role;

notify pgrst, 'reload schema';
commit;
