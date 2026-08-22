-- iNrCy — repair for the dashboard onboarding read path
--
-- The application reads the current account row with the authenticated
-- Supabase client and writes through the guarded RPC.  Re-apply the exact
-- grants and RLS policy when a production project missed or partially
-- reverted the onboarding migration.  This script is idempotent and does
-- not grant access to anon or service data to unauthenticated callers.

begin;

do $$
begin
  if to_regclass('public.inrcy_onboarding_states') is null
     or to_regprocedure('public.inrcy_can_access_account(uuid)') is null
     or to_regprocedure('public.inrcy_save_onboarding_state(uuid,text,text,smallint)') is null then
    raise exception 'Onboarding prerequisites are missing; apply the dashboard onboarding migration first.';
  end if;
end;
$$;

revoke all on table public.inrcy_onboarding_states from anon;
grant select on table public.inrcy_onboarding_states to authenticated;
grant all on table public.inrcy_onboarding_states to service_role;

alter table public.inrcy_onboarding_states enable row level security;

drop policy if exists inrcy_onboarding_states_select_accessible
  on public.inrcy_onboarding_states;
create policy inrcy_onboarding_states_select_accessible
on public.inrcy_onboarding_states
for select
to authenticated
using (public.inrcy_can_access_account(account_id));

revoke all on function public.inrcy_save_onboarding_state(uuid, text, text, smallint)
  from public, anon;
grant execute on function public.inrcy_save_onboarding_state(uuid, text, text, smallint)
  to authenticated, service_role;

commit;
