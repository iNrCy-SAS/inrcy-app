/* eslint-disable @typescript-eslint/no-explicit-any -- execute production functions at isolated service boundaries */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as meta from "../../lib/metaGraphErrorClassification.ts";
import { classifyBoosterPublicationResult } from "../../lib/boosterPublicationOutcome.ts";
import { isBoosterPublishFailureRetryable } from "../../lib/boosterPublicationPolicy.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const asyncPath = "lib/boosterAsyncPublication.ts";
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const asRecord = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const context = {
  ...meta, asRecord, cleanString: (value: unknown) => String(value || "").trim(),
  CHANNEL_LABELS: { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn" },
  TERMINAL_CHANNEL_STATUSES: new Set(["completed", "failed"]), classifyBoosterPublicationResult, isBoosterPublishFailureRetryable,
};
function production(file: string, name: string, scope: Record<string, unknown> = {}): any {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); };
  visit(source); assert.ok(found, `Production function ${name} exists`);
  const injected = { ...context, ...scope };
  const code = ts.transpileModule(`return (${found.getText(source).replace(/^export\s+/, "")});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(injected), code)(...Object.values(injected));
}
const igError = { error: { code: 25, error_subcode: 2207050, message: "User access is restricted", is_transient: false, error_user_msg: "The Instagram account is restricted." } };
const igFailure = () => ({ ok: false, error: "L’action n’a pas pu être finalisée.", diagnostics: { ok: false, diagnostics: { createResponse: structuredClone(igError) } } });
const fbFailure = () => ({ ok: false, error: "Facebook Confirmez votre identité avant de pouvoir publier au nom de cette Page. Ouvrez l’application Facebook sur votre téléphone et suivez les instructions.", diagnostics: { ok: false, error: "Confirmez votre identité avant de pouvoir publier au nom de cette Page. Ouvrez l’application\u00a0Facebook sur votre téléphone et suivez les instructions." } });

test("observed nested provider restrictions produce only stable safe non-retryable classifications", () => {
  for (const [channel, failure, code] of [["facebook", fbFailure(), "facebook_identity_confirmation_required"], ["instagram", igFailure(), "instagram_account_restricted"]] as const) {
    const historical = { channel, ok: false, code: "meta_placements_failed", placements: { classic: failure } };
    assert.deepEqual(meta.classifyMetaPublicationRestriction(historical), { channel, code, retryable: false });
    const normalized = meta.normalizeMetaPublicationRestrictionResult(historical);
    assert.equal(asRecord(asRecord(normalized.placements).classic).code, code);
    assert.equal(asRecord(asRecord(normalized.placements).classic).retryable, false);
    assert.deepEqual(meta.classifyMetaPublicationRestriction({ code }), { channel, code, retryable: false });
    assert.equal(isBoosterPublishFailureRetryable({ ok: false, code, retryable: true }), false);
  }
});

test("restriction recognition respects channel ownership and successful fallback diagnostics", () => {
  assert.equal(meta.classifyMetaPublicationRestriction(igFailure(), "facebook"), null);
  assert.equal(meta.classifyMetaPublicationRestriction({ ok: true, diagnostics: igError }, "instagram"), null);
  assert.equal(meta.classifyMetaPublicationRestriction({ ok: false, placements: {
    classic: { ...igFailure(), ok: true }, story: { ok: false, error: "Unsupported image format" },
  } }, "instagram"), null);
  assert.equal(meta.classifyMetaPublicationRestriction({ channel: "facebook", diagnostics: { channel: "instagram", ...igError } }, "facebook"), null);
  for (const error of [{ code: 452 }, { code: 25, error_subcode: 2207051 }, { code: 4, error_subcode: 2207051 }, { code: 190 }, { code: 100, message: "Unsupported image format" }]) {
    assert.equal(meta.classifyMetaPublicationRestriction({ error }, "instagram"), null);
  }
  assert.equal(meta.classifyMetaPublicationRestriction({ error: { code: 452 } }, "facebook"), null, "No unobserved numeric Facebook cause is invented");
  const cyclic: Record<string, unknown> = {}; cyclic.diagnostics = cyclic;
  assert.equal(meta.classifyMetaPublicationRestriction(cyclic, "instagram"), null);
  assert.deepEqual(meta.classifyMetaPublicationRestriction({ raw_error: JSON.stringify(igError) }, "instagram"), { channel: "instagram", code: "instagram_account_restricted", retryable: false });
});

test("immediate and durable summaries retain independent failures and delivered sibling placements", () => {
  for (const [file, name] of [[asyncPath, "buildAsyncPublicationSummary"], ["app/api/booster/publish-now/publishNow.foundations.ts", "buildResultsSummary"]]) {
    const summary = production(file, name)({
      facebook: { ok: false, retryable: false, placements: { classic: fbFailure() } },
      instagram: { ok: false, placements: { classic: igFailure(), story: { ok: true, external_id: "already-published" } } },
    }, ["facebook", "instagram"]);
    assert.deepEqual(summary.entries.map((entry: any) => [entry.targetKey, entry.code, entry.retryable]), [
      ["facebook:classic", "facebook_identity_confirmation_required", false], ["instagram:classic", "instagram_account_restricted", false], ["instagram:story", null, false],
    ]);
    assert.equal(summary.total, 3); assert.equal(summary.successCount, 1); assert.equal(summary.failureCount, 2);
    assert.equal(summary.entries[2].ok, true);
  }
});

test("persisted failed children normalize during a read without writes or making pending Stories terminal", async () => {
  const queries: string[] = [];
  const db = { from(table: string) { queries.push(table); return this; }, select() { return this; }, eq() { return this; }, in() { return Promise.resolve({ data: [
    { id: "primary", payload: { status: "failed", result: igFailure() } },
    { id: "story", payload: { status: "queued", result: {} } },
  ], error: null }); } };
  const targets = ["classic", "story"].map((placement) => ({ channel: "instagram", key: `instagram:${placement}`, placement }));
  const states = await production(asyncPath, "loadAsyncChannelStates", { supabaseAdmin: db, BOOSTER_ASYNC_CHANNEL_EVENT_TYPE: "publish_async_channel" })({ userId: "fixture-user", descriptor: { targets, ids: ["primary", "story"], channelEventIds: { "instagram:classic": "primary", "instagram:story": "story" } } });
  assert.deepEqual(queries, ["app_events"]);
  const status = production(asyncPath, "buildProcessingPublicationStatus")("parent", states, ["instagram"]);
  assert.equal(status.summary.entries[0].code, "instagram_account_restricted"); assert.equal(status.summary.entries[0].retryable, false);
  assert.equal(status.summary.failureCount, 1); assert.equal(status.summary.pendingCount, 1); assert.equal(status.summary.successCount, 0);
  assert.equal(states[1].status, "queued", "Restrictions never cancel independent Story attempts");
});

test("historical completed receipts repair restriction codes and retry counts without changing stored data or confirmed successes", () => {
  const payload = { status: "partial", summary: { total: 3, successCount: 1, failureCount: 2, retryableFailureCount: 2, entries: [
    { channel: "facebook", placement: "classic", ok: false, code: null, retryable: true },
    { channel: "instagram", placement: "classic", ok: false, code: "instagram_publish_failed", retryable: true },
    { channel: "linkedin", ok: true, code: null, retryable: false },
  ] }, results: { facebook: { ok: false, placements: { classic: fbFailure() } }, instagram: { ok: false, placements: { classic: igFailure() } }, linkedin: { ok: true } } };
  const original = structuredClone(payload);
  const repaired = production(asyncPath, "buildCompletedPublicationStatus")("parent", payload);
  assert.deepEqual(payload, original, "Only the returned representation changes");
  assert.deepEqual(repaired.summary.entries.map((entry: any) => entry.retryable), [false, false, false]);
  assert.equal(repaired.summary.retryableFailureCount, 0);
  assert.equal(repaired.summary.total, 3); assert.equal(repaired.summary.successCount, 1); assert.equal(repaired.summary.failureCount, 2);
  assert.deepEqual(repaired.summary.entries[2], payload.summary.entries[2]);
  const missingStory = { ...payload, summary: { entries: [{ channel: "instagram", placement: "story", ok: false, code: "story_missing", retryable: true }] } };
  assert.equal(production(asyncPath, "buildCompletedPublicationStatus")("parent", missingStory).summary.entries[0].code, "story_missing", "A missing Story result never inherits a restricted primary's diagnostics");
});

async function withInstagram(t: any, responder: (url: URL) => Response) {
  const originalFetch = globalThis.fetch; const originalTimeout = globalThis.setTimeout;
  const calls: URL[] = [];
  globalThis.fetch = async (input) => { const url = new URL(String(input)); assert.equal(url.hostname, "graph.instagram.test"); calls.push(url); return responder(url); };
  globalThis.setTimeout = ((callback: () => void) => { callback(); return 0; }) as any;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; });
  const loaded = runtimeModules({ "@/lib/instagramAuthMode": { buildInstagramGraphUrl: (path: string) => `https://graph.instagram.test/${path}` } })<typeof import("../../lib/instagramPublish.ts")>("lib/instagramPublish.ts");
  return { loaded, calls };
}
const imageParams = { igUserId: "fixture-ig", accessToken: "fixture-primary", tokenCandidates: [{ source: "secondary", accessToken: "fixture-secondary" }], caption: "Fixture", imageUrls: ["https://images.test/1.jpg", "https://images.test/2.jpg"] };

test("real Instagram carousel stops at its first restricted child, with no alternate token or photo fallback", async (t) => {
  const { loaded, calls } = await withInstagram(t, () => Response.json(igError, { status: 400 }));
  const result = await loaded.instagramPublishImagesBestEffortWithTokenFallback(imageParams);
  assert.equal(calls.length, 1); assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "instagram_account_restricted");
  assert.equal(result.ok ? null : result.retryable, false); assert.equal(result.carouselFallbackUsed, false); assert.equal(result.publishedImageCount, 0);
});

test("a restriction discovered on container status stops before publishing or degrading to a standalone photo", async (t) => {
  const { loaded, calls } = await withInstagram(t, (url) => url.pathname.endsWith("/media") ? Response.json({ id: `child-${url.searchParams.get("image_url")?.endsWith("1.jpg") ? 1 : 2}` }) : Response.json(igError, { status: 400 }));
  const result = await loaded.instagramPublishImagesBestEffortWithTokenFallback(imageParams);
  assert.equal(calls.length, 3); assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "instagram_account_restricted"); assert.equal(result.carouselFallbackUsed, false);
  assert.ok(calls.every((url) => !url.pathname.endsWith("/media_publish")));
});

test("a genuine carousel media-format rejection still degrades safely to one standalone photo", async (t) => {
  const { loaded, calls } = await withInstagram(t, (url) => {
    if (url.pathname.endsWith("/media") && url.searchParams.get("is_carousel_item") === "true") return Response.json({ error: { code: 100, message: "Unsupported carousel image format" } }, { status: 400 });
    if (url.pathname.endsWith("/media")) return Response.json({ id: "standalone-container" });
    if (url.pathname.endsWith("/standalone-container")) return Response.json({ status_code: "FINISHED" });
    if (url.pathname.endsWith("/media_publish")) return Response.json({ id: "standalone-published" });
    assert.fail(`Unexpected fixture endpoint ${url.pathname}`);
  });
  const result = await loaded.instagramPublishImagesBestEffortWithTokenFallback(imageParams);
  assert.equal(result.ok, true); assert.equal(result.carouselFallbackUsed, true); assert.equal(result.publishedImageCount, 1);
  assert.equal(calls.length, 5); assert.equal(calls.filter((url) => url.pathname.endsWith("/media_publish")).length, 1);
  assert.ok(calls.every((url) => url.searchParams.get("access_token") === "fixture-primary"));
});
