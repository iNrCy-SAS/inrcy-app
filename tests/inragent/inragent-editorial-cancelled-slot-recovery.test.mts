import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  deterministicEditorialActionId,
  editorialPlanEpoch,
  nextEditorialPlanEpoch,
  shouldReplaceTerminalEditorialRow,
} from "../../lib/inrAgentEditorialRecoveryPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

const septemberRefusal = {
  status: "cancelled",
  refused_at: "2026-09-24T18:59:55.000Z",
  created_at: "2026-09-24T18:28:05.000Z",
  updated_at: "2026-09-24T19:01:05.000Z",
  metadata: { editorialPlan: true, editorialCancelReason: null },
};
const octoberActivation = "2026-10-03T08:39:53.643Z";

test("un refus ancien devenu cancelled reste intact mais libère le créneau d'une nouvelle activation", () => {
  assert.equal(
    shouldReplaceTerminalEditorialRow(septemberRefusal, octoberActivation),
    true,
  );
  assert.equal(
    shouldReplaceTerminalEditorialRow(septemberRefusal, "2026-09-24T18:00:00.000Z"),
    false,
  );
  assert.equal(shouldReplaceTerminalEditorialRow(septemberRefusal, null), false);
});

test("un refus dans l'époque courante ne doit jamais être recréé par les crons", () => {
  for (const status of ["refused", "cancelled"]) {
    const row = {
      status,
      refused_at: "2026-10-05T08:41:00.000Z",
      created_at: octoberActivation,
      updated_at: "2026-10-05T08:42:00.000Z",
      metadata: { editorialPlanEpoch: octoberActivation },
    };
    assert.equal(shouldReplaceTerminalEditorialRow(row, octoberActivation), false);
    const epochAfterIdeaSave = nextEditorialPlanEpoch({
      previousMetadata: row.metadata,
      calendarChanged: false,
      nowIso: "2026-10-05T08:45:00.000Z",
    });
    assert.equal(
      shouldReplaceTerminalEditorialRow(row, epochAfterIdeaSave),
      false,
      "l'epoch inscrit sur la ligne empêche de la recréer dans son époque",
    );
    assert.equal(
      shouldReplaceTerminalEditorialRow(row, "2026-10-06T08:00:00.000Z"),
      true,
      "une nouvelle activation réelle peut créer une nouvelle action, sans modifier le refus",
    );
  }
});

test("une annulation automatique sans refus garde son chemin de réactivation", () => {
  assert.equal(
    shouldReplaceTerminalEditorialRow(
      {
        status: "cancelled",
        updated_at: "2026-09-24T19:01:05.000Z",
        metadata: { editorialCancelReason: "automation_disabled" },
      },
      octoberActivation,
    ),
    false,
  );
  assert.equal(
    shouldReplaceTerminalEditorialRow(
      { ...septemberRefusal, metadata: { editorialCancelReason: "automation_disabled" } },
      octoberActivation,
    ),
    true,
    "refused_at prime toujours sur un motif d'annulation automatique",
  );
});

test("l'époque legacy est figée lors d'un save d'idée ; seul le calendrier la renouvelle", () => {
  const previousMetadata = { lastSettingsSavedAt: octoberActivation };
  assert.equal(editorialPlanEpoch(previousMetadata), octoberActivation);
  assert.equal(
    nextEditorialPlanEpoch({
      previousMetadata,
      calendarChanged: false,
      nowIso: "2026-10-04T08:00:00.000Z",
    }),
    octoberActivation,
  );
  assert.equal(
    nextEditorialPlanEpoch({
      previousMetadata: {},
      calendarChanged: false,
      nowIso: "2026-10-04T08:00:00.000Z",
    }),
    "1970-01-01T00:00:00.000Z",
    "un tout premier save sans changement ne rouvre pas un vieux refus",
  );
  assert.equal(
    nextEditorialPlanEpoch({
      previousMetadata: { ...previousMetadata, editorialPlanEpoch: octoberActivation },
      calendarChanged: true,
      nowIso: "2026-10-04T08:00:00.000Z",
    }),
    "2026-10-04T08:00:00.000Z",
  );
  assert.equal(
    nextEditorialPlanEpoch({
      previousMetadata,
      calendarChanged: true,
      nowIso: "2026-10-04T08:00:00.000Z",
      deferredUntil: "2026-10-20T13:30:00.000Z",
    }),
    "2026-10-20T13:30:00.000Z",
  );
});

test("l'ID du nouveau créneau est stable dans son époque et distinct de l'ancien", () => {
  const args = { version: 1, userId: "renosurface", slotKey: "2026-10-09T13:30:00.000Z" };
  const legacy = deterministicEditorialActionId(args);
  const next = deterministicEditorialActionId({ ...args, planEpoch: octoberActivation });
  assert.notEqual(next, legacy);
  assert.equal(
    deterministicEditorialActionId({ ...args, planEpoch: octoberActivation }),
    next,
  );
  assert.notEqual(
    deterministicEditorialActionId({ ...args, planEpoch: "2026-10-04T08:00:00.000Z" }),
    next,
  );
});

test("la réconciliation exclut l'ancien refus du slot courant sans le modifier", () => {
  const server = read("lib/inrAgentEditorialPlanServer.ts");
  assert.match(server, /metadata,refused_at,created_at,updated_at/);
  assert.match(server, /\.filter\(\(row\) => !shouldReplaceTerminalEditorialRow\(row, planEpoch\)\)/);
  assert.match(server, /inrAgentEditorialActionId\(args\.userId, slot\.slotKey, planEpoch\)/);
  assert.match(server, /editorialPlanEpoch: planEpoch/);
  assert.match(server, /\.filter\(\(slot\) => !existingBySlot\.has\(slot\.slotKey\)\)/);
  assert.match(server, /row\.status === "cancelled" &&\s*!row\.refused_at/);
  assert.match(server, /editorialCancelReason: null/);
});

test("la route de réglages ne renouvelle l'époque que pour un vrai changement de calendrier", () => {
  const route = read("app/api/agent/settings/route.ts");
  assert.match(route, /scheduleSignature\(existingByKey\.get\("publish"\)\)/);
  assert.match(route, /activePublishAutomation\.planningHorizonDays !==/);
  assert.match(route, /activeEditorialTimezone !==/);
  assert.match(route, /calendarChanged: publishCalendarChanged/);
  assert.match(route, /editorialPlanEpoch: nextPublishEpoch/);
  assert.match(route, /editorialPlanEpoch: previousPublishEpoch/);
});
