import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "./runtime-module-loader.mts";
import {
  applyInrAgentPublicationSoundtrack,
  canConfigureInrAgentPublicationSoundtrack,
  isInrAgentPublicationSoundtrackLocked,
  readInrAgentPublicationSoundtrack,
} from "../../lib/inrAgentPublicationSoundtrack.ts";
import { isInrAgentActionId } from "../../lib/inrAgentActionId.ts";
import { isInrAgentMetaChannel } from "../../lib/inrAgentPublicationPlacement.ts";
import { preparedInrAgentPublicationChannels, selectedInrAgentPublicationChannels } from "../../lib/inrAgentPublicationChannelSelection.ts";
import { buildScheduledPublicationRequest } from "../../lib/inrAgentScheduledPublication.ts";

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const actionId = "ab00a100-1100-0100-0000-a00000000000";
const accountId = "active-account";
const updatedAt = "2026-10-27T12:00:00.000Z";
const load = runtimeModules();
const { normalizeBoosterSoundtrackId } = load<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts");
const musicHelpers = { applyInrAgentPublicationSoundtrack, canConfigureInrAgentPublicationSoundtrack, isInrAgentPublicationSoundtrackLocked };
const media = { storagePath: "account/photo.jpg", type: "image/jpeg" };
function publicationPayload(): Row {
  return { selectedChannels: ["facebook", "instagram"], imagesByChannel: { facebook: [media], instagram: [media] },
    mediaFormatVariants: { kind: "image", version: 1, byFormat: { story: [media] } },
    facebookPublicationSettings: { placement: "reel" }, instagramPublicationSettings: { placement: "story" },
    imagesByPlacement: { facebook: { reel: [media], story: [media] } },
    publishPayload: { unrelated: "retained" } };
}

test("music selection persists per publication/channel, retaining legacy IDs and explicit Auto", () => {
  const original: Row = { ...publicationPayload(), soundtrackId: "horizon-clair", soundtrackByChannel: { instagram: "jazz-velours" },
    publishPayload: { soundtrackByChannel: { facebook: "funk-boutique", instagram: "horizon-clair" }, unrelated: "retained" } };
  assert.equal(readInrAgentPublicationSoundtrack(original, "facebook"), "funk-boutique");
  assert.equal(readInrAgentPublicationSoundtrack(original, "instagram"), "jazz-velours");
  const snapshot = structuredClone(original);
  const next = applyInrAgentPublicationSoundtrack(original, "facebook", null);
  assert.deepEqual(next.soundtrackByChannel, { facebook: null, instagram: "jazz-velours" });
  assert.deepEqual(record(next.publishPayload).soundtrackByChannel, next.soundtrackByChannel);
  assert.equal(next.soundtrackId, "horizon-clair");
  assert.equal(readInrAgentPublicationSoundtrack(next, "facebook"), null, "Auto overrides a legacy global selection");
  assert.equal(record(next.publishPayload).unrelated, "retained");
  assert.deepEqual(next.imagesByPlacement, original.imagesByPlacement);
  assert.deepEqual(next.mediaFormatVariants, original.mediaFormatVariants);
  assert.deepEqual(original, snapshot);
  assert.equal(readInrAgentPublicationSoundtrack({}, "facebook"), null);
  assert.equal(readInrAgentPublicationSoundtrack({ publishPayload: { soundtrackId: "horizon-clair" } }, "facebook"), "horizon-clair");
  assert.throws(() => applyInrAgentPublicationSoundtrack({}, "threads" as "facebook", "jazz-velours"));
  for (const id of ["../jazz-velours", "https://example.org/audio.wav", "", undefined]) {
    assert.throws(() => applyInrAgentPublicationSoundtrack({}, "facebook", id));
  }
});

test("eligibility follows native photo placement, preserves imported/AI-video audio, and permits anticipating the media", () => {
  for (const channel of ["facebook", "instagram"] as const) {
    assert.equal(canConfigureInrAgentPublicationSoundtrack({}, channel), false);
    assert.equal(canConfigureInrAgentPublicationSoundtrack({ [`${channel}PublicationSettings`]: { placement: "reel" } }, channel), true);
    assert.equal(canConfigureInrAgentPublicationSoundtrack({ [`${channel}PublicationSettings`]: { primaryPlacement: "classic", includeStory: true, version: 2 } }, channel), true);
    assert.equal(canConfigureInrAgentPublicationSoundtrack(publicationPayload(), channel), true);
    assert.equal(canConfigureInrAgentPublicationSoundtrack({ ...publicationPayload(), mediaModeByChannel: { [channel]: "video" } }, channel), false);
    assert.equal(canConfigureInrAgentPublicationSoundtrack({ [`${channel}PublicationSettings`]: { placement: "reel" }, video: { storagePath: "original.mp4" } }, channel), false);
    assert.equal(canConfigureInrAgentPublicationSoundtrack({ ...publicationPayload(), video: { storagePath: "other-channel.mp4" }, mediaModeByChannel: { [channel]: "images" } }, channel), true);
    assert.equal(canConfigureInrAgentPublicationSoundtrack({ [`${channel}PublicationSettings`]: { placement: "reel" }, mediaFormatVariants: { kind: "video" } }, channel), false);
    for (const media of [{ type: "video/mp4", storagePath: "legacy.mp4" }, { storagePath: "legacy.webm" }]) {
      assert.equal(canConfigureInrAgentPublicationSoundtrack({ [`${channel}PublicationSettings`]: { placement: "reel" }, mediaAsset: media }, channel), false);
    }
  }
});

test("started and uncertain native sequences keep their soundtrack, while the untouched channel stays editable", () => {
  const checkpoint = "550e8400-e29b-41d4-a716-446655440000";
  const partial = { partialImmediateExecution: { executedAt: updatedAt, channels: ["facebook"],
    summary: { entries: [{ channel: "facebook", story_sequence_resume_ref: checkpoint }] } } };
  assert.equal(isInrAgentPublicationSoundtrackLocked(partial, "facebook"), true);
  assert.equal(isInrAgentPublicationSoundtrackLocked(partial, "instagram"), false);
  for (const payload of [
    { storySequenceResumeByChannel: { facebook: checkpoint } },
    { execution: { publishResult: { results: { facebook: { requestMayHaveSucceeded: true } } } } },
    { lastExecution: { at: updatedAt } },
    { execution: { results: { facebook: { published_image_count: 1 } } } },
    { publishPayload: { storySequenceResumeByChannel: { facebook: checkpoint } } },
  ]) assert.equal(isInrAgentPublicationSoundtrackLocked(payload, "facebook"), true);
  assert.equal(isInrAgentPublicationSoundtrackLocked({ scheduledExecution: { scheduledActionIds: ["job"] } }, "facebook"), false);
  assert.equal(isInrAgentPublicationSoundtrackLocked(publicationPayload(), "facebook"), false);
});

function extractedBranch(relative: string, expression: string) {
  const source = readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
  let branch: ts.IfStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.expression.getText(tree) === expression) branch = node;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(branch);
  return branch.getText(tree);
}

function patchHarness({ status = "pending_validation", payload = publicationPayload(), race = false, started = false, owner = accountId } = {}) {
  const row: Row = { id: actionId, user_id: owner, automationKey: "publish", actionType: "publication", targetTool: "booster",
    targetChannels: ["facebook", "instagram"], status, payload, updated_at: updatedAt, updatedAt, completedAt: null,
    validatedAt: status === "scheduled" ? updatedAt : null };
  const reads: Row[] = [], writes: Row[] = [], rpcs: Row[] = [];
  const db = { from(table: string) {
    const filters: Row = {}; let patch: Row | undefined;
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      update(value: Row) { patch = value; return query; },
      async single() {
        reads.push({ table, ...filters });
        const data = filters.id === row.id && filters.user_id === owner ? structuredClone(row) : null;
        if (race) { row.status = "executing"; row.updated_at = "new-execution-version"; }
        return { data, error: null };
      },
      async maybeSingle() {
        if (Object.entries(filters).some(([key, value]) => row[key] !== value)) return { data: null, error: null };
        if (patch) { writes.push(patch); Object.assign(row, patch); }
        return { data: structuredClone(row), error: null };
      },
    }; return query;
  }, async rpc(_name: string, args: Row) {
    rpcs.push(args);
    if (started) return { error: null, data: { outcome: "publication_started" } };
    row.updated_at = "paused-version";
    return { error: null, data: { outcome: "saved", action: row, scheduledActions: [] } };
  } };
  const toAction = (value: Row) => ({ ...value, updatedAt: value.updated_at });
  const revision = runtimeModules({ "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/inrAgentActions": { rowToInrAgentAction: toAction } })<typeof import("../../lib/inrAgentPublicationRevisionServer.ts")>("lib/inrAgentPublicationRevisionServer.ts");
  const bindings = { ...musicHelpers, normalizeBoosterSoundtrackId, isInrAgentActionId, isInrAgentMetaChannel,
    preparedInrAgentPublicationChannels, selectedInrAgentPublicationChannels, supabaseAdmin: db,
    rowToInrAgentAction: toAction, isPublishAction: (action: Row) => action.targetTool === "booster" && action.actionType === "publication",
    saveInrAgentPublicationRevision: revision.saveInrAgentPublicationRevision,
    refreshActionImageUrls: async (action: Row) => action, ACTION_SELECT: "*", actionId, activeUserId: accountId,
    NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status || 200 }) } };
  const body = extractedBranch("app/api/agent/actions/route.ts", 'editType === "publish_channel_soundtrack"');
  const compiled = ts.transpileModule(`return async function(requestBody) { const editType = "publish_channel_soundtrack"; ${body} };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const run = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings)) as (body: Row) => Promise<{ status: number; body: Row }>;
  return { run, reads, writes, rpcs, row };
}

test("the production PATCH validates catalogue/account/channel, writes both boundaries and preserves every media cache", async () => {
  for (const id of ["jazz-velours", "horizon-clair", null]) {
    const h = patchHarness();
    const response = await h.run({ channel: "facebook", soundtrackId: id });
    assert.equal(response.status, 200);
    assert.equal(h.writes.length, 1);
    assert.deepEqual(record(h.row.payload).soundtrackByChannel, { facebook: id });
    assert.equal(record(record(h.row.payload).publishPayload).unrelated, "retained");
    assert.deepEqual(record(h.row.payload).imagesByPlacement, publicationPayload().imagesByPlacement);
    assert.deepEqual(record(h.row.payload).mediaFormatVariants, publicationPayload().mediaFormatVariants);
    assert.ok(h.reads.every(read => read.user_id === accountId));
  }
  for (const body of [{ channel: "threads", soundtrackId: "jazz-velours" }, { channel: "facebook", soundtrackId: "unknown-track" },
    { channel: "facebook", soundtrackId: "../track.wav" }, { channel: "facebook" }]) {
    const h = patchHarness(); assert.equal((await h.run(body)).status, 400); assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  }
  const wrongAccount = patchHarness({ owner: "another-account" });
  assert.equal((await wrongAccount.run({ channel: "facebook", soundtrackId: "jazz-velours" })).status, 404);
});

test("music revisions reuse guarded approval/schedule invalidation and reject native retry/concurrent execution", async () => {
  const scheduled = patchHarness({ status: "scheduled" });
  assert.equal((await scheduled.run({ channel: "facebook", soundtrackId: "jazz-velours" })).status, 200);
  assert.equal(scheduled.rpcs.length, 1);
  assert.deepEqual(scheduled.rpcs[0].p_channels, []);
  assert.equal(scheduled.row.status, "pending_validation");
  assert.equal(record(record(scheduled.row.payload).publicationRevisionReview).required, true);
  for (const options of [{ race: true }, { status: "executing" }, { status: "scheduled", started: true },
    { payload: { ...publicationPayload(), execution: { executedAt: updatedAt, results: { facebook: { story_sequence_resume_ref: "checkpoint" } } } } }]) {
    const h = patchHarness(options);
    assert.equal((await h.run({ channel: "facebook", soundtrackId: "jazz-velours" })).status, 409);
    assert.equal(h.writes.length, 0);
  }
});

test("a music preference may be anticipated in Classic or on imported video without changing its format/media", async () => {
  for (const payload of [
    { selectedChannels: ["facebook", "instagram"], images: [media] },
    { selectedChannels: ["facebook", "instagram"], facebookPublicationSettings: { placement: "reel" }, mediaAsset: { type: "video/mp4", storagePath: "video.mp4" } },
  ]) {
    const h = patchHarness({ payload });
    assert.equal((await h.run({ channel: "facebook", soundtrackId: "jazz-velours" })).status, 200);
    const updated = record(h.row.payload);
    assert.deepEqual(updated.facebookPublicationSettings, payload.facebookPublicationSettings);
    assert.deepEqual(updated.mediaAsset, payload.mediaAsset);
    assert.deepEqual(updated.images, payload.images);
    assert.equal(canConfigureInrAgentPublicationSoundtrack(updated, "facebook"), false);
    assert.equal(readInrAgentPublicationSoundtrack(updated, "facebook"), "jazz-velours");
  }
});

test("scheduled edit and durable dispatch retain both tracks, including Auto overriding a legacy global track", () => {
  const { scheduledEditUpdateFromAction } = load<typeof import("../../app/dashboard/agent/_lib/agent.schedule.ts")>("app/dashboard/agent/_lib/agent.schedule.ts");
  const payload = applyInrAgentPublicationSoundtrack({ ...publicationPayload(), soundtrackId: "horizon-clair",
    soundtrackByChannel: { instagram: "jazz-velours" } }, "facebook", null);
  const action = { id: actionId, automationKey: "publish", targetTool: "booster", actionType: "publication", payload,
    targetChannels: ["facebook", "instagram"], title: "Photos", summary: "Présentation" };
  const saved = scheduledEditUpdateFromAction(action as never, { scheduledAt: "2100-01-01T12:00:00.000Z", channels: ["facebook", "instagram"] });
  const dispatch = buildScheduledPublicationRequest({ id: "schedule", channels: ["facebook", "instagram"], payload: saved.payload });
  assert.ok(dispatch);
  assert.deepEqual(dispatch.body.soundtrackByChannel, { facebook: null, instagram: "jazz-velours" });
  assert.equal(dispatch.body.soundtrackId, "horizon-clair");
  const rootOnly = scheduledEditUpdateFromAction({ ...action, payload: { ...publicationPayload(), soundtrackByChannel: { facebook: "jazz-velours" } } } as never,
    { scheduledAt: "2100-01-01T12:00:00.000Z", channels: ["facebook"] });
  assert.deepEqual(record(record(rootOnly.payload).publishPayload).soundtrackByChannel, { facebook: "jazz-velours" });
});

function scheduledHarness({ attemptCount = 0, status = "scheduled", sourceLinked = false, race = false } = {}) {
  const row: Row = { id: "job", user_id: accountId, action_type: "publication", target_tool: "booster", status,
    scheduled_at: "2100-01-01T12:00:00.000Z", executed_at: null, attempt_count: attemptCount, updated_at: updatedAt,
    payload: { ...publicationPayload(), ...(sourceLinked ? { sourceActionId: actionId } : {}) } };
  const writes: Row[] = [], reads: Row[] = [];
  const db = { from(table: string) {
    const filters: Row = {}; let patch: Row | undefined;
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; },
      is(key: string, value: unknown) { filters[key] = value; return query; }, update(value: Row) { patch = value; return query; },
      async maybeSingle() {
        assert.equal(table, "inr_agent_scheduled_actions"); assert.equal(filters.user_id, accountId);
        if (Object.entries(filters).some(([key, value]) => row[key] !== value)) return { data: null, error: null };
        if (patch) { writes.push(patch); Object.assign(row, patch); }
        else reads.push(filters);
        const data = structuredClone(row);
        if (!patch && race) { row.status = "running"; row.attempt_count = 1; row.updated_at = "claimed-version"; }
        return { data, error: null };
      },
    }; return query;
  } };
  const services = {
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: accountId, authUserId: "auth-actor" }) },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAuthUser: async () => "premium" },
    "@/lib/inrAgentPublicationChannelSelectionServer": { saveAgentPublicationChannels: () => { throw new Error("No channel selection expected"); } },
    "@/lib/inrAgentScheduledActions": { rowToInrAgentScheduledAction: (value: unknown) => value },
    "@/lib/inrAgentScheduledPayload": { compactInrAgentScheduledPayload: (value: unknown) => value, hasUnauthorizedScheduledStorageReference: () => false },
    "next/server": { NextResponse: Response },
  };
  const { PATCH } = runtimeModules(services)<typeof import("../../app/api/agent/scheduled-actions/[id]/route.ts")>("app/api/agent/scheduled-actions/[id]/route.ts");
  const run = (payload: Row) => PATCH(new Request("http://localhost/api/agent/scheduled-actions/job", {
    method: "PATCH", body: JSON.stringify({ payload }), headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ id: "job" }) });
  return { run, writes, reads, row };
}

test("a manual scheduled snapshot keeps valid music until dispatch and cannot overwrite a worker claim", async () => {
  const selected = applyInrAgentPublicationSoundtrack(publicationPayload(), "facebook", "jazz-velours");
  const h = scheduledHarness();
  assert.equal((await h.run(selected)).status, 200);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(record(h.row.payload).soundtrackByChannel, { facebook: "jazz-velours" });
  for (const options of [{ attemptCount: 1 }, { status: "running" }, { sourceLinked: true }, { race: true }]) {
    const blocked = scheduledHarness(options);
    assert.equal((await blocked.run(selected)).status, 409);
    assert.equal(blocked.writes.length, 0);
  }
  for (const soundtrackId of ["unknown-track", "https://example.org/audio.wav", "../horizon-clair"]) {
    const invalid = scheduledHarness();
    assert.equal((await invalid.run({ ...publicationPayload(), soundtrackByChannel: { facebook: soundtrackId } })).status, 400);
    assert.equal(invalid.writes.length, 0);
  }
});

test("the actual immediate-dispatch literal forwards the validated channel map with explicit Auto", () => {
  const source = readFileSync(new URL("../../app/api/agent/actions/execute/route.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("execute.ts", source, ts.ScriptTarget.Latest, true);
  let normalizeStatements = "", publishStatement = "";
  function visit(node: ts.Node) {
    if (ts.isBlock(node)) {
      const start = node.statements.findIndex(statement => ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some(declaration => declaration.name.getText(tree) === "soundtrackId"));
      if (start >= 0) normalizeStatements = node.statements.slice(start, start + 3).map(statement => statement.getText(tree)).join("\n");
    }
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(tree) === "publishBody")) publishStatement = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(normalizeStatements); assert.ok(publishStatement);
  const { normalizeBoosterSoundtrackByChannel } = load<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts");
  const requested = applyInrAgentPublicationSoundtrack({ ...publicationPayload(), soundtrackId: "horizon-clair",
    soundtrackByChannel: { instagram: "jazz-velours" } }, "facebook", null);
  const bindings: Row = {
    payload: requested, nestedPublishPayload: record(requested.publishPayload), normalizeBoosterSoundtrackId, normalizeBoosterSoundtrackByChannel,
    projectInrAgentThreadsPublishPayload: (value: unknown) => value,
    publishChannels: ["facebook", "instagram"], firstPost: {}, normalizedPostByChannel: {}, cleanText: (value: unknown) => value,
    action: { summary: "Photos" }, activeMediaMode: "images", mediaModeByChannel: {}, videoSettingsByChannel: {}, imagePayloads: [media],
    preparedImages: { imagesByChannel: {}, imagesByPlacement: {}, failuresByChannel: {}, imageSettingsByChannel: {}, warnings: [] },
    videoPayload: null, instagramPublicationSettings: null, facebookPublicationSettings: null, threadsPublicationSettings: null,
    pinterestPublicationSettings: null, tiktokPublicationSettings: null, actionId, autoDisabledChannels: [], hasChannelOverride: false,
    NextResponse: { json: () => { throw new Error("Valid selection must reach dispatch"); } },
  };
  const javascript = ts.transpileModule(`return function(){ ${normalizeStatements}\n${publishStatement}\nreturn publishBody; };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const run = new Function(...Object.keys(bindings), javascript)(...Object.values(bindings));
  assert.deepEqual(run().soundtrackByChannel, { facebook: null, instagram: "jazz-velours" });
  assert.equal(run().soundtrackId, "horizon-clair");
});
