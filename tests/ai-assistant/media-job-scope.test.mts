import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "20000000-0000-4000-8000-000000000002";
const mediaB = "30000000-0000-4000-8000-000000000003";

function loadRoute(path: string, stubs: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { URL, console })((id: string) => {
    if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`);
    return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports as { GET?: (request: Request) => Promise<Response>; POST?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> };
}

test("actual Studio status handler cannot recover another establishment's request ID", async () => {
  const jobs = [{ id: "private-job-b", account_id: accountB, request_key: "assistant_foreign_media", status: "completed" }];
  const filters: Record<string, unknown> = {};
  let registryReads = 0;
  const query = {
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query; },
    maybeSingle: async () => ({ error: null, data: jobs.find((job) => Object.entries(filters).every(([key, value]) => job[key as keyof typeof job] === value)) ?? null }),
  };
  const route = loadRoute("../../app/api/media-generation/status/route.ts", {
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/aiGeneratedMediaRegistry": { getExistingGeneratedAiMediaContext: async () => { registryReads += 1; throw new Error("Must not read foreign media"); } },
    "@/lib/aiMediaGenerationPublicErrors": { getAiMediaGenerationPublicError: () => ({ code: "failed", message: "Generation failed" }) },
    "@/lib/aiMediaModelCatalog": { normalizeAiMediaVideoEngine: () => null },
    "@/lib/multicompte/server": { getCurrentInrcyAccountScope: async () => ({ scope: { activeUserId: accountA, authUserId: "member-a" } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "ai_media_generation_jobs"); return query; } } },
  });
  const response = await route.GET!(new Request("https://inrcy.local/api/media-generation/status?requestId=assistant_foreign_media"));
  assert.equal(response.status, 404);
  assert.equal(filters.account_id, accountA);
  assert.equal(filters.request_key, "assistant_foreign_media");
  assert.equal(registryReads, 0);
  assert.equal(JSON.stringify(await response.json()).includes("private-job-b"), false);
});

test("actual Studio accept handler forwards the active account and refuses a foreign draft", async () => {
  const checked: unknown[] = [];
  const route = loadRoute("../../app/api/media-generation/drafts/[id]/accept/route.ts", {
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/aiGeneratedMediaRegistry": { acceptGeneratedAiMediaDraft: async (args: { accountId: string; authUserId: string; mediaId: string }) => {
      checked.push(args);
      assert.equal(args.accountId, accountA);
      assert.equal(args.authUserId, "member-a");
      assert.equal(args.mediaId, mediaB);
      return null;
    } },
    "@/lib/multicompte/server": { getCurrentInrcyAccountScope: async () => ({ scope: { activeUserId: accountA, authUserId: "member-a" } }) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
  });
  const response = await route.POST!(new Request("https://inrcy.local/accept", { method: "POST" }), { params: Promise.resolve({ id: mediaB }) });
  assert.equal(response.status, 404);
  assert.equal(checked.length, 1);
  const body = await response.json();
  assert.equal(body.code, "AI_MEDIA_DRAFT_NOT_FOUND");
  assert.equal(body.item, undefined);
});
