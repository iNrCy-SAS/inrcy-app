import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as preferences from "../../lib/threadsPublicationPreferences.ts";

test("Threads preferences preserve Classic compatibility and normalize disabled Ghost defaults", () => {
  assert.deepEqual(preferences.normalizeThreadsPublicationPreferences(undefined), { version: 1, ghostEnabled: true, defaultMode: "classic" });
  assert.deepEqual(preferences.getEnabledThreadsPublicationModes(preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES), ["classic"]);
  assert.deepEqual(preferences.getEnabledThreadsPublicationModes(preferences.DEFAULT_THREADS_PUBLICATION_PREFERENCES), ["classic", "ghost"]);
  assert.deepEqual(preferences.parseThreadsPublicationSettings(undefined), { mode: "classic" });
  assert.deepEqual(preferences.normalizeThreadsPublicationPreferences({ ghostEnabled: false, defaultMode: "ghost" }), { version: 1, ghostEnabled: false, defaultMode: "classic" });
  assert.deepEqual(preferences.parseThreadsPublicationPreferencesPatch({ ghostEnabled: true, defaultMode: "ghost" }), { version: 1, ghostEnabled: true, defaultMode: "ghost" });
  assert.deepEqual(preferences.parseThreadsPublicationPreferencesPatch({ ghostEnabled: false, defaultMode: "ghost" }), { version: 1, ghostEnabled: false, defaultMode: "classic" });
  assert.equal(preferences.isThreadsPublicationModeEnabled("ghost", preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES), false);
  for (const value of [null, [], { ghostEnabled: "true", defaultMode: "ghost" }, { ghostEnabled: true, defaultMode: "typo" }]) assert.throws(() => preferences.parseThreadsPublicationPreferencesPatch(value));
  for (const value of [{}, [], { mode: "typo" }]) assert.throws(() => preferences.parseThreadsPublicationSettings(value));
});

test("Explicit Ghost is never converted into a permanent post when disabled or carrying media", () => {
  assert.equal(preferences.getThreadsPublicationModeFailure({ mode: "ghost", preferences: preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES })?.code, "threads_publication_mode_disabled");
  assert.equal(preferences.getThreadsPublicationModeFailure({ mode: "ghost", preferences: preferences.DEFAULT_THREADS_PUBLICATION_PREFERENCES, hasMedia: true })?.code, "threads_ghost_media_unsupported");
  assert.equal(preferences.getThreadsPublicationModeFailure({ mode: "ghost", preferences: preferences.DEFAULT_THREADS_PUBLICATION_PREFERENCES, hasMedia: false }), null);
  assert.equal(preferences.getThreadsPublicationModeFailure({ mode: "classic", preferences: preferences.CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES, hasMedia: true }), null);
});

test("Ghost only evaluates its effective media selection and preserves inactive image associations", () => {
  const shared = { images: ["shared-image"], video: { url: "shared-video" }, imagesByChannel: { threads: ["thread-image"], instagram: ["ig-image"] }, imageSettingsByChannel: { threads: { imageKeys: ["saved-image"] } } };
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ ...shared, mediaModeByChannel: { threads: "none", instagram: "images" } }), false);
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ ...shared, mediaModeByChannel: { threads: "images" } }), true);
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ ...shared, mediaModeByChannel: { threads: "video" } }), true);
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ imagesByChannel: { threads: ["thread-image"] } }), true);
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ videoByChannel: { threads: { url: "video" } } }), true);
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ mediaType: "video", video: { url: "video" }, imagesByChannel: { threads: [] } }), true);
  assert.equal(preferences.hasSelectedThreadsPublicationMedia({ images: ["only-ig"], imagesByChannel: { threads: [] } }), false);
});

function load<T>(relative: string, modules: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`); return modules[name];
  });
  return exports as T;
}

test("Server preflight rechecks the selected account and fails closed on unavailable or disabled preferences", async () => {
  for (const fixture of [
    { error: null, prefs: { ghostEnabled: true, defaultMode: "ghost" }, expected: null },
    { error: null, prefs: { ghostEnabled: false, defaultMode: "classic" }, expected: "threads_publication_mode_disabled" },
    { error: { code: "DB_ERROR" }, prefs: null, expected: "threads_publication_preferences_unavailable" },
  ]) {
    const calls: unknown[] = [];
    const query = { select: () => query, eq: (key: string, value: string) => { calls.push([key, value]); return query; }, maybeSingle: async () => ({ data: { settings: { threads: { publicationPreferences: fixture.prefs } } }, error: fixture.error }) };
    const server = load<typeof import("../../lib/threadsPublicationPreferencesServer.ts")>("lib/threadsPublicationPreferencesServer.ts", { "server-only": {}, "./threadsPublicationPreferences": preferences });
    const supabase = { from: (table: string) => { assert.equal(table, "pro_tools_configs"); return query; } };
    const result = await server.getThreadsPublicationPreflightFailure({ supabase, accountId: "active-account", mode: "ghost", hasMedia: false });
    assert.equal(result?.code ?? null, fixture.expected);
    assert.deepEqual(calls, [["user_id", "active-account"]]);
  }
});

function routeRuntime(options: { deniedAuth?: boolean; pilot?: boolean; connected?: boolean; prefsError?: boolean; rpcError?: string } = {}) {
  const reads: Array<[string, string]> = [], saves: unknown[] = [];
  const query = (table: string) => {
    const eqs: unknown[] = [];
    const row = { select: (columns: string) => { reads.push([table, columns]); return row; }, eq: (column: string, value: unknown) => { eqs.push([column, value]); return row; }, maybeSingle: async () => {
      assert.ok(eqs.some((entry) => JSON.stringify(entry) === JSON.stringify(["user_id", "active-account"])));
      if (table === "integrations") {
        for (const column of ["provider", "source", "product"]) assert.ok(eqs.some((entry) => JSON.stringify(entry) === JSON.stringify([column, "threads"])));
        return { data: { status: options.connected === false ? "disconnected" : "connected", resource_id: "123" }, error: null };
      }
      return { data: { settings: { threads: { publicationPreferences: { ghostEnabled: true, defaultMode: "ghost" } }, instagram: { unchanged: true } } }, error: options.prefsError ? { code: "DB_ERROR" } : null };
    } };
    return row;
  };
  const database = { from: query, rpc: async (name: string, params: unknown) => { saves.push([name, params]); return { data: (params as { p_preferences: unknown }).p_preferences, error: options.rpcError ? { code: options.rpcError } : null }; } };
  const route = load<{ GET: () => Promise<Response>; PATCH: (req: Request) => Promise<Response> }>("app/api/integrations/threads/publication-preferences/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ ok: false, error: "sanitized" }, { status: 500 }) },
    "@/lib/threadsPublicationPreferences": preferences,
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async (received: unknown, accountId: string) => { assert.equal(received, database); assert.equal(accountId, "active-account"); return options.pilot !== false; }, metaChannelPilotDeniedResponse: () => Response.json({ code: "meta_channel_admin_pilot" }, { status: 403 }) },
    "@/lib/metaChannelRollout": { META_DIRECT_CHANNELS_PUBLIC_ENABLED: false },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/requireUser": { requireUser: async () => options.deniedAuth ? { errorResponse: Response.json({ error: "login" }, { status: 401 }) } : { supabase: database, activeUserId: "active-account", user: { id: "actor" } } },
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
  });
  return { route, reads, saves };
}
const patchRequest = (body: unknown) => new Request("https://fixture.test/api/integrations/threads/publication-preferences", { method: "PATCH", body: JSON.stringify(body) });

test("Threads preference API requires actor/account pilot access and a canonical connected integration", async () => {
  for (const [options, expected] of [[{ deniedAuth: true }, 401], [{ pilot: false }, 403], [{ connected: false }, 409]] as const) {
    const fixture = routeRuntime(options);
    for (const run of [() => fixture.route.GET(), () => fixture.route.PATCH(patchRequest({ ghostEnabled: true, defaultMode: "ghost" }))]) {
      const response = await run(); assert.equal(response.status, expected); assert.match(response.headers.get("cache-control") || "", /no-store/);
    }
    assert.equal(fixture.saves.length, 0);
    assert.equal(fixture.reads.some((entry) => entry[0] === "pro_tools_configs"), false);
  }
});

test("Threads preferences API loads only public settings and sends normalized full preferences to the atomic admin RPC", async () => {
  const fixture = routeRuntime();
  const response = await fixture.route.GET();
  assert.deepEqual(await response.json(), { ok: true, preferences: { version: 1, ghostEnabled: true, defaultMode: "ghost" } });
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const patched = await fixture.route.PATCH(patchRequest({ ghostEnabled: false, defaultMode: "ghost" }));
  assert.equal(patched.status, 200);
  assert.deepEqual(fixture.saves, [["inrcy_set_threads_publication_preferences", { p_account_id: "active-account", p_admin_pilot: true, p_preferences: { version: 1, ghostEnabled: false, defaultMode: "classic" } }]]);
  assert.equal(fixture.reads.some((entry) => /token|meta/i.test(entry[1])), false);
});

test("Preference PATCH has no read-modify-write fallback when its safe migration is missing or fails", async () => {
  for (const [rpcError, expected] of [["PGRST202", 503], ["42501", 500]] as const) {
    const fixture = routeRuntime({ rpcError });
    const response = await fixture.route.PATCH(patchRequest({ ghostEnabled: true, defaultMode: "classic" }));
    assert.equal(response.status, expected); assert.equal(fixture.saves.length, 1);
    assert.equal(fixture.reads.some((entry) => entry[0] === "pro_tools_configs"), false);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
  }
  const fixture = routeRuntime();
  assert.equal((await fixture.route.PATCH(patchRequest({ ghostEnabled: "false", defaultMode: "ghost" }))).status, 400);
  assert.equal(fixture.saves.length, 0);
});

test("Durable Booster ingress persists Ghost and effective media choices rather than reapplying account defaults", async () => {
  const rows: Array<{ payload: { finalPayloadBase?: { threadsPublicationSettings?: unknown } } }> = [];
  const database = { from: (table: string) => ({ insert: async (saved: typeof rows) => { assert.equal(table, "app_events"); rows.push(...saved); return { error: null }; } }) };
  const ingress = load<typeof import("../../lib/boosterPublicationIngress.ts")>("lib/boosterPublicationIngress.ts", {
    "server-only": {}, "node:crypto": { randomUUID: () => String(rows.length) + "-fixture-uuid" },
    "@/lib/executionIdempotency": { acquireExecutionIdempotencyLock: async () => ({ state: "acquired", lock: { id: "lock", metadata: { publicationId: "parent" } } }) },
    "@/lib/boosterPublicationPolicy": { BOOSTER_PUBLICATION_CHANNEL_LABELS: { threads: "Threads", instagram: "Instagram" } },
    "@/lib/boosterAsyncPublication": { BOOSTER_ASYNC_CHANNEL_EVENT_TYPE: "channel", BOOSTER_ASYNC_JOB_EVENT_TYPE: "parent" },
    "@/lib/metaPublicationTargets": { buildBoosterPublicationTargets: ({ channels }: { channels: string[] }) => channels.map((channel: string) => ({ channel, key: channel, placement: "classic" })), stripMetaStoryOnlyPostContent: (value: unknown) => value },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
  });
  const result = await ingress.enqueueBoosterPublication({ userId: "account", channels: ["threads", "instagram"], body: {
    threadsPublicationSettings: { mode: "ghost" }, mediaModeByChannel: { threads: "none", instagram: "images" }, imagesByChannel: { instagram: ["photo"] }, imageSettingsByChannel: { threads: { imageKeys: ["saved-photo"] } },
  }, module: "booster", finalEventType: "publish", workspacePurpose: "publish", idempotencyScope: "publish", idempotencyKey: "unique", idempotencyTtlMs: 1000, idempotencyMetadata: {} });
  assert.equal(result.state, "accepted");
  if (result.state !== "accepted") throw new Error("Expected accepted job");
  assert.deepEqual(result.preparationRequest.threadsPublicationSettings, { mode: "ghost" });
  assert.deepEqual(rows[0].payload.finalPayloadBase?.threadsPublicationSettings, { mode: "ghost" });
  assert.deepEqual(result.preparationRequest.mediaModeByChannel, { threads: "none", instagram: "images" });
  assert.deepEqual((result.preparationRequest.imageSettingsByChannel as Record<string, { imageKeys: string[] }>).threads.imageKeys, ["saved-photo"]);
  assert.equal(rows.length, 3);
});

test("An older job stays Classic when an account later changes its default to Ghost", async () => {
  const currentPrefs = preferences.normalizeThreadsPublicationPreferences({ ghostEnabled: true, defaultMode: "ghost" });
  assert.equal(currentPrefs.defaultMode, "ghost");
  const legacySettings = preferences.parseThreadsPublicationSettings(undefined);
  assert.equal(legacySettings.mode, "classic");
  const server = load<typeof import("../../lib/threadsPublicationPreferencesServer.ts")>("lib/threadsPublicationPreferencesServer.ts", { "server-only": {}, "./threadsPublicationPreferences": preferences });
  const result = await server.getThreadsPublicationPreflightFailure({
    supabase: { from: () => { throw new Error("A Classic job does not need to reinterpret its selected mode from new defaults"); } },
    accountId: "same-account", mode: legacySettings.mode, hasMedia: false,
  });
  assert.equal(result, null);
});
