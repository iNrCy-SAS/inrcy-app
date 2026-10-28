import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
type Row = Record<string, any>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ID = "30000000-0000-4000-8000-000000000003";
function load(path: string, deps: Row, globals: Row = {}): Row { const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const module = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Intl, Buffer, Request, Response, URL, Headers, console, ...globals })((key: string) => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; }, module, module.exports); return module.exports; }
const helper = load("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto }, { process: { env: {} } });
function harness(options: { race?: boolean; status?: string } = {}) {
  let row: Row = { id: ID, user_id: ACCOUNT, action_type: "publication", target_tool: "booster", title: "Atelier", summary: "Résumé", status: options.status ?? "scheduled", scheduled_at: new Date(Date.now() + 86400_000).toISOString(), timezone: "Europe/Paris", channels: ["facebook"], attempt_count: options.status === "failed" ? 1 : 0, executed_at: null, updated_at: new Date().toISOString(), payload: { publishPayload: { idempotencyKey: "stable-native-key" } } };
  const writes: Row[] = [];
  const db = { from(table: string) { assert.equal(table, "inr_agent_scheduled_actions"); const filters: Array<[string, string, unknown]> = []; let patch: Row | null = null;
    const run = () => { assert.ok(filters.some(([, key, val]) => key === "user_id" && val === ACCOUNT)); if (!patch) return { data: JSON.parse(JSON.stringify(row)), error: null };
      writes.push({ patch, filters }); const matches = filters.every(([kind, field, value]) => kind === "in" ? (value as unknown[]).includes(row[field]) : field === "payload" ? JSON.stringify(row.payload) === value : row[field] === value); if (!matches) return { data: null, error: null }; row = { ...row, ...patch }; return { data: JSON.parse(JSON.stringify(row)), error: null }; };
    const q = { select() { return q; }, eq(field: string, value: unknown) { filters.push(["eq", field, value]); return q; }, is(field: string, value: unknown) { filters.push(["is", field, value]); return q; }, in(field: string, value: unknown) { filters.push(["in", field, value]); return q; }, update(value: Row) { patch = value; if (options.race) { row.status = "running"; row.payload = { changedByAnotherWorker: true }; } return q; }, maybeSingle: async () => run() }; return q;
  } };
  const noProvider = () => assert.fail("No external provider or publication may run in a conflicting request");
  const common: Row = { "next/server": { NextResponse: { json: Response.json } }, "@/lib/requireUser": { requireUser: async () => ({ user: { id: ACCOUNT }, authUserId: ACCOUNT, activeUserId: ACCOUNT }) }, "@/lib/supabaseAdmin": { supabaseAdmin: db }, "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async () => "premium", premiumRequiredApiResponse: noProvider }, "@/lib/standardAgentPolicy": { isStandardAgentActionDescriptor: () => true }, "@/lib/inrAssistantActionPreview": helper, "@/lib/inrAgentScheduledActions": { rowToInrAgentScheduledAction: (value: Row) => value } };
  const patchRoute = load("../../app/api/agent/scheduled-actions/[id]/route.ts", { ...common, "@/lib/inrAgentPublicationChannelSelectionServer": { saveAgentPublicationChannels: noProvider }, "@/lib/inrAgentScheduledPayload": { compactInrAgentScheduledPayload: (value: unknown) => value, hasUnauthorizedScheduledStorageReference: () => false }, "@/lib/storageContentUrl": { buildAbsoluteStorageContentUrl: noProvider }, "@/lib/boosterSoundtracks": {}, "@/lib/inrAgentPublicationSoundtrack": {} });
  const executeRoute = load("../../app/api/agent/scheduled-actions/[id]/execute/route.ts", { ...common, "@/app/api/agent/actions/execute/route": { POST: noProvider }, "@/app/api/booster/publish-now/route": { POST: noProvider }, "@/lib/inrAgentScheduledPublication": { buildScheduledPublicationRequest: noProvider, interpretScheduledPublicationResponse: noProvider } });
  const request = (body: Row) => new Request(`https://app.test/api/agent/scheduled-actions/${ID}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const context = { params: Promise.resolve({ id: ID }) };
  return { patch: (body: Row) => patchRoute.PATCH(request(body), context), execute: (body: Row) => executeRoute.POST(request(body), context), fingerprint: () => helper.scheduledPublicationFingerprint(row), writes, row: () => row };
}
test("native schedule changes require the same unstarted snapshot, including the atomic status/attempt/payload guard", async () => {
  for (const race of [false, true]) { const h = harness({ race }), fingerprint = h.fingerprint(); const response = await h.patch({ expectedState: fingerprint, status: "cancelled" });
    assert.equal(response.status, race ? 409 : 200); assert.equal(h.row().status, race ? "running" : "cancelled");
    for (const field of ["status", "updated_at", "payload", "attempt_count", "executed_at", "scheduled_at"]) assert.ok(h.writes[0].filters.some(([, key]: string[]) => key === field), field);
  }
});
test("native stale previews, attempted rows, forbidden fields and past rescheduling fail before the write", async () => {
  const stale = harness(); assert.equal((await stale.patch({ expectedState: "0".repeat(64), status: "cancelled" })).status, 409); assert.equal(stale.writes.length, 0);
  const failed = harness({ status: "failed" }); assert.equal((await failed.patch({ expectedState: failed.fingerprint(), status: "cancelled" })).status, 409); assert.equal(failed.writes.length, 0);
  const injected = harness(); assert.equal((await injected.patch({ expectedState: injected.fingerprint(), status: "cancelled", payload: { new: "unapproved" } })).status, 400); assert.equal(injected.writes.length, 0);
  const past = harness(); assert.equal((await past.patch({ expectedState: past.fingerprint(), scheduledAt: "2020-01-01T00:00:00Z" })).status, 400); assert.equal(past.writes.length, 0);
});
test("native retry claims the exact failed snapshot and loses cleanly to a concurrent worker without calling publication", async () => {
  const h = harness({ status: "failed", race: true }); const response = await h.execute({ expectedState: h.fingerprint() }); assert.equal(response.status, 409); assert.equal(h.row().status, "running");
  for (const field of ["status", "updated_at", "payload", "attempt_count"]) assert.ok(h.writes[0].filters.some(([, key]: string[]) => key === field), field);
  const stale = harness({ status: "failed" }); assert.equal((await stale.execute({ expectedState: "0".repeat(64) })).status, 409); assert.equal(stale.writes.length, 0);
});
