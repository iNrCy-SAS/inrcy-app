import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isProviderReconnectRequired } from "../../lib/channelReconnectPolicy.ts";

// Production gate/cache/parser/token wrapper run against fake provider/database boundaries.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
type Row = Record<string, Value>;
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const uid = "fixture-user", accountName = "accounts/fixture", locationName = "locations/fixture";
function runtime(status?: string, response = async () => Response.json({ hasVoiceOfMerchant: true }), ageMs = 0, failPersistence = false) {
  const revision = "2026-11-15T10:00:00Z";
  let stored: Row = { id: "fixture-row", user_id: uid, provider: "google", source: "gmb", product: "gmb", status: "connected", resource_id: locationName, resource_label: "Fixture", email_address: "fixture@example.invalid", access_token_enc: "synthetic-access", refresh_token_enc: "synthetic-refresh", expires_at: "2099-01-01T00:00:00Z", meta: { account: accountName, connection_version_updated_at: revision, ...(status ? { gmb_verification: { status, locationName, accountName, checked_at: new Date(Date.now() - ageMs).toISOString(), authorization_revision: revision } } : {}) } };
  let voiceCalls = 0, posts = 0, writes = 0;
  const cache = new Map<string, Row>();
  const db = { from(table: string) {
    assert.equal(table, "integrations"); let patch: Row = {};
    return { update(next: Row) { patch = next; return this; }, eq() { return this; }, is() { return this; }, async select() {
      if (failPersistence) return { data: null, error: { code: "fixture" } };
      writes++; stored = { ...stored, ...structuredClone(patch) }; return { data: [{ id: stored.id }], error: null };
    } };
  } };
  const fetch = async (input: unknown) => { assert.equal(input, `https://mybusinessverifications.googleapis.com/v1/${locationName}/VoiceOfMerchantState`); voiceCalls++; return response(); };
  function load(file: string): Row {
    if (cache.has(file)) return cache.get(file)!;
    const mod = { exports: {} as Row }; cache.set(file, mod.exports);
    const require = (name: string): unknown => {
      if (name === "server-only") return {};
      if (name === "@/lib/googleStats") return { getGoogleTokenForAnyGoogle: async () => ({ accessToken: "synthetic-plain-access", row: structuredClone(stored) }) };
      if (name === "@/lib/googleBusinessLocations") return {};
      if (name === "@/lib/boosterCtaActions") return { getBoosterLinkCtaChoice: () => null };
      if (name === "@/lib/googleBusinessPostTransport") return { postGoogleBusinessLocalPost: async () => { posts++; return { name: "fixture-post" }; } };
      assert.ok(name.startsWith("@/lib/googleBusiness"), name); return load(`${name.slice(2)}.ts`);
    };
    const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", "fetch", code)(require, mod, mod.exports, fetch);
    return mod.exports;
  }
  const gate = load("lib/googleBusinessPublicationGate.ts"), google = load("lib/googleBusiness.ts");
  const context = { userId: uid, supabase: db, purpose: "publication", accountName, locationName };
  return { gate, google, db, context, get stored() { return stored; }, get voiceCalls() { return voiceCalls; }, get posts() { return posts; }, get writes() { return writes; },
    check: (extra: Row = {}) => gate.assertGmbPublicationVerification({ accessToken: "synthetic-plain-access", row: structuredClone(stored), userId: uid, accountName, locationName, db, ...extra }),
    async publish() { const token = await google.getGmbToken(context); if (!token) return null; return google.gmbCreateLocalPost({ accessToken: token.accessToken, accountName, locationName, summary: "Fixture" }); },
  };
}

test("fresh verified evidence allows the real publication token path without a Voice lookup", async () => {
  const h = runtime("verified"); await h.publish();
  assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 1); assert.equal(h.writes, 0);
});

test("fresh pending, required and restricted stop before any POST without touching OAuth", async () => {
  for (const status of ["pending", "required", "restricted"]) {
    const h = runtime(status), before = structuredClone(h.stored);
    await assert.rejects(h.publish(), (error: Value) => {
      assert.ok(error instanceof h.gate.GmbPublicationVerificationError); assert.equal(error.status, 409); assert.equal(error.code, `gmb_verification_${status}`);
      assert.equal(error.retryable, false); assert.equal(error.outcomeUnknown, false);
      assert.equal(isProviderReconnectRequired({ channel: "gmb", error, stage: "publish" }), false); return true;
    });
    assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0); assert.deepEqual(h.stored, before);
  }
});

test("a live pending result blocks the real wrapper before POST and preserves its Google grant", async () => {
  const h = runtime(undefined, async () => Response.json({ waitForVoiceOfMerchant: {} }));
  await assert.rejects(h.publish(), (error: Value) => error.code === "gmb_verification_pending" && error.status === 409);
  assert.equal(h.voiceCalls, 1); assert.equal(h.posts, 0); assert.equal(h.stored.status, "connected"); assert.equal(h.stored.meta.needs_reconnect, undefined); assert.equal(h.stored.meta.gmb_verification.status, "pending");
});

test("expired pending evidence is refreshed so a now-verified fiche can publish", async () => {
  const h = runtime("pending", undefined, 6 * 60 * 60_000); await h.publish();
  assert.equal(h.voiceCalls, 1); assert.equal(h.posts, 1); assert.equal(h.stored.meta.gmb_verification.status, "verified");
});

test("an unavailable verification lookup prevents iNrCy publication without inventing pending or an OAuth failure", async () => {
  for (const response of [async () => Response.json({ error: { details: [{ reason: "SERVICE_DISABLED" }] } }, { status: 403 }), async () => Response.json({}, { status: 503 }), async () => { throw new DOMException("synthetic timeout", "TimeoutError"); }]) {
    const h = runtime(undefined, response);
    await assert.rejects(h.publish(), (error: Value) => {
      assert.equal(error.code, "gmb_verification_unavailable"); assert.equal(error.status, 409);
      assert.equal(isProviderReconnectRequired({ channel: "gmb", error, stage: "publish" }), false); return true;
    });
    assert.equal(h.voiceCalls, 1); assert.equal(h.posts, 0); assert.equal(h.stored.status, "connected"); assert.equal(h.stored.meta.needs_reconnect, undefined); assert.equal(h.stored.meta.gmb_verification?.status ?? "unknown", "unknown");
  }
});

test("failed enrichment persistence cannot turn a known validation requirement into a POST", async () => {
  const h = runtime(undefined, async () => Response.json({ verify: {} }), 0, true);
  await assert.rejects(h.publish(), (error: Value) => error.code === "gmb_verification_required");
  assert.equal(h.posts, 0); assert.equal(h.stored.meta.needs_reconnect, undefined);
});

test("a changed fiche, parent or active account fails before Voice or POST", async () => {
  for (const extra of [{ locationName: "locations/other" }, { accountName: "accounts/other" }, { userId: "another-user" }]) {
    const h = runtime("verified"); await assert.rejects(h.check(extra), (error: Value) => error.code === "gmb_publication_selection_changed" && error.status === 409);
    assert.equal(h.voiceCalls, 0); assert.equal(h.posts, 0);
  }
});

test("ordinary tokens for lists, profiles, reviews and deletion never run the publication gate", async () => {
  const h = runtime("pending"); assert.ok(await h.google.getGmbToken({ supabase: h.db, userId: uid })); assert.equal(h.voiceCalls, 0); assert.equal(h.writes, 0);
});

test("known validation blocks keep their business explanation before generic connection guards while OAuth renewal keeps priority", () => {
  const h = runtime();
  for (const verification_status of ["pending", "required", "restricted"]) {
    const state = { connected: true, connection_status: "connected", verification_status };
    assert.equal(h.gate.getGmbPublicationStateBlock(state).code, `gmb_verification_${verification_status}`);
    for (const patch of [{ connection_status: "needs_update" }, { requiresUpdate: true }, { expired: true }, { connected: false }]) {
      assert.equal(h.gate.getGmbPublicationStateBlock({ ...state, ...patch }), null);
    }
  }
  assert.equal(h.gate.getGmbPublicationStateBlock({ connected: true, connection_status: "connected", verification_status: "unknown" }), null);
});

test("only publication entry points opt in and the iNrSend 409 is preserved before Sentry or OAuth marking", () => {
  const booster = read("app/api/booster/publish-now/route.ts"), inrsend = read("lib/inrsend/publicationChannelActions.ts");
  const context = /getGmbToken\(\{\s*supabase: supabaseAdmin,\s*userId,\s*purpose: "publication",\s*accountName,\s*locationName,\s*\}\)/;
  assert.match(booster, context); assert.match(inrsend, context);
  assert.equal([...inrsend.matchAll(/purpose: "publication"/g)].length, 1, "DELETE stays outside this gate");
  const start = inrsend.indexOf("if (channel === \"gmb\" && e instanceof GmbPublicationVerificationError)"); assert.ok(start >= 0);
  assert.match(inrsend.slice(start, start + 200), /status: 409, code: e\.code/); assert.ok(start < inrsend.indexOf("captureApiException(req, e", start));
  assert.ok(booster.indexOf("getGmbPublicationStateBlock(liveChannelState)") < booster.indexOf("if (!isOfficialPublicationChannelConnected(liveChannelState))"));
  assert.ok(inrsend.indexOf("getGmbPublicationStateBlock(officialState)") < inrsend.indexOf("const officiallyConnected"));
});
