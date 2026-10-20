-- Read-only preflight for invite/recovery links. No OTP is consumed, created,
-- prolonged or copied. Mailer OTP expiration is 86400 seconds on this project
-- (verified 2026-10-20); a shorter expiry stored by Auth always wins.
-- Auth's final verifyOtp remains authoritative, including concurrent use.
begin;

create schema if not exists inrcy_auth_private;
revoke all on schema inrcy_auth_private from public, anon, authenticated;
grant usage on schema inrcy_auth_private to service_role;

create or replace function inrcy_auth_private.password_link_status(
  p_token_hash text,
  p_mode text,
  p_email text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '3s'
as $$
declare
  v_expires_at timestamptz;
begin
  if p_mode is null or p_mode not in ('invite', 'reset')
     or p_token_hash is null or length(p_token_hash) not between 32 and 256
     or p_token_hash !~ '^[a-zA-Z0-9_-]+$'
     or (p_email is not null and length(p_email) > 320) then
    return jsonb_build_object('valid', false);
  end if;

  -- one_time_tokens is Auth's source of truth. Once used or replaced, the
  -- matching row disappears; reading legacy users.*_token could revive it.
  select least(
    case when p_mode = 'invite' then u.confirmation_sent_at else u.recovery_sent_at end + interval '24 hours',
    coalesce(t.expires_at, 'infinity'::timestamptz)
  ) into v_expires_at
  from auth.one_time_tokens t
  join auth.users u on u.id = t.user_id
  where t.token_hash = p_token_hash
    and t.token_type::text = case when p_mode = 'invite' then 'confirmation_token' else 'recovery_token' end
    and (nullif(lower(btrim(p_email)), '') is null or lower(u.email) = lower(btrim(p_email)))
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now())
    and case when p_mode = 'invite' then u.confirmation_sent_at else u.recovery_sent_at end is not null
  limit 1;

  if v_expires_at is null or v_expires_at <= now() then
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object('valid', true, 'expires_at', v_expires_at);
end;
$$;

revoke all on function inrcy_auth_private.password_link_status(text,text,text) from public, anon, authenticated;
grant execute on function inrcy_auth_private.password_link_status(text,text,text) to service_role;

-- Only this narrow service-only invoker is exposed to PostgREST. The definer
-- stays in an unexposed schema; no browser role gains access to Auth tables.
create or replace function public.inrcy_password_link_status(
  p_token_hash text,
  p_mode text,
  p_email text default null
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select inrcy_auth_private.password_link_status(p_token_hash, p_mode, p_email);
$$;

revoke all on function public.inrcy_password_link_status(text,text,text) from public, anon, authenticated;
grant execute on function public.inrcy_password_link_status(text,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
