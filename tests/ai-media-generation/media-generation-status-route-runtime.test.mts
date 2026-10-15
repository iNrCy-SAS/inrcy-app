import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as publicErrors from "../../lib/aiMediaGenerationPublicErrors.ts";

type Job = { id: string; status: string; error_code?: string; error_message?: string; metadata?: Record<string, unknown> };
function route(options: { authenticated?: boolean; job?: Job | null; draft?: boolean; missingMedia?: boolean; readFails?: boolean } = {}) {
  const filters: Array<[string, string]> = []; const mediaReads: Array<{ accountId: string; jobId: string }> = []; let selections = 0;
  const chain = {
    select(fields: string) { assert.equal(fields, "id,status,error_code,error_message,metadata"); selections++; return chain; },
    eq(field: string, value: string) { filters.push([field, value]); return chain; },
    async maybeSingle() { return { data: options.job ?? null, error: options.readFails ? new Error("https://private-provider.invalid diagnostics") : null }; },
  };
  const dependencies = new Map<string, unknown>([
    ["@/lib/aiMediaGenerationPublicErrors", publicErrors],
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/multicompte/server", { getCurrentInrcyAccountScope: async () => options.authenticated === false ? null : { scope: { activeUserId: "active-account-a", authUserId: "actor-a" } } }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: { from(table: string) { assert.equal(table, "ai_media_generation_jobs"); return chain; } } }],
    ["@/lib/aiGeneratedMediaRegistry", { getExistingGeneratedAiMediaContext: async (args: { accountId: string; jobId: string }) => {
      mediaReads.push(args); return options.missingMedia ? null : { item: { id: "media-a", signed_url: "https://example.invalid/private-preview.jpg", media_type: "image" }, draft: options.draft !== false };
    } }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../app/api/media-generation/status/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", output)(record, record.exports, (id: string) => {
    assert.ok(dependencies.has(id), `Status recovery cannot import a mutating generation dependency: ${id}`); return dependencies.get(id);
  });
  return { filters, mediaReads, selections: () => selections, get: (query = "requestId=media-request-0001") => record.exports.GET(new Request(`https://example.invalid/api/media-generation/status?${query}`)) };
}

test("recovery authenticates before reading and scopes the request ID to the server-selected account", async () => {
  const anonymous = route({ authenticated: false }); const denied = await anonymous.get();
  assert.equal(denied.status, 401); assert.deepEqual(await denied.json(), { ok: false, code: "UNAUTHORIZED", error: "Non authentifié." }); assert.equal(anonymous.selections(), 0);
  const invalid = route(); assert.equal((await invalid.get("requestId=bad")).status, 400); assert.equal(invalid.selections(), 0);
  const completed = route({ job: { id: "job-a", status: "completed", metadata: { format: "portrait", error_message: "private-provider diagnostics" } } });
  const response = await completed.get("requestId=media-request-0001&accountId=other-account"); const payload = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(completed.filters, [["account_id", "active-account-a"], ["request_key", "media-request-0001"]]);
  assert.deepEqual(completed.mediaReads, [{ accountId: "active-account-a", jobId: "job-a" }]); assert.equal(payload.item.id, "media-a"); assert.equal(payload.format, "portrait"); assert.equal(payload.draft, true);
  assert.equal(payload.quota, undefined); assert.equal(payload.metadata, undefined); assert.doesNotMatch(JSON.stringify(payload), /private-provider/);
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
});

test("read-only recovery distinguishes pending, absent and terminal jobs without touching the wallet", async () => {
  const absent = route(); assert.equal((await absent.get()).status, 404); assert.equal(absent.mediaReads.length, 0);
  for (const status of ["reserved", "processing", "failed", "expired"]) {
    const current = route({ job: { id: "job-a", status } }); const response = await current.get(); const payload = await response.json();
    assert.equal(response.status, ["reserved", "processing"].includes(status) ? 202 : 200);
    assert.equal(payload.status, ["reserved", "processing"].includes(status) ? "processing" : status); assert.equal(current.mediaReads.length, 0);
  }
  const accepted = route({ job: { id: "job-a", status: "completed" }, draft: false }); assert.equal((await (await accepted.get()).json()).draft, false);
  const removed = route({ job: { id: "job-a", status: "completed" }, missingMedia: true }); assert.equal((await removed.get()).status, 410);
});

test("recovery failures reveal a generic public message without database or provider diagnostics", async () => {
  const broken = route({ readFails: true }); const response = await broken.get(); assert.equal(response.status, 503);
  const payload = await response.json(); assert.equal(payload.code, "AI_MEDIA_STATUS_UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(payload), /private-provider|diagnostics/); assert.equal(broken.mediaReads.length, 0);
});

test("terminal recovery explains a legacy nested cause using allowlisted text and preserves account ownership", async () => {
  const current = route({ job: {
    id: "job-a", status: "failed", error_code: "ai_media_narration_unavailable",
    error_message: "ai_media_narration_unavailable:La voix off est trop longue pour cette durée.",
    metadata: { error_details: [{ message: "https://private.invalid/?token=secret data:image/png;base64,AAAA" }], freePrompt: "PRIVATE_BRIEF", accountId: "other-account" },
  } });
  const payload = await (await current.get("requestId=media-request-0001&accountId=other-account")).json();
  assert.equal(payload.code, "AI_MEDIA_NARRATION_TOO_LONG");
  assert.match(payload.error, /durée plus longue/);
  assert.doesNotMatch(JSON.stringify(payload), /private|token|secret|base64|PRIVATE_BRIEF|other-account/);
  assert.deepEqual(current.filters, [["account_id", "active-account-a"], ["request_key", "media-request-0001"]]);
  assert.equal(current.mediaReads.length, 0);
});

test("recovery distinguishes an expired attempt, an unknown failure and a known public code", async () => {
  for (const [job, expected] of [
    [{ id: "a", status: "expired", error_message: "private diagnostics" }, "AI_MEDIA_GENERATION_EXPIRED"],
    [{ id: "a", status: "failed", error_code: "unknown", error_message: "private diagnostics" }, "AI_MEDIA_GENERATION_FAILED"],
    [{ id: "a", status: "failed", error_code: "AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED", error_message: "private diagnostics" }, "AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED"],
  ] as const) {
    const payload = await (await route({ job }).get()).json();
    assert.equal(payload.code, expected);
    assert.equal(payload.error, publicErrors.getAiMediaGenerationPublicError({ code: expected }).message);
    assert.doesNotMatch(payload.error, /private diagnostics/);
  }
});

test("the registry recovery helper reads the scoped lifecycle without promoting or normalizing media", async () => {
  for (const draft of [true, false]) {
    const filters: Array<[string, string]> = []; let signatures = 0;
    const row = { id: "media-a", storage_path: "users/account-a/ai-generated/result.jpg", media_type: "image", upload_status: "uploaded", source: draft ? "ai_media_generation_draft" : "ai_media_generation", is_active: !draft };
    const query = { select() { return query; }, eq(key: string, value: string) { filters.push([key, value]); return query; }, async maybeSingle() { return { data: row, error: null }; } };
    const modules = new Map<string, unknown>([
      ["server-only", {}], ["node:crypto", {}],
      ["@/lib/supabaseAdmin", { supabaseAdmin: { from(table: string) { assert.equal(table, "pro_media_library"); return query; } } }],
      ["@/lib/safeStorageSignedUrl", { createSafeStorageSignedUrl: async () => { signatures++; return "https://example.invalid/private-preview.jpg"; } }],
      ["@/lib/mediaLibraryContentUrl", { buildMediaLibraryContentUrl: (id: string) => `/api/media-library/${id}/content` }],
      ["@/lib/mediaImageNormalizationQueue", { enqueueImageNormalization() { assert.fail("A recovery read cannot normalize media"); } }],
      ["@/lib/mediaVideoNormalizationQueue", { enqueueVideoNormalization() { assert.fail("A recovery read cannot normalize media"); } }],
      ["@/lib/mediaPipelineRegistry", {}],
    ]);
    const output = ts.transpileModule(readFileSync(new URL("../../lib/aiGeneratedMediaRegistry.ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const record = { exports: {} as { getExistingGeneratedAiMediaContext: (args: { accountId: string; jobId: string }) => Promise<{ item: { signed_url: string }; draft: boolean }> } };
    new Function("module", "exports", "require", output)(record, record.exports, (id: string) => { assert.ok(modules.has(id), id); return modules.get(id); });
    const result = await record.exports.getExistingGeneratedAiMediaContext({ accountId: "account-a", jobId: "job-a" });
    assert.equal(result.draft, draft); assert.deepEqual(filters, [["user_id", "account-a"], ["client_media_key", "ai-media:job-a"]]);
    assert.equal(signatures, 0, "Recovery returns an authenticated application URL without issuing a temporary Storage signature");
    assert.equal(result.item.signed_url, draft ? "/api/media-generation/drafts/media-a/content" : "/api/media-library/media-a/content");
  }
});
