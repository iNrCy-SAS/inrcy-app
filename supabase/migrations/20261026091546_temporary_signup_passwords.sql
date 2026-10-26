begin;

-- No password is stored in plaintext or in JWT/user metadata. The short-lived
-- outbox permits a crashed signup to send the SAME credential after provisioning.
create table if not exists public.signup_welcome_credentials (
  id uuid primary key,
  user_id uuid unique references auth.users(id) on delete cascade,
  recipient_email text not null,
  first_name text not null default '',
  app_language text not null,
  encrypted_password text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  delivered_at timestamptz,
  blocked_at timestamptz,
  lease_until timestamptz,
  constraint signup_welcome_ciphertext_length check (encrypted_password is null or length(encrypted_password) between 40 and 256),
  constraint signup_welcome_validity check (expires_at > created_at and expires_at <= created_at + interval '30 days 1 minute')
);
alter table public.signup_welcome_credentials enable row level security;
revoke all on public.signup_welcome_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.signup_welcome_credentials to service_role;
create index if not exists signup_welcome_pending_idx on public.signup_welcome_credentials(ready_at)
  where delivered_at is null and blocked_at is null and encrypted_password is not null;

create schema if not exists inrcy_signup_private;
revoke all on schema inrcy_signup_private from public, anon, authenticated;
grant usage on schema inrcy_signup_private to supabase_auth_admin, service_role;

-- Pure policy is separately executable against synthetic claims in migration tests.
create or replace function inrcy_signup_private.temporary_password_claims(
  event jsonb, credential jsonb, checked_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  claims jsonb := event->'claims';
  expires_at timestamptz;
  recovery_at bigint;
  recovery_session boolean := false;
  method text := event->>'authentication_method';
begin
  if credential is null or credential = 'null'::jsonb then
    return jsonb_build_object('claims', claims);
  end if;
  begin
    expires_at := (credential->>'expires_at')::timestamptz;
  exception when others then
    expires_at := null;
  end;
  if expires_at is null or credential->>'version' is distinct from '1' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message',
      'temporary_password_expired: Votre mot de passe provisoire a expiré. Utilisez « Mot de passe oublié » pour en choisir un nouveau.'));
  end if;

  -- Auth's verifyOtp(recovery) endpoint issues method "otp"; PKCE may issue
  -- "recovery". Both prove possession of a fresh one-time credential and must
  -- permit choosing a replacement password, for at most thirty minutes.
  if method in ('recovery', 'otp', 'magiclink') then
    recovery_session := true;
    recovery_at := floor(extract(epoch from checked_at));
  elsif method = 'token_refresh' then
    select max((item->>'timestamp')::bigint) into recovery_at
      from jsonb_array_elements(coalesce(claims->'amr', '[]'::jsonb)) item
      where item->>'method' in ('recovery', 'otp', 'magiclink') and item->>'timestamp' ~ '^[0-9]{1,12}$';
    recovery_session := recovery_at is not null
      and recovery_at <= extract(epoch from checked_at)
      and recovery_at + 1800 > extract(epoch from checked_at);
  end if;
  if expires_at <= checked_at and not recovery_session then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message',
      'temporary_password_expired: Votre mot de passe provisoire a expiré. Utilisez « Mot de passe oublié » pour en choisir un nouveau.'));
  end if;
  claims := jsonb_set(claims, '{exp}', to_jsonb(least(
    (claims->>'exp')::bigint,
    case when recovery_session then recovery_at + 1800
      else floor(extract(epoch from expires_at))::bigint end
  )));
  return jsonb_build_object('claims', claims);
end;
$$;
revoke all on function inrcy_signup_private.temporary_password_claims(jsonb,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function inrcy_signup_private.temporary_password_claims(jsonb,jsonb,timestamptz) to supabase_auth_admin, service_role;

-- Configure as Custom Access Token hook. Available on the project's Pro plan.
-- Only Auth may invoke it; canonical app metadata is read from auth.users, not
-- from editable user_metadata or potentially stale claims on a refresh request.
create or replace function public.inrcy_temporary_password_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare credential jsonb;
begin
  select users.raw_app_meta_data->'inrcy_temporary_password' into credential
    from auth.users users where users.id = (event->>'user_id')::uuid;
  return inrcy_signup_private.temporary_password_claims(event, credential, now());
end;
$$;
revoke all on function public.inrcy_temporary_password_access_token_hook(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.inrcy_temporary_password_access_token_hook(jsonb) to supabase_auth_admin;

-- Use Auth's verified password-change event, rather than every hash update:
-- transparent hash/encryption upgrades at login must NOT make a temp password
-- permanent. These Auth audit rows are not writable by app users.
create or replace function inrcy_signup_private.password_changed()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare changed_user uuid;
begin
  if new.payload->>'action' is distinct from 'user_updated_password' then return new; end if;
  if coalesce(new.payload->>'actor_id', '') !~ '^[0-9a-fA-F-]{36}$' then return new; end if;
  changed_user := (new.payload->>'actor_id')::uuid;
  update auth.users set raw_app_meta_data = raw_app_meta_data - 'inrcy_temporary_password'
    where id = changed_user and raw_app_meta_data->'inrcy_temporary_password' is not null;
  update public.signup_welcome_credentials set encrypted_password = null
    where user_id = changed_user;
  return new;
end;
$$;
revoke all on function inrcy_signup_private.password_changed() from public, anon, authenticated;
grant execute on function inrcy_signup_private.password_changed() to supabase_auth_admin;
grant select(user_id), update(encrypted_password) on public.signup_welcome_credentials to supabase_auth_admin;
drop policy if exists signup_welcome_auth_cleanup on public.signup_welcome_credentials;
create policy signup_welcome_auth_cleanup on public.signup_welcome_credentials to supabase_auth_admin
  using (true) with check (true);
drop trigger if exists inrcy_temporary_password_changed on auth.audit_log_entries;
create trigger inrcy_temporary_password_changed after insert on auth.audit_log_entries
  for each row when (new.payload->>'action' = 'user_updated_password')
  execute function inrcy_signup_private.password_changed();

create or replace function public.claim_signup_welcome_credentials(p_limit integer default 10)
returns setof public.signup_welcome_credentials language sql security invoker set search_path = '' as $$
  update public.signup_welcome_credentials target set lease_until = now() + interval '2 minutes'
  from (
    select id from public.signup_welcome_credentials
    where ready_at is not null and user_id is not null and encrypted_password is not null
      and delivered_at is null and blocked_at is null and expires_at > now()
      and (lease_until is null or lease_until < now())
    order by ready_at limit greatest(1, least(coalesce(p_limit,10),20))
    for update skip locked
  ) pending where pending.id = target.id returning target.*;
$$;
revoke all on function public.claim_signup_welcome_credentials(integer) from public, anon, authenticated;
grant execute on function public.claim_signup_welcome_credentials(integer) to service_role;

commit;
