import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../lib/inrAssistantAttachments.ts";
import type * as Route from "../../app/api/assistant/attachments/route.ts";

const accountId = "11111111-1111-4111-8111-111111111111", actorUserId = "22222222-2222-4222-8222-222222222222", conversationId = "33333333-3333-4333-8333-333333333333";
const ref = { id: "44444444-4444-4444-8444-444444444444", name: "voice.mp3", kind: "audio", size: 1000, token: "synthetic-reference-for-unit-test-only" };
function harness() {
  const calls: Array<{ scope: unknown; options: { edition: string; signal: AbortSignal }; ref?: unknown; id?: string }> = [];
  const editionLookups: string[] = [];
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: accountId, authUserId: actorUserId, supabase: {} }) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/inrAssistantAttachments": policy,
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async (id: string) => { editionLookups.push(id); return "basic"; } },
    "@/lib/inrAssistantAttachmentStorage": {
      prepareAssistantAttachment: async () => ({ attachment: ref }),
      finalizeAssistantAttachment: async (scope: unknown, attachment: unknown, options: { edition: string; signal: AbortSignal }) => { calls.push({ scope, ref: attachment, options }); return attachment; },
      attachAssistantLibraryItem: async (scope: unknown, _db: unknown, id: string, _remainingBytes: number, options: { edition: string; signal: AbortSignal }) => { calls.push({ scope, id, options }); return { ...ref, id }; },
    },
  };
  const source = readFileSync(new URL("../../app/api/assistant/attachments/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Buffer, AbortSignal, Uint8Array })((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return { api: record.exports as typeof Route, calls, editionLookups };
}
const request = (body: unknown) => new Request("https://app.example.invalid/api/assistant/attachments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("attachment analysis uses the authenticated active account edition despite forged client edition and identities", async () => {
  const h = harness();
  const result = await h.api.POST(request({ action: "finalize", conversationId, attachment: ref, edition: "premium", accountId: "forged", actorUserId: "forged" }));
  assert.equal(result.status, 200); assert.deepEqual(h.editionLookups, [accountId]);
  assert.equal(h.calls[0].options.edition, "basic"); assert.ok(h.calls[0].options.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].scope)), { accountId, actorUserId, conversationId });
});

test("a library selection shares one deadline and one authoritative edition lookup across its files", async () => {
  const h = harness();
  const ids = [ref.id, "55555555-5555-4555-8555-555555555555"];
  const result = await h.api.POST(request({ action: "library", conversationId, ids, edition: "premium" }));
  assert.equal(result.status, 200); assert.deepEqual(h.editionLookups, [accountId]);
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].options, h.calls[1].options);
  assert.equal(h.calls[0].options.signal, h.calls[1].options.signal);
  assert.equal(h.calls[1].options.edition, "basic");
});
