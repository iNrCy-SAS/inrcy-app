import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, jsonSchema, tool } from "ai";
import * as documentInput from "../../lib/commercialDocumentDraft.ts";
import type * as Commercial from "../../lib/inrAssistantCommercialTools.ts";
import type * as Idempotency from "../../lib/commercialMutationIdempotency.ts";

type Row = Record<string, unknown>;
type Tool = { execute(input: unknown): Promise<Commercial.InrAssistantCommercialResult>; inputSchema: Parameters<typeof asSchema>[0] };
const accountId = "11000000-0000-4000-8000-000000000001";
const contactId = "22000000-0000-4000-8000-000000000001";
const foreignId = "99000000-0000-4000-8000-000000000001";
const key = "trusted-stable-request-key-123456";
const createMessage = "Crée le contact Marie Durand dans le CRM avec marie@example.test.";
const updateMessage = "Modifie le téléphone du contact Jean Dupont dans le CRM : 0102030405.";
const deleteMessage = "Supprime la fiche contact Jean Dupont du CRM.";
const draftMessage = "Prépare un devis pour Jean Dupont : 2 prestations de nettoyage à 100 euros HT, TVA 20%.";
const draft = (kind: "devis" | "facture" = "devis"): documentInput.CommercialDocumentDraftInput => ({ kind,
  client: { contactId, name: null, email: null, address: null, postalCode: null, city: null, type: null },
  lines: [{ label: "Nettoyage", qty: 2, unitPrice: 100, vatRate: 20 }], documentDate: null, dueDate: null, validityDays: null, notes: null });
const manage = (action: "create" | "update" | "delete", instructionQuote: string, fields: Row = {}, id: string | null = contactId, reference = "Jean Dupont") => ({ action, instructionQuote, contactId: id, reference, fields });

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Request, Response, Headers, URL, Date, setTimeout: (run: () => void) => setTimeout(run, 0) })((name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, record, record.exports);
  return record.exports as T;
}
const idempotency = load<typeof Idempotency>("lib/commercialMutationIdempotency.ts", { "server-only": {}, "node:crypto": { createHash } });

function harness(options: { edition?: "standard" | "premium" | "founder"; actualEdition?: "standard" | "premium" | "founder"; inactive?: boolean; authFailure?: boolean; foreignAuth?: boolean;
  readFailure?: boolean; errorAfterSave?: boolean; errorAfterDelete?: boolean; vatDispense?: boolean; ambiguous?: boolean; canStart?: boolean } = {}) {
  const calls: Array<{ table: string; operation: string; filters: Array<[string, unknown]>; body?: Row; select: string }> = [];
  const nativeCalls: Request[] = [];
  const tables: Record<string, Row[]> = { crm_contacts: [
    { id: contactId, user_id: accountId, first_name: "Jean", last_name: "Dupont", company_name: "", email: "jean@example.test", phone: "0612345678", address: "1 rue de Paris", billing_address: "1 rue de Paris", delivery_address: "", city: "Paris", postal_code: "75001", siret: "", vat_number: "", category: "particulier", contact_type: "client", notes: "PRIVATE_NOTES_NEVER_RETURN", important: true },
    { id: foreignId, user_id: foreignId, first_name: "Jean", last_name: "Dupont", notes: "FOREIGN_CONTACT" },
    ...(options.ambiguous ? [{ id: "22000000-0000-4000-8000-000000000002", user_id: accountId, first_name: "Jean", last_name: "Dupont" }] : []),
  ], doc_saves: [], profiles: [{ user_id: accountId, vat_dispense: options.vatDispense === true }] };
  let erroredAfterSave = false;
  let deleted = false;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: options.authFailure ? null : { id: "actor-user" } }, error: options.authFailure ? { message: "PRIVATE_AUTH" } : null }) },
    from(table: string) {
      assert.ok(table in tables, `Unknown table: ${table}`);
      const filters: Array<[string, unknown]> = []; let operation = "read"; let body: Row | undefined; let select = "";
      const matches = (item: Row) => filters.every(([field, value]) => field === "or" ? String(value).split(",").some(condition => { const found = /^([a-z_]+)\.ilike\.%(.+)%$/.exec(condition); return found && String(item[found[1]] || "").toLowerCase().includes(found[2].toLowerCase()); }) : item[field] === value);
      const project = (item: Row) => !select ? item : Object.fromEntries(select.split(",").map(value => {
        const column = value.trim(); const alias = /^([^:]+):payload->>?(.*)$/.exec(column);
        if (!alias) return [column, item[column]];
        const valueAtPath = (item.payload as Row | undefined)?.[alias[2]];
        return [alias[1], column.includes("->>") && valueAtPath != null ? String(valueAtPath) : valueAtPath];
      }));
      const run = async (single: boolean, limit = 8) => {
        calls.push({ table, operation, filters: [...filters], body, select });
        assert.ok(operation === "insert" ? body?.user_id === accountId : filters.some(([name, value]) => name === "user_id" && value === accountId), `Missing explicit account scope for ${table}/${operation}`);
        if (operation === "read" && (options.readFailure || deleted && options.errorAfterDelete)) return { data: null, error: { code: "PRIVATE_DATABASE", message: "PRIVATE_ERROR" } };
        if (operation === "insert") {
          if (body?.id && tables[table].some(item => item.id === body!.id)) return { data: null, error: { code: "23505", message: "PRIVATE_CONFLICT" } };
          const item = { ...body, id: body?.id || "33000000-0000-4000-8000-000000000001" };
          tables[table].push(item);
          if (options.errorAfterSave && !erroredAfterSave) { erroredAfterSave = true; return { data: null, error: { code: "57014", message: "PRIVATE_TIMEOUT" } }; }
          return { data: single ? project(item) : [project(item)], error: null };
        }
        let result = tables[table].filter(matches);
        if (operation === "update") result.forEach(item => Object.assign(item, body));
        if (operation === "delete") { tables[table] = tables[table].filter(item => !matches(item)); deleted = true; }
        result = result.slice(0, limit).map(project);
        return { data: single ? result[0] || null : result, error: null, count: result.length };
      };
      const builder = { select: (value: string) => { select = value; return builder; }, eq: (field: string, value: unknown) => { filters.push([field, value]); return builder; },
        or: (value: string) => { filters.push(["or", value]); return builder; },
        insert: (value: Row) => { operation = "insert"; body = value; return builder; }, update: (value: Row) => { operation = "update"; body = value; return builder; }, delete: () => { operation = "delete"; return builder; },
        maybeSingle: () => run(true), single: () => run(true), limit: (limit: number) => run(false, limit), then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => run(false).then(resolve, reject) };
      return builder;
    },
  };
  const auth = async () => ({ supabase, activeUserId: options.foreignAuth ? foreignId : accountId, authUserId: "actor-user", errorResponse: options.authFailure ? Response.json({ error: "Authentication required" }, { status: 401 }) : null });
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { createHash }, "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: auth }, "@/lib/supabaseServer": { createSupabaseServer: async () => supabase },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => options.foreignAuth ? foreignId : accountId },
    "@/lib/observability/withApi": { withApi: (fn: unknown) => fn },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (_error: unknown, init: ResponseInit) => Response.json({ error: "L’action est indisponible." }, init) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async (id: string) => { assert.equal(id, accountId); return options.actualEdition || options.edition || "founder"; } },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async (ids: string[]) => { assert.deepEqual(Array.from(ids), [accountId]); return new Set(options.inactive ? [] : ids); } },
    "@/lib/commercialMutationIdempotency": idempotency, "@/lib/commercialDocumentDraft": documentInput,
  };
  const crm = load<Record<"POST" | "PUT" | "DELETE", (request: Request) => Promise<Response>>>("app/api/crm/contacts/route.ts", dependencies);
  const documents = load<{ POST(request: Request): Promise<Response> }>("app/api/documents/drafts/route.ts", dependencies);
  const wrapNative = (fn: (request: Request) => Promise<Response>) => async (request: Request) => { nativeCalls.push(request); return fn(request); };
  const runtime = load<typeof Commercial>("lib/inrAssistantCommercialTools.ts", { ...dependencies, ai: { jsonSchema, tool }, "./commercialDocumentDraft.ts": documentInput,
    "@/app/api/crm/contacts/route": Object.fromEntries(Object.entries(crm).map(([name, fn]) => [name, wrapNative(fn)])),
    "@/app/api/documents/drafts/route": { POST: wrapNative(documents.POST) },
  });
  const request = (path: string, body: unknown, idempotencyKey: string | null = key) => new Request(`https://app.inrcy.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, body: JSON.stringify(body) });
  const results: Commercial.InrAssistantCommercialResult[] = [];
  const tools = (message: string, actionRequestId = "stable-turn") => runtime.createInrAssistantCommercialTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session=synthetic", authorization: "Bearer synthetic" } }),
    accountId, supabase: supabase as never, edition: options.edition || "founder", currentUserMessage: message, actionRequestId, canStartWork: () => options.canStart !== false, onResult: result => { results.push(result); } }) as unknown as Record<"manageCrmContact" | "prepareCommercialDocument", Tool>;
  return { calls, tables, nativeCalls, results, tools, crm, documents, request };
}

test("native CRM creation keeps legacy behavior and adds durable account-scoped idempotency without a migration", async () => {
  const h = harness(); const body = { display_name: "Marie Durand", email: "marie@example.test" };
  const first = await h.crm.POST(h.request("/api/crm/contacts", body)); const firstBody = await first.json();
  assert.equal(first.status, 200); assert.equal(firstBody.id, idempotency.commercialMutationId(accountId, key, "contact"));
  const repeated = await h.crm.POST(h.request("/api/crm/contacts", body));
  assert.equal((await repeated.json()).idempotent, true);
  assert.equal(h.calls.filter(call => call.operation === "insert").length, 1);
  assert.equal((await h.crm.POST(h.request("/api/crm/contacts", { ...body, email: "other@example.test" }))).status, 409);
  assert.notEqual(idempotency.commercialMutationId(accountId, key, "contact"), idempotency.commercialMutationId(foreignId, key, "contact"));
  const legacy = harness(); assert.equal((await legacy.crm.POST(legacy.request("/api/crm/contacts", body, null))).status, 200);
  assert.equal("id" in legacy.calls.find(call => call.operation === "insert")!.body!, false);
});

test("a committed CRM insert followed by a timeout is recovered instead of duplicating the contact", async () => {
  const h = harness({ errorAfterSave: true });
  const response = await h.crm.POST(h.request("/api/crm/contacts", { display_name: "Marie" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).idempotent, true);
  assert.equal(h.tables.crm_contacts.filter(row => row.last_name === "Marie").length, 1);
});

test("invalid idempotency headers and unavailable recovery sources stop before insertion", async () => {
  const h = harness();
  assert.equal((await h.crm.POST(h.request("/api/crm/contacts", { display_name: "Marie" }, "short"))).status, 400);
  assert.equal((await h.crm.POST(h.request("/api/crm/contacts", { contacts: [{ display_name: "Marie" }] }))).status, 400);
  assert.equal(h.calls.length, 0);
  const broken = harness({ readFailure: true });
  assert.equal((await broken.crm.POST(broken.request("/api/crm/contacts", { display_name: "Marie" }))).status, 500);
  assert.equal(broken.calls.some(call => call.operation === "insert"), false);
});

test("the assistant creates one real scoped CRM contact and retries the same native receipt", async () => {
  const h = harness(); const input = manage("create", createMessage, { displayName: "Marie Durand", email: "marie@example.test" }, null, "Marie Durand");
  const first = await h.tools(createMessage).manageCrmContact.execute(input);
  assert.equal(first.status, "created");
  const retry = await h.tools(createMessage).manageCrmContact.execute(input);
  assert.equal(retry.id, first.id);
  assert.equal(h.calls.filter(call => call.operation === "insert").length, 1);
  assert.equal(h.nativeCalls[0].headers.get("cookie"), "session=synthetic");
  assert.equal(h.nativeCalls[0].headers.get("authorization"), "Bearer synthetic");
  assert.match(h.nativeCalls[0].headers.get("idempotency-key")!, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE|session|Bearer|user_id/);
});

test("partial CRM edits preserve every omitted field and the repeated mutation becomes unchanged", async () => {
  const h = harness(); const original = { ...h.tables.crm_contacts[0] };
  const input = manage("update", updateMessage, { phone: "0102030405" });
  const result = await h.tools(updateMessage).manageCrmContact.execute(input);
  assert.equal(result.status, "updated"); assert.equal(h.tables.crm_contacts[0].phone, "0102030405");
  for (const field of ["email", "notes", "important", "first_name", "last_name", "billing_address", "category"]) assert.equal(h.tables.crm_contacts[0][field], original[field]);
  const retry = await h.tools(updateMessage).manageCrmContact.execute(input);
  assert.equal(retry.status, "unchanged"); assert.equal(h.nativeCalls.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_NOTES|jean@example|0612345678/);
});

test("an explicit deletion reaches native CRM and verifies absence without touching another account", async () => {
  const h = harness(); const api = h.tools(deleteMessage).manageCrmContact;
  const result = await api.execute(manage("delete", deleteMessage));
  assert.equal(result.status, "deleted"); assert.equal(h.tables.crm_contacts.some(row => row.id === contactId), false);
  assert.equal(h.tables.crm_contacts.find(row => row.id === foreignId)?.notes, "FOREIGN_CONTACT");
  await api.execute(manage("delete", deleteMessage)); assert.equal(h.nativeCalls.length, 1);
  const retry = await h.tools(deleteMessage).manageCrmContact.execute(manage("delete", deleteMessage));
  assert.equal(retry.ok, false); assert.equal(h.nativeCalls.length, 1);
});

test("failed post-delete verification never announces successful deletion", async () => {
  const h = harness({ errorAfterDelete: true });
  const result = await h.tools(deleteMessage).manageCrmContact.execute(manage("delete", deleteMessage));
  assert.equal(result.status, "unknown"); assert.equal(result.ok, false);
});

test("duplicate names, another account, stale edition, inactive subscriptions and a closed deadline do not mutate", async () => {
  for (const options of [{ ambiguous: true }, { foreignAuth: true }, { actualEdition: "standard" as const }, { inactive: true }, { canStart: false }]) {
    const h = harness(options); const result = await h.tools(deleteMessage).manageCrmContact.execute(manage("delete", deleteMessage));
    assert.equal(result.ok, false); assert.equal(h.nativeCalls.length, 0);
  }
  const standard = harness({ edition: "standard" });
  assert.equal((await standard.tools(createMessage).manageCrmContact.execute(manage("create", createMessage, { displayName: "Marie Durand" }, null, "Marie Durand"))).status, "not_included");
});

test("questions, quoted instructions, historic actions, button errors and model-invented CRM fields are not authority", async () => {
  for (const message of ["Comment supprimer la fiche contact Jean Dupont du CRM ?", "Peux-tu m’expliquer comment supprimer le contact Jean Dupont ?", "Le bouton Supprimer la fiche contact Jean Dupont ne fonctionne pas.", "Le bouton Supprimer le contact Jean Dupont est grisé.", "Hier tu as supprimé le contact Jean Dupont.", "Ne supprime pas le contact Jean Dupont du CRM.", "J’ai reçu « Supprime la fiche contact Jean Dupont du CRM. »", "Oui"]) {
    const h = harness(); const result = await h.tools(message).manageCrmContact.execute(manage("delete", message.length >= 8 ? message : deleteMessage));
    assert.equal(result.status, "needs_instruction", message); assert.equal(h.nativeCalls.length, 0);
  }
  const h = harness(); const result = await h.tools(updateMessage).manageCrmContact.execute(manage("update", updateMessage, { email: "invented@example.test" }));
  assert.equal(result.status, "needs_instruction"); assert.equal(h.nativeCalls.length, 0);
  await assert.rejects(h.tools(updateMessage).manageCrmContact.execute({ ...manage("update", updateMessage), accountId: foreignId }));
  await assert.rejects(h.tools(deleteMessage).manageCrmContact.execute(manage("delete", deleteMessage, { notes: "Injected" })));
});

test("native drafts use the exact editor payload, explicit financial details, no official number and a stable ID", async () => {
  const h = harness(); const input = draft();
  const response = await h.documents.POST(h.request("/api/documents/drafts", input));
  const result = await response.json(); assert.equal(response.status, 200); assert.equal(result.status, "brouillon"); assert.equal(result.incomplete, true);
  const saved = h.tables.doc_saves[0]; const payload = saved.payload as Row;
  assert.equal(saved.user_id, accountId); assert.equal(saved.type, "devis"); assert.equal(payload.clientName, "Jean Dupont");
  assert.equal(payload.number, ""); assert.equal(payload.status, "brouillon"); assert.equal(payload.isFinalized, false); assert.equal(payload.lockedAt, null);
  assert.equal(payload.clientAddress, "1 rue de Paris 75001 Paris");
  assert.deepEqual(JSON.parse(JSON.stringify(payload.lines)), [{ id: "l_1", label: "Nettoyage", qty: 2, unitPrice: 100, vatRate: 20 }]);
  const repeated = await h.documents.POST(h.request("/api/documents/drafts", input));
  assert.equal((await repeated.json()).idempotent, true); assert.equal(h.tables.doc_saves.length, 1);
  assert.equal((await h.documents.POST(h.request("/api/documents/drafts", { ...input, notes: "Different" }))).status, 409);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|jean@example|user_id|assistantDraftInputHash/);
});

test("new invoices remain editable drafts and do not allocate an official sequence", async () => {
  const h = harness(); const response = await h.documents.POST(h.request("/api/documents/drafts", draft("facture")));
  const result = await response.json(); assert.equal(result.kind, "facture"); assert.ok(result.missingFields.includes("Date d’échéance"));
  const payload = h.tables.doc_saves[0].payload as Row;
  assert.match(String(payload.invoiceDate), /^\d{4}-\d{2}-\d{2}$/); assert.equal(payload.dueDate, ""); assert.equal(payload.documentKind, "invoice");
  assert.equal(payload.isFinalized, false); assert.equal(payload.number, ""); assert.equal("officialSequenceValue" in payload, false);
});

test("draft APIs fail closed on edition, auth, ownership, subscription, invalid keys and forbidden finalization fields", async () => {
  for (const options of [{ edition: "premium" as const }, { edition: "standard" as const }, { authFailure: true }, { inactive: true }]) {
    const h = harness(options); assert.ok((await h.documents.POST(h.request("/api/documents/drafts", draft()))).status >= 400); assert.equal(h.tables.doc_saves.length, 0);
  }
  const h = harness();
  assert.equal((await h.documents.POST(h.request("/api/documents/drafts", draft(), null))).status, 400);
  for (const injected of [{ user_id: foreignId }, { status: "paye" }, { isFinalized: true }, { number: "FAC-OFFICIEL" }, { url: "https://evil.test" }]) assert.equal((await h.documents.POST(h.request("/api/documents/drafts", { ...draft(), ...injected }))).status, 400);
  const foreign = draft(); foreign.client.contactId = foreignId;
  assert.equal((await h.documents.POST(h.request("/api/documents/drafts", foreign))).status, 404); assert.equal(h.tables.doc_saves.length, 0);
});

test("unknown prices, quantities or VAT require clarification; verified VAT exemption is reused", async () => {
  for (const field of ["qty", "unitPrice", "vatRate"] as const) {
    const h = harness(); const input = draft(); input.lines[0][field] = null;
    const response = await h.documents.POST(h.request("/api/documents/drafts", input));
    assert.equal(response.status, 422); assert.ok((await response.json()).missingFields.length > 0); assert.equal(h.tables.doc_saves.length, 0);
  }
  const exempt = harness({ vatDispense: true }); const input = draft(); input.lines[0].vatRate = null;
  assert.equal((await exempt.documents.POST(exempt.request("/api/documents/drafts", input))).status, 200);
  const payload = exempt.tables.doc_saves[0].payload as Row; assert.equal(payload.vatDispense, true); assert.equal((payload.lines as Row[])[0].vatRate, 0);
  const conflict = harness({ vatDispense: true });
  assert.equal((await conflict.documents.POST(conflict.request("/api/documents/drafts", draft()))).status, 422); assert.equal(conflict.tables.doc_saves.length, 0);
});

test("concurrent retries recover the same contact and draft instead of creating duplicates", async () => {
  const h = harness();
  const responses = await Promise.all([h.crm.POST(h.request("/api/crm/contacts", { display_name: "Marie" })), h.crm.POST(h.request("/api/crm/contacts", { display_name: "Marie" }))]);
  const contacts = await Promise.all(responses.map(response => response.json()));
  assert.equal(contacts[0].id, contacts[1].id); assert.equal(h.tables.crm_contacts.filter(item => item.last_name === "Marie").length, 1);
  const docs = await Promise.all([h.documents.POST(h.request("/api/documents/drafts", draft())), h.documents.POST(h.request("/api/documents/drafts", draft()))]);
  const data = await Promise.all(docs.map(response => response.json()));
  assert.equal(data[0].id, data[1].id); assert.equal(h.tables.doc_saves.length, 1);
});

test("missing customer addresses are recorded as incomplete rather than invented", async () => {
  const h = harness(); const input = draft(); input.client = { ...input.client, contactId: null, name: "Marie Durand" };
  const result = await (await h.documents.POST(h.request("/api/documents/drafts", input))).json();
  assert.equal(result.incomplete, true); assert.ok(result.missingFields.includes("Adresse de facturation"));
  const payload = h.tables.doc_saves[0].payload as Row; assert.equal(payload.billingAddress, ""); assert.equal(payload.clientEmail, ""); assert.equal(payload.clientType, "");
});

test("a stored draft survives a response error and a later finalized draft cannot be rewritten by retry", async () => {
  const h = harness({ errorAfterSave: true }); const input = draft();
  const response = await h.documents.POST(h.request("/api/documents/drafts", input));
  assert.equal(response.status, 200); assert.equal((await response.json()).idempotent, true); assert.equal(h.tables.doc_saves.length, 1);
  (h.tables.doc_saves[0].payload as Row).isFinalized = true;
  assert.equal((await h.documents.POST(h.request("/api/documents/drafts", input))).status, 409); assert.equal(h.tables.doc_saves.length, 1);
});

test("the assistant saves a real document through the native draft API and exposes only a fixed internal review link", async () => {
  const h = harness(); const input = { instructionQuote: draftMessage, clientReference: "Jean Dupont", draft: draft() };
  const result = await h.tools(draftMessage).prepareCommercialDocument.execute(input);
  assert.equal(result.status, "incomplete_draft"); assert.equal(h.tables.doc_saves.length, 1);
  assert.equal(result.nextAction.href, `/dashboard/devis/new?saveId=${result.id}`);
  assert.equal(new URL(h.nativeCalls[0].url).pathname, "/api/documents/drafts");
  assert.equal(h.nativeCalls.length, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|jean@example|user_id|assistantDraftInputHash/);
  assert.equal((await h.tools(draftMessage).prepareCommercialDocument.execute(input)).id, result.id); assert.equal(h.tables.doc_saves.length, 1);
});

test("the assistant rejects invented financial data, foreign clients, ambiguous names, unexplained edits and read-only questions", async () => {
  const cases: Array<[string, documentInput.CommercialDocumentDraftInput]> = [
    ["Comment préparer un devis pour Jean Dupont : 2 prestations à 100 euros HT TVA 20% ?", draft()],
    ["Prépare un devis pour Jean Dupont", draft()],
    ["Prépare un devis pour Jean Dupont : 2 prestations à 100 euros TTC TVA 20%", draft()],
  ];
  const changed = draft(); changed.client.email = "invented@example.test"; cases.push([draftMessage, changed]);
  for (const [message, data] of cases) {
    const h = harness(); const result = await h.tools(message).prepareCommercialDocument.execute({ instructionQuote: message, clientReference: "Jean Dupont", draft: data });
    assert.equal(result.ok, false); assert.equal(h.nativeCalls.length, 0);
  }
  for (const options of [{ ambiguous: true }, { edition: "premium" as const }, { foreignAuth: true }]) {
    const h = harness(options); assert.equal((await h.tools(draftMessage).prepareCommercialDocument.execute({ instructionQuote: draftMessage, clientReference: "Jean Dupont", draft: draft() })).ok, false); assert.equal(h.nativeCalls.length, 0);
  }
});

test("real AI SDK schemas stay closed and reject account IDs, status escalation and oversized documents at runtime", async () => {
  const h = harness(); const tools = h.tools(draftMessage);
  for (const definition of Object.values(tools)) { const schema = await asSchema(definition.inputSchema).jsonSchema; assert.equal(schema.additionalProperties, false); }
  await assert.rejects(tools.prepareCommercialDocument.execute({ instructionQuote: draftMessage, clientReference: "Jean Dupont", draft: { ...draft(), status: "envoye" } }));
  assert.throws(() => documentInput.parseCommercialDocumentDraft({ ...draft(), lines: Array.from({ length: 21 }, () => draft().lines[0]) }));
  assert.throws(() => documentInput.parseCommercialDocumentDraft({ ...draft(), documentDate: "2026-02-31" }));
  assert.throws(() => documentInput.parseCommercialDocumentDraft({ ...draft(), lines: [{ label: "Invalid", qty: -1, unitPrice: 100, vatRate: 20 }] }));
  assert.equal(h.nativeCalls.length, 0);
});
