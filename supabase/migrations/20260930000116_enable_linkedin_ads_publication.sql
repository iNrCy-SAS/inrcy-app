-- LinkedIn Advertising API Development access now backs the fail-closed image
-- publisher. Provider-side resources remain allowed only for channels with a
-- real publisher; TikTok and X stay local-draft-only.
alter table public.ads_campaigns
  drop constraint if exists ads_campaigns_planned_channels_draft_only;

alter table public.ads_campaigns
  add constraint ads_campaigns_planned_channels_draft_only
  check (
    provider = any (array['meta'::text, 'google'::text, 'pinterest'::text, 'linkedin'::text])
    or (status = 'draft' and ad_account_id = '')
  );

comment on constraint ads_campaigns_planned_channels_draft_only on public.ads_campaigns is
  'Meta, Google, Pinterest and LinkedIn may persist provider resources; TikTok and X remain local draft-only channels.';
