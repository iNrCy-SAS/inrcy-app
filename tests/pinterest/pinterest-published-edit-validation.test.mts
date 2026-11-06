import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = Record<string, unknown>;
const nativePath = "lib/inrsend/publicationChannelActions.ts";
function actualFunction(name: string, deps: Row) {
  const source = readFileSync(new URL(`../../${nativePath}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(nativePath, source, ts.ScriptTarget.Latest, true);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(ast); assert.ok(found, name);
  const code = ts.transpileModule(`(${found.getText(ast).replace(/^export\s+/, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${code};}})`)(deps);
}

const load = runtimeModules();
const textRules = load<typeof import("../../lib/pinterestTextRules.ts")>("lib/pinterestTextRules.ts");
const interaction = load<typeof import("../../lib/boosterImageInteractionCta.ts")>("lib/boosterImageInteractionCta.ts");
const { normalizePublicationEditHashtag } = load<typeof import("../../lib/inrsend/publicationEditVersion.ts")>("lib/inrsend/publicationEditVersion.ts");
const { guardPublishedPublicationEdit } = load<typeof import("../../lib/inrsend/publicationEditGuard.ts")>("lib/inrsend/publicationEditGuard.ts");
const VERSION = "a".repeat(64);

function harness() {
  let effects = 0, seals = 0, validScope = true, version = VERSION, beforeValidation = () => {};
  const locks = new Map<string, { id: string; result: Row | null }>();
  const state = { post: { title: "", content: "", cta: "", ctaMode: "none", hashtags: [] }, images: { images: ["https://cdn.example.test/retained.jpg"], editableAttachments: [{}] as unknown[] }, sourceVersion: VERSION };
  const deps: Row = { ...textRules, ...interaction, NextResponse: Response, normalizeHashtag: normalizePublicationEditHashtag, loadPublicationCtaContext: async () => { beforeValidation(); return { websiteUrl: "https://example.test/", phone: "0123456789" }; } };
  deps.asRecord = actualFunction("asRecord", deps);
  deps.buildPublicationEditPost = actualFunction("buildPublicationEditPost", deps);
  deps.normalizePublicationMediaType = actualFunction("normalizePublicationMediaType", deps);
  deps.pinterestTextIssueResponse = actualFunction("pinterestTextIssueResponse", deps);
  const validate = actualFunction("validatePinterestPublicationEdit", deps) as (account: string, body: Row, state: unknown) => Promise<Response | null>;
  const run = async (patch: Row) => {
    const body = { expectedState: VERSION, operationKey: "native-edit-operation", mediaType: "images", ...patch };
    return guardPublishedPublicationEdit({ body, currentScope: async () => validScope, readVersion: async () => version, validate: () => validate("owned-account", body, state),
      acquire: async key => { const old = locks.get(key); if (old) return { state: old.result ? "completed" : "running", lock: old }; const lock = { id: key, result: null }; locks.set(key, lock); return { state: "acquired", lock }; },
      seal: async (id, result) => { seals++; locks.set(id, { id, result }); },
      mutate: async () => { effects++; return Response.json({ ok: true, publication_id: "owned-publication", channel: "pinterest" }); },
    });
  };
  return { run, validate, state, locks, get effects() { return effects; }, get seals() { return seals; }, stale() { version = "b".repeat(64); }, changeScopeDuringValidation() { beforeValidation = () => { validScope = false; }; } };
}

test("Pinterest published edit rejects 801 characters before consuming the version, then accepts a corrected 800-character retry exactly once", async () => {
  const h = harness();
  const invalid = await h.run({ content: "a".repeat(801) });
  assert.equal(invalid.status, 400); const message = await invalid.json();
  assert.equal(message.code, "pinterest_description_too_long"); assert.equal(message.length, 801); assert.equal(message.excess, 1);
  assert.match(message.error, /1 caractère\./); assert.equal(h.locks.size, 0); assert.equal(h.seals, 0); assert.equal(h.effects, 0);
  const valid = await h.run({ content: "a".repeat(800) }); assert.equal(valid.status, 200); assert.equal(h.effects, 1); assert.equal(h.seals, 2);
  const repeated = await h.run({ content: "a".repeat(800) }); assert.equal((await repeated.json()).cachedReceipt, true); assert.equal(h.effects, 1);
  assert.equal((await h.run({ content: "different" })).status, 409); assert.equal(h.effects, 1);
});

test("Pinterest published edit validates title, assembled CTA and hashtags without truncating or consuming invalid attempts", async () => {
  for (const [patch, expected] of [
    [{ title: "t".repeat(101), content: "body" }, "pinterest_title_too_long"],
    [{ content: "b".repeat(790), ctaMode: "call", ctaPhone: "0123456789", cta: "Appelez-nous" }, "pinterest_description_too_long"],
    [{ content: "b".repeat(797), hashtags: ["#renovation"] }, "pinterest_description_too_long"],
  ] as const) {
    const h = harness(); const invalid = await h.run(patch); assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, expected);
    assert.equal(h.effects, 0); assert.equal(h.locks.size, 0);
    assert.equal((await h.run({ title: "t".repeat(100), content: "corrigé" })).status, 200); assert.equal(h.effects, 1);
  }
  const h = harness(); assert.equal((await h.run({ content: "🙂".repeat(800) })).status, 200);
});

test("Pinterest validation counts the first selected image interaction in native retained-then-new order", async () => {
  const h = harness();
  const interactionImage = { dataUrl: "data:image/jpeg;base64,AQ==", imageMeta: { interactions: { version: 1, items: [{ text: "Consultez notre offre", linkUrl: "https://example.test/offre" }] } } };
  const invalid = await h.run({ content: "b".repeat(790), retainedImages: [], newImages: [interactionImage] });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, "pinterest_description_too_long"); assert.equal(h.locks.size, 0);
  h.state.images.editableAttachments[0] = interactionImage;
  assert.equal((await h.run({ content: "b".repeat(790), newImages: [] })).status, 400);
  assert.equal((await h.run({ content: "b".repeat(790), retainedImages: [], newImages: [] })).status, 200, "an explicitly cleared image selection must not borrow its old CTA");
});

test("Pinterest preflight preserves account and source checks before consuming an edit version", async () => {
  for (const change of [(h: ReturnType<typeof harness>) => h.stale(), (h: ReturnType<typeof harness>) => h.changeScopeDuringValidation()]) {
    const h = harness(); change(h); const response = await h.run({ content: "corrigé" });
    assert.equal(response.status, 409); assert.equal(h.effects, 0); assert.equal(h.locks.size, 0); assert.equal(h.seals, 0);
  }
});

test("the actual Pinterest PATCH routes over-limit input through read-only validation before locks, media work or Sentry capture", async () => {
  const h = harness(); let acquisitions = 0, captures = 0;
  const deps: Row = {
    NextResponse: Response, guardPublishedPublicationEdit,
    requireUser: async () => ({ activeUserId: "owned-account", authUserId: "owned-actor", errorResponse: null }),
    readInrSendPublicationEditState: async () => h.state,
    validatePinterestPublicationEdit: h.validate,
    loadPublicationCtaContext: async () => ({ websiteUrl: "https://example.test/", phone: "0123456789", siteWebUrl: "https://example.test/", proSettings: {} }),
    acquireExecutionIdempotencyLock: async () => { acquisitions++; throw new Error("invalid input must not acquire a lock"); },
    completeExecutionIdempotencyLockOrThrow: async () => { throw new Error("invalid input must not seal a receipt"); },
    captureApiException: () => { captures++; },
    supabaseAdmin: {},
  };
  deps.asRecord = actualFunction("asRecord", deps);
  const handlers = actualFunction("createPublicationChannelHandlers", deps) as (channel: string) => { PATCH: (request: Request, context: { params: Promise<{ publicationId: string }> }) => Promise<Response> };
  const response = await handlers("pinterest").PATCH(new Request("https://app.example.test/api/inrsend/publications/owned-publication/pinterest", { method: "PATCH", body: JSON.stringify({ expectedState: VERSION, operationKey: "native-route-check", mediaType: "images", content: "a".repeat(801) }) }), { params: Promise.resolve({ publicationId: "owned-publication" }) });
  assert.equal(response.status, 400); assert.equal((await response.json()).code, "pinterest_description_too_long");
  assert.equal(acquisitions, 0); assert.equal(captures, 0); assert.equal(h.effects, 0);
});

test("the shared native publication context preserves the Site web URL and LinkedIn settings used by other channel deliveries", async () => {
  const settings = { site_web: { url: " https://business.example.test/ " }, linkedin: { shareToPersonalProfile: true, untouched: "native-setting" } };
  const reads: string[] = [];
  const { getPreferredWebsiteUrlForChannel } = load<typeof import("../../lib/boosterCtaPreferences.ts")>("lib/boosterCtaPreferences.ts");
  const deps: Row = { getPreferredWebsiteUrlForChannel, supabaseAdmin: { from: (table: string) => ({ select: () => ({ eq: (key: string, account: string) => {
    assert.equal(key, "user_id"); assert.equal(account, "owned-account"); reads.push(table);
    return { maybeSingle: async () => ({ data: table === "profiles" ? { phone: " +33123456789 " } : { settings } }) };
  } }) }) } };
  deps.asRecord = actualFunction("asRecord", deps);
  const context = actualFunction("loadPublicationCtaContext", deps) as (account: string, channel: string) => Promise<{ phone: string; websiteUrl: string; siteWebUrl: string; proSettings: Row }>;
  for (const channel of ["site_web", "linkedin", "pinterest"]) {
    const value = await context("owned-account", channel);
    assert.equal(value.siteWebUrl, "https://business.example.test/"); assert.equal(value.websiteUrl, value.siteWebUrl);
    assert.equal(value.phone, "+33123456789"); assert.equal(value.proSettings, settings); assert.equal(value.proSettings.linkedin, settings.linkedin);
  }
  assert.deepEqual(reads, ["profiles", "pro_tools_configs", "profiles", "pro_tools_configs", "profiles", "pro_tools_configs"]);
});
