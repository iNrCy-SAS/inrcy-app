import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as actions from "../../lib/inrAssistantUiActions.ts";
import { getInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";
import type * as Receipts from "../../lib/inrAssistantUiReceipts.ts";
import type * as Route from "../../app/api/assistant/ui-results/route.ts";

const scope = { accountId: "11111111-1111-4111-8111-111111111111", actorUserId: "22222222-2222-4222-8222-222222222222", conversationId: "33333333-3333-4333-8333-333333333333" };
const turn = { turnId: "44444444-4444-4444-8444-444444444444", createdAt: "2026-11-02T10:00:00.000Z" };
const planActions = actions.inrAssistantUiActionsFromToolResult("document", { ok: true, navigation: getInrAssistantNavigation("quotes", scope.accountId), uiCommand: { command: "export_document_pdf", selection: { kind: "quote", id: scope.accountId } } });
function harness() {
  const files = new Map<string, Buffer>();
  const authScope = { ...scope };
  let now = Date.parse(turn.createdAt);
  class Clock extends Date { static now() { return now; } }
  const storage = {
    async upload(path: string, data: Buffer, options: { upsert: boolean }) {
      assert.equal(options.upsert, false);
      if (files.has(path)) return { error: { statusCode: 409, message: "Duplicate" } };
      files.set(path, Buffer.from(data)); return { error: null };
    },
    async download(path: string) { return files.has(path) ? { data: new Blob([new Uint8Array(files.get(path)!)]), error: null } : { data: null, error: { statusCode: 404, message: "Object not found" } }; },
  };
  const deps: Record<string, unknown> = { "server-only": {}, "node:crypto": crypto,
    "./supabaseAdmin": { supabaseAdmin: { storage: { from(bucket: string) { assert.equal(bucket, "inrcy-assistant-attachments"); return storage; } } } },
    "./inrAssistantAttachments.ts": { ASSISTANT_ATTACHMENT_BUCKET: "inrcy-assistant-attachments", ASSISTANT_ATTACHMENT_UUID: /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i },
    "./inrAssistantUiActions.ts": actions,
  };
  const load = (file: string) => {
    const source = ts.transpileModule(readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const record = { exports: {} };
    vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Buffer, URL, Date: Clock, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "fixture-secret-never-production-1234567890" } }, setTimeout, clearTimeout })(
      (name: string) => { assert.ok(name in deps, name); return deps[name]; }, record, record.exports);
    return record.exports;
  };
  deps["./inrAssistantActionPreview.ts"] = load("inrAssistantActionPreview.ts");
  const api = load("inrAssistantUiReceipts.ts") as typeof Receipts;
  const token = api.createInrAssistantUiReceiptToken(scope, turn, planActions);
  const plan = api.verifyInrAssistantUiReceiptToken(token, scope)!;
  deps["@/lib/inrAssistantUiReceipts"] = api;
  deps["@/lib/requireUser"] = { requireUser: async () => ({ activeUserId: authScope.accountId, authUserId: authScope.actorUserId }) };
  deps["next/server"] = { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } };
  const route = load("../app/api/assistant/ui-results/route.ts") as typeof Route;
  return { api, token, plan, files, route, authScope, advance: (ms: number) => { now += ms; } };
}

test("browser token binds exact actions, actor/account and expiry without authorizing a business write", () => {
  const { api, token, plan, advance } = harness();
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.turnId, turn.turnId);
  assert.equal(api.verifyInrAssistantUiReceiptToken(token, { ...scope, actorUserId: scope.accountId }), null);
  assert.equal(api.verifyInrAssistantUiReceiptToken(token, { ...scope, accountId: scope.actorUserId }), null);
  const [encoded, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()); payload.patch.actions[1].command.selection.id = scope.actorUserId;
  assert.equal(api.verifyInrAssistantUiReceiptToken(`${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`, scope), null);
  advance(16 * 60_000);
  assert.equal(api.verifyInrAssistantUiReceiptToken(token, scope), null);
});

test("claim is exclusive across concurrent tabs and unknown actions are rejected", async () => {
  const { api, plan, files } = harness();
  assert.equal(await api.claimInrAssistantUiAction(plan, "invented"), false);
  assert.equal(files.size, 0);
  const claims = await Promise.all([api.claimInrAssistantUiAction(plan, plan.actions[0].id), api.claimInrAssistantUiAction(plan, plan.actions[0].id)]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test("dependent export cannot be claimed until navigation has a browser report", async () => {
  const { api, plan } = harness();
  assert.equal(await api.claimInrAssistantUiAction(plan, plan.actions[1].id), false);
  assert.equal(await api.claimInrAssistantUiAction(plan, plan.actions[0].id), true);
  assert.equal(await api.claimInrAssistantUiAction(plan, plan.actions[1].id), false);
  assert.ok(await api.saveInrAssistantUiResult(plan, { actionId: plan.actions[0].id, source: "browser_reported", status: "applied" }));
  assert.equal(await api.claimInrAssistantUiAction(plan, plan.actions[1].id), true);
});

test("receipt requires an exact prior claim and cannot assert the wrong kind of completion", async () => {
  const { api, plan } = harness();
  const raw = { actionId: plan.actions[0].id, source: "browser_reported", status: "applied" };
  assert.equal(await api.saveInrAssistantUiResult(plan, raw), null);
  await api.claimInrAssistantUiAction(plan, plan.actions[0].id);
  assert.equal(await api.saveInrAssistantUiResult(plan, { ...raw, source: "server_verified" }), null);
  assert.equal(await api.saveInrAssistantUiResult(plan, { ...raw, status: "handed_to_browser" }), null);
  assert.ok(await api.saveInrAssistantUiResult(plan, raw));
});

test("failed or cancelled first report is immutable and never permits the dependent action", async () => {
  for (const status of ["failed", "cancelled"]) {
    const { api, plan } = harness();
    await api.claimInrAssistantUiAction(plan, plan.actions[0].id);
    const result = { actionId: plan.actions[0].id, source: "browser_reported", status };
    await api.saveInrAssistantUiResult(plan, result);
    assert.equal((await api.saveInrAssistantUiResult(plan, { ...result, status: "applied" }))?.status, status);
    assert.equal(await api.claimInrAssistantUiAction(plan, plan.actions[1].id), false);
  }
});

test("persisted browser results are bounded reports and never stored task/business receipts", async () => {
  const { api, plan, files } = harness();
  await api.claimInrAssistantUiAction(plan, plan.actions[0].id);
  await api.saveInrAssistantUiResult(plan, { actionId: plan.actions[0].id, source: "browser_reported", status: "applied", arbitrary: "ignored", paymentConfirmed: true });
  const rows = await api.loadInrAssistantUiResults(scope, turn, planActions);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["actionId", "source", "status"]);
  assert.ok([...files.keys()].every(path => path.endsWith(".claim.json") || path.endsWith(".result.json")));
  assert.ok([...files.values()].every(bytes => !bytes.toString().includes("paymentConfirmed")));
});

test("HTTP receipt endpoint binds authenticated actor and account, validates origin and bounds bytes", async () => {
  const { route, token, authScope, files } = harness();
  const post = (body: unknown, origin = "https://fixture.invalid") => route.POST(new Request("https://fixture.invalid/api/assistant/ui-results", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }));
  const body = { token, action: "claim", actionId: planActions[0].id };
  assert.equal((await post(body, "https://external.invalid")).status, 403);
  assert.equal((await post({ ...body, padding: "x".repeat(29_000) })).status, 413);
  authScope.actorUserId = scope.accountId;
  assert.equal((await post(body)).status, 403);
  authScope.actorUserId = scope.actorUserId; authScope.accountId = scope.actorUserId;
  assert.equal((await post(body)).status, 403);
  assert.equal(files.size, 0);
});

test("HTTP claim and result persist only a browser report and refuse replay of a claimed action", async () => {
  const { route, token } = harness();
  const post = (body: unknown) => route.POST(new Request("https://fixture.invalid/api/assistant/ui-results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const claim = { token, action: "claim", actionId: planActions[0].id };
  assert.equal((await post(claim)).status, 200);
  assert.equal((await post(claim)).status, 409);
  const response = await post({ token, result: { actionId: planActions[0].id, source: "browser_reported", status: "applied" } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.businessActionConfirmed, false);
  assert.equal(result.source, "browser_reported");
});
