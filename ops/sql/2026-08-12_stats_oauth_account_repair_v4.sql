-- iNrCy V4 -- one-time repair of Stats caches for every existing account.
-- Run once in the Supabase SQL Editor before or together with the V4 deploy.
-- Safe to run again: an account is repaired only while stats_cache_epoch < 4.
--
-- This migration deliberately does NOT turn an OAuth row green and does not
-- recreate provider tokens. Only Google/Meta/etc. can validate or renew those.
-- It invalidates computed snapshots, keeps all last-good measurements and asks
-- Dashboard/iNrStats to recompute from each account's canonical connections.

begin;

alter table public.profiles
  add column if not exists stats_cache_epoch integer not null default 0;

alter table public.profiles
  add column if not exists stats_version bigint not null default 0;

-- Reinstall the canonical Stats realtime bridge. It covers every OAuth
-- integration and both configuration stores used by iNrBadge/iNrSearch/sites.
create or replace function public.inrcy_bump_stats_version_from_user_id_v4()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id_text text;
begin
  if tg_op = 'DELETE' then
    v_user_id_text := coalesce(to_jsonb(old) ->> 'user_id', '');
  else
    v_user_id_text := coalesce(to_jsonb(new) ->> 'user_id', to_jsonb(old) ->> 'user_id', '');
  end if;

  if v_user_id_text = '' then
    return coalesce(new, old);
  end if;

  update public.profiles
  set stats_version = coalesce(stats_version, 0) + 1
  where user_id = v_user_id_text::uuid;

  return coalesce(new, old);
exception
  when invalid_text_representation then
    return coalesce(new, old);
end;
$$;

revoke all on function public.inrcy_bump_stats_version_from_user_id_v4() from public;

do $$
begin
  if to_regclass('public.integrations') is not null then
    execute 'drop trigger if exists trg_integrations_bump_stats_version on public.integrations';
    execute 'create trigger trg_integrations_bump_stats_version after insert or update or delete on public.integrations for each row execute function public.inrcy_bump_stats_version_from_user_id_v4()';
  end if;

  if to_regclass('public.inrcy_site_configs') is not null then
    execute 'drop trigger if exists trg_inrcy_site_configs_bump_stats_version on public.inrcy_site_configs';
    execute 'create trigger trg_inrcy_site_configs_bump_stats_version after insert or update or delete on public.inrcy_site_configs for each row execute function public.inrcy_bump_stats_version_from_user_id_v4()';
  end if;

  if to_regclass('public.pro_tools_configs') is not null then
    execute 'drop trigger if exists trg_pro_tools_configs_bump_stats_version on public.pro_tools_configs';
    execute 'create trigger trg_pro_tools_configs_bump_stats_version after insert or update or delete on public.pro_tools_configs for each row execute function public.inrcy_bump_stats_version_from_user_id_v4()';
  end if;
end $$;

create temporary table inrcy_v4_stats_repair_users (
  user_id uuid primary key
) on commit drop;

insert into inrcy_v4_stats_repair_users (user_id)
select user_id
from public.profiles
where coalesce(stats_cache_epoch, 0) < 4;

-- Expire only replaceable computed caches. Rows are retained so existing
-- recovery code can still inspect history if a provider is temporarily down.
-- Never touch overview_last_good, LinkedIn last-good caches or quota guards.
update public.stats_cache as cache_row
set expires_at = least(coalesce(cache_row.expires_at, now()), now())
where cache_row.source in (
  'overview',
  'metrics_summary',
  'linkedin_metrics'
)
and exists (
  select 1
  from inrcy_v4_stats_repair_users repair_user
  where repair_user.user_id = cache_row.user_id
);

-- Release today's daily lock/completion only for accounts repaired by V4.
-- Their next authenticated load performs one normal refresh, without asking
-- the professional to disconnect or reconnect any channel.
update public.user_daily_stats_refresh as refresh_row
set
  last_started_snapshot_date = null,
  last_started_at = null,
  last_completed_snapshot_date = null,
  updated_at = now()
where exists (
  select 1
  from inrcy_v4_stats_repair_users repair_user
  where repair_user.user_id = refresh_row.user_id
);

-- One durable epoch per account makes the migration idempotent. The version
-- bump wakes the existing profile realtime bridge used by Dashboard/iNrStats.
update public.profiles as profile_row
set
  stats_cache_epoch = 4,
  stats_version = coalesce(profile_row.stats_version, 0) + 1
where exists (
  select 1
  from inrcy_v4_stats_repair_users repair_user
  where repair_user.user_id = profile_row.user_id
);

-- Accounts created after the migration start directly on the V4 cache epoch.
alter table public.profiles
  alter column stats_cache_epoch set default 4;

alter table public.profiles replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

commit;
