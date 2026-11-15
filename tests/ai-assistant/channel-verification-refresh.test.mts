import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

type Row = Record<string, unknown>;
type Reader = { execute(input: unknown): Promise<Row>; inputSchema: Row };
type Module = { createInrAssistantChannelConfigurationTools(options: unknown): { readChannelResources: Reader } };
const accountId = "fixture-account", actorId = "fixture-actor";
const original = () => ({ accountConnected: true, configured: true, connected: true, connection_status: "connected", verification_status: "pending", resource_id: "locations/current", resource_label: "Current", account_name: "accounts/current", access_token: "SECRET" });
function harness(options: { status?: string; complete?: boolean; responseStatus?: string; duringRead?: "account" | "actor" | "target"; wait?: Promise<void> } = {}) {
  let account = accountId, actor = actorId;
  const state: Row = { ...original(), verification_status: options.status ?? "pending" };
  const calls: Array<{ method: string; url: string; cookie: string | null }> = [];
  let started!: () => void;
  const began = new Promise<void>(done => { started = done; });
  const nativeGet = async (request?: Request) => {
    calls.push({ method: request?.method || "GET", url: request?.url || "normal", cookie: request?.headers.get("cookie") || null });
    started(); if (options.wait) await options.wait;
    const forced = request && new URL(request.url).searchParams.get("refreshVerification") === "1";
    const resultStatus = options.responseStatus ?? "verified";
    if (forced && options.complete !== false && resultStatus !== "unknown") state.verification_status = resultStatus;
    if (options.duringRead === "account") account = "other-account";
    if (options.duringRead === "actor") actor = "other-actor";
    if (options.duringRead === "target") state.resource_id = "locations/other";
    return Response.json({ complete: options.complete !== false, locations: [{ name: "locations/current", accountName: "accounts/current", title: "Current", access_token: "SECRET" }], verification: { status: forced ? resultStatus : "pending", locationName: "locations/current" } });
  };
  const stubs: Row = {
    "server-only": {}, ai: { tool: (definition: unknown) => definition, jsonSchema: (schema: unknown) => schema },
    "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor, supabase: {} }) },
    "./channelConnectionState": { getChannelConnectionStates: async () => ({ gmb: structuredClone(state), facebook: { accountConnected: true } }) },
    "./inrAssistantActionPreview.ts": {}, "./inrAssistantRequestClauses.ts": {},
    "@/app/api/integrations/google-business/locations/route": { GET: nativeGet },
    "@/app/api/integrations/facebook/pages/route": { GET: async () => { throw new Error("Unexpected other-channel reader"); } },
  };
  const source = readFileSync(new URL("../../lib/inrAssistantChannelConfigurationTools.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, URLSearchParams })((name: string) => { assert.ok(name in stubs, `Unexpected dependency or mutation ${name}`); return stubs[name]; }, loaded, loaded.exports);
  const api = loaded.exports as Module;
  const tools = api.createInrAssistantChannelConfigurationTools({ request: new Request("https://app.example.test/api/assistant", { headers: { cookie: "existing-session" } }), accountId, actorUserId: actorId, edition: "basic", currentUserMessage: "Actualise la validation Google Business." });
  return { reader: tools.readChannelResources, state, calls, began, changeScope() { account = "other-account"; } };
}

test("Basic pending GMB verification refresh uses the native reader and never changes the selected target", async () => {
  const h = harness(), before = { resource: h.state.resource_id, parent: h.state.account_name };
  const result = await h.reader.execute({ channel: "gmb", refreshGmbVerification: true });
  assert.equal(result.ok, true); assert.equal(result.status, "read"); assert.equal(result.verificationStatus, "verified"); assert.equal(result.verificationRefreshed, true);
  assert.deepEqual(h.calls, [{ method: "GET", url: "https://app.example.test/api/integrations/google-business/locations?refreshVerification=1", cookie: "existing-session" }]);
  assert.equal(h.state.resource_id, before.resource); assert.equal(h.state.account_name, before.parent);
  assert.equal(JSON.stringify(result).includes("SECRET"), false);
});

test("Basic GMB refresh refuses other channels and non-pending states without OAuth or writes", async () => {
  for (const channel of ["facebook", "instagram", "linkedin", "pinterest"]) {
    const h = harness(); assert.equal((await h.reader.execute({ channel, refreshGmbVerification: true })).ok, false); assert.equal(h.calls.length, 0);
  }
  for (const status of ["verified", "required", "restricted", "unknown"]) {
    const h = harness({ status }); assert.equal((await h.reader.execute({ channel: "gmb", refreshGmbVerification: true })).status, "not_pending"); assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.state.connection_status = "needs_update";
  assert.equal((await h.reader.execute({ channel: "gmb", refreshGmbVerification: true })).ok, false); assert.equal(h.calls.length, 0);
});

test("Basic GMB refresh rejects active account, actor or target drift before reporting a verification status", async () => {
  for (const duringRead of ["account", "actor", "target"] as const) {
    const h = harness({ duringRead }); const result = await h.reader.execute({ channel: "gmb", refreshGmbVerification: true });
    assert.equal(result.ok, false, duringRead); assert.notEqual(result.verificationStatus, "verified", duringRead); assert.equal(h.calls.length, 1);
  }
  const h = harness(); h.changeScope(); assert.equal((await h.reader.execute({ channel: "gmb", refreshGmbVerification: true })).ok, false); assert.equal(h.calls.length, 0);
});

test("Basic GMB refresh preserves unknown and partial native outcomes instead of claiming a green fiche", async () => {
  for (const options of [{ responseStatus: "unknown" }, { complete: false }]) {
    const h = harness(options), result = await h.reader.execute({ channel: "gmb", refreshGmbVerification: true });
    assert.equal(result.verificationStatus, "unknown"); assert.equal(h.state.resource_id, "locations/current"); assert.equal(h.state.verification_status, "pending"); assert.equal(h.calls.length, 1);
  }
});

test("Basic GMB refresh is bounded to one native request even for concurrent repeated reader calls", async () => {
  let finish!: () => void; const wait = new Promise<void>(done => { finish = done; });
  const h = harness({ wait }); const first = h.reader.execute({ channel: "gmb", refreshGmbVerification: true }); await h.began;
  const second = h.reader.execute({ channel: "gmb", refreshGmbVerification: true }); finish();
  const results = await Promise.all([first, second]); assert.equal(results[0].verificationStatus, "verified"); assert.equal(h.calls.length, 1);
});

test("Basic ordinary GMB resource reads do not force verification or accept model-supplied endpoints", async () => {
  const h = harness(); assert.equal((await h.reader.execute({ channel: "gmb" })).ok, true); assert.equal(h.calls[0].url, "normal");
  for (const input of [{ channel: "gmb", refreshGmbVerification: "true" }, { channel: "gmb", refreshGmbVerification: true, endpoint: "https://foreign.example" }]) {
    const invalid = harness(); assert.equal((await invalid.reader.execute(input)).ok, false); assert.equal(invalid.calls.length, 0);
  }
});
