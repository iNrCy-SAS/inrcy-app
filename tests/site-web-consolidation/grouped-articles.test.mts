import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectSiteWebFeedArticles, siteWebArticleIdsFromPayload, siteWebImageMediaPatch } from "../../lib/siteWebPublications.ts";
import { loadSiteWebPublicationArticles, updateSiteWebPublicationArticles, deleteSiteWebPublicationArticles } from "../../lib/inrsend/siteWebArticleActions.ts";
import { loadSiteWebWidgetArticles } from "../../lib/widgets/siteWebArticles.ts";

const ACCOUNT = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const PARENT = "00000000-0000-4000-8001-000000000001";
const OTHER_PARENT = "00000000-0000-4000-8001-000000000002";
const PRIMARY = "00000000-0000-4000-8002-000000000001";
const SECONDARY = "00000000-0000-4000-8002-000000000002";
const FOREIGN = "00000000-0000-4000-8002-000000000003";
const DIFFERENT_PARENT = "00000000-0000-4000-8002-000000000004";
const LATE_CHILD = "00000000-0000-4000-8002-000000000005";

function supabaseAdapter(db: PGlite): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "site_articles");
      const filters: Array<{ column: string; value: unknown; list: boolean }> = [];
      let action = "select";
      let patch: Record<string, unknown> = {};
      const expression = (column: string) => column === "media_metadata->>publication_id" ? "media_metadata->>'publication_id'" : `"${column}"`;
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) { filters.push({ column, value, list: false }); return builder; },
        in(column: string, value: unknown) { filters.push({ column, value, list: true }); return builder; },
        update(value: Record<string, unknown>) { action = "update"; patch = value; return builder; },
        delete() { action = "delete"; return builder; },
        async then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          const params: unknown[] = [];
          const parameter = (value: unknown) => { params.push(value); return `$${params.length}`; };
          const sets = action === "update" ? Object.entries(patch).map(([key, value]) => `${expression(key)}=${parameter(value)}`).join(",") : "";
          const where = filters.map(({ column, value, list }) => list
            ? `${expression(column)}=any(${parameter(value)}::${column === "id" ? "uuid" : "text"}[])`
            : `${expression(column)}=${parameter(value)}`).join(" and ");
          const query = action === "update" ? `update public.site_articles set ${sets} where ${where} returning *`
            : action === "delete" ? `delete from public.site_articles where ${where} returning *`
              : `select * from public.site_articles where ${where}`;
          return db.query<Record<string, unknown>>(query, params)
            .then((result) => ({ data: result.rows, error: null })).then(resolve, reject);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

async function fixture() {
  const db = new PGlite();
  await db.exec("create table public.site_articles(id uuid primary key,user_id uuid,source text,title text check(title<>'reject-update'),content text,site_url text,external_url text,media_metadata jsonb,media_type text default 'images',video_url text,video_path text,video_mime text,video_size bigint,video_duration_seconds numeric,video_thumbnail_url text)");
  const rows = [
    [PRIMARY, ACCOUNT, "Primary", "https://couvreur-hazebrouck.fr", PARENT],
    [SECONDARY, ACCOUNT, "Secondary", "https://fv-couverture.fr", PARENT],
    [FOREIGN, OTHER, "Foreign", "https://foreign.example", PARENT],
    [DIFFERENT_PARENT, ACCOUNT, "Other parent", "https://couvreur-hazebrouck.fr", OTHER_PARENT],
  ];
  for (const [articleId, userId, title, url, parent] of rows) {
    await db.query("insert into public.site_articles(id,user_id,source,title,content,site_url,external_url,media_metadata) values($1,$2,'site_web',$3,$3,$4,$4,$5)",
      [articleId, userId, title, url, { publication_id: parent, preserved: articleId }]);
  }
  return { db, client: supabaseAdapter(db) };
}

test("a paired parent appears once in the feed using the configured primary website article", () => {
  const primary = { id: PRIMARY, site_url: "https://couvreur-hazebrouck.fr", title: "Principal", media_metadata: { publication_id: PARENT } };
  const secondary = { id: SECONDARY, site_url: "https://fv-couverture.fr", title: "Secondaire", media_metadata: { publication_id: PARENT } };
  const standalone = { id: DIFFERENT_PARENT, title: "Autre article", site_url: "https://couvreur-hazebrouck.fr", media_metadata: {} };
  assert.deepEqual(selectSiteWebFeedArticles([secondary, primary, standalone], "https://couvreur-hazebrouck.fr", 5), [primary, standalone]);
  assert.deepEqual(selectSiteWebFeedArticles([primary, secondary], "https://fv-couverture.fr", 5), [secondary]);
});

test("raw legacy results and the saved canonical external_ids retain both article identities", () => {
  assert.deepEqual(siteWebArticleIdsFromPayload({ results: { inrcy_site: { external_id: PRIMARY }, site_web: { external_id: SECONDARY }, facebook: { external_id: FOREIGN } } }), [PRIMARY, SECONDARY]);
  assert.deepEqual(siteWebArticleIdsFromPayload({ results: { site_web: { external_id: PRIMARY, external_ids: [PRIMARY, SECONDARY] } } }), [PRIMARY, SECONDARY]);
});

test("grouped PATCH updates both owned children without changing IDs or the other owner/parent", async () => {
  const { db, client } = await fixture();
  try {
    const raw = { results: { inrcy_site: { external_id: PRIMARY }, site_web: { external_ids: [SECONDARY, FOREIGN, DIFFERENT_PARENT] } } };
    const group = await loadSiteWebPublicationArticles(client, ACCOUNT, PARENT, raw);
    assert.deepEqual(group.map((row) => String(row.id)).sort(), [PRIMARY, SECONDARY]);
    const updated = await updateSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT, patch: { title: "Edited", content: "Updated body" } });
    assert.equal(updated.length, 2);
    const rows = (await db.query<{ id: string; title: string }>("select id,title from public.site_articles order by id")).rows;
    assert.deepEqual(rows, [{ id: PRIMARY, title: "Edited" }, { id: SECONDARY, title: "Edited" }, { id: FOREIGN, title: "Foreign" }, { id: DIFFERENT_PARENT, title: "Other parent" }]);
  } finally { await db.close(); }
});

test("a database rejection rolls back the entire paired article update", async () => {
  const { db, client } = await fixture();
  try {
    const before = (await db.query("select * from public.site_articles order by id")).rows;
    await assert.rejects(updateSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT, patch: { title: "reject-update", content: "Must not land" } }), /check constraint/);
    assert.deepEqual((await db.query("select * from public.site_articles order by id")).rows, before);
  } finally { await db.close(); }
});

test("grouped DELETE removes both children and leaves the other parent and owner untouched", async () => {
  const { db, client } = await fixture();
  try {
    await deleteSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT });
    assert.deepEqual((await db.query<{ id: string }>("select id from public.site_articles order by id")).rows, [{ id: FOREIGN }, { id: DIFFERENT_PARENT }]);
    assert.deepEqual(await loadSiteWebPublicationArticles(client, ACCOUNT, PARENT, { results: { site_web: { external_ids: [PRIMARY, SECONDARY] } } }), []);
    assert.deepEqual(await deleteSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT }), []);
    await assert.rejects(updateSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT, patch: { title: "Cannot recreate a removed article" } }), /Article du site introuvable/);
  } finally { await db.close(); }
});

test("switching a mixed historical group to images clears video columns on every child", async () => {
  const { db, client } = await fixture();
  try {
    await db.query("update public.site_articles set media_type='video',video_url='https://media.example/old.mp4',video_path='old.mp4',video_mime='video/mp4',video_size=99,video_duration_seconds=7,video_thumbnail_url='https://media.example/old.jpg' where id=$1", [SECONDARY]);
    await updateSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT, patch: siteWebImageMediaPatch(PARENT, { imageInteractions: [] }) });
    const media = (await db.query("select media_type,video_url,video_path,video_mime,video_size,video_duration_seconds,video_thumbnail_url from public.site_articles where user_id=$1 and media_metadata->>'publication_id'=$2 order by id", [ACCOUNT, PARENT])).rows;
    assert.equal(media.length, 2);
    for (const row of media) assert.deepEqual(row, { media_type: "images", video_url: null, video_path: null, video_mime: null, video_size: null, video_duration_seconds: null, video_thumbnail_url: null });
  } finally { await db.close(); }
});

test("a child added after context loading belongs to the same atomic mutation and returned ID group", async () => {
  const { db, client } = await fixture();
  try {
    assert.equal((await loadSiteWebPublicationArticles(client, ACCOUNT, PARENT, {})).length, 2);
    await db.query("insert into public.site_articles(id,user_id,source,title,content,site_url,media_metadata) values($1,$2,'site_web','Late','Late','https://couvreur-hazebrouck.fr',$3)", [LATE_CHILD, ACCOUNT, { publication_id: PARENT }]);
    const changed = await updateSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT, patch: { title: "Current group" } });
    assert.deepEqual(changed.map((row) => String(row.id)).sort(), [PRIMARY, SECONDARY, LATE_CHILD]);
    await db.query("delete from public.site_articles where id=$1", [SECONDARY]);
    const deleted = await deleteSiteWebPublicationArticles(client, { userId: ACCOUNT, publicationId: PARENT });
    assert.deepEqual(deleted.map((row) => String(row.id)).sort(), [PRIMARY, LATE_CHILD]);
  } finally { await db.close(); }
});

test("the shared feed loader can choose a primary sibling older than its first page", async () => {
  const articles = Array.from({ length: 40 }, (_, index) => ({
    id: `00000000-0000-4000-8003-${String(index + 1).padStart(12, "0")}`,
    site_url: "https://fv-couverture.fr",
    media_metadata: { publication_id: `00000000-0000-4000-8004-${String(index + 1).padStart(12, "0")}` },
  }));
  const primary = { id: PRIMARY, site_url: "https://couvreur-hazebrouck.fr", media_metadata: articles[0].media_metadata };
  const allArticles = [...articles, primary];
  const client = {
    from(table: string) {
      let range: [number, number] | null = null;
      let parents: unknown[] | null = null;
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder,
        range(from: number, to: number) { range = [from, to]; return builder; },
        in(_column: string, values: unknown[]) { parents = values; return builder; },
        maybeSingle: () => Promise.resolve({ data: { settings: { site_web: { url: "https://couvreur-hazebrouck.fr" } } }, error: null }),
        then(resolve: (value: unknown) => unknown) {
          assert.equal(table, "site_articles");
          const data = parents ? allArticles.filter((article) => parents!.includes(article.media_metadata.publication_id))
            : range ? allArticles.slice(range[0], range[1] + 1) : allArticles;
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  assert.deepEqual(await loadSiteWebWidgetArticles(client, ACCOUNT, 2), [primary, articles[1]]);
});
