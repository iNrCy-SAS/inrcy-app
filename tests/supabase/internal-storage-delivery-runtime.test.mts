import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../lib/storageDeliveryPolicy.ts";
import * as payloads from "../../lib/inrAgentScheduledPayload.ts";

const account = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const internal = `${account}/_composition-recovery/${other}/${other}/manifest.json`;
const secret = "test-only-secret";
type AnyRecord = Record<string, unknown>;
const nativeRequire = createRequire(import.meta.url);
function load(file: string, dependencies: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const record = { exports: {} as AnyRecord };
  const modules = { "server-only": {}, "./storageDeliveryPolicy": policy, "@/lib/storageDeliveryPolicy": policy,
    "@/lib/inrAgentScheduledPayload": payloads, "./tiktokMediaUrl": { getAppBaseUrl: () => "https://app.test" },
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }, ...dependencies };
  vm.runInNewContext(`(function(require,module,exports){${js}\n})`, {
    Buffer, URL, URLSearchParams, Response, Headers, console, setTimeout,
    process: { env: { STORAGE_CONTENT_SECRET: secret } },
  })((id: string) => {
    if (id === "crypto") return nativeRequire(id);
    assert.ok(id in modules, `Unexpected dependency: ${id}`);
    return modules[id as keyof typeof modules];
  }, record, record.exports);
  return record.exports;
}

test("internal objects cannot receive HMAC links and even pre-existing tokens are rejected", () => {
  const urls = load("lib/storageContentUrl.ts") as typeof import("../../lib/storageContentUrl.ts");
  for (const [bucket, path] of [
    ["inrcy-ai-composition", `${account}/anything.mp4`], ["inrcy-pro-media", internal],
    ["booster", `${account}/%5fcomposition-recovery/file.mp4`], ["booster", `${account}/_composition-recovery%2Ffile.mp4`],
  ]) {
    const oldToken = createHmac("sha256", secret).update(`inrcy-storage-content:v1:${bucket}:${path}`).digest("base64url");
    assert.equal(urls.buildStorageContentUrl(bucket, path), null);
    assert.equal(urls.verifyStorageContentToken(bucket, path, oldToken), false);
  }
  const url = new URL(urls.buildStorageContentUrl("booster", `${account}/photo été.jpg`)!, "https://app.test");
  assert.equal(urls.verifyStorageContentToken("booster", `${account}/photo été.jpg`, url.searchParams.get("token")!), true);
});

test("central Storage signing and probing refuse internals before any admin operation", async () => {
  const calls: string[] = [];
  const signing = load("lib/safeStorageSignedUrl.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: {
      rpc: async () => { calls.push("probe"); return { data: true, error: null }; },
      storage: { from: () => ({ createSignedUrl: async () => { calls.push("sign"); return { data: { signedUrl: "https://storage.test/signed" }, error: null }; } }) },
    } },
    "@/lib/storageSignedUrlError": {},
    "@/lib/storageUrlSanitization": { normalizeStorageDeliveryUrl: (url: string) => url },
  }) as typeof import("../../lib/safeStorageSignedUrl.ts");
  for (const [bucket, path] of [["inrcy-ai-composition", `${account}/file.mp4`], ["inrcy-pro-media", internal]]) {
    assert.equal(await signing.createSafeStorageSignedUrl(bucket, path, 600), null);
    assert.equal(await signing.probeStorageObject(bucket, path), "missing");
  }
  assert.deepEqual(calls, []);
  assert.equal(await signing.createSafeStorageSignedUrl("inrcy-pro-media", `users/${account}/image.jpg`, 600), "https://storage.test/signed");
  assert.deepEqual(calls, ["probe", "sign"]);
});

test("content delivery refuses internal objects even if a token verifier accepts them", async () => {
  let reads = 0;
  const route = load("app/api/storage/content/route.ts", {
    "@/lib/storageContentUrl": { verifyStorageContentToken: () => true },
    "@/lib/safeStorageSignedUrl": {
      probeStorageObject: async () => { reads++; return "exists"; },
      createSafeStorageSignedUrl: async () => "https://storage.test/signed",
    },
  }) as { GET(request: { nextUrl: URL }): Promise<Response> };
  for (const [bucket, path] of [["inrcy-ai-composition", `${account}/file.mp4`], ["inrcy-pro-media", internal]]) {
    assert.equal((await route.GET({ nextUrl: new URL(`https://app.test/api/storage/content?${new URLSearchParams({ bucket, path, token: "legacy" })}`) })).status, 404);
  }
  assert.equal(reads, 0);
  assert.equal((await route.GET({ nextUrl: new URL(`https://app.test/api/storage/content?${new URLSearchParams({ bucket: "booster", path: `${account}/photo.jpg`, token: "valid" })}`) })).status, 307);
  assert.equal(reads, 1);
});

test("attachment download scopes the actual permitted buckets to the active account", async () => {
  const downloaded: string[] = [];
  const route = load("app/api/inrsend/attachments/download/route.ts", {
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: account, user: { id: other }, errorResponse: null }) },
    "@/lib/tsSafe": { safeErrorMessage: () => "error" },
    "@/lib/supabaseAdmin": { supabaseAdmin: { storage: { from: (bucket: string) => ({ download: async (path: string) => {
      downloaded.push(`${bucket}:${path}`); return { data: new Blob(["private attachment"], { type: "application/pdf" }), error: null };
    } }) } } },
  }) as { GET(request: Request): Promise<Response> };
  const get = (bucket: string, path: string) => route.GET(new Request(`https://app.test/api/inrsend/attachments/download?${new URLSearchParams({ bucket, path })}`));
  for (const [bucket, path] of [["inrcy-ai-composition", internal], ["inrcy-pro-media", internal], ["inrbox_attachments", `${other}/a.pdf`],
    ["unknown", `${account}/a.pdf`], ["inrbox_attachments", `${account}/../${other}/a.pdf`], ["booster", `${account}%2f..%2f${other}/a.jpg`]]) {
    assert.ok([400, 403].includes((await get(bucket, path)).status));
  }
  assert.deepEqual(downloaded, []);
  for (const [bucket, path] of [["inrbox_attachments", `${account}/a.pdf`], ["booster", `${account}/video.mp4`],
    ["inr-agent-reports", `${account}/stats/report.pdf`], ["inrcy-pro-media", `users/${account}/ai-generated/image/a.jpg`]]) {
    const response = await get(bucket, path); assert.equal(response.status, 200); assert.equal(await response.text(), "private attachment");
  }
  assert.equal(downloaded.length, 4);
});

function scheduledRoute(file: string) {
  const writes: AnyRecord[] = []; const minted: string[] = [];
  const filters: Array<[string, unknown]> = []; let row: AnyRecord = {};
  const query = { insert(value: AnyRecord) { writes.push(value); row = value; return query; },
    update(value: AnyRecord) { writes.push(value); row = value; return query; }, select() { return query; },
    eq(key: string, value: unknown) { filters.push([key, value]); return query; },
    single: async () => ({ data: { ...row, id: "schedule-a" }, error: null }),
    maybeSingle: async () => ({ data: { ...row, id: "schedule-a" }, error: null }) };
  const route = load(file, {
    "@/lib/inrAgentScheduledActions": { scheduledActionToDbRow: (args: AnyRecord) => ({ ...args, user_id: args.userId, action_type: "custom", target_tool: "agent" }), rowToInrAgentScheduledAction: (value: AnyRecord) => value },
    "@/lib/inrAgentSettings": { INR_AGENT_AUTOMATION_KEYS: [] },
    "@/lib/inrAgentActions": { INR_AGENT_ACTION_TYPES: [], INR_AGENT_TARGET_TOOLS: [] },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: other, user: { id: other }, errorResponse: null }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async () => "premium" },
    "@/lib/standardAgentPolicy": {}, "@/lib/inrAgentPublicationHistory": {}, "@/lib/scheduledPublicationDedupe": {},
    "@/lib/inrAgentPublicationChannelSelectionServer": { saveAgentPublicationChannels: () => assert.fail("Storage-only updates must not change publication channel selection") },
    "@/lib/scheduledCampaignDedupe": {}, "@/lib/mediaWorkspaceConsumption": {}, "@/lib/scheduledPublicationMediaSnapshot": {},
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => query } },
    "@/lib/storageContentUrl": { buildAbsoluteStorageContentUrl: (bucket: string, path: string) => { minted.push(`${bucket}:${path}`); return `https://app.test/signed/${bucket}/${path}`; } },
  }) as { POST(request: Request): Promise<Response>; PATCH(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> };
  return { route, writes, minted, filters };
}

test("schedule POST and PATCH reject internal, foreign-account and unknown storage before signing or writing", async () => {
  for (const method of ["POST", "PATCH"] as const) {
    const h = scheduledRoute(`app/api/agent/scheduled-actions/${method === "PATCH" ? "[id]/" : ""}route.ts`);
    for (const [bucket, path] of [["inrcy-ai-composition", internal], ["inrcy-pro-media", internal], ["booster", `${other}/a.jpg`],
      ["inrcy-pro-media", `users/${other}/a.jpg`], ["unknown", `${account}/a.jpg`]]) {
      const request = new Request("https://app.test/api/agent/scheduled-actions", { method, body: JSON.stringify({
        scheduledAt: "2026-12-01T10:00:00Z", accountId: other,
        payload: { images: [{ dataUrl: "data:image/png;base64,AAAA", imageMeta: { bucket, storagePath: path } }] },
      }) });
      const response = method === "POST" ? await h.route.POST(request) : await h.route.PATCH(request, { params: Promise.resolve({ id: "schedule-a" }) });
      assert.equal(response.status, 403);
    }
    assert.deepEqual(h.minted, []); assert.deepEqual(h.writes, []);
    for (const [bucket, path] of [["booster", `${account}/a.jpg`], ["inrcy-pro-media", `users/${account}/a.jpg`], ["inrcy-image-bank", "shared/a.jpg"]]) {
      const request = new Request("https://app.test/api/agent/scheduled-actions", { method, body: JSON.stringify({ scheduledAt: "2026-12-01T10:00:00Z",
        payload: { media: { dataUrl: "data:image/png;base64,AAAA", bucket, storagePath: path } } }) });
      const response = method === "POST" ? await h.route.POST(request) : await h.route.PATCH(request, { params: Promise.resolve({ id: "schedule-a" }) });
      assert.equal(response.status, 200);
    }
    assert.equal(h.writes.length, 3); assert.equal(h.minted.length, 3);
    if (method === "PATCH") assert.ok(h.filters.some(([key, value]) => key === "user_id" && value === account));
  }
});

test("shared scheduled compaction never mints internal or foreign-account URLs", () => {
  for (const [bucket, path] of [["inrcy-ai-composition", internal], ["inrcy-pro-media", internal], ["booster", `${other}/photo.jpg`]]) {
    payloads.compactInrAgentScheduledPayload({ media: { dataUrl: "data:image/png;base64,AAAA", bucket, storagePath: path } }, {
      accountId: account, storageUrl: () => assert.fail("Unauthorized reference reached signer"),
    });
  }
});
