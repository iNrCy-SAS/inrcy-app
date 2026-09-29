-- Pinterest Standard API access now backs a real campaign publisher. Keep the
-- remaining planned channels draft-only and unable to persist advertiser IDs.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_planned_channels_draft_only;

alter table public.ads_campaigns
  add constraint ads_campaigns_planned_channels_draft_only
  check (
    provider = any (array['meta'::text, 'google'::text, 'pinterest'::text])
    or (status = 'draft' and ad_account_id = '')
  );

comment on constraint ads_campaigns_planned_channels_draft_only on public.ads_campaigns is
  'Meta, Google and Pinterest may create provider resources; LinkedIn, TikTok and X remain local draft-only channels.';
