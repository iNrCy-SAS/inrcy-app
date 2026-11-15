import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Offline route fixtures deliberately model heterogeneous provider JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const ACCOUNT = "accounts/parent", LOCATION = "locations/selected", USER = "active-company";

function fixture(options: { cached?: string; live?: string; disabled?: boolean; connection?: string; tokenPatch?: Value; noToken?: boolean; transient?: boolean; unauthenticated?: boolean; missingTarget?: boolean } = {}) {
  const connected = { connected: true, connection_status: "connected" };
  const states: Value = {
    site_web: { ...connected, url: "https://business.example.test/" },
    gmb: { ...connected, accountConnected: true, configured: true, account_name: ACCOUNT, resource_id: options.missingTarget ? null : LOCATION, resource_label: "Fixture Business", url: "https://maps.google.com/?cid=123", verification_status: options.cached || "unknown", connection_status: options.connection || "connected" },
    facebook: { ...connected, resource_label: "Fixture Page", page_url: "https://facebook.com/fixture" },
    instagram: { ...connected, authMode: "facebook_login", username: "fixture", profile_url: "https://instagram.com/fixture" },
    threads: { ...connected, username: "fixture", profile_url: "https://threads.net/@fixture" },
    linkedin: { ...connected, display_name: "Fixture", profile_url: "https://linkedin.com/in/fixture" },
    tiktok: { ...connected, username: "fixture", profile_url: "https://tiktok.com/@fixture" },
    youtube_shorts: { ...connected, title: "Fixture", channel_url: "https://youtube.com/@fixture" },
    pinterest: { ...connected, username: "fixture", default_board_id: "chosen-board", profile_url: "https://pinterest.com/fixture" },
    x: { ...connected, username: "fixture", profile_url: "https://x.com/fixture" },
  };
  const token = { accessToken: "DUMMY_RAW_ACCESS", row: { id: "integration", user_id: USER, provider: "google", source: "gmb", product: "gmb", status: "connected", resource_id: LOCATION, access_token_enc: "DUMMY_ENCRYPTED_ACCESS", meta: { account: ACCOUNT, connection_version_updated_at: "oauth-revision" }, ...options.tokenPatch } };
  let stateReads = 0, tokenCalls = 0, voiceCalls = 0, posts = 0;
  const persistence: Value[] = [];
  const db = {};
  const modules = new Map<string, Value>();
  const dependencies: Record<string, Value> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase: db, activeUserId: USER, errorResponse: options.unauthenticated ? Response.json({ error: "Session expired" }, { status: 401 }) : null }) },
    "@/lib/channelConnectionState": { getChannelConnectionStates: async (receivedDb: unknown, userId: string) => {
      assert.equal(receivedDb, db); assert.equal(userId, USER); stateReads++;
      const current = structuredClone(states);
      if (options.noToken && stateReads > 1) { current.gmb.connection_status = "needs_update"; current.gmb.requiresUpdate = true; }
      return current;
    } },
    "@/lib/appBubbleAccessServer": { getAppBubbleAccessMapForUser: async () => ({ gmb: !options.disabled }) },
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async () => true },
    "@/lib/inrSearchProvisioning": { ensureSystemManagedInrSearch: async () => ({ inrSearch: { slug: "fixture" } }) },
    "@/lib/inrSearchPublic": { getInrSearchPublicStatus: async () => ({ published: true }), buildInrSearchPublicUrl: () => "https://search.example.test/fixture" },
    "@/lib/observability/logger": { log: { error() {}, warn() {}, info() {} } },
    "@/lib/boosterCtaActions": {}, "@/lib/googleBusinessLocations": {},
    "@/lib/googleBusinessPostTransport": { postGoogleBusinessLocalPost: () => { posts++; assert.fail("A channel availability GET must never publish a post"); } },
    "@/lib/googleStats": { getGoogleTokenForAnyGoogle: async (source: string, product: string, context: Value) => {
      tokenCalls++; assert.equal(source, "gmb"); assert.equal(product, "gmb"); assert.equal(context.userId, USER); assert.equal(context.supabase, db);
      return options.noToken ? null : structuredClone(token);
    } },
    "@/lib/googleBusinessVerification": { readGmbVerification: async (accessToken: string, location: string) => {
      voiceCalls++; assert.equal(accessToken, "DUMMY_RAW_ACCESS"); assert.equal(location, LOCATION);
      if (options.transient) throw new Error("Provider temporarily unavailable");
      return options.live || "unknown";
    } },
    "@/lib/googleBusinessVerificationStore": {
      readStoredGmbVerificationStatus: (meta: unknown, location: string, account: string) => load("lib/googleBusinessVerificationStore.ts").readStoredGmbVerificationStatus(meta, location, account),
      persistGmbVerification: async (input: Value) => { persistence.push(input); return { status: input.status, persisted: true, clearedStatsReconnect: false }; },
    },
  };
  function load(path: string): Value {
    if (modules.has(path)) return modules.get(path);
    const output = { exports: {} as Value };
    modules.set(path, output.exports);
    const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", code)((name: string) => {
      if (name === "server-only") return {};
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith("@/lib/")) return load(`lib/${name.slice(6)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    }, output, output.exports);
    modules.set(path, output.exports);
    return output.exports;
  }
  const route = load("app/api/booster/connected-channels/route.ts");
  return { get tokenCalls() { return tokenCalls; }, get voiceCalls() { return voiceCalls; }, get posts() { return posts; }, get stateReads() { return stateReads; }, persistence,
    async run() { const response = await route.GET(); const body = await response.json(); assert.doesNotMatch(JSON.stringify(body), /DUMMY_RAW_ACCESS|DUMMY_ENCRYPTED_ACCESS|oauth-revision/); return { response, body }; } };
}

test("a verified cached Google fiche is publishable without a provider lookup or POST", async () => {
  const h = fixture({ cached: "verified" }); const { response, body } = await h.run();
  assert.equal(response.status, 200); assert.equal(body.channels.gmb, true);
  assert.equal(body.channelDetails.gmb.verificationStatus, "verified");
  assert.equal(body.channelDetails.gmb.availabilityError, false);
  assert.equal(h.tokenCalls, 0); assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0); assert.equal(h.stateReads, 1);
});

for (const status of ["pending", "required", "restricted"]) {
  test(`cached Google ${status} disables publication while preserving the authorized connection`, async () => {
    const h = fixture({ cached: status }); const { body } = await h.run();
    assert.equal(body.channels.gmb, false); assert.equal(body.channels.facebook, true);
    assert.equal(body.channelDetails.gmb.connectionStatus, "connected"); assert.equal(body.channelDetails.gmb.requiresReconnect, false);
    assert.equal(body.channelDetails.gmb.verificationStatus, status); assert.ok(body.channelDetails.gmb.statusLabel);
    assert.equal(body.channelDetails.gmb.availabilityError, false);
    assert.equal(h.tokenCalls, 0); assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0); assert.equal(h.stateReads, 1);
  });
}

for (const status of ["verified", "pending", "required", "restricted", "unknown"]) {
  test(`an unknown cache checks the exact Google fiche and exposes live ${status} without publishing`, async () => {
    const h = fixture({ live: status }); const { response, body } = await h.run();
    assert.equal(response.status, 200); assert.equal(body.channels.gmb, status === "verified");
    assert.equal(body.channelDetails.gmb.verificationStatus, status);
    assert.equal(body.channelDetails.gmb.availabilityError, status === "unknown");
    assert.equal(body.channelDetails.gmb.connectionStatus, "connected"); assert.equal(body.channelDetails.gmb.requiresReconnect, false);
    assert.equal(body.channels.facebook, true); assert.equal(body.channels.pinterest, true);
    assert.equal(h.tokenCalls, 1); assert.equal(h.voiceCalls, 1); assert.equal(h.posts, 0);
    assert.ok(h.persistence.every(input => input.userId === USER && input.locationName === LOCATION && input.accountName === ACCOUNT));
  });
}

test("a provider outage disables only Google publication and never invents an OAuth reconnect", async () => {
  const h = fixture({ transient: true }); const { response, body } = await h.run();
  assert.equal(response.status, 200); assert.equal(body.channels.gmb, false); assert.equal(body.channels.facebook, true);
  assert.equal(body.channelDetails.gmb.verificationStatus, "unknown"); assert.equal(body.channelDetails.gmb.requiresReconnect, false);
  assert.equal(body.channelDetails.gmb.availabilityError, true);
  assert.match(body.channelDetails.gmb.statusLabel, /momentanément indisponible/); assert.equal(h.posts, 0);
});

test("a fresh verified proof obtained between canonical and token reads avoids another Google request", async () => {
  const meta = { account: ACCOUNT, connection_version_updated_at: "oauth-revision", gmb_verification: { status: "verified", locationName: LOCATION, accountName: ACCOUNT, checked_at: new Date(Date.now() - 60_000).toISOString(), authorization_revision: "oauth-revision" } };
  const h = fixture({ tokenPatch: { meta } }); const { body } = await h.run();
  assert.equal(body.channels.gmb, true); assert.equal(body.channelDetails.gmb.verificationStatus, "verified");
  assert.equal(h.tokenCalls, 1); assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0);
});

test("Bubble Access and existing authentication guards prevent all Google provider lookups", async () => {
  for (const options of [{ disabled: true }, { connection: "needs_update" }, { connection: "disconnected" }, { missingTarget: true }]) {
    const h = fixture(options); const { body } = await h.run();
    assert.equal(body.channels.gmb, false); assert.equal(h.tokenCalls, 0); assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0);
    assert.equal(body.channelDetails.gmb.requiresReconnect, options.connection === "needs_update");
    if (options.disabled || options.connection) assert.equal(body.channelDetails.gmb.availabilityError, false);
  }
});

test("a newer target or different account cannot authorize the old channel snapshot", async () => {
  for (const tokenPatch of [{ resource_id: "locations/newer" }, { user_id: "another-company" }, { meta: { account: "accounts/newer" } }]) {
    const h = fixture({ tokenPatch, live: "verified" }); const { body } = await h.run();
    assert.equal(body.channels.gmb, false); assert.equal(body.channelDetails.gmb.verificationStatus, "unknown");
    assert.equal(body.channelDetails.gmb.requiresReconnect, false); assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0);
  }
});

test("a real missing credential rereads the canonical OAuth reconnect marker", async () => {
  const h = fixture({ noToken: true }); const { body } = await h.run();
  assert.equal(body.channels.gmb, false); assert.equal(body.channelDetails.gmb.connectionStatus, "needs_update");
  assert.equal(body.channelDetails.gmb.requiresReconnect, true); assert.equal(h.stateReads, 2); assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0);
  assert.equal(body.channelDetails.gmb.availabilityError, false);
});

test("an unauthenticated request cannot inspect channels or reach Google", async () => {
  const h = fixture({ unauthenticated: true }); const { response } = await h.run();
  assert.equal(response.status, 401); assert.equal(h.stateReads, 0); assert.equal(h.tokenCalls, 0); assert.equal(h.voiceCalls, 0);
});
