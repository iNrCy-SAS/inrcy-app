import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMediaReferencedByPublishedContent, publicationReferencesMedia } from "../../lib/publishedMediaRetention.ts";

type Row = Record<string, unknown>;
const media = {
  id: "media-1", user_id: "account-1", source: "booster_workspace", is_active: true,
  bucket_name: "inrcy-pro-media", storage_path: "users/account-1/workspace-source/video/source.mp4",
  canonical_bucket_name: "inrcy-pro-media", canonical_storage_path: "users/account-1/canonical/video.mp4",
  original_retention_until: "2020-01-01T00:00:00Z", original_deleted_at: null,
};

function database(rows: Record<string, Row[]> = {}, failingTable = "") {
  const tables: Record<string, Row[]> = { pro_media_library: [{ ...media }], publication_workspace_media: [], media_variants: [], site_articles: [], publications: [], ...structuredClone(rows) };
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const removals: Array<{ bucket: string; paths: string[] }> = [];
  const db = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let patch: Row | undefined;
      let start = 0;
      let end = Infinity;
      const query = {
        select() { return query; }, order() { return query; },
        eq(key: string, value: unknown) { filters.push(["eq", key, value]); return query; },
        neq(key: string, value: unknown) { filters.push(["neq", key, value]); return query; },
        is(key: string, value: unknown) { filters.push(["eq", key, value]); return query; },
        not(key: string, _operator: string, value: unknown) { filters.push(["neq", key, value]); return query; },
        lte(key: string, value: unknown) { filters.push(["lte", key, value]); return query; },
        limit(value: number) { end = value - 1; return query; },
        range(from: number, to: number) { start = from; end = to; return query; },
        update(value: Row) { patch = value; return query; },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          queries.push({ table, filters: [...filters] });
          if (table === failingTable) return Promise.resolve({ error: new Error("reference lookup unavailable"), data: null }).then(resolve, reject);
          const matches = (tables[table] || []).filter(row => filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "neq" ? row[key] !== value : String(row[key]) <= String(value)));
          const selected = matches.slice(start, end + 1);
          if (patch) selected.forEach(row => Object.assign(row, patch));
          return Promise.resolve({ data: selected, count: matches.length, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from(bucket: string) { return { async remove(paths: string[]) { removals.push({ bucket, paths }); return { error: null }; } }; } },
  };
  return { db: db as unknown as SupabaseClient, tables, queries, removals };
}

function cron(db: SupabaseClient) {
  const source = readFileSync("app/api/cron/media-orphan-cleanup/route.ts", "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/publishedMediaRetention": { isMediaReferencedByPublishedContent },
    "@/lib/aiGeneratedMediaRegistry": { purgeExpiredGeneratedAiMediaDrafts: async () => ({ errors: [] }) },
    "@/lib/aiMediaProviderImageCleanup": { purgeExpiredAiMediaProviderImages: async () => ({ errors: [] }) },
    "@/lib/aiMediaCharacterVoiceStorage": { purgeExpiredAiMediaCharacterVoices: async () => ({ errors: [] }) },
    "@/lib/aiMediaCompositionRecovery": { purgeExpiredAiMediaCompositionObjects: async () => 0 },
  };
  new Function("require", "exports", code)((name: string) => {
    assert.ok(name in modules, `Unexpected dependency: ${name}`);
    return modules[name];
  }, exports);
  return async () => {
    const previous = process.env.VERCEL_CRON_SECRET;
    process.env.VERCEL_CRON_SECRET = "retention-test";
    try {
      return await exports.GET!(new Request("https://app.inrcy.com/api/cron/media-orphan-cleanup", { headers: { authorization: "Bearer retention-test" } }));
    } finally {
      if (previous === undefined) delete process.env.VERCEL_CRON_SECRET;
      else process.env.VERCEL_CRON_SECRET = previous;
    }
  };
}

test("published references include IDs, storage delivery URLs, JSON and normalized variants", () => {
  const candidate = { ...media, variant_storage_paths: ["users/account-1/normalized/site-card.jpg"] };
  for (const value of [
    { mediaId: media.id }, { video_path: media.storage_path },
    { video_url: `/api/storage/content?path=${encodeURIComponent(media.storage_path)}&token=signed` },
    { video_url: `https://storage.example/storage/v1/object/sign/inrcy-pro-media/${encodeURIComponent(media.storage_path)}?token=signed` },
    { video_url: `/api/media-library/items/${media.id}/content?token=signed` },
    { video_path: media.canonical_storage_path },
    { images: ["https://storage.example/storage/v1/object/public/inrcy-pro-media/users/account-1/normalized/site-card.jpg"] },
    { media_metadata: JSON.stringify({ videoByChannel: { site_web: { storagePath: media.storage_path } } }) },
  ]) assert.equal(publicationReferencesMedia(value, candidate), true, JSON.stringify(value));
  for (const value of [null, { video_path: `${media.storage_path}.other` }, { video_path: "source.mp4" }, { mediaId: "media-10" }, { video_url: "/api/media-library/items/media-10/content" }]) {
    assert.equal(publicationReferencesMedia(value, candidate), false, JSON.stringify(value));
  }
});

test("reference checks paginate past 200 publications and scope every page to the owner", async () => {
  const fixture = database({ publications: Array.from({ length: 201 }, (_, index) => ({ id: String(index), user_id: media.user_id, media_metadata: index === 200 ? { video: { mediaId: media.id } } : {} })) });
  assert.equal(await isMediaReferencedByPublishedContent(fixture.db, media), true);
  assert.equal(fixture.queries.filter(q => q.table === "publications").length, 2);
  assert.ok(fixture.queries.every(q => q.filters.some(([op, key, value]) => op === "eq" && key === "user_id" && value === media.user_id)));
});

test("cron retains a detached source still used by a website article", async () => {
  const fixture = database({ site_articles: [{ id: "article", user_id: media.user_id, video_path: media.storage_path }] });
  const response = await cron(fixture.db)();
  const result = await response.json();
  assert.equal(result.retained, 1);
  assert.equal(result.removed, 0);
  assert.deepEqual(fixture.removals, []);
  assert.equal(fixture.tables.pro_media_library[0].original_retention_until, null);
  assert.equal(fixture.tables.pro_media_library[0].is_active, true);
});

test("cron also protects images published using only a normalized variant", async () => {
  const variant = "users/account-1/normalized/site-card.jpg";
  const fixture = database({ media_variants: [{ id: "variant", media_id: media.id, account_id: media.user_id, bucket_name: media.bucket_name, storage_path: variant, status: "ready" }], publications: [{ id: "post", user_id: media.user_id, images: [`https://storage.example/storage/v1/object/sign/inrcy-pro-media/${variant}?token=signed`] }] });
  const result = await (await cron(fixture.db)()).json();
  assert.equal(result.retained, 1);
  assert.deepEqual(fixture.removals, []);
});

test("an unavailable reference lookup blocks deletion without deactivating the source", async () => {
  const fixture = database({}, "publications");
  const result = await (await cron(fixture.db)()).json();
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.removed, 0);
  assert.deepEqual(fixture.removals, []);
  assert.equal(fixture.tables.pro_media_library[0].is_active, true);
  assert.equal(fixture.tables.pro_media_library[0].original_deleted_at, null);
});

test("a genuinely unused expired source is cleaned, without cross-account matches", async () => {
  const fixture = database({ site_articles: [{ id: "other-account", user_id: "account-2", video_path: media.storage_path }] });
  const result = await (await cron(fixture.db)()).json();
  assert.equal(result.removed, 1);
  assert.equal(result.retained, 0);
  assert.deepEqual(fixture.removals, [{ bucket: media.bucket_name, paths: [media.storage_path, media.canonical_storage_path] }]);
  assert.equal(fixture.tables.pro_media_library[0].is_active, false);
  assert.equal(fixture.tables.pro_media_library[0].upload_status, "removed");
});

test("missing account scope and database failures cannot authorize deletion", async () => {
  await assert.rejects(isMediaReferencedByPublishedContent(database().db, { ...media, user_id: "" }), /scope_missing/);
  await assert.rejects(isMediaReferencedByPublishedContent(database({}, "site_articles").db, media), /lookup unavailable/);
});
