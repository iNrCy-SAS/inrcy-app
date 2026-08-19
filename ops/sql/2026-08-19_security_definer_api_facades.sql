-- iNrCy -- Supabase Security Advisor: authenticated SECURITY DEFINER RPCs
--
-- This migration does not weaken or remove any business authorization rule.
-- It separates the nine advisor findings into two explicit designs:
--   * six functions do not need elevated privileges and become INVOKER;
--   * three functions genuinely need elevated writes. Their implementation is
--     moved to the non-exposed `private` schema and a public INVOKER facade
--     keeps the existing PostgREST RPC contract stable.

begin;

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- New private functions must never become executable through PostgreSQL's
-- broad PUBLIC default privilege. Each private implementation is granted
-- explicitly below.
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

-- These functions already operate through RLS-visible tables and preserve the
-- caller's auth.uid(). Running them as the caller is both sufficient and safer.
alter function public.claim_daily_stats_refresh(uuid, date, integer)
  security invoker;
alter function public.complete_daily_stats_refresh(uuid, date)
  security invoker;
alter function public.release_daily_stats_refresh_claim(uuid, date)
  security invoker;
alter function public.inrcy_can_access_account(uuid)
  security invoker;
alter function public.inrcy_can_access_account_text(text)
  security invoker;
alter function public.inrcy_can_access_publication_workspace(uuid)
  security invoker;

-- The remaining implementations need controlled writes that authenticated
-- users cannot perform directly. Move only those implementations outside the
-- schemas exposed by PostgREST. The block is idempotent and refuses an
-- ambiguous collision instead of silently replacing an unknown function.
do $$
declare
  v_public_signature text;
  v_private_signature text;
  v_public_function regprocedure;
  v_private_function regprocedure;
  v_is_definer boolean;
begin
  foreach v_public_signature in array array[
    'public.allocate_invoice_number(uuid)',
    'public.inrcy_create_establishment(text)',
    'public.inrcy_save_onboarding_state(uuid,text,text,smallint)'
  ]
  loop
    v_private_signature := replace(v_public_signature, 'public.', 'private.');
    v_public_function := to_regprocedure(v_public_signature);
    v_private_function := to_regprocedure(v_private_signature);

    if v_private_function is null then
      if v_public_function is null then
        raise exception 'Required function % is missing.', v_public_signature;
      end if;

      select p.prosecdef
        into v_is_definer
      from pg_catalog.pg_proc p
      where p.oid = v_public_function;

      if not coalesce(v_is_definer, false) then
        raise exception 'Function % is not the expected SECURITY DEFINER implementation.', v_public_signature;
      end if;

      execute format('alter function %s set schema private', v_public_function);
    else
      select p.prosecdef
        into v_is_definer
      from pg_catalog.pg_proc p
      where p.oid = v_private_function;

      if not coalesce(v_is_definer, false) then
        raise exception 'Private function % must remain SECURITY DEFINER.', v_private_signature;
      end if;

      if v_public_function is not null then
        select p.prosecdef
          into v_is_definer
        from pg_catalog.pg_proc p
        where p.oid = v_public_function;

        if coalesce(v_is_definer, false) then
          raise exception 'Ambiguous public SECURITY DEFINER function % still exists.', v_public_signature;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.allocate_invoice_number(uuid)
  from public, anon;
revoke all on function private.inrcy_create_establishment(text)
  from public, anon;
revoke all on function private.inrcy_save_onboarding_state(uuid, text, text, smallint)
  from public, anon;

grant execute on function private.allocate_invoice_number(uuid)
  to authenticated, service_role;
grant execute on function private.inrcy_create_establishment(text)
  to authenticated, service_role;
grant execute on function private.inrcy_save_onboarding_state(uuid, text, text, smallint)
  to authenticated, service_role;

-- Stable public RPC contracts. These functions run as the signed-in caller and
-- can invoke only the explicitly granted private implementation.
create or replace function public.allocate_invoice_number(
  p_doc_save_id uuid
)
returns table(number text, year integer, seq integer)
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select *
  from private.allocate_invoice_number(p_doc_save_id);
$$;

create or replace function public.inrcy_create_establishment(
  p_display_name text
)
returns uuid
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.inrcy_create_establishment(p_display_name);
$$;

create or replace function public.inrcy_save_onboarding_state(
  p_account_id uuid,
  p_status text,
  p_current_step text,
  p_version smallint default 1
)
returns public.inrcy_onboarding_states
language sql
volatile
security invoker
set search_path = pg_catalog
as $$
  select private.inrcy_save_onboarding_state(
    p_account_id,
    p_status,
    p_current_step,
    p_version
  );
$$;

revoke all on function public.allocate_invoice_number(uuid)
  from public, anon;
revoke all on function public.inrcy_create_establishment(text)
  from public, anon;
revoke all on function public.inrcy_save_onboarding_state(uuid, text, text, smallint)
  from public, anon;

grant execute on function public.allocate_invoice_number(uuid)
  to authenticated, service_role;
grant execute on function public.inrcy_create_establishment(text)
  to authenticated, service_role;
grant execute on function public.inrcy_save_onboarding_state(uuid, text, text, smallint)
  to authenticated, service_role;

commit;
