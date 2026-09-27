-- Both actions re-check every safety predicate in the same SQL statement as
-- the mutation. A provider resource created after the API read therefore
-- prevents local deletion/extension instead of orphaning a live campaign.
-- The service role calls these functions with its own privileges; no elevated
-- SECURITY DEFINER function is exposed in the public schema.
grant delete on public.ads_campaigns to service_role;

create or replace function public.inrcy_extend_ads_draft(
  p_user_id uuid,
  p_campaign_id uuid,
  p_expected_updated_at timestamptz,
  p_current_end_date date,
  p_next_end_date date,
  p_draft jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_id uuid;
begin
  if p_next_end_date <= p_current_end_date then
    return null;
  end if;

  update public.ads_campaigns
     set end_date = p_next_end_date,
         draft = p_draft,
         updated_at = now()
   where id = p_campaign_id
     and user_id = p_user_id
     and status = 'draft'
     and published_at is null
     and provider_resources = '{}'::jsonb
     and end_date = p_current_end_date
     and updated_at = p_expected_updated_at
  returning id into v_campaign_id;

  return v_campaign_id;
end;
$$;

revoke all on function public.inrcy_extend_ads_draft(uuid, uuid, timestamptz, date, date, jsonb)
  from public, anon, authenticated;
grant execute on function public.inrcy_extend_ads_draft(uuid, uuid, timestamptz, date, date, jsonb)
  to service_role;

create or replace function public.inrcy_delete_ads_draft(
  p_user_id uuid,
  p_campaign_id uuid,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_campaign_id uuid;
begin
  delete from public.ads_campaigns
   where id = p_campaign_id
     and user_id = p_user_id
     and status = 'draft'
     and published_at is null
     and provider_resources = '{}'::jsonb
     and updated_at = p_expected_updated_at
  returning id into v_campaign_id;

  return v_campaign_id;
end;
$$;

revoke all on function public.inrcy_delete_ads_draft(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.inrcy_delete_ads_draft(uuid, uuid, timestamptz)
  to service_role;
