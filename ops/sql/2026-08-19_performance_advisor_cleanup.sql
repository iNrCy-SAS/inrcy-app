-- iNrCy -- Supabase Performance Advisor cleanup
--
-- Resolves the current WARN findings only:
--   * auth.uid() init-plan policies;
--   * two permissive SELECT policies on boutique_orders;
--   * exact duplicate indexes and redundant UNIQUE(user_id) constraints.
--
-- Every destructive index/constraint cleanup verifies that an equivalent
-- primary key or index remains. Any schema drift aborts the transaction.

begin;

-- Cache auth.uid() once per statement instead of evaluating it for every row.
drop policy if exists inrcy_account_members_select_self
  on public.inrcy_account_members;
create policy inrcy_account_members_select_self
on public.inrcy_account_members
for select
to authenticated
using (auth_user_id = (select auth.uid()));

drop policy if exists inrcy_multi_account_config_select_self
  on public.inrcy_multi_account_config;
create policy inrcy_multi_account_config_select_self
on public.inrcy_multi_account_config
for select
to authenticated
using (auth_user_id = (select auth.uid()));

drop policy if exists mobile_shortcuts_select_own_membership
  on public.inrcy_mobile_shortcut_preferences;
create policy mobile_shortcuts_select_own_membership
on public.inrcy_mobile_shortcut_preferences
for select
to authenticated
using (
  auth_user_id = (select auth.uid())
  and exists (
    select 1
    from public.inrcy_account_members m
    where m.auth_user_id = (select auth.uid())
      and m.account_id = inrcy_mobile_shortcut_preferences.account_id
  )
);

drop policy if exists mobile_shortcuts_insert_own_membership
  on public.inrcy_mobile_shortcut_preferences;
create policy mobile_shortcuts_insert_own_membership
on public.inrcy_mobile_shortcut_preferences
for insert
to authenticated
with check (
  auth_user_id = (select auth.uid())
  and exists (
    select 1
    from public.inrcy_account_members m
    where m.auth_user_id = (select auth.uid())
      and m.account_id = inrcy_mobile_shortcut_preferences.account_id
  )
);

drop policy if exists subscriptions_select_own
  on public.subscriptions;
create policy subscriptions_select_own
on public.subscriptions
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists mailbox_reputation_state_select_own
  on public.mailbox_reputation_state;
create policy mailbox_reputation_state_select_own
on public.mailbox_reputation_state
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists publication_workspaces_insert_accessible
  on public.publication_workspaces;
create policy publication_workspaces_insert_accessible
on public.publication_workspaces
for insert
to authenticated
with check (
  public.inrcy_can_access_account(account_id)
  and (
    created_by_auth_user_id is null
    or created_by_auth_user_id = (select auth.uid())
  )
);

-- Both former policies were permissive and therefore OR'ed by PostgreSQL.
-- Keep exactly the same authorization expression in one policy.
drop policy if exists staff_select_all_orders on public.boutique_orders;
drop policy if exists users_select_own_orders on public.boutique_orders;
drop policy if exists boutique_orders_select_authorized on public.boutique_orders;
create policy boutique_orders_select_authorized
on public.boutique_orders
for select
to authenticated
using (
  public.is_staff()
  or public.inrcy_can_access_account(user_id)
);

-- A primary key already enforces the same UNIQUE(user_id). Verify the table
-- and key columns before dropping the redundant UNIQUE constraint.
do $$
declare
  v_pair text[];
  v_table regclass;
  v_primary pg_catalog.pg_constraint%rowtype;
  v_redundant pg_catalog.pg_constraint%rowtype;
begin
  foreach v_pair slice 1 in array array[
    array['public.business_profiles', 'business_profiles_pkey', 'business_profiles_user_id_unique'],
    array['public.inrcy_site_configs', 'inrcy_site_configs_pkey', 'inrcy_site_configs_user_id_unique'],
    array['public.pro_tools_configs', 'pro_tools_configs_pkey', 'pro_tools_configs_user_id_unique'],
    array['public.profiles', 'profiles_pkey', 'profiles_user_id_unique'],
    array['public.subscriptions', 'subscriptions_pkey', 'subscriptions_user_id_unique']
  ]
  loop
    v_table := to_regclass(v_pair[1]);
    if v_table is null then
      raise exception 'Required table % is missing.', v_pair[1];
    end if;

    select * into v_primary
    from pg_catalog.pg_constraint
    where conrelid = v_table and conname = v_pair[2];

    select * into v_redundant
    from pg_catalog.pg_constraint
    where conrelid = v_table and conname = v_pair[3];

    if not found then
      continue;
    end if;

    if v_primary.oid is null
       or v_primary.contype <> 'p'
       or v_redundant.contype <> 'u'
       or v_primary.conkey is distinct from v_redundant.conkey then
      raise exception 'Constraint pair % / % is no longer equivalent on %.',
        v_pair[2], v_pair[3], v_pair[1];
    end if;

    execute format(
      'alter table %s drop constraint %I',
      v_table,
      v_pair[3]
    );
  end loop;
end;
$$;

-- Drop one member of each exact duplicate pair only after comparing all index
-- semantics (table, uniqueness, keys, operator classes, options, expressions
-- and partial predicate). The retained index name is listed second.
do $$
declare
  v_pair text[];
  v_drop regclass;
  v_keep regclass;
  v_equivalent boolean;
begin
  foreach v_pair slice 1 in array array[
    array['public.idx_crm_contacts_user_created_at', 'public.crm_contacts_user_created_at_idx'],
    array['public.idx_crm_contacts_user_id', 'public.crm_contacts_user_id_idx'],
    array['public.idx_crm_contacts_user_phone', 'public.crm_contacts_user_phone_idx'],
    array['public.idx_daily_metrics_summary_user_snapshot_date', 'public.daily_metrics_summary_user_date_idx'],
    array['public.idx_integrations_user_id', 'public.integrations_user_idx'],
    array['public.loyalty_ledger_unique_source', 'public.loyalty_ledger_user_action_source_uniq'],
    array['public.idx_notifications_user_created_at', 'public.notifications_user_created_idx'],
    array['public.idx_publication_deliveries_pub', 'public.publication_deliveries_publication_id_idx'],
    array['public.idx_publications_user_id', 'public.publications_user_id_idx'],
    array['public.idx_site_articles_user_id', 'public.site_articles_user_id_idx'],
    array['public.stats_cache_lookup', 'public.stats_cache_lookup_idx'],
    array['public.stats_cache_user_source_range_unique', 'public.stats_cache_user_source_range_key_unique']
  ]
  loop
    v_drop := to_regclass(v_pair[1]);
    if v_drop is null then
      continue;
    end if;

    v_keep := to_regclass(v_pair[2]);
    if v_keep is null then
      raise exception 'Cannot drop % because retained index % is missing.',
        v_pair[1], v_pair[2];
    end if;

    select
      d.indrelid = k.indrelid
      and d.indisunique = k.indisunique
      and d.indisexclusion = k.indisexclusion
      and d.indnkeyatts = k.indnkeyatts
      and d.indnatts = k.indnatts
      and d.indkey::text = k.indkey::text
      and d.indcollation::text = k.indcollation::text
      and d.indclass::text = k.indclass::text
      and d.indoption::text = k.indoption::text
      and coalesce(pg_catalog.pg_get_expr(d.indexprs, d.indrelid), '')
          = coalesce(pg_catalog.pg_get_expr(k.indexprs, k.indrelid), '')
      and coalesce(pg_catalog.pg_get_expr(d.indpred, d.indrelid), '')
          = coalesce(pg_catalog.pg_get_expr(k.indpred, k.indrelid), '')
    into v_equivalent
    from pg_catalog.pg_index d
    join pg_catalog.pg_index k on k.indexrelid = v_keep
    where d.indexrelid = v_drop;

    if not coalesce(v_equivalent, false) then
      raise exception 'Indexes % and % are no longer exact duplicates.',
        v_pair[1], v_pair[2];
    end if;

    execute format('drop index %s', v_drop);
  end loop;
end;
$$;

commit;
