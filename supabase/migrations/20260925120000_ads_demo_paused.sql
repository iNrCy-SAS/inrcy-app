-- A reviewer/demo run can create provider resources, but this explicit state
-- ensures the campaign can never be reopened and accidentally published.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_status_check;

alter table public.ads_campaigns
  add constraint ads_campaigns_status_check
  check (status in ('draft', 'publishing', 'active', 'needs_review', 'demo_paused'));

comment on constraint ads_campaigns_status_check on public.ads_campaigns is
  'demo_paused denotes a provider-side demonstration created entirely in PAUSED state; it cannot be published from iNrCy.';
