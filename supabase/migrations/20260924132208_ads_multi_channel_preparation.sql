-- Allow campaign preparation for every iNr’ADS channel while keeping
-- LinkedIn, TikTok, Pinterest, and X strictly draft-only until their
-- provider OAuth and publishing adapters are implemented and approved.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_provider_check;

alter table public.ads_campaigns
  add constraint ads_campaigns_provider_check
  check (provider = any (array['meta'::text, 'google'::text, 'linkedin'::text, 'tiktok'::text, 'pinterest'::text, 'x'::text]));

alter table public.ads_campaigns
  add constraint ads_campaigns_planned_channels_draft_only
  check (
    provider = any (array['meta'::text, 'google'::text])
    or (status = 'draft' and ad_account_id = '')
  );

comment on constraint ads_campaigns_planned_channels_draft_only on public.ads_campaigns is
  'Channels without a platform integration remain draft-only and cannot be linked to an advertiser account.';
