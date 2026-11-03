import assert from "node:assert/strict";
import test from "node:test";
import { isApiRouteAllowedForEdition, isDashboardDestinationAllowedForEdition } from "../../lib/dashboardEdition.ts";
import { isManualBoosterPublicationSchedule } from "../../lib/standardAgentPolicy.ts";
import { runtimeModules } from "./runtime-module-loader.mts";

type Row = Record<string, unknown>;
const accountId = "account-a";
const revision = "2026-11-04T09:00:00.000Z";
const scheduledAt = "2099-11-05T14:00:00.000Z";
const mediaRevisionRules = runtimeModules({ "@/lib/supabaseAdmin": { supabaseAdmin: {} } })<typeof import("../../lib/scheduledPublicationMediaRevision.ts")>("lib/scheduledPublicationMediaRevision.ts");
function manual(patch: Row = {}): Row {
  return { id: "manual", user_id: accountId, automation_key: "publish", action_type: "publication", target_tool: "booster", source: "manual",
    status: "scheduled", attempt_count: 0, executed_at: null, scheduled_at: scheduledAt, updated_at: revision, title: "Publication manuelle", channels: ["facebook"],
    payload: { kind: "manual_publish_schedule", publishPayload: { source: "booster_scheduled", channels: ["facebook"], postByChannel: { facebook: { content: "Texte initial" } }, mediaModeByChannel: { facebook: "none" } } }, ...patch };
}

function harness(initialRows: Row[], edition = "basic", conflict = false) {
  const rows = structuredClone(initialRows);
  const queries: Array<{ operation: string; filters: Row; patch: Row }> = [];
  const published: Row[] = [];
  const revisions: Array<{ accountId: string; payload: unknown; channels: string[] }> = [];
  let discardedRevisions = 0;
  const load = runtimeModules({
    "next/server": { NextResponse: Response },
    "@/lib/requireUser": { requireUser: async () => ({ authUserId: "actor-distinct-from-account", activeUserId: accountId, errorResponse: null }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async (id: string) => { assert.equal(id, "actor-distinct-from-account"); return edition; }, premiumRequiredApiResponse: () => Response.json({ error: "premium_required" }, { status: 403 }) },
    "@/lib/inrAgentActions": { INR_AGENT_ACTION_TYPES: ["publication", "campaign", "custom"], INR_AGENT_TARGET_TOOLS: ["booster", "mails", "agent"] },
    "@/lib/inrAgentPublicationChannelSelectionServer": { saveAgentPublicationChannels: () => { throw new Error("agent_selection_must_remain_unreachable_in_basic"); } },
    "@/lib/inrAssistantActionPreview": { scheduledPublicationFingerprint: () => "fingerprint" },
    "@/lib/inrAgentPublicationSoundtrack": { isInrAgentPublicationSoundtrackLocked: () => false, readInrAgentPublicationSoundtrack: () => ({}) },
    "@/lib/scheduledPublicationMediaRevision": { ...mediaRevisionRules, createScheduledPublicationMediaRevision: async (params: { payload: unknown; accountId: string; channels: string[] }) => {
      assert.equal(params.accountId, accountId); revisions.push(params);
      const payload = params.payload as Row;
      return { workspaceId: "revision-B", payload: { ...payload, scheduledMediaRevisionRequested: false, mediaWorkspaceId: "revision-B", publishPayload: { ...payload.publishPayload as Row, mediaWorkspaceId: "revision-B" } }, discard: async () => { discardedRevisions += 1; } };
    } },
    "@/lib/boosterSoundtracks": { normalizeBoosterSoundtrackId: () => "auto", normalizeBoosterSoundtrackByChannel: () => ({}) },
    "@/lib/inrAgentScheduledPayload": { compactInrAgentScheduledPayload: (value: unknown) => value, hasUnauthorizedScheduledStorageReference: () => false },
    "@/lib/storageContentUrl": { buildAbsoluteStorageContentUrl: () => "https://fixture.invalid/media" },
    "@/lib/scheduledPublicationDedupe": { findSimilarScheduledPublication: async (args: Row) => { assert.equal(args.userId, accountId); return { duplicate: false }; } },
    "@/lib/scheduledCampaignDedupe": { findSimilarScheduledCampaign: () => { throw new Error("campaign_must_remain_unreachable_in_basic"); } },
    "@/lib/scheduledPublicationMediaSnapshot": { getScheduledPublicationMediaWorkspaceId: () => "", snapshotScheduledPublicationWorkspace: () => { throw new Error("fixture_has_no_media"); } },
    "@/lib/mediaWorkspaceConsumption": { syncPublicationWorkspaceContext: async (params: { accountId: string; workspaceId: string }) => { assert.equal(params.accountId, accountId); assert.equal(params.workspaceId, "revision-B"); return true; } },
    "@/app/api/agent/actions/execute/route": { POST: () => { throw new Error("basic_must_never_execute_ai_action"); } },
    "@/app/api/booster/publish-now/route": { POST: async (request: Request) => { published.push(await request.json() as Row); return Response.json({ ok: true, publicationId: "publication-manual", status: "done", results: { facebook: { ok: true } } }); } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from(table: string) {
      assert.equal(table, "inr_agent_scheduled_actions");
      let operation = "read", patch: Row = {}, single = false;
      const filters: Row = {};
      const result = () => {
        queries.push({ operation, filters: { ...filters }, patch });
        if (operation !== "insert") assert.equal(filters.user_id, accountId, "every access is scoped to active account, never merely actor");
        else assert.equal(patch.user_id, accountId);
        const found = rows.filter(row => Object.entries(filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value));
        if (operation === "insert") { const row = { ...patch, id: patch.id || "new-manual", updated_at: revision, created_at: revision }; rows.push(row); return { data: row, error: null }; }
        if (operation === "update") {
          if (conflict) return { data: null, error: null };
          found.forEach(row => Object.assign(row, patch));
        }
        return { data: single ? found[0] || null : found, error: null };
      };
      const query = {
        select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; }, is(key: string, value: unknown) { filters[key] = value; return this; },
        in(key: string, value: unknown) { filters[key] = value; return this; }, gte() { return this; }, lte() { return this; }, gt() { return this; }, order() { return this; }, limit() { return this; }, range() { return this; },
        insert(value: Row) { operation = "insert"; patch = value; return this; }, update(value: Row) { operation = "update"; patch = value; return this; },
        async maybeSingle() { single = true; return result(); }, async single() { single = true; return result(); }, then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(resolve(result())); },
      };
      return query;
    } } },
  });
  return {
    rows, queries, published, revisions, get discardedRevisions() { return discardedRevisions; },
    collection: load<typeof import("../../app/api/agent/scheduled-actions/route.ts")>("app/api/agent/scheduled-actions/route.ts"),
    detail: load<typeof import("../../app/api/agent/scheduled-actions/[id]/route.ts")>("app/api/agent/scheduled-actions/[id]/route.ts"),
    execution: load<typeof import("../../app/api/agent/scheduled-actions/[id]/execute/route.ts")>("app/api/agent/scheduled-actions/[id]/execute/route.ts"),
  };
}
const context = (id = "manual") => ({ params: Promise.resolve({ id }) });
const request = (method = "GET", body?: unknown, suffix = "") => new Request(`https://fixture.invalid/api/agent/scheduled-actions${suffix}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

test("Basic allows only manual planning surfaces, while other editions preserve automation access", () => {
  for (const path of ["/dashboard/agent", "/dashboard/agent/publications"]) assert.equal(isDashboardDestinationAllowedForEdition(path, "basic"), true);
  for (const path of ["/dashboard/agent/publications/settings", "/dashboard/agent/campaigns", "/dashboard/agent/stats"]) assert.equal(isDashboardDestinationAllowedForEdition(path, "basic"), false);
  for (const path of ["/api/agent/scheduled-actions", "/api/agent/scheduled-actions/manual", "/api/agent/scheduled-actions/manual/execute"]) assert.equal(isApiRouteAllowedForEdition(path, undefined, "basic"), true);
  for (const path of ["/api/agent/settings", "/api/agent/actions", "/api/agent/actions/prepare", "/api/agent/actions/regenerate-channel"]) {
    assert.equal(isApiRouteAllowedForEdition(path, undefined, "basic"), false);
    assert.equal(isApiRouteAllowedForEdition(path, undefined, "premium"), true);
  }
  assert.equal(isDashboardDestinationAllowedForEdition("/dashboard/agent/publications/settings", "standard"), true);
});

test("manual classification rejects every agent provenance marker and leaves manually scheduled Booster AI drafts available", () => {
  assert.equal(isManualBoosterPublicationSchedule(manual()), true);
  assert.equal(isManualBoosterPublicationSchedule(manual({ payload: { kind: "manual_publish_schedule", publishPayload: { source: "booster_scheduled", creationMode: "ai" } } })), true);
  for (const payload of [
    { sourceActionId: "agent" }, { inrAgentActionId: "agent" }, { agentActionId: "agent" }, { editorialPlan: {} },
    { origin: { source: "inr_agent" } }, { origin: { agentActionId: "agent" } }, { origin: "inr_agent" },
    ...["sourceActionId", "inrAgentActionId", "agentActionId"].map(key => ({ publishPayload: { [key]: "agent" } })),
    { publishPayload: { source: "inr_agent" } }, { publishPayload: { origin: { agentActionId: "agent" } } },
  ]) {
    const base = manual().payload as Row;
    assert.equal(isManualBoosterPublicationSchedule(manual({ payload: { ...base, ...payload, publishPayload: { ...base.publishPayload as Row, ...payload.publishPayload as Row } } })), false, JSON.stringify(payload));
  }
  for (const patch of [{ source: "automatic" }, { target_tool: "mails" }, { action_type: "campaign" }, { automation_key: "grow" }]) assert.equal(isManualBoosterPublicationSchedule(manual(patch)), false);
});

test("Basic reads only its manual Booster rows, never agent schedules or another account", async () => {
  const h = harness([manual(), manual({ id: "automatic", source: "automatic" }), manual({ id: "foreign", user_id: "other" })]);
  const response = await h.collection.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).scheduledActions.map((row: Row) => row.id), ["manual"]);
  assert.equal((await h.detail.GET(request(), context("automatic"))).status, 403);
  assert.equal((await h.detail.GET(request(), context("foreign"))).status, 404);
});

test("Basic creates an ordinary manual schedule but refuses automatic/campaign/forged agent rows before writing", async () => {
  for (const override of [{}, { source: "automatic" }, { actionType: "campaign", targetTool: "mails" }, { payload: { kind: "manual_publish_schedule", publishPayload: { source: "inr_agent" } } }]) {
    const h = harness([]);
    const body = { source: "manual", automationKey: "publish", actionType: "publication", targetTool: "booster", scheduledAt, channels: ["facebook"], payload: manual().payload, ...override };
    const response = await h.collection.POST(request("POST", body));
    assert.equal(response.status, Object.keys(override).length ? 403 : 200);
    assert.equal(h.queries.filter(query => query.operation === "insert").length, Object.keys(override).length ? 0 : 1);
  }
});

test("manual editing, media replacement, rescheduling and cancellation use a revision claim and preserve Booster source", async () => {
  for (const change of [{ title: "Titre corrigé" }, { scheduledAt: "2099-11-06T14:00:00Z" }, { payload: { ...manual().payload as Row, publishPayload: { ...(manual().payload as Row).publishPayload as Row, postByChannel: { facebook: { content: "Texte corrigé" } }, images: [{ id: "media-remplace" }] } } }]) {
    const h = harness([manual()]);
    const response = await h.detail.PATCH(request("PATCH", change), context());
    assert.equal(response.status, 200);
    const update = h.queries.find(query => query.operation === "update"); assert.ok(update);
    assert.equal(update.filters.source, "manual"); assert.equal(update.filters.status, "scheduled"); assert.equal(update.filters.updated_at, revision);
    assert.equal(isManualBoosterPublicationSchedule(h.rows[0]), true);
  }
  const h = harness([manual()]);
  assert.equal((await h.detail.DELETE(request("DELETE"), context())).status, 200);
  assert.equal(h.rows[0].status, "cancelled");
  assert.equal(h.queries.find(query => query.operation === "update")?.filters.updated_at, revision);
});

test("Basic cannot convert manual provenance, edit another account or mutate already dispatched publications", async () => {
  for (const row of [manual({ source: "automatic" }), manual({ status: "running" }), manual({ status: "done" }), manual({ user_id: "other" })]) {
    const h = harness([row]);
    const response = await h.detail.PATCH(request("PATCH", { title: "Intrusion" }), context());
    assert.ok([403, 404, 409].includes(response.status));
    assert.equal(h.queries.some(query => query.operation === "update"), false);
  }
  const h = harness([manual()]);
  assert.equal((await h.detail.PATCH(request("PATCH", { payload: { kind: "manual_publish_schedule", publishPayload: { source: "inr_agent", inrAgentActionId: "agent" } } }), context())).status, 403);
  assert.equal((await h.detail.PATCH(request("PATCH", { editType: "publish_channel_selection", channels: ["facebook"] }), context())).status, 403);
  const raced = harness([manual()], "basic", true);
  assert.equal((await raced.detail.PATCH(request("PATCH", { title: "Concurrent" }), context())).status, 409);
  assert.equal((await raced.detail.DELETE(request("DELETE"), context())).status, 409);
});

test("Basic publish-now claims only its unchanged manual row and dispatches through Booster, never agent AI", async () => {
  const h = harness([manual()]);
  const response = await h.execution.POST(request("POST", {}), context());
  assert.equal(response.status, 200);
  assert.equal(h.published.length, 1);
  assert.equal(h.published[0].source, "booster_scheduled");
  const claim = h.queries.find(query => query.operation === "update"); assert.ok(claim);
  assert.equal(claim.filters.source, "manual"); assert.equal(claim.filters.updated_at, revision);
  for (const row of [manual({ source: "automatic" }), manual({ user_id: "other" })]) {
    const blocked = harness([row]);
    assert.ok([403, 404].includes((await blocked.execution.POST(request("POST", {}), context())).status));
    assert.equal(blocked.published.length, 0); assert.equal(blocked.queries.some(query => query.operation === "update"), false);
  }
  const raced = harness([manual()], "basic", true);
  assert.equal((await raced.execution.POST(request("POST", {}), context())).status, 409);
  assert.equal(raced.published.length, 0);
});

test("an unchanged imminent schedule can be saved and launched manually; a newly past schedule date is refused", async () => {
  const imminent = new Date(Date.now() + 10_000).toISOString();
  const h = harness([manual({ scheduled_at: imminent })]);
  assert.equal((await h.detail.PATCH(request("PATCH", { scheduledAt: imminent, title: "Texte validé" }), context())).status, 200);
  assert.equal((await h.execution.POST(request("POST", {}), context())).status, 200);
  assert.equal(h.published.length, 1);
  const changed = harness([manual()]);
  assert.equal((await changed.detail.PATCH(request("PATCH", { scheduledAt: new Date(Date.now() - 30_000).toISOString() }), context())).status, 400);
  assert.equal(changed.queries.some(query => query.operation === "update"), false);
});

test("splitting edited media across dates carries the exact second-channel replacement through POST's durable revision boundary", async () => {
  const load = runtimeModules({});
  const workflow = load<typeof import("../../app/dashboard/agent/_lib/agent.schedule.ts")>("app/dashboard/agent/_lib/agent.schedule.ts");
  const schedules = load<typeof import("../../lib/inrAgentScheduledActions.ts")>("lib/inrAgentScheduledActions.ts");
  const original = manual({ channels: ["facebook", "instagram"], payload: { kind: "manual_publish_schedule", mediaWorkspaceId: "snapshot-A", scheduledMediaSnapshot: true,
    publishPayload: { source: "booster_scheduled", mediaWorkspaceId: "snapshot-A", scheduledMediaSnapshot: true, channels: ["facebook", "instagram"],
      imagesByChannel: { facebook: [{ id: "A", url: "https://fixture.invalid/A.png" }], instagram: [{ id: "A", url: "https://fixture.invalid/A.png" }] }, mediaModeByChannel: { facebook: "images", instagram: "images" } } } });
  const prepared = workflow.scheduledActionToPreparedAction(schedules.rowToInrAgentScheduledAction(original)); assert.ok(prepared);
  const edited = workflow.updateScheduledEditPublishMedia(prepared, "instagram", { id: "B", url: "https://fixture.invalid/B.png", type: "image/png" }, 0, "replace");
  const secondDate = workflow.scheduledEditUpdateFromAction(edited, { channels: ["instagram"], scheduledAt: "2099-11-08T10:00:00Z" });
  assert.equal((secondDate.payload as Row).scheduledMediaRevisionRequested, true);
  const h = harness([]);
  const response = await h.collection.POST(request("POST", { ...secondDate, source: "manual", actionType: "publication", targetTool: "booster" }));
  assert.equal(response.status, 200);
  assert.equal(h.revisions.length, 1); assert.deepEqual(h.revisions[0].channels, ["instagram"]);
  const publish = (h.rows[0].payload as Row).publishPayload as Row;
  assert.equal(publish.mediaWorkspaceId, "revision-B");
  assert.equal((publish.imagesByChannel as Record<string, Array<{ id: string }>>).instagram[0].id, "B");
  assert.equal(Object.hasOwn(publish.imagesByChannel as object, "facebook"), false, "the extra date keeps its own channel selection");
  assert.equal(h.discardedRevisions, 0);
});

test("a media revision is discarded if a concurrent worker wins the schedule claim", async () => {
  const h = harness([manual()], "basic", true);
  const changed = { ...manual().payload as Row, publishPayload: { ...(manual().payload as Row).publishPayload as Row, imagesByChannel: { facebook: [{ id: "B", url: "https://fixture.invalid/B.png" }] } } };
  assert.equal((await h.detail.PATCH(request("PATCH", { payload: changed }), context())).status, 409);
  assert.equal(h.revisions.length, 1); assert.equal(h.discardedRevisions, 1); assert.equal((h.rows[0].payload as Row).mediaWorkspaceId, undefined);
});
