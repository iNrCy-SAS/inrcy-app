import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ACTION = "30000000-0000-4000-8000-000000000003";
const VERSION = "2026-10-30T10:00:00.000Z";
const routeCode = ts.transpileModule(readFileSync(new URL("../../app/api/agent/actions/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function harness() {
  let passedGuard = 0;
  const filters: Row[] = [];
  const source: Row = { id: ACTION, user_id: ACCOUNT, automation_key: "publish", action_type: "publication", target_tool: "booster", status: "pending_validation", updated_at: VERSION, payload: {} };
  const query = { select() { return query; }, eq(key: string, value: unknown) { filters.push({ key, value }); return query; }, async single() { return { data: { ...source }, error: null }; }, update() { assert.fail("A stale request must not write"); } };
  const foundations = {
    cleanText: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "",
    cleanPublishChannel: (value: unknown) => value === "facebook" ? "facebook" : null,
    cleanPublishHashtags: () => [], cleanPublishMedia: (value: unknown) => value,
    isPublishAction: (action: Row) => action.automationKey === "publish" && action.actionType === "publication" && action.targetTool === "booster",
    // Both real handlers first project stored payload after checking the
    // supplied version. Stop here so legacy/fresh cases do not reach providers.
    asRecord: () => { passedGuard++; throw new Error("AFTER_VERSION_GUARD"); },
  };
  const deps: Row = {
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ user: { id: ACTOR }, authUserId: ACTOR, activeUserId: ACCOUNT, errorResponse: null }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async () => "premium" },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "inr_agent_actions"); return query; } } },
    "@/lib/inrAgentActions": { sanitizeInrAgentActionStatus: () => null, rowToInrAgentAction: (value: Row) => ({ ...value, automationKey: value.automation_key, actionType: value.action_type, targetTool: value.target_tool, updatedAt: value.updated_at }) },
    "./actionPublishDraft.foundations": foundations,
  };
  const loaded = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${routeCode}\n})`, { Request, Response, Date, Map, Set })((name: string) => deps[name] ?? {}, loaded, loaded.exports);
  const route = loaded.exports as { PATCH(request: Request): Promise<Response> };
  const patch = (editType: string, expected: Row = {}) => route.PATCH(new Request("https://app.test/api/agent/actions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ actionId: ACTION, editType, channel: "facebook", title: "Titre", content: "Contenu demandé", media: { kind: "image", url: "https://app.test/owned.jpg" }, ...expected }) }));
  return { patch, source, filters, passedGuard: () => passedGuard };
}

for (const editType of ["publish_channel_text", "publish_channel_media"]) {
  test(`${editType} refuses a stale assistant version before touching content/media/provider logic`, async () => {
    for (const expectedUpdatedAt of ["2026-10-29T10:00:00Z", null, "", 123]) {
      const h = harness(), response = await h.patch(editType, { expectedUpdatedAt });
      assert.equal(response.status, 409); assert.equal((await response.json()).code, "INR_AGENT_PUBLICATION_CHANGED"); assert.equal(h.passedGuard(), 0);
      assert.deepEqual(h.filters, [{ key: "id", value: ACTION }, { key: "user_id", value: ACCOUNT }]);
    }
  });
  test(`${editType} accepts matching versions and retains legacy callers that omit expectedUpdatedAt`, async () => {
    for (const expected of [{ expectedUpdatedAt: VERSION }, {}]) { const h = harness(); await assert.rejects(() => h.patch(editType, expected), /AFTER_VERSION_GUARD/); assert.equal(h.passedGuard(), 1); }
  });
}
