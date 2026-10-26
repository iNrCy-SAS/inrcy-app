import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, jsonSchema, tool } from "ai";
import { currentSubscriptionOffer } from "../../lib/subscriptionOffers.ts";
import { VISIBILITY_INDEX_MODEL } from "../../lib/inrstats/visibilityIndexModel.ts";
import type * as Workspace from "../../lib/inrAssistantWorkspaceTools.ts";

type Row = Record<string, unknown>;
type Query = { table: string; fields: string; head: boolean; filters: Array<[string, string, unknown]>; limit?: number; order?: [string, boolean] };
const a = "account-a", b = "account-b";
const sections = ["stats", "subscription", "agents", "crm", "calendar", "reputation", "campaigns", "mail"] as const;
const now = Date.now();
const recent = new Date(now - 3_600_000).toISOString();
const next = new Date(now + 3_600_000).toISOString();

function harness(options: { edition?: "standard" | "premium" | "founder"; overrides?: Record<string, Row[]>; errors?: string[]; scope?: string; blockedTables?: string[];
  clock?: { schedule: (callback: () => void, delay: number) => unknown; cancel: (timer: unknown) => void } } = {}) {
  const queries: Query[] = [];
  const tables: Record<string, Row[]> = {
    subscriptions: [{ user_id: a, status: "trialing", billing_provider: "stripe", trial_end_at: next, stripe_customer_id: "PRIVATE_STRIPE", contract_price: 987654, email: "private@example.test" }],
    crm_contacts: [{ id: 1, user_id: a, contact_type: "client", email: "private@example.test", last_name: "PRIVATE CLIENT" }, { id: 2, user_id: a, contact_type: "prospect" }, { id: 3, user_id: b, contact_type: "prospect" }],
    agenda_events: [{ user_id: a, start_at: next, end_at: new Date(now + 7_200_000).toISOString(), all_day: false, status: "confirmed", source: "manual", title: "PRIVATE CLIENT", location: "PRIVATE ADDRESS", meta: { token: "PRIVATE TOKEN" } }],
    inr_agent_automation_settings: ["publish", "stats", "grow", "loyalty"].map(automation_key => ({ user_id: a, automation_key, enabled: true, frequency: "weekly", validation_mode: "validation_required", next_run_at: next, metadata: { access_token: "PRIVATE TOKEN" }, recipients: ["private@example.test"] })),
    inr_agent_settings: [{ user_id: a, global_enabled: false, metadata: { private: "PRIVATE TOKEN" } }],
    mail_campaigns: [{ user_id: a, status: "completed", track_kind: "propulser", total_count: 10, sent_count: 9, created_at: recent, finished_at: recent, subject: "PRIVATE SUBJECT", body_text: "PRIVATE BODY", recipient_name: "PRIVATE CLIENT" }],
    integrations: [{ id: 1, user_id: a, category: "mail", status: "connected", account_email: "private@example.test", access_token_enc: "PRIVATE TOKEN" }, { user_id: a, source: "gmb", product: "gmb", status: "connected", settings: { secret: "PRIVATE TOKEN" }, resource_label: "PRIVATE LOCATION" }],
    send_items: [{ id: 1, user_id: a, type: "mail", status: "sent", created_at: recent, body_text: "PRIVATE BODY", to_emails: "private@example.test" }, { id: 2, user_id: a, type: "mail", status: "sent", created_at: new Date(now - 40 * 86_400_000).toISOString() }, { id: 3, user_id: a, type: "facture", status: "sent", created_at: recent }],
    inrbadge_events: [{ id: 1, user_id: a, event_type: "view", created_at: recent, visitor_ip: "PRIVATE IP" }, { id: 2, user_id: b, event_type: "view", created_at: recent }],
    app_events: [{ id: 1, user_id: a, module: "inr_search", type: "page_view", created_at: recent, payload: { private: "PRIVATE TOKEN" } }],
    inrstats_visibility_snapshots: [{ user_id: a, channel_key: "all", model_version: VISIBILITY_INDEX_MODEL.version, observed_on: recent.slice(0, 10), score: 325.5, inputs: { private: "PRIVATE TOKEN" } }],
    ...options.overrides,
  };
  const supabase = { from(table: string) {
    const query: Query = { table, fields: "", head: false, filters: [] }; queries.push(query);
    const result = (single = false) => {
      if (options.errors?.includes(table)) return { data: null, count: null, error: { message: "PRIVATE DATABASE ERROR", stack: "PRIVATE STACK" } };
      let matches = (tables[table] || []).filter(row => query.filters.every(([kind, key, value]) => kind === "eq" ? row[key] === value : kind === "in" ? (value as unknown[]).includes(row[key]) : kind === "gte" ? String(row[key]) >= String(value) : String(row[key]) < String(value)));
      if (query.order) { const [key, ascending] = query.order; matches = [...matches].sort((left, right) => String(left[key]).localeCompare(String(right[key])) * (ascending ? 1 : -1)); }
      const count = matches.length;
      if (query.limit !== undefined) matches = matches.slice(0, query.limit);
      // Deliberately return all columns: the tool must project safe outputs itself.
      return { data: query.head ? null : single ? matches[0] ?? null : matches, count: query.head ? count : null, error: null };
    };
    const operation = (single = false) => options.blockedTables?.includes(table) ? new Promise<never>(() => {}) : Promise.resolve(result(single));
    const builder = {
      select(fields: string, opts?: { head?: boolean }) { query.fields = fields; query.head = Boolean(opts?.head); return builder; },
      eq(key: string, value: unknown) { query.filters.push(["eq", key, value]); return builder; },
      in(key: string, value: unknown[]) { query.filters.push(["in", key, value]); return builder; },
      gte(key: string, value: unknown) { query.filters.push(["gte", key, value]); return builder; },
      lt(key: string, value: unknown) { query.filters.push(["lt", key, value]); return builder; },
      order(key: string, opts: { ascending: boolean }) { query.order = [key, opts.ascending]; return builder; },
      limit(value: number) { query.limit = value; return builder; },
      maybeSingle: () => operation(true),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => operation().then(resolve, reject),
      insert() { assert.fail("Read-only tool attempted an insert"); }, update() { assert.fail("Read-only tool attempted an update"); }, delete() { assert.fail("Read-only tool attempted a delete"); },
    };
    return builder;
  } };
  const dependencies: Record<string, unknown> = { "server-only": {}, ai: { jsonSchema, tool }, "./subscriptionOffers.ts": { currentSubscriptionOffer }, "./inrstats/visibilityIndexModel.ts": { VISIBILITY_INDEX_MODEL } };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantWorkspaceTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date, setTimeout: options.clock?.schedule ?? setTimeout, clearTimeout: options.clock?.cancel ?? clearTimeout,
    fetch: () => assert.fail("No provider or arbitrary URL may be called") })((name: string) => { assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]; }, mod, mod.exports);
  const runtime = mod.exports as typeof Workspace;
  const definition = runtime.createInrAssistantWorkspaceTools({ accountId: options.scope ?? a, edition: options.edition ?? "premium", supabase: supabase as never, request: new Request("https://app.inrcy.com/api/assistant/chat", { headers: { cookie: "SECRET SESSION" } }) }).readWorkspaceSection;
  const execute = async (section: string): Promise<Row> => await definition.execute!({ section } as never, { toolCallId: "test", messages: [] }) as unknown as Row;
  return { execute, definition, queries };
}

test("all workspace reads stay scoped and return no identities, content, contracts or secrets", async () => {
  const h = harness();
  for (const section of sections) {
    const response = await h.execute(section);
    assert.equal(response.readOnly, true);
    assert.equal(response.known, true, section);
    const output = JSON.stringify(response);
    assert.ok(output.length <= 6000, section);
    assert.doesNotMatch(output, /PRIVATE|private@|987654|SECRET SESSION|visitor_ip|body_text|access_token|stripe_customer_id/);
  }
  for (const query of h.queries) {
    assert.ok(query.filters.some(([kind, key, value]) => kind === "eq" && key === "user_id" && value === a), query.table);
    assert.notEqual(query.fields, "*");
    assert.doesNotMatch(query.fields, /email|phone|last_name|first_name|subject|body_|payload|settings|metadata|inputs|token|stripe_/);
  }
});

test("edition gates prevent private reads without forcing subscription changes or skipping public guidance", async () => {
  const h = harness({ edition: "standard" });
  for (const section of ["crm", "calendar", "campaigns", "mail"]) {
    const result = await h.execute(section);
    assert.equal(result.access, "not_included");
    assert.equal(h.queries.length, 0);
    assert.equal((result.nextAction as Row).href, "/dashboard?help=1");
  }
  const agents = await h.execute("agents");
  assert.equal((agents.data as Row).globalEnabled, false, "Individually enabled agents must not imply global automation is running");
  assert.deepEqual(JSON.parse(JSON.stringify(((agents.data as Row).items as Row[]).map(row => row.automation))), ["publish", "stats"]);
  for (const section of ["stats", "subscription", "reputation"]) assert.equal((await h.execute(section)).access, "allowed");
});

test("precise aggregates ignore foreign accounts, old messages and non-mail billing documents", async () => {
  const h = harness();
  const crm = (await h.execute("crm")).data as Row;
  assert.equal(crm.total, 2);
  assert.equal((crm.byType as Row).prospect, 1);
  const mail = (await h.execute("mail")).data as Row;
  assert.equal((mail.recentMessages as Row).sent, 1);
  const stats = (await h.execute("stats")).data as Row;
  assert.equal(((stats.measuredInternalEvents as Row).inrbadge as Row).views, 1);
  assert.equal(((stats.measuredInternalEvents as Row).inrbadge as Row).clicks, 0, "An exact successful count may truthfully be zero");
  assert.equal((stats.visibilityIndex as Row[])[0].score, 325.5, "The product visibility index is not a percentage capped at 100");
});

test("database errors are unknown rather than false zero or leaked provider diagnostics", async () => {
  const h = harness({ errors: ["crm_contacts", "inrbadge_events", "agenda_events", "integrations"] });
  const crm = await h.execute("crm");
  assert.equal(crm.known, false);
  assert.equal((crm.data as Row).total, null);
  const stats = await h.execute("stats");
  assert.equal(stats.known, false);
  assert.equal((((stats.data as Row).measuredInternalEvents as Row).inrbadge as Row).views, null);
  const reputation = await h.execute("reputation");
  assert.equal((reputation.data as Row).reviewCount, null);
  const calendar = await h.execute("calendar");
  assert.equal(calendar.known, false);
  assert.deepEqual(JSON.parse(JSON.stringify((calendar.data as Row).items)), []);
  assert.doesNotMatch(JSON.stringify([crm, stats, reputation, calendar]), /PRIVATE|STACK|DATABASE ERROR/);
});

test("a blocked source becomes unknown after a bounded timeout without retry, timer leak or fabricated zero", async () => {
  const callbacks = new Map<unknown, () => void>();
  const delays: number[] = [];
  const cleared: unknown[] = [];
  let unrefCount = 0;
  const clock = {
    schedule(callback: () => void, delay: number) {
      const timer = { unref() { unrefCount++; } };
      delays.push(delay); callbacks.set(timer, callback); return timer;
    },
    cancel(timer: unknown) { cleared.push(timer); callbacks.delete(timer); },
  };
  const h = harness({ blockedTables: ["subscriptions"], clock });
  const pending = h.execute("subscription");
  assert.deepEqual(delays, [5_000]);
  assert.equal(unrefCount, 1);
  assert.equal(callbacks.size, 1);
  callbacks.values().next().value!(); // Advance only the injected clock; no real sleep or network request.
  const response = await pending;
  assert.equal(response.known, false);
  assert.equal((response.data as Row).status, null);
  assert.equal(h.queries.length, 1, "A timed out read must not retry");
  assert.equal(cleared.length, 1);
  assert.equal(callbacks.size, 0);
  assert.doesNotMatch(JSON.stringify(response), /Workspace source unavailable|Error|stack/i);

  const healthy = harness({ clock });
  assert.equal((await healthy.execute("subscription")).known, true);
  assert.equal(cleared.length, 2, "Successful reads also clear their deadline");
  assert.equal(callbacks.size, 0);
});

test("subscription reads remain useful after expiry and separate public catalogue from personal contracts", async () => {
  const h = harness({ overrides: { subscriptions: [{ user_id: a, status: "expired", billing_provider: "app_store", current_price: 987654, stripe_subscription_id: "PRIVATE CONTRACT", contract: "PRIVATE CONTRACT" }] } });
  const response = await h.execute("subscription");
  assert.equal(response.known, true);
  const data = response.data as Row;
  assert.equal(data.status, "expired");
  assert.equal(data.billingProvider, "app_store");
  assert.equal((data.publicCatalogue as Row[])[0].source, "public_catalogue_not_personal_contract");
  assert.doesNotMatch(JSON.stringify(response), /987654|PRIVATE CONTRACT/);
  const secondary = await harness({ scope: b }).execute("subscription");
  assert.equal(secondary.known, false, "No active-establishment subscription row cannot imply owner is unsubscribed");
  assert.equal((secondary.data as Row).status, null);
});

test("lists are bounded and arbitrary values inside allowed columns cannot smuggle private strings", async () => {
  const h = harness({ overrides: {
    agenda_events: Array.from({ length: 20 }, (_, index) => ({ user_id: a, start_at: new Date(now + (index + 1) * 3_600_000).toISOString(), end_at: new Date(now + (index + 2) * 3_600_000).toISOString(), status: "PRIVATE CLIENT", source: "PRIVATE TOKEN", all_day: "PRIVATE EMAIL" })),
    mail_campaigns: Array.from({ length: 20 }, () => ({ user_id: a, created_at: recent, status: "PRIVATE TOKEN", track_kind: "PRIVATE SUBJECT", sent_count: "PRIVATE PHONE", total_count: -1 })),
  } });
  for (const section of ["calendar", "campaigns"]) {
    const response = await h.execute(section);
    const data = response.data as Row;
    assert.equal((data.items as Row[]).length, 8);
    assert.equal(data.moreItemsMayExist, true);
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE/);
    assert.ok(JSON.stringify(response).length <= 6000);
  }
});

test("the model cannot choose an account, provider, URL, query or unregistered section", async () => {
  const h = harness();
  const schema = asSchema(h.definition.inputSchema);
  for (const input of [null, [], { section: "crm", accountId: b }, { section: "mail", url: "/api/agent/actions/send-stats-report" }, { section: "stats", userId: b }, { section: "stats", model: "other" }, { section: "../../.env" }]) {
    assert.equal((await schema.validate?.(input))?.success, false);
    await assert.rejects(() => h.definition.execute!(input as never, { toolCallId: "test", messages: [] }) as Promise<unknown>, /invalide/);
  }
  assert.equal(h.queries.length, 0);
});
