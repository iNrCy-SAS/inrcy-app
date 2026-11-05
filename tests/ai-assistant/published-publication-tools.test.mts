import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { publicationEditSourceVersion } from "../../lib/inrsend/publicationEditVersion.ts";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", PUBLICATION = "30000000-0000-4000-8000-000000000003", MEDIA = "40000000-0000-4000-8000-000000000004";
const statement = "Remplace la photo et le bouton de cette publication Facebook déjà publiée.";
process.env.INRCY_ASSISTANT_APPROVAL_SECRET = "published-publication-unit-signing-secret-32-characters";
const changes = [{ field: "cta", valueJson: JSON.stringify({ ctaMode: "website", ctaUrl: "https://business.test/offre", cta: "Voir l’offre" }) }, { field: "media", valueJson: JSON.stringify({ mediaType: "images", images: [{ mediaId: MEDIA }] }) }];

function harness(channel: "facebook" | "site_web" = "facebook") {
  let account = ACCOUNT, actor = ACTOR, status = "delivered", uncertain = false, ignoreMedia = false, afterPatch = () => {}, calls = 0, effects = 0;
  const bytes = new Uint8Array([1, 2, 3]);
  const asset: Row = { id: MEDIA, user_id: ACCOUNT, bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/owned.png`, media_type: "image", mime_type: "image/png", size_bytes: bytes.length, upload_status: "uploaded", updated_at: "2026-11-05", source: "upload", is_active: true, original_file_name: "Offre retouchée.png", title: "Offre", duration_seconds: null };
  let payload: Row = { publication_id: PUBLICATION, channels: [channel, "instagram"], postByChannel: { [channel]: { title: "Titre", content: "Texte", hashtags: [], ctaMode: "none", cta: "", ctaUrl: "", ctaPhone: "", ctaAction: "", images: ["https://owned.test/original.png"], attachments: [{ imageKey: "old", url: "https://owned.test/original.png" }] }, instagram: { content: "Instagram conservé", images: ["https://owned.test/instagram.png"] } }, results: { [channel]: { ok: true, external_id: "native-channel", status: "delivered" }, instagram: { ok: true, external_id: "native-instagram", status: "delivered" } } };
  const locks = new Map<string, { id: string; result: Row | null }>(), saved = new Map<string, string>();
  const { guardPublishedPublicationEdit } = runtimeModules()<typeof import("../../lib/inrsend/publicationEditGuard.ts")>("lib/inrsend/publicationEditGuard.ts");
  const currentPost = () => (payload.postByChannel as Row)[channel] as Row;
  const readState = async (userId: string, publicationId: string, requestedChannel: string) => {
    if (userId !== ACCOUNT || publicationId !== PUBLICATION || requestedChannel !== channel) return null;
    const post = currentPost(); (payload.results as Row)[channel] = { ...((payload.results as Row)[channel] as Row), status };
    return { publication: { id: PUBLICATION, user_id: ACCOUNT }, event: { id: "event", payload }, eventPayload: payload, deliveries: [{ channel, status }], post, sourceVersion: await publicationEditSourceVersion(ACCOUNT, PUBLICATION, channel, payload), images: { images: post.images as string[], editableAttachments: post.attachments as Row[] }, video: null };
  };
  const native = { readInrSendPublicationEditState: readState, createPublicationChannelHandlers: (requestedChannel: string) => ({ PATCH: async (request: Request) => {
    calls++; assert.equal(requestedChannel, channel); assert.equal(request.headers.get("cookie"), "session=fixture"); assert.equal(request.headers.has("x-cron-secret"), false); const body: Row = await request.json();
    return guardPublishedPublicationEdit({ body, currentScope: async () => account === ACCOUNT && actor === ACTOR, readVersion: async () => (await readState(ACCOUNT, PUBLICATION, channel))!.sourceVersion,
      acquire: async key => { const old = locks.get(key); if (old) return { state: old.result ? "completed" : "running", lock: old }; const lock = { id: key, result: null }; locks.set(key, lock); return { state: "acquired", lock }; }, seal: async (id, result) => { locks.set(id, { id, result }); },
      mutate: async () => { effects++; if (uncertain) throw new Error("response lost after external acceptance"); const before = currentPost(), patch = Object.fromEntries(Object.entries(body).filter(([key]) => ["title", "content", "hashtags", "cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].includes(key)));
        const media = body.mediaType === "images" && !ignoreMedia ? { images: [...body.retainedImages as string[], ...(body.newImages as Row[]).map((_, index) => `https://owned.test/saved-${index}.png`)], attachments: (body.newImages as Row[]).map(image => ({ imageKey: image.imageKey, url: "https://owned.test/saved-0.png" })) } : {};
        payload = { ...payload, postByChannel: { ...payload.postByChannel as Row, [channel]: { ...before, ...patch, ...media } }, results: { ...payload.results as Row, [channel]: { ok: true, external_id: "new-native-channel", status: "delivered" } } }; afterPatch(); return Response.json({ ok: true, publication_id: PUBLICATION, channel }); },
    });
  } }) };
  const query = () => { const criteria = new Map<string, unknown>(); const api = { select: () => api, eq: (key: string, value: unknown) => { criteria.set(key, value); return api; }, neq: () => api, abortSignal: () => api, maybeSingle: async () => ({ data: criteria.get("id") === MEDIA ? { ...asset } : null, error: null }) }; return api; };
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor, supabase: { storage: { from: (bucket: string) => ({ download: (path: string) => { assert.equal(bucket, "inrcy-pro-media"); assert.equal(path, asset.storage_path); return { asStream: async () => ({ data: new Blob([bytes]).stream(), error: null }) }; } }) } } }) }, "./accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set([ACCOUNT]) }, "./inrsend/publicationChannelActions": native, "./mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => `/api/media-library/items/${id}/content?token=server-created` } });
  const { createInrAssistantPublishedPublicationTools } = load<typeof import("../../lib/inrAssistantPublishedPublicationTools.ts")>("lib/inrAssistantPublishedPublicationTools.ts");
  const create = (message = statement) => createInrAssistantPublishedPublicationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=fixture", "x-cron-secret": "never-forward" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "basic", supabase: { from: query } as never, currentUserMessage: message, resolvePreview: reference => saved.get(reference) || null });
  const run = async (tools: ReturnType<typeof create>, name: keyof ReturnType<typeof create>, input: unknown) => await tools[name].execute!(input as never, { toolCallId: "published", messages: [] }) as Row;
  const read = () => run(create(), "readPublishedPublicationForEdit", { publicationId: PUBLICATION, channel });
  const preview = async (message = statement, selectedChanges: unknown = changes) => { const view = await read(); const result = await run(create(message), "previewPublishedPublicationEdit", { publicationId: PUBLICATION, channel, sourceVersion: view.sourceVersion, changes: selectedChanges, instructionQuote: message }); if (typeof result.reference === "string") saved.set(result.reference, String(result.token)); return result; };
  const apply = (preview: Row, message = `Confirme ${preview.reference}`, tools = create(message)) => run(tools, "applyPublishedPublicationEdit", { reference: preview.reference, instructionQuote: message });
  return { create, run, read, preview, apply, asset, get payload() { return payload; }, get calls() { return calls; }, get effects() { return effects; }, account() { account = "other"; }, actor() { actor = "other"; }, pending() { status = "processing"; }, change() { currentPost().content = "Autre modification"; }, uncertain() { uncertain = true; }, ignoreMedia() { ignoreMedia = true; }, switchAfter() { afterPatch = () => { account = "other"; }; } };
}

test("Basic published edits read an owned delivered channel and require the exact signed CTA/media preview before any external work", async () => {
  const h = harness(), originalInstagram = structuredClone((h.payload.postByChannel as Row).instagram), preview = await h.preview();
  assert.equal(preview.ok, true); assert.equal(preview.status, "preview_ready"); assert.equal(h.effects, 0);
  assert.equal((await h.apply(preview, "Oui")).ok, false); assert.equal(h.effects, 0);
  const tools = h.create(`Confirme ${preview.reference}`), [first, duplicate] = await Promise.all([h.apply(preview, undefined, tools), h.apply(preview, undefined, tools)]);
  assert.equal(first.ok, true); assert.deepEqual(first, duplicate); assert.equal(h.effects, 1); assert.equal(h.calls, 1);
  assert.equal(((h.payload.postByChannel as Row).facebook as Row).ctaUrl, "https://business.test/offre"); assert.deepEqual((h.payload.postByChannel as Row).instagram, originalInstagram);
  assert.doesNotMatch(JSON.stringify(preview.proposal), /storage_path|server-created|data:image/);
  h.account(); assert.equal((await h.apply(preview, undefined, tools)).ok, false, "cached receipts require active scope again");
});

test("published edit intent refuses help, quoted commands, conditions, draft targets and deletion of the whole publication", async () => {
  for (const message of ["Comment remplacer la photo de cette publication Facebook ?", "Peux-tu m’expliquer comment modifier cette publication Facebook ?", "« Remplace la photo de cette publication Facebook. »", "Si je confirme, remplace la photo de cette publication Facebook.", "Ne modifie pas cette publication Facebook.", "Supprime cette publication Facebook.", "Modifie ce brouillon de publication Facebook.", "Crée une image pour une publication Facebook."]) { const h = harness(); assert.equal((await h.preview(message)).ok, false, message); assert.equal(h.effects, 0); }
  const positive = harness(); assert.equal((await positive.preview("Peux-tu remplacer la photo de cette publication Facebook ?")).ok, true);
});

test("published edit previews and applications refuse stale versions, changed or foreign media and unsupported mixed image order", async () => {
  const stale = harness(), view = await stale.read(); stale.change(); assert.equal((await stale.run(stale.create(), "previewPublishedPublicationEdit", { publicationId: PUBLICATION, channel: "facebook", sourceVersion: view.sourceVersion, changes, instructionQuote: statement })).ok, false);
  for (const mutate of [(h: ReturnType<typeof harness>) => h.change(), (h: ReturnType<typeof harness>) => { h.asset.updated_at = "changed"; }, (h: ReturnType<typeof harness>) => h.account(), (h: ReturnType<typeof harness>) => h.actor(), (h: ReturnType<typeof harness>) => h.pending()]) { const h = harness(), preview = await h.preview(); mutate(h); assert.equal((await h.apply(preview)).ok, false); assert.equal(h.effects, 0); }
  const foreign = harness(); foreign.asset.user_id = "other"; assert.equal((await foreign.preview()).ok, false);
  const order = harness(); await assert.rejects(() => order.preview(statement, [{ field: "media", valueJson: JSON.stringify({ mediaType: "images", images: [{ mediaId: MEDIA }, { currentIndex: 0 }] }) }])); assert.equal(order.effects, 0);
});

test("published edit readback refuses ignored media and changed sessions while durable unknown attempts never repost", async () => {
  for (const mutate of [(h: ReturnType<typeof harness>) => h.ignoreMedia(), (h: ReturnType<typeof harness>) => h.switchAfter()]) { const h = harness(), preview = await h.preview(); mutate(h); assert.equal((await h.apply(preview)).ok, false); assert.equal(h.effects, 1); }
  const uncertain = harness(), preview = await uncertain.preview(); uncertain.uncertain(); assert.equal((await uncertain.apply(preview)).ok, false); assert.equal(uncertain.effects, 1);
  assert.equal((await uncertain.apply(preview)).ok, false, "fresh factory reuses durable native no-retry receipt"); assert.equal(uncertain.effects, 1);
});

test("Basic published SiteWeb formatting uses the exact signed native content patch and readback without a DOM or provider certification claim", async () => {
  const h = harness("site_web"), content = "Offre <strong>Toiture</strong>", originalInstagram = structuredClone((h.payload.postByChannel as Row).instagram);
  const before = await h.read(), preview = await h.preview("Modifie le contenu de cette publication déjà publiée sur mon site web.", [{ field: "content", valueJson: JSON.stringify(content) }]);
  assert.equal(preview.ok, true); assert.equal(preview.status, "preview_ready"); assert.equal(h.effects, 0);
  assert.equal((await h.apply(preview, "Oui")).ok, false); assert.equal(h.effects, 0);
  const applied = await h.apply(preview); assert.equal(applied.ok, true); assert.equal(h.effects, 1); assert.equal(((h.payload.postByChannel as Row).site_web as Row).content, content);
  const after = await h.read(); assert.equal((after.post as Row).content, content); assert.notEqual(after.sourceVersion, before.sourceVersion); assert.deepEqual((h.payload.postByChannel as Row).instagram, originalInstagram);
  assert.match(String(applied.message), /ne constitue pas une vérification indépendante/);
});
