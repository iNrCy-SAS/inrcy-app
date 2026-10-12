import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type AnyRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
function functions(file: string, names: string[], dependencies: AnyRecord = {}): AnyRecord {
  const source = read(file), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const nodes = tree.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ""));
  assert.equal(nodes.length, names.length);
  const code = nodes.map(node => node.getText(tree).replace(/^export\s+/, "")).join("\n") + `\nreturn {${names.join(",")}};`;
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
}
const channels = ["threads", "instagram"];
const names = ["asRecord", "emptyWindowCount", "emptyInrcyChannelActivityStats", "emptyInrcyActivityStatsByChannel", "inrcyActivityPayloadChannelKeys", "payloadChannelValue", "payloadChannelRecord", "normalizeInrcyActivityChannel", "normalizePayloadChannels", "payloadSucceededForChannel", "isThreadsGhostPublication", "inferPayloadMediaKindForChannel", "inferPublicationTypeForChannel", "inferPhotoCountForChannel", "incrementWindowCount"];
const shared = functions("lib/stats/buildOverview.shared.ts", names, {
  INRCY_PUBLISHABLE_CHANNELS: channels, inferExplicitMetaPlacement: () => null,
});

test("Ghost metadata outranks another channel's image/video and TEXT retries remain text", () => {
  const payload = { mediaType: "video", results: { threads: { ok: true, threads_publication_mode: "ghost", threads_media_type: "TEXT" }, instagram: { ok: true, media_type: "IMAGE" } } };
  assert.equal(shared.inferPayloadMediaKindForChannel(payload, "threads"), "none");
  assert.equal(shared.inferPublicationTypeForChannel(payload, "threads"), "ghost");
  assert.equal(shared.inferPublicationTypeForChannel(payload, "instagram"), "image");
  assert.equal(shared.inferPublicationTypeForChannel({ mediaType: "images", results: { threads: { threads_media_type: "TEXT" } } }, "threads"), "text");
  assert.equal(shared.inferPublicationTypeForChannel({ mediaType: "images", threadsPublicationSettings: { mode: "ghost" }, results: { threads: { threads_publication_mode: "classic", threads_media_type: "IMAGE" } } }, "threads"), "image");
});

test("the actual history loader counts an archived Ghost once for 12 months without fabricated media", async () => {
  const event = { created_at: new Date(Date.now() - 2 * 86400_000).toISOString(), module: "booster", type: "publish",
    payload: { channels, mediaType: "images", images: ["https://media.test/ig-image"],
      results: { threads: { ok: true, threads_publication_mode: "ghost" }, instagram: { ok: true, media_type: "IMAGE" } } } };
  const original = structuredClone(event);
  const query = { select() { return this; }, eq() { return this; }, in() { return this; }, order() { return this; }, async limit() { return { data: [event], error: null }; } };
  const loader = functions("lib/stats/buildOverview.activity.ts", ["loadInrcyPublishedActivityStats"], {
    ...shared, INRCY_PUBLISHABLE_CHANNELS: channels, INRCY_ACTIVITY_ROW_LIMIT: 5000,
    inferYoutubeVideoPublicationKind: () => null,
  }).loadInrcyPublishedActivityStats;
  const result = await loader({ supabase: { from: () => query }, userId: "own-account" });
  assert.equal(result.threads.publications.year, 1);
  assert.equal(result.threads.publicationTypes.ghost.year, 1);
  assert.equal(result.threads.photos.year, 0); assert.equal(result.threads.videos.year, 0);
  assert.equal(result.instagram.publications.year, 1); assert.equal(result.instagram.photos.year, 1);
  assert.deepEqual(event, original);
});

test("the frontend preserves Ghost typed history rather than discarding its label/count", () => {
  const metrics = functions("app/dashboard/stats/stats.shared.metrics.ts", ["normalizeInrcyActivityCount", "emptyInrcyActivityStats", "buildInrcyActivityStats"], {
    INRCY_ACTIVITY_CUBE_KEYS: new Set(channels), safeNum: (value: unknown) => Number(value) || 0,
  });
  const count = { week: 1, month: 1, year: 1, total: 1 };
  const result = metrics.buildInrcyActivityStats("threads", { inrcyActivity: { threads: { publications: count, publicationTypes: { ghost: count }, photos: {}, videos: {} } } });
  assert.equal(result.publicationTypes.ghost.year, 1); assert.equal(result.publications.year, 1);
});
