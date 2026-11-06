import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { publicationEditSourceVersion } from "../../lib/inrsend/publicationEditVersion.ts";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", PUBLICATION = "30000000-0000-4000-8000-000000000003", MEDIA = "40000000-0000-4000-8000-000000000004";
const statement = "Remplace la photo et le bouton de cette publication Facebook déjà publiée.";
process.env.INRCY_ASSISTANT_APPROVAL_SECRET = "published-publication-unit-signing-secret-32-characters";
const changes = [{ field: "cta", valueJson: JSON.stringify({ ctaMode: "website", ctaUrl: "https://business.test/offre", cta: "Voir l’offre" }) }, { field: "media", valueJson: JSON.stringify({ mediaType: "images", images: [{ mediaId: MEDIA }] }) }];

function harness(channel: "facebook" | "site_web" | "pinterest" | "instagram" = "facebook") {
  let account = ACCOUNT, actor = ACTOR, status = "delivered", uncertain = false, ignoreMedia = false, afterPatch = () => {}, calls = 0, effects = 0;
  let pinterestRejection: Row | null = null, mediaDownloads = 0;
  const pinterestValidations: { accountId: string; body: Row; current: Row }[] = [];
  let instagramRejection: Row | null = null;
  const instagramValidations: { accountId: string; body: Row; current: Row }[] = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const asset: Row = { id: MEDIA, user_id: ACCOUNT, bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/owned.png`, media_type: "image", mime_type: "image/png", size_bytes: bytes.length, upload_status: "uploaded", updated_at: "2026-11-05", source: "upload", is_active: true, original_file_name: "Offre retouchée.png", title: "Offre", duration_seconds: null };
  let payload: Row = { publication_id: PUBLICATION, channels: [channel, "instagram"], postByChannel: { [channel]: { title: "Titre", content: "Texte", hashtags: [], ctaMode: "none", cta: "", ctaUrl: "", ctaPhone: "", ctaAction: "", images: ["https://owned.test/original.png"], attachments: [{ imageKey: "old", url: "https://owned.test/original.png" }] }, instagram: { content: "Instagram conservé", images: ["https://owned.test/instagram.png"] } }, results: { [channel]: { ok: true, external_id: "native-channel", status: "delivered" }, instagram: { ok: true, external_id: "native-instagram", status: "delivered" } } };
  if (channel === "instagram") (payload.postByChannel as Row).instagram = { title: "Titre", content: "Texte", hashtags: [], ctaMode: "none", cta: "", ctaUrl: "", ctaPhone: "", ctaAction: "", images: ["https://owned.test/original.png"], attachments: [{ imageKey: "old", url: "https://owned.test/original.png" }] };
  const locks = new Map<string, { id: string; result: Row | null }>(), saved = new Map<string, string>();
  const { guardPublishedPublicationEdit } = runtimeModules()<typeof import("../../lib/inrsend/publicationEditGuard.ts")>("lib/inrsend/publicationEditGuard.ts");
  const currentPost = () => (payload.postByChannel as Row)[channel] as Row;
  const readState = async (userId: string, publicationId: string, requestedChannel: string) => {
    if (userId !== ACCOUNT || publicationId !== PUBLICATION || requestedChannel !== channel) return null;
    const post = currentPost(); (payload.results as Row)[channel] = { ...((payload.results as Row)[channel] as Row), status };
    return { publication: { id: PUBLICATION, user_id: ACCOUNT }, event: { id: "event", payload }, eventPayload: payload, deliveries: [{ channel, status }], post, sourceVersion: await publicationEditSourceVersion(ACCOUNT, PUBLICATION, channel, payload), images: { images: post.images as string[], editableAttachments: post.attachments as Row[] }, video: null };
  };
  const native = { readInrSendPublicationEditState: readState, validatePinterestPublicationEdit: async (accountId: string, body: Row, current: Row) => {
    assert.equal(channel, "pinterest", "other channels do not use the Pinterest validation boundary");
    pinterestValidations.push({ accountId, body: structuredClone(body), current: structuredClone(current) });
    return pinterestRejection ? Response.json(pinterestRejection, { status: 400 }) : null;
  }, validateInstagramPublicationEdit: async (accountId: string, body: Row, current: Row) => {
    assert.equal(channel, "instagram", "other channels do not use the Instagram validation boundary");
    instagramValidations.push({ accountId, body: structuredClone(body), current: structuredClone(current) });
    return instagramRejection ? Response.json(instagramRejection, { status: 400 }) : null;
  }, createPublicationChannelHandlers: (requestedChannel: string) => ({ PATCH: async (request: Request) => {
    calls++; assert.equal(requestedChannel, channel); assert.equal(request.headers.get("cookie"), "session=fixture"); assert.equal(request.headers.has("x-cron-secret"), false); const body: Row = await request.json();
    return guardPublishedPublicationEdit({ body, currentScope: async () => account === ACCOUNT && actor === ACTOR, readVersion: async () => (await readState(ACCOUNT, PUBLICATION, channel))!.sourceVersion,
      acquire: async key => { const old = locks.get(key); if (old) return { state: old.result ? "completed" : "running", lock: old }; const lock = { id: key, result: null }; locks.set(key, lock); return { state: "acquired", lock }; }, seal: async (id, result) => { locks.set(id, { id, result }); },
      mutate: async () => { effects++; if (uncertain) throw new Error("response lost after external acceptance"); const before = currentPost(), patch = Object.fromEntries(Object.entries(body).filter(([key]) => ["title", "content", "hashtags", "cta", "ctaMode", "ctaUrl", "ctaPhone", "ctaAction"].includes(key)));
        const media = body.mediaType === "images" && !ignoreMedia ? {
          images: [...body.retainedImages as string[], ...(body.newImages as Row[]).map((_, index) => `https://owned.test/saved-${index}.png`)],
          attachments: [
            ...(body.retainedImages as string[]).map(url => (before.attachments as Row[]).find(image => image.url === url) || { url }),
            ...(body.newImages as Row[]).map((image, index) => ({ imageKey: image.imageKey, url: `https://owned.test/saved-${index}.png` })),
          ],
        } : {};
        payload = { ...payload, postByChannel: { ...payload.postByChannel as Row, [channel]: { ...before, ...patch, ...media } }, results: { ...payload.results as Row, [channel]: { ok: true, external_id: "new-native-channel", status: "delivered" } } }; afterPatch(); return Response.json({ ok: true, publication_id: PUBLICATION, channel }); },
    });
  } }) };
  const query = () => { const criteria = new Map<string, unknown>(); const api = { select: () => api, eq: (key: string, value: unknown) => { criteria.set(key, value); return api; }, neq: () => api, abortSignal: () => api, maybeSingle: async () => ({ data: criteria.get("id") === MEDIA ? { ...asset } : null, error: null }) }; return api; };
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor, supabase: { storage: { from: (bucket: string) => ({ download: (path: string) => { mediaDownloads++; assert.equal(bucket, "inrcy-pro-media"); assert.equal(path, asset.storage_path); return { asStream: async () => ({ data: new Blob([bytes]).stream(), error: null }) }; } }) } } }) }, "./accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set([ACCOUNT]) }, "./inrsend/publicationChannelActions": native, "./mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => `/api/media-library/items/${id}/content?token=server-created` } });
  const { createInrAssistantPublishedPublicationTools } = load<typeof import("../../lib/inrAssistantPublishedPublicationTools.ts")>("lib/inrAssistantPublishedPublicationTools.ts");
  const create = (message = statement) => createInrAssistantPublishedPublicationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=fixture", "x-cron-secret": "never-forward" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "basic", supabase: { from: query } as never, currentUserMessage: message, resolvePreview: reference => saved.get(reference) || null });
  const run = async (tools: ReturnType<typeof create>, name: keyof ReturnType<typeof create>, input: unknown) => await tools[name].execute!(input as never, { toolCallId: "published", messages: [] }) as Row;
  const read = () => run(create(), "readPublishedPublicationForEdit", { publicationId: PUBLICATION, channel });
  const preview = async (message = statement, selectedChanges: unknown = changes) => { const view = await read(); const result = await run(create(message), "previewPublishedPublicationEdit", { publicationId: PUBLICATION, channel, sourceVersion: view.sourceVersion, changes: selectedChanges, instructionQuote: message }); if (typeof result.reference === "string") saved.set(result.reference, String(result.token)); return result; };
  const apply = (preview: Row, message = `Confirme ${preview.reference}`, tools = create(message)) => run(tools, "applyPublishedPublicationEdit", { reference: preview.reference, instructionQuote: message });
  return { create, run, read, preview, apply, asset, pinterestValidations, instagramValidations, get mediaDownloads() { return mediaDownloads; }, get previewCount() { return saved.size; }, rejectPinterest(issue: Row | null) { pinterestRejection = issue; }, rejectInstagram(issue: Row | null) { instagramRejection = issue; }, get payload() { return payload; }, get calls() { return calls; }, get effects() { return effects; }, account() { account = "other"; }, actor() { actor = "other"; }, pending() { status = "processing"; }, change() { currentPost().content = "Autre modification"; }, uncertain() { uncertain = true; }, ignoreMedia() { ignoreMedia = true; }, switchAfter() { afterPatch = () => { account = "other"; }; } };
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

const pinterestStatement = "Modifie le texte, le bouton et les images de cette publication Pinterest déjà publiée.";
const pinterestTextIssue = {
  ok: false, code: "pinterest_description_too_long", field: "description", length: 842, limit: 800, excess: 42,
  error: "Votre description Pinterest est trop longue de 42 caractères. Raccourcissez-la pour enregistrer vos modifications.",
};
const pinterestChanges = (content: string) => [
  { field: "content", valueJson: JSON.stringify(content) },
  { field: "cta", valueJson: JSON.stringify({ ctaMode: "website", ctaUrl: "https://business.test/offre", cta: "Voir l’offre" }) },
  { field: "media", valueJson: JSON.stringify({ mediaType: "images", images: [{ currentIndex: 0 }, { mediaId: MEDIA }] }) },
];

test("Pinterest edit preview preserves the native text refusal before any signed proposal, media download or PATCH, then accepts a corrected proposal", async () => {
  const h = harness("pinterest"), before = await h.read();
  h.rejectPinterest(pinterestTextIssue);
  const refused = await h.preview(pinterestStatement, pinterestChanges("Texte à raccourcir"));
  assert.equal(refused.ok, false); assert.equal(refused.status, "invalid_input");
  assert.equal(refused.message, pinterestTextIssue.error);
  for (const field of ["code", "field", "length", "limit", "excess"] as const) assert.equal(refused[field], pinterestTextIssue[field]);
  assert.equal(refused.reference, undefined); assert.equal(refused.token, undefined); assert.equal(h.previewCount, 0);
  assert.equal(h.calls, 0); assert.equal(h.effects, 0); assert.equal(h.mediaDownloads, 0);
  assert.equal(h.pinterestValidations.length, 1);
  const validation = h.pinterestValidations[0];
  assert.equal(validation.accountId, ACCOUNT);
  assert.deepEqual(validation.body, {
    content: "Texte à raccourcir", ctaMode: "website", ctaUrl: "https://business.test/offre", cta: "Voir l’offre",
    mediaType: "images", retainedImages: ["https://owned.test/original.png"], newImages: [],
  });
  assert.equal(validation.current.sourceVersion, before.sourceVersion);
  assert.equal((validation.current.publication as Row).id, PUBLICATION);
  assert.equal((validation.current.post as Row).title, "Titre", "native validation receives the unchanged source fields too");
  h.rejectPinterest(null);
  const corrected = await h.preview(pinterestStatement, pinterestChanges("Texte corrigé"));
  assert.equal(corrected.ok, true); assert.equal(corrected.status, "preview_ready");
  assert.equal(h.previewCount, 1); assert.equal(h.pinterestValidations.length, 2);
  assert.equal((await h.read()).sourceVersion, before.sourceVersion, "validation refusal does not consume or change the publication version");
  assert.equal(h.calls, 0); assert.equal(h.effects, 0); assert.equal(h.mediaDownloads, 0);
});

test("Pinterest signed edit rechecks native text validation before downloading selected media or calling PATCH", async () => {
  const h = harness("pinterest"), preview = await h.preview(pinterestStatement, pinterestChanges("Texte préparé"));
  assert.equal(preview.ok, true); assert.equal(h.pinterestValidations.length, 1);
  h.rejectPinterest(pinterestTextIssue);
  const refused = await h.apply(preview);
  assert.equal(refused.ok, false); assert.equal(refused.status, "invalid_input"); assert.equal(refused.code, pinterestTextIssue.code);
  assert.equal(refused.message, pinterestTextIssue.error); assert.equal(refused.excess, 42);
  assert.equal(h.pinterestValidations.length, 2); assert.equal(h.mediaDownloads, 0); assert.equal(h.calls, 0); assert.equal(h.effects, 0);
  assert.deepEqual(h.pinterestValidations[1].body.retainedImages, ["https://owned.test/original.png"]);
  assert.equal(h.pinterestValidations[1].body.mediaType, "images");
  h.rejectPinterest(null);
  const corrected = await h.preview(pinterestStatement, pinterestChanges("Texte corrigé après vérification"));
  assert.equal(corrected.ok, true);
  assert.equal((await h.apply(corrected)).ok, true);
  assert.equal(h.calls, 1); assert.equal(h.effects, 1); assert.equal(h.mediaDownloads, 1);
});

test("Pinterest tool accepts content above the former 500-character ceiling when its native final-text validator accepts it", async () => {
  const h = harness("pinterest"), content = "x".repeat(600);
  const preview = await h.preview("Modifie le texte de cette publication Pinterest déjà publiée.", [{ field: "content", valueJson: JSON.stringify(content) }]);
  assert.equal(preview.ok, true); assert.equal(h.pinterestValidations.length, 1);
  assert.equal(h.pinterestValidations[0].body.content, content);
  assert.equal(Object.hasOwn(h.pinterestValidations[0].body, "mediaType"), false, "an unchanged media selection is left to the current native state");
  assert.equal((await h.apply(preview)).ok, true); assert.equal(h.pinterestValidations.length, 2);
  assert.equal(((h.payload.postByChannel as Row).pinterest as Row).content, content);
  assert.equal(h.calls, 1); assert.equal(h.effects, 1); assert.equal(h.mediaDownloads, 0);
});

test("other published channels keep their existing flow without consulting Pinterest text validation", async () => {
  for (const channel of ["facebook", "site_web"] as const) {
    const h = harness(channel); h.rejectPinterest(pinterestTextIssue);
    const preview = await h.preview("Modifie le texte de cette publication déjà publiée.", [{ field: "content", valueJson: JSON.stringify("Texte corrigé") }]);
    assert.equal(preview.ok, true); assert.equal((await h.apply(preview)).ok, true);
    assert.equal(h.pinterestValidations.length, 0); assert.equal(h.calls, 1); assert.equal(h.effects, 1);
  }
});

const instagramStatement = "Modifie le texte, le bouton et les images de cette publication Instagram déjà publiée.";
const instagramTextIssue = { ok: false, code: "instagram_caption_too_long", field: "caption", length: 2242, limit: 2200, excess: 42, error: "Votre légende Instagram est trop longue de 42 caractères. Raccourcissez-la pour enregistrer vos modifications." };

test("Instagram edit preview validates the full native caption before signing or downloading and a corrected source can be applied exactly once", async () => {
  const h = harness("instagram"), before = await h.read();
  h.rejectInstagram(instagramTextIssue);
  const refused = await h.preview(instagramStatement, pinterestChanges("Texte à raccourcir"));
  assert.equal(refused.ok, false); assert.equal(refused.status, "invalid_input");
  for (const key of ["code", "field", "length", "limit", "excess"] as const) assert.equal(refused[key], instagramTextIssue[key]);
  assert.equal(refused.message, instagramTextIssue.error);
  assert.equal(h.previewCount, 0); assert.equal(h.mediaDownloads, 0); assert.equal(h.calls, 0); assert.equal(h.effects, 0);
  assert.equal(h.pinterestValidations.length, 0);
  assert.equal(h.instagramValidations[0].current.sourceVersion, before.sourceVersion);
  assert.deepEqual(h.instagramValidations[0].body.retainedImages, ["https://owned.test/original.png"]);
  assert.equal((await h.read()).sourceVersion, before.sourceVersion);
  h.rejectInstagram(null);
  const corrected = await h.preview(instagramStatement, pinterestChanges("Texte corrigé"));
  assert.equal(corrected.ok, true);
  assert.equal((await h.apply(corrected)).ok, true);
  await h.apply(corrected);
  assert.equal(h.effects, 1); assert.equal(h.mediaDownloads, 1, "the correction is not downloaded or submitted a second time");
});

test("Instagram signed correction rechecks the native complete caption before media work and PATCH", async () => {
  const h = harness("instagram"), preview = await h.preview(instagramStatement, pinterestChanges("Texte préparé"));
  assert.equal(preview.ok, true); assert.equal(h.instagramValidations.length, 1);
  h.rejectInstagram(instagramTextIssue);
  const refused = await h.apply(preview);
  assert.equal(refused.ok, false); assert.equal(refused.status, "invalid_input"); assert.equal(refused.code, "instagram_caption_too_long");
  assert.equal(h.instagramValidations.length, 2); assert.equal(h.mediaDownloads, 0); assert.equal(h.calls, 0); assert.equal(h.effects, 0);
});

test("Instagram manual published edits may use more than the generated-body budget when the full native caption remains valid", async () => {
  const h = harness("instagram"), content = "x".repeat(1900);
  const preview = await h.preview("Modifie le texte de cette publication Instagram déjà publiée.", [{ field: "content", valueJson: JSON.stringify(content) }]);
  assert.equal(preview.ok, true); assert.equal(h.instagramValidations.length, 1);
  assert.equal(h.instagramValidations[0].body.content, content);
  assert.equal((await h.apply(preview)).ok, true); assert.equal(h.effects, 1);
  assert.equal(((h.payload.postByChannel as Row).instagram as Row).content, content);
});
