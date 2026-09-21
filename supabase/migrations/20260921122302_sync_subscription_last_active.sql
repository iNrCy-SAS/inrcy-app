-- Mirror the activity timestamp tracked on profiles in the subscription
-- overview. profiles.last_active_at remains the single source of truth.
alter table public.subscriptions
  add column if not exists last_active_at timestamptz;

comment on column public.subscriptions.last_active_at is
  'Mirror of profiles.last_active_at for subscription administration.';

-- Populate existing subscriptions before enabling continuous synchronization.
update public.subscriptions as subscription
set last_active_at = profile.last_active_at
from public.profiles as profile
where profile.user_id = subscription.user_id
  and subscription.last_active_at is distinct from profile.last_active_at;

create or replace function public.sync_profile_last_active_to_subscription()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  update public.subscriptions
  set last_active_at = new.last_active_at
  where user_id = new.user_id
    and last_active_at is distinct from new.last_active_at;

  return new;
end;
$function$;

drop trigger if exists trg_sync_profile_last_active_to_subscription
  on public.profiles;

create trigger trg_sync_profile_last_active_to_subscription
after insert or update of last_active_at on public.profiles
for each row
execute function public.sync_profile_last_active_to_subscription();

-- If a subscription is created after its profile, initialize the mirror on
-- insert instead of waiting for the next activity heartbeat.
create or replace function public.set_subscription_last_active_from_profile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  profile_last_active_at timestamptz;
begin
  select profile.last_active_at
  into profile_last_active_at
  from public.profiles as profile
  where profile.user_id = new.user_id;

  if found then
    new.last_active_at := profile_last_active_at;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_set_subscription_last_active_before_insert
  on public.subscriptions;

create trigger trg_set_subscription_last_active_before_insert
before insert on public.subscriptions
for each row
execute function public.set_subscription_last_active_from_profile();

revoke all on function public.sync_profile_last_active_to_subscription() from public;
revoke all on function public.set_subscription_last_active_from_profile() from public;
