import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as settings from "../../lib/inrAgentSettings.ts";
import * as siteWeb from "../../lib/siteWebChannel.ts";
import * as compactPayload from "../../lib/inrAgentScheduledPayload.ts";

type Row = Record<string, unknown>;
type Options = { manual?: boolean; rpc?: "missing" | "success" | "replay" | "failed"; claimRefused?: boolean; insertFailed?: boolean; snapshotFailedAt?: number; snapshotWriteFailed?: boolean; finalizeFailed?: boolean; duplicate?: boolean; multipleRows?: boolean; reusedSnapshot?: boolean };
const accountId = "account-a", actorAuthUserId = "actor-b", actionId = "action-a";
const scheduledAt = "2099-04-03T09:00:00.000Z";

function harness(options: Options = {}) {
  const events: string[] = [], queries: Array<{ table: string; op: string; filters: Row; patch: unknown }> = [];
  const deletedWorkspaces: string[] = [], reported: unknown[] = [], payloadScopes: unknown[][] = [];
  let snapshotCount = 0, rows: Row[] = [], claimToken: unknown;
  let actionRow: Row = { id: actionId, automation_key: "publish", action_type: "publication", target_tool: "booster", title: "Publication", summary: "Préparée", payload: {}, status: "pending_validation", scheduled_for: scheduledAt, updated_at: "2099-01-01T00:00:00Z", execution_policy: "manual_validation", validation_required: true };
  const preparedPayload = { kind: "manual_publish_schedule", mediaWorkspaceId: "source-workspace", publishPayload: { channels: ["facebook"], postByChannel: { facebook: { title: "Préparée", content: "Contenu validé" } }, mediaModeByChannel: { facebook: "images" } } };
  const admin = {
    async rpc(name: string, args: Row) {
      events.push("rpc"); assert.equal(name, "inrcy_confirm_editorial_publication_schedule"); assert.equal(args.p_user_id, accountId); assert.equal(args.p_action_id, actionId);
      if (!options.rpc || options.rpc === "missing") return { data: null, error: { code: "PGRST202" } };
      if (options.rpc === "failed") return { data: null, error: { code: "INTERNAL", message: "rpc_failed" } };
      rows = (args.p_rows as Row[]).map((row, index) => ({ ...row, id: `scheduled-${index}`, ...(options.rpc === "replay" ? { payload: { ...row.payload as Row, snapshot: true } } : {}) }));
      actionRow = { ...actionRow, status: "scheduled" };
      return { data: { outcome: options.rpc === "replay" ? "already_scheduled" : "scheduled", action: actionRow, scheduledActions: rows }, error: null };
    },
    from(table: string) {
      let op = "read", patch: unknown;
      const filters: Row = {};
      const result = () => {
        queries.push({ table, op, filters: { ...filters }, patch });
        if (table === "publication_workspaces") {
          assert.equal(filters.account_id, accountId); assert.equal(op, "delete"); deletedWorkspaces.push(String(filters.id)); events.push("delete-snapshot"); return { data: null, error: null };
        }
        if (op !== "insert") assert.equal(filters.user_id, accountId, "every read/update keeps account scope");
        if (table === "inr_agent_actions") {
          assert.equal(filters.id, actionId);
          const value = patch as Row;
          if (op === "read") return { data: { ...actionRow }, error: null };
          if (value.status === "executing") {
            events.push("claim"); assert.equal(filters.status, "pending_validation"); assert.equal(filters.updated_at, actionRow.updated_at);
            if (options.claimRefused) return { data: null, error: null };
            claimToken = value.validated_at || value.updated_at; actionRow = { ...actionRow, ...value }; return { data: { ...actionRow }, error: null };
          }
          if (value.status === "refused" && options.claimRefused) return { data: null, error: null };
          if (value.status === "scheduled") {
            events.push("finalize"); assert.equal(filters.status, "executing"); assert.equal(options.manual ? filters.updated_at : filters.validated_at, claimToken);
            if (options.finalizeFailed) return { data: null, error: { message: "finalize_failed" } };
          } else {
            events.push("release"); assert.equal(filters.status, options.rpc === "success" ? "scheduled" : "executing");
            if (options.rpc !== "success") assert.equal(options.manual ? filters.updated_at : filters.validated_at, claimToken);
          }
          actionRow = { ...actionRow, ...value }; return { data: { ...actionRow }, error: null };
        }
        assert.equal(table, "inr_agent_scheduled_actions");
        if (op === "insert") {
          events.push("insert"); const values = patch as Row[]; values.forEach(row => assert.equal(row.user_id, accountId));
          if (options.insertFailed) return { data: null, error: { code: "WRITE_FAILED", message: "insert_failed" } };
          rows = values.map((row, index) => ({ ...row, id: `scheduled-${index}` })); return { data: rows, error: null };
        }
        const value = patch as Row;
        if (value.status === "cancelled") { events.push("cancel"); assert.equal(filters.status, "scheduled"); return { data: null, error: null }; }
        events.push("snapshot-write");
        if (options.snapshotWriteFailed) return { data: null, error: { message: "snapshot_write_failed" } };
        const row = rows.find(row => row.id === filters.id); assert.ok(row); Object.assign(row, value); return { data: { ...row }, error: null };
      };
      const query = {
        select() { return this; }, eq(key: string, value: unknown) { filters[key] = value; return this; }, in(key: string, value: unknown) { filters[key] = value; return this; }, contains(key: string, value: unknown) { filters[key] = value; return this; },
        gt(key: string, value: unknown) { filters[`gt:${key}`] = value; return this; }, lte(key: string, value: unknown) { filters[`lte:${key}`] = value; return this; },
        update(value: Row) { op = "update"; patch = value; return this; }, insert(value: Row[]) { op = "insert"; patch = value; return this; }, upsert(value: Row[]) { op = "insert"; patch = value; return this; }, delete() { op = "delete"; return this; },
        async maybeSingle() { return result(); }, async single() { return result(); }, then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(resolve(result())); },
      };
      return query;
    },
  };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/inrAgentSettings": settings, "./siteWebChannel.ts": siteWeb, "@/lib/siteWebChannel": siteWeb, "@/lib/inrAgentScheduledPayload": compactPayload,
    "@/lib/boosterCtaPreferences": { normalizeCtaPhone: (value: unknown) => value, normalizeCtaWebsiteUrl: (value: unknown) => value },
    "@/lib/scheduledPublicationDedupe": { findSimilarScheduledPublication: async (args: Row) => { assert.equal(args.userId, accountId); events.push("dedupe"); return { duplicate: !!options.duplicate }; } },
    "@/lib/scheduledCampaignDedupe": {},
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (_error: unknown, fallback: string) => fallback },
    "@/app/api/booster/publish-now/publishNow.foundations": { normalizeTiktokPublicationSettings: () => null },
    "@/lib/inrAgentPublicationRevision": { inrAgentPublicationNeedsRevisionReview: () => false },
    "@/lib/inrAgentSchedulePayloadBuilder": { buildScheduledPayload: async (...args: unknown[]) => { payloadScopes.push(args); events.push("payload"); return { actionType: "publication", targetTool: "booster", channels: ["facebook"], payload: preparedPayload }; } },
    "@/lib/scheduledPublicationMediaSnapshot": {
      getScheduledPublicationMediaWorkspaceId: (payload: Row) => payload.mediaWorkspaceId,
      hasScheduledPublicationMediaSnapshot: (payload: Row) => !!payload.snapshot,
      applyScheduledPublicationMediaSnapshot: (payload: Row, workspaceId: string) => ({ ...payload, mediaWorkspaceId: workspaceId, snapshot: true }),
      snapshotScheduledPublicationWorkspace: async (args: Row) => { assert.equal(args.accountId, accountId); assert.equal(args.sourceWorkspaceId, "source-workspace"); snapshotCount++; events.push("snapshot"); return snapshotCount === options.snapshotFailedAt ? null : { workspaceId: `copy-${snapshotCount}`, created: !options.reusedSnapshot }; },
    },
  };
  const cache = new Map<string, Record<string, unknown>>();
  const load = (name: string): Record<string, unknown> => {
    if (cache.has(name)) return cache.get(name)!;
    const source = readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loaded = { exports: {} as Record<string, unknown> }; cache.set(name, loaded.exports);
    new Function("module", "exports", "require", "console", code)(loaded, loaded.exports, (id: string) => {
      if (id in dependencies) return dependencies[id];
      if (["inrAgentScheduleService", "inrAgentSchedulePolicy", "inrAgentScheduledMediaSnapshot", "inrAgentActions", "inrAgentScheduledActions"].some(name => id === `@/lib/${name}`)) return load(id.slice("@/lib/".length));
      throw new Error(`Unexpected dependency ${id}`);
    }, { warn() {}, error() {} });
    return loaded.exports;
  };
  const actions = load("inrAgentActions") as typeof import("../../lib/inrAgentActions.ts");
  const service = load("inrAgentScheduleService") as typeof import("../../lib/inrAgentScheduleService.ts");
  return { events, queries, deletedWorkspaces, reported, payloadScopes, get actionRow() { return actionRow; }, run: () => service.scheduleValidatedInrAgentAction({
    context: { accountId, actorAuthUserId, isCron: false }, action: actions.rowToInrAgentAction(actionRow), scheduledAt,
    scheduleSelections: options.multipleRows ? [{ channel: "facebook", scheduledAt }, { channel: "facebook", scheduledAt: "2099-04-04T09:00:00Z" }] : [],
    automaticExecution: false, confirmingEditorialPlan: !options.manual, confirmingRevisionPlan: false,
    preferences: {}, onError: error => { reported.push(error); },
  }) };
}

test("RPC scheduling snapshots before success and keeps account and actor separate", async () => {
  const h = harness({ rpc: "success" }); const result = await h.run();
  assert.equal(result.status, 200); assert.equal((result.body as Row).scheduled, true);
  assert.deepEqual(h.events, ["payload", "dedupe", "rpc", "snapshot", "snapshot-write"]);
  assert.equal(h.payloadScopes[0][1], accountId); assert.equal(h.payloadScopes[0][3], actorAuthUserId);
});

test("an RPC replay with immutable snapshots creates neither rows nor new private copies", async () => {
  const h = harness({ rpc: "replay" }); const result = await h.run();
  assert.equal(result.status, 200); assert.equal((result.body as Row).alreadyScheduled, true);
  assert.deepEqual(h.events, ["payload", "dedupe", "rpc"]); assert.deepEqual(h.deletedWorkspaces, []);
});

test("missing RPC falls back to guarded claim, insert, snapshot then finalization", async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(h.actionRow.status, "scheduled");
  assert.deepEqual(h.events, ["payload", "dedupe", "rpc", "claim", "insert", "snapshot", "snapshot-write", "finalize"]);
});

test("a contended fallback claim cannot insert rows or snapshot media", async () => {
  const h = harness({ claimRefused: true }); const result = await h.run();
  assert.equal(result.status, 409); assert.equal((result.body as Row).code, "INR_AGENT_VALIDATION_ALREADY_HANDLED");
  assert.equal(h.events.includes("insert"), false); assert.equal(h.events.includes("snapshot"), false);
});

test("an insertion failure releases only the owned validation claim", async () => {
  const h = harness({ insertFailed: true }); const result = await h.run();
  assert.equal(result.status, 500); assert.equal(h.actionRow.status, "pending_validation");
  assert.equal(h.events.at(-1), "release"); assert.equal(h.events.includes("snapshot"), false);
});

test("partial snapshot failure cancels the rows and removes only copies created by this attempt", async () => {
  const h = harness({ multipleRows: true, snapshotFailedAt: 2 }); const result = await h.run();
  assert.equal(result.status, 500); assert.deepEqual(h.deletedWorkspaces, ["copy-1"]);
  assert.equal(h.events.includes("cancel"), true); assert.equal(h.actionRow.status, "pending_validation");
  assert.ok(h.events.indexOf("delete-snapshot") < h.events.indexOf("cancel"));
});

test("snapshot ownership is registered before its payload write can fail", async () => {
  const h = harness({ snapshotWriteFailed: true }); const result = await h.run();
  assert.equal(result.status, 500); assert.deepEqual(h.deletedWorkspaces, ["copy-1"]);
  assert.equal(h.actionRow.status, "pending_validation");
});

test("finalization failure cancels jobs, cleans owned snapshots and releases the claim", async () => {
  const h = harness({ finalizeFailed: true }); const result = await h.run();
  assert.equal(result.status, 500); assert.deepEqual(h.events.slice(-4), ["finalize", "cancel", "delete-snapshot", "release"]);
  assert.deepEqual(h.deletedWorkspaces, ["copy-1"]); assert.equal(h.actionRow.status, "pending_validation");
});

test("a reused snapshot is never deleted when finalization fails", async () => {
  const h = harness({ finalizeFailed: true, reusedSnapshot: true }); assert.equal((await h.run()).status, 500);
  assert.deepEqual(h.deletedWorkspaces, []); assert.equal(h.events.includes("cancel"), true);
});

test("duplicates and non-missing RPC failures cannot enter the compatibility insertion path", async () => {
  const duplicate = harness({ duplicate: true }); assert.equal((await duplicate.run()).status, 409); assert.deepEqual(duplicate.events, ["payload", "dedupe"]);
  const failed = harness({ rpc: "failed" }); assert.equal((await failed.run()).status, 400); assert.equal(failed.reported.length, 1); assert.equal(failed.events.includes("claim"), false); assert.equal(failed.events.includes("insert"), false);
});


test("RPC snapshot failure compensates the scheduled editorial action before reporting failure", async () => {
  const h = harness({ rpc: "success", snapshotFailedAt: 1 }); assert.equal((await h.run()).status, 500);
  assert.deepEqual(h.events.slice(-3), ["snapshot", "cancel", "release"]);
  assert.equal(h.actionRow.status, "pending_validation"); assert.deepEqual(h.deletedWorkspaces, []);
});

test("manual channel selection uses its updated_at claim for finalization and compensation", async () => {
  const success = harness({ manual: true }); assert.equal((await success.run()).status, 200);
  assert.equal(success.events.includes("rpc"), false); assert.equal(success.actionRow.status, "scheduled");
  const failure = harness({ manual: true, finalizeFailed: true }); assert.equal((await failure.run()).status, 500);
  assert.equal(failure.actionRow.status, "pending_validation"); assert.equal(failure.events.at(-1), "release");
});
