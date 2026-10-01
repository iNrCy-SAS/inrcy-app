-- ChatGPT Ads now supports the same real Active/Paused launch choice as the
-- other approved public Ads connectors. TikTok and X remain local-draft-only.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_planned_channels_draft_only;

alter table public.ads_campaigns
  add constraint ads_campaigns_planned_channels_draft_only
  check (
    provider = any (array['meta'::text, 'google'::text, 'pinterest'::text, 'linkedin'::text, 'openai'::text])
    or (status = 'draft' and ad_account_id = '')
  );

comment on constraint ads_campaigns_planned_channels_draft_only on public.ads_campaigns is
  'Meta, Google, Pinterest, LinkedIn and ChatGPT Ads may persist provider resources and Active or Paused campaigns; TikTok and X remain local draft-only.';
