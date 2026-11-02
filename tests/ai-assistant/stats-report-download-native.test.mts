import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", REPORT = "70000000-0000-4000-8000-000000000007", OTHER = "90000000-0000-4000-8000-000000000009";
function load<T>(path: string, deps: Row): T { const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const loaded = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Response, Request, AbortSignal, TextDecoder, Date, URL, encodeURIComponent })((key: string) => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; }, loaded, loaded.exports); return loaded.exports as T; }
function harness() {
  let account = ACCOUNT, unauthenticated = false, scopeChange = false, storageError: Row | null = null, bytes = new Blob(["%PDF-1.7\nMocked report"]), authReads = 0;
  const report: Row = { id: REPORT, user_id: ACCOUNT, automation_key: "stats", action_type: "stats_report", target_tool: "inrstats", payload: { reportDocument: { bucket: "inr-agent-reports", storagePath: `${ACCOUNT}/stats/2026/10/28/bilan.pdf`, filename: "bilan octobre.pdf", downloadUrl: "https://outside.invalid/exfil" } } };
  const queries: Row[] = [], downloads: Array<{ bucket: string; path: string }> = [];
  const supabaseAdmin = { from(table: string) { assert.equal(table, "inr_agent_actions"); const filters: Row = {}, q = { select() { return q; }, eq(key: string, value: unknown) { filters[key] = value; return q; }, abortSignal() { return q; }, async maybeSingle() { queries.push({ ...filters }); return { data: Object.entries(filters).every(([key, value]) => report[key] === value) ? JSON.parse(JSON.stringify(report)) : null, error: null }; } }; return q; }, storage: { from(bucket: string) { return { async download(path: string) { downloads.push({ bucket, path }); return { data: storageError ? null : bytes, error: storageError }; } }; } } };
  const helper = load<typeof import("../../lib/inrAssistantStatsReportDocument.ts")>("../../lib/inrAssistantStatsReportDocument.ts", {});
  const route = load<{ GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> }>("../../app/api/assistant/reports/[id]/download/route.ts", { "@/lib/requireUser": { requireUser: async () => { authReads++; return { activeUserId: scopeChange && authReads > 1 ? OTHER : account, authUserId: ACTOR, errorResponse: unauthenticated ? Response.json({}, { status: 401 }) : null }; } }, "@/lib/supabaseAdmin": { supabaseAdmin }, "@/lib/inrAssistantStatsReportDocument": helper });
  const get = (id = REPORT) => route.GET(new Request(`https://app.test/api/assistant/reports/${id}/download`), { params: Promise.resolve({ id }) });
  return { get, report, queries, downloads, account: (value: string) => { account = value; }, loggedOut: () => { unauthenticated = true; }, changeDuring: () => { scopeChange = true; }, missing: () => { storageError = { statusCode: "404" }; }, unavailable: () => { storageError = { statusCode: "503" }; }, content: (value: Blob) => { bytes = value; } };
}
test("native PDF route reauthenticates and returns an owned real PDF attachment without arbitrary redirects", async () => {
  const h = harness(), result = await h.get(); assert.equal(result.status, 200); assert.equal(result.headers.get("content-type"), "application/pdf"); assert.match(String(result.headers.get("content-disposition")), /^attachment;.*bilan%20octobre\.pdf/); assert.equal(result.headers.get("location"), null); assert.match(String(result.headers.get("cache-control")), /no-store/); assert.match(await result.text(), /^%PDF-/);
  assert.deepEqual(h.queries[0], { user_id: ACCOUNT, id: REPORT, automation_key: "stats", action_type: "stats_report", target_tool: "inrstats" }); assert.deepEqual(h.downloads, [{ bucket: "inr-agent-reports", path: `${ACCOUNT}/stats/2026/10/28/bilan.pdf` }]);
});
test("replaying a report download after switching establishment never reads private storage", async () => { const h = harness(); h.account(OTHER); assert.equal((await h.get()).status, 404); assert.equal(h.downloads.length, 0); });
test("a switch during storage retrieval withholds the response body", async () => { const h = harness(); h.changeDuring(); const response = await h.get(); assert.equal(response.status, 404); assert.ok(!(await response.text()).includes("%PDF-")); });
test("logged out, malformed IDs and campaign rows cannot download", async () => {
  const loggedOut = harness(); loggedOut.loggedOut(); assert.equal((await loggedOut.get()).status, 401); assert.equal(loggedOut.downloads.length, 0);
  const malformed = harness(); assert.equal((await malformed.get("../../foreign")).status, 404); assert.equal(malformed.queries.length, 0);
  const campaign = harness(); campaign.report.action_type = "campaign"; assert.equal((await campaign.get()).status, 404); assert.equal(campaign.downloads.length, 0);
});
test("expired/pruned/foreign/traversal report paths fail closed before storage", async () => {
  for (const document of [null, { bucket: "inr-agent-reports", storagePath: `${OTHER}/stats/report.pdf` }, { bucket: "inr-agent-reports", storagePath: `${ACCOUNT}/stats/../secret.pdf` }, { bucket: "inr-agent-reports", storagePath: `${ACCOUNT}/stats/%2e%2e/secret.pdf` }, { bucket: "private-secrets", storagePath: `${ACCOUNT}/stats/report.pdf` }]) { const h = harness(); (h.report.payload as Row).reportDocument = document; assert.equal((await h.get()).status, 410); assert.equal(h.downloads.length, 0); }
});
test("missing PDF differs from storage outage; malformed or oversized contents are never served", async () => {
  const missing = harness(); missing.missing(); assert.equal((await missing.get()).status, 410);
  const outage = harness(); outage.unavailable(); assert.equal((await outage.get()).status, 503);
  for (const content of [new Blob(["<html>not a PDF</html>"]), new Blob([new Uint8Array(8 * 1024 * 1024 + 1)])]) { const h = harness(); h.content(content); assert.equal((await h.get()).status, 410); }
});
