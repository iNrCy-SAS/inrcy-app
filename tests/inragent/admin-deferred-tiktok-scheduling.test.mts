import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";
import { userFacingErrorsFixture } from "../helpers/user-facing-errors-fixture.mts";
import { filterInrAgentPublicationChannels, hasConfirmedInrAgentTiktokReview, selectedInrAgentPublicationChannels, unvalidatedInrAgentPublicationChannels } from "../../lib/inrAgentPublicationChannelSelection.ts";

// Heterogeneous PostgREST rows intentionally include malformed boundary fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const ACTION = "33333333-3333-4333-8333-333333333333";
const OPT_IN = { version: 1, id: "44444444-4444-4444-8444-444444444444", enabledAt: "2026-11-14T00:00:00.000Z" };
const MARKER = { version: 1, optInId: OPT_IN.id, accountId: ACCOUNT, preparedAt: "2026-11-14T00:01:00.000Z" };
const FUTURE = "2099-06-04T16:00:00.000Z";
function fixture(paidAccount = false) {
  const payload = { channels: ["facebook", "tiktok"], selectedChannels: ["facebook", "tiktok"], adminAutomaticPublish: structuredClone(MARKER),
    editorialPlan: { state: "ready", timezone: "Europe/Paris", scheduledFor: FUTURE },
    postByChannel: { facebook: { content: "Caption Facebook" }, tiktok: { content: "Caption TikTok" } },
    imagesByChannel: { facebook: [{ id: "paid-square" }], tiktok: [{ id: "paid-portrait" }] },
    videoByChannel: { tiktok: { id: "paid-video" } }, mediaModeByChannel: { facebook: "images", tiktok: "images" } };
  const tables: Record<string, Row[]> = {
    profiles: [{ user_id: ACCOUNT, role: "admin" }],
    inr_agent_settings: [{ user_id: ACCOUNT, global_enabled: true }],
    inr_agent_automation_settings: [{ user_id: ACCOUNT, automation_key: "publish", enabled: true, validation_mode: "admin_automatic_publish",
      metadata: { adminPublishOptIn: structuredClone(OPT_IN), manualReviewChannels: ["tiktok"] } }],
    inr_agent_actions: [{ id: ACTION, user_id: ACCOUNT, automation_key: "publish", action_type: "publication", target_tool: "booster", title: "Prepared once",
      status: "prepared", validation_required: false, execution_policy: "automatic_after_settings", validated_at: null, scheduled_for: FUTURE,
      image_assets: [{ id: "paid-original" }], payload, metadata: { adminAutomaticPublish: structuredClone(MARKER), editorialPlan: true },
      target_channels: ["facebook", "tiktok"], updated_at: "2026-11-14T00:02:00.000Z" }],
    inr_agent_scheduled_actions: [],
  };
  const writes: Array<{ table: string; patch: Row; matched: number }> = [];
  let beforeActionUpdate: (() => void) | null = null;
  const contains = (actual: Row[string], expected: Row[string]): boolean => expected && typeof expected === "object"
    ? actual != null && Object.entries(expected).every(([key, value]) => contains(actual[key], value)) : actual === expected;
  const client = { async rpc(name: string, args: Row) {
    assert.equal(name, "inrcy_inr_agent_publication_plan_rights");
    assert.deepEqual(args, { p_user_id: ACCOUNT });
    return { data: [{ can_use_high_frequency: false, can_publish_without_validation: paidAccount }], error: null };
  }, from(table: string) {
    let patch: Row | null = null, inserted: Row[] | null = null;
    const filters: Array<(row: Row) => boolean> = [];
    const valueAt = (row: Row, key: string): Row[string] => key.split(/->>?/).reduce((value, part) => value?.[part], row);
    const run = (single = false) => {
      if (patch && table === "inr_agent_actions" && beforeActionUpdate) { const callback = beforeActionUpdate; beforeActionUpdate = null; callback(); }
      if (inserted) {
        for (const row of inserted) { assert.equal(row.user_id, ACCOUNT); assert.ok(!tables[table].some(saved => saved.id === row.id), "no duplicate durable job"); tables[table].push(structuredClone(row)); }
        writes.push({ table, patch: { inserted }, matched: inserted.length });
        return { data: structuredClone(single ? inserted[0] : inserted), error: null };
      }
      const rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
      if (patch) { writes.push({ table, patch, matched: rows.length }); for (const row of rows) Object.assign(row, structuredClone(patch)); }
      return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
    };
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(key: string, value: unknown) { filters.push(row => valueAt(row, key) === value); return this; },
      is(key: string, value: unknown) { filters.push(row => (valueAt(row, key) ?? null) === value); return this; },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(valueAt(row, key))); return this; },
      contains(key: string, value: unknown) { filters.push(row => contains(row[key], value)); return this; },
      update(value: Row) { patch = value; return this; }, insert(value: Row | Row[]) { inserted = Array.isArray(value) ? value : [value]; return this; },
      upsert(value: Row | Row[]) { return this.insert(value); },
      async maybeSingle() { return run(true); }, async single() { return run(true); },
      then(resolve: (value: ReturnType<typeof run>) => unknown) { return Promise.resolve(run()).then(resolve); },
    };
    return query;
  } };
  return { client, tables, writes, race(callback: () => void) { beforeActionUpdate = callback; },
    action: () => tables.inr_agent_actions[0], automation: () => tables.inr_agent_automation_settings[0] };
}

function harness(db: ReturnType<typeof fixture>) {
  let isCron = true;
  let body: Row = { actionId: ACTION, executionSource: "automatic" };
  let built = 0;
  const load = runtimeModules({
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) }, after() {} },
    "@/lib/supabaseAdmin": { supabaseAdmin: db.client }, "@/lib/supabaseServer": {},
    "@/lib/inrAgentRequest": { resolveInrAgentActionRequest: async () => ({ userId: ACCOUNT, authUserId: ACCOUNT, isCron, body }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => "premium" },
    "@/lib/metaChannelRolloutServer": {},
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
    "@/lib/observability/sentry": { captureApiException: (_request: Request, error: unknown) => { throw error; } },
    "@/lib/cronAuth": { buildInternalCronHeaders: () => ({ "Content-Type": "application/json" }) },
    "@/lib/notificationWriter": {}, "@/lib/inrAgentValidationEmailDelivery": {},
    "@/lib/boosterGenerationContext": {}, "@/lib/inrAgentPublicationIdeaLifecycle": {},
    "@/lib/scheduledPublicationDedupe": { findSimilarScheduledPublication: async () => ({ duplicate: false }) }, "@/lib/scheduledCampaignDedupe": {},
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback,
      getLocalizedErrorMessage: userFacingErrorsFixture.getLocalizedErrorMessage },
    "@/app/api/booster/publish-now/publishNow.foundations": { normalizeTiktokPublicationSettings: (value: unknown) => {
      const settings = value as Row | undefined;
      return settings?.privacyLevel && settings.commercialContent ? settings : null;
    } },
    "@/lib/inrAgentSchedulePayloadBuilder": { buildScheduledPayload: async (action: Row) => {
      built++;
      const channels = filterInrAgentPublicationChannels(action.payload, action.targetChannels as string[]);
      return { actionType: "publication", targetTool: "booster", channels,
        payload: { kind: "manual_publish_schedule", sourceActionId: ACTION, publicationChannelSelection: action.payload.publicationChannelSelection,
          retainedPublicationPayload: action.payload, publishPayload: { ...action.payload, source: "inr_agent", channels } } };
    } },
    "@/lib/inrAgentScheduledMediaSnapshot": { snapshotAgentScheduledPublicationRows: async ({ rows }: { rows: Row[] }) => ({ rows, createdWorkspaceIds: [] }) },
  });
  const route = load<typeof import("../../app/api/agent/actions/schedule/route.ts")>("app/api/agent/actions/schedule/route.ts");
  const server = load<typeof import("../../lib/inrAgentEditorialPlanServer.ts")>("lib/inrAgentEditorialPlanServer.ts");
  const schedule = () => route.POST(new Request("http://isolated.test/api/agent/actions/schedule", { method: "POST" }));
  return { schedule, server, built: () => built, request(value: Row, cron = true) { body = value; isCron = cron; } };
}
function deferred(db: ReturnType<typeof fixture>) {
  db.action().payload.publicationChannelSelection = { version: 1, availableChannels: ["facebook", "tiktok"], excludedChannels: [], unvalidatedChannels: ["tiktok"] };
}

async function worker(db: ReturnType<typeof fixture>, h: ReturnType<typeof harness>, response?: () => Promise<Response>) {
  const fetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(String(url), "http://isolated.test/api/agent/actions/schedule");
    assert.deepEqual(JSON.parse(String(init?.body)), { cronUserId: ACCOUNT, actionId: ACTION, executionSource: "automatic" });
    return response ? response() : h.schedule();
  };
  try { const result = await h.server.scheduleReadyInrAgentAdminPublications({ supabase: db.client, userId: ACCOUNT, origin: "http://isolated.test" }); return { result, calls }; }
  finally { globalThis.fetch = fetch; }
}

test("an opted-in Standard account keeps TikTok checked for separate review, preserves all paid media and creates one job for the others", async () => {
  const db = fixture(true), h = harness(db), initial = structuredClone(db.action());
  db.tables.profiles[0].role = "user";
  const first = await worker(db, h);
  assert.equal(first.calls, 1); assert.equal(first.result[0]?.status, "scheduled");
  assert.deepEqual(unvalidatedInrAgentPublicationChannels(db.action().payload), ["tiktok"]);
  assert.deepEqual(selectedInrAgentPublicationChannels(db.action().payload, initial.target_channels), ["facebook", "tiktok"]);
  assert.deepEqual(db.action().payload.postByChannel, initial.payload.postByChannel);
  assert.deepEqual(db.action().payload.imagesByChannel, initial.payload.imagesByChannel);
  assert.deepEqual(db.action().payload.videoByChannel, initial.payload.videoByChannel);
  assert.deepEqual(db.action().image_assets, initial.image_assets);
  assert.deepEqual(db.action().payload.adminAutomaticPublish, MARKER); assert.deepEqual(db.action().metadata.adminAutomaticPublish, MARKER);
  assert.equal(db.action().payload.tiktokPublicationSettings, undefined, "never manufacture privacy or music consent");
  assert.equal(db.action().validation_required, false); assert.equal(db.action().validated_at, null);
  assert.equal(db.tables.inr_agent_scheduled_actions.length, 1);
  assert.deepEqual(db.tables.inr_agent_scheduled_actions[0].channels, ["facebook"]);
  assert.equal(db.tables.inr_agent_scheduled_actions[0].scheduled_at, FUTURE);
  assert.deepEqual(db.tables.inr_agent_scheduled_actions[0].payload.retainedPublicationPayload.imagesByChannel, initial.payload.imagesByChannel);
  const replay = await worker(db, h); assert.equal(replay.calls, 0); assert.equal(db.tables.inr_agent_scheduled_actions.length, 1); assert.equal(h.built(), 1);
});

test("transient scheduling retry reuses deferred content without another edit or fabricated consent", async () => {
  const db = fixture(), h = harness(db), initial = structuredClone(db.action());
  await worker(db, h, async () => Response.json({ error: "retry later" }, { status: 503 }));
  const writes = db.writes.length, prepared = structuredClone(db.action());
  assert.equal(prepared.status, "prepared"); assert.deepEqual(prepared.image_assets, initial.image_assets);
  await worker(db, h, async () => Response.json({ error: "retry later" }, { status: 503 }));
  assert.deepEqual(db.action(), prepared); assert.equal(db.writes.length, writes);
  assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
});

test("a TikTok settings refusal is visible and retries the paid publication without generating content again", async () => {
  const db = fixture(); delete db.automation().metadata.manualReviewChannels;
  const h = harness(db), original = structuredClone(db.action());
  const refused = await worker(db, h);
  assert.equal(refused.result[0]?.status, "retry");
  assert.equal(refused.result[0]?.errorCode, "INR_AGENT_TIKTOK_SETTINGS_REQUIRED");
  assert.equal(db.action().last_error, "TikTok attend la validation de ses paramètres avant programmation.");
  assert.deepEqual(db.action(), { ...original, last_error: db.action().last_error, updated_at: db.action().updated_at });
  assert.equal(db.action().status, "prepared");
  assert.deepEqual(db.action().payload, original.payload);
  assert.deepEqual(db.action().metadata, original.metadata);
  assert.deepEqual(db.action().image_assets, original.image_assets);
  assert.equal(db.action().payload.tiktokPublicationSettings, undefined);
  assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
  // Only a professional's explicit settings satisfy the existing route guard.
  db.action().payload.tiktokPublicationSettings = { privacyLevel: "PUBLIC_TO_EVERYONE", commercialContent: "personal", musicUsageConfirmed: true };
  db.action().updated_at = new Date().toISOString();
  const resumed = await worker(db, h);
  assert.equal(resumed.result[0]?.status, "scheduled");
  assert.equal(db.tables.inr_agent_scheduled_actions.length, 1);
  assert.deepEqual(db.tables.inr_agent_scheduled_actions[0].channels, ["facebook", "tiktok"]);
  assert.equal(db.action().last_error, null);
  assert.deepEqual(db.action().image_assets, original.image_assets);
});

test("HTTP 403 and network failures preserve ready content and a public scheduling cause", async () => {
  for (const scenario of ["forbidden", "network", "private-diagnostic"] as const) {
    const db = fixture(), h = harness(db), original = structuredClone(db.action());
    await worker(db, h, async () => {
      if (scenario === "network") throw new TypeError("fetch failed");
      if (scenario === "private-diagnostic") return Response.json({ error: "Authorization: Bearer private-token https://private.test/file" }, { status: 400 });
      return Response.json({ error: "internal admin check", code: "INR_AGENT_ADMIN_AUTOMATIC_PUBLISH_FORBIDDEN" }, { status: 403 });
    });
    assert.equal(db.action().status, "prepared");
    assert.ok(db.action().last_error);
    assert.doesNotMatch(db.action().last_error, /private-token|https:|Bearer|internal admin/i);
    if (scenario === "forbidden") assert.equal(db.action().last_error, "Cette publication attend une validation manuelle.");
    assert.deepEqual(db.action().image_assets, original.image_assets);
    assert.deepEqual(db.action().metadata, original.metadata);
    assert.equal(db.action().payload.tiktokPublicationSettings, undefined);
    assert.deepEqual(unvalidatedInrAgentPublicationChannels(db.action().payload), ["tiktok"]);
    assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
  }
});

for (const changed of ["updated_at", "status", "execution_policy", "validation_required", "user_id"] as const) {
  test(`a late scheduling refusal cannot overwrite concurrent ${changed}`, async () => {
    const db = fixture(); delete db.automation().metadata.manualReviewChannels;
    const h = harness(db);
    const initialError = db.action().last_error;
    const value = changed === "updated_at" ? "2099-06-04T01:00:00.000Z" : changed === "status" ? "scheduled"
      : changed === "execution_policy" ? "manual_validation" : changed === "validation_required" ? true : "22222222-2222-4222-8222-222222222222";
    await worker(db, h, async () => {
      db.action()[changed] = value;
      db.action().payload.postByChannel.facebook.content = "Concurrent professional edit";
      return Response.json({ error: "old failure", code: "INR_AGENT_TIKTOK_SETTINGS_REQUIRED" }, { status: 400 });
    });
    assert.equal(db.action()[changed], value);
    assert.equal(db.action().last_error, initialError);
    assert.equal(db.action().payload.postByChannel.facebook.content, "Concurrent professional edit");
    assert.equal(db.writes.filter(write => write.table === "inr_agent_actions" && write.matched > 0).length, 0);
  });
}

test("TikTok alone stays visibly unvalidated and never creates an empty automatic job", async () => {
  const db = fixture(); db.action().target_channels = ["tiktok"]; db.action().payload.channels = ["tiktok"]; db.action().payload.selectedChannels = ["tiktok"];
  const h = harness(db); await worker(db, h);
  assert.deepEqual(unvalidatedInrAgentPublicationChannels(db.action().payload), ["tiktok"]);
  assert.notEqual(db.action().status, "scheduled"); assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
  assert.equal(db.action().payload.tiktokPublicationSettings, undefined);
});

test("a simultaneous professional edit defeats the deferred CAS and is never overwritten or scheduled", async () => {
  const db = fixture(), h = harness(db);
  db.race(() => { db.action().updated_at = "2026-11-14T00:03:00.000Z"; db.action().payload.postByChannel.tiktok.content = "Professionally revised caption"; });
  const result = await worker(db, h);
  assert.equal(result.calls, 0); assert.equal(db.action().payload.postByChannel.tiktok.content, "Professionally revised caption");
  assert.equal(db.tables.inr_agent_scheduled_actions.length, 0); assert.equal(db.action().payload.publicationChannelSelection, undefined);
});

for (const scenario of ["missing-setting", "other-setting", "pending-tiktok", "other-unvalidated", "ordinary-account", "revoked-global", "renewed-opt-in", "browser-auto", "manual-request"] as const) {
  test(`only fresh admin opt-in permits deferred TikTok: ${scenario}`, async () => {
    const db = fixture(); deferred(db); const h = harness(db);
    if (scenario === "missing-setting") { delete db.automation().metadata.manualReviewChannels; h.request({ actionId: ACTION, executionSource: "automatic", manualReviewChannels: ["tiktok"] }); }
    if (scenario === "other-setting") db.automation().metadata.manualReviewChannels = ["instagram"];
    if (scenario === "pending-tiktok") db.action().payload.publicationChannelSelection.pendingChannels = ["tiktok"];
    if (scenario === "other-unvalidated") db.action().payload.publicationChannelSelection.unvalidatedChannels.push("instagram");
    if (scenario === "ordinary-account") db.tables.profiles[0].role = "user";
    if (scenario === "revoked-global") db.tables.inr_agent_settings[0].global_enabled = false;
    if (scenario === "renewed-opt-in") db.automation().metadata.adminPublishOptIn.id = "55555555-5555-4555-8555-555555555555";
    if (scenario === "browser-auto") h.request({ actionId: ACTION, executionSource: "automatic" }, false);
    if (scenario === "manual-request") h.request({ actionId: ACTION, scheduledAt: FUTURE }, false);
    const response = await h.schedule(); assert.ok([403, 409].includes(response.status), JSON.stringify(await response.clone().json()));
    assert.equal(h.built(), 0); assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
    assert.equal(db.action().payload.tiktokPublicationSettings, undefined);
  });
}

test("default accounts retain their original payload and TikTok consent gate", async () => {
  const db = fixture(); delete db.automation().metadata.manualReviewChannels;
  const h = harness(db), initial = structuredClone(db.action());
  const result = await worker(db, h);
  assert.equal(result.calls, 1); assert.equal(result.result[0]?.status, "retry");
  assert.deepEqual(db.action().payload, initial.payload); assert.deepEqual(db.action().metadata, initial.metadata);
  assert.deepEqual(db.action().image_assets, initial.image_assets); assert.equal(db.action().status, "prepared");
  assert.equal(db.action().last_error, "TikTok attend la validation de ses paramètres avant programmation.");
  assert.deepEqual(db.action(), { ...initial, last_error: db.action().last_error, updated_at: db.action().updated_at });
  assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
});



test("revoking separate TikTok review between preparation and schedule fails closed on the fresh configuration", async () => {
  const db = fixture(), h = harness(db);
  const result = await worker(db, h, async () => {
    delete db.automation().metadata.manualReviewChannels;
    const response = await h.schedule(); assert.equal(response.status, 409);
    assert.equal((await response.clone().json()).code, "INR_AGENT_CHANNEL_REVIEW_REQUIRED");
    return response;
  });
  assert.equal(result.result[0]?.status, "retry"); assert.equal(h.built(), 0);
  assert.deepEqual(unvalidatedInrAgentPublicationChannels(db.action().payload), ["tiktok"]);
  assert.equal(db.action().status, "prepared"); assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
});

test("TikTok-only retries keep a clear manual review state without continually rewriting the action", async () => {
  const db = fixture(); db.action().target_channels = ["tiktok"]; db.action().payload.channels = ["tiktok"]; db.action().payload.selectedChannels = ["tiktok"];
  const h = harness(db); const initial = await worker(db, h);
  assert.equal(initial.calls, 0); assert.equal(initial.result[0]?.status, "manual_review");
  assert.match(db.action().last_error, /TikTok.*validation/);
  const prepared = structuredClone(db.action()), writes = db.writes.length;
  const retry = await worker(db, h); assert.equal(retry.calls, 0); assert.equal(retry.result[0]?.status, "manual_review");
  assert.deepEqual(db.action(), prepared); assert.equal(db.writes.length, writes); assert.equal(h.built(), 0);
});

test("the channel API binds explicit TikTok confirmation to the action edited, and strips client-supplied proof", async () => {
  let stored: Row | null = null;
  const load = runtimeModules({
    "next/server": { NextResponse: { json: Response.json.bind(Response) } },
    "@/lib/inrAgentActions": {}, "@/lib/inrAgentScheduledActions": {},
    "@/lib/supabaseAdmin": { supabaseAdmin: { rpc: async (_name: string, request: Row) => {
      stored = request.p_tiktok_settings;
      return { data: { outcome: "saved" }, error: null };
    } } },
  });
  const { saveAgentPublicationChannels } = load<typeof import("../../lib/inrAgentPublicationChannelSelectionServer.ts")>("lib/inrAgentPublicationChannelSelectionServer.ts");
  const options = { userId: ACCOUNT, actionId: ACTION, channels: ["tiktok"], expectedUpdatedAt: FUTURE,
    tiktokPublicationSettings: { privacyLevel: "SELF_ONLY", commercialContent: "none", musicUsageConfirmed: true, inrAgentReviewActionId: "another-action" } };
  const saved = async (changes: Partial<typeof options> & { confirmPending?: boolean }) => {
    const response = await saveAgentPublicationChannels({ ...options, ...changes });
    assert.equal(response.status, 200);
    return stored as Row | null;
  };
  assert.equal((await saved({ confirmPending: true }))?.inrAgentReviewActionId, ACTION);
  assert.equal((await saved({ confirmPending: false }))?.inrAgentReviewActionId, undefined);
  assert.equal((await saved({ confirmPending: true, tiktokPublicationSettings: { ...options.tiktokPublicationSettings, musicUsageConfirmed: false } }))?.inrAgentReviewActionId, undefined);
});

for (const previouslyHeld of [false, true]) {
  test(`TikTok-only confirmation releases a prepared publication with ${previouslyHeld ? "a previous channel hold" : "only its historical error"}`, async () => {
    const db = fixture(), action = db.action(), h = harness(db);
    action.target_channels = ["tiktok"]; action.payload.channels = ["tiktok"]; action.payload.selectedChannels = ["tiktok"];
    action.last_error = "TikTok attend la validation de ses paramètres avant programmation.";
    if (previouslyHeld) {
      const held = await worker(db, h);
      assert.equal(held.calls, 0); assert.deepEqual(unvalidatedInrAgentPublicationChannels(action.payload), ["tiktok"]);
    }
    // The RPC writes both values together only on a successful content confirmation.
    action.payload.publicationChannelSelection = { version: 1, availableChannels: ["tiktok"], excludedChannels: [] };
    action.payload.tiktokPublicationSettings = { inrAgentReviewActionId: ACTION, privacyLevel: "SELF_ONLY", commercialContent: "none", musicUsageConfirmed: true };
    const before = structuredClone(action.payload);
    assert.equal(hasConfirmedInrAgentTiktokReview(action.payload, ACTION), true);
    assert.equal((await worker(db, h)).result[0]?.status, "scheduled");
    assert.equal(action.last_error, null);
    assert.deepEqual(action.payload.tiktokPublicationSettings, before.tiktokPublicationSettings);
    assert.deepEqual(action.payload.postByChannel, before.postByChannel);
    assert.deepEqual(db.tables.inr_agent_scheduled_actions.map(row => [row.channels, row.scheduled_at]), [[["tiktok"], FUTURE]]);
    assert.equal((await worker(db, h)).calls, 0);
  });
}

test("provider defaults, another action's consent and an active review never release TikTok", async () => {
  const confirmed = { inrAgentReviewActionId: ACTION, privacyLevel: "SELF_ONLY", commercialContent: "none", musicUsageConfirmed: true };
  for (const variant of ["defaults", "nested", "different-action", "still-held", "no-music", "no-privacy", "bad-disclosure"]) {
    const db = fixture(), action = db.action(), h = harness(db);
    action.target_channels = ["tiktok"]; action.payload.channels = ["tiktok"]; action.payload.selectedChannels = ["tiktok"];
    action.payload.publicationChannelSelection = { version: 1, availableChannels: ["tiktok"], excludedChannels: [] };
    action.payload.tiktokPublicationSettings = { ...confirmed };
    if (variant === "defaults") delete action.payload.tiktokPublicationSettings.inrAgentReviewActionId;
    if (variant === "nested") { delete action.payload.tiktokPublicationSettings; action.payload.publishPayload = { tiktokPublicationSettings: confirmed }; }
    if (variant === "different-action") action.payload.tiktokPublicationSettings.inrAgentReviewActionId = "another-action";
    if (variant === "still-held") action.payload.publicationChannelSelection.unvalidatedChannels = ["tiktok"];
    if (variant === "no-music") action.payload.tiktokPublicationSettings.musicUsageConfirmed = false;
    if (variant === "no-privacy") action.payload.tiktokPublicationSettings.privacyLevel = "";
    if (variant === "bad-disclosure") action.payload.tiktokPublicationSettings.commercialContent = "invalid";
    assert.equal(hasConfirmedInrAgentTiktokReview(action.payload, ACTION), false, variant);
    const result = await worker(db, h);
    assert.equal(result.calls, 0, variant); assert.equal(result.result[0]?.status, "manual_review", variant);
    assert.deepEqual(unvalidatedInrAgentPublicationChannels(action.payload), ["tiktok"], variant);
    assert.equal(db.tables.inr_agent_scheduled_actions.length, 0, variant);
  }
});

test("a professional TikTok exclusion stays excluded instead of being selected by the automatic reviewer", async () => {
  const db = fixture();
  db.action().payload.publicationChannelSelection = { version: 1, availableChannels: ["facebook", "tiktok"], excludedChannels: ["tiktok"] };
  const h = harness(db); await worker(db, h);
  assert.deepEqual(selectedInrAgentPublicationChannels(db.action().payload, ["facebook", "tiktok"]), ["facebook"]);
  assert.deepEqual(unvalidatedInrAgentPublicationChannels(db.action().payload), []);
  assert.deepEqual(db.tables.inr_agent_scheduled_actions[0].channels, ["facebook"]);
  assert.equal(db.action().payload.postByChannel.tiktok.content, "Caption TikTok");
});

for (const changed of ["status", "execution_policy", "validation_required"] as const) {
  test(`deferred CAS cannot overwrite a concurrent ${changed} change even when updated_at is unchanged`, async () => {
    const db = fixture(), h = harness(db);
    const value = changed === "status" ? "executing" : changed === "execution_policy" ? "manual_validation" : true;
    db.race(() => { db.action()[changed] = value; });
    const result = await worker(db, h);
    assert.equal(result.calls, 0); assert.equal(result.result[0]?.status, "retry");
    assert.equal(db.action()[changed], value); assert.equal(db.action().payload.publicationChannelSelection, undefined);
    assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
  });
}

for (const pending of ["tiktok", "facebook"] as const) {
  test(`the real worker retains an existing pending ${pending} channel and the route blocks every automatic dispatch`, async () => {
    const db = fixture();
    db.action().payload.publicationChannelSelection = {
      version: 1, availableChannels: ["facebook", "tiktok"], excludedChannels: [], pendingChannels: [pending],
    };
    const initial = structuredClone(db.action()), h = harness(db);
    const result = await worker(db, h, async () => {
      const response = await h.schedule();
      assert.equal(response.status, 409);
      assert.equal((await response.clone().json()).code, "INR_AGENT_CHANNEL_REVIEW_REQUIRED");
      return response;
    });
    assert.equal(result.calls, 1); assert.equal(result.result[0]?.status, "retry");
    assert.deepEqual(db.action().payload, initial.payload, "pending state, media and provenance stay untouched");
    assert.deepEqual(db.action().metadata, initial.metadata);
    assert.deepEqual(db.action().image_assets, initial.image_assets);
    assert.equal(db.action().last_error, "Un canal sélectionné est vide ou attend sa validation.");
    assert.deepEqual(db.action(), { ...initial, last_error: db.action().last_error, updated_at: db.action().updated_at });
    assert.equal(db.writes.length, 1); assert.equal(h.built(), 0);
    assert.equal(db.tables.inr_agent_scheduled_actions.length, 0);
  });
}
