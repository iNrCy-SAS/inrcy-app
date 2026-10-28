import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
type Row = Record<string, any>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", DRAFT = "30000000-0000-4000-8000-000000000003";
function harness(race = false) {
  let row: Row = { id: DRAFT, user_id: ACCOUNT, type: "mail", status: "draft", subject: "Initial", updated_at: "2026-10-28T10:00:00.000Z" };
  const writes: Row[] = [];
  const db = { from(table: string) { assert.equal(table, "send_items"); const filters: Row = {}; let patch: Row = {};
    const query = { update(value: Row) { patch = value; if (race) { row.updated_at = "2026-10-28T10:00:01.000Z"; row.subject = "Concurrent edit"; } return query; }, select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { writes.push({ filters, patch }); assert.equal(filters.user_id, ACCOUNT); const matches = Object.entries(filters).every(([key, value]) => row[key] === value); if (matches) row = { ...row, ...patch }; return { data: matches ? { id: DRAFT } : null, error: null }; } }; return query;
  } };
  const dependencies: Row = { "next/server": { NextResponse: { json: Response.json } }, "@/lib/requireUser": { requireUser: async () => ({ supabase: db, activeUserId: ACCOUNT }) }, "@/lib/crmRecipients": { normalizeCampaignRecipients: () => [], normalizeRecipientEmails: () => [] }, "@/lib/mailRichText": { normalizeRichMailHtmlForSend: (_text: string, html: string) => html } };
  const code = ts.transpileModule(readFileSync(new URL("../../app/api/mails/workflow-draft/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as Row }; vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Response, URL })((key: string) => { assert.ok(Object.hasOwn(dependencies, key), key); return dependencies[key]; }, module, module.exports);
  const post = (expectedUpdatedAt: unknown = "2026-10-28T10:00:00.000Z") => module.exports.POST(new Request("https://app.test/api/mails/workflow-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: DRAFT, kind: "propulser", folder: "propulsions", trackType: "promo_mail", subject: "Approved preview", bodyText: "Contenu", expectedUpdatedAt }) }));
  return { post, writes, row: () => row };
}
test("native draft preview save checks the revision in the same SQL write and cannot overwrite a concurrent editor", async () => {
  for (const race of [false, true]) { const h = harness(race), response = await h.post(); assert.equal(response.status, race ? 409 : 200); assert.equal(h.writes[0].filters.updated_at, "2026-10-28T10:00:00.000Z"); assert.equal(h.row().subject, race ? "Concurrent edit" : "Approved preview"); }
});
test("native draft revision validation rejects malformed guards before any database write", async () => {
  const h = harness(); assert.equal((await h.post({ arbitrary: true })).status, 400); assert.equal(h.writes.length, 0);
});
