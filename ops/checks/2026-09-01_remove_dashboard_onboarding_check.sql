-- Lecture seule : doit retourner uniquement des valeurs conformes après la
-- migration 2026-09-01_remove_dashboard_onboarding.sql.

select 'onboarding_table_absent' as check_name,
       (to_regclass('public.inrcy_onboarding_states') is null)::text as result
union all
select 'onboarding_account_trigger_absent',
       (not exists (
         select 1
         from pg_catalog.pg_trigger t
         join pg_catalog.pg_class c on c.oid = t.tgrelid
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = 'inrcy_accounts'
           and t.tgname = 'inrcy_provision_onboarding_state_after_insert'
           and not t.tgisinternal
       ))::text
union all
select 'account_core_present',
       (to_regprocedure('private.inrcy_ensure_account_core(uuid,uuid,text,boolean)') is not null)::text
union all
select 'auth_provisioning_rpc_present',
       (to_regprocedure('public.inrcy_ensure_auth_account_provisioned(uuid,text)') is not null)::text
union all
select 'auth_provisioning_trigger_active',
       (exists (
         select 1
         from pg_catalog.pg_trigger t
         join pg_catalog.pg_class c on c.oid = t.tgrelid
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'auth'
           and c.relname = 'users'
           and t.tgname = 'inrcy_provision_auth_account_after_insert'
           and t.tgfoid = 'public.inrcy_provision_auth_account()'::regprocedure
           and t.tgtype = 5
           and not t.tgisinternal
           and t.tgenabled in ('O', 'A')
       ))::text
order by check_name;
