import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

const snapshot = read("lib/scheduledPublicationMediaSnapshot.ts");
const scheduleRoute = read("app/api/agent/scheduled-actions/route.ts");
const agentScheduleRoute = read("app/api/agent/actions/schedule/route.ts");
const asyncPublication = read("lib/boosterAsyncPublication.ts");

test("a Booster schedule snapshots its workspace media before it is accepted", () => {
  assert.match(scheduleRoute, /snapshotScheduledPublicationWorkspace\(\{/);
  assert.match(scheduleRoute, /applyScheduledPublicationMediaSnapshot\(/);
  assert.match(scheduleRoute, /sourceMediaWorkspaceId/);
  assert.match(scheduleRoute, /les médias n’ont pas pu être figés de façon fiable/);
  assert.match(snapshot, /scheduled-publication:\$\{scheduledActionId\}/);
  assert.match(snapshot, /publication_workspace_media/);
  assert.match(snapshot, /source_workspace_id/);
  assert.match(snapshot, /scheduled_media_snapshot: true/);
  assert.match(snapshot, /source_module: "booster_scheduled_snapshot"/);
});

test("all iNr'Agent scheduling paths snapshot every created publication row", () => {
  assert.match(agentScheduleRoute, /snapshotAgentScheduledPublicationRows/);
  assert.match(agentScheduleRoute, /sourceMediaWorkspaceId/);
  assert.match(agentScheduleRoute, /mediaWorkspaceId: sourceMediaWorkspaceId/);
  assert.match(agentScheduleRoute, /createdScheduledRows = snapshotResult\.rows/);
  assert.match(agentScheduleRoute, /cancelScheduledPublicationRowsAfterSnapshotFailure/);
  assert.match(
    agentScheduleRoute,
    /editorial scheduled publication media snapshot failed/,
  );
  assert.match(agentScheduleRoute, /snapshottedRows = snapshotResult\.rows/);
  assert.match(agentScheduleRoute, /hasScheduledPublicationMediaSnapshot/);
  assert.match(
    agentScheduleRoute,
    /if \(snapshot\.created\) createdWorkspaceIds\.push\(snapshot\.workspaceId\);[\s\S]*const updated/,
  );
  assert.match(
    agentScheduleRoute,
    /cleanupScheduledPublicationSnapshotWorkspaces\(\{[\s\S]*workspaceIds: createdSnapshotWorkspaceIds/,
  );
});

test("the durable aggregate stays partial when any prepared channel succeeds", () => {
  assert.match(asyncPublication, /summary\.allFailed\s*\?\s*"failed"\s*:\s*summary\.failureCount > 0\s*\?\s*"partial"/);
  assert.match(asyncPublication, /status: params\.summary\.allFailed \? "failed" : "published"/);
  assert.match(asyncPublication, /successfulChannels: params\.summary\.successChannels/);
});
