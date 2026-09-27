-- Upgrade installations where the atomic draft functions were already deployed
-- as SECURITY DEFINER. Keep their existing bodies and ownership unchanged.
begin;

grant delete on public.ads_campaigns to service_role;

alter function public.inrcy_extend_ads_draft(uuid, uuid, timestamptz, date, date, jsonb)
  security invoker;
alter function public.inrcy_delete_ads_draft(uuid, uuid, timestamptz)
  security invoker;

revoke all on function public.inrcy_extend_ads_draft(uuid, uuid, timestamptz, date, date, jsonb)
  from public, anon, authenticated;
revoke all on function public.inrcy_delete_ads_draft(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.inrcy_extend_ads_draft(uuid, uuid, timestamptz, date, date, jsonb)
  to service_role;
grant execute on function public.inrcy_delete_ads_draft(uuid, uuid, timestamptz)
  to service_role;

commit;
