import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";

type Row = Record<string, unknown>;
const accountId = "account-a", a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
const mediaRow = (id: string, patch: Row = {}): Row => ({ id, user_id: accountId, media_type: "image", upload_status: "uploaded", publication_status: "ready", processing_status: "ready",
  client_media_key: `account:${id}.png:100:123`, storage_path: `${accountId}/${id}.png`, bucket_name: "inrcy-pro-media", original_file_name: `${id}.png`, mime_type: "image/png", size_bytes: 100, ...patch });
const asset = (id: string) => ({ id, storagePath: `${accountId}/${id}.png`, type: "image/png" });
function payload(facebookId: string) {
  return { kind: "manual_publish_schedule", mediaWorkspaceId: "snapshot-A", scheduledMediaSnapshot: true, publishPayload: { source: "booster_scheduled", mediaWorkspaceId: "snapshot-A", scheduledMediaSnapshot: true,
    channels: ["facebook", "instagram"], images: [asset(a)], imagesByChannel: { facebook: [asset(facebookId)], instagram: [asset(a)] }, mediaModeByChannel: { facebook: "images", instagram: "images" },
    imageSettingsByChannel: { facebook: { imageKeys: [`${a}.png__100__123`], format: "square" }, instagram: { imageKeys: [`${a}.png__100__123`], format: "portrait" } } } };
}
function harness(options: { foreign?: boolean; incomplete?: boolean; linkFailure?: boolean } = {}) {
  const workspaces: Row[] = [{ id: "snapshot-A", account_id: accountId, status: "scheduled", revision: 1 }];
  const media = [mediaRow(a), mediaRow(b, options.foreign ? { user_id: "other" } : options.incomplete ? { upload_status: "uploading" } : {})];
  const links: Row[] = [{ workspace_id: "snapshot-A", media_id: a, position: 0 }];
  const removed: string[] = [];
  const admin = { from(table: string) {
    let operation = "read", patch: Row | Row[] = {}, single = false;
    const filters: Row = {};
    const result = () => {
      const data: Row[] = table === "publication_workspaces" ? workspaces : table === "publication_workspace_media" ? links : table === "pro_media_library" ? media : table === "media_variants" ? media.map(item => ({ media_id: item.id, account_id: accountId, status: "ready", variant_kind: "canonical", purpose: "canonical", bucket_name: item.bucket_name, storage_path: item.storage_path, mime_type: "image/png", size_bytes: 100, width: 100, height: 100 })) : [];
      if (table === "pro_media_library") assert.equal(filters.user_id, accountId);
      if (operation === "insert") {
        if (table === "publication_workspace_media" && options.linkFailure) return { data: null, error: { message: "link_failed" } };
        if (table === "publication_workspaces") {
          const row = { ...patch, id: "snapshot-B" }; workspaces.push(row); return { data: row, error: null };
        }
        data.push(...(Array.isArray(patch) ? patch : [patch])); return { data: null, error: null };
      }
      if (operation === "delete") { assert.equal(filters.account_id, accountId); removed.push(String(filters.id)); return { data: null, error: null }; }
      const matching = data.filter(item => Object.entries(filters).every(([key, value]) => key.startsWith("pro_media_library.") ? true : Array.isArray(value) ? value.includes(item[key]) : item[key] === value));
      const found = table === "publication_workspace_media" ? matching.map(item => ({ ...item, pro_media_library: media.find(media => media.id === item.media_id) })) : matching;
      return { data: single ? found[0] || null : found, error: null };
    };
    const query = { select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; }, in(key: string, value: unknown) { filters[key] = value; return this; }, order() { return this; },
      insert(value: Row | Row[]) { operation = "insert"; patch = value; return this; }, delete() { operation = "delete"; return this; }, async maybeSingle() { single = true; return result(); }, async single() { single = true; return result(); }, then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(resolve(result())); } };
    return query;
  } };
  const load = runtimeModules({ "@/lib/supabaseAdmin": { supabaseAdmin: admin }, "@/lib/mediaPipelineUnifiedConsumptionPolicy": { isUnifiedMediaConsumptionEnabled: () => true },
    "@/lib/storageContentUrl": { buildAbsoluteStorageContentUrl: (bucket: string, path: string, requestUrl: string) => new URL(`/api/storage/content?${new URLSearchParams({ bucket, path, token: "fixture-token" })}`, requestUrl).toString() } });
  return { workspaces, links, removed,
    media,
    helper: load<typeof import("../../lib/scheduledPublicationMediaRevision.ts")>("lib/scheduledPublicationMediaRevision.ts"),
    consumption: load<typeof import("../../lib/mediaWorkspaceConsumption.ts")>("lib/mediaWorkspaceConsumption.ts"),
    worker: load<typeof import("../../lib/inrAgentScheduledPublication.ts")>("lib/inrAgentScheduledPublication.ts"),
  };
}
const params = () => ({ accountId, actorAuthUserId: "actor", scheduledActionId: "scheduled-manual", scheduledAt: "2099-11-04T12:00:00Z", previousPayload: payload(a), payload: payload(b), channels: ["facebook", "instagram"], requestUrl: "https://fixture.invalid/api/agent/scheduled-actions/scheduled-manual" });

test("editing A→B builds a new durable graph; the real worker resolves B for Facebook and keeps A for Instagram", async () => {
  const h = harness(), revision = await h.helper.createScheduledPublicationMediaRevision(params());
  assert.equal(revision.workspaceId, "snapshot-B");
  assert.equal(h.links.filter(link => link.workspace_id === "snapshot-A")[0].media_id, a, "old snapshot is immutable");
  assert.deepEqual(h.links.filter(link => link.workspace_id === "snapshot-B").map(link => [link.media_id, link.selected_channels]), [[b, ["facebook"]], [a, ["instagram"]]]);
  const request = h.worker.buildScheduledPublicationRequest({ id: "scheduled-manual", channels: ["facebook", "instagram"], payload: revision.payload }); assert.ok(request);
  assert.equal(request.body.mediaWorkspaceId, "snapshot-B");
  const resolved = await h.consumption.resolveWorkspacePublicationConsumption({ accountId, workspaceId: String(request.body.mediaWorkspaceId), purpose: "publish" });
  assert.equal(resolved.images.length, 2);
  const settings = request.body.imageSettingsByChannel as Record<string, { imageKeys: string[]; format: string }>;
  const sourceFor = (channel: string) => resolved.images.filter(item => settings[channel].imageKeys.includes(item.imageKey)).map(item => item.mediaId);
  assert.deepEqual(sourceFor("facebook"), [b]); assert.deepEqual(sourceFor("instagram"), [a]);
  assert.equal(settings.instagram.format, "portrait"); assert.equal(settings.facebook.format, "square");
  assert.equal((request.body.imagesByChannel as Record<string, Array<{ id: string }>>).facebook[0].id, b);
  assert.deepEqual(h.removed, [], "a successful CAS can retain this graph");
  await revision.discard(); assert.deepEqual(h.removed, ["snapshot-B"], "the caller can clean up after CAS conflict without touching A");
});

test("foreign or incomplete replacement sources fail before a graph can be published", async () => {
  for (const options of [{ foreign: true }, { incomplete: true }]) {
    const h = harness(options);
    await assert.rejects(h.helper.createScheduledPublicationMediaRevision(params()), /source durable/);
    assert.equal(h.workspaces.length, 1); assert.deepEqual(h.removed, []);
  }
});

test("a partial graph write is discarded and never changes the existing schedule snapshot", async () => {
  const h = harness({ linkFailure: true });
  await assert.rejects(h.helper.createScheduledPublicationMediaRevision(params()));
  assert.deepEqual(h.removed, ["snapshot-B"]); assert.equal(h.links.length, 1); assert.equal(h.links[0].media_id, a);
});

test("workspace-only schedules retain untouched channel sources, while empty serialization wrappers are not a media edit", async () => {
  const h = harness();
  const original = { ...payload(a), publishPayload: { ...payload(a).publishPayload, images: [], imagesByChannel: {} } };
  assert.equal(h.helper.scheduledPublicationMediaChanged(original, { ...original, imagesByChannel: {}, videoByChannel: {}, publishPayload: { ...original.publishPayload, videoByChannel: {}, video: null, postByChannel: { facebook: { content: "Nouveau texte uniquement" } } } }), false);
  const edited = { ...original, publishPayload: { ...original.publishPayload, imagesByChannel: { facebook: [asset(b)] } } };
  const revision = await h.helper.createScheduledPublicationMediaRevision({ ...params(), previousPayload: original, payload: edited });
  const publish = revision.payload.publishPayload as Record<string, unknown>;
  const byChannel = publish.imagesByChannel as Record<string, Array<{ id: string }>>;
  assert.equal(byChannel.facebook[0].id, b); assert.equal(byChannel.instagram[0].id, a);
  assert.match(String((byChannel.instagram[0] as unknown as Row).url), /^https:\/\/fixture\.invalid\/api\/storage\/content\?/);
});

test("workspace-only fallback preserves the exact ordered imageKeys subset instead of assigning the entire shared pool", async () => {
  const h = harness();
  const c = "33333333-3333-4333-8333-333333333333";
  h.media.push(mediaRow(c));
  h.links.push({ workspace_id: "snapshot-A", media_id: c, position: 1, selected_channels: ["facebook", "instagram"] });
  const original = { ...payload(a), publishPayload: { ...payload(a).publishPayload, images: [], imagesByChannel: {}, imageSettingsByChannel: { facebook: { imageKeys: [`${a}.png__100__123`] }, instagram: { imageKeys: [`${c}.png__100__123`] } } } };
  const revision = await h.helper.createScheduledPublicationMediaRevision({ ...params(), previousPayload: original,
    payload: { ...original, publishPayload: { ...original.publishPayload, imagesByChannel: { facebook: [asset(b)] } } } });
  const byChannel = (revision.payload.publishPayload as Row).imagesByChannel as Record<string, Array<{ id: string }>>;
  assert.deepEqual(byChannel.facebook.map(item => item.id), [b]);
  assert.deepEqual(byChannel.instagram.map(item => item.id), [c]);
  assert.equal(h.links.filter(item => item.workspace_id === "snapshot-B").some(item => item.media_id === a), false);
});
