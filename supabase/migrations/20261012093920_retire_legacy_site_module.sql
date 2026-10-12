-- Run only after the application release no longer reads the retired table/columns.
-- No CASCADE: unexpected dependencies must stop retirement for explicit review.
begin;
set local lock_timeout = '10s';

do $guard$
begin
  if exists (select 1 from public.site_articles where source in ('inrcy_site', 'site_inrcy'))
    or exists (select 1 from public.publication_deliveries where channel in ('inrcy_site', 'site_inrcy'))
    or exists (select 1 from public.integrations where source in ('inrcy_site', 'site_inrcy'))
    or exists (select 1 from public.widget_domain_registry where source in ('inrcy_site', 'site_inrcy')) then
    raise exception 'Run and verify Site Web transfer before retirement';
  end if;
  if exists (
    select 1 from public.inrcy_site_configs c
    left join public.pro_tools_configs p using (user_id)
    where nullif(trim(c.site_url), '') is not null
      and (p.settings #>> '{site_web,url}') is distinct from c.site_url
  ) then
    raise exception 'Website configuration has not been transferred';
  end if;
end;
$guard$;

create or replace function public.inrcy_seed_new_account_bubble_access()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.app_bubble_access (user_id, bubble_key, enabled) values
    (new.id, 'pinterest', true), (new.id, 'tiktok', true), (new.id, 'inr_agent', true)
  on conflict (user_id, bubble_key) do update set enabled = excluded.enabled;
  return new;
end;
$function$;
revoke all on function public.inrcy_seed_new_account_bubble_access() from public, anon, authenticated;

create or replace function public.create_default_bubble_access()
returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.app_bubble_access (user_id, bubble_key, enabled)
  select new.user_id, b.bubble_key,
    case when b.bubble_key in ('tiktok', 'inr_agent') then false else true end
  from (values ('inrbadge'), ('mails'), ('site_web'), ('gmb'), ('facebook'),
    ('instagram'), ('linkedin'), ('tiktok'), ('inr_agent'), ('inr_calendar'),
    ('inr_crm'), ('inr_send'), ('inr_stats'), ('documents')) b(bubble_key)
  on conflict (user_id, bubble_key) do nothing;
  return new;
end;
$function$;
revoke all on function public.create_default_bubble_access() from public, anon, authenticated;

create or replace function public.bump_stats_version_from_profiles()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.lead_conversion_rate is distinct from old.lead_conversion_rate
    or new.avg_basket is distinct from old.avg_basket
  ) then
    new.stats_version := coalesce(old.stats_version, 0) + 1;
  end if;
  return new;
end;
$function$;
revoke all on function public.bump_stats_version_from_profiles() from public, anon, authenticated;

-- Drop only triggers whose sole purpose was maintaining the removed feature.
do $triggers$
declare dependency record;
begin
  for dependency in
    select n.nspname, c.relname, t.tgname
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and n.nspname = 'public'
      and p.proname in ('sync_widget_domain_registry_from_inrcy_site',
        'create_site_configs_on_profile_insert', 'sync_site_url_to_site_configs',
        'sync_site_url_on_profile_insert', 'lock_inrcy_site_fields')
  loop
    execute format('drop trigger %I on %I.%I', dependency.tgname, dependency.nspname, dependency.relname);
  end loop;
end;
$triggers$;
drop function if exists public.sync_widget_domain_registry_from_inrcy_site();
drop function if exists public.create_site_configs_on_profile_insert();
drop function if exists public.sync_site_url_to_site_configs();
drop function if exists public.sync_site_url_on_profile_insert();
drop function if exists public.lock_inrcy_site_fields();

-- Replace the website registry updater to retain explicit secondary widget domains.
-- Ordinary edits to other tools must not disconnect previously installed widgets.
do $registry_triggers$
declare dependency record;
begin
  for dependency in
    select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.pro_tools_configs'::regclass and not t.tgisinternal
      and p.prosrc like '%widget_domain_registry%'
  loop
    execute format('drop trigger %I on public.pro_tools_configs', dependency.tgname);
  end loop;
end;
$registry_triggers$;

create or replace function public.sync_site_web_widget_domains()
returns trigger language plpgsql security definer set search_path = pg_catalog, public
as $function$
declare site jsonb; domain_value text; raw_domain text; affected_rows integer;
begin
  if tg_op = 'UPDATE' and (new.settings -> 'site_web') is not distinct from (old.settings -> 'site_web') then
    return new;
  end if;
  site := new.settings -> 'site_web';
  delete from public.widget_domain_registry where user_id = new.user_id and source = 'site_web';
  if nullif(trim(site ->> 'url'), '') is null then return new; end if;
  for raw_domain in
    select site ->> 'url'
    union select jsonb_array_elements_text(case when jsonb_typeof(site -> 'widget_domains') = 'array'
      then site -> 'widget_domains' else '[]'::jsonb end)
  loop
    domain_value := public.normalize_widget_domain(raw_domain);
    if domain_value is null then continue; end if;
    if exists (select 1 from public.widget_domain_registry
      where source = 'site_web' and domain = domain_value and user_id <> new.user_id) then
      raise exception 'Website domain is already registered to another account';
    end if;
    insert into public.widget_domain_registry (source, domain, user_id)
    values ('site_web', domain_value, new.user_id)
    on conflict (source, domain) do update set updated_at = now()
      where public.widget_domain_registry.user_id = excluded.user_id;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception 'Website domain ownership changed concurrently';
    end if;
  end loop;
  return new;
end;
$function$;
revoke all on function public.sync_site_web_widget_domains() from public, anon, authenticated;
create trigger sync_site_web_widget_domains
after insert or update of settings on public.pro_tools_configs
for each row execute function public.sync_site_web_widget_domains();

delete from public.app_bubble_access where bubble_key = 'site_inrcy';
alter table public.app_bubble_access add constraint app_bubble_access_no_retired_site
  check (bubble_key <> 'site_inrcy');
alter table public.site_articles drop constraint site_articles_source_check;
alter table public.site_articles add constraint site_articles_source_check check (source = 'site_web');
alter table public.widget_domain_registry drop constraint widget_domain_registry_source_check;
alter table public.widget_domain_registry add constraint widget_domain_registry_source_check check (source = 'site_web');
alter table public.integrations add constraint integrations_no_retired_site
  check (source is null or source not in ('site_inrcy', 'inrcy_site'));
alter table public.publication_deliveries add constraint publication_deliveries_no_retired_site
  check (channel not in ('site_inrcy', 'inrcy_site'));

drop table public.inrcy_site_configs;
alter table public.profiles drop column inrcy_site_ownership, drop column inrcy_site_url;
drop type public.inrcy_site_ownership_type;
comment on column public.business_profiles.ai_web_length is
  'Longueur IA pour Site Web et iNr''Search : adapted, short, medium, long, deep.';

-- Fail closed if a retained database routine still tries to use the retired table/fields.
do $verify$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.prokind = 'f' and p.prosrc ~ 'inrcy_site_configs|inrcy_site_ownership|inrcy_site_url') then
    raise exception 'Unreviewed legacy database routine remains';
  end if;
end;
$verify$;
commit;
