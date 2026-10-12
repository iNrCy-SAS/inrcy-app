/* eslint-disable @typescript-eslint/no-explicit-any -- The transpiled route and fluent DB fixtures retain heterogeneous JSON shapes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import ts from "typescript";
import * as capabilities from "../../lib/inrsend/instagramCapabilities.ts";

type Fixture = {
  authMode?: "instagram_login" | "facebook_login";
  channel?: string;
  result?: Record<string, unknown>;
  deliveries?: Array<Record<string, unknown>>;
  missingPublication?: boolean;
  authDenied?: boolean;
};

function runtime(options: Fixture = {}) {
  const channel = options.channel || "instagram";
  const rawResult = options.result ?? { ok: true, status: "delivered", external_id: "178900000000001" };
  const state = {
    publication: options.missingPublication ? null : { id: "publication", user_id: "owned-account", title: "Titre", content: "Texte", images: [] },
    event: { id: "event", payload: { publication_id: "publication", channels: [channel, "facebook"], results: { [channel]: rawResult, other_channel: { ok: true, external_id: "other-post" } }, post: { title: "Titre", content: "Texte" } }, created_at: "2026-10-12T10:00:00Z" },
    deliveries: options.deliveries ?? [{ id: "delivery", channel, status: "delivered" }],
  };
  const reads: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = [];
  const writes: Array<{ table: string; patch: unknown; filters: Array<[string, unknown]> }> = [];
  const nativeCalls: unknown[] = [];
  const before = structuredClone(state);
  const database = { from: (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let columns = "", patch: any, updating = false;
    const finish = () => {
      const owner = filters.find(([column]) => column === "user_id")?.[1];
      assert.equal(owner, "owned-account", `${table} must be scoped to the active owned account`);
      if (updating) {
        writes.push({ table, patch: structuredClone(patch), filters: structuredClone(filters) });
        if (table === "app_events") state.event.payload = structuredClone(patch.payload);
        if (table === "publication_deliveries") for (const delivery of state.deliveries) if (delivery.channel === channel) Object.assign(delivery, patch);
        return { data: null, error: null };
      }
      reads.push({ table, columns, filters: structuredClone(filters) });
      if (table === "publications") return { data: state.publication, error: null };
      if (table === "app_events") return { data: [state.event], error: null };
      if (table === "publication_deliveries") return { data: state.deliveries, error: null };
      if (table === "integrations") {
        const provider = filters.find(([column]) => column === "provider")?.[1];
        return { data: [{ id: "integration", user_id: "owned-account", provider, source: provider, product: provider, status: "connected", resource_id: "123", access_token_enc: "synthetic-encrypted", meta: { auth_mode: options.authMode || "instagram_login" }, expires_at: "2026-11-01T10:00:00Z" }], error: null };
      }
      throw new Error(`Unexpected DB table: ${table}`);
    };
    const query: any = {
      select: (value: string) => { columns = value; return query; },
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      in: (column: string, value: unknown) => { filters.push([column, value]); return query; },
      order: () => query, limit: () => query,
      update: (value: unknown) => { patch = value; updating = true; return query; },
      insert: () => { throw new Error("No Instagram action log insert is permitted for this delete"); },
      maybeSingle: async () => finish(),
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(finish).then(resolve, reject),
    };
    return query;
  } };
  const unused = new Proxy({}, { get: (_target, property) => () => { throw new Error(`Unexpected dependency executed: ${String(property)}`); } });
  const mocks: Record<string, unknown> = {
    "next-intl/server": { getTranslations: async () => (key: string) => key },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => options.authDenied ? { errorResponse: Response.json({ error: "auth" }, { status: 401 }) } : { user: { id: "actor" }, activeUserId: "owned-account" } },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/inrsend/instagramCapabilities": capabilities,
    "@/lib/siteWebChannel": { normalizeSiteWebPublicationPayload: (value: unknown) => structuredClone(value), canonicalSiteWebChannel: (value: unknown) => value },
    "@/lib/instagramAuthMode": { resolveInstagramAuthMode: (meta: any) => meta?.auth_mode === "instagram_login" ? "instagram_login" : "facebook_login" },
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async () => true, isMetaChannelPilotEnabledForAccount: async () => true },
    "@/lib/metaDirectTokens": { ensureMetaDirectAccessToken: async (...args: unknown[]) => { nativeCalls.push(["refresh", ...args]); return "synthetic-access"; } },
    "@/lib/oauthCrypto": { tryDecryptToken: () => { nativeCalls.push("decrypt"); return "synthetic-access"; } },
    "@/lib/metaGraphApi": { buildMetaGraphUrl: (path: string) => `https://graph.facebook.com/v25.0/${path}` },
    "@/lib/threadsPublish": { threadsDeletePost: async (args: unknown) => { nativeCalls.push(["threads-delete", args]); return { ok: true }; } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: (error: unknown, opts: { status: number; code?: string }) => Response.json({ ok: false, error: String(error), code: opts.code }, { status: opts.status }) },
    "@/lib/observability/sentry": { captureApiException: (...args: unknown[]) => { nativeCalls.push(["unexpected-exception", ...args]); } },
    "@/lib/channelPublishDiagnostics": { getPublishChannelUserMessage: (_channel: string, error: Error) => error.message, logPublishChannelFailure: () => undefined },
    "crypto": { createHash, randomUUID },
  };
  const source = readFileSync(new URL("../../lib/inrsend/publicationChannelActions.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exported: any = {};
  new Function("exports", "require", code)(exported, (name: string) => mocks[name] ?? unused);
  const handlers = exported.createPublicationChannelHandlers(channel);
  return { before, state, reads, writes, nativeCalls, run: (body: unknown = {}) => handlers.DELETE(new Request("https://fixture.test/api/inrsend/publications/publication/instagram", { method: "DELETE", body: JSON.stringify(body) }), { params: Promise.resolve({ publicationId: "publication" }) }) as Promise<Response> };
}

test("Published Instagram deletion is blocked for direct and Facebook login before Graph, refresh or persistence", async () => {
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error("Real network must not be used"); };
  try {
    for (const authMode of ["instagram_login", "facebook_login"] as const) {
      for (const result of [
        { ok: true, external_id: "178900000000001" },
        { ok: true, instagram_parent_media_id: "178900000000001" },
        { ok: true, diagnostics: { mediaId: "178900000000001" } },
        { ok: false, status: "failed", external_id: "178900000000001" },
        { ok: true, external_url: "https://www.instagram.com/reel/test/" },
      ]) {
        const fixture = runtime({ authMode, result });
        const response = await fixture.run({ externalId: null });
        assert.equal(response.status, 409);
        assert.equal((await response.json()).code, "instagram_delete_unsupported");
        assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.nativeCalls, []);
        assert.deepEqual(fixture.state, fixture.before);
      }
    }
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("Legacy false-deleted Instagram records cannot return a second success or mutate history", async () => {
  const fixture = runtime({ result: { ok: false, status: "deleted", deleted: true, external_id: "178900000000001", error: null, deleted_at: "2026-10-12T10:00:00Z" }, deliveries: [{ channel: "instagram", status: "deleted" }] });
  const response = await fixture.run({ externalId: null });
  assert.equal(response.status, 409); assert.equal((await response.json()).code, "instagram_delete_unsupported");
  assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.nativeCalls, []); assert.deepEqual(fixture.state, fixture.before);
});

test("A confirmed delivery blocks Instagram removal even when its external ID is missing", async () => {
  const fixture = runtime({ result: { ok: false, status: "failed" }, deliveries: [{ channel: "instagram", status: "delivered" }] });
  assert.equal((await fixture.run()).status, 409);
  assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.nativeCalls, []);
});

test("Ambiguous Instagram publication and unclassified legacy deletion remain fail-closed", async () => {
  for (const result of [
    { ok: false, requestMayHaveSucceeded: true, status: "failed" },
    { ok: false, diagnostics: { checkpoint: { state: "publish_unknown", containerId: "123" } } },
    { ok: false, status: "deleted", deleted: true },
    {},
  ]) {
    const fixture = runtime({ result, deliveries: [{ channel: "instagram", status: Object.keys(result).length ? "failed" : "unknown" }] });
    assert.equal((await fixture.run()).status, 409);
    assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.nativeCalls, []);
  }
});

test("Failed/pending Instagram drafts without a published receipt are removed locally without tokens or Graph", async () => {
  for (const result of [{ ok: false, status: "failed" }, { pending: true, status: "pending", diagnostics: { checkpoint: { state: "processing", containerId: "123" } } }, { status: "draft" }, {}]) {
    const fixture = runtime({ result, deliveries: [{ channel: "instagram", status: "failed" }, { channel: "facebook", status: "delivered" }] });
    const response = await fixture.run({ externalId: "untrusted-foreign-id" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.local_deleted_only, true); assert.equal(body.remote_deleted, false);
    assert.deepEqual(fixture.nativeCalls, []);
    assert.equal(fixture.writes.length, 2);
    assert.equal(body.payload.results.instagram.external_id, null);
    assert.equal(body.payload.results.instagram.delete_scope, "local_draft");
    assert.deepEqual(body.payload.results.other_channel, fixture.before.event.payload.results.other_channel);
    assert.equal(fixture.state.deliveries[1].status, "delivered");
    const second = await fixture.run(); assert.equal(second.status, 200);
    assert.equal((await second.json()).remote_deleted, false); assert.equal(fixture.writes.length, 2);
  }
});

test("Existing Facebook and Threads native deletes retain their remote operation and owned persistence", async () => {
  const originalFetch = globalThis.fetch;
  const fetches: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = async (url, init) => { fetches.push({ url: String(url), method: init?.method }); return Response.json({ success: true }); };
  try {
    const facebook = runtime({ channel: "facebook", result: { ok: true, external_id: "page_owned-post" } });
    assert.equal((await facebook.run()).status, 200);
    assert.equal(fetches.length, 1); assert.equal(fetches[0].method, "DELETE");
    assert.ok(fetches[0].url.includes("page_owned-post")); assert.equal(facebook.writes.length, 2);
    const threads = runtime({ channel: "threads", result: { ok: true, external_id: "178900000000002" } });
    assert.equal((await threads.run({ externalId: "foreign-thread" })).status, 200);
    const deletion = threads.nativeCalls.find((call: any) => Array.isArray(call) && call[0] === "threads-delete") as any;
    assert.equal(deletion[1].postId, "178900000000002"); assert.equal(threads.writes.length, 2);
    assert.equal(fetches.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("Unauthenticated and unknown-owned Instagram publications cannot change another account", async () => {
  for (const [options, expected] of [[{ authDenied: true }, 401], [{ missingPublication: true }, 404]] as const) {
    const fixture = runtime(options); assert.equal((await fixture.run()).status, expected);
    assert.deepEqual(fixture.writes, []); assert.deepEqual(fixture.nativeCalls, []);
  }
});

test("Pure Instagram capabilities distinguish published IDs from containers and local or confirmed deletions", () => {
  assert.equal(capabilities.INSTAGRAM_PUBLICATION_CAPABILITIES.deletePublished, false);
  assert.equal(capabilities.INSTAGRAM_PUBLICATION_CAPABILITIES.deleteDraft, true);
  assert.equal(capabilities.hasInstagramPublishedMedia({ pending: true, diagnostics: { containerId: "123", childContainerIds: ["124"] } }), false);
  assert.equal(capabilities.hasInstagramPublishedMedia({ ok: true, outcome: "processing", checkpoint: { state: "processing", containerId: "123", mediaId: null } }), false);
  assert.equal(capabilities.hasInstagramPublishedMedia({ ok: false }, { instagram: { status: "delivered" } }), true);
  assert.equal(capabilities.hasInstagramPublishedMedia({ ok: false }, { facebook: { status: "delivered" } }), false);
  assert.equal(capabilities.isLegacyInstagramDeletionUnconfirmed({ deleted: true, external_id: "178900000000001" }), true);
  for (const marker of ["remoteDeletionConfirmed", "remote_deletion_confirmed", "remote_deleted", "remoteDeleted"]) assert.equal(capabilities.isLegacyInstagramDeletionUnconfirmed({ deleted: true, external_id: "178900000000001", [marker]: true }), false);
  assert.equal(capabilities.isLegacyInstagramDeletionUnconfirmed({ deleted: true, local_deleted_only: true, delete_scope: "local_draft" }), false);
  assert.equal(capabilities.canRemoveInstagramDraftLocally({ deleted: true, local_deleted_only: true, delete_scope: "local_draft" }), true);
  assert.equal(capabilities.canRemoveInstagramDraftLocally({ ok: false, status: "deleted", deleted: true }), false);
});
