-- Ads drafts can be edited or claimed for publishing only while they still
-- have no provider-side resources. The guard belongs in the same SQL UPDATE.
-- Both functions are callable only by the server-side service role.

create or replace function public.inrcy_update_ads_draft(
  p_user_id uuid,
  p_campaign_id uuid,
  p_expected_updated_at timestamptz,
  p_provider text,
  p_ad_account_id text,
  p_name text,
  p_daily_budget_cents integer,
  p_end_date date,
  p_draft jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  update public.ads_campaigns
     set provider = p_provider,
         ad_account_id = p_ad_account_id,
         name = p_name,
         daily_budget_cents = p_daily_budget_cents,
         end_date = p_end_date,
         draft = p_draft,
         updated_at = now()
   where id = p_campaign_id
     and user_id = p_user_id
     and status = 'draft'
     and published_at is null
     and provider_resources = '{}'::jsonb
     and updated_at = p_expected_updated_at
  returning id;
$$;

revoke all on function public.inrcy_update_ads_draft(uuid, uuid, timestamptz, text, text, text, integer, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.inrcy_update_ads_draft(uuid, uuid, timestamptz, text, text, text, integer, date, jsonb)
  to service_role;

create or replace function public.inrcy_claim_ads_draft_for_publish(
  p_user_id uuid,
  p_campaign_id uuid,
  p_expected_updated_at timestamptz
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  update public.ads_campaigns
     set status = 'publishing',
         last_error = null,
         updated_at = now()
   where id = p_campaign_id
     and user_id = p_user_id
     and status = 'draft'
     and published_at is null
     and provider_resources = '{}'::jsonb
     and updated_at = p_expected_updated_at
  returning id;
$$;

revoke all on function public.inrcy_claim_ads_draft_for_publish(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.inrcy_claim_ads_draft_for_publish(uuid, uuid, timestamptz)
  to service_role;
