import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as channelPolicy from "../../lib/boosterPublicationPolicy.ts";
import * as channelRules from "../../lib/boosterChannelRules.ts";
import * as outcomes from "../../lib/boosterPublicationOutcome.ts";
import type * as PublicationTools from "../../lib/inrAssistantPublicationTools.ts";

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
    "server-only": {}, "node:crypto": { createHash },
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
      return Response.json({ ok: true, done: false, publication_id: PUBLICATION, payload: { access_token: "PRIVATE" } }, { status: 202 });
    } },
    "@/app/api/agent/scheduled-actions/route": {
      GET: async (request: Request) => { calls.push({ action: "schedule-get", request }); const key = new URL(request.url).searchParams.get("requestId")!;
        return scheduled.has(key) ? Response.json({ scheduledAction: scheduled.get(key), tableMissing: false }) : Response.json({ scheduledAction: null, tableMissing: false }, { status: 404 }); },
      POST: async (request: Request) => { const body = record(await request.json()); calls.push({ action: "schedule", request, body });
        const value = { id: body.scheduleRequestId, status: "scheduled", scheduledAt: body.scheduledAt };
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
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date: FixedDate, Intl, URL, Headers, Request, Response, setTimeout, clearTimeout })((dependency: string) => {
    if (!(dependency in stubs)) throw new Error(`Unexpected dependency: ${dependency}`); return stubs[dependency];
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof PublicationTools;
  const sourceRequest = new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "trusted-session", authorization: "Bearer trusted-session", "x-cron-secret": "NEVER_FORWARD" } });
  const create = (message = options.message ?? "Prépare un post Facebook et publie-le maintenant", actionRequestId = "trusted-server-turn") => runtime.createInrAssistantPublicationTools({
    request: sourceRequest, accountId: ACCOUNT, supabase: supabase as never, currentUserMessage: message, actionRequestId,
    canStartWork: () => deadlineAllowed, onResult: (value) => observed.push(value),
  }) as unknown as Record<"preparePublication" | "executePublication" | "editPublication" | "getPublicationStatus", TestTool>;
  return { tools: create(), create, runtime, calls, queries, tables, minted, observed, scheduled };
}
const prepare = { posts: [post], mediaIds: null, draftId: null };

test("Spanish and German creation orders are accepted while help and negation remain non-executing",()=>{
 const h=harness();
 for(const message of ["Crea una publicación en Facebook sobre nuestros servicios.","Erstelle einen Beitrag für Facebook über unsere Leistungen."]) assert.equal(h.runtime.permitsInrAssistantPublicationAction(message,"prepare"),true,message);
 for(const message of ["Como crear una publicación?","Wie erstelle ich einen Beitrag?","No crea una publicación.","Bitte nicht erstelle einen Beitrag."]) assert.equal(h.runtime.permitsInrAssistantPublicationAction(message,"prepare"),false,message);
});
const publish = { draftId: DRAFT, mode: "publish", scheduledAt: null, timezone: null };

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
