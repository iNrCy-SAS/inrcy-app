import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { applyInrAgentThreadsPublicationSettings, readInrAgentThreadsPublicationSettings, projectInrAgentThreadsPublishPayload } from "../../lib/inrAgentThreadsPublication.ts";
import { buildScheduledPublicationRequest } from "../../lib/inrAgentScheduledPublication.ts";
import { filterInrAgentPublicationChannels } from "../../lib/inrAgentPublicationChannelSelection.ts";
import { parseThreadsPublicationSettings, normalizeThreadsPublicationPreferences, normalizeThreadsPublicationMode, isThreadsPublicationModeEnabled, getThreadsPublicationModeFailure } from "../../lib/threadsPublicationPreferences.ts";

// Runtime harnesses substitute unrelated DB/Meta fields with minimal fixtures.
type RecordLike = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const asRecord = (value: unknown): RecordLike => value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : {};
function runtime(code: string, dependencies: RecordLike) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
}
function functionRuntime(file: string, name: string, dependencies: RecordLike) {
  const source = read(file), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);
  return runtime(`${node.getText(tree).replace(/^export\s+/, "")}; return ${name};`, dependencies);
}

test("historical actions stay Classic and an explicit Ghost choice survives disabled preferences", () => {
  assert.deepEqual(readInrAgentThreadsPublicationSettings({}), { mode: "classic" });
  const newDefault = normalizeThreadsPublicationPreferences({ ghostEnabled: true, defaultMode: "ghost" });
  assert.equal(newDefault.defaultMode, "ghost");
  assert.equal(readInrAgentThreadsPublicationSettings({ publishPayload: {} }).mode, "classic");
  const original = { publishPayload: { channels: ["threads", "instagram"] }, images: [{ id: "retained-image" }] };
  const ghost = applyInrAgentThreadsPublicationSettings(original, "ghost");
  assert.deepEqual(ghost.threadsPublicationSettings, { mode: "ghost" });
  assert.deepEqual(asRecord(ghost.publishPayload).threadsPublicationSettings, { mode: "ghost" });
  assert.equal(isThreadsPublicationModeEnabled(readInrAgentThreadsPublicationSettings(ghost).mode, normalizeThreadsPublicationPreferences({ ghostEnabled: false })), false);
  assert.deepEqual(ghost.images, original.images);
  assert.equal(Object.hasOwn(original, "threadsPublicationSettings"), false);
});

test("Ghost outgoing media are disabled only for Threads; scheduled workers retain mode", () => {
  const input = { channels: ["threads", "instagram"], threadsPublicationSettings: { mode: "ghost" },
    images: [{ id: "shared-image" }], video: { id: "shared-video" },
    mediaModeByChannel: { threads: "video", instagram: "images" },
    imagesByChannel: { threads: [{ id: "thread-image" }], instagram: [{ id: "ig-image" }] },
    videoByChannel: { threads: { id: "thread-video" }, instagram: { id: "ig-video" } } };
  const projected = projectInrAgentThreadsPublishPayload(input);
  assert.equal(projected.mediaModeByChannel.threads, "none");
  assert.equal(projected.mediaModeByChannel.instagram, "images");
  assert.equal(Object.hasOwn(projected.imagesByChannel, "threads"), false);
  assert.deepEqual(projected.imagesByChannel.instagram, input.imagesByChannel.instagram);
  assert.deepEqual(projected.images, input.images);
  assert.deepEqual(projected.video, input.video);
  assert.equal(input.mediaModeByChannel.threads, "video");
  const request = buildScheduledPublicationRequest({ id: "schedule", channels: input.channels, payload: { publishPayload: projected } });
  assert.deepEqual(request?.body.threadsPublicationSettings, { mode: "ghost" });
  assert.equal(asRecord(request?.body.mediaModeByChannel).threads, "none");
  const restored = applyInrAgentThreadsPublicationSettings({ publishPayload: projected }, "classic");
  assert.equal(Object.hasOwn(asRecord(asRecord(restored.publishPayload).mediaModeByChannel), "threads"), false);
  assert.deepEqual(asRecord(restored.publishPayload).images, input.images);
  const removed = projectInrAgentThreadsPublishPayload({ ...projected, channels: ["instagram"] });
  assert.equal(Object.hasOwn(removed, "threadsPublicationSettings"), false);
});

test("Agent Ghost preview never falls back to shared images while Instagram keeps them", () => {
  const getRecords = functionRuntime("app/dashboard/agent/_lib/agent.publish-preview.ts", "getPublishMediaRecords", {
    readInrAgentThreadsPublicationSettings,
    publishChannelMediaMode: () => "images", publishChannelImages: () => [{ id: "image" }], publishChannelVideo: () => null,
  }) as (action: RecordLike, channel: string) => unknown[];
  const action = { payload: { threadsPublicationSettings: { mode: "ghost" } } };
  assert.deepEqual(getRecords(action, "threads"), []);
  assert.deepEqual(getRecords(action, "instagram"), [{ id: "image" }]);
});

test("editing a scheduled action keeps an explicit Ghost choice and projects its media before dispatch", () => {
  const update = functionRuntime("app/dashboard/agent/_lib/agent.schedule.ts", "scheduledEditUpdateFromAction", {
    asRecord, jsonClone: structuredClone, filterInrAgentPublicationChannels,
    normalizeUiChannelKey: (key: string) => key,
    canonicalizeRecordForBoosterChannels: (map: RecordLike) => map,
    filterRecordForScheduledChannels: (value: unknown) => asRecord(value),
    firstSafeString: (...values: unknown[]) => values.find(value => typeof value === "string" && value) || "",
    compactInrAgentScheduledPayload: (value: unknown) => value,
    projectInrAgentThreadsPublishPayload, readInrAgentThreadsPublicationSettings,
  }) as (action: RecordLike, options: RecordLike) => RecordLike;
  const action = { id: "action", automationKey: "publish", payload: {
    threadsPublicationSettings: { mode: "ghost" },
    publishPayload: { threadsPublicationSettings: { mode: "classic" } },
    images: [{ id: "shared-image" }], mediaModeByChannel: { threads: "images", instagram: "images" },
    imagesByChannel: { threads: [{ id: "thread-image" }], instagram: [{ id: "ig-image" }] },
    postByChannel: { threads: { content: "Ghost" }, instagram: { content: "Instagram" } },
  }};
  const output = update(action, { channels: ["threads", "instagram"] });
  assert.deepEqual(output.payload.publishPayload.threadsPublicationSettings, { mode: "ghost" });
  assert.equal(output.payload.publishPayload.mediaModeByChannel.threads, "none");
  assert.deepEqual(output.payload.publishPayload.imagesByChannel.instagram, [{ id: "ig-image" }]);
  assert.equal(Object.hasOwn(output.payload.publishPayload.imagesByChannel, "threads"), false);
  assert.deepEqual(output.payload.images, action.payload.images);
});

function actionModeHarness({ enabled = true, ghostEnabled = true, account = "admin-account", channels = ["threads"], concurrentChange = "", hasUpdatedAt = true } = {}) {
  const source = read("app/api/agent/actions/route.ts"), tree = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  let branch: ts.IfStatement | undefined;
  function visit(node: ts.Node) { if (ts.isIfStatement(node) && node.expression.getText(tree) === 'editType === "publish_threads_mode"') branch = node; ts.forEachChild(node, visit); }
  visit(tree); assert.ok(branch);
  const reads: RecordLike[] = [], writes: RecordLike[] = [];
  const row = { id: "action", automationKey: "publish", actionType: "publication", targetTool: "booster", status: "pending_validation", targetChannels: channels, updated_at: hasUpdatedAt ? "2026-10-12T14:00:00Z" : null, payload: { selectedChannels: channels, images: [{ id: "retained" }] } };
  const liveRow: RecordLike = structuredClone(row);
  const admin = { from(table: string) {
    const filters: RecordLike = {}; let update: RecordLike | null = null;
    const query = { select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; },
      update(value: RecordLike) { update = value; return this; },
      async single() { assert.equal(filters.user_id, account); assert.equal(filters.id, "action");
        if (update) { writes.push(update); return { data: { ...row, payload: update.payload }, error: null }; }
        reads.push({ table, filters }); return { data: row, error: null }; },
      async maybeSingle() {
        assert.equal(filters.user_id, account);
        if (table === "inr_agent_actions") {
          assert.equal(filters.id, "action"); assert.equal(filters.status, row.status);
          const sameVersion = hasUpdatedAt ? filters.updated_at === liveRow.updated_at : filters.payload === JSON.stringify(liveRow.payload);
          if (filters.status !== liveRow.status || !sameVersion) return { data: null, error: null };
          writes.push(update!); return { data: { ...liveRow, ...update }, error: null };
        }
        reads.push({ table, filters });
        if (concurrentChange === "claim") { liveRow.status = "executing"; liveRow.updated_at = "2026-10-12T14:00:01Z"; }
        if (concurrentChange === "edit") { liveRow.payload = { ...liveRow.payload, idea: "Concurrent edit" }; if (hasUpdatedAt) liveRow.updated_at = "2026-10-12T14:00:01Z"; }
        return { data: { settings: { threads: { publicationPreferences: { ghostEnabled } } } }, error: null };
      },
    }; return query;
  }};
  const run = runtime(`return async function(requestBody){const editType="publish_threads_mode",actionId="action",activeUserId=${JSON.stringify(account)};${branch.getText(tree)}}`, {
    asRecord, supabaseAdmin: admin, ACTION_SELECT: "fixture", rowToInrAgentAction: (value: unknown) => value,
    isMetaChannelPilotEnabledForActorAndAccount: async () => enabled,
    metaChannelPilotDeniedResponse: () => ({ status: 403 }),
    NextResponse: { json: (body: unknown, init: RecordLike = {}) => ({ body, status: init.status || 200 }) },
    normalizePublishChannels: (values: unknown[]) => Array.from(new Set(values)), normalizeThreadsPublicationMode, normalizeThreadsPublicationPreferences,
    isThreadsPublicationModeEnabled, applyInrAgentThreadsPublicationSettings, refreshActionImageUrls: async (value: unknown) => value,
  }) as (body: RecordLike) => Promise<RecordLike>;
  return { run, reads, writes, liveRow };
}

test("format mutation denies USER before a DB read and denies disabled Ghost before save", async () => {
  const user = actionModeHarness({ enabled: false });
  assert.equal((await user.run({ channel: "threads", mode: "ghost" })).status, 403);
  assert.deepEqual(user.reads, []); assert.deepEqual(user.writes, []);
  const disabled = actionModeHarness({ ghostEnabled: false });
  assert.equal((await disabled.run({ channel: "threads", mode: "ghost" })).status, 409);
  assert.deepEqual(disabled.writes, []);
  const absent = actionModeHarness({ channels: ["instagram"] });
  assert.equal((await absent.run({ channel: "threads", mode: "ghost" })).status, 409);
  assert.equal(absent.reads.length, 1); assert.deepEqual(absent.writes, []);
  const admin = actionModeHarness();
  assert.equal((await admin.run({ channel: "threads", mode: "ghost" })).status, 200);
  assert.deepEqual(admin.writes[0].payload.threadsPublicationSettings, { mode: "ghost" });
  assert.deepEqual(admin.writes[0].payload.images, [{ id: "retained" }]);
});

test("format mutation cannot overwrite a concurrent execution claim or another edit", async () => {
  for (const concurrentChange of ["claim", "edit"]) {
    const h = actionModeHarness({ concurrentChange });
    const response = await h.run({ channel: "threads", mode: "ghost" });
    assert.equal(response.status, 409); assert.equal(response.body.code, "INR_AGENT_PUBLICATION_CHANGED");
    assert.deepEqual(h.writes, []);
    assert.equal(Object.hasOwn(h.liveRow.payload, "threadsPublicationSettings"), false);
    if (concurrentChange === "claim") assert.equal(h.liveRow.status, "executing");
    else assert.equal(h.liveRow.payload.idea, "Concurrent edit");
  }
  const noTimestamp = actionModeHarness({ concurrentChange: "edit", hasUpdatedAt: false });
  assert.equal((await noTimestamp.run({ channel: "threads", mode: "ghost" })).status, 409);
  assert.deepEqual(noTimestamp.writes, []);
});

test("iNrSend Ghost retry checks current preferences before Graph and preserves mode metadata", async () => {
  const source = read("lib/inrsend/publicationChannelActions.ts"), start = source.indexOf('  if (channel === "threads") {', source.indexOf("async function replaceChannelDelivery"));
  assert.ok(start > 0);
  const code = source.slice(start, source.indexOf("\n  const [fbRow", start));
  let ghostEnabled = true, gate = true;
  const graph: RecordLike[] = [], saved: RecordLike[] = [];
  const deps = { asRecord, parseThreadsPublicationSettings, getThreadsPublicationModeFailure,
    loadThreadsPublicationPreferences: async () => normalizeThreadsPublicationPreferences({ ghostEnabled }),
    isMetaChannelPilotEnabledForAccount: async () => gate, supabaseAdmin: {},
    getLatestIntegrationRow: async () => ({ resource_id: "own-resource" }), ensureMetaDirectAccessToken: async () => "fixture-token",
    markAssetsMayBeInUse() {}, buildBoosterThreadsPostText: () => "Texte Ghost", THREADS_EDIT_UNSUPPORTED_MESSAGE: "No edit",
    threadsPublish: async (args: RecordLike) => { graph.push(args); const checkpoint = { publicationMode: args.publicationMode, containerId: "container", state: "published" }; await args.onCheckpoint(checkpoint); return { ok: true, publicationMode: args.publicationMode, postId: "post", mediaType: "TEXT", checkpoint }; },
    persistEventPayload: async (_user: string, _publication: string, payload: RecordLike) => { saved.push(structuredClone(payload)); },
  };
  const run = runtime(`return async function(eventPayload){const channel="threads",previousExternalId=null,userId="admin-account",publicationId="parent",nextPost={},websiteUrl="",phone="",isVideoPublication=true,videoUrl="https://media.test/video",video={},socialFeedImageUrls=["https://media.test/image"];${code}}`, deps) as (payload: RecordLike) => Promise<RecordLike>;
  ghostEnabled = false;
  await assert.rejects(run({ threadsPublicationSettings: { mode: "ghost" } }), /désactivé/);
  assert.deepEqual(graph, []);
  ghostEnabled = true; gate = false;
  await assert.rejects(run({ threadsPublicationSettings: { mode: "ghost" } }), /ADMIN/);
  assert.deepEqual(graph, []);
  gate = true;
  const result = await run({ threadsPublicationSettings: { mode: "ghost" } });
  const published = (graph as RecordLike[])[0];
  assert.equal(published.publicationMode, "ghost"); assert.deepEqual(published.media, []);
  assert.equal(result.threadsMeta.threads_publication_mode, "ghost");
  assert.equal(result.threadsMeta.is_ghost_post, true);
  assert.equal(saved[0].results.threads.threads_publication_mode, "ghost");
  assert.equal(Object.hasOwn(result.threadsMeta, "expires_at"), false);
});
