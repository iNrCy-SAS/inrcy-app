begin;
set local lock_timeout = '10s';

-- Meta App Review is approved. Open Threads on existing accounts as well as
-- future profiles, preserving every other bubble, role and subscription.
insert into public.app_bubble_access (user_id, bubble_key, enabled)
select user_id, 'threads', true from public.profiles
on conflict (user_id, bubble_key) do update
  set enabled = true, updated_at = now()
  where public.app_bubble_access.enabled is distinct from true;

create or replace function public.create_default_bubble_access()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.app_bubble_access (user_id, bubble_key, enabled)
  select new.user_id, b.bubble_key,
    case when b.bubble_key in ('tiktok', 'inr_agent') then false else true end
  from (values ('inrbadge'), ('mails'), ('site_web'), ('gmb'), ('facebook'), ('instagram'),
    ('threads'), ('linkedin'), ('tiktok'), ('inr_agent'), ('inr_calendar'), ('inr_crm'),
    ('inr_send'), ('inr_stats'), ('documents')) b(bubble_key)
  on conflict (user_id, bubble_key) do nothing;
  return new;
end;
$function$;
revoke all on function public.create_default_bubble_access() from public, anon, authenticated;

-- The existing Meta RPCs remain service-role-only. The application now passes
-- p_admin_pilot=false, while OAuth still resolves and binds account membership.
commit;
