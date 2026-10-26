import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getAiMediaGenerationPublicError } from "../../lib/aiMediaGenerationPublicErrors.ts";
import { isStandardAgentActionDescriptor } from "../../lib/standardAgentPolicy.ts";
import * as editionPolicy from "../../lib/dashboardEdition.ts";
import type * as Diagnostics from "../../lib/inrAssistantDiagnosticsTools.ts";

const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-10-26T12:00:00.000Z");
const at = (hours = 1) => new Date(NOW - hours * 3_600_000).toISOString();
class FixedDate extends Date { constructor(value: string | number = NOW) { super(value); } static now() { return NOW; } }
type Row = Record<string, unknown>;
type Query = { table: string; select: string; filters: Array<[string, string, unknown]>; limit?: number };
type Event = { occurredAt: string; requestId: string; route: string; statusCode: number; errorCode: string };
type TestTool = { execute: (input: unknown) => Promise<Row>; inputSchema: { schema: Row; validate: (input: unknown) => { success: boolean } } };

function fixture(): Record<string, Row[]> {
  return {
    integrations: [
      { user_id: accountA, provider: "facebook", source: "facebook", status: "connected", updated_at: at(4), needs_reconnect: "true", needs_reconnect_at: at(4), meta: { access_token: "PRIVATE_CONNECTION_SECRET", email: "private@example.com" } },
      { user_id: accountA, provider: "linkedin", source: "linkedin", status: "connected", updated_at: at(3), needs_reconnect: "false", needs_reconnect_at: null },
      { user_id: accountB, provider: "tiktok", status: "expired", updated_at: at(1) },
    ],
    publications: [{ id: "post-a", user_id: accountA, created_at: at(2), title: "PRIVATE_PUBLICATION_TITLE" }, { id: "post-b", user_id: accountB, created_at: at(1) }],
    publication_deliveries: [
      { user_id: accountA, publication_id: "post-a", channel: "facebook", status: "failed", error: "OAuth PRIVATE_PROVIDER_ERROR Bearer SECRET_TOKEN https://private.invalid/?token=SECRET_URL private@example.com" },
      { user_id: accountA, publication_id: "post-a", channel: "tiktok", status: "processing" },
      { user_id: accountB, publication_id: "post-b", channel: "x", status: "failed", error: "FOREIGN_ERROR" },
    ],
    ai_media_generation_jobs: [
      { account_id: accountA, actor_auth_user_id: accountA, status: "failed", error_code: "AI_MEDIA_GENERATION_TIMEOUT", error_message: "PRIVATE_MEDIA_ERROR", created_at: at(3), updated_at: at(2), metadata: { token: "PRIVATE_MEDIA_SECRET" }, request_key: `${accountA}_PRIVATE_REQUEST_KEY` },
      { account_id: accountB, status: "failed", error_message: "FOREIGN_MEDIA_ERROR", updated_at: at(1) },
    ],
    pro_media_library: [{ user_id: accountA, upload_status: "failed", processing_status: "failed", processing_error_code: "format_unsupported_PRIVATE", updated_at: at(5), storage_path: "PRIVATE_STORAGE_PATH" }],
    inr_agent_actions: [
      { user_id: accountA, automation_key: "publish", action_type: "publication", target_tool: "booster", status: "failed", last_error: "PRIVATE_AGENT_ERROR", updated_at: at(6) },
      { user_id: accountA, automation_key: "grow", action_type: "campaign", target_tool: "propulser", status: "failed", last_error: "PRIVATE_CAMPAIGN_AGENT", updated_at: at(7) },
      { user_id: accountB, automation_key: "stats", action_type: "stats_report", target_tool: "inrstats", status: "failed", last_error: "FOREIGN_AGENT_ERROR", updated_at: at(1) },
    ],
    inr_agent_scheduled_actions: [{ user_id: accountA, automation_key: "stats", action_type: "stats_report", target_tool: "inrstats", status: "failed", last_error: "network unavailable PRIVATE_SCHEDULE_ERROR", updated_at: at(8) }],
    mail_campaigns: [{ user_id: accountA, status: "partial", last_error: "PRIVATE_MAIL_ERROR", updated_at: at(9), recipients: ["private@example.com"] }],
    ads_campaigns: [
      { user_id: accountA, provider: "meta", status: "failed", last_error: "PRIVATE_ADS_ERROR", updated_at: at(10), draft: { password: "PRIVATE_ADS_SECRET" } },
      { user_id: accountA, provider: "tiktok", status: "failed", last_error: "PILOT_ONLY", updated_at: at(11) },
    ],
  };
}

function harness(options: {
  rows?: Record<string, Row[]>; errors?: string[]; throwing?: string[]; stalled?: string[]; events?: Event[]; journalAvailable?: boolean;
  dna?: Row | null; dnaThrows?: boolean; edition?: "basic" | "standard" | "premium" | "founder";
} = {}) {
  const queries: Query[] = [], journalAccounts: string[] = [], dnaAccounts: string[] = [];
  const tables = options.rows ?? fixture();
  const supabase = { from: (table: string) => {
    const call: Query = { table, select: "", filters: [] }; queries.push(call);
    const builder = {
      select: (selection: string) => { call.select = selection; return builder; },
      eq: (key: string, value: unknown) => { call.filters.push(["eq", key, value]); return builder; },
      gte: (key: string, value: unknown) => { call.filters.push(["gte", key, value]); return builder; },
      in: (key: string, value: unknown) => { call.filters.push(["in", key, value]); return builder; },
      order: () => builder,
      limit: (limit: number) => { call.limit = limit; return builder; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => {
        if (options.stalled?.includes(table)) return new Promise(() => {});
        if (options.throwing?.includes(table)) return Promise.reject(new Error("PRIVATE_DATABASE_STACK")).then(resolve, reject);
        const rows = (tables[table] ?? []).filter((row) => call.filters.every(([kind, key, expected]) => kind === "eq" ? row[key] === expected : kind === "gte" ? String(row[key] ?? "") >= String(expected) : (expected as unknown[]).includes(row[key]))).slice(0, call.limit);
        return Promise.resolve(options.errors?.includes(table) ? { data: null, error: { message: "PRIVATE_DATABASE_ERROR", details: "PRIVATE_SQL" } } : { data: rows, error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
  const stubs: Record<string, unknown> = {
    "./dashboardEdition.ts": editionPolicy,
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (schema: unknown, config: unknown) => ({ schema, ...config as object }) },
    "./standardAgentPolicy.ts": { isStandardAgentActionDescriptor },
    "./adsAccessPolicy.ts": { ADS_PUBLIC_CHANNELS: ["meta", "google", "linkedin", "pinterest", "openai"] },
    "./aiMediaGenerationPublicErrors.ts": { getAiMediaGenerationPublicError },
    "./observability/accountDiagnostics.ts": { readAccountDiagnosticEvents: async (account: string) => {
      journalAccounts.push(account); return { available: options.journalAvailable !== false, events: options.events ?? [], retentionDays: 7 };
    } },
    "./businessDnaManualAnalysisJobs.ts": { getBusinessDnaManualAnalysisJob: async (account: string) => {
      dnaAccounts.push(account); if (options.dnaThrows) throw new Error("PRIVATE_DNA_STACK");
      return options.dna === undefined ? { id: "dna-a", account_id: accountA, actor_auth_user_id: accountA, status: "failed", updated_at: at(12), error_message: "PRIVATE_DNA_ERROR", lock_token: "PRIVATE_LOCK" } : options.dna;
    } },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantDiagnosticsTools.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Date: FixedDate, setTimeout, clearTimeout })((id: string) => {
    if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`); return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof Diagnostics;
  const tool = runtime.createInrAssistantDiagnosticsTools({ accountId: accountA, edition: options.edition ?? "premium", supabase: supabase as never }).getAccountDiagnostics as unknown as TestTool;
  return { tool, queries, journalAccounts, dnaAccounts, runtime };
}

test("every source uses the server account, never another tenant or the model's identity", async () => {
  const h = harness();
  const result = await h.tool.execute({ area: "all", windowHours: 168, limit: 8 });
  assert.equal(result.ok, true); assert.equal(result.complete, true); assert.equal(result.liveVerified, false);
  for (const query of h.queries) assert.ok(query.filters.some(([kind, key, value]) => kind === "eq" && ["user_id", "account_id"].includes(key) && value === accountA), query.table);
  assert.deepEqual(h.journalAccounts, [accountA]); assert.deepEqual(h.dnaAccounts, [accountA]);
  assert.doesNotMatch(JSON.stringify(result), /FOREIGN_|PILOT_ONLY/);
  assert.equal(h.queries.some((query) => /diagnostic_reports|stripe|security_events/.test(query.table)), false);
});

test("secrets, user IDs, provider errors, metadata, document text and private URLs never reach the model", async () => {
  const h = harness();
  const result = await h.tool.execute({ area: "all", windowHours: null, limit: 8 });
  const body = JSON.stringify(result);
  for (const value of ["PRIVATE_", accountA, accountB, "private@example.com", "private.invalid", "SECRET_TOKEN", "SECRET_URL", "Bearer", "lock_token", "actor_auth_user_id"]) assert.equal(body.includes(value), false, value);
  for (const query of h.queries) assert.doesNotMatch(query.select, /\*|access_token|refresh_token|secret|recipient|body_html|storage_path|actor_auth_user_id|request_key/);
  assert.ok(body.length <= 6_000);
  assert.ok((result.items as Row[]).every((item) => /^\/dashboard(?:[/?]|$)/.test(String((item.tool as Row).href))));
});

test("model supplied account/UID, invalid areas, excessive limits and arbitrary time windows fail before reads", async () => {
  for (const input of [
    { area: "all", accountId: accountB }, { area: "media", uid: accountB }, { area: "../../.env" },
    { area: "all", limit: 9 }, { area: "all", limit: 0 }, { area: "all", windowHours: 720 }, { area: "all", limit: 1.5 },
  ]) {
    const h = harness();
    assert.equal(h.tool.inputSchema.validate(input).success, false);
    await assert.rejects(h.tool.execute(input), /invalides/);
    assert.equal(h.queries.length, 0); assert.equal(h.journalAccounts.length, 0); assert.equal(h.dnaAccounts.length, 0);
  }
});

test("connection diagnostics fetch only the two JSON scalar aliases, never the metadata blob", async () => {
  const h = harness();
  const result = await h.tool.execute({ area: "channels", windowHours: 24, limit: 8 });
  const query = h.queries.find((query) => query.table === "integrations")!;
  assert.equal(query.select.split(",").includes("meta"), false);
  assert.match(query.select, /needs_reconnect:meta->>needs_reconnect/);
  assert.match(query.select, /needs_reconnect_at:meta->>needs_reconnect_at/);
  const items = result.items as Row[];
  assert.equal(items.length, 1); assert.equal(items[0].channel, "Facebook");
  assert.doesNotMatch(query.select, /token|display_name|resource_label|email_address/);
});

test("database and journal outages are unknown, never a healthy or invented empty account", async () => {
  const tables = Object.keys(fixture());
  const h = harness({ errors: tables, journalAvailable: false, dnaThrows: true });
  const result = await h.tool.execute({ area: "all", windowHours: 24, limit: 8 });
  assert.equal(result.ok, false); assert.equal(result.complete, false); assert.equal((result.items as Row[]).length, 0);
  assert.match(String(result.message), /indisponibles.*absence de résultat.*pas absence de problème/);
  assert.ok((result.sources as Row[]).every((source) => source.status === "unavailable"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|SQL|STACK/);
});

test("a missing DNA job stays unknown because its existing helper also hides an unavailable table", async () => {
  const h = harness({ dna: null, journalAvailable: false });
  const result = await h.tool.execute({ area: "dna", windowHours: 168, limit: 8 });
  assert.equal(result.ok, false); assert.equal(result.complete, false);
  assert.equal((result.sources as Row[]).find((source) => source.id === "dna_analysis")?.status, "unavailable");
});

test("a DNA helper result must confirm the same account and cannot misattribute another tenant's job", async () => {
  const h = harness({ dna: { id: "foreign", account_id: accountB, status: "failed", updated_at: at(1) }, journalAvailable: false });
  const result = await h.tool.execute({ area: "dna", windowHours: 168, limit: 8 });
  assert.equal(result.ok, false); assert.equal((result.items as Row[]).length, 0);
  assert.equal((result.sources as Row[]).find((source) => source.id === "dna_analysis")?.status, "unavailable");
});

test("an empty available read reports no recorded signal without claiming everything works", async () => {
  const h = harness({ rows: {} });
  const result = await h.tool.execute({ area: "media", windowHours: 24, limit: 8 });
  assert.equal(result.ok, true); assert.equal((result.items as Row[]).length, 0);
  assert.match(String(result.message), /ne prouve pas que tout fonctionne/);
});

test("an available but empty journal cannot hide the outage of the requested business sources", async () => {
  const h = harness({ errors: ["ai_media_generation_jobs", "pro_media_library"] });
  const result = await h.tool.execute({ area: "media", windowHours: 24, limit: 8 });
  assert.equal(result.ok, false); assert.equal(result.complete, false);
  assert.equal((result.items as Row[]).length, 0);
  assert.match(String(result.message), /Diagnostic incomplet/);
});

test("server events are time bounded, area filtered, publicly classified and correlated by safe request UUID", async () => {
  const events: Event[] = [
    { occurredAt: at(1), requestId, route: "/api/media-generation/generate", statusCode: 504, errorCode: "fetch_timeout" },
    { occurredAt: at(30), requestId, route: "/api/media-generation/generate", statusCode: 500, errorCode: "ai_gateway_unavailable" },
    { occurredAt: at(2), requestId, route: "/api/crm/campaigns", statusCode: 403, errorCode: "PRIVATE_EVENT_ERROR" },
    { occurredAt: at(-2), requestId, route: "/api/media-generation/generate", statusCode: 500, errorCode: "future" },
    { occurredAt: at(2), requestId: accountA, route: `/api/media-generation/${accountA}`, statusCode: 500, errorCode: "PRIVATE_CODE" },
    { occurredAt: at(3), requestId: "Bearer PRIVATE_TOKEN", route: "/api/media-generation/generate?token=PRIVATE_QUERY", statusCode: 500, errorCode: "PRIVATE_CODE" },
  ];
  const h = harness({ rows: {}, events });
  const result = await h.tool.execute({ area: "media", windowHours: 24, limit: 8 });
  const items = result.items as Row[];
  assert.equal(items.length, 3);
  assert.ok(items.every((item) => item.area === "media"));
  assert.ok(items.some((item) => item.requestId === requestId && item.category === "timeout" && item.route === "/api/media-generation/generate"));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|Bearer|token=|11111111/);
  assert.equal((result.sources as Row[]).find((source) => source.id === "server_events")?.status, "available");
});

test("24 hour and seven day windows apply to stored records as well as journal events", async () => {
  const rows = { ai_media_generation_jobs: [
    { account_id: accountA, status: "failed", error_code: "AI_MEDIA_GENERATION_TIMEOUT", updated_at: at(30) },
    { account_id: accountA, status: "failed", error_code: "AI_MEDIA_QUOTA_REACHED", updated_at: at(200) },
  ] };
  for (const [windowHours, expected] of [[24, 0], [168, 1]] as const) {
    const h = harness({ rows }); const result = await h.tool.execute({ area: "media", windowHours, limit: 8 });
    assert.equal((result.items as Row[]).length, expected);
    assert.ok(h.queries.every((query) => query.filters.some(([kind, key, value]) => kind === "gte" && key === "updated_at" && value === at(windowHours))));
  }
});

test("Standard cannot inspect Premium campaigns or campaign-agent descriptors", async () => {
  const h = harness({ edition: "standard" });
  const result = await h.tool.execute({ area: "all", windowHours: 168, limit: 8 });
  assert.equal(h.queries.some((query) => /^(?:mail|ads)_campaigns$/.test(query.table)), false);
  assert.equal((result.sources as Row[]).find((source) => source.id === "campaigns")?.status, "restricted");
  assert.ok((result.items as Row[]).filter((item) => item.area === "agents").every((item) => (item.tool as Row).href !== "/dashboard/agent/campagnes-mails"));
});

test("Basique diagnostics excludes agent tables and old agent events, keeping only active-account manual support", async () => {
  const events = ["/api/agent/publications", "/api/agent/actions/execute", "/api/ads/campaigns"].map(route => ({ occurredAt: at(1), requestId, route, statusCode: 500, errorCode: "http_500" }));
  for (const area of ["all", "agents"] as const) {
    const h = harness({ edition: "basic", events });
    const result = await h.tool.execute({ area, windowHours: 168, limit: 8 });
    assert.equal(h.queries.some(query => /^(?:inr_agent_|mail_campaigns|ads_campaigns)/.test(query.table)), false);
    assert.equal((result.sources as Row[]).find(source => source.id === "agents")?.status, "restricted");
    assert.equal((result.items as Row[]).some(item => item.area === "agents" || item.requestId === requestId), false);
    assert.deepEqual(h.journalAccounts, [accountA]);
  }
});

test("Standard also excludes old Premium campaign events from the per-account server journal", async () => {
  const events = ["/api/ads/campaigns", "/api/crm/campaigns", "/api/propulser/send", "/api/agent/actions/prepare-campaign"].map((route) => ({ occurredAt: at(1), requestId, route, statusCode: 500, errorCode: "http_500" }));
  for (const area of ["all", "campaigns", "agents"] as const) {
    const h = harness({ edition: "standard", rows: {}, events });
    const result = await h.tool.execute({ area, windowHours: 168, limit: 8 });
    assert.equal((result.items as Row[]).some((item) => item.requestId === requestId), false);
    assert.equal((result.sources as Row[]).find((source) => source.id === "server_events")?.found, 0);
  }
});

test("Premium Ads diagnoses only current public channels, not pilot-only providers", async () => {
  const h = harness(); await h.tool.execute({ area: "campaigns", windowHours: 168, limit: 8 });
  const query = h.queries.find((query) => query.table === "ads_campaigns")!;
  assert.ok(query.filters.some(([kind, key, value]) => kind === "in" && key === "provider" && Array.isArray(value) && !value.includes("tiktok") && !value.includes("x")));
});

test("media failures use existing public explanations while in-progress records never imply blockage or refund", async () => {
  const h = harness({ rows: { ai_media_generation_jobs: [
    { account_id: accountA, status: "failed", error_code: "AI_MEDIA_GENERATION_TIMEOUT", error_message: "PRIVATE_SECRET", updated_at: at(1) },
    { account_id: accountA, status: "processing", updated_at: at(2) },
  ] } });
  const result = await h.tool.execute({ area: "media", windowHours: 24, limit: 8 });
  const failure = (result.items as Row[]).find((item) => item.status === "failed")!;
  assert.equal(failure.errorCode, "AI_MEDIA_GENERATION_TIMEOUT"); assert.match(String(failure.message), /délai/);
  const pending = (result.items as Row[]).find((item) => item.status === "pending")!;
  assert.match(String(pending.message), /ne prouve pas qu’elle est bloquée/);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|remboursé|crédits restitués/);
});

test("scan and result sizes remain bounded even with oversized source arrays and messages", async () => {
  const events = Array.from({ length: 500 }, (_, index) => ({ occurredAt: new Date(NOW - index * 1_000).toISOString(), requestId, route: "/api/media-generation/generate", statusCode: 500, errorCode: "PRIVATE_".repeat(1_000) }));
  const h = harness({ events });
  const result = await h.tool.execute({ area: "all", windowHours: 168, limit: 8 });
  assert.ok((result.items as Row[]).length <= 8); assert.ok(JSON.stringify(result).length <= 6_000);
  assert.equal(result.truncated, true);
  for (const query of h.queries) assert.ok(query.limit != null && query.limit <= 128);
  assert.ok((result.sources as Row[]).some((source) => source.sampled === true));
});

test("partial outages retain reliable signals while explicitly marking the missing source", async () => {
  const h = harness({ errors: ["publication_deliveries"], throwing: ["pro_media_library"] });
  const result = await h.tool.execute({ area: "all", windowHours: 168, limit: 8 });
  assert.equal(result.ok, true); assert.equal(result.complete, false);
  assert.ok((result.sources as Row[]).some((source) => source.id === "publications" && source.status === "unavailable"));
  assert.ok((result.sources as Row[]).some((source) => source.id === "media_processing" && source.status === "unavailable"));
  assert.ok((result.items as Row[]).some((item) => item.area === "media"));
});

test("a stalled source becomes unknown within a bounded time instead of suspending diagnostics", { timeout: 12_000 }, async () => {
  const h = harness({ rows: {}, stalled: ["ai_media_generation_jobs"] });
  const result = await h.tool.execute({ area: "media", windowHours: 24, limit: 8 });
  assert.equal(result.ok, false); assert.equal(result.complete, false);
  assert.equal((result.sources as Row[]).find((source) => source.id === "media_generations")?.status, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /Diagnostic source unavailable/);
});
