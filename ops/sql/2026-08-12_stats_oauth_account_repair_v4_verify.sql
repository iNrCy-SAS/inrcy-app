-- iNrCy V4 -- read-only verification after the repair migration.
-- Expected: every check is true and MIGRATION_APPLIED = true.

with checks as (
  select
    'profiles.stats_cache_epoch exists'::text as check_name,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'stats_cache_epoch'
        and data_type = 'integer'
    ) as ok
  union all
  select
    'profiles.stats_cache_epoch defaults to 4',
    coalesce((
      select column_default in ('4', '4::integer')
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'stats_cache_epoch'
    ), false)
  union all
  select
    'all existing accounts are on V4',
    not exists (
      select 1
      from public.profiles
      where coalesce(stats_cache_epoch, 0) < 4
    )
  union all
  select
    'profiles.stats_version exists',
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'stats_version'
        and data_type = 'bigint'
    )
  union all
  select
    'profiles realtime is enabled',
    exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'profiles'
    )
  union all
  select
    'all Stats source triggers are installed',
    not exists (
      select 1
      from (values
        ('integrations', 'trg_integrations_bump_stats_version'),
        ('inrcy_site_configs', 'trg_inrcy_site_configs_bump_stats_version'),
        ('pro_tools_configs', 'trg_pro_tools_configs_bump_stats_version')
      ) as expected(table_name, trigger_name)
      where to_regclass('public.' || expected.table_name) is not null
        and not exists (
          select 1
          from pg_trigger trigger_row
          join pg_class table_row on table_row.oid = trigger_row.tgrelid
          join pg_namespace schema_row on schema_row.oid = table_row.relnamespace
          where schema_row.nspname = 'public'
            and table_row.relname = expected.table_name
            and trigger_row.tgname = expected.trigger_name
            and not trigger_row.tgisinternal
        )
    )
), cache_inventory as (
  select
    count(*) filter (
      where source in (
        'overview_last_good',
        'linkedin_metrics_last_good',
        'linkedin_opportunity_last_good',
        'linkedin_quota_guard'
      )
    ) as protected_rows,
    count(*) filter (
      where source in ('overview', 'metrics_summary', 'linkedin_metrics')
        and expires_at > now()
    ) as currently_active_computed_rows
  from public.stats_cache
)
select check_name, ok, null::bigint as value
from checks
union all
select 'protected cache rows retained', true, protected_rows
from cache_inventory
union all
select 'computed rows already regenerated after V4', true, currently_active_computed_rows
from cache_inventory
union all
select 'MIGRATION_APPLIED', bool_and(ok), null::bigint
from checks
order by check_name;
