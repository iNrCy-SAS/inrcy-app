import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";
import { canReviseInrAgentPublication, inrAgentPublicationRevisionSchedule } from "../../lib/inrAgentPublicationRevision.ts";

const firstDate = "2026-11-11T17:00:00.000Z";
const secondDate = "2026-11-12T08:30:00.000Z";
function action(status = "scheduled") {
  return { id: "source-action", automationKey: "publish", actionType: "publication", targetTool: "booster", status,
    scheduledFor: firstDate, validatedAt: "2026-10-20T12:00:00Z", completedAt: null, updatedAt: "2026-10-21T12:00:00Z",
    targetChannels: ["facebook", "instagram"], payload: {
      idea: "Sujet existant", postByChannel: { facebook: { content: "Facebook initial" }, instagram: { content: "Instagram initial" } },
      scheduledExecution: { scheduledActionIds: ["job-facebook", "job-instagram"] },
    } };
}
function harness({ status = "scheduled", started = false, stale = false, saveFails = false } = {}) {
  const original = action(status);
  const state = { source: { id: original.id, status, updated_at: original.updatedAt, payload: structuredClone(original.payload),
      scheduled_for: original.scheduledFor, validated_at: original.validatedAt },
    rows: [
      { id: "job-facebook", channels: ["facebook"], scheduled_at: firstDate, status: "scheduled", updated_at: original.updatedAt,
        payload: { sourceActionId: original.id, publishPayload: { post: "Ancienne version Facebook" } }, timezone: "Europe/Paris" },
      { id: "job-instagram", channels: ["instagram"], scheduled_at: secondDate, status: "scheduled", updated_at: original.updatedAt,
        payload: { sourceActionId: original.id, publishPayload: { post: "Ancienne version Instagram" } }, timezone: "Europe/Paris" },
    ] };
  const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
  const rpcCalls: Array<Record<string, unknown>> = [];
  let remainingSourceFailures = saveFails ? 1 : 0;
  const db = {
    async rpc(_name: string, args: Record<string, unknown>) {
      rpcCalls.push(args);
      if (started) return { error: null, data: { outcome: "publication_started" } };
      if ((args.p_channels as string[]).length) {
        for (const row of state.rows) {
          row.channels = (row.payload as Record<string, unknown>).publicationChannelSelectionRowChannels as string[];
          row.status = "scheduled";
          row.payload = { ...row.payload, publicationChannelSelectionPaused: false } as typeof row.payload;
        }
        state.source.updated_at = "2026-10-23T12:01:00Z";
        return { error: null, data: { outcome: "saved", action: structuredClone(state.source), scheduledActions: structuredClone(state.rows) } };
      }
      state.source.updated_at = "2026-10-23T12:00:00Z";
      for (const row of state.rows) {
        row.payload = { ...row.payload, publicationChannelSelectionRowChannels: row.channels,
          publicationChannelSelectionPaused: true } as typeof row.payload;
        row.channels = [];
        row.status = "cancelled";
        row.updated_at = state.source.updated_at;
      }
      return { error: null, data: { outcome: "saved", action: structuredClone(state.source), scheduledActions: structuredClone(state.rows) } };
    },
    from(table: string) {
      let patch: Record<string, unknown> = {};
      let writing = false;
      const filters: Array<[string, unknown]> = [];
      const query = {
        update(value: Record<string, unknown>) { writing = true; patch = value; writes.push({ table, patch }); return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        select() { return query; },
        async maybeSingle() {
          if (stale && table === "inr_agent_actions") return { data: null, error: null };
          if (writing && table === "inr_agent_actions" && remainingSourceFailures > 0) {
            remainingSourceFailures -= 1;
            return { data: null, error: { message: "Transient write failure" } };
          }
          const row = table === "inr_agent_actions" ? state.source : state.rows.find(row => filters.some(([key, value]) => key === "id" && row.id === value));
          if (!row || filters.some(([key, value]) => key !== "user_id" && (row as Record<string, unknown>)[key] !== value)) return { data: null, error: null };
          Object.assign(row, structuredClone(patch));
          return { data: structuredClone(row), error: null };
        },
      };
      return query;
    },
  };
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/inrAgentActions": { rowToInrAgentAction: (row: Record<string, unknown>) => ({ ...original, ...row, payload: row.payload,
      updatedAt: row.updated_at, validatedAt: row.validated_at, scheduledFor: row.scheduled_for }) },
  });
  const revisionModule = load<{ saveInrAgentPublicationRevision: (args: Record<string, unknown>) => Promise<ReturnType<typeof action>> }>("lib/inrAgentPublicationRevisionServer.ts");
  return { ...revisionModule, original, state, writes, rpcCalls };
}

test("validées et programmées restent modifiables, une diffusion commencée reste protégée", () => {
  for (const status of ["prepared", "pending_validation", "pending", "draft", "validated", "scheduled"]) {
    assert.equal(canReviseInrAgentPublication(action(status)), true, status);
  }
  for (const status of ["executing", "completed", "refused", "cancelled", "failed"]) {
    assert.equal(canReviseInrAgentPublication(action(status)), false, status);
  }
  assert.equal(canReviseInrAgentPublication({ ...action(), completedAt: "2026-10-23T10:00:00Z" }), false);
});

test("une nouvelle version attend validation au même instant pour chaque canal", async () => {
  const h = harness();
  const payload = structuredClone(h.original.payload);
  payload.postByChannel.facebook.content = "Nouvelle version Facebook";
  const saved = await h.saveInrAgentPublicationRevision({ accountId: "account", action: h.original, payload });
  assert.equal(saved.id, h.original.id);
  assert.equal(saved.status, "pending_validation");
  assert.equal(saved.validatedAt, null);
  assert.equal(saved.scheduledFor, firstDate);
  assert.equal(saved.payload.postByChannel.instagram.content, "Instagram initial");
  assert.deepEqual(inrAgentPublicationRevisionSchedule(saved.payload), [
    { channel: "facebook", scheduledAt: firstDate }, { channel: "instagram", scheduledAt: secondDate },
  ]);
  assert.equal(h.rpcCalls.length, 1);
  assert.deepEqual(h.rpcCalls[0].p_channels, []);
  assert.ok(h.state.rows.every(row => row.status === "cancelled" && (row.payload as Record<string, unknown>).publicationChannelSelectionPaused === false));
  assert.deepEqual((saved.payload.scheduledExecution as Record<string, unknown>).scheduledActionIds, []);
  assert.ok(h.writes.every(write => !Object.hasOwn(write.patch, "scheduled_for") && !Object.hasOwn(write.patch, "scheduled_at")));
  assert.equal(h.state.rows[0].payload.publishPayload.post, "Ancienne version Facebook");
});

test("une action encore en attente est sauvegardée sans toucher aux programmations", async () => {
  const h = harness({ status: "pending_validation" });
  await h.saveInrAgentPublicationRevision({ accountId: "account", action: h.original, payload: h.original.payload });
  assert.equal(h.rpcCalls.length, 0);
  assert.deepEqual(h.writes.map(write => write.table), ["inr_agent_actions"]);
});

test("une course avec le dispatcher ne remplace jamais les contenus ni les jobs en cours", async () => {
  const h = harness({ started: true });
  const before = structuredClone(h.state);
  await assert.rejects(h.saveInrAgentPublicationRevision({ accountId: "account", action: h.original, payload: { idea: "Nouveau" } }), /diffusion a commencé/);
  assert.deepEqual(h.state, before);
  assert.equal(h.writes.length, 0);
});

test("une version périmée échoue avec un conflit sans réactiver une ancienne diffusion", async () => {
  const h = harness({ stale: true });
  await assert.rejects(h.saveInrAgentPublicationRevision({ accountId: "account", action: h.original, payload: { idea: "Nouveau" } }), /programmation peut être suspendue/);
  assert.equal(h.state.source.payload.idea, "Sujet existant");
  assert.ok(h.state.rows.every(row => row.status === "cancelled"));
});

test("un échec d’écriture restaure la programmation précédente quand sa révision est toujours inchangée", async () => {
  const h = harness({ saveFails: true });
  await assert.rejects(h.saveInrAgentPublicationRevision({ accountId: "account", action: h.original, payload: { idea: "Nouveau" } }), /publication a changé/);
  assert.equal(h.state.source.payload.idea, "Sujet existant");
  assert.equal(h.state.source.status, "scheduled");
  assert.equal(h.rpcCalls.length, 2);
  assert.deepEqual(h.rpcCalls[1].p_channels, ["facebook", "instagram"]);
  assert.deepEqual(h.state.rows.map(row => [row.channels, row.scheduled_at, row.status]), [
    [["facebook"], firstDate, "scheduled"], [["instagram"], secondDate, "scheduled"],
  ]);
});
