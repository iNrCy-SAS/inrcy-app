import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Refusal from "../../lib/inrAgentUnvalidatedPublicationRefusal.ts";
type Row = Record<string, unknown>;
function harness(patch: Row = {}, race: Row = {}) {
  const original: Row = { id: "action", user_id: "account", automation_key: "publish", action_type: "publication", target_tool: "booster", status: "pending_validation", updated_at: "2026-10-30T09:00:00Z", validated_at: null, completed_at: null, scheduled_for: null, ...patch };
  const saved = { ...original };
  let writes = 0;
  const queries: Row[][] = [];
  const supabaseAdmin = { from(table: string) { assert.equal(table, "inr_agent_actions"); const filters: Row[] = []; queries.push(filters); let values: Row | undefined; const query = { select() { return query; }, eq(key: string, value: unknown) { filters.push({ key, value }); return query; }, is(key: string, value: unknown) { filters.push({ key, value }); return query; }, update(value: Row) { values = value; Object.assign(saved, race); return query; }, async maybeSingle() {
    const matches = filters.every(filter => saved[String(filter.key)] === filter.value);
    if (!matches) return { data: null, error: null };
    if (values) { writes++; Object.assign(saved, values); }
    return { data: { ...saved }, error: null };
  } }; return query; } };
  const deps: Row = { "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin }, "@/lib/inrAgentActions": { rowToInrAgentAction: (row: Row) => ({ ...row, automationKey: row.automation_key, actionType: row.action_type, targetTool: row.target_tool }) }, "@/app/api/agent/actions/actionPublishDraft.foundations": { isPublishAction: (action: Row) => action.automationKey === "publish" && action.actionType === "publication" && action.targetTool === "booster" } };
  const code = ts.transpileModule(readFileSync(new URL("../../lib/inrAgentUnvalidatedPublicationRefusal.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date })((name: string) => { assert.ok(name in deps, name); return deps[name]; }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof Refusal;
  return { refuse: (expectedUpdatedAt: unknown = original.updated_at) => runtime.refuseUnvalidatedInrAgentPublication({ accountId: "account", actionId: "action", expectedUpdatedAt, select: "fixed" }), get: () => saved, writes: () => writes, queries };
}
test("only owned unvalidated publication states can be refused and SQL pins the read version", async () => {
  for (const status of ["prepared", "pending_validation", "pending", "draft"]) { const h = harness({ status }); await h.refuse(); assert.equal(h.get().status, "refused"); assert.equal(h.writes(), 1); assert.equal(h.queries[1].length, 7); }
  for (const patch of [{ user_id: "other" }, { automation_key: "other" }, { action_type: "campaign" }, { target_tool: "crm" }, { status: "validated" }, { status: "scheduled" }, { status: "completed" }, { status: "refused" }, { validated_at: "today" }, { completed_at: "today" }, { scheduled_for: "2026-12-01" }]) { const h = harness(patch); await assert.rejects(() => h.refuse()); assert.equal(h.writes(), 0); }
});
test("every validation, scheduling, completion or version race rejects without overwriting the new state", async () => {
  for (const race of [{ status: "validated" }, { updated_at: "changed" }, { validated_at: "today" }, { completed_at: "today" }, { scheduled_for: "2026-12-01" }, { user_id: "other" }]) { const h = harness({}, race); await assert.rejects(() => h.refuse(), { status: 409 }); assert.equal(h.writes(), 0); for (const [key, value] of Object.entries(race)) assert.equal(h.get()[key], value); }
  for (const expected of [null, "", "stale"]) { const h = harness(); await assert.rejects(() => h.refuse(expected), { status: 409 }); assert.equal(h.writes(), 0); }
});
test("native route preserves legacy UI requests and only opts into strict refusal with an expected version", () => {
  const source = readFileSync(new URL("../../app/api/agent/actions/route.ts", import.meta.url), "utf8");
  assert.match(source, /status === "refused" && requestBody\?\.expectedUpdatedAt !== undefined/);
  assert.match(source, /refuseUnvalidatedInrAgentPublication\(\{ accountId: activeUserId, actionId, expectedUpdatedAt: requestBody.expectedUpdatedAt/);
});
