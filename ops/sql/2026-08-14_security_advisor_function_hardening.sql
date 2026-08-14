-- iNrCy -- Supabase Security Advisor function hardening
--
-- Goals:
--   1. pin the search_path of legacy helper functions;
--   2. remove direct API execution from trigger-only / server-only functions;
--   3. stop future postgres-owned functions from being granted automatically
--      to anon and authenticated.
--
-- Intentional authenticated SECURITY DEFINER RPCs are deliberately preserved:
-- invoice numbering, scoped profile/stat refresh, account-access helpers,
-- establishment creation and dashboard onboarding state updates.

begin;

-- Supabase's historical default ACL grants new public functions to both API
-- roles. Make future functions private-by-default; client RPC migrations must
-- grant authenticated explicitly when that access is intentional.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- pg_trgm is relocatable and Supabase exposes the dedicated extensions schema
-- in the database search path. Existing indexes keep their object references
-- when the extension moves schemas.
do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm'
      and e.extrelocatable
      and n.nspname <> 'extensions'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end;
$$;

do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.set_updated_at()',
    'public.enforce_max_4_mail_accounts()',
    'public.set_widget_domain_registry_updated_at()',
    'public.set_stats_snapshot_updated_at()',
    'public.cleanup_old_stats_snapshots()',
    'public.update_updated_at_column()',
    'public.normalize_widget_domain(text)',
    'public.set_notification_preferences_updated_at()',
    'public.is_staff()',
    'public.lock_inrcy_site_fields()',
    'public.set_execution_idempotency_locks_updated_at()',
    'public.set_pro_media_library_updated_at()',
    'public.touch_updated_at()'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is not null then
      execute format(
        'alter function %s set search_path = pg_catalog, public',
        v_function
      );
    end if;
  end loop;
end;
$$;

-- These functions are invoked by database triggers or trusted server code.
-- Trigger execution is unaffected by revoking direct PostgREST EXECUTE.
do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.cleanup_old_stats_snapshots()',
    'public.bump_profile_version(uuid,text)',
    'public.inrcy_bump_inrsend_for_agent_actions()',
    'public.inrcy_bump_inrsend_for_app_events()',
    'public.inrcy_bump_inrsend_for_mail_campaigns()',
    'public.inrcy_bump_inrsend_for_scheduled_actions()',
    'public.inrcy_bump_inrsend_for_send_items()',
    'public.inrcy_bump_inrsend_version(jsonb)',
    'public.inrcy_bump_publications_for_async_job_finalization()',
    'public.inrcy_bump_publications_for_delivery_deletes()',
    'public.inrcy_bump_publications_for_delivery_inserts()',
    'public.inrcy_bump_publications_for_delivery_updates()',
    'public.inrcy_bump_stats_version_from_user_id_v4()',
    'public.inrcy_patch_app_event_payload(uuid,uuid,text,jsonb)',
    'public.inrcy_provision_onboarding_state()',
    'public.inrcy_validate_media_job_scope()',
    'public.inrcy_validate_media_storage_scope()',
    'public.inrcy_validate_media_variant_scope()',
    'public.inrcy_validate_publication_workspace_media()'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_function
      );
      execute format(
        'grant execute on function %s to service_role',
        v_function
      );
    end if;
  end loop;
end;
$$;

-- These guarded RPCs are intentionally callable by signed-in users, but never
-- anonymously. Re-apply their exact allow-list because legacy default ACLs
-- granted anon explicitly to some functions after creation.
do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.allocate_invoice_number(uuid)',
    'public.claim_daily_stats_refresh(uuid,date,integer)',
    'public.complete_daily_stats_refresh(uuid,date)',
    'public.release_daily_stats_refresh_claim(uuid,date)',
    'public.inrcy_can_access_account(uuid)',
    'public.inrcy_can_access_account_text(text)',
    'public.inrcy_can_access_publication_workspace(uuid)',
    'public.inrcy_create_establishment(text)',
    'public.inrcy_save_onboarding_state(uuid,text,text,smallint)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is not null then
      execute format(
        'revoke all on function %s from public, anon',
        v_function
      );
      execute format(
        'grant execute on function %s to authenticated, service_role',
        v_function
      );
    end if;
  end loop;
end;
$$;

commit;
