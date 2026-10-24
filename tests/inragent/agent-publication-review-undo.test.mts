import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isInrAgentActionId } from "../../lib/inrAgentActionId.ts";
import { canReopenPublicationValidation } from "../../app/dashboard/agent/_lib/agent.publication-visibility.ts";
import type { InrAgentAction } from "../../lib/inrAgentActions.ts";
import { runtimeModules } from "./runtime-module-loader.mts";

const editorialId = "46266e80-becd-b284-ba88-17d00b58c20f";
const future = new Date(Date.now() + 86_400_000).toISOString();
const later = new Date(Date.now() + 172_800_000).toISOString();
const updatedAt = "2026-10-21T12:00:00Z";
const base = { automationKey: "publish", actionType: "publication", targetTool: "booster",
  status: "scheduled", scheduledFor: future, completedAt: null, validationRequired: true,
  executionPolicy: "manual_validation" };

test("les identifiants éditoriaux historiques et les UUID classiques sont acceptés sans accepter une chaîne arbitraire", () => {
  for (const id of [editorialId, "51f52c86-c124-9e83-0bc0-db7f963188a8", "f8f39700-b715-08e8-931d-15e77f4e98ce", "d2384975-c05a-4a72-b3f6-19f734fc0583"]) {
    assert.equal(isInrAgentActionId(id), true, id);
  }
  for (const id of [null, undefined, "", "publication", `${editorialId}/other`, ` ${editorialId}`, editorialId.replace("4626", "xxxx")]) {
    assert.equal(isInrAgentActionId(id), false);
  }
});

test("le retour s'affiche pour refusée, validée et programmée tant que l'échéance n'est pas atteinte", () => {
  for (const status of ["refused", "validated", "scheduled"]) {
    assert.equal(canReopenPublicationValidation({ ...base, status }, Date.now()), true, status);
    assert.equal(canReopenPublicationValidation({ ...base, status }, Date.parse(future)), false, status);
  }
  for (const status of ["pending_validation", "prepared", "executing", "failed", "completed", "cancelled"]) {
    assert.equal(canReopenPublicationValidation({ ...base, status }, Date.now()), false, status);
  }
  for (const patch of [{ completedAt: updatedAt }, { scheduledFor: null }, { validationRequired: false }, { executionPolicy: "automatic_after_settings" }]) {
    assert.equal(canReopenPublicationValidation({ ...base, ...patch }, Date.now()), false);
  }
});

test("le vrai aiguillage PATCH laisse passer les identifiants éditoriaux pour les deux annulations", async () => {
  const text = readFileSync(new URL("../../app/api/agent/actions/route.ts", import.meta.url), "utf8");
  const source = ts.createSourceFile("route.ts", text, ts.ScriptTarget.Latest, true);
  let statement: ts.IfStatement | undefined;
  function visit(node: ts.Node) {
    if (ts.isIfStatement(node) && node.expression.getText(source).includes('editType === "restore_refused_publication"')) statement = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(statement);
  const javascript = ts.transpileModule(`async function restoreRoute() { ${statement.getText(source)} }; return restoreRoute;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  for (const editType of ["restore_refused_publication", "restore_validated_publication"]) {
    const calls: Record<string, unknown>[] = [];
    const restore = async (args: Record<string, unknown>) => { calls.push(args); return { id: editorialId, status: "pending_validation" }; };
    const handle = new Function("editType", "actionId", "requestBody", "activeUserId", "ACTION_SELECT", "isInrAgentActionId", "NextResponse", "restoreInrAgentPublicationReview", "refreshActionImageUrls", "PublicationRefusalRestoreError", javascript)(
      editType, editorialId, { expectedUpdatedAt: updatedAt }, "active-account", "*", isInrAgentActionId,
      { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status || 200 }) },
      restore, async (action: unknown) => action, Error,
    );
    const result = await handle();
    assert.equal(result.status, 200, editType);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].actionId, editorialId);
    assert.equal(calls[0].accountId, "active-account");
    assert.equal(calls[0].decision, editType.includes("refused") ? "refused" : "validated");
  }
});

function harness({ status = "scheduled", started = false, dueChild = false, stale = false, race = false, owner = "account" } = {}) {
  const source: Record<string, unknown> = {
    id: editorialId, user_id: owner, automation_key: "publish", action_type: "publication", target_tool: "booster",
    status, scheduled_for: future, completed_at: null, validation_required: true, execution_policy: "manual_validation",
    updated_at: updatedAt, validated_at: status === "refused" ? null : updatedAt,
    refused_at: status === "refused" ? updatedAt : null, target_channels: ["facebook", "tiktok"],
    payload: { postByChannel: { facebook: { content: "Contenu original" }, tiktok: { content: "Vidéo originale" } },
      imagesByChannel: { facebook: [{ url: "/image.png" }] }, videoByChannel: { tiktok: { url: "/video.mp4" } },
      tiktokPublicationSettings: { musicUsageConfirmed: true, privacyLevel: "SELF_ONLY" },
      scheduledExecution: { scheduledActionIds: ["facebook-job", "tiktok-job"] } },
  };
  const rows: Record<string, unknown>[] = status === "refused" ? [] : [
    { id: "facebook-job", user_id: owner, status: "scheduled", channels: ["facebook"], scheduled_at: dueChild ? updatedAt : future,
      updated_at: updatedAt, executed_at: null, attempt_count: started ? 1 : 0, timezone: "Europe/Paris",
      payload: { sourceActionId: editorialId, publishPayload: { content: "Snapshot Facebook inchangé" } } },
    { id: "tiktok-job", user_id: owner, status: "scheduled", channels: ["tiktok"], scheduled_at: later,
      updated_at: updatedAt, executed_at: null, attempt_count: 0, timezone: "Europe/Paris",
      payload: { sourceActionId: editorialId, publishPayload: { content: "Snapshot TikTok inchangé" } } },
  ];
  const writes: { table: string; patch: Record<string, unknown> }[] = [];
  const rpcCalls: Record<string, unknown>[] = [];
  const queryGuards: [string, string, unknown][] = [];
  const db = {
    async rpc(name: string, args: Record<string, unknown>) {
      assert.equal(name, "inrcy_set_agent_publication_channels");
      rpcCalls.push(args);
      assert.equal(args.p_user_id, "account");
      assert.equal(args.p_expected_updated_at, source.updated_at);
      if (started || dueChild) return { data: { outcome: started ? "publication_started" : "schedule_due" }, error: null };
      assert.deepEqual(args.p_channels, []);
      source.updated_at = "2026-10-22T12:00:00Z";
      for (const row of rows) {
        row.payload = { ...(row.payload as Record<string, unknown>), publicationChannelSelectionRowChannels: row.channels, publicationChannelSelectionPaused: true };
        row.channels = []; row.status = "cancelled"; row.updated_at = source.updated_at;
      }
      return { data: { outcome: "saved", action: structuredClone(source), scheduledActions: structuredClone(rows) }, error: null };
    },
    from(table: string) {
      const filters: [string, unknown][] = [];
      const greater: [string, string][] = [];
      let patch: Record<string, unknown> | null = null;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        is(key: string, value: unknown) { filters.push([key, value]); return query; },
        gt(key: string, value: string) { greater.push([key, value]); queryGuards.push([table, key, value]); return query; },
        update(value: Record<string, unknown>) { patch = value; return query; },
        async maybeSingle() {
          if (race && patch && table === "inr_agent_actions") source.updated_at = "2026-10-23T12:00:00Z";
          const row = table === "inr_agent_actions" ? source : rows.find(row => filters.some(([key, value]) => key === "id" && row.id === value));
          if (!row || filters.some(([key, value]) => row[key] !== value) || greater.some(([key, value]) => Date.parse(String(row[key])) <= Date.parse(value))) return { data: null, error: null };
          if (patch) { writes.push({ table, patch }); Object.assign(row, structuredClone(patch)); }
          return { data: structuredClone(stale ? { ...row, updated_at: "2026-10-23T12:00:00Z" } : row), error: null };
        },
      };
      return query;
    },
  };
  const load = runtimeModules({ "@/lib/supabaseAdmin": { supabaseAdmin: db } });
  const server = load<{ restoreInrAgentPublicationReview: (args: Record<string, unknown>) => Promise<InrAgentAction> }>("lib/inrAgentPublicationRefusalServer.ts");
  return { ...server, source, rows, writes, rpcCalls, queryGuards };
}
const restoreArgs = { accountId: "account", actionId: editorialId, expectedUpdatedAt: updatedAt, select: "*", decision: "validated" };

test("annuler une validation retire tous les anciens jobs sans changer le contenu, les canaux ou les dates", async () => {
  for (const status of ["scheduled", "validated"]) {
    const h = harness({ status }); const originalPayload = structuredClone(h.source.payload) as Record<string, unknown>;
    const saved = await h.restoreInrAgentPublicationReview(restoreArgs);
    assert.equal(saved.status, "pending_validation"); assert.equal(saved.validatedAt, null); assert.equal(saved.refusedAt, null);
    assert.equal(saved.scheduledFor, future); assert.equal(saved.id, editorialId);
    assert.deepEqual(saved.targetChannels, ["facebook", "tiktok"]);
    for (const key of ["postByChannel", "imagesByChannel", "videoByChannel", "tiktokPublicationSettings"]) assert.deepEqual(saved.payload[key], originalPayload[key], key);
    assert.deepEqual((saved.payload.scheduledExecution as Record<string, unknown>).scheduledActionIds, []);
    const review = saved.payload.publicationRevisionReview as { required: boolean; scheduleSelections: unknown };
    assert.equal(review.required, true);
    assert.deepEqual(review.scheduleSelections, [{ channel: "facebook", scheduledAt: future }, { channel: "tiktok", scheduledAt: later }]);
    assert.ok(h.rows.every(row => row.status === "cancelled" && (row.payload as Record<string, unknown>).publicationChannelSelectionPaused === false));
    assert.equal(h.rpcCalls.length, 1);
    assert.ok(h.queryGuards.some(([table, key]) => table === "inr_agent_actions" && key === "scheduled_for"));
    await assert.rejects(h.restoreInrAgentPublicationReview(restoreArgs));
  }
});

test("une diffusion commencée, une échéance de canal atteinte ou une autre version ne sont jamais réouvertes", async () => {
  for (const setup of [{ started: true }, { dueChild: true }, { stale: true }, { owner: "other-account" }, { status: "completed" }, { status: "executing" }, { status: "refused" }]) {
    const h = harness(setup); const before = structuredClone({ source: h.source, rows: h.rows });
    await assert.rejects(h.restoreInrAgentPublicationReview(restoreArgs));
    assert.deepEqual({ source: h.source, rows: h.rows }, before, JSON.stringify(setup));
    assert.equal(h.writes.length, 0);
  }
});

test("une course après suspension échoue en sécurité sans reprendre les anciens jobs", async () => {
  const h = harness({ race: true });
  await assert.rejects(h.restoreInrAgentPublicationReview(restoreArgs), /suspendue/);
  assert.equal(h.source.status, "scheduled");
  assert.ok(h.rows.every(row => row.status === "cancelled"));
  assert.equal(h.rpcCalls.length, 1);
  assert.ok((h.source.payload as Record<string, unknown>).postByChannel);
});

function clientUndoHarness(response: { ok: boolean; action?: unknown; error?: string }) {
  const text = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("AgentClient.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "restorePublicationReview") declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(declaration);
  const code = ts.transpileModule(`${declaration.getText(source)}; return restorePublicationReview;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const selected = { ...base, id: editorialId, updatedAt };
  const state = { actions: [selected], filters: { pending: false }, reviews: { [editorialId]: { signature: "old-consent" } }, session: { settings: true } as unknown, notice: "", refreshedSchedules: 0, refreshedActions: 0, selected: editorialId };
  const requests: Record<string, unknown>[] = [];
  const dependencies = {
    selectedPreparedAction: selected, publicationRestoreInFlightRef: { current: false }, actionMutationState: "idle", validationScheduleState: "idle",
    tiktokSessionCheckInFlightRef: { current: false }, publishRegeneration: null, canReopenPublicationValidation,
    setPublicationRestoreState: () => {},
    fetch: async (_url: string, args: { body: string }) => { requests.push(JSON.parse(args.body)); return { ok: response.ok, json: async () => response }; },
    i18nT: (key: string) => key, setActions: (fn: (current: unknown) => typeof state.actions) => { state.actions = fn(state.actions); },
    setPublicationStatusFilters: (fn: (current: unknown) => typeof state.filters) => { state.filters = fn(state.filters); },
    setSelectedPreparedActionId: (id: string) => { state.selected = id; }, setTiktokValidationSession: (session: unknown) => { state.session = session; },
    setTiktokPublicationReviews: (fn: (current: unknown) => typeof state.reviews) => { state.reviews = fn(state.reviews); },
    showNotice: (text: string) => { state.notice = text; }, refreshScheduledActions: async () => { state.refreshedSchedules++; }, refreshActions: async () => { state.refreshedActions++; },
  };
  const run = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
  return { run, state, requests };
}

test("le client montre l'attente restaurée, invalide le consentement TikTok et actualise les jobs", async () => {
  const restored = { ...base, id: editorialId, updatedAt, status: "pending_validation" };
  const h = clientUndoHarness({ ok: true, action: restored });
  await h.run();
  assert.equal(h.requests[0].editType, "restore_validated_publication");
  assert.equal(h.state.actions[0].status, "pending_validation"); assert.equal(h.state.filters.pending, true);
  assert.deepEqual(h.state.reviews, {}); assert.equal(h.state.session, null);
  assert.equal(h.state.refreshedSchedules, 1);
});

test("le client conserve la raison serveur au lieu d'accuser systématiquement la date", async () => {
  const h = clientUndoHarness({ ok: false, error: "La publication a changé. Actualisez puis réessayez." });
  await h.run();
  assert.equal(h.state.notice, "La publication a changé. Actualisez puis réessayez.");
  assert.equal(h.state.refreshedActions, 1);
  assert.equal(h.state.actions[0].status, "scheduled");
});
