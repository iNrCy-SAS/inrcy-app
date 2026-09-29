-- Real provider-side PAUSED campaigns remain resumable from iNrSend.
-- `demo_paused` is kept for historical review/demo records only.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_status_check;

alter table public.ads_campaigns
  add constraint ads_campaigns_status_check
  check (status in ('draft', 'publishing', 'active', 'paused', 'needs_review', 'demo_paused'));

comment on constraint ads_campaigns_status_check on public.ads_campaigns is
  'paused is a real provider-side campaign that can be resumed; demo_paused is retained for historical non-resumable demos.';
