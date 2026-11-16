import assert from "node:assert/strict";
import test from "node:test";
import { ACCOUNT, ACTOR, asset, AUDIO, load, memory, OTHER, PHOTO } from "./studio-references-fixture.mts";

function runtime(options: { authError?: boolean; settings?: unknown; assets?: ReturnType<typeof asset>[]; queryError?: unknown; rpcError?: unknown } = {}) {
  const calls: { operation: string; value: unknown }[] = [];
  const client = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      const query = {
        select(columns: string) { calls.push({ operation: `select:${table}`, value: columns }); return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        in(key: string, value: unknown) { filters.push([key, value]); return query; },
        maybeSingle: async () => { calls.push({ operation: `read:${table}`, value: filters }); return { data: { settings: Object.hasOwn(options, "settings") ? options.settings : { studio_references: memory() } }, error: options.queryError }; },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) {
          calls.push({ operation: `read:${table}`, value: filters });
          return Promise.resolve({ data: options.assets ?? [asset(PHOTO, "image"), asset(AUDIO, "audio")], error: options.queryError }).then(onFulfilled, onRejected);
        },
      }; return query;
    },
    async rpc(name: string, value: Record<string, unknown>) { calls.push({ operation: `rpc:${name}`, value }); return { data: value.p_memory, error: options.rpcError }; },
  };
  const server = load<typeof import("../../lib/studioReferencesServer.ts")>("lib/studioReferencesServer.ts", {
    "@/lib/supabaseAdmin": { supabaseAdmin: client }, "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (id: string) => `/private/${id}` },
  });
  const authResponse = Response.json({ ok: false }, { status: 401 });
  const route = load<typeof import("../../app/api/media-generation/references/route.ts")>("app/api/media-generation/references/route.ts", {
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
    "@/lib/requireUser": { requireUser: async () => { calls.push({ operation: "auth", value: null }); return { activeUserId: ACCOUNT, authUserId: ACTOR, errorResponse: options.authError ? authResponse : null }; } },
    "@/lib/supabaseAdmin": { supabaseAdmin: client }, "@/lib/studioReferencesServer": server,
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
  });
  return { route, calls, server, authResponse };
}
function request(method: "GET" | "PUT" | "DELETE", body: unknown = memory(), account = ACCOUNT) {
  return new Request("http://localhost/api/media-generation/references", { method, headers: { "content-type": "application/json", "X-Inrcy-Account-Id": account },
    ...(method === "PUT" ? { body: JSON.stringify(body) } : {}) });
}

test("all reference endpoints authenticate before reading request bytes or querying any namespace", async () => {
  for (const method of ["GET", "PUT", "DELETE"] as const) {
    const app = runtime({ authError: true });
    assert.equal(await app.route[method](request(method)), app.authResponse);
    assert.deepEqual(app.calls, [{ operation: "auth", value: null }]);
    assert.match(app.authResponse.headers.get("cache-control")!, /no-store/);
  }
});

test("account expectation is mandatory for writes and mismatch blocks reads/writes before any side effect", async () => {
  for (const method of ["GET", "PUT", "DELETE"] as const) {
    const app = runtime(); const response = await app.route[method](request(method, memory(), OTHER));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, "studio_references_account_changed");
    assert.deepEqual(app.calls, [{ operation: "auth", value: null }]);
  }
  for (const method of ["PUT", "DELETE"] as const) {
    const app = runtime(); const value = request(method); value.headers.delete("X-Inrcy-Account-Id");
    assert.equal((await app.route[method](value)).status, 409);
    assert.deepEqual(app.calls, [{ operation: "auth", value: null }]);
  }
});

test("GET rehydrates only active owned IDs with private content URLs, preserving unavailable bindings", async () => {
  const app = runtime({ assets: [asset(PHOTO, "image")] });
  const response = await app.route.GET(request("GET")); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.accountId, ACCOUNT); assert.deepEqual(result.memory, memory());
  assert.deepEqual(result.unavailableMediaIds, [AUDIO]); assert.deepEqual(result.media.map((row: { id: string }) => row.id), [PHOTO]);
  assert.equal(result.media[0].signed_url, `/private/${PHOTO}`);
  assert.doesNotMatch(JSON.stringify(result.media), /storage_path|user_id|bucket_name/);
  assert.deepEqual(app.calls.find(row => row.operation === "read:pro_tools_configs")?.value, [["user_id", ACCOUNT]]);
  assert.deepEqual(app.calls.find(row => row.operation === "read:pro_media_library")?.value, [["user_id", ACCOUNT], ["is_active", true], ["id", [PHOTO, AUDIO]]]);
  assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.equal(response.headers.get("vary"), "Cookie");
});

test("PUT validates ownership and atomically sends only the memory namespace to the membership-checked RPC", async () => {
  const app = runtime(); const value = memory(); value.references[0].characterName = "  Camille   Martin ";
  const response = await app.route.PUT(request("PUT", value)); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.memory.references[0].characterName, "Camille Martin");
  const saved = app.calls.find(row => row.operation === "rpc:inrcy_set_studio_references")?.value;
  assert.deepEqual(saved, { p_account_id: ACCOUNT, p_actor_auth_user_id: ACTOR, p_memory: result.memory });
  assert.doesNotMatch(JSON.stringify(saved), /signed_url|private\/|consent|data:|https?:|sample|prompt/);
  assert.equal(app.calls.filter(row => row.operation.startsWith("rpc:")).length, 1);
});

test("an account without a remembered set returns no references and does not query the library", async () => {
  const app = runtime({ settings: {} }); const response = await app.route.GET(request("GET"));
  assert.deepEqual(await response.json(), { ok: true, accountId: ACCOUNT, memory: null, media: [], unavailableMediaIds: [] });
  assert.ok(app.calls.every(row => row.operation !== "read:pro_media_library"));
});

test("foreign, inactive, unsafe-path, wrong-type and temporary media fail before the RPC", async () => {
  for (const changes of [{ user_id: OTHER }, { is_active: false }, { media_type: "audio" }, { bucket_name: "public" },
    { source: "ai_media_generation_draft" }, { storage_path: `users/${ACCOUNT}/image/../secret.jpg` }, { storage_path: `users/${OTHER}/image/file.jpg` }]) {
    const app = runtime({ assets: [asset(PHOTO, "image", changes), asset(AUDIO, "audio")] });
    const response = await app.route.PUT(request("PUT"));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, "studio_references_media_unavailable");
    assert.ok(app.calls.every(row => !row.operation.startsWith("rpc:")));
  }
});

test("DELETE forgets only the account memory, is idempotent and never touches media storage", async () => {
  const app = runtime();
  for (let count = 0; count < 2; count++) {
    const response = await app.route.DELETE(request("DELETE"));
    assert.deepEqual(await response.json(), { ok: true, accountId: ACCOUNT, memory: null, media: [], unavailableMediaIds: [] });
  }
  assert.deepEqual(app.calls.filter(row => row.operation.startsWith("rpc:")).map(row => row.value), Array.from({ length: 2 }, () => ({ p_account_id: ACCOUNT, p_actor_auth_user_id: ACTOR, p_memory: null })));
  assert.ok(app.calls.every(row => !row.operation.startsWith("read:")));
});

test("unsupported stored versions, malformed settings and server failures are private and never trigger a broad settings rewrite", async () => {
  for (const [options, status, code] of [
    [{ settings: { studio_references: { version: 2 } } }, 409, "studio_references_version_unsupported"],
    [{ settings: [] }, 409, "studio_references_settings_invalid"],
    [{ settings: null }, 409, "studio_references_settings_invalid"],
    [{ queryError: { message: "https://private.invalid?token=secret" } }, 503, "studio_references_unavailable"],
    [{ rpcError: { code: "PGRST202", message: "private-schema-function" } }, 503, "studio_references_unavailable"],
  ] as const) {
    const app = runtime(options); const response = await ("rpcError" in options ? app.route.PUT(request("PUT")) : app.route.GET(request("GET")));
    const result = await response.json(); assert.equal(response.status, status); assert.equal(result.code, code);
    assert.doesNotMatch(JSON.stringify(result), /private\.invalid|token=|schema-function/);
    assert.ok(app.calls.every(row => !row.operation.includes("update") && !row.operation.includes("insert")));
  }
});

test("PUT bounds streamed JSON, refuses untrusted keys and never truncates the saved memory", async () => {
  for (const payload of ["{", JSON.stringify({ ...memory(), prompt: "do not store" }), JSON.stringify({ ...memory(), consent: true })]) {
    const app = runtime(); const input = request("PUT");
    const response = await app.route.PUT(new Request(input.url, { method: "PUT", headers: input.headers, body: payload }));
    assert.equal(response.status, 400); assert.ok(app.calls.every(row => row.operation === "auth"));
  }
  let cancelled = false;
  const app = runtime(); const headers = request("PUT").headers;
  const input = new Request("http://localhost/references", { method: "PUT", headers,
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12001)); }, cancel() { cancelled = true; } }), duplex: "half",
  } as RequestInit & { duplex: "half" });
  assert.equal((await app.route.PUT(input)).status, 400); assert.equal(cancelled, true);
  assert.ok(app.calls.every(row => row.operation === "auth"));
});
