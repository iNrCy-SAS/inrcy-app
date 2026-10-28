import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "./runtime-module-loader.mts";

type Row = Record<string, unknown>;
type PreviewModule = typeof import("../../lib/inrAgentMediaPreview.ts");
const bankId = "11111111-1111-4111-8111-111111111111";
const privateId = "22222222-2222-4222-8222-222222222222";
const bank = { id: bankId, librarySource: "inrcy_image_bank", bucket: "inrcy-image-bank", storagePath: "catalogue/sample.jpg", url: "https://storage.test/expired-bank" };
const privateImage = { id: privateId, librarySource: "pro_media_library", bucket: "inrcy-pro-media", storagePath: "users/account/old.jpg", signed_url: "https://storage.test/expired-private" };

function builders() {
  const libraryCalls: string[] = [];
  const storageCalls: [string, string][] = [];
  return { libraryCalls, storageCalls, stubs: {
    "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => {
      libraryCalls.push(id);
      return `/api/media-library/items/${id}/content?token=test`;
    } },
    "@/lib/storageContentUrl": { buildStorageContentUrl: (bucket: string, path: string) => {
      storageCalls.push([bucket, path]);
      return `/api/storage/content?bucket=${bucket}&path=${encodeURIComponent(path)}&token=test`;
    } },
  } };
}

test("a shared image-bank UUID keeps its bank storage delivery route", async () => {
  const io = builders();
  const { refreshPublishMediaUrl } = runtimeModules(io.stubs)<PreviewModule>("lib/inrAgentMediaPreview.ts");
  for (const media of [bank, { ...bank, librarySource: undefined }, { ...bank, bucket: undefined }]) {
    const result = await refreshPublishMediaUrl(media) as Row;
    assert.equal(result.id, bankId);
    assert.match(String(result.url), /^\/api\/storage\/content\?/);
    assert.equal(result.publicUrl, result.url);
  }
  assert.deepEqual(io.libraryCalls, []);
  assert.deepEqual(io.storageCalls, Array(3).fill(["inrcy-image-bank", "catalogue/sample.jpg"]));
});

test("professional UUIDs keep account-scoped delivery even with stale or conflicting storage hints", async () => {
  const io = builders();
  const { refreshPublishMediaUrl } = runtimeModules(io.stubs)<PreviewModule>("lib/inrAgentMediaPreview.ts");
  for (const media of [privateImage, { ...privateImage, bucket: "inrcy-image-bank" },
    { ...privateImage, librarySource: "inrcy_image_bank" }, privateId, { url: privateId },
    { media_id: privateId, bucket_name: "inrcy-pro-media", storage_path: "users/account/old.jpg" }]) {
    const result = await refreshPublishMediaUrl(media) as Row;
    assert.equal(result.url, `/api/media-library/items/${privateId}/content?token=test`);
    assert.equal(result.id, privateId);
  }
  assert.deepEqual(io.storageCalls, []);
  assert.equal(io.libraryCalls.length, 6);
});

test("a bank reference without a path is not confused with a private media ID", async () => {
  const io = builders();
  const { refreshPublishMediaUrl } = runtimeModules(io.stubs)<PreviewModule>("lib/inrAgentMediaPreview.ts");
  const media = { id: bankId, librarySource: "inrcy_image_bank", url: "https://static.test/image.jpg" };
  assert.deepEqual(await refreshPublishMediaUrl(media), media);
  assert.deepEqual(io.libraryCalls, []);
  assert.deepEqual(io.storageCalls, []);
});

test("failed private signing never falls back to a public storage capability", async () => {
  const io = builders();
  const load = runtimeModules({ ...io.stubs, "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: () => null } });
  const { refreshPublishMediaUrl } = load<PreviewModule>("lib/inrAgentMediaPreview.ts");
  assert.deepEqual(await refreshPublishMediaUrl(privateImage), privateImage);
  assert.deepEqual(io.storageCalls, []);
});

test("channel, placement, and format previews are refreshed without changing content or file selection", async () => {
  const io = builders();
  const { refreshPublishPayloadMediaUrls } = runtimeModules(io.stubs)<PreviewModule>("lib/inrAgentMediaPreview.ts");
  const source = {
    title: "Texte professionnel inchangé", images: [bank], mediaAssets: [privateImage],
    imagesByChannel: { instagram: [privateImage] }, videoByChannel: { youtube: { ...privateImage, kind: "video" } },
    imagesByPlacement: { instagram: { classic: [privateImage], story: [bank] } },
    mediaFormatVariants: { version: 1, kind: "image", defaultFormat: "portrait", byFormat: { portrait: [privateImage], story: [bank] } },
    mediaFormatVariantsByChannel: { facebook: { version: 1, kind: "image", defaultFormat: "portrait", byFormat: { portrait: [bank], story: [privateImage] } } },
    postByChannel: { facebook: { text: "Brouillon conservé", image: bank } },
  };
  const before = structuredClone(source);
  const result = await refreshPublishPayloadMediaUrls(source);
  const placements = result.imagesByPlacement as Record<string, Record<string, Row[]>>;
  const formats = result.mediaFormatVariants as { byFormat: Record<string, Row[]> };
  const overrides = result.mediaFormatVariantsByChannel as Record<string, { byFormat: Record<string, Row[]> }>;
  assert.match(String(placements.instagram.classic[0].url), /^\/api\/media-library\/items\//);
  assert.match(String(placements.instagram.story[0].url), /^\/api\/storage\/content\?/);
  assert.match(String(formats.byFormat.portrait[0].url), /^\/api\/media-library\/items\//);
  assert.match(String(formats.byFormat.story[0].url), /^\/api\/storage\/content\?/);
  assert.equal(formats.byFormat.story[0].id, bankId);
  assert.match(String(overrides.facebook.byFormat.portrait[0].url), /^\/api\/storage\/content\?/);
  assert.match(String(overrides.facebook.byFormat.story[0].url), /^\/api\/media-library\/items\//);
  assert.match(String((result.mediaAssets as Row[])[0].url), /^\/api\/media-library\/items\//);
  assert.equal(result.title, source.title);
  assert.equal(((result.postByChannel as Record<string, Row>).facebook).text, "Brouillon conservé");
  assert.deepEqual(source, before);
});

test("legacy storage-only references preserve their namespace, and unknown URLs are not resigned", async () => {
  const io = builders();
  const { refreshPublishMediaUrl } = runtimeModules(io.stubs)<PreviewModule>("lib/inrAgentMediaPreview.ts");
  const result = await refreshPublishMediaUrl({ bucket_name: "inrcy-image-bank", storage_path: "catalogue/sample.jpg" }) as Row;
  assert.equal(result.bucket, "inrcy-image-bank");
  assert.deepEqual(await refreshPublishMediaUrl({ signed_url: "https://external.test/image.jpg" }), { signed_url: "https://external.test/image.jpg" });
  assert.deepEqual(io.storageCalls, [["inrcy-image-bank", "catalogue/sample.jpg"]]);
});

test("GET actions projects every preview using the authenticated account without any write", async () => {
  const path = "app/api/agent/actions/route.ts";
  const source = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const unusedImports: Record<string, unknown> = {};
  for (const node of tree.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) unusedImports[node.moduleSpecifier.text] = {};
  }
  // All mutation services are inert boundaries. The GET, projection helper and
  // private/bank address selection are the production implementations.
  delete unusedImports["@/lib/inrAgentMediaPreview"];
  const io = builders();
  const scopes: [string, unknown][] = [];
  const row = { id: "action", imageAssets: [bank], payload: { publishPayload: {
    imagesByPlacement: { instagram: { story: [privateImage] } },
    mediaFormatVariants: { version: 1, kind: "image", byFormat: { portrait: [bank] } },
  } }, created_at: "2026-01-01T00:00:00Z" };
  const query = {
    select() { return this; }, eq(key: string, value: unknown) { scopes.push([key, value]); return this; },
    order() { return this; }, gte() { return this; },
    async limit() { return { data: [row], error: null }; }, async range() { return { data: [], error: null }; },
  };
  const load = runtimeModules({ ...unusedImports, ...io.stubs,
    "next/server": { NextResponse: Response },
    "@/lib/requireUser": { requireUser: async () => ({ user: { id: "actor" }, authUserId: "actor", activeUserId: "selected-account" }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async () => "premium" },
    "@/lib/inrAgentActions": { rowToInrAgentAction: (value: unknown) => value, summarizeInrAgentActions: () => ({ total: 1 }) },
    "@/lib/inrAgentPublicationHistory": { agentPublicationHistoryWindow: () => ({ from: "2026-01-01" }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "inr_agent_actions"); return query; } } },
    "./actionPublishDraft.foundations": { asRecord: (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value : null },
  });
  const route = load<{ GET(): Promise<Response> }>(path);
  const response = await route.GET();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.actions[0].imageAssets[0].url, /^\/api\/storage\/content\?/);
  assert.match(body.actions[0].payload.publishPayload.imagesByPlacement.instagram.story[0].url, /^\/api\/media-library\/items\//);
  assert.match(body.actions[0].payload.publishPayload.mediaFormatVariants.byFormat.portrait[0].url, /^\/api\/storage\/content\?/);
  assert.deepEqual(scopes, [["user_id", "selected-account"], ["user_id", "selected-account"]]);
});
