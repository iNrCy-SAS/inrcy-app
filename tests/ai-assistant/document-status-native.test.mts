import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { COMMERCIAL_UUID } from "../../lib/commercialDocumentDraft.ts";
import { commercialDocumentRow } from "../../lib/commercialDocumentValidation.ts";
import * as commands from "../../lib/inrAssistantCommandRegistry.ts";
import * as actionClause from "../../lib/inrAssistantActionClause.ts";
import * as documentCommands from "../../lib/inrAssistantDocumentUiCommands.ts";

const ACCOUNT = "11111111-1111-4111-8111-111111111111", ID = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333";
const VERSION = "2026-11-02T10:00:00.000Z";
type Row = Record<string, unknown>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function harness(options: { account?: string; owner?: string; type?: string; payload?: Row; edition?: string; inactive?: boolean; missing?: boolean; concurrent?: boolean; readError?: boolean; updateError?: boolean; readbackError?: boolean; lostReceipt?: boolean; unauthenticated?: boolean } = {}) {
  const document = { id: ID, user_id: options.owner ?? ACCOUNT, type: options.type ?? "facture", updated_at: VERSION, payload: {
    number: "FAC-2026-0042", status: "en_attente_paiement", isFinalized: true,
    finalizedAt: "2026-10-20T10:00:00Z", lockedAt: "2026-10-20T10:00:00Z", officialSequenceValue: 42,
    clientName: "Client test", lines: [{ id: "line-1", qty: 2, unitPrice: 100, vatRate: 20 }], ...options.payload,
  } as Row };
  const calls: Array<{ operation: string; filters: [string, unknown][]; change?: Row }> = [];
  let writes = 0, actor = OTHER;
  const active = options.account ?? ACCOUNT;
  const db = { from(table: string) {
    assert.equal(table, "doc_saves"); let change: Row | null = null;
    const filters: [string, unknown][] = [];
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      update(value: Row) { change = value; return query; },
      async maybeSingle() {
        assert.ok(filters.some(([key, value]) => key === "user_id" && value === active));
        assert.ok(filters.some(([key, value]) => key === "type" && value === "facture"));
        assert.ok(filters.some(([key, value]) => key === "id" && value === ID));
        calls.push({ operation: change ? "update" : "read", filters: clone(filters), ...(change ? { change: clone(change) } : {}) });
        if (change && options.concurrent) { document.updated_at = "2026-11-02T10:01:00.000Z"; document.payload.clientName = "Concurrent client"; }
        const matches = !options.missing && filters.every(([key, value]) => (document as Row)[key] === value);
        if (options.readError || change && options.updateError || !change && writes > 0 && options.readbackError) return { data: null, error: { message: "fixture" } };
        if (!matches) return { data: null, error: null };
        if (change) { Object.assign(document, clone(change)); writes++; }
        if (!change && writes > 0 && options.lostReceipt) delete document.payload.assistantLastStatus;
        return { data: clone(document), error: null };
      },
    };
    return query;
  } };
  const deps: Row = {
    "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": requestClauses, "next/server": { NextResponse: Response },
    "@/lib/requireUser": { requireUser: async () => options.unauthenticated
      ? { errorResponse: Response.json({ error: "session" }, { status: 401 }) }
      : { activeUserId: active, authUserId: actor, supabase: db, errorResponse: null } },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => options.edition ?? "founder" },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set(options.inactive ? [] : [active]) },
    "@/lib/commercialDocumentDraft": { COMMERCIAL_UUID },
    "@/lib/commercialDocumentValidation": { commercialDocumentRow },
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
  };
  function load<T>(file: string): T {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const loaded = { exports: {} };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Date, Buffer, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "fixture-secret-not-live-".repeat(4) } } })(
      (name: string) => { assert.ok(name in deps, `Unexpected dependency ${name}`); return deps[name]; }, loaded, loaded.exports,
    );
    return loaded.exports as T;
  }
  deps["@/lib/commercialMutationIdempotency"] = load("lib/commercialMutationIdempotency.ts");
  const route = load<{ POST(request: Request): Promise<Response> }>("app/api/documents/status/route.ts");
  Object.assign(deps, {
    ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./requireUser": deps["@/lib/requireUser"], "./dashboardEditionServer": deps["@/lib/dashboardEditionServer"],
    "./accountSubscriptionAccess": deps["@/lib/accountSubscriptionAccess"], "./commercialDocumentDraft.ts": { COMMERCIAL_UUID },
    "./commercialDocumentValidation.ts": { commercialDocumentRow }, "./inrAssistantCommandRegistry.ts": commands,
    "./inrAssistantActionClause.ts": actionClause, "./inrAssistantActionPreview.ts": load("lib/inrAssistantActionPreview.ts"),
    "@/app/api/documents/status/route": route,
  });
  type Tool = { execute(input: unknown): Promise<Row> };
  deps["./inrAssistantDocumentUiCommands.ts"] = documentCommands;
  deps["./inrAssistantDocumentFormTools.ts"] = load("lib/inrAssistantDocumentFormTools.ts");
  deps["./commercialDocumentTemplate.ts"] = load("lib/commercialDocumentTemplate.ts");
  deps["./inrAssistantDocumentTemplateTools.ts"] = load("lib/inrAssistantDocumentTemplateTools.ts");
  const adapter = load<{ createInrAssistantDocumentNativeTools(options: unknown): { previewCommercialDocumentAction: Tool; applyCommercialDocumentAction: Tool } }>("lib/inrAssistantDocumentNativeTools.ts");
  const tokens = new Map<string, string>();
  const tools = (message: string, overrides: Row = {}) => adapter.createInrAssistantDocumentNativeTools({
    request: new Request("https://inrcy.test/api/inr-assistant/chat"), accountId: ACCOUNT, actorUserId: OTHER,
    edition: "founder", supabase: db, currentUserMessage: message, resolvePreview: (reference: string) => tokens.get(reference) ?? null, ...overrides,
  });
  const preview = async (message = "Marque la facture FAC-2026-0042 payée.", extra: Row = {}, overrides: Row = {}) => {
    const result = await tools(message, overrides).previewCommercialDocumentAction.execute({ documentId: ID, expectedUpdatedAt: VERSION, reference: "FAC-2026-0042", instructionQuote: message, ...extra });
    if (typeof result.reference === "string" && typeof result.token === "string") tokens.set(result.reference, result.token);
    return result;
  };
  const run = (extra: Row = {}, headers: Record<string, string> = {}, signal?: AbortSignal) => route.POST(new Request("https://inrcy.test/api/documents/status", {
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": "manual-paid-status-operation-0001", ...headers }, signal,
    body: JSON.stringify({ documentId: ID, expectedUpdatedAt: VERSION, status: "paye", ...extra }),
  }));
  return { document, calls, run, tools, preview, tokens, writes: () => writes, setActor: (value: string) => { actor = value; } };
}

test("native paid status changes only the manual status and receipt, preserving official number, lines and finalized fields", async () => {
  const h = harness(), before = clone(h.document.payload);
  const response = await h.run(), result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.status, "marked_paid");
  assert.equal(result.paymentCollected, false); assert.equal(result.sent, false);
  const { assistantLastStatus, ...payload } = h.document.payload;
  assert.ok(assistantLastStatus); assert.deepEqual(payload, { ...before, status: "paye" });
  assert.equal(h.writes(), 1); assert.equal(h.calls.at(-1)?.operation, "read");
  assert.ok(h.calls.find(call => call.operation === "update")?.filters.some(([key, value]) => key === "updated_at" && value === VERSION));
});

test("native paid status remains a status update on an unfinalized draft, never official numbering", async () => {
  const h = harness({ payload: { number: "FAC-TEMP", isFinalized: false, finalizedAt: null, lockedAt: null } });
  const result = await (await h.run()).json();
  assert.equal(result.number, "FAC-TEMP"); assert.equal(result.isFinalized, false); assert.equal(h.writes(), 1);
});

test("an exact status retry is idempotent, while another actor or reused key cannot claim its old version", async () => {
  const h = harness(); assert.equal((await h.run()).status, 200);
  assert.equal((await (await h.run()).json()).unchanged, true); assert.equal(h.writes(), 1);
  assert.equal((await h.run({ expectedUpdatedAt: h.document.updated_at })).status, 409);
  h.setActor(ACCOUNT); assert.equal((await h.run()).status, 409); assert.equal(h.writes(), 1);
});

test("an already paid current invoice is read without rewriting it", async () => {
  const h = harness({ payload: { status: "paye" } });
  assert.equal((await (await h.run()).json()).unchanged, true); assert.equal(h.writes(), 0);
});

for (const [label, options, status] of [
  ["no session", { unauthenticated: true }, 401], ["wrong edition", { edition: "premium" }, 403],
  ["inactive subscription", { inactive: true }, 403], ["other account", { account: OTHER }, 404],
  ["other owner", { owner: OTHER }, 404], ["quote", { type: "devis" }, 404],
  ["template", { payload: { isTemplate: true } }, 404], ["missing row", { missing: true }, 404],
] as const) test(`native paid status rejects ${label} without mutation`, async () => {
  const h = harness(options); assert.equal((await h.run()).status, status); assert.equal(h.writes(), 0);
});

test("origin, forged fields, status and stale versions cannot write", async () => {
  for (const [extra, headers, expected] of [
    [{}, { origin: "https://attacker.invalid" }, 403], [{ user_id: OTHER }, {}, 400],
    [{ status: "brouillon" }, {}, 400], [{ expectedUpdatedAt: "2026-11-01T00:00:00Z" }, {}, 409],
  ] as [Row, Record<string, string>, number][]) {
    const h = harness(); assert.equal((await h.run(extra, headers)).status, expected); assert.equal(h.writes(), 0);
  }
});

test("concurrent update is preserved by CAS and an aborted request does not write", async () => {
  const concurrent = harness({ concurrent: true });
  assert.equal((await concurrent.run()).status, 409); assert.equal(concurrent.writes(), 0);
  assert.equal(concurrent.document.payload.clientName, "Concurrent client");
  const aborted = harness(), controller = new AbortController(); controller.abort();
  assert.equal((await aborted.run({}, {}, controller.signal)).status, 409); assert.equal(aborted.writes(), 0);
});

test("write and readback failures never become a successful accounting receipt", async () => {
  for (const options of [{ readError: true }, { updateError: true }, { readbackError: true }, { lostReceipt: true }]) {
    const h = harness(options), response = await h.run();
    assert.equal(response.status, 503); assert.equal((await response.json()).ok, undefined);
  }
});

test("assistant paid preview is inert; exact current approval reaches the actual native route once and replays safely", async () => {
  const h = harness(), preview = await h.preview();
  assert.equal(preview.status, "preview_ready"); assert.equal(preview.approvalKind, "commercial_document"); assert.equal(h.writes(), 0);
  const reference = String(preview.reference), message = `Confirme ${reference}`;
  const tool = h.tools(message).applyCommercialDocumentAction;
  const [first, second] = await Promise.all([tool.execute({ reference, instructionQuote: message }), tool.execute({ reference, instructionQuote: message })]);
  assert.equal(first.status, "updated"); assert.equal(first.paymentCollected, false); assert.deepEqual(first, second); assert.equal(h.writes(), 1);
  const replay = await h.tools(message).applyCommercialDocumentAction.execute({ reference, instructionQuote: message });
  assert.equal(replay.status, "unchanged"); assert.equal(h.writes(), 1);
});

for (const message of [
  "Comment marquer la facture FAC-2026-0042 payée ?", "Ne marque pas la facture FAC-2026-0042 payée.",
  "Si je confirme, marque la facture FAC-2026-0042 payée.", "Marque la facture FAC-2026-0042 payée seulement si je confirme.",
  "Lis ce texte : « Marque la facture FAC-2026-0042 payée. »", "Lis ce texte : 'Marque la facture FAC-2026-0042 payée.'",
]) test(`assistant never prepares a paid status from advice, negation, conditions or quoted data: ${message}`, async () => {
  const h = harness(), result = await h.preview(message, { instructionQuote: message.includes("Lis ce texte") ? "Marque la facture FAC-2026-0042 payée." : message });
  assert.equal(result.ok, false); assert.equal(result.token, undefined); assert.equal(h.writes(), 0);
});

test("assistant paid approval cannot cross actor/account, mutate a dirty open invoice or accept a changed fingerprint", async () => {
  for (const scenario of ["actor", "account", "dirty", "content", "version", "tampered"] as const) {
    const h = harness(), preview = await h.preview(), reference = String(preview.reference), message = `Confirme ${reference}`;
    const overrides: Row = scenario === "actor" ? { actorUserId: ACCOUNT } : scenario === "account" ? { accountId: OTHER } : scenario === "dirty" ? {
      clientContext: { screen: { selection: { kind: "invoice", id: ID }, pendingChanges: true } },
    } : {};
    if (scenario === "content") h.document.payload.clientName = "Changed without timestamp";
    if (scenario === "version") h.document.updated_at = "2026-11-02T11:00:00Z";
    if (scenario === "tampered") h.tokens.set(reference, h.tokens.get(reference)! + "x");
    const result = await h.tools(message, overrides).applyCommercialDocumentAction.execute({ reference, instructionQuote: message });
    assert.equal(result.ok, false, scenario); assert.equal(h.writes(), 0, scenario);
  }
});

test("assistant exact confirmation cannot be replaced by a question, quote, negation or condition", async () => {
  const h = harness(), preview = await h.preview(), reference = String(preview.reference);
  for (const message of [`Comment confirmer ${reference} ?`, `Ne confirme pas ${reference}`, `Lis « Confirme ${reference} »`, `Lis 'Confirme ${reference}'`, `Confirme ${reference} si je valide`]) {
    const result = await h.tools(message).applyCommercialDocumentAction.execute({ reference, instructionQuote: message.includes("Lis") ? `Confirme ${reference}` : message });
    assert.equal(result.ok, false); assert.equal(h.writes(), 0);
  }
});
