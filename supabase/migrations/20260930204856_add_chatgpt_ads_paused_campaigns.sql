-- ChatGPT Ads can persist a remotely created campaign only in a paused state.
-- TikTok and X remain local-draft-only until their own publishing paths are approved.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_provider_check;

alter table public.ads_campaigns
  add constraint ads_campaigns_provider_check
  check (provider = any (array['meta'::text, 'google'::text, 'linkedin'::text, 'tiktok'::text, 'pinterest'::text, 'x'::text, 'openai'::text]));

alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_planned_channels_draft_only;

alter table public.ads_campaigns
  add constraint ads_campaigns_planned_channels_draft_only
  check (
    provider = any (array['meta'::text, 'google'::text, 'pinterest'::text, 'linkedin'::text])
    or (provider = 'openai' and status in ('draft', 'publishing', 'paused', 'needs_review'))
    or (status = 'draft' and ad_account_id = '')
  );

comment on constraint ads_campaigns_planned_channels_draft_only on public.ads_campaigns is
  'Meta, Google, Pinterest and LinkedIn may persist provider resources; ChatGPT Ads may persist drafts and paused provider resources only; TikTok and X remain local draft-only.';
