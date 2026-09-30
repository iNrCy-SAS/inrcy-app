import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../../app/api/agent/actions/regenerate-channel/route.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
const names = ["currentPublicationImageCount", "regeneratedMediaIdea", "generatedItemToAgentMedia", "setChannelsValue"];
const helpers = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(parsed)).join("\n");
assert.equal(names.filter((name) => helpers.includes(`function ${name}(`)).length, names.length);
const body = source.slice(source.indexOf("  const mediaModeByChannel"), source.lastIndexOf("}"));
const compiled = ts.transpileModule(`
${helpers}
return async function run(action) {
  const payload = action.payload, nested = asRecord(payload.publishPayload) || {};
  const postByChannel = payload.postByChannel || nested.postByChannel || {};
  const channel = "facebook", actionChannels = ["facebook", "instagram"];
  const actionId = action.id, activeUserId = "active-account", authUserId = "signed-in-user", theme = "conseils";
  const supabase = {};
  ${body}
};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

const image = (id) => ({ id, kind: "image", media_type: "image", storagePath: `images/${id}`, url: `https://media.test/${id}` });
function action(images = [image("old-1"), image("old-2"), image("old-3")]) {
  return { id: "action-1", updatedAt: "2026-09-30T10:00:00Z", summary: "Conseil local vérifié", previewText: "Texte original", imageAssets: images,
    payload: { idea: "Expliquer les étapes d’un projet", images, mediaAssets: images,
      postByChannel: { facebook: { content: "Texte Facebook" }, instagram: { content: "Texte Instagram" } },
      imagesByChannel: { facebook: images, instagram: images }, mediaModeByChannel: { facebook: "images", instagram: "images" },
      scheduledFor: "2026-10-08T09:00:00Z" } };
}

function harness({ failAt = 0, duplicate = false, wrongKind = false, wrongDuration = false, studioPreferences = null } = {}) {
  const calls = [], writes = [];
  const dependencies = {
    createHash,
    asRecord: (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null,
    cleanText: (value, limit = 500) => String(value || "").trim().slice(0, limit),
    cleanPublishMedia: (value) => value && typeof value === "object" && (value.url || value.storagePath)
      ? { ...value, kind: value.kind || value.mediaType || value.media_type, duration: value.duration || value.duration_seconds } : null,
    readPublishChannelValue: (map, channel) => map[channel],
    readPublishPost: (map, channel) => map[channel] || {},
    INR_AGENT_IMAGES_PER_PUBLICATION: 1,
    INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT: 5,
    NextResponse: { json: (body, options = {}) => ({ body, status: options.status || 200 }) },
    supabaseAdmin: {},
    isAdminUserForAi: async () => false,
    loadInrAgentStudioMediaPreferences: async () => studioPreferences,
    buildMediaLibraryContentUrl: (id) => `https://media.test/${id}`,
    buildPublishMediaReadiness: () => ({ ready: true }),
    buildPublishMediaAdaptation: () => ({}),
    generateInrAgentMedia: async (args) => {
      calls.push(args);
      if (calls.length === failAt) return { item: null, kind: args.kind, outcome: "quota_reached" };
      return { outcome: "generated", kind: args.kind, item: {
        id: duplicate ? "same" : `new-${calls.length}`, bucket_name: "media", storage_path: `new/${calls.length}`,
        media_type: wrongKind ? "video" : args.kind,
        duration_seconds: wrongDuration ? 24 : args.videoDurationSeconds || 16,
      } };
    },
    persistAction: async (args) => { writes.push(args); return args; },
  };
  const run = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { run, calls, writes };
}

test("régénérer un carrousel crée trois parties différentes et remplace tous les canaux ensemble", async () => {
  const h = harness(), original = action();
  const response = await h.run(original);
  assert.equal(response.status, 200);
  assert.equal(h.calls.length, 3);
  assert.equal(new Set(h.calls.map((call) => call.idea)).size, 3);
  assert.equal(new Set(h.calls.map((call) => call.generationRequestId)).size, 3);
  assert.ok(h.calls.every((call) => call.accountId === "active-account" && call.kind === "image"));
  assert.equal(h.writes.length, 1);
  const saved = h.writes[0];
  assert.equal(saved.imageAssets.length, 3);
  assert.equal(saved.payload.imagesByChannel.facebook.length, 3);
  assert.deepEqual(saved.payload.imagesByChannel.facebook, saved.payload.imagesByChannel.instagram);
  assert.equal(saved.payload.postByChannel.facebook.content, "Texte Facebook");
  assert.equal(saved.previewText, original.previewText);
  assert.equal(saved.payload.scheduledFor, original.payload.scheduledFor);
  assert.equal(original.imageAssets[0].id, "old-1");
});

test("quota ou série incomplète conservent les originaux et les identifiants de reprise", async () => {
  for (const failAt of [1, 2, 3]) {
    const h = harness({ failAt }), original = action();
    const snapshot = structuredClone(original);
    const response = await h.run(original);
    assert.equal(response.status, 429);
    assert.equal(h.calls.length, failAt);
    assert.equal(h.writes.length, 0);
    assert.deepEqual(original, snapshot);
    const retry = harness();
    await retry.run(original);
    assert.deepEqual(retry.calls.slice(0, failAt).map((call) => call.generationRequestId), h.calls.map((call) => call.generationRequestId));
    assert.deepEqual(retry.calls.slice(0, failAt).map((call) => call.variantSeed), h.calls.map((call) => call.variantSeed));
  }
  for (const options of [{ duplicate: true }, { wrongKind: true }]) {
    const h = harness(options);
    assert.equal((await h.run(action())).status, 503);
    assert.equal(h.writes.length, 0);
  }
});

test("une nouvelle régénération après remplacement utilise une nouvelle révision sans réduire la série", async () => {
  const original = action(), first = harness(), next = harness();
  await first.run(original);
  await next.run({ ...original, updatedAt: "2026-09-30T10:05:00Z" });
  assert.equal(first.calls.length, 3);
  assert.equal(next.calls.length, 3);
  assert.notEqual(first.calls[0].generationRequestId, next.calls[0].generationRequestId);
  const single = harness();
  await single.run(action([image("single")]));
  assert.equal(single.calls.length, 1);
  const excessive = harness();
  assert.equal((await excessive.run(action(Array.from({ length: 6 }, (_, index) => image(String(index)))))).status, 409);
  assert.equal(excessive.calls.length, 0);
});

test("un changement Studio après échec partiel crée une nouvelle intention, une reprise identique conserve les clés", async () => {
  const original = action();
  const studioPreferences = { blocks: { 3: { saved: true, defaults: { visualStyle: "premium", creativity: "balanced" } } } };
  const first = harness({ failAt: 2, studioPreferences });
  assert.equal((await first.run(original)).status, 429);
  assert.equal(first.writes.length, 0);

  const retry = harness({ studioPreferences: structuredClone(studioPreferences) });
  assert.equal((await retry.run(original)).status, 200);
  for (let index = 0; index < first.calls.length; index += 1) {
    assert.equal(retry.calls[index].generationRequestId, first.calls[index].generationRequestId);
    assert.equal(retry.calls[index].variantSeed, first.calls[index].variantSeed);
  }

  const changedPreferences = structuredClone(studioPreferences);
  changedPreferences.blocks[3].defaults.visualStyle = "editorial";
  const changed = harness({ studioPreferences: changedPreferences });
  assert.equal((await changed.run(original)).status, 200);
  assert.equal(changed.calls.length, 3);
  for (let index = 0; index < first.calls.length; index += 1) {
    assert.notEqual(changed.calls[index].generationRequestId, first.calls[index].generationRequestId);
    assert.notEqual(changed.calls[index].variantSeed, first.calls[index].variantSeed);
    assert.deepEqual(changed.calls[index].studioPreferences, changedPreferences);
  }
  assert.equal(original.updatedAt, "2026-09-30T10:00:00Z");
});

test("la vidéo courte reste à huit secondes et une sortie incompatible ne remplace rien", async () => {
  const original = action([]);
  original.payload.mediaType = "video";
  original.payload.video = { id: "clip", kind: "video", url: "https://media.test/clip", duration: 8 };
  original.payload.mediaModeByChannel = { facebook: "video", instagram: "video" };
  for (const wrongDuration of [false, true]) {
    const h = harness({ wrongDuration });
    assert.equal((await h.run(original)).status, wrongDuration ? 503 : 200);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].videoDurationSeconds, 8);
    assert.equal(h.writes.length, wrongDuration ? 0 : 1);
  }
});
