-- Transfer first, deploy the single Site Web implementation, then run retirement.
-- Historical publications stay separate: never merge/delete article or delivery IDs.
begin;
set local lock_timeout = '10s';

lock table public.inrcy_site_configs, public.pro_tools_configs,
  public.integrations, public.site_articles, public.publication_deliveries,
  public.widget_domain_registry, public.app_bubble_access, public.publications,
  public.app_events in share row exclusive mode;

create temporary table site_web_transfer on commit drop as
select c.user_id, c.site_url, coalesce(c.settings, '{}'::jsonb) as legacy_settings,
  coalesce(p.settings, '{}'::jsonb) as pro_settings,
  public.normalize_widget_domain(c.site_url) as domain
from public.inrcy_site_configs c
left join public.pro_tools_configs p using (user_id)
where nullif(trim(c.site_url), '') is not null;

do $guard$
begin
  if exists (select 1 from site_web_transfer where
    (user_id, site_url) not in (
      ('01b40fba-7de2-4a67-8163-f83ddc23b8d2'::uuid, 'https://couvreur-hazebrouck.fr'),
      ('e8175459-d486-459f-8335-c1ad129c12b0'::uuid, 'https://lille-macon.fr')
    )) or (select count(*) from site_web_transfer) <> 2 then
    raise exception 'Site Web transfer inventory changed: review before migration';
  end if;
  if exists (select 1 from site_web_transfer where domain is null) then
    raise exception 'Invalid site domain';
  end if;
  if exists (select 1 from site_web_transfer where jsonb_typeof(legacy_settings) <> 'object'
      or jsonb_typeof(pro_settings) <> 'object') then
    raise exception 'Website settings must be JSON objects';
  end if;
  if exists (select 1 from public.inrcy_site_configs c
    where c.user_id not in (select user_id from site_web_transfer)
      and coalesce(nullif(c.settings #>> '{ga4,property_id}', ''),
        nullif(c.settings #>> '{ga4,measurement_id}', ''), nullif(c.settings #>> '{gsc,property}', '')) is not null)
    or exists (select 1 from public.profiles p
      where nullif(trim(p.inrcy_site_url), '') is not null
        and p.user_id not in (select user_id from site_web_transfer)) then
    raise exception 'Disconnected legacy website data needs an explicit transfer';
  end if;
  if exists (select 1 from public.integrations where source in ('site_inrcy', 'inrcy_site')
      and (user_id not in (select user_id from site_web_transfer)
        or (provider = 'system' and (access_token_enc is not null or refresh_token_enc is not null)))) then
    raise exception 'Unexpected legacy integration: review before migration';
  end if;
  if exists (select 1 from site_web_transfer where
    nullif(pro_settings #>> '{site_web,url}', '') is not null
    and public.normalize_widget_domain(pro_settings #>> '{site_web,url}') <> domain
    and not (user_id = '01b40fba-7de2-4a67-8163-f83ddc23b8d2'::uuid
      and public.normalize_widget_domain(pro_settings #>> '{site_web,url}') = 'fv-couverture.fr')) then
    raise exception 'Unapproved primary website replacement';
  end if;
  if exists (
    select 1 from public.integrations old_row
    join public.integrations new_row on new_row.user_id = old_row.user_id
      and new_row.provider = old_row.provider and new_row.product = old_row.product
      and new_row.source = 'site_web'
    where old_row.source in ('site_inrcy', 'inrcy_site') and old_row.provider <> 'system'
  ) then
    raise exception 'Conflicting Google integration: reconcile without losing credentials';
  end if;
end;
$guard$;

create temporary table site_web_preservation_counts on commit drop as
select (select count(*) from public.site_articles) as articles,
  (select count(*) from public.publication_deliveries) as deliveries,
  (select count(*) from public.publications) as publications;

-- Preserve registered secondary domains, including FV's previous primary site.
create temporary table site_web_domains on commit drop as
select distinct user_id, domain from (
  select user_id, public.normalize_widget_domain(domain) as domain
    from public.widget_domain_registry where source in ('inrcy_site', 'site_inrcy', 'site_web')
      and user_id in (select user_id from site_web_transfer)
  union all select user_id, domain from site_web_transfer
  union all select user_id, public.normalize_widget_domain(pro_settings #>> '{site_web,url}')
    from site_web_transfer
) domains where domain is not null;

do $domains$
begin
  if exists (select domain from site_web_domains group by domain having count(distinct user_id) > 1)
    or exists (select 1 from site_web_domains d join public.widget_domain_registry r
      on public.normalize_widget_domain(r.domain) = d.domain and r.user_id <> d.user_id
      where r.source in ('inrcy_site', 'site_inrcy', 'site_web')) then
    raise exception 'Widget domain belongs to two accounts';
  end if;
end;
$domains$;

insert into public.pro_tools_configs (user_id, settings, updated_at)
select t.user_id,
  jsonb_set(t.pro_settings, '{site_web}',
    (case when jsonb_typeof(t.pro_settings -> 'site_web') = 'object'
      then t.pro_settings -> 'site_web' else '{}'::jsonb end) || t.legacy_settings ||
    jsonb_build_object('url', t.site_url, 'domain', t.domain,
      'widget_domains', coalesce((select jsonb_agg(d.domain order by d.domain)
        from site_web_domains d where d.user_id = t.user_id and d.domain <> t.domain), '[]'::jsonb)), true),
  now()
from site_web_transfer t
on conflict (user_id) do update set settings = excluded.settings, updated_at = excluded.updated_at;

-- Existing web presence row survives; only redundant, credential-free system rows retire.
insert into public.integrations (user_id, provider, source, product, status,
  resource_id, resource_label, display_name, meta, updated_at)
select user_id, 'system', 'site_web', 'site', 'connected', site_url, site_url, 'Site web',
  jsonb_build_object('score', 1 +
      (coalesce(nullif(legacy_settings #>> '{ga4,property_id}', ''), nullif(legacy_settings #>> '{ga4,measurement_id}', '')) is not null)::integer +
      (nullif(legacy_settings #>> '{gsc,property}', '') is not null)::integer, 'has_url', true,
    'ga4', coalesce(nullif(legacy_settings #>> '{ga4,property_id}', ''), nullif(legacy_settings #>> '{ga4,measurement_id}', '')) is not null,
    'gsc', nullif(legacy_settings #>> '{gsc,property}', '') is not null), now()
from site_web_transfer
on conflict (user_id, provider, source, product) do update set
  status = excluded.status, resource_id = excluded.resource_id,
  resource_label = excluded.resource_label, display_name = excluded.display_name,
  meta = excluded.meta, updated_at = excluded.updated_at;

delete from public.integrations where provider = 'system' and source in ('site_inrcy', 'inrcy_site');
update public.integrations set source = 'site_web', updated_at = now(),
  meta = case when meta ->> 'source' in ('site_inrcy', 'inrcy_site')
    then jsonb_set(meta, '{source}', '"site_web"'::jsonb) else meta end,
  settings = case when settings ->> 'source' in ('site_inrcy', 'inrcy_site')
    then jsonb_set(settings, '{source}', '"site_web"'::jsonb) else settings end
where source in ('site_inrcy', 'inrcy_site');

-- Two historical website articles may belong to the same parent publication.
-- Keep both records, with a verified parent link for grouped editing/deletion and feeds.
create temporary table site_web_article_links on commit drop as
select distinct a.id as article_id, a.user_id, p.id as publication_id
from public.site_articles a
join public.app_events e on e.user_id = a.user_id and e.module = 'booster' and e.type = 'publish'
join public.publications p on p.user_id = a.user_id and p.id::text = e.payload ->> 'publication_id'
cross join lateral jsonb_each(case when jsonb_typeof(e.payload -> 'results') = 'object'
  then e.payload -> 'results' else '{}'::jsonb end) result
cross join lateral (
  select result.value ->> 'external_id' as external_id
  union all select jsonb_array_elements_text(case when jsonb_typeof(result.value -> 'external_ids') = 'array'
    then result.value -> 'external_ids' else '[]'::jsonb end)
) identifier
where a.source in ('site_web', 'inrcy_site', 'site_inrcy')
  and result.key in ('site_web', 'inrcy_site', 'site_inrcy', 'siteInrcy')
  and identifier.external_id = a.id::text;

do $links$
begin
  if exists (select article_id from site_web_article_links group by article_id
      having count(distinct publication_id) > 1)
    or exists (select 1 from public.site_articles a join site_web_transfer t on t.user_id = a.user_id
      where a.source in ('site_web', 'inrcy_site', 'site_inrcy')
        and not exists (select 1 from site_web_article_links l where l.article_id = a.id))
    or exists (select 1 from public.site_articles a join site_web_article_links l on l.article_id = a.id
      where (a.media_metadata is not null and jsonb_typeof(a.media_metadata) <> 'object')
        or (a.media_metadata ->> 'publication_id' is not null
          and (a.media_metadata ->> 'publication_id') <> l.publication_id::text)) then
    raise exception 'Historical article parent association needs explicit reconciliation';
  end if;
end;
$links$;
update public.site_articles a set media_metadata = coalesce(a.media_metadata, '{}'::jsonb)
  || jsonb_build_object('publication_id', l.publication_id::text)
from site_web_article_links l where l.article_id = a.id and l.user_id = a.user_id;

update public.site_articles set source = 'site_web' where source in ('inrcy_site', 'site_inrcy');
update public.publication_deliveries set channel = 'site_web' where channel in ('inrcy_site', 'site_inrcy');

insert into public.app_bubble_access (user_id, bubble_key, enabled)
select user_id, 'site_web', true from site_web_transfer
on conflict (user_id, bubble_key) do update set enabled = true, updated_at = now();
delete from public.app_bubble_access where bubble_key = 'site_inrcy';

-- Fold saved channel preferences using the same defaults as the application.
-- Other tools' settings and all publication/event payloads remain byte-for-byte intact.
update public.pro_tools_configs set settings = jsonb_set(settings, '{inrBadgeShareSettings}',
  ((settings -> 'inrBadgeShareSettings') - 'siteInrcy') || jsonb_build_object('siteWeb',
    case when settings #> '{inrBadgeShareSettings,siteInrcy}' = 'true'::jsonb then true
      when jsonb_typeof(settings #> '{inrBadgeShareSettings,siteWeb}') = 'boolean'
        then (settings #>> '{inrBadgeShareSettings,siteWeb}')::boolean
      else true end), true), updated_at = now()
where jsonb_typeof(settings -> 'inrBadgeShareSettings') = 'object'
  and (settings -> 'inrBadgeShareSettings') ? 'siteInrcy';

update public.business_profiles set ai_channel_ctas =
  (ai_channel_ctas - 'inrcy_site' - 'site_inrcy' - 'siteInrcy') ||
  case when coalesce(ai_channel_ctas -> 'site_web', 'null'::jsonb)
      in ('null'::jsonb, '""'::jsonb, '{}'::jsonb, '[]'::jsonb)
    then jsonb_build_object('site_web', coalesce(
      nullif(ai_channel_ctas -> 'inrcy_site', 'null'::jsonb),
      nullif(ai_channel_ctas -> 'site_inrcy', 'null'::jsonb),
      nullif(ai_channel_ctas -> 'siteInrcy', 'null'::jsonb)))
    else '{}'::jsonb end,
  updated_at = now()
where jsonb_typeof(ai_channel_ctas) = 'object'
  and ai_channel_ctas ?| array['inrcy_site', 'site_inrcy', 'siteInrcy'];

-- Cached aggregates are reproducible. Durable publication/event history is untouched.
delete from public.stats_cache where source in ('site_inrcy', 'inrcy_site', 'site_inrcy_ga4', 'site_inrcy_gsc')
  or payload::text ~ '"(site_inrcy|inrcy_site|site_inrcy_ga4|site_inrcy_gsc)"';
update public.profiles set stats_version = coalesce(stats_version, 0) + 1,
  publications_version = coalesce(publications_version, 0) + 1,
  stats_cache_epoch = coalesce(stats_cache_epoch, 0) + 1
where user_id in (select user_id from site_web_transfer);

-- Profile/integration triggers can rewrite the legacy config even during cache updates.
-- Restore the verified domain union LAST, after all writes that may invoke them.
delete from public.widget_domain_registry where source in ('inrcy_site', 'site_inrcy');
insert into public.widget_domain_registry (source, domain, user_id)
select 'site_web', domain, user_id from site_web_domains
on conflict (source, domain) do update set updated_at = now()
where public.widget_domain_registry.user_id = excluded.user_id;

do $verify$
begin
  if exists (select 1 from public.integrations where source in ('site_inrcy', 'inrcy_site'))
    or exists (select 1 from public.site_articles where source in ('site_inrcy', 'inrcy_site'))
    or exists (select 1 from public.publication_deliveries where channel in ('site_inrcy', 'inrcy_site'))
    or exists (select 1 from public.widget_domain_registry where source in ('site_inrcy', 'inrcy_site')) then
    raise exception 'Legacy website source was recreated by a database trigger';
  end if;
  if (select articles from site_web_preservation_counts) <> (select count(*) from public.site_articles)
    or (select deliveries from site_web_preservation_counts) <> (select count(*) from public.publication_deliveries)
    or (select publications from site_web_preservation_counts) <> (select count(*) from public.publications) then
    raise exception 'Publication preservation invariant failed';
  end if;
  if exists (select 1 from site_web_domains d left join public.widget_domain_registry r
      on r.source = 'site_web' and r.domain = d.domain and r.user_id = d.user_id
      where r.user_id is null) then
    raise exception 'Widget domain preservation invariant failed';
  end if;
end;
$verify$;
commit;
