import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = Record<string, unknown>;
const nativePath = "lib/inrsend/publicationChannelActions.ts";
const boosterPath = "app/api/booster/publish-now/route.ts";
function functionNode(name: string, file = nativePath) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(found, name);
  return { ast, found };
}
function evaluateFunction(code: string, deps: Row) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps);
}
function actualFunction(name: string, deps: Row, file = nativePath) {
  const { ast, found } = functionNode(name, file);
  return evaluateFunction(`(${found.getText(ast).replace(/^export\s+/, "")})`, deps);
}
function nativeContextErrorClass() {
  const { ast } = functionNode("loadPublicationCtaContext");
  const node = ast.statements.find(value => ts.isClassDeclaration(value) && value.name?.text === "PublicationCtaContextUnavailableError");
  assert.ok(node);
  return evaluateFunction(`(${node.getText(ast)})`, {});
}
const load = runtimeModules();
const captionRules = load<typeof import("../../lib/boosterCta.ts")>("lib/boosterCta.ts");
const imageInteraction = load<typeof import("../../lib/boosterImageInteractionCta.ts")>("lib/boosterImageInteractionCta.ts");
const imageMetadata = load<typeof import("../../lib/imageInteractions.ts")>("lib/imageInteractions.ts");
const { normalizePublicationEditHashtag } = load<typeof import("../../lib/inrsend/publicationEditVersion.ts")>("lib/inrsend/publicationEditVersion.ts");
const { guardPublishedPublicationEdit } = load<typeof import("../../lib/inrsend/publicationEditGuard.ts")>("lib/inrsend/publicationEditGuard.ts");
const VERSION = "a".repeat(64);

function nativeHarness() {
  let effects = 0, seals = 0, captures = 0, validScope = true, version = VERSION, beforeValidation = () => {};
  const locks = new Map<string, { id: string; result: Row | null }>();
  const state = { post: { title: "", content: "", cta: "", ctaMode: "none", hashtags: [] }, images: { images: ["https://cdn.example.test/retained.jpg"], editableAttachments: [{}] as unknown[] }, sourceVersion: VERSION };
  const deps: Row = { ...captionRules, ...imageInteraction, NextResponse: Response, normalizeHashtag: normalizePublicationEditHashtag,
    loadPublicationCtaContext: async () => { beforeValidation(); return { websiteUrl: "https://business.example.test/", phone: "+33123456789" }; },
    captureApiException: () => { captures++; },
  };
  for (const name of ["asRecord", "buildPublicationEditPost", "normalizePublicationMediaType", "instagramCaptionIssueResponse"]) deps[name] = actualFunction(name, deps);
  const validate = actualFunction("validateInstagramPublicationEdit", deps) as (account: string, body: Row, current: unknown) => Promise<Response | null>;
  const run = (patch: Row) => {
    const body = { expectedState: VERSION, operationKey: "instagram-edit-operation", mediaType: "images", ...patch };
    return guardPublishedPublicationEdit({ body, currentScope: async () => validScope, readVersion: async () => version,
      validate: () => validate("owned-account", body, state),
      acquire: async key => { const old = locks.get(key); if (old) return { state: old.result ? "completed" : "running", lock: old }; const lock = { id: key, result: null }; locks.set(key, lock); return { state: "acquired", lock }; },
      seal: async (id, result) => { seals++; locks.set(id, { id, result }); },
      mutate: async () => { effects++; return Response.json({ ok: true, publication_id: "owned-publication", channel: "instagram" }); },
    });
  };
  return { run, validate, state, locks, get effects() { return effects; }, get seals() { return seals; }, get captures() { return captures; },
    stale() { version = "b".repeat(64); }, changeScopeDuringValidation() { beforeValidation = () => { validScope = false; }; } };
}

test("Instagram native edit rejects 2201 before locking, then accepts the same version corrected to 2200 exactly once", async () => {
  const h = nativeHarness(), refused = await h.run({ content: "a".repeat(2201) });
  assert.equal(refused.status, 400);
  const issue = await refused.json();
  assert.equal(issue.code, "instagram_caption_too_long"); assert.equal(issue.field, "caption");
  assert.equal(issue.length, 2201); assert.equal(issue.limit, 2200); assert.equal(issue.excess, 1);
  assert.match(issue.error, /trop longue de 1 caractère\./);
  assert.equal(h.effects, 0); assert.equal(h.locks.size, 0); assert.equal(h.seals, 0);
  assert.equal((await h.run({ content: "a".repeat(2200) })).status, 200);
  assert.equal(h.effects, 1); assert.equal(h.seals, 2);
  assert.equal((await (await h.run({ content: "a".repeat(2200) })).json()).cachedReceipt, true);
  assert.equal(h.effects, 1);
  assert.equal((await h.run({ content: "another correction" })).status, 409);
  assert.equal(h.effects, 1, "a real provider attempt still seals its source version");
});

test("Instagram native edit counts title, CTA destinations and hashtags without silently dropping selected copy", async () => {
  for (const patch of [
    { title: "t".repeat(100), content: "b".repeat(2100) },
    { content: "b".repeat(2190), ctaMode: "call", ctaPhone: "+33123456789", cta: "Appelez-nous" },
    { content: "b".repeat(2190), ctaMode: "website", ctaUrl: "https://business.example.test/offre", cta: "Voir notre offre" },
    { content: "b".repeat(2198), hashtags: ["#renovation"] },
  ]) {
    const h = nativeHarness(), refused = await h.run(patch);
    assert.equal(refused.status, 400); assert.equal((await refused.json()).code, "instagram_caption_too_long");
    assert.equal(h.effects, 0); assert.equal(h.locks.size, 0);
    assert.equal((await h.run({ content: "Texte corrigé", title: "Titre", hashtags: ["#renovation"] })).status, 200);
  }
  const h = nativeHarness();
  assert.equal((await h.run({ content: "🙂".repeat(1100) })).status, 200, "the conservative shared UTF-16 budget is preserved");
  const overflow = nativeHarness(); assert.equal((await overflow.run({ content: "🙂".repeat(1100) + "a" })).status, 400);
});

test("Instagram native validation resolves the actual first selected image interaction and respects cleared images or videos", async () => {
  const h = nativeHarness();
  const image = { dataUrl: "data:image/jpeg;base64,AQ==", imageMeta: { interactions: { version: 1, items: [{ text: "Consultez notre offre", linkUrl: "https://business.example.test/offre" }] } } };
  assert.equal((await h.run({ content: "b".repeat(2190), retainedImages: [], newImages: [image] })).status, 400);
  assert.equal(h.locks.size, 0);
  h.state.images.editableAttachments[0] = image;
  assert.equal((await h.run({ content: "b".repeat(2190), newImages: [] })).status, 400);
  assert.equal((await h.run({ content: "b".repeat(2190), retainedImages: [], newImages: [] })).status, 200, "cleared selections do not borrow the original image CTA");
  const video = nativeHarness(); video.state.images.editableAttachments[0] = image;
  assert.equal((await video.run({ content: "b".repeat(2200), mediaType: "video" })).status, 200, "video captions do not inherit another image's interaction");
});

test("Instagram text validation preserves source and active-account checks before any durable receipt", async () => {
  for (const change of [(h: ReturnType<typeof nativeHarness>) => h.stale(), (h: ReturnType<typeof nativeHarness>) => h.changeScopeDuringValidation()]) {
    const h = nativeHarness(); change(h);
    assert.equal((await h.run({ content: "Texte" })).status, 409);
    assert.equal(h.effects, 0); assert.equal(h.seals, 0); assert.equal(h.locks.size, 0);
  }
});

test("the actual Instagram PATCH returns a normal validation error before lock acquisition, media preparation or Sentry", async () => {
  const h = nativeHarness(); let acquisitions = 0, captures = 0;
  const deps: Row = { NextResponse: Response, guardPublishedPublicationEdit,
    requireUser: async () => ({ activeUserId: "owned-account", authUserId: "owned-actor", errorResponse: null }),
    readInrSendPublicationEditState: async () => h.state, validateInstagramPublicationEdit: h.validate,
    loadPublicationCtaContext: async () => ({ websiteUrl: "https://business.example.test/", phone: "+33123456789", siteWebUrl: "https://business.example.test/", proSettings: {} }),
    acquireExecutionIdempotencyLock: async () => { acquisitions++; throw new Error("validation must precede lock"); },
    completeExecutionIdempotencyLockOrThrow: async () => { throw new Error("validation must precede receipt"); },
    captureApiException: () => { captures++; }, supabaseAdmin: {},
  };
  deps.asRecord = actualFunction("asRecord", deps);
  const handlers = actualFunction("createPublicationChannelHandlers", deps) as (channel: string) => { PATCH: (request: Request, context: { params: Promise<{ publicationId: string }> }) => Promise<Response> };
  const response = await handlers("instagram").PATCH(new Request("https://app.example.test/api/inrsend/publications/owned-publication/instagram", { method: "PATCH", body: JSON.stringify({ expectedState: VERSION, operationKey: "native-instagram-route", mediaType: "images", content: "a".repeat(2201) }) }), { params: Promise.resolve({ publicationId: "owned-publication" }) });
  assert.equal(response.status, 400); assert.equal((await response.json()).code, "instagram_caption_too_long");
  assert.equal(acquisitions, 0); assert.equal(captures, 0); assert.equal(h.effects, 0);
});

test("the actual Instagram replacement block validates before deleting the old publication or refreshing its token", async () => {
  const { ast, found } = functionNode("replaceChannelDelivery");
  const block = found.body!.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === 'channel === "instagram"');
  assert.ok(block && ts.isIfStatement(block) && ts.isBlock(block.thenStatement));
  let deletions = 0, tokenRefreshes = 0;
  const deps: Row = { ...captionRules, nextPost: { content: "x".repeat(2201) }, websiteUrl: "", phone: "",
    deleteInstagramMediaWithFallback: async () => { deletions++; return { ok: true }; },
    ensureMetaDirectAccessToken: async () => { tokenRefreshes++; return "fixture-token"; },
  };
  const executeBlock = evaluateFunction(`(async function () ${block.thenStatement.getText(ast)})`, deps) as () => Promise<unknown>;
  await assert.rejects(executeBlock, /légende Instagram est trop longue de 1 caractère/);
  assert.equal(deletions, 0); assert.equal(tokenRefreshes, 0);
});

function boosterHarness() {
  const reads: { table: string; filters: [string, unknown][] }[] = [];
  let metadata: Row[] = [], workspaceVisible = true, websiteUrl = "https://business.example.test/", phone = "+33123456789";
  const deps: Row = { ...captionRules, ...imageInteraction, ...imageMetadata, NextResponse: Response,
    isLegacyMediaTransportCutoverEnabled: () => true,
    supabaseAdmin: { from: (table: string) => {
      const read = { table, filters: [] as [string, unknown][] }; reads.push(read);
      const result = () => ({ data: table === "profiles" ? { phone } : table === "pro_tools_configs" ? { settings: { site_web: { url: websiteUrl } } } : table === "publication_workspaces" ? workspaceVisible ? { id: "workspace" } : null : metadata, error: null });
      const query = { select: () => query, eq: (key: string, value: unknown) => { read.filters.push([key, value]); return query; }, maybeSingle: async () => result(), order: async () => result() };
      return query;
    } },
  };
  deps.asRecord = actualFunction("asRecord", deps);
  deps.normalizePublicationMediaType = actualFunction("normalizePublicationMediaType", deps);
  Object.assign(deps, load<typeof import("../../lib/boosterFormatting.ts")>("lib/boosterFormatting.ts"), load<typeof import("../../lib/boosterChannelRules.ts")>("lib/boosterChannelRules.ts"), load<typeof import("../../lib/siteWebChannel.ts")>("lib/siteWebChannel.ts"), load<typeof import("../../lib/boosterCtaPreferences.ts")>("lib/boosterCtaPreferences.ts"));
  deps.normalizeHashtag = normalizePublicationEditHashtag;
  deps.createPublishNowPostResolver = actualFunction("createPublishNowPostResolver", deps, "app/api/booster/publish-now/publishNow.channel-context.ts");
  const validate = actualFunction("validateBoosterInstagramPublication", deps, boosterPath) as (account: string, body: Row, placements: string[], onValidatedContext?: (context: Readonly<{ websiteUrl: string; phone: string }>) => void) => Promise<Response | null>;
  return { validate, reads, metadata(value: Row[]) { metadata = value; }, foreignWorkspace() { workspaceVisible = false; }, changeContext() { websiteUrl = `https://business.example.test/${"longer-new-default/".repeat(20)}`; phone = "+442012345678"; } };
}

test("Booster validates the complete Instagram caption without submitting a job and exempts caption-free Stories only", async () => {
  const h = boosterHarness(), body = { post: { title: "", content: "a".repeat(2201), ctaMode: "none", hashtags: [] }, mediaType: "video" };
  const refused = await h.validate("owned-account", body, ["classic"]); assert.equal(refused?.status, 400);
  assert.equal((await refused!.json()).code, "instagram_caption_too_long");
  assert.equal(await h.validate("owned-account", { ...body, post: { ...body.post, content: "a".repeat(2200) } }, ["reel"]), null);
  const story = boosterHarness(); assert.equal(await story.validate("owned-account", body, ["story"]), null); assert.equal(story.reads.length, 0);
  assert.equal((await h.validate("owned-account", body, ["reel", "story"]))?.status, 400);
  for (const read of h.reads) assert.ok(["profiles", "pro_tools_configs"].includes(read.table), "validation is limited to read-only context queries");
});

test("Booster caption preflight reads only the active account's ordered image metadata and preserves explicit channel image selections", async () => {
  const h = boosterHarness();
  h.metadata([{ position: 0, media_settings: { source_metadata: { interactions: { version: 1, items: [{ text: "Notre offre", linkUrl: "https://business.example.test/offre" }] } } }, pro_media_library: { user_id: "owned-account", media_type: "image", media_metadata: {} } }]);
  const body = { post: { title: "", content: "a".repeat(2190), ctaMode: "none", hashtags: [] }, mediaType: "images", mediaWorkspaceId: "workspace", mediaPipelineCutoverV1: true };
  const refused = await h.validate("owned-account", body, ["classic"]); assert.equal(refused?.status, 400);
  const workspaceRead = h.reads.find(read => read.table === "publication_workspaces")!;
  assert.deepEqual(workspaceRead.filters, [["id", "workspace"], ["account_id", "owned-account"]]);
  const imageRead = h.reads.find(read => read.table === "publication_workspace_media")!;
  assert.deepEqual(imageRead.filters, [["workspace_id", "workspace"], ["pro_media_library.user_id", "owned-account"]]);
  assert.equal(await h.validate("owned-account", { ...body, mediaPipelineCutoverV1: false, imagesByChannel: { instagram: [] } }, ["classic"]), null);
  h.foreignWorkspace(); assert.equal((await h.validate("owned-account", body, ["classic"]))?.status, 503);
});

test("Booster calls caption preflight before durable ingress, parent lock acquisition and preparation", () => {
  const { ast, found } = functionNode("publishNowHandler", boosterPath);
  const calls = new Map<string, number[]>();
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text; calls.set(name, [...calls.get(name) || [], node.getStart(ast)]);
  } ts.forEachChild(node, visit); };
  visit(found);
  const validation = calls.get("validateBoosterInstagramPublication"); assert.equal(validation?.length, 1);
  for (const name of ["enqueueBoosterPublication", "acquireExecutionIdempotencyLock", "prepareWorkspaceMediaForPublication", "prepareBoosterImagesByChannelOnServer", "uploadImageSet"]) {
    assert.ok(calls.get(name)?.length, name);
    assert.ok(validation![0] < Math.min(...calls.get(name)!), `${name} must follow read-only caption validation`);
  }
});

test("published Instagram replacement uses its accepted request-local CTA snapshot even if the profile changes before the provider call", async () => {
  const h = nativeHarness();
  let currentContext = { websiteUrl: "https://b.test/", phone: "+33123456789", siteWebUrl: "https://b.test/", proSettings: {} };
  let contextReads = 0, providerCalls = 0, deletes = 0;
  const loadContext = async () => { contextReads++; return { ...currentContext }; };
  const snapshot = Object.freeze(await loadContext());
  const body = { content: "a".repeat(2130), ctaMode: "website", cta: "Notre offre", mediaType: "images" };
  const deps: Row = { ...captionRules, ...imageInteraction, NextResponse: Response, normalizeHashtag: normalizePublicationEditHashtag,
    loadPublicationCtaContext: loadContext,
    getLatestIntegrationRow: async () => ({ status: "connected", resource_id: "ig-user", access_token_enc: "fixture", meta: {} }),
    resolveInstagramAuthMode: () => "facebook_login",
    getChannelConnectionStates: async () => ({ instagram: { connected: true } }),
    getAppBubbleAccessMapForUser: async () => ({}), isBubbleEnabled: () => true,
    isOfficialPublicationChannelConnected: () => true,
    CHANNEL_LABELS: { instagram: "Instagram" }, CHANNEL_BUBBLE_KEYS: { instagram: "instagram" }, supabaseAdmin: {},
    getPublicationVideo: () => null, tryDecryptToken: () => "fixture-token",
    buildInstagramDeleteTokenCandidates: () => [],
    deleteInstagramMediaWithFallback: async () => { deletes++; return { ok: true }; }, logInstagramAction: async () => {},
    instagramPublishImagesBestEffortWithTokenFallback: async (request: Row) => {
      providerCalls++; assert.equal(request.caption, expected.caption); assert.ok(String(request.caption).includes(snapshot.websiteUrl));
      return { ok: true, mediaId: "new-instagram-id", publishedImageCount: 1, mediaType: "IMAGE" };
    },
    getInstagramPartialImagesWarning: () => null,
  };
  for (const name of ["asRecord", "buildPublicationEditPost", "normalizePublicationMediaType", "getInstagramImageSelection", "instagramCaptionIssueResponse"]) deps[name] = actualFunction(name, deps);
  const post = (deps.buildPublicationEditPost as (post: Row, patch: Row) => Row)(h.state.post, body);
  const expected = captionRules.getBoosterInstagramCaptionState(post, snapshot);
  assert.equal(expected.issue, null);
  const validate = actualFunction("validateInstagramPublicationEdit", deps) as (account: string, patch: Row, state: unknown, context: unknown) => Promise<Response | null>;
  assert.equal(await validate("owned-account", body, h.state, snapshot), null);
  currentContext = { ...currentContext, websiteUrl: `https://b.test/${"new-and-long/".repeat(30)}`, phone: "+442012345678" };
  assert.ok(captionRules.getBoosterInstagramCaptionState(post, currentContext).issue, "re-reading the changed defaults would now overflow");
  const replace = actualFunction("replaceChannelDelivery", deps) as (params: Row) => Promise<Row>;
  const locks = new Map<string, { id: string; result: Row | null }>();
  const run = () => guardPublishedPublicationEdit({ body: { ...body, expectedState: VERSION, operationKey: "snapshot-edit" },
    currentScope: async () => true, readVersion: async () => VERSION,
    validate: () => validate("owned-account", body, h.state, snapshot),
    acquire: async key => { const old = locks.get(key); if (old) return { state: old.result ? "completed" : "running", lock: old }; const lock = { id: key, result: null }; locks.set(key, lock); return { state: "acquired", lock }; },
    seal: async (key, result) => { locks.set(key, { id: key, result }); },
    mutate: async () => {
      const result = await replace({ userId: "owned-account", publicationId: "owned-publication", channel: "instagram", previousExternalId: "old-instagram-id", publication: {}, eventPayload: { results: { instagram: {} } }, nextPost: post, mediaType: "images", ctaContext: snapshot,
        imageSet: { images: ["https://media.example.test/image.jpg"], instagramPublishableUrls: [], socialFeedPublishableUrls: [], siteCardPublishableUrls: [], gmbPublishableUrls: [] } });
      assert.equal(result.status, "delivered"); return Response.json({ ok: true, publication_id: "owned-publication", channel: "instagram" });
    },
  });
  assert.equal((await run()).status, 200); assert.equal((await run()).status, 200);
  assert.equal(contextReads, 1); assert.equal(providerCalls, 1); assert.equal(deletes, 1);
});

test("native Instagram and Pinterest reject unknown profile defaults before any lock rather than validating empty contact data", async () => {
  const ContextError = nativeContextErrorClass();
  const preferences = load<typeof import("../../lib/boosterCtaPreferences.ts")>("lib/boosterCtaPreferences.ts");
  for (const channel of ["instagram", "pinterest"]) for (const failedTable of ["profiles", "pro_tools_configs"]) {
    let acquisitions = 0, captures = 0;
    const h = nativeHarness();
    const deps: Row = { NextResponse: Response, PublicationCtaContextUnavailableError: ContextError, guardPublishedPublicationEdit, ...preferences,
      requireUser: async () => ({ activeUserId: "owned-account", authUserId: "owned-actor", errorResponse: null }),
      readInrSendPublicationEditState: async () => h.state,
      validateInstagramPublicationEdit: h.validate, validatePinterestPublicationEdit: h.validate,
      acquireExecutionIdempotencyLock: async () => { acquisitions++; throw new Error("unknown defaults must not acquire"); },
      captureApiException: () => { captures++; },
      supabaseAdmin: { from: (table: string) => ({ select: () => ({ eq: (key: string, account: string) => {
        assert.equal(key, "user_id"); assert.equal(account, "owned-account");
        return { maybeSingle: async () => ({ data: null, error: table === failedTable ? { message: "private database detail" } : null }) };
      } }) }) },
    };
    deps.asRecord = actualFunction("asRecord", deps);
    deps.loadPublicationCtaContext = actualFunction("loadPublicationCtaContext", deps);
    const handlers = actualFunction("createPublicationChannelHandlers", deps) as (channel: string) => { PATCH: (request: Request, context: { params: Promise<{ publicationId: string }> }) => Promise<Response> };
    const response = await handlers(channel).PATCH(new Request(`https://app.example.test/api/inrsend/publications/owned-publication/${channel}`, { method: "PATCH", body: JSON.stringify({ expectedState: VERSION, operationKey: "unknown-defaults", content: "Texte court", mediaType: "images" }) }), { params: Promise.resolve({ publicationId: "owned-publication" }) });
    assert.equal(response.status, 503); const issue = await response.json(); assert.equal(issue.code, "publication_caption_context_unavailable");
    assert.doesNotMatch(JSON.stringify(issue), /private database/); assert.equal(acquisitions, 0); assert.equal(captures, 0);
  }
});

test("Booster passes the same accepted CTA snapshot to its final Instagram caption after profile defaults change", async () => {
  const h = boosterHarness(), body = { post: { title: "", content: "a".repeat(2130), ctaMode: "website", cta: "Notre offre", hashtags: [] }, mediaType: "video" };
  let snapshot: Readonly<{ websiteUrl: string; phone: string }> | undefined;
  assert.equal(await h.validate("owned-account", body, ["classic"], value => { snapshot = value; }), null);
  assert.ok(snapshot); assert.equal(Object.isFrozen(snapshot), true);
  const accepted = captionRules.getBoosterInstagramCaptionState(body.post, snapshot); assert.equal(accepted.issue, null);
  const reads = h.reads.length; h.changeContext();
  assert.equal(captionRules.getBoosterInstagramCaptionState(body.post, snapshot).caption, accepted.caption);
  assert.equal(h.reads.length, reads);
  const { ast, found } = functionNode("publishNowHandler", boosterPath);
  const text = found.getText(ast);
  assert.match(text, /getBoosterInstagramCaptionState\(channelPost, validatedInstagramCtaContext \?\?/);
  assert.match(text, /validatedInstagramCtaContext = context/);
});
