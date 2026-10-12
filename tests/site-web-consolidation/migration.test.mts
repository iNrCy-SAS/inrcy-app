import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const FV = "01b40fba-7de2-4a67-8163-f83ddc23b8d2";
const AGIRA = "e8175459-d486-459f-8335-c1ad129c12b0";
const OTHER = "00000000-0000-4000-8000-000000000003";
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const transfer = read("supabase/migrations/20261012093412_consolidate_site_web.sql");
const retirement = read("supabase/migrations/20261012093920_retire_legacy_site_module.sql");
const id = (kind: number, index: number) => `00000000-0000-4000-8${kind.toString().padStart(3, "0")}-${index.toString().padStart(12, "0")}`;

async function rows(db: PGlite, query: string, params: unknown[] = []) {
  return (await db.query<Record<string, unknown>>(query, params)).rows;
}

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create type public.inrcy_site_ownership_type as enum ('none','owned','rented');
    create table public.inrcy_accounts(id uuid primary key, edition text default 'standard');
    create table public.profiles(
      user_id uuid primary key references public.inrcy_accounts(id),
      inrcy_site_ownership public.inrcy_site_ownership_type default 'none', inrcy_site_url text,
      stats_version integer default 0, publications_version integer default 0, stats_cache_epoch integer default 0,
      lead_conversion_rate numeric default 2, avg_basket numeric default 100, company_legal_name text);
    create table public.business_profiles(user_id uuid primary key, ai_web_length text default 'adapted', ai_channel_ctas jsonb default '{}', updated_at timestamptz default '2026-01-01');
    create table public.inrcy_site_configs(user_id uuid primary key, site_url text, settings jsonb default '{}');
    create table public.pro_tools_configs(user_id uuid primary key, settings jsonb default '{}', updated_at timestamptz default '2026-01-01');
    create table public.integrations(
      id uuid primary key default gen_random_uuid(), user_id uuid references public.inrcy_accounts(id),
      provider text, source text, product text, status text, resource_id text, resource_label text, display_name text,
      meta jsonb default '{}', settings jsonb default '{}', access_token_enc text, refresh_token_enc text,
      expires_at timestamptz, scopes jsonb default '[]', updated_at timestamptz default '2026-01-01');
    create unique index integrations_identity_idx on public.integrations(user_id,provider,source,product);
    create table public.publications(id uuid primary key, user_id uuid references public.inrcy_accounts(id), title text, content text, media_metadata jsonb default '{}');
    create table public.site_articles(
      id uuid primary key, user_id uuid references public.inrcy_accounts(id), source text,
      title text, content text, images jsonb, cta text, media_metadata jsonb default '{}',
      constraint site_articles_source_check check(source in ('inrcy_site','site_web')));
    -- Live inventory confirms there is no UNIQUE(publication_id,channel).
    create table public.publication_deliveries(
      id uuid primary key, publication_id uuid references public.publications(id), user_id uuid references public.inrcy_accounts(id),
      channel text, status text, error text, metadata jsonb default '{}');
    create table public.app_events(id uuid primary key, user_id uuid, payload jsonb, module text default 'booster', type text default 'publish');
    create table public.widget_domain_registry(
      source text, domain text, user_id uuid, updated_at timestamptz default '2026-01-01', primary key(source,domain),
      constraint widget_domain_registry_source_check check(source in ('inrcy_site','site_web')));
    create table public.app_bubble_access(user_id uuid, bubble_key text, enabled boolean, updated_at timestamptz default '2026-01-01', primary key(user_id,bubble_key));
    create table public.stats_cache(id uuid primary key, user_id uuid, source text, payload jsonb);
    create function public.normalize_widget_domain(input text) returns text immutable language sql as $$
      select nullif(regexp_replace(split_part(split_part(regexp_replace(lower(trim(coalesce(input,''))), '^https?://', ''), '/', 1), ':', 1), '^www[.]', ''), '');
    $$;
    insert into public.inrcy_accounts(id,edition) values ('${FV}','premium'),('${AGIRA}','premium'),('${OTHER}','admin');
    insert into public.profiles(user_id,inrcy_site_ownership,inrcy_site_url,company_legal_name) values
      ('${FV}','rented','https://couvreur-hazebrouck.fr','FV Couverture'),
      ('${AGIRA}','owned','https://lille-macon.fr','Agira Renov'), ('${OTHER}','none',null,'Other account');
    insert into public.business_profiles(user_id) values ('${FV}'),('${AGIRA}'),('${OTHER}');
    insert into public.inrcy_site_configs(user_id,site_url,settings) values
      ('${FV}','https://couvreur-hazebrouck.fr','{"ga4":{"property_id":"1234"},"gsc":{"property":"sc-domain:couvreur-hazebrouck.fr"},"legacy_theme":"roof"}'),
      ('${AGIRA}','https://lille-macon.fr','{"ga4":{"property_id":"9876"},"gsc":{"property":"sc-domain:lille-macon.fr"}}');
    insert into public.pro_tools_configs(user_id,settings) values
      ('${FV}','{"site_web":{"url":"https://fv-couverture.fr","theme":"classic","ga4":{"property_id":"old-primary"}},"facebook":{"label":"FV page"}}'),
      ('${AGIRA}','{"site_web":{},"instagram":{"label":"Agira"}}'),
      ('${OTHER}','{"site_web":{"url":"https://other.example","theme":"own"},"facebook":{"label":"Untouched"}}');
    insert into public.widget_domain_registry(source,domain,user_id) values
      ('inrcy_site','couvreur-hazebrouck.fr','${FV}'), ('site_web','fv-couverture.fr','${FV}'),
      ('inrcy_site','lille-macon.fr','${AGIRA}'), ('site_web','other.example','${OTHER}');
    insert into public.app_bubble_access(user_id,bubble_key,enabled) values
      ('${FV}','site_inrcy',true),('${FV}','site_web',true),('${FV}','facebook',false),
      ('${AGIRA}','site_inrcy',true),('${AGIRA}','site_web',false),('${OTHER}','site_web',true);
    insert into public.integrations(id,user_id,provider,source,product,status,resource_id,meta) values
      ('${id(6, 1)}','${FV}','system','site_web','site','connected','https://fv-couverture.fr','{"old_primary":true}'),
      ('${id(6, 2)}','${FV}','system','site_inrcy','site','connected','https://couvreur-hazebrouck.fr','{}'),
      ('${id(6, 3)}','${AGIRA}','system','site_inrcy','site','connected','https://lille-macon.fr','{}'),
      ('${id(6, 4)}','${OTHER}','system','site_web','site','connected','https://other.example','{"untouched":true}');
    insert into public.stats_cache values
      ('${id(7, 1)}','${FV}','site_inrcy_ga4','{"source":"site_inrcy"}'),
      ('${id(7, 2)}','${FV}','bulk','{"blocks":{"site_inrcy":{}}}'),
      ('${id(7, 3)}','${OTHER}','site_web_ga4','{"visits":42}');
  `);
  for (const [accountIndex, userId] of [FV, AGIRA].entries()) {
    for (const [productIndex, product] of ["ga4", "gsc"].entries()) {
      const index = accountIndex * 2 + productIndex + 1;
      await db.query(`insert into public.integrations(id,user_id,provider,source,product,status,resource_id,access_token_enc,refresh_token_enc,expires_at,scopes,settings,meta)
        values ($1,$2,'google','site_inrcy',$3,'connected',$4,$5,$6,'2027-01-01','["readonly"]','{"source":"site_inrcy","persist":"config"}','{"source":"site_inrcy","persist":"metadata"}')`,
        [id(5, index), userId, product, `resource-${index}`, `fixture-access-${index}`, `fixture-refresh-${index}`]);
    }
  }
  for (let index = 1; index <= 15; index++) {
    const source = index <= 8 ? "inrcy_site" : "site_web";
    // Articles 8 and 9 deliberately share one parent but remain separate deliveries.
    const publicationId = id(1, index === 9 ? 8 : index);
    await db.query("insert into public.publications values ($1,$2,$3,$4,$5) on conflict do nothing",
      [publicationId, FV, `Publication ${index}`, `Content ${index}`, { original: index }]);
    await db.query("insert into public.site_articles values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [id(2, index), FV, source, `Article ${index}`, `Body ${index}`, [`https://media.example/${index}.png`], `CTA ${index}`, { storagePath: `media/${index}.png`, overlay: { label: index } }]);
    await db.query("insert into public.publication_deliveries values ($1,$2,$3,$4,'delivered',null,$5)",
      [id(3, index), publicationId, FV, source, { articleId: id(2, index), result: `success-${index}` }]);
    if (index !== 8 && index !== 9) {
      await db.query("insert into public.app_events(id,user_id,payload) values($1,$2,$3)",
        [id(4, index + 1), FV, { publication_id: publicationId, channels: [source], results: { [source]: { external_id: id(2, index) } } }]);
    }
  }
  await db.exec(`
    insert into public.publications values ('${id(1, 30)}','${OTHER}','Other publication','Other content','{}');
    insert into public.site_articles values ('${id(2, 30)}','${OTHER}','site_web','Other article','Other body','[]','Other CTA','{"own":true}');
    insert into public.publication_deliveries values ('${id(3, 30)}','${id(1, 30)}','${OTHER}','site_web','delivered',null,'{}');
    insert into public.app_events(id,user_id,payload) values ('${id(4, 1)}','${FV}','{"publication_id":"${id(1, 8)}","channels":["inrcy_site","site_web"],"results":{"inrcy_site":{"external_id":"${id(2, 8)}"},"site_web":{"external_id":"${id(2, 9)}"}}}');
    insert into public.app_events(id,user_id,payload) values ('${id(4, 30)}','${OTHER}','{"publication_id":"${id(1, 30)}","channels":["site_web"],"results":{"site_web":{"external_id":"${id(2, 30)}"}}}');
    create function public.sync_widget_domain_registry_from_inrcy_site() returns trigger language plpgsql as $$
      begin
        delete from public.widget_domain_registry where source='inrcy_site' and user_id=new.user_id;
        if public.normalize_widget_domain(new.site_url) is not null then
          insert into public.widget_domain_registry(source,domain,user_id) values('inrcy_site',public.normalize_widget_domain(new.site_url),new.user_id)
          on conflict(source,domain) do update set user_id=excluded.user_id;
        end if; return new;
      end; $$;
    create trigger arbitrarily_named_legacy_widget after insert or update on public.inrcy_site_configs for each row execute function public.sync_widget_domain_registry_from_inrcy_site();
    create function public.old_web_registry() returns trigger language plpgsql as $$
      begin
        delete from public.widget_domain_registry where source='site_web' and user_id=new.user_id;
        if public.normalize_widget_domain(new.settings #>> '{site_web,url}') is not null then
          insert into public.widget_domain_registry(source,domain,user_id) values('site_web',public.normalize_widget_domain(new.settings #>> '{site_web,url}'),new.user_id)
          on conflict(source,domain) do update set user_id=excluded.user_id;
        end if; return new;
      end; $$;
    create trigger arbitrary_old_web_registry after insert or update of settings on public.pro_tools_configs for each row execute function public.old_web_registry();
    create function public.create_site_configs_on_profile_insert() returns trigger language plpgsql as $$
      begin insert into public.inrcy_site_configs(user_id,site_url) values(new.user_id,new.inrcy_site_url) on conflict do nothing; return new; end; $$;
    create trigger arbitrary_profile_config after insert on public.profiles for each row execute function public.create_site_configs_on_profile_insert();
    create function public.sync_site_url_to_site_configs() returns trigger language plpgsql as $$
      begin update public.inrcy_site_configs set site_url=new.inrcy_site_url where user_id=new.user_id; return new; end; $$;
    create trigger arbitrary_profile_site_update after update on public.profiles for each row execute function public.sync_site_url_to_site_configs();
    create function public.sync_site_url_on_profile_insert() returns trigger language plpgsql as $$
      begin update public.inrcy_site_configs set site_url=new.inrcy_site_url where user_id=new.user_id; return new; end; $$;
    create trigger arbitrary_profile_site_insert after insert on public.profiles for each row execute function public.sync_site_url_on_profile_insert();
    create function public.lock_inrcy_site_fields() returns trigger language plpgsql as $$
      begin perform new.inrcy_site_ownership; return new; end; $$;
    create trigger arbitrary_profile_lock before update on public.profiles for each row execute function public.lock_inrcy_site_fields();
    create function public.bump_stats_version_from_profiles() returns trigger language plpgsql as $$
      begin
        if new.inrcy_site_ownership is distinct from old.inrcy_site_ownership or new.lead_conversion_rate is distinct from old.lead_conversion_rate then
          new.stats_version:=coalesce(old.stats_version,0)+1;
        end if; return new;
      end; $$;
    create trigger profile_stats before update on public.profiles for each row execute function public.bump_stats_version_from_profiles();
    create function public.create_default_bubble_access() returns trigger language plpgsql as $$
      begin insert into public.app_bubble_access(user_id,bubble_key,enabled) values(new.user_id,'site_inrcy',true),(new.user_id,'site_web',true) on conflict do nothing; return new; end; $$;
    create trigger profile_bubbles after insert on public.profiles for each row execute function public.create_default_bubble_access();
    create function public.inrcy_seed_new_account_bubble_access() returns trigger language plpgsql as $$
      begin insert into public.app_bubble_access(user_id,bubble_key,enabled) values(new.id,'site_inrcy',false),(new.id,'pinterest',true),(new.id,'tiktok',true),(new.id,'inr_agent',true)
      on conflict(user_id,bubble_key) do update set enabled=excluded.enabled; return new; end; $$;
    create trigger zzzz_account_bubbles after insert on public.inrcy_accounts for each row execute function public.inrcy_seed_new_account_bubble_access();
  `);
  return db;
}

test("transfer preserves every article, delivery, parent, credential and the two FV domains", async () => {
  const db = await fixture();
  try {
    assert.deepEqual(await rows(db, "select public.normalize_widget_domain('HTTPS://WWW.FV-COUVERTURE.FR/actualites') as domain, public.normalize_widget_domain('') as empty"), [{ domain: "fv-couverture.fr", empty: null }]);
    const articles = await rows(db, "select id,user_id,title,content,images,cta,media_metadata from public.site_articles order by id");
    const deliveries = await rows(db, "select id,publication_id,user_id,status,error,metadata from public.publication_deliveries order by id");
    const publications = await rows(db, "select * from public.publications order by id");
    const events = await rows(db, "select * from public.app_events order by id");
    const credentials = await rows(db, "select id,user_id,provider,product,status,resource_id,resource_label,access_token_enc,refresh_token_enc,expires_at,scopes from public.integrations where provider='google' order by id");
    const otherConfig = await rows(db, "select * from public.pro_tools_configs where user_id=$1", [OTHER]);
    const otherIntegration = await rows(db, "select * from public.integrations where user_id=$1", [OTHER]);
    const otherRegistry = await rows(db, "select * from public.widget_domain_registry where user_id=$1", [OTHER]);
    const businessPreferences = await rows(db, "select user_id,ai_channel_ctas,updated_at from public.business_profiles order by user_id");
    await db.exec(transfer);
    assert.deepEqual(await rows(db, "select id,user_id,title,content,images,cta,media_metadata - 'publication_id' as media_metadata from public.site_articles order by id"), articles);
    assert.equal((await rows(db, "select count(*)::int as count from public.site_articles a join public.publication_deliveries d on d.metadata->>'articleId'=a.id::text where a.user_id=$1 and a.media_metadata->>'publication_id'=d.publication_id::text", [FV]))[0].count, 15);
    assert.equal((await rows(db, "select media_metadata->>'publication_id' as parent from public.site_articles where id=$1", [id(2, 30)]))[0].parent, id(1, 30));
    assert.deepEqual(await rows(db, "select id,publication_id,user_id,status,error,metadata from public.publication_deliveries order by id"), deliveries);
    assert.deepEqual(await rows(db, "select * from public.publications order by id"), publications);
    assert.deepEqual(await rows(db, "select * from public.app_events order by id"), events);
    assert.deepEqual(await rows(db, "select id,user_id,provider,product,status,resource_id,resource_label,access_token_enc,refresh_token_enc,expires_at,scopes from public.integrations where provider='google' order by id"), credentials);
    assert.equal(credentials.length, 4);
    assert.deepEqual(await rows(db, "select * from public.pro_tools_configs where user_id=$1", [OTHER]), otherConfig);
    assert.deepEqual(await rows(db, "select * from public.integrations where user_id=$1", [OTHER]), otherIntegration);
    assert.deepEqual(await rows(db, "select * from public.widget_domain_registry where user_id=$1", [OTHER]), otherRegistry);
    assert.deepEqual(await rows(db, "select user_id,ai_channel_ctas,updated_at from public.business_profiles order by user_id"), businessPreferences);
    assert.deepEqual(await rows(db, "select distinct source,settings,meta from public.integrations where provider='google'"), [{ source: "site_web", settings: { source: "site_web", persist: "config" }, meta: { source: "site_web", persist: "metadata" } }]);
    assert.equal((await rows(db, "select count(*)::int as count from public.site_articles where user_id=$1 and source='site_web'", [FV]))[0].count, 15);
    assert.equal((await rows(db, "select count(*)::int as count from public.publication_deliveries where publication_id=$1 and channel='site_web'", [id(1, 8)]))[0].count, 2);
    assert.deepEqual(await rows(db, "select source,domain from public.widget_domain_registry where user_id=$1 order by domain", [FV]), [
      { source: "site_web", domain: "couvreur-hazebrouck.fr" }, { source: "site_web", domain: "fv-couverture.fr" },
    ]);
    const config = (await rows(db, "select settings from public.pro_tools_configs where user_id=$1", [FV]))[0].settings as Record<string, unknown>;
    assert.deepEqual(config.facebook, { label: "FV page" });
    assert.deepEqual(config.site_web, { url: "https://couvreur-hazebrouck.fr", domain: "couvreur-hazebrouck.fr", widget_domains: ["fv-couverture.fr"], theme: "classic", legacy_theme: "roof", ga4: { property_id: "1234" }, gsc: { property: "sc-domain:couvreur-hazebrouck.fr" } });
    assert.deepEqual(await rows(db, "select id from public.integrations where provider='system' and user_id=$1", [FV]), [{ id: id(6, 1) }]);
    assert.deepEqual(await rows(db, "select bubble_key,enabled from public.app_bubble_access where user_id=$1 order by bubble_key", [FV]), [{ bubble_key: "facebook", enabled: false }, { bubble_key: "site_web", enabled: true }]);
    assert.deepEqual(await rows(db, "select id from public.stats_cache order by id"), [{ id: id(7, 3) }]);
  } finally { await db.close(); }
});

test("retirement removes the schema and leaves standard/admin provisioning and future domain updates usable", async () => {
  const db = await fixture();
  try {
    await db.exec(transfer); await db.exec(retirement);
    assert.deepEqual(await rows(db, "select to_regclass('public.inrcy_site_configs') as old_table, to_regtype('public.inrcy_site_ownership_type') as old_type"), [{ old_table: null, old_type: null }]);
    assert.equal((await rows(db, "select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='profiles' and column_name in ('inrcy_site_ownership','inrcy_site_url')"))[0].count, 0);
    assert.equal((await rows(db, "select count(*)::int as count from pg_proc where pronamespace='public'::regnamespace and prosrc ~ 'inrcy_site_configs|inrcy_site_ownership|inrcy_site_url'"))[0].count, 0);
    const domainsBefore = await rows(db, "select source,domain,user_id from public.widget_domain_registry order by source,domain");
    await db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{facebook}', '{\"label\":\"Edited\"}') where user_id=$1", [FV]);
    assert.deepEqual(await rows(db, "select source,domain,user_id from public.widget_domain_registry order by source,domain"), domainsBefore);
    await db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{site_web,ga4,property_id}', '\"new-property\"') where user_id=$1", [FV]);
    assert.deepEqual(await rows(db, "select source,domain,user_id from public.widget_domain_registry order by source,domain"), domainsBefore);
    await assert.rejects(db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{site_web,url}', '\"https://other.example\"') where user_id=$1", [FV]), /already registered/);
    assert.deepEqual(await rows(db, "select source,domain,user_id from public.widget_domain_registry order by source,domain"), domainsBefore);
    await db.query("delete from public.widget_domain_registry where user_id=$1", [FV]);
    await db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{site_web,domain}', '\"changed-marker\"') where user_id=$1", [FV]);
    assert.deepEqual(await rows(db, "select source,domain,user_id from public.widget_domain_registry order by source,domain"), domainsBefore);
    await db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{site_web,url}', '\"\"') where user_id=$1", [FV]);
    assert.equal((await rows(db, "select count(*)::int as count from public.widget_domain_registry where user_id=$1", [FV]))[0].count, 0);
    for (const [index, edition] of ["standard", "admin"].entries()) {
      const accountId = id(8, index + 1);
      await db.query("insert into public.inrcy_accounts(id,edition) values($1,$2)", [accountId, edition]);
      await db.query("insert into public.profiles(user_id,company_legal_name) values($1,$2)", [accountId, edition]);
      const access = await rows(db, "select bubble_key,enabled from public.app_bubble_access where user_id=$1 order by bubble_key", [accountId]);
      assert.ok(access.some((row) => row.bubble_key === "site_web" && row.enabled === true));
      assert.equal(access.some((row) => row.bubble_key === "site_inrcy"), false);
      assert.ok(access.some((row) => row.bubble_key === "pinterest" && row.enabled === true));
      await db.query("update public.app_bubble_access set enabled=false where user_id=$1 and bubble_key='site_web'", [accountId]);
      assert.equal((await rows(db, "select enabled from public.app_bubble_access where user_id=$1 and bubble_key='site_web'", [accountId]))[0].enabled, false);
    }
    for (const query of [
      `insert into public.app_bubble_access(user_id,bubble_key,enabled) values('${FV}','site_inrcy',true)`,
      `update public.site_articles set source='inrcy_site' where id='${id(2, 1)}'`,
      `update public.publication_deliveries set channel='inrcy_site' where id='${id(3, 1)}'`,
      `update public.integrations set source='site_inrcy' where id='${id(5, 1)}'`,
      `insert into public.widget_domain_registry(source,domain,user_id) values('inrcy_site','retired.example','${FV}')`,
    ]) await assert.rejects(db.exec(query), /check constraint/);
    assert.equal((await rows(db, "select has_function_privilege('authenticated','public.sync_site_web_widget_domains()','EXECUTE') as can_execute"))[0].can_execute, false);
    await db.query("update public.profiles set avg_basket=avg_basket+10 where user_id=$1", [AGIRA]);
    assert.equal((await rows(db, "select stats_version from public.profiles where user_id=$1", [AGIRA]))[0].stats_version, 2);
  } finally { await db.close(); }
});

test("transfer folds saved Badge and CTA preferences with canonical defaults while keeping other networks intact", async () => {
  const db = await fixture();
  try {
    const facebook = { choice: "custom", mode: "custom", label: "Autre réseau", url: "https://facebook.example/contact", phone: "" };
    const oldWebsite = { choice: "appeler", mode: "call", label: "Appelez", url: "", phone: "0102030405" };
    const currentWebsite = { choice: "site", mode: "website", label: "Notre site", url: "https://canonical.example", phone: "" };
    const scenarios = [
      { account: FV, badge: { siteInrcy: false, phone: false }, expectedBadge: { siteWeb: true, phone: false }, ctas: { site_web: currentWebsite, inrcy_site: oldWebsite, facebook }, expectedCtas: { site_web: currentWebsite, facebook } },
      { account: AGIRA, badge: { siteInrcy: false, siteWeb: false, phone: true }, expectedBadge: { siteWeb: false, phone: true }, ctas: { site_web: {}, inrcy_site: oldWebsite, facebook }, expectedCtas: { site_web: oldWebsite, facebook } },
      { account: OTHER, badge: { siteInrcy: true, siteWeb: false, phone: false }, expectedBadge: { siteWeb: true, phone: false }, ctas: { siteInrcy: oldWebsite, facebook }, expectedCtas: { site_web: oldWebsite, facebook } },
    ];
    for (const scenario of scenarios) {
      await db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{inrBadgeShareSettings}',$2::jsonb) where user_id=$1", [scenario.account, scenario.badge]);
      await db.query("update public.business_profiles set ai_channel_ctas=$2::jsonb where user_id=$1", [scenario.account, scenario.ctas]);
    }
    const events = await rows(db, "select * from public.app_events order by id");
    await db.exec(transfer);
    for (const scenario of scenarios) {
      assert.deepEqual((await rows(db, "select settings -> 'inrBadgeShareSettings' as badge from public.pro_tools_configs where user_id=$1", [scenario.account]))[0].badge, scenario.expectedBadge);
      assert.deepEqual((await rows(db, "select ai_channel_ctas from public.business_profiles where user_id=$1", [scenario.account]))[0].ai_channel_ctas, scenario.expectedCtas);
    }
    assert.deepEqual(await rows(db, "select * from public.app_events order by id"), events);
  } finally { await db.close(); }
});

test("transfer fails closed on a changed inventory, conflicting Google identity or another domain owner", async () => {
  for (const scenario of ["inventory", "google", "domain", "system_credential", "outside_legacy", "missing_event", "ambiguous_parent", "invalid_metadata"] as const) {
    const db = await fixture();
    try {
      if (scenario === "inventory") await db.query("insert into public.inrcy_site_configs(user_id,site_url) values($1,'https://unapproved.example')", [OTHER]);
      if (scenario === "google") await db.query("insert into public.integrations(user_id,provider,source,product,access_token_enc,refresh_token_enc) values($1,'google','site_web','ga4','other-fixture-access','other-fixture-refresh')", [FV]);
      if (scenario === "domain") await db.query("insert into public.widget_domain_registry(source,domain,user_id) values('site_web','couvreur-hazebrouck.fr',$1)", [OTHER]);
      if (scenario === "system_credential") await db.query("update public.integrations set access_token_enc='fixture-unexpected-system-secret' where id=$1", [id(6, 2)]);
      if (scenario === "outside_legacy") await db.query("insert into public.integrations(user_id,provider,source,product) values($1,'google','site_inrcy','ga4')", [OTHER]);
      if (scenario === "missing_event") await db.query("delete from public.app_events where id=$1", [id(4, 2)]);
      if (scenario === "ambiguous_parent") await db.query("insert into public.app_events(id,user_id,payload) values($1,$2,$3)", [id(4, 99), FV, { publication_id: id(1, 2), results: { site_web: { external_id: id(2, 1) } } }]);
      if (scenario === "invalid_metadata") await db.query("update public.site_articles set media_metadata='[]' where id=$1", [id(2, 1)]);
      const before = await rows(db, "select id,source,access_token_enc,refresh_token_enc from public.integrations order by id");
      await assert.rejects(db.exec(transfer), /inventory changed|Conflicting Google integration|belongs to two accounts|Unexpected legacy integration|publication|metadata|parent|mapping|article/i);
      await db.exec("rollback");
      assert.deepEqual(await rows(db, "select id,source,access_token_enc,refresh_token_enc from public.integrations order by id"), before);
      assert.equal((await rows(db, "select count(*)::int as count from public.site_articles where user_id=$1 and source='inrcy_site'", [FV]))[0].count, 8);
    } finally { await db.close(); }
  }
});

test("retirement refuses a missing transfer and rolls back if an unreviewed database routine remains", async () => {
  const db = await fixture();
  try {
    await assert.rejects(db.exec(retirement), /Run and verify Site Web transfer/);
    await db.exec("rollback"); await db.exec(transfer);
    await db.exec("create function public.unreviewed_site_reader() returns bigint language plpgsql as $$ begin return (select count(*) from public.inrcy_site_configs); end; $$");
    await assert.rejects(db.exec(retirement), /Unreviewed legacy database routine|depend on it/);
    await db.exec("rollback");
    assert.equal((await rows(db, "select count(*)::int as count from public.inrcy_site_configs"))[0].count, 2);
    await db.exec("drop function public.unreviewed_site_reader()");
    await db.exec(retirement);
    assert.equal((await rows(db, "select to_regclass('public.inrcy_site_configs') as old_table"))[0].old_table, null);
  } finally { await db.close(); }
});

test("domain assignment also rejects an owner collision appearing at insertion time", async () => {
  const db = await fixture();
  try {
    await db.exec(transfer); await db.exec(retirement);
    // Deterministically model another writer claiming the domain after the precheck.
    await db.exec(`create function public.inject_competing_domain_owner() returns trigger language plpgsql as $$
      begin
        if new.domain='race.example' and new.user_id='${FV}'::uuid then
          insert into public.widget_domain_registry(source,domain,user_id) values('site_web','race.example','${OTHER}');
        end if; return new;
      end; $$;
      create trigger inject_competing_domain_owner before insert on public.widget_domain_registry for each row execute function public.inject_competing_domain_owner();`);
    await assert.rejects(db.query("update public.pro_tools_configs set settings=jsonb_set(settings,'{site_web,url}', '\"https://race.example\"') where user_id=$1", [FV]), /already registered|domain|Domain|ON CONFLICT DO UPDATE command cannot affect row a second time/);
    assert.equal((await rows(db, "select settings #>> '{site_web,url}' as url from public.pro_tools_configs where user_id=$1", [FV]))[0].url, "https://couvreur-hazebrouck.fr");
    assert.deepEqual(await rows(db, "select domain from public.widget_domain_registry where user_id=$1 order by domain", [FV]), [{ domain: "couvreur-hazebrouck.fr" }, { domain: "fv-couverture.fr" }]);
  } finally { await db.close(); }
});
