import assert from "node:assert/strict";
import * as actionClauses from "../../lib/inrAssistantActionClause.ts";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as channelPolicy from "../../lib/boosterPublicationPolicy.ts";
import * as channelRules from "../../lib/boosterChannelRules.ts";
import * as outcomes from "../../lib/boosterPublicationOutcome.ts";
import type * as PublicationTools from "../../lib/inrAssistantPublicationTools.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001", FOREIGN = "10000000-0000-4000-8000-000000000002";
const DRAFT = "20000000-0000-4000-8000-000000000001", FOREIGN_DRAFT = "20000000-0000-4000-8000-000000000002";
const PUBLICATION = "30000000-0000-4000-8000-000000000001", FOREIGN_PUBLICATION = "30000000-0000-4000-8000-000000000002";
const IMAGE = "40000000-0000-4000-8000-000000000001", VIDEO = "40000000-0000-4000-8000-000000000002", FOREIGN_MEDIA = "40000000-0000-4000-8000-000000000003";
const NOW = Date.parse("2026-10-26T12:00:00Z");
class FixedDate extends Date { constructor(value?: string | number) { super(value ?? NOW); } static now() { return NOW; } }
type Row = Record<string, unknown>;
type TestTool = { execute(input: unknown): Promise<PublicationTools.InrAssistantPublicationResult>; inputSchema: { schema: Row } };
type Call = { action: string; request?: Request; body?: Row; channel?: string };
type Query = { table: string; select: string; filters: Array<[string, string, unknown]> };
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const post = { channel: "facebook", title: "Notre atelier", content: "Découvrez nos réalisations locales.", cta: null, hashtags: ["#atelier"] };
const storedPayload = (channels = ["facebook"]): Row => ({ status: "draft", title: "Notre atelier", channels,
  postByChannel: Object.fromEntries(channels.map((channel) => [channel, { title: post.title, content: post.content, cta: "", hashtags: post.hashtags }])),
  assistantMediaIds: [], imageDrafts: [], videoDraft: null });

function harness(options: {
  message?: string; inactive?: boolean; wrongScope?: boolean; drafts?: boolean; disconnected?: boolean;
  throwPublish?: boolean; throwEdit?: boolean; rejectEdit?: boolean; failDb?: string;
  payload?: Row; mediaRows?: Row[]; status?: Row; deadlineAfterConnection?: boolean;
  statusReadOnly?: boolean;
  rejectScheduleNumber?: number;
  workspace?: Row;
  publishResult?: Row;
} = {}) {
  const calls: Call[] = [], queries: Query[] = [], minted: string[] = [], observed: PublicationTools.InrAssistantPublicationResult[] = [];
  const tables: Record<string, Row[]> = {
    app_events: [
      ...(options.drafts === false ? [] : [{ id: DRAFT, user_id: ACCOUNT, module: "booster", type: "publish_draft", payload: options.payload ?? storedPayload() }]),
      { id: FOREIGN_DRAFT, user_id: FOREIGN, module: "booster", type: "publish_draft", payload: { ...storedPayload(), title: "FOREIGN DRAFT" } },
      { id: "event-own", user_id: ACCOUNT, module: "booster", type: "publish", payload: { publication_id: PUBLICATION, ...storedPayload(), results: { facebook: { ok: true } } } },
    ],
    publications: [{ id: PUBLICATION, user_id: ACCOUNT, title: post.title, content: post.content, hashtags: post.hashtags },
      { id: FOREIGN_PUBLICATION, user_id: FOREIGN, title: "FOREIGN", content: "PRIVATE" }],
    pro_media_library: options.mediaRows ?? [
      { id: IMAGE, user_id: ACCOUNT, is_active: true, source: "mediatheque", bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/image.jpg`, media_type: "image", mime_type: "image/jpeg", size_bytes: 1_000, title: "Image" },
      { id: VIDEO, user_id: ACCOUNT, is_active: true, source: "mediatheque", bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/video.mp4`, media_type: "video", mime_type: "video/mp4", size_bytes: 1_000, duration_seconds: 10, title: "Vidéo" },
      { id: FOREIGN_MEDIA, user_id: FOREIGN, is_active: true, source: "mediatheque", bucket_name: "inrcy-pro-media", storage_path: `users/${FOREIGN}/image.jpg`, media_type: "image", mime_type: "image/jpeg" },
    ],
    publication_workspaces: options.workspace ? [options.workspace] : [],
  };
  const scheduled = new Map<string, Row>();
  let deadlineAllowed = true;
  const supabase = { from(table: string) {
    const query: Query = { table, select: "", filters: [] }; queries.push(query);
    let maximum = 100;
    const resolve = () => {
      if (options.failDb === table) return { data: null, error: { message: "PRIVATE DATABASE password=secret" } };
      const data = (tables[table] ?? []).filter((value) => query.filters.every(([operation, key, expected]) => {
        if (operation === "eq") return value[key] === expected;
        if (operation === "neq") return value[key] !== expected;
        if (operation === "in") return (expected as unknown[]).includes(value[key]);
        return Object.entries(expected as Row).every(([field, item]) => record(value[key])[field] === item);
      })).slice(0, maximum);
      return { data, error: null };
    };
    const builder = {
      select(value: string) { query.select = value; return builder; },
      eq(key: string, value: unknown) { query.filters.push(["eq", key, value]); return builder; },
      neq(key: string, value: unknown) { query.filters.push(["neq", key, value]); return builder; },
      in(key: string, value: unknown) { query.filters.push(["in", key, value]); return builder; },
      contains(key: string, value: unknown) { query.filters.push(["contains", key, value]); return builder; },
      limit(value: number) { maximum = value; return builder; }, order() { return builder; },
      async maybeSingle() { const value = resolve(); return { ...value, data: value.data?.[0] ?? null }; },
      then(done: (result: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(resolve()).then(done, reject); },
    };
    return builder;
  } };
  const stubs: Record<string, unknown> = {
    "@/lib/boosterCta": runtimeModules()<typeof import("../../lib/boosterCta.ts")>("lib/boosterCta.ts"),
    "@/lib/metaPublicationTargets": runtimeModules()<typeof import("../../lib/metaPublicationTargets.ts")>("lib/metaPublicationTargets.ts"),
    "server-only": {}, "./inrAssistantActionClause.ts": actionClauses, "node:crypto": { createHash },
    ai: { tool: (definition: unknown) => definition, jsonSchema: (schema: unknown, config: Row) => ({ schema, ...config }) },
    "./boosterPublicationPolicy.ts": channelPolicy, "./boosterChannelRules.ts": channelRules, "./boosterPublicationOutcome.ts": outcomes,
    "@/lib/requireUser": { requireUser: async () => { calls.push({ action: "auth" }); return { errorResponse: null, activeUserId: options.wrongScope ? FOREIGN : ACCOUNT, authUserId: "authenticated-actor", supabase }; } },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async (ids: string[]) => { assert.deepEqual(Array.from(ids), [ACCOUNT]); return new Set(options.inactive ? [] : [ACCOUNT]); } },
    "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => { minted.push(id); return `/api/media-library/items/${id}/content?token=PRIVATE_SIGNED_TOKEN`; } },
    "@/app/api/booster/events/route": {
      GET: async (request: Request) => { calls.push({ action: "draft-get", request });
        const id = new URL(request.url).searchParams.get("draftId");
        const draft = tables.app_events.find((entry) => entry.id === id && entry.user_id === ACCOUNT && entry.type === "publish_draft");
        return draft ? Response.json({ ok: true, payload: draft.payload }) : Response.json({ error: "PRIVATE FOREIGN" }, { status: 404 }); },
      POST: async (request: Request) => {
        const body = record(await request.json()); calls.push({ action: "draft-post", request, body });
        const id = typeof body.draftId === "string" ? body.draftId : randomUUID();
        const existing = tables.app_events.find((entry) => entry.id === id && entry.user_id === ACCOUNT);
        if (body.draftId && !existing) return Response.json({}, { status: 404 });
        if (existing) existing.payload = body.payload;
        else tables.app_events.push({ id, user_id: ACCOUNT, module: "booster", type: "publish_draft", payload: body.payload });
        return Response.json({ ok: true, id });
      },
    },
    "@/app/api/booster/connected-channels/route": { GET: async () => {
      calls.push({ action: "connected" }); if (options.deadlineAfterConnection) deadlineAllowed = false;
      return Response.json({ ok: true, channels: Object.fromEntries(channelPolicy.BOOSTER_PUBLICATION_CHANNELS.map((channel) => [channel, options.disconnected ? false : true])) });
    } },
    "@/app/api/booster/publish-now/route": { POST: async (request: Request) => {
      const body = record(await request.json()); calls.push({ action: "publish", request, body });
      if (options.throwPublish) throw new Error("PRIVATE NETWORK token=hidden");
      return Response.json(options.publishResult || { ok: true, done: false, publication_id: PUBLICATION, payload: { access_token: "PRIVATE" } }, { status: options.publishResult ? 200 : 202 });
    } },
    "@/app/api/agent/scheduled-actions/route": {
      GET: async (request: Request) => { calls.push({ action: "schedule-get", request }); const key = new URL(request.url).searchParams.get("requestId")!;
        return scheduled.has(key) ? Response.json({ scheduledAction: scheduled.get(key), tableMissing: false }) : Response.json({ scheduledAction: null, tableMissing: false }, { status: 404 }); },
      POST: async (request: Request) => { const body = record(await request.json()); calls.push({ action: "schedule", request, body });
        if (options.rejectScheduleNumber === calls.filter(call => call.action === "schedule").length) return Response.json({}, { status: 503 });
        const value = { id: body.scheduleRequestId, status: "scheduled", scheduledAt: body.scheduledAt, channels: body.channels, payload: body.payload };
        scheduled.set(String(body.scheduleRequestId), value); return Response.json({ scheduledAction: value, tableMissing: false }); },
    },
    "@/lib/inrsend/publicationChannelActions": { createPublicationChannelHandlers: (channel: string) => ({
      PATCH: async (request: Request, context: { params: Promise<{ publicationId: string }> }) => {
        const body = record(await request.json()), params = await context.params; calls.push({ action: "edit", channel, request, body });
        assert.equal(params.publicationId, PUBLICATION);
        if (options.throwEdit) throw new Error("PRIVATE PROVIDER access_token=hidden");
        if (options.rejectEdit) return Response.json({ error: "PRIVATE UNSUPPORTED", code: "threads_edit_unsupported" }, { status: 409 });
        const event = tables.app_events.find((entry) => entry.type === "publish" && entry.user_id === ACCOUNT)!;
        const payload = record(event.payload); const posts = record(payload.postByChannel);
        posts[channel] = { ...record(posts[channel]), ...body }; payload.postByChannel = posts;
        return Response.json({ ok: true, payload: { ...payload, provider_token: "PRIVATE_PROVIDER_TOKEN" } });
      },
    }) },
    "@/app/api/booster/publications/[publicationId]/status/route": { GET: async (request: Request, context: { params: Promise<{ publicationId: string }> }) => {
      const params = await context.params; calls.push({ action: "status", request });
      return params.publicationId === FOREIGN_PUBLICATION ? Response.json({ error: "PRIVATE FOREIGN" }, { status: 404 }) : Response.json(options.status ?? {
        ok: true, done: false, publication_id: PUBLICATION, summary: { entries: [{ channel: "facebook", status: "queued", error: "PRIVATE PROVIDER ERROR" }] },
      });
    } },
  };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantPublicationTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  stubs["@/app/api/booster/soundtracks/route"] = { GET: async () => { calls.push({ action: "soundtracks" }); return Response.json({ ok: true, soundtracks: [{ id: "atelier-calm", label: "Atelier calme", privateAsset: "/private/audio.wav" }] }); } };
  stubs["@/app/api/integrations/pinterest/boards/route"] = { GET: async (request: Request) => { calls.push({ action: "boards", request }); return Response.json({ ok: true, boards: [{ id: "123456789", name: "Réalisations", access_token: "PRIVATE" }] }); } };
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date: FixedDate, Intl, URL, Headers, Request, Response, setTimeout, clearTimeout })((dependency: string) => {
    if (!(dependency in stubs)) throw new Error(`Unexpected dependency: ${dependency}`); return stubs[dependency];
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof PublicationTools;
  const sourceRequest = new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "trusted-session", authorization: "Bearer trusted-session", "x-cron-secret": "NEVER_FORWARD" } });
  const create = (message = options.message ?? "Prépare un post Facebook et publie-le maintenant", actionRequestId = "trusted-server-turn") => runtime.createInrAssistantPublicationTools({
    request: sourceRequest, accountId: ACCOUNT, supabase: supabase as never, currentUserMessage: message, actionRequestId,
    canStartWork: () => deadlineAllowed, onResult: (value) => observed.push(value),
    statusReadOnly: options.statusReadOnly,
  }) as unknown as Record<"preparePublication" | "executePublication" | "editPublication" | "getPublicationStatus" | "readPublicationOptions", TestTool>;
  return { tools: create(), create, runtime, calls, queries, tables, minted, observed, scheduled };
}
const prepare = { posts: [post], mediaIds: null, draftId: null };

test("Spanish and German creation orders are accepted while help and negation remain non-executing",()=>{
 const h=harness();
 for(const message of ["Crea una publicación en Facebook sobre nuestros servicios.","Erstelle einen Beitrag für Facebook über unsere Leistungen."]) assert.equal(h.runtime.permitsInrAssistantPublicationAction(message,"prepare"),true,message);
 for(const message of ["Como crear una publicación?","Wie erstelle ich einen Beitrag?","No crea una publicación.","Bitte nicht erstelle einen Beitrag."]) assert.equal(h.runtime.permitsInrAssistantPublicationAction(message,"prepare"),false,message);
});
test("provider strict object schemas require every declared key while native optional runtime inputs remain compatible", async () => {
  const h = harness();
  const inspect = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    const item = record(value);
    if (item.properties) { assert.equal(item.additionalProperties, false); assert.deepEqual(Array.from(item.required as string[]).sort(), Object.keys(record(item.properties)).sort()); }
    Object.values(item).forEach(inspect);
  };
  for (const tool of Object.values(h.tools)) inspect(tool.inputSchema.schema);
  assert.equal((await h.tools.preparePublication.execute({ posts: [post], mediaIds: null, draftId: null })).status, "draft");
  assert.equal((await h.tools.executePublication.execute({ draftId: DRAFT, mode: "publish", scheduledAt: null, timezone: null })).status, "queued");
});
const publish = { draftId: DRAFT, mode: "publish", scheduledAt: null, timezone: null };

test("per-publication CTA uses native modes and destinations, survives execution and never replaces the global preference", async () => {
  const cta = runtimeModules()<typeof import("../../lib/boosterCta.ts")>("lib/boosterCta.ts");
  const payload = storedPayload(["gmb", "facebook"]); record(payload.postByChannel).facebook = { ...record(record(payload.postByChannel).facebook), ctaMode: "call", ctaPhone: "+33612345678", cta: "Appelez notre atelier", privateNativeMetadata: "preserved" };
  const h = harness({ payload, message: "Prépare cette publication sur tous mes canaux avec Réserver comme CTA puis publie-la maintenant" });
  const prepared = await h.tools.preparePublication.execute({ ...prepare, draftId: DRAFT, posts: [{ ...post, channel: "gmb" }], channelChanges: [{ channel: "gmb", field: "cta", valueJson: JSON.stringify({ ctaMode: "website", cta: "Réserver une visite", ctaUrl: "https://atelier.test/reserver", ctaAction: "BOOK" }) }] });
  assert.equal(prepared.status, "draft"); assert.equal((await h.tools.executePublication.execute(publish)).status, "queued");
  const body = h.calls.find(call => call.action === "publish")!.body!, posts = record(body.postByChannel), google = record(posts.gmb), facebook = record(posts.facebook);
  assert.deepEqual(cta.getBoosterGmbCallToAction(google), { actionType: "BOOK", url: "https://atelier.test/reserver" });
  assert.equal(facebook.ctaMode, "call"); assert.equal(facebook.ctaPhone, "+33612345678"); assert.equal(facebook.privateNativeMetadata, "preserved");
  assert.equal(h.queries.some(query => ["business_profiles", "pro_tools_configs"].includes(query.table)), false, "a one-publication CTA never writes global settings");
});

test("native CTA rejects unavailable modes, missing link/phone and forged hidden fields before draft or dispatch", async () => {
  for (const [channel, choice] of [ ["gmb", { ctaMode: "message" }], ["facebook", { ctaMode: "call", ctaPhone: "invalid" }], ["facebook", { ctaMode: "website", ctaUrl: "javascript:alert(1)" }], ["inr_search", { ctaMode: "website", ctaUrl: "https://atelier.test" }] ] as const) {
    const h = harness(), result = await h.tools.preparePublication.execute({ ...prepare, posts: [{ ...post, channel }], channelChanges: [{ channel, field: "cta", valueJson: JSON.stringify(choice) }] });
    assert.equal(result.ok, false); assert.equal(h.calls.some(call => ["draft-post", "publish", "schedule"].includes(call.action)), false);
  }
  const h = harness(); await assert.rejects(h.tools.preparePublication.execute({ ...prepare, channelChanges: [{ channel: "facebook", field: "cta", valueJson: JSON.stringify({ ctaMode: "none", accountId: FOREIGN }) }] }));
});

test("native render settings and existing per-channel derivatives survive a text-only draft edit and actual dispatch", async () => {
  const image = { mediaId: IMAGE, imageKey: "original-image-key", storagePath: `users/${ACCOUNT}/image.jpg`, publicUrl: "https://app.inrcy.test/api/image-rendered", transform: { fit: "cover", zoom: 1.4 }, imageMeta: { width: 1000, height: 800 } };
  const payload = { ...storedPayload(["facebook", "linkedin"]), assistantMediaIds: [IMAGE], images: [image], imageDrafts: [image], imagesByChannel: { facebook: [image], linkedin: [image] }, imagesByPlacement: { facebook: { story: [image] } },
    imageSettingsByChannel: { facebook: { imageKeys: [image.imageKey], transforms: { [image.imageKey]: { fit: "cover", zoom: 1.4, overlay: { text: "Logo existant" } } }, customizedImageKeys: [image.imageKey] } },
    videoFormatByChannel: { facebook: "9_16", linkedin: "16_9" }, videoAdaptationModeByChannel: { facebook: "cover_crop" }, videoSettingsByChannel: { facebook: { format: "9_16", adaptationMode: "cover_crop", nativeExtra: "keep" } }, mediaModeByChannel: { facebook: "images", linkedin: "images" } };
  const h = harness({ payload, message: "Prépare le texte de cette publication puis publie-la sur tous mes canaux maintenant" });
  assert.equal((await h.tools.preparePublication.execute({ ...prepare, draftId: DRAFT, posts: [{ ...post, content: "Texte corrigé" }] })).status, "draft");
  assert.equal((await h.tools.executePublication.execute(publish)).status, "queued"); const body = h.calls.find(call => call.action === "publish")!.body!;
  for (const field of ["imageSettingsByChannel", "imagesByPlacement", "imagesByChannel", "videoFormatByChannel", "videoAdaptationModeByChannel", "videoSettingsByChannel"]) assert.deepEqual(body[field], payload[field as keyof typeof payload], field);
  assert.equal(record((body.images as Row[])[0]).imageKey, image.imageKey);
});

test("bounded image/video options use real selected image keys and preserve unrelated native rendering metadata", async () => {
  const payload = { ...storedPayload(), assistantMediaIds: [IMAGE], images: [{ mediaId: IMAGE, imageKey: "image-one" }], mediaModeByChannel: { facebook: "images" }, imageSettingsByChannel: { facebook: { imageKeys: ["image-one"], transforms: { "image-one": { fit: "contain", zoom: 1, overlay: { text: "Texte conservé" } } } } }, videoSettingsByChannel: { facebook: { format: "original", adaptationMode: "safe_frame", nativeExtra: "keep" } } };
  const h = harness({ payload });
  const changes = [{ channel: "facebook", field: "imageTransform", valueJson: JSON.stringify({ imageIndex: 0, fit: "cover", zoom: 1.6, offsetX: 12 }) }, { channel: "facebook", field: "videoFormat", valueJson: '"9_16"' }, { channel: "facebook", field: "videoAdaptationMode", valueJson: '"cover_crop"' }];
  assert.equal((await h.tools.preparePublication.execute({ ...prepare, draftId: DRAFT, channelChanges: changes })).status, "draft"); assert.equal((await h.tools.executePublication.execute(publish)).status, "queued");
  const body = h.calls.find(call => call.action === "publish")!.body!, transform = record(record(record(body.imageSettingsByChannel).facebook).transforms)["image-one"] as Row;
  assert.equal(transform.fit, "cover"); assert.equal(transform.zoom, 1.6); assert.equal(transform.offsetX, 12); assert.deepEqual(transform.overlay, { text: "Texte conservé" });
  assert.equal(record(record(body.videoSettingsByChannel).facebook).nativeExtra, "keep"); assert.equal(record(body.videoFormatByChannel).facebook, "9_16"); assert.equal(record(body.videoAdaptationModeByChannel).facebook, "cover_crop");
  const bad = harness({ payload }); await assert.rejects(bad.tools.preparePublication.execute({ ...prepare, draftId: DRAFT, channelChanges: [{ channel: "facebook", field: "imageTransform", valueJson: '{"imageIndex":0,"url":"https://foreign.invalid"}' }] }));
});

const mixedMessage = "Programme Facebook le 2026-10-27 à 18h puis programme LinkedIn le 2026-10-28 à 19h puis publie Threads maintenant.";
const mixedPlan = { draftId: DRAFT, mode: "schedule", scheduledAt: null, timezone: "Europe/Paris", channelSchedules: [{ channel: "facebook", scheduledAt: "2026-10-27T18:00:00+01:00" }, { channel: "linkedin", scheduledAt: "2026-10-28T19:00:00+01:00" }], immediateChannels: ["threads"] };
test("per-channel future dates and explicit immediate channels use native grouped schedules and filtered dispatch with stable receipts", async () => {
  const payload = { ...storedPayload(["facebook", "linkedin", "threads"]), imageSettingsByChannel: { facebook: { native: "fb" }, linkedin: { native: "li" } }, videoSettingsByChannel: { linkedin: { format: "16_9", adaptationMode: "safe_frame" } } };
  const h = harness({ payload, message: mixedMessage }), result = await h.tools.executePublication.execute(mixedPlan);
  assert.equal(result.status, "queued"); const schedules = h.calls.filter(call => call.action === "schedule"), dispatch = h.calls.find(call => call.action === "publish")!.body!;
  assert.equal(schedules.length, 2); assert.deepEqual(schedules.map(call => call.body!.scheduledAt), ["2026-10-27T17:00:00.000Z", "2026-10-28T18:00:00.000Z"]);
  for (const item of schedules) { const body = item.body!, publish = record(record(body.payload).publishPayload), channel = (body.channels as string[])[0]; assert.deepEqual(Object.keys(record(publish.postByChannel)), [channel]); assert.deepEqual(Object.keys(record(publish.imageSettingsByChannel)), [channel]); }
  assert.deepEqual(dispatch.channels, ["threads"]); assert.deepEqual(Object.keys(record(dispatch.postByChannel)), ["threads"]); assert.equal(record(dispatch.videoSettingsByChannel).linkedin, undefined);
  assert.equal((result.scheduledActions as Row[]).length, 2); assert.deepEqual((await h.tools.executePublication.execute(mixedPlan)).scheduledActions, result.scheduledActions); assert.equal(h.calls.filter(call => call.action === "schedule").length, 2);
  const recovered = await h.create(mixedMessage).executePublication.execute(mixedPlan); assert.equal(recovered.status, "queued"); assert.equal(h.calls.filter(call => call.action === "schedule").length, 2); assert.equal(h.calls.filter(call => call.action === "publish").at(-1)!.body!.idempotencyKey, dispatch.idempotencyKey);
});
test("scheduling partitions reject missing, overlapping or unrequested immediate channels before any native write", async () => {
  const payload = storedPayload(["facebook", "linkedin", "threads"]);
  for (const plan of [{ ...mixedPlan, immediateChannels: [] }, { ...mixedPlan, immediateChannels: ["facebook", "threads"] }, { ...mixedPlan, immediateChannels: ["x"] }, { ...mixedPlan, scheduledAt: "2026-10-29T18:00:00+01:00" }]) {
    const h = harness({ payload, message: mixedMessage }); assert.equal((await h.tools.executePublication.execute(plan)).status, "needs_clarification"); assert.equal(h.calls.some(call => ["publish", "schedule"].includes(call.action)), false);
  }
  const h = harness({ payload, message: "Programme Facebook le 2026-10-27 à 18h puis programme LinkedIn le 2026-10-28 à 19h." }); assert.equal((await h.tools.executePublication.execute(mixedPlan)).status, "needs_clarification"); assert.equal(h.calls.some(call => ["publish", "schedule"].includes(call.action)), false);
});
test("a failed later schedule preserves confirmed groups, never dispatches immediate channels, and resumes without another copy", async () => {
  const h = harness({ payload: storedPayload(["facebook", "linkedin", "threads"]), message: mixedMessage, rejectScheduleNumber: 2 });
  const first = await h.tools.executePublication.execute(mixedPlan); assert.equal(first.status, "partial"); assert.equal((first.scheduledActions as Row[]).length, 1); assert.equal(h.calls.some(call => call.action === "publish"), false);
  const resumed = await h.create(mixedMessage).executePublication.execute(mixedPlan); assert.equal(resumed.status, "queued"); assert.equal(h.scheduled.size, 2); assert.equal(h.calls.filter(call => call.action === "schedule").length, 3);
});
test("a mixed schedule never labels future channels published or discards saved groups after immediate failure", async () => {
  for (const status of ["published", "failed"]) {
    const h = harness({ payload: storedPayload(["facebook", "linkedin", "threads"]), message: mixedMessage, publishResult: { done: true, publication_id: PUBLICATION, summary: { entries: [{ channel: "threads", status }] } } });
    const result = await h.tools.executePublication.execute(mixedPlan); assert.equal(result.status, status === "published" ? "scheduled" : "partial");
    assert.equal((result.scheduledActions as Row[]).length, 2); assert.deepEqual(JSON.parse(JSON.stringify(result.channels)), [{ channel: "facebook", status: "scheduled" }, { channel: "linkedin", status: "scheduled" }, { channel: "threads", status }]);
  }
});
test("the current native UI draft keeps its owned workspace, channel media modes, image settings and flattened Meta placement", async () => {
  const native = { ...storedPayload(["instagram"]), mediaWorkspaceId: IMAGE, mediaWorkspaceClientKey: "native-workspace", mediaPipelineCutoverV1: true, channelMediaModes: { instagram: "images" }, mediaType: "images",
    imageSettingsByChannel: { instagram: { imageKeys: ["native-image"], transforms: { "native-image": { fit: "cover", zoom: 1.2 } }, customizedImageKeys: ["native-image"] } }, instagramPublicationPlacement: "story", instagramStoryEnabled: false };
  const h = harness({ payload: native, workspace: { id: IMAGE, account_id: ACCOUNT }, message: "Prépare le texte de ma publication Instagram puis publie-la maintenant" });
  assert.equal((await h.tools.preparePublication.execute({ ...prepare, draftId: DRAFT, posts: [{ ...post, channel: "instagram" }] })).status, "draft");
  assert.equal((await h.tools.executePublication.execute(publish)).status, "queued"); const body = h.calls.find(call => call.action === "publish")!.body!;
  assert.equal(body.mediaWorkspaceId, IMAGE); assert.equal(record(body.mediaModeByChannel).instagram, "images"); assert.deepEqual(body.imageSettingsByChannel, native.imageSettingsByChannel); assert.deepEqual(record(body.instagramPublicationSettings).placements, ["story"]);
  assert.ok(h.queries.some(query => query.table === "publication_workspaces" && query.filters.some(([, field, value]) => field === "account_id" && value === ACCOUNT)));
  const foreign = harness({ payload: native, workspace: { id: IMAGE, account_id: FOREIGN }, message: "Publie ma publication Instagram maintenant" }); assert.equal((await foreign.tools.executePublication.execute(publish)).status, "blocked"); assert.equal(foreign.calls.some(call => call.action === "publish"), false);
});
test("an explicit global media replacement clears the old workspace and derivatives instead of publishing its previous selection", async () => {
  const payload = { ...storedPayload(), mediaWorkspaceId: IMAGE, mediaPipelineCutoverV1: true, imagesByChannel: { facebook: [{ mediaId: FOREIGN_MEDIA }] }, imagesByPlacement: { facebook: { story: [{ mediaId: FOREIGN_MEDIA }] } }, imageSettingsByChannel: { facebook: { imageKeys: ["old"] } } };
  const h = harness({ payload }); assert.equal((await h.tools.preparePublication.execute({ ...prepare, draftId: DRAFT, mediaIds: [IMAGE] })).status, "draft");
  assert.equal((await h.tools.executePublication.execute(publish)).status, "queued"); const body = h.calls.find(call => call.action === "publish")!.body!;
  assert.equal(body.mediaWorkspaceId, null); assert.equal(body.mediaPipelineCutoverV1, false); assert.deepEqual(body.imagesByPlacement, {}); assert.deepEqual(body.imagesByChannel, {}); assert.equal((body.images as Row[])[0].mediaId, IMAGE); assert.doesNotMatch(JSON.stringify(body), new RegExp(FOREIGN_MEDIA));
});

test("native Booster options survive draft and actual dispatch, with owned channel-specific images", async () => {
  const h = harness({ message: "Prépare une publication et publie-la sur tous mes canaux maintenant" });
  const posts = ["facebook", "instagram", "threads", "pinterest"].map(channel => ({ ...post, channel }));
  const channelChanges = [{ channel: "facebook", field: "placement", valueJson: '"reel"' }, { channel: "facebook", field: "includeStory", valueJson: "true" }, { channel: "facebook", field: "soundtrackId", valueJson: '"atelier-calm"' }, { channel: "instagram", field: "mediaIds", valueJson: JSON.stringify([IMAGE]) }, { channel: "threads", field: "threadsMode", valueJson: '"ghost"' }, { channel: "threads", field: "mediaIds", valueJson: "[]" }, { channel: "pinterest", field: "mediaIds", valueJson: JSON.stringify([IMAGE]) }, { channel: "pinterest", field: "pinterestBoardId", valueJson: '"123456789"' }];
  const drafted = await h.tools.preparePublication.execute({ ...prepare, posts, channelChanges, draftId: DRAFT }); assert.equal(drafted.status, "draft");
  assert.equal((await h.tools.executePublication.execute(publish)).status, "queued"); const body = h.calls.find(call => call.action === "publish")!.body!;
  assert.deepEqual(record(body.facebookPublicationSettings).placements, ["reel", "story"]); assert.equal(record(body.soundtrackByChannel).facebook, "atelier-calm");
  assert.equal(record(body.threadsPublicationSettings).mode, "ghost"); assert.equal(record(body.mediaModeByChannel).threads, "none");
  assert.equal(record(body.pinterestPublicationSettings).boardName, "Réalisations"); assert.equal(record((record(body.imagesByChannel).instagram as Row[])[0]).mediaId, IMAGE); assert.equal(h.minted.includes(FOREIGN_MEDIA), false);
});

test("publication options reject invented catalogue IDs and foreign channel media before saving or sending", async () => {
  for (const change of [{ channel: "facebook", field: "soundtrackId", valueJson: '"invented"' }, { channel: "pinterest", field: "pinterestBoardId", valueJson: '"999999"' }, { channel: "instagram", field: "mediaIds", valueJson: JSON.stringify([FOREIGN_MEDIA]) }]) {
    const h = harness(); const answer = await h.tools.preparePublication.execute({ ...prepare, posts: [{ ...post, channel: change.channel }], channelChanges: [change] }); assert.equal(answer.ok, false); assert.equal(h.calls.some(call => ["draft-post", "publish", "schedule"].includes(call.action)), false);
  }
  const h = harness(); for (const change of [{ channel: "threads", field: "placement", valueJson: '"story"' }, { channel: "facebook", field: "consent", valueJson: "true" }]) await assert.rejects(h.tools.preparePublication.execute({ ...prepare, posts: [{ ...post, channel: change.channel }], channelChanges: [change] })); assert.equal(h.calls.length, 0);
});

test("publication options catalogue only exposes native public ID and label", async () => {
  const h = harness(); for (const view of ["soundtracks", "pinterest_boards"]) { const output = await h.tools.readPublicationOptions.execute({ view }); assert.equal(output.ok, true); const json = JSON.stringify(output); assert.equal(/PRIVATE|privateAsset|audio.wav/.test(json), false); }
  assert.equal(h.calls.some(call => ["draft-post", "publish", "schedule"].includes(call.action)), false);
});

test("the reported Standard request authorizes preparing and publishing to the connected channels", async () => {
  const message = "Non je voudrais que tu me génères une publication pour chaque canal avec 1 image et que tu publies sur tous les canaux via booster";
  const h = harness({ message });
  assert.equal(h.runtime.permitsInrAssistantPublicationAction(message, "prepare"), true);
  assert.equal(h.runtime.permitsInrAssistantPublicationAction(message, "publish", ["facebook", "instagram", "threads"]), true);
  assert.equal((await h.tools.preparePublication.execute({ ...prepare, mediaIds: [IMAGE] })).status, "draft");
  assert.equal((await h.tools.executePublication.execute(publish)).status, "queued");
});

test("preparation records a real Booster draft with owned media, preserving auth and exposing no private media URL", async () => {
  const h = harness({ drafts: false });
  const result = await h.tools.preparePublication.execute({ ...prepare, mediaIds: [IMAGE] });
  assert.equal(result.status, "draft"); assert.ok(result.draftId); assert.match(result.toolUrl, /draftId=/);
  assert.equal(h.calls.filter((call) => call.action === "draft-post").length, 1);
  assert.equal(h.calls.some((call) => ["publish", "schedule", "edit"].includes(call.action)), false);
  const call = h.calls.find((call) => call.action === "draft-post")!;
  assert.equal(call.request!.headers.get("cookie"), "trusted-session");
  assert.equal(call.request!.headers.get("authorization"), "Bearer trusted-session");
  assert.equal(call.request!.headers.get("x-cron-secret"), null);
  assert.equal(new URL(call.request!.url).origin, "https://app.inrcy.test");
  const payload = record(call.body!.payload);
  assert.equal(payload.creationMode, "manual"); assert.equal(payload.status, "draft");
  assert.ok(String(record((payload.imageDrafts as unknown[])[0]).publicUrl).includes("PRIVATE_SIGNED_TOKEN"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|storage|users\//);
  assert.deepEqual(h.minted, [IMAGE]);
  for (const query of h.queries) assert.ok(query.filters.some(([, key, value]) => key === "user_id" && value === ACCOUNT));
});

test("draft work is single-flight across model fallbacks and recovered by its exact account-scoped receipt after a retry", async () => {
  const h = harness({ drafts: false });
  const [a, b] = await Promise.all([h.tools.preparePublication.execute(prepare), h.tools.preparePublication.execute(prepare)]);
  assert.equal(a.draftId, b.draftId); assert.equal(h.calls.filter((call) => call.action === "draft-post").length, 1);
  const retry = await h.create().preparePublication.execute(prepare);
  assert.equal(retry.draftId, a.draftId); assert.equal(h.calls.filter((call) => call.action === "draft-post").length, 1);
  const changed = await h.tools.preparePublication.execute({ ...prepare, posts: [{ ...post, content: "Autre texte" }] });
  assert.equal(changed.status, "needs_clarification");
});

test("editing a draft preserves its other channels and legacy media; clearing media requires an explicit current request", async () => {
  const legacy = { ...storedPayload(["facebook", "linkedin"]), imageDrafts: [{ storagePath: "original-existing-path", publicUrl: "https://private.invalid/old" }], videoDraft: { storagePath: "existing-video" } };
  const h = harness({ message: "Corrige mon brouillon Facebook", payload: legacy });
  const result = await h.tools.preparePublication.execute({ ...prepare, draftId: DRAFT });
  assert.equal(result.status, "draft");
  const saved = record(h.tables.app_events.find((entry) => entry.id === DRAFT)!.payload);
  assert.deepEqual(Array.from(saved.channels as string[]), ["facebook", "linkedin"]);
  assert.deepEqual(saved.imageDrafts, legacy.imageDrafts); assert.deepEqual(saved.videoDraft, legacy.videoDraft);
  const blocked = await h.create().preparePublication.execute({ ...prepare, mediaIds: [], draftId: DRAFT });
  assert.equal(blocked.status, "needs_clarification");
});

test("mutations fail closed for inactive subscriptions or a mismatched active account", async () => {
  for (const options of [{ inactive: true }, { wrongScope: true }]) {
    const h = harness(options);
    assert.equal((await h.tools.preparePublication.execute(prepare)).status, "blocked");
    assert.equal((await h.tools.executePublication.execute(publish)).status, "blocked");
    assert.equal(h.calls.some((call) => ["draft-post", "publish", "schedule", "edit"].includes(call.action)), false);
  }
  const h = harness({ inactive: true });
  assert.equal((await h.tools.getPublicationStatus.execute({ publicationId: PUBLICATION })).status, "processing");
});

test("foreign media, forged storage ownership, unsupported media mixes and unavailable reads cannot launch work", async () => {
  for (const mediaIds of [[FOREIGN_MEDIA], [IMAGE, VIDEO]]) {
    const h = harness();
    assert.equal((await h.tools.preparePublication.execute({ ...prepare, mediaIds })).ok, false);
    assert.equal(h.calls.some((call) => call.action === "draft-post"), false);
  }
  const forged = harness({ mediaRows: [{ id: IMAGE, user_id: ACCOUNT, is_active: true, source: "mediatheque", bucket_name: "inrcy-pro-media", storage_path: `users/${FOREIGN}/private.jpg`, media_type: "image" }] });
  assert.equal((await forged.tools.preparePublication.execute({ ...prepare, mediaIds: [IMAGE] })).ok, false);
  assert.equal(forged.minted.length, 0);
  const unavailable = harness({ failDb: "app_events" });
  assert.equal((await unavailable.tools.preparePublication.execute(prepare)).status, "unknown");
  assert.equal(unavailable.calls.some((call) => call.action === "draft-post"), false);
});

test("publication uses only a real stored draft with a stable native idempotency key and honest queued result", async () => {
  const h = harness({ payload: { ...storedPayload(), userId: FOREIGN, cronSecret: "PRIVATE", _asyncChannelDispatch: true } });
  const [a, b] = await Promise.all([h.tools.executePublication.execute(publish), h.tools.executePublication.execute(publish)]);
  assert.equal(a.status, "queued"); assert.equal(a.publicationId, PUBLICATION); assert.equal(b.publicationId, PUBLICATION);
  const calls = h.calls.filter((call) => call.action === "publish"); assert.equal(calls.length, 1);
  assert.match(String(calls[0].body!.idempotencyKey), /^booster_manual:assistant:/);
  assert.equal(record(calls[0].body!.postByChannel).facebook !== undefined, true);
  assert.doesNotMatch(JSON.stringify(calls[0].body), /PRIVATE|cronSecret|_async|userId/);
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE|terminée|a été publiée/);
  const deniedModeSwitch = await h.tools.executePublication.execute({ draftId: DRAFT, mode: "schedule", scheduledAt: "2026-10-27T13:00:00Z", timezone: "Europe/Paris" });
  assert.equal(deniedModeSwitch.status, "needs_clarification"); assert.equal(h.calls.some((call) => call.action === "schedule"), false);
});

test("advice, quotations, old intentions, a bare yes, negations and missing channel intent never trigger a publication", async () => {
  for (const message of ["Comment publier sur Facebook ?", "Peux-tu m’expliquer comment publier maintenant sur Facebook ?", "Tu peux me montrer comment publier ce brouillon Facebook ?", "Can you show me how to publish this draft on Facebook?", "Bonjour, comment publier maintenant sur Facebook ?", "Oui", "Voici une citation : « publie sur Facebook »", "Je ne veux pas que tu publies Facebook", "Est-ce que je peux publier sur Facebook ?", "Publie sur Instagram", "Publie la promotion demain sur Facebook"]) {
    const h = harness({ message });
    assert.equal((await h.tools.executePublication.execute(publish)).status, "needs_clarification", message);
    assert.equal(h.calls.some((call) => call.action === "publish"), false, message);
  }
  const h = harness({ message: "Publie ce brouillon maintenant" });
  assert.equal((await h.tools.executePublication.execute(publish)).status, "queued");
});

test("polite navigation and explanation requests never edit or schedule a publication", async () => {
  for (const message of ["Peux-tu me dire où modifier ma publication Facebook ?", "Peux-tu m’expliquer comment modifier le texte sur Facebook ?", "Show me where to edit this Facebook post", "Bonjour, comment corriger cette publication Facebook ?"]) {
    const h = harness({ message });
    const result = await h.tools.editPublication.execute({ publicationId: PUBLICATION, channel: "facebook", title: null, content: "Nouveau texte", hashtags: null });
    assert.equal(result.status, "needs_clarification", message);
    assert.equal(h.calls.some(call => call.action === "edit"), false, message);
  }
  const h = harness({ message: "Peux-tu m’expliquer comment programmer mon brouillon Facebook demain à 14h30 ?" });
  const result = await h.tools.executePublication.execute({ draftId: DRAFT, mode: "schedule", scheduledAt: "2026-10-27T13:30:00Z", timezone: "Europe/Paris" });
  assert.equal(result.status, "needs_clarification"); assert.equal(h.calls.some(call => call.action === "schedule"), false);
});

test("describing a broken Publish or Delete button never becomes permission to publish or edit", async () => {
  for (const message of ["Le bouton Publier sur Facebook ne marche pas", "J’ai une erreur quand je publie sur Facebook", "Le bouton Supprimer ne fonctionne pas sur ma publication Facebook"]) {
    const h = harness({ message });
    assert.equal((await h.tools.executePublication.execute(publish)).status, "needs_clarification", message);
    assert.equal(h.calls.some(call => call.action === "publish"), false, message);
  }
  const h = harness({ message: "Le bouton Modifier sur ma publication Facebook ne marche pas" });
  assert.equal((await h.tools.editPublication.execute({ publicationId: PUBLICATION, channel: "facebook", content: "Autre texte", title: null, hashtags: null })).status, "needs_clarification");
  assert.equal(h.calls.some(call => call.action === "edit"), false);
  const explicit = harness({ message: "Le bouton fait une erreur. Publie ce brouillon sur Facebook maintenant" });
  assert.equal((await explicit.tools.executePublication.execute(publish)).status, "queued");
});

test("future scheduling requires a current date and hour, records a native UUID receipt and recovers it without duplicate", async () => {
  const h = harness({ message: "Programme ce brouillon Facebook demain à 14h30" });
  const input = { draftId: DRAFT, mode: "schedule", scheduledAt: "2026-10-27T13:30:00Z", timezone: "Europe/Paris" };
  const first = await h.tools.executePublication.execute(input);
  assert.equal(first.status, "scheduled"); assert.equal(first.scheduledAt, new Date(input.scheduledAt).toISOString());
  const call = h.calls.find((call) => call.action === "schedule")!;
  assert.equal(call.body!.actionType, "publication"); assert.equal(call.body!.targetTool, "booster");
  assert.equal(record(record(call.body!.payload).publishPayload).creationMode, "manual");
  assert.match(String(call.body!.scheduleRequestId), /^[a-f0-9-]{36}$/);
  const retry = await h.create().executePublication.execute(input);
  assert.equal(retry.scheduledActionId, first.scheduledActionId);
  assert.equal(h.calls.filter((call) => call.action === "schedule").length, 1);
  for (const message of ["Programme ce brouillon", "Programme ce brouillon demain", "Programme ce brouillon à 14h30", "Oui"]) {
    const missing = harness({ message });
    assert.equal((await missing.tools.executePublication.execute(input)).status, "needs_clarification", message);
    assert.equal(missing.calls.some((call) => call.action === "schedule"), false);
  }
});

test("TikTok validation, missing media, disconnected channels and elapsed deadlines cannot be bypassed by model fields", async () => {
  const tiktok = harness({ message: "Publie mon brouillon TikTok", payload: storedPayload(["tiktok"]) });
  assert.equal((await tiktok.tools.executePublication.execute(publish)).status, "needs_clarification");
  const instagram = harness({ message: "Publie mon brouillon Instagram", payload: storedPayload(["instagram"]) });
  assert.equal((await instagram.tools.executePublication.execute(publish)).status, "needs_clarification");
  const disconnected = harness({ disconnected: true });
  assert.equal((await disconnected.tools.executePublication.execute(publish)).status, "blocked");
  const deadline = harness({ deadlineAfterConnection: true });
  assert.equal((await deadline.tools.executePublication.execute(publish)).status, "blocked");
  for (const h of [tiktok, instagram, disconnected, deadline]) assert.equal(h.calls.some((call) => call.action === "publish"), false);
});

test("foreign draft and publication IDs are passed only through the same authenticated scope and never mutate", async () => {
  const h = harness({ message: "Corrige le texte Facebook" });
  assert.equal((await h.tools.executePublication.execute({ ...publish, draftId: FOREIGN_DRAFT })).ok, false);
  assert.equal((await h.tools.editPublication.execute({ publicationId: FOREIGN_PUBLICATION, channel: "facebook", title: null, content: "Nouveau texte", hashtags: null })).ok, false);
  const status = await h.tools.getPublicationStatus.execute({ publicationId: FOREIGN_PUBLICATION });
  assert.equal(status.ok, false);
  assert.equal(h.calls.some((call) => ["publish", "edit", "schedule"].includes(call.action)), false);
  assert.doesNotMatch(JSON.stringify(status), /FOREIGN|PRIVATE/);
});

test("iNrSend corrections preserve media, call its channel handler once, and skip a correction already recorded after retry", async () => {
  const h = harness({ message: "Corrige ma publication Facebook avec le nouveau texte" });
  const input = { publicationId: PUBLICATION, channel: "facebook", title: null, content: "Nouveau texte corrigé", hashtags: null };
  const [a, b] = await Promise.all([h.tools.editPublication.execute(input), h.tools.editPublication.execute(input)]);
  assert.equal(a.status, "updated"); assert.equal(b.status, "updated");
  const calls = h.calls.filter((call) => call.action === "edit"); assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].body!), ["content"]);
  assert.equal((await h.create().editPublication.execute(input)).status, "unchanged");
  assert.equal(h.calls.filter((call) => call.action === "edit").length, 1);
  assert.doesNotMatch(JSON.stringify(a), /PRIVATE|provider_token/);
});

test("unsupported edits and an uncertain remote write never become an automatic replacement post or fallback retry", async () => {
  for (const channel of ["x", "tiktok", "youtube_shorts"]) {
    const h = harness({ message: "Corrige la publication" });
    assert.equal((await h.tools.editPublication.execute({ publicationId: PUBLICATION, channel, title: null, content: "Nouveau texte", hashtags: null })).status, "blocked");
    assert.equal(h.calls.some((call) => ["edit", "publish"].includes(call.action)), false);
  }
  const rejected = harness({ message: "Corrige la publication Threads", rejectEdit: true });
  assert.equal((await rejected.tools.editPublication.execute({ publicationId: PUBLICATION, channel: "threads", title: null, content: "Nouveau texte", hashtags: null })).status, "blocked");
  const h = harness({ message: "Corrige la publication Facebook", throwEdit: true });
  const input = { publicationId: PUBLICATION, channel: "facebook", title: null, content: "Nouveau texte", hashtags: null };
  const first = await h.tools.editPublication.execute(input), retry = await h.tools.editPublication.execute(input);
  assert.equal(first.status, "unknown"); assert.equal(retry.status, "unknown");
  assert.equal(h.calls.filter((call) => call.action === "edit").length, 1);
  assert.equal(h.calls.some((call) => call.action === "publish"), false);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|access_token/);
});

test("recorded statuses distinguish partial publication, processing and failures without leaking provider details", async () => {
  for (const [entries, expected] of [
    [[{ channel: "facebook", status: "published" }, { channel: "linkedin", status: "failed", error: "PRIVATE_TOKEN" }], "partial"],
    [[{ channel: "facebook", status: "queued" }], "processing"],
    [[{ channel: "facebook", status: "failed" }], "failed"],
  ] as const) {
    const h = harness({ status: { ok: true, done: true, publication_id: PUBLICATION, summary: { entries } } });
    const result = await h.tools.getPublicationStatus.execute({ publicationId: PUBLICATION });
    assert.equal(result.status, expected); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|TOKEN/);
  }
  const h = harness({ throwPublish: true });
  assert.equal((await h.tools.executePublication.execute(publish)).status, "unknown");
  assert.equal((await h.tools.executePublication.execute(publish)).status, "unknown");
  assert.equal(h.calls.filter((call) => call.action === "publish").length, 1);
});

test("strict runtime validation rejects arbitrary URLs, account selectors, unknown channels and oversized fields before any access", async () => {
  const h = harness();
  for (const input of [{ ...prepare, accountId: FOREIGN }, { ...prepare, url: "http://169.254.169.254" }, { ...prepare, posts: [{ ...post, channel: "untrusted" }] },
    { ...prepare, posts: [{ ...post, content: "x".repeat(5_001) }] }, { ...prepare, mediaIds: ["../../foreign"] }]) {
    await assert.rejects(h.tools.preparePublication.execute(input));
  }
  await assert.rejects(h.tools.executePublication.execute({ ...publish, confirm: true }));
  await assert.rejects(h.tools.getPublicationStatus.execute({ publicationId: PUBLICATION, accountId: FOREIGN }));
  assert.equal(h.calls.length, 0); assert.equal(h.queries.length, 0);
  for (const definition of Object.values(h.tools)) assert.equal(definition.inputSchema.schema.additionalProperties, false);
});

test("an explicit two-post batch uses separate persistent draft and execution receipts, and retries do not create a third post", async () => {
  const h = harness({ message: "Prépare 2 publications Facebook et publie-les maintenant", drafts: false });
  const a = await h.tools.preparePublication.execute({ ...prepare, operationKey: "post-1" });
  const b = await h.tools.preparePublication.execute({ ...prepare, operationKey: "post-2", posts: [{ ...post, content: "Deuxième publication" }] });
  assert.equal(a.status, "draft"); assert.equal(b.status, "draft"); assert.notEqual(a.draftId, b.draftId);
  assert.equal((await h.tools.preparePublication.execute({ ...prepare, operationKey: "post-3" })).ok, false);
  const recovered = await h.create().preparePublication.execute({ ...prepare, operationKey: "different-prefix-1" });
  assert.equal(recovered.draftId, a.draftId); assert.equal(h.calls.filter(call => call.action === "draft-post").length, 2);
  await h.tools.executePublication.execute({ ...publish, draftId: a.draftId });
  await h.tools.executePublication.execute({ ...publish, draftId: b.draftId });
  const dispatched = h.calls.filter(call => call.action === "publish"); assert.equal(dispatched.length, 2);
  assert.notEqual(dispatched[0].body!.idempotencyKey, dispatched[1].body!.idempotencyKey);
});

test("a status-only publication follow-up selects the native read-only projection", async () => {
  const h = harness({ statusReadOnly: true }); await h.tools.getPublicationStatus.execute({ publicationId: PUBLICATION });
  const call = h.calls.find(call => call.action === "status")!; assert.equal(new URL(call.request!.url).searchParams.get("readOnly"), "true");
  assert.equal(h.calls.some(call => ["publish", "edit", "schedule"].includes(call.action)), false);
});
