import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  agentPublicationHistoryWindow,
  isMissingAgentHistoryTable,
  mergeAgentPublicationHistory,
  parisHistoryCalendarParts,
  type AgentHistoryActionRow,
  type AgentHistoryEventRow,
  type AgentHistoryScheduledRow,
} from "../../lib/inrAgentPublicationHistory.ts";

const from = "2026-08-01T00:00:00.000Z";
const to = "2026-11-01T00:00:00.000Z";

function action(id: string, status: string, payload: unknown = {}): AgentHistoryActionRow {
  return {
    id,
    title: `Action ${id}`,
    target_channels: ["facebook"],
    target_themes: ["Conseils"],
    payload,
    status,
    scheduled_for: "2026-09-12T09:00:00.000Z",
    completed_at: null,
    refused_at: null,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-09-12T09:00:00.000Z",
  };
}

function scheduled(id: string, status: string): AgentHistoryScheduledRow {
  return {
    id,
    title: `Programmation ${id}`,
    channels: ["instagram"],
    payload: {},
    status,
    scheduled_at: "2026-10-05T09:00:00.000Z",
    executed_at: null,
    created_at: "2026-09-01T09:00:00.000Z",
    updated_at: "2026-10-05T09:00:00.000Z",
  };
}

test("la fenêtre conserve les deux mois révolus et le mois courant", () => {
  const window = agentPublicationHistoryWindow(new Date(2026, 9, 3));
  assert.equal(window.from, "2026-07-31T22:00:00.000Z");
  assert.equal(window.to, "2026-10-31T23:00:00.000Z");
  assert.deepEqual(parisHistoryCalendarParts("2026-07-31T22:15:00.000Z"), {
    year: 2026, month: 8, day: 1, hour: 0, minute: 15,
  });
});

test("seules les tables réellement absentes sont ignorées, pas les erreurs d'accès", () => {
  const table = "inr_agent_scheduled_actions";
  assert.equal(isMissingAgentHistoryTable({ code: "42P01" }), true);
  assert.equal(isMissingAgentHistoryTable({ code: "PGRST205" }), true);
  assert.equal(isMissingAgentHistoryTable({ message: `relation "${table}" does not exist` }), false);
  assert.equal(isMissingAgentHistoryTable({ message: `permission denied for table ${table}` }), false);
  assert.equal(isMissingAgentHistoryTable({ message: `column source does not exist on ${table}` }), false);
});

test("les événements iNr'Send sont prioritaires et les refus et annulations restent visibles", () => {
  const events: AgentHistoryEventRow[] = [
    {
      id: "success-event",
      type: "publish",
      created_at: "2026-08-20T09:00:00.000Z",
      payload: {
        source: "inr_agent",
        origin: { source: "inr_agent", agentActionId: "published-action" },
        publication_id: "publication-1",
        attemptedChannels: ["facebook"],
        post: { title: "La rentrée" },
        summary: { successCount: 1, failureCount: 0 },
      },
    },
    {
      id: "partial-event",
      type: "publish",
      created_at: "2026-09-07T10:00:00.000Z",
      payload: {
        source: "inr_agent",
        origin: { source: "inr_agent", scheduledActionId: "published-schedule" },
        publication_id: "publication-2",
        attemptedChannels: ["facebook", "instagram"],
        summary: { successCount: 1, failureCount: 1 },
      },
    },
    {
      id: "manual-event",
      type: "publish",
      created_at: "2026-09-08T10:00:00.000Z",
      payload: { source: "booster_manual", summary: { successCount: 1 } },
    },
  ];
  const history = mergeAgentPublicationHistory({
    events,
    actions: [
      action("published-action", "completed", { execution: { publicationId: "publication-1" } }),
      action("refused-action", "refused"),
      action("failed-action", "failed"),
    ],
    scheduledActions: [
      scheduled("published-schedule", "done"),
      scheduled("cancelled-schedule", "cancelled"),
    ],
    from,
    to,
  });
  assert.equal(history.length, 5);
  assert.deepEqual(history.map((item) => item.status).sort(),
    ["completed", "partial", "refused", "failed", "cancelled"].sort());
  assert.equal(history.find((item) => item.id === "event-success-event")?.contentTitle, "La rentrée");
  assert.deepEqual(history.find((item) => item.id === "event-partial-event")?.channels,
    ["facebook", "instagram"]);
  assert.equal(history.filter((item) => item.agentActionId === "published-action").length, 1);
  assert.equal(history.filter((item) => item.scheduledActionId === "published-schedule").length, 1);
});

test("la projection n'impose pas de limite de 120 événements et exclut les mois antérieurs", () => {
  const events: AgentHistoryEventRow[] = Array.from({ length: 161 }, (_, index) => ({
    id: `event-${index}`,
    type: "publish",
    created_at: "2026-10-03T10:00:00.000Z",
    payload: { source: "inr_agent", origin: { source: "inr_agent" }, channels: ["facebook"] },
  }));
  events.push({
    id: "old-event",
    type: "publish",
    created_at: "2026-07-31T12:00:00.000Z",
    payload: { source: "inr_agent" },
  });
  const history = mergeAgentPublicationHistory({ events, actions: [], scheduledActions: [], from, to });
  assert.equal(history.length, 161);
  assert.ok(history.every((item) => item.status === "completed"));
});

test("le secours des actions programmées conserve les états asynchrones et partiels", () => {
  const processing = scheduled("async-schedule", "done");
  processing.payload = {
    sourceActionId: "origin-action",
    lastExecution: { status: "processing", publishResult: { processing: true } },
  };
  const partial = scheduled("partial-schedule", "done");
  partial.payload = {
    lastExecution: { status: "success", publishResult: { summary: { successCount: 1, failureCount: 1 } } },
  };
  const failed = scheduled("failed-schedule", "done");
  failed.payload = {
    lastExecution: { status: "success", publishResult: { summary: { successCount: 0, failureCount: 2 } } },
  };
  const history = mergeAgentPublicationHistory({
    events: [],
    actions: [action("origin-action", "completed", {
      scheduledExecution: { scheduledActionIds: ["async-schedule"] },
    })],
    scheduledActions: [processing, partial, failed], from, to,
  });
  assert.deepEqual(history.map((item) => item.status).sort(), ["processing", "partial", "failed"].sort());
  assert.equal(history.find((item) => item.id === "scheduled-async-schedule")?.agentActionId, "origin-action");
});

test("un événement sans identifiant d’action masque encore sa programmation source", () => {
  const scheduledRow = scheduled("historic-schedule", "done");
  scheduledRow.payload = { sourceActionId: "historic-action" };
  const history = mergeAgentPublicationHistory({
    events: [{
      id: "historic-event", type: "publish", created_at: "2026-10-05T10:00:00.000Z",
      payload: { source: "inr_agent", origin: { scheduledActionId: "historic-schedule" } },
    }],
    actions: [action("historic-action", "completed", {
      scheduledExecution: { scheduledActionIds: ["historic-schedule"] },
    })],
    scheduledActions: [scheduledRow], from, to,
  });
  assert.deepEqual(history.map((item) => item.id), ["event-historic-event"]);
});

test("l'icône calendrier ouvre l'éditeur uniquement pour une publication programmée", () => {
  const client = readFileSync(resolve(import.meta.dirname, "../../app/dashboard/agent/AgentClient.tsx"), "utf8");
  const scheduleItems = readFileSync(resolve(import.meta.dirname, "../../app/dashboard/agent/_lib/agent.schedule-items.ts"), "utf8");
  assert.match(client, /hasPreparedAction && selectedPreparedAction\?\.scheduledFor/);
  assert.match(client, /const showFooterDate = !isPublishView \|\| Boolean\(selectedPreparedAction\?\.scheduledFor\)/);
  assert.match(client, /\{showFooterDate \? <div/);
  assert.match(client, /const displayedPublicationScheduleItem = isPublishView && selectedPreparedAction\?\.scheduledFor/);
  assert.match(client, /linkedScheduledActionIds\.includes\(item\.scheduledActionId \|\| ""\)/);
  assert.match(scheduleItems, /preparedActionId: String\(asRecord\(action\.payload\)\?\.sourceActionId \|\| ""\)/);
  assert.match(client, /onClick=\{\(\) => handleScheduleRowReschedule\(displayedPublicationScheduleItem\)\}/);
  assert.match(client, /aria-label=\{i18nT\("modifier_la_programmation_2bdd7cdc"\)\}/);
});
