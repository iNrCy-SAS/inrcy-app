import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import ts from "typescript";
import * as dashboardSync from "../../lib/dashboardChannelSync.ts";

// The offline route fixtures intentionally model heterogeneous provider JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const object = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
function load(name: string, dependencies: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): Value {
  const file = name.startsWith("app/") ? name : `lib/${name}.ts`;
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output = { exports: {} as Value };
  new Function("module", "exports", "require", ...Object.keys(globals), code)(output, output.exports, (id: string) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id === "server-only") return {};
    if (id === "@/lib/observability/logger") return { log: { warn() {}, info() {} } };
    if (id.startsWith("@/lib/")) return load(id.slice(6), dependencies, globals);
    throw new Error(`Unexpected dependency ${id}`);
  }, ...Object.values(globals));
  return output.exports;
}

const store = load("googleBusinessVerificationStore");
const consent = load("connectionVersions");
const NOW = Date.parse("2026-11-15T20:00:00Z");
const LOCATION = "locations/chosen", ACCOUNT = "accounts/parent";
const original = (): Value => ({ id: "integration", user_id: "active-company", provider: "google", source: "gmb", product: "gmb", status: "connected", resource_id: LOCATION, resource_label: "Fixture", email_address: "fixture@example.test", access_token_enc: "DUMMY_ACCESS", refresh_token_enc: "DUMMY_REFRESH", expires_at: "2099-01-01T00:00:00Z", meta: { account: ACCOUNT, connection_version: 1, connection_version_updated_at: "oauth-revision", retained: true } });

function database(options: { beforeWrite?: (state: Value, table: string) => void; fail?: boolean; throws?: boolean; row?: Value } = {}) {
  const state = { row: options.row ? structuredClone(options.row) : original(), mirror: { user_id: "active-company", settings: { retained: true, gmb: { accountName: ACCOUNT, locationName: LOCATION } } }, writes: [] as Value[] };
  const db = { from(table: string) {
    let patch: Value = null, single = false;
    const filters: Array<[string, unknown]> = [];
    const q: Value = {
      select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      update: (value: unknown) => { patch = value; return q; },
      maybeSingle: () => { assert.equal(patch, null, "a guarded PATCH must accept zero returned rows"); single = true; return q; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          if (patch) {
            options.beforeWrite?.(state, table);
            if (options.throws) throw new Error("database unavailable");
          }
          const row = table === "integrations" ? state.row : state.mirror;
          const matched = Boolean(row && filters.every(([key, expected]) => {
            const actual = row[key] ?? null;
            if (typeof expected === "string" && actual && typeof actual === "object") {
              try { return isDeepStrictEqual(actual, JSON.parse(expected)); } catch { return false; }
            }
            return actual === expected;
          }));
          if (patch) {
            state.writes.push({ table, patch: structuredClone(patch), filters: structuredClone(filters), matched });
            if (matched && !options.fail) Object.assign(row, structuredClone(patch));
          }
          if (options.fail) return { data: null, error: { message: "database unavailable" } };
          const selected = matched ? structuredClone(row) : null;
          return { data: single ? selected : selected ? [selected] : [], error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
  const persist = (status = "pending", selectionValidated = true, snapshot = structuredClone(state.row)) => store.persistGmbVerification({ db, userId: "active-company", row: snapshot, locationName: LOCATION, accountName: ACCOUNT, status, selectionValidated, nowMs: NOW });
  return { db, state, persist };
}

test("business verification persists only metadata, bound to the exact tuple and OAuth revision for five hours", async () => {
  const h = database(); const before = structuredClone(h.state.row);
  assert.deepEqual(await h.persist(), { status: "pending", persisted: true, clearedStatsReconnect: false });
  assert.deepEqual(Object.keys(h.state.writes[0].patch), ["meta"]);
  assert.deepEqual({ ...h.state.row, meta: before.meta }, before, "credentials, status and selection remain untouched");
  const meta = h.state.row.meta;
  assert.equal(store.readStoredGmbVerificationStatus(meta, LOCATION, ACCOUNT, NOW + 299 * 60_000), "pending");
  assert.equal(store.readStoredGmbVerificationStatus(meta, LOCATION, ACCOUNT, NOW + 300 * 60_000), "unknown");
  assert.equal(store.readStoredGmbVerificationStatus(meta, "locations/other", ACCOUNT, NOW), "unknown");
  assert.equal(store.readStoredGmbVerificationStatus(meta, LOCATION, "accounts/other", NOW), "unknown");
  assert.equal(store.readStoredGmbVerificationStatus({ ...meta, connection_version_updated_at: "new-oauth" }, LOCATION, ACCOUNT, NOW), "unknown");
  assert.equal(store.readStoredGmbVerificationStatus({ ...meta, gmb_verification: { ...meta.gmb_verification, checked_at: "invalid" } }, LOCATION, ACCOUNT, NOW), "unknown");
});

test("an unknown response preserves fresh evidence without refreshing its timestamp or clearing reconnect", async () => {
  for (const status of ["pending", "required", "restricted", "verified"]) {
    const checkedAt = new Date(NOW - 299 * 60_000).toISOString();
    const row = original();
    row.meta.gmb_verification = { status, locationName: LOCATION, accountName: ACCOUNT, checked_at: checkedAt, authorization_revision: "oauth-revision" };
    row.meta.needs_reconnect = true;
    row.meta.needs_reconnect_reason = "provider_authentication_failed";
    row.meta.needs_reconnect_stage = "stats_provider_metrics";
    const h = database({ row }); const before = structuredClone(h.state.row.meta);
    assert.deepEqual(await h.persist("unknown"), { status, persisted: true, clearedStatsReconnect: false });
    assert.deepEqual(h.state.row.meta, before, "an unknown provider response neither renews proof nor clears an authentication marker");
    assert.equal(h.state.writes.length, 1, "even a cached fallback confirms the complete snapshot through compare-and-swap");
    assert.equal(store.readStoredGmbVerificationStatus(h.state.row.meta, LOCATION, ACCOUNT, NOW + 60_000), "unknown");
  }
});

test("unknown cannot revive expired, other-target or other-authorization evidence", async () => {
  const fresh = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(NOW - 60_000).toISOString(), authorization_revision: "oauth-revision" };
  for (const patch of [{ checked_at: new Date(NOW - 300 * 60_000).toISOString() }, { locationName: "locations/other" }, { accountName: "accounts/other" }, { authorization_revision: "old-oauth" }]) {
    const row = original(); row.meta.gmb_verification = { ...fresh, ...patch };
    const h = database({ row }); const before = structuredClone(row.meta);
    assert.deepEqual(await h.persist("unknown"), { status: "unknown", persisted: true, clearedStatsReconnect: false });
    assert.deepEqual(h.state.row.meta, before, "a failed recheck never extends evidence lifetime");
  }
});

test("a cached fallback loses safely when credentials, target or metadata changes during confirmation", async () => {
  for (const field of ["access_token_enc", "resource_id", "meta"] as const) {
    const row = original(); row.meta.gmb_verification = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(NOW - 60_000).toISOString(), authorization_revision: "oauth-revision" };
    const h = database({ row, beforeWrite: state => { state.row[field] = field === "meta" ? { account: ACCOUNT, connection_version_updated_at: "new-oauth" } : "changed"; } });
    assert.deepEqual(await h.persist("unknown"), { status: "unknown", persisted: false, clearedStatsReconnect: false });
    if (field === "meta") assert.equal(h.state.row.meta.connection_version_updated_at, "new-oauth");
    else assert.equal(h.state.row[field], "changed");
  }
});

test("only a confirmed exact selection can clear the historical Stats permission marker", async () => {
  const marked = { ...original(), meta: { ...original().meta, needs_reconnect: true, needs_reconnect_reason: "provider_authentication_failed", needs_reconnect_stage: "stats_provider_metrics", needs_reconnect_channel: "gmb", needs_reconnect_at: "old", token_invalid: true } };
  const h = database({ row: marked });
  assert.deepEqual(await h.persist("pending"), { status: "pending", persisted: true, clearedStatsReconnect: true });
  assert.equal(h.state.row.meta.needs_reconnect, undefined);
  assert.equal(h.state.row.meta.token_invalid, true, "an independent real token marker is never cleared");
  for (const [status, confirmed] of [["unknown", true], ["pending", false]] as const) {
    const other = database({ row: marked }); await other.persist(status, confirmed);
    assert.equal(other.state.row.meta.needs_reconnect, true);
  }
  for (const patch of [{ needs_reconnect_reason: "google_refresh_token_invalid" }, { needs_reconnect_stage: "publish" }]) {
    const other = database({ row: { ...marked, meta: { ...marked.meta, ...patch } } }); await other.persist("verified");
    assert.equal(other.state.row.meta.needs_reconnect, true);
  }
});

for (const field of ["status", "email_address", "access_token_enc", "refresh_token_enc", "expires_at", "resource_id", "resource_label", "meta"] as const) {
  test(`a concurrent ${field} change blocks business-verification persistence and UI projection`, async () => {
    const h = database({ beforeWrite: state => { state.row[field] = field === "meta" ? { account: ACCOUNT, connection_version_updated_at: "new-oauth" } : "changed"; } });
    assert.deepEqual(await h.persist(), { status: "unknown", persisted: false, clearedStatsReconnect: false });
    assert.equal(h.state.row.meta.gmb_verification, undefined);
  });
}

test("failed storage is best effort and a disconnected or wrong-account snapshot cannot be enriched", async () => {
  for (const option of [{ fail: true }, { throws: true }, { row: { ...original(), status: "disconnected" } }, { row: { ...original(), user_id: "other-company" } }]) {
    const h = database(option);
    assert.deepEqual(await h.persist(), { status: "unknown", persisted: false, clearedStatsReconnect: false });
    assert.equal(h.state.row.meta.gmb_verification, undefined);
  }
});

function locationsRuntime(options: { metadataVoice?: boolean; voice?: unknown; voiceStatus?: number; partial?: boolean; beforeWrite?: (state: Value) => void; marker?: Value } = {}) {
  const h = database({ beforeWrite: options.beforeWrite, row: { ...original(), meta: { ...original().meta, ...options.marker } } });
  const requests: URL[] = [];
  let caches = 0;
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com") return Response.json({ accounts: [{ name: ACCOUNT }] });
    if (url.hostname === "mybusinessbusinessinformation.googleapis.com") {
      if (options.partial) return Response.json({ error: { message: "quota exceeded" } }, { status: 429 });
      return Response.json({ locations: [{ name: LOCATION, title: "Fixture", metadata: options.metadataVoice === undefined ? {} : { hasVoiceOfMerchant: options.metadataVoice } }] });
    }
    if (url.hostname === "mybusinessverifications.googleapis.com") return Response.json(options.voice ?? { verify: { hasPendingVerification: true } }, { status: options.voiceStatus ?? 200 });
    throw new Error("Unexpected provider request");
  };
  const route = load("app/api/integrations/google-business/locations/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } }, error: null }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: h.db },
    "@/lib/googleBusiness": { getGmbToken: async () => ({ accessToken: "DUMMY_RAW_ACCESS", row: structuredClone(h.state.row) }) },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "unexpected" }, { status: 500 }) },
    "@/lib/statsCache": { clearAllToolCaches: async () => { caches++; } },
  }, { fetch: fetcher });
  return { ...h, requests, get caches() { return caches; }, run: async (force = false) => (await route.GET(force ? new Request("https://fixture.test/api/integrations/google-business/locations?refreshVerification=1") : undefined)).json() };
}

test("metadata.hasVoiceOfMerchant=true confirms verified without calling a disabled VoiceAPI", async () => {
  const h = locationsRuntime({ metadataVoice: true, voiceStatus: 403, voice: { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } } });
  const payload = await h.run();
  assert.deepEqual(payload.verification, { status: "verified", locationName: LOCATION, clearedStatsReconnect: false });
  assert.equal(h.requests.filter(url => url.hostname === "mybusinessverifications.googleapis.com").length, 0);
  assert.equal(h.state.row.status, "connected");
  assert.equal(h.state.row.meta.needs_reconnect, undefined);
});

test("Voice of Merchant pending is independent from OAuth and repairs only the old Stats marker", async () => {
  const h = locationsRuntime({ metadataVoice: false, marker: { needs_reconnect: true, needs_reconnect_reason: "provider_authentication_failed", needs_reconnect_stage: "stats_provider_metrics" } });
  const payload = await h.run();
  assert.deepEqual(payload.verification, { status: "pending", locationName: LOCATION, clearedStatsReconnect: true });
  assert.equal(h.state.row.status, "connected");
  assert.equal(h.state.row.access_token_enc, "DUMMY_ACCESS");
  assert.equal(h.state.row.meta.needs_reconnect, undefined);
  assert.equal(h.caches, 1);
});

test("metadatafalse and disabled VoiceAPI stay unknown; an incomplete list never implies pending", async () => {
  const disabled = locationsRuntime({ metadataVoice: false, voiceStatus: 403, voice: { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } } });
  assert.equal((await disabled.run()).verification.status, "unknown");
  assert.equal(disabled.state.row.meta.needs_reconnect, undefined);
  const partial = locationsRuntime({ partial: true });
  assert.deepEqual((await partial.run()).verification, { status: "unknown", locationName: null, clearedStatsReconnect: false });
  assert.equal(partial.requests.filter(url => url.hostname === "mybusinessverifications.googleapis.com").length, 0);
  assert.equal(partial.state.writes.length, 0);
});

test("locations keeps a fresh pending proof through a Voice outage, without renewing it", async () => {
  const saved = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(Date.now() - 60_000).toISOString(), authorization_revision: "oauth-revision" };
  const h = locationsRuntime({ metadataVoice: false, voiceStatus: 503, voice: { error: { status: "UNAVAILABLE" } }, marker: { gmb_verification: saved } });
  assert.deepEqual((await h.run(true)).verification, { status: "pending", locationName: LOCATION, clearedStatsReconnect: false });
  assert.deepEqual(h.state.row.meta.gmb_verification, saved);
  assert.equal(h.state.row.status, "connected");
  assert.equal(h.state.row.meta.needs_reconnect, undefined);
});

test("normal location reads reuse five-hour proof; an explicit refresh checks Google immediately", async () => {
  const saved = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(Date.now() - 4 * 60 * 60_000).toISOString(), authorization_revision: "oauth-revision" };
  const h = locationsRuntime({ metadataVoice: false, voice: { hasVoiceOfMerchant: true }, marker: { gmb_verification: saved } });
  assert.equal((await h.run()).verification.status, "pending");
  assert.equal((await h.run()).verification.status, "pending");
  assert.equal(h.requests.filter(url => url.hostname === "mybusinessverifications.googleapis.com").length, 0);
  assert.deepEqual(h.state.row.meta.gmb_verification, saved, "normal openings do not extend the five-hour cache");
  assert.equal((await h.run(true)).verification.status, "verified");
  assert.equal(h.requests.filter(url => url.hostname === "mybusinessverifications.googleapis.com").length, 1);
  assert.notEqual(h.state.row.meta.gmb_verification.checked_at, saved.checked_at);
});

test("expired proof is rechecked, while current metadata can upgrade pending without a Voice request", async () => {
  const saved = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(Date.now() - 5 * 60 * 60_000).toISOString(), authorization_revision: "oauth-revision" };
  const expired = locationsRuntime({ metadataVoice: false, voice: { hasVoiceOfMerchant: true }, marker: { gmb_verification: saved } });
  assert.equal((await expired.run()).verification.status, "verified");
  assert.equal(expired.requests.filter(url => url.hostname === "mybusinessverifications.googleapis.com").length, 1);
  const fresh = { ...saved, checked_at: new Date(Date.now() - 60_000).toISOString() };
  const metadata = locationsRuntime({ metadataVoice: true, marker: { gmb_verification: fresh } });
  assert.equal((await metadata.run()).verification.status, "verified");
  assert.equal(metadata.requests.filter(url => url.hostname === "mybusinessverifications.googleapis.com").length, 0);
});

test("a failed fallback confirmation never attaches old pending to newer OAuth", async () => {
  const saved = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(Date.now() - 60_000).toISOString(), authorization_revision: "oauth-revision" };
  const h = locationsRuntime({ metadataVoice: false, voiceStatus: 503, marker: { gmb_verification: saved }, beforeWrite: state => { state.row.access_token_enc = "NEWER_DUMMY_ACCESS"; state.row.meta = { account: ACCOUNT, connection_version_updated_at: "new-oauth" }; } });
  assert.deepEqual((await h.run(true)).verification, { status: "unknown", locationName: null, clearedStatsReconnect: false });
  assert.equal(h.state.row.meta.gmb_verification, undefined);
});

test("a newer OAuth or selection blocks returning an old pending status to the UI", async () => {
  const h = locationsRuntime({ beforeWrite: state => { state.row.meta = { account: ACCOUNT, connection_version_updated_at: "new-oauth" }; state.row.access_token_enc = "NEWER_DUMMY_ACCESS"; } });
  assert.deepEqual((await h.run()).verification, { status: "unknown", locationName: null, clearedStatsReconnect: false });
  assert.equal(h.state.row.meta.gmb_verification, undefined);
  assert.equal(h.state.row.access_token_enc, "NEWER_DUMMY_ACCESS");
});

const source = readFileSync(new URL("../../lib/stats/buildOverview.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("overview.ts", source, ts.ScriptTarget.Latest, true);
let gmbStage: ts.TryStatement | undefined;
function visit(node: ts.Node) {
  if (ts.isTryStatement(node) && node.tryBlock.getText(parsed).includes("const resourceId = String(channelStates.gmb.resource_id")) gmbStage = node;
  ts.forEachChild(node, visit);
}
visit(parsed); assert.ok(gmbStage, "the actual Google Business statistics stage must be tested");

async function statsRuntime(error: unknown, voice: unknown, options: { voiceStatus?: number; stale?: boolean; cached?: Value } = {}) {
  const row = original();
  if (options.cached) row.meta.gmb_verification = options.cached;
  const h = database({ row, beforeWrite: options.stale ? state => { state.row.access_token_enc = "NEWER_DUMMY_ACCESS"; state.row.meta = { account: ACCOUNT, connection_version_updated_at: "new-oauth" }; } : undefined });
  const sourcesStatus = { gmb: { connected: true, metrics: null as Value } };
  let voiceCalls = 0, markerCalls = 0;
  const verification = load("googleBusinessVerification", {}, { fetch: async () => { voiceCalls++; return Response.json(voice, { status: options.voiceStatus ?? 200 }); } });
  const policy = load("channelReconnectPolicy");
  const dependencies = {
    channelStates: { gmb: { resource_id: LOCATION, account_name: ACCOUNT, connected: true } }, sourcesStatus,
    includeAll: true, includeSet: new Set(), supabase: {}, supabaseAdmin: h.db, userId: "active-company",
    dateWindow: { start: new Date(), end: new Date() }, attemptStartedAt: new Date().toISOString(),
    isStatsActiveConnection: (value: Value) => value.connected,
    getGoogleTokenForAnyGoogle: async () => ({ accessToken: "DUMMY_RAW_ACCESS", row: structuredClone(h.state.row) }),
    gmbFetchDailyMetricsNormalizedWithRecovery: async () => { throw error; },
    readGmbVerification: verification.readGmbVerification,
    persistGmbVerification: store.persistGmbVerification, readStoredGmbVerificationStatus: store.readStoredGmbVerificationStatus, shouldCheckGmbBusinessEligibility: store.shouldCheckGmbBusinessEligibility,
    markPublishChannelReconnectRequired: async (input: Value) => { markerCalls++; assert.equal(input.error, error); return policy.isProviderReconnectRequired(input); },
    getSimpleFrenchErrorMessage: () => "Statistiques indisponibles.", getErrorMessage: (value: unknown) => value instanceof Error ? value.message : String(value),
    log: { info() {}, warn() {} },
  };
  const code = ts.transpileModule(`return (async () => { ${gmbStage!.getText(parsed)} return sourcesStatus; })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
  return { ...h, sourcesStatus, voiceCalls, markerCalls };
}

for (const [voice, status] of [[{ waitForVoiceOfMerchant: {} }, "pending"], [{ verify: {} }, "required"], [{ resolveOwnershipConflict: {} }, "restricted"]] as const) {
  test(`a Stats permission403 with Google ${status} retains OAuth instead of resurrecting reconnect`, async () => {
    const h = await statsRuntime(new Error("Business Profile Performance API error (403): The caller does not have permission."), voice);
    assert.equal(h.markerCalls, 0); assert.equal(h.voiceCalls, 1);
    assert.equal(h.sourcesStatus.gmb.connected, true);
    assert.equal(h.sourcesStatus.gmb.metrics.needs_reconnect, false);
    assert.equal(h.sourcesStatus.gmb.metrics.business_eligibility, status);
    assert.equal(h.state.row.status, "connected");
    assert.equal(h.state.row.resource_id, LOCATION);
  });
}

test("real token failures and missing scopes never get hidden behind business validation", async () => {
  for (const message of ["Business Profile Performance API error (401): Invalid authentication credentials.", "Business Profile Performance API error (403): Request had insufficient authentication scopes.", "Business Profile Performance API error (403): access token expired"]) {
    const h = await statsRuntime(new Error(message), { waitForVoiceOfMerchant: {} });
    assert.equal(h.voiceCalls, 0); assert.equal(h.markerCalls, 1);
    assert.equal(h.sourcesStatus.gmb.metrics.needs_reconnect, true);
  }
});

test("Stats reuses exact fresh five-hour proof without repeated Voice calls or renewed evidence", async () => {
  const cached = { status: "pending", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(Date.now() - 4 * 60 * 60_000).toISOString(), authorization_revision: "oauth-revision" };
  const error = new Error("Business Profile Performance API error (403): The caller does not have permission.");
  const h = await statsRuntime(error, { hasVoiceOfMerchant: true }, { cached });
  assert.equal(h.voiceCalls, 0); assert.equal(h.markerCalls, 0);
  assert.equal(h.sourcesStatus.gmb.metrics.business_eligibility, "pending");
  assert.deepEqual(h.state.row.meta.gmb_verification, cached);
  const stale = await statsRuntime(error, { hasVoiceOfMerchant: true }, { cached, stale: true });
  assert.equal(stale.voiceCalls, 0);
  assert.equal(stale.sourcesStatus.gmb.metrics.business_eligibility, "unknown");
  const oauth = await statsRuntime(new Error("Business Profile Performance API error (401): Invalid authentication credentials."), { waitForVoiceOfMerchant: {} }, { cached });
  assert.equal(oauth.voiceCalls, 0); assert.equal(oauth.markerCalls, 1);
  assert.equal(oauth.sourcesStatus.gmb.metrics.needs_reconnect, true, "cached business eligibility never hides a real OAuth refusal");
  const expired = await statsRuntime(error, { verify: {} }, { cached: { ...cached, checked_at: new Date(Date.now() - 5 * 60 * 60_000).toISOString() } });
  assert.equal(expired.voiceCalls, 1);
  assert.equal(expired.sourcesStatus.gmb.metrics.business_eligibility, "required");
});

test("unknown or verified business validation does not presume that Stats permission is working", async () => {
  for (const [voice, voiceStatus] of [[{ hasVoiceOfMerchant: true }, 200], [{ error: { status: "SERVICE_DISABLED" } }, 403]] as const) {
    const h = await statsRuntime(new Error("Business Profile Performance API error (403): The caller does not have permission."), voice, { voiceStatus });
    assert.equal(h.markerCalls, 1);
    assert.equal(h.sourcesStatus.gmb.metrics.needs_reconnect, true);
    assert.equal(h.state.row.meta.gmb_verification, undefined);
  }
});

test("a stale Stats observation cannot put a pending label on a newer authorization", async () => {
  const h = await statsRuntime(new Error("Business Profile Performance API error (403): The caller does not have permission."), { waitForVoiceOfMerchant: {} }, { stale: true });
  assert.equal(h.markerCalls, 0);
  assert.equal(h.sourcesStatus.gmb.metrics.business_eligibility, "unknown");
  assert.equal(h.state.row.meta.gmb_verification, undefined);
});

test("canonical and browser projections carry validation without changing OAuth connection status", async () => {
  const h = database(); await h.persist();
  const stateSource = readFileSync(new URL("../../lib/channelConnectionState.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const stateParsed = ts.createSourceFile("state.ts", stateSource, ts.ScriptTarget.Latest, true);
  const helperNames = new Set(["isExpired", "latestIntegration", "hasTruthyString", "hasIntegrationRecord", "buildGoogleMapsSearchUrl"]);
  const helpers = stateParsed.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.has(node.name?.text || "")).map(node => node.getText(stateParsed)).join("\n");
  const start = stateSource.indexOf('  const gmb = latestIntegration(rows, "google", "gmb", "gmb");');
  const stop = stateSource.indexOf("\n\n  return {", start);
  const builder = stateParsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getChannelConnectionStates") as ts.FunctionDeclaration;
  const returned = builder.body!.statements.find(node => ts.isReturnStatement(node)) as ts.ReturnStatement;
  const gmb = (returned.expression as ts.ObjectLiteralExpression).properties.find(node => node.name?.getText(stateParsed) === "gmb") as ts.PropertyAssignment;
  const code = ts.transpileModule(`${helpers}\n${stateSource.slice(start, stop)}\nreturn ${gmb.initializer.getText(stateParsed)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const canonical = new Function("rows", "settings", "asRecord", "asString", "getConnectionDisplayStatus", "readStoredGmbVerificationStatus", code)([h.state.row], {}, object, text, consent.getConnectionDisplayStatus, (meta: unknown, loc: string, parent: string) => store.readStoredGmbVerificationStatus(meta, loc, parent, NOW));
  assert.equal(canonical.verification_status, "pending"); assert.equal(canonical.connection_status, "connected"); assert.equal(canonical.connected, true);
  const states = Object.fromEntries(dashboardSync.DASHBOARD_BOOT_CHANNELS.map(channel => [channel, {}]));
  const projected = dashboardSync.buildOfficialDashboardChannelState({ ...states, gmb: canonical, mails: {} });
  assert.equal(projected!.gmbVerificationStatus, "pending");
  assert.equal(projected!.gmbConnectionStatus, "connected");
});
