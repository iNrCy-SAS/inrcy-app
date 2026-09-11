import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

const client = read("app/dashboard/agent/AgentClient.tsx");
const scheduleRoute = read("app/api/agent/actions/schedule/route.ts");
const executeRoute = read("app/api/agent/actions/execute/route.ts");
const actionsRoute = read("app/api/agent/actions/route.ts");
const cronRoute = read("app/api/cron/inr-agent-scheduled-actions/route.ts");
const boosterPublish = read("app/dashboard/booster/publier/PublishModal.tsx");
const scheduledModel = read("lib/inrAgentScheduledActions.ts");
const migration = read(
  "ops/sql/2026-09-11_inr_agent_editorial_validation_deadline.sql",
);

test("Valider une actu datée par le robot confirme son plan sans ouvrir le choix publier/programmer", () => {
  const clickStart = client.indexOf(
    "if (scheduledEditSession) {\n                                void saveScheduledEditAtExistingDate();",
  );
  assert.ok(clickStart >= 0, "le clic Valider doit traiter l'édition programmée");
  const clickSource = client.slice(clickStart, clickStart + 1_500);

  assert.match(
    clickSource,
    /isRobotPlannedPublication\([\s\S]*?void confirmRobotPlannedPublication\(\)/,
  );
  assert.match(
    clickSource,
    /canSchedulePreparedAction\(selectedPreparedAction\)[\s\S]*?setValidationChoiceOpen\(true\)/,
  );
  assert.ok(
    clickSource.indexOf("confirmRobotPlannedPublication") <
      clickSource.indexOf("setValidationChoiceOpen(true)"),
    "le plan robot doit être confirmé avant le chemin manuel Préparer maintenant",
  );

  const confirmSource = client.slice(
    client.indexOf("async function confirmRobotPlannedPublication"),
    client.indexOf("async function saveScheduledEditAtExistingDate"),
  );
  assert.match(confirmSource, /confirmExistingPlan: true/);
  assert.doesNotMatch(confirmSource, /scheduleSelections|scheduledAt:/);
});

test("une programmation Booster est déjà validée et son édition conserve sa date", () => {
  assert.match(boosterPublish, /source: "manual"/);
  assert.match(boosterPublish, /source: "booster_scheduled"/);
  assert.match(boosterPublish, /kind: "manual_publish_schedule"/);
  assert.match(scheduledModel, /status: "scheduled"/);
  assert.match(
    cronRoute,
    /async function syncSourceActionOutcome[\s\S]*?explicitSourceActionId[\s\S]*?\.not\("validated_at", "is", null\)/,
  );
  assert.match(cronRoute, /syncSourceActionOutcome\(claimed, "completed"\)/);

  const editSource = client.slice(
    client.indexOf("async function saveScheduledEditAtExistingDate"),
    client.indexOf("async function scheduleValidatedCampaign"),
  );
  assert.match(
    editSource,
    /session\.scheduledAction\.scheduledAt \|\| session\.action\.scheduledFor/,
  );
  assert.match(editSource, /saveScheduledEditPublication\(selections\)/);
  assert.match(editSource, /exitScheduledEditSession\(\{ silent: true, force: true \}\)/);

  const clickSource = client.slice(
    client.indexOf("if (scheduledEditSession) {\n                                void saveScheduledEditAtExistingDate();"),
    client.indexOf("if (\n                                canSchedulePreparedAction"),
  );
  assert.doesNotMatch(clickSource, /setValidationChoiceOpen|updateActionStatus/);
});

test("la confirmation atomique utilise la date stockée et exclut la course avec l'échéance", () => {
  assert.match(
    scheduleRoute,
    /La validation confirme le plan existant[\s\S]*?scheduledAt = plannedDate\.toISOString\(\);[\s\S]*?scheduleSelections = \[\];/,
  );
  assert.match(
    scheduleRoute,
    /rpc\(\s*"inrcy_confirm_editorial_publication_schedule"/,
  );
  assert.match(scheduleRoute, /p_rows: rows/);
  assert.match(scheduleRoute, /p_schedule_selections: normalizedScheduleSelections/);
  assert.match(scheduleRoute, /INR_AGENT_VALIDATION_EXPIRED/);
  assert.match(
    executeRoute,
    /asRecord\(action\.payload\?\.editorialPlan\)[\s\S]*?INR_AGENT_EDITORIAL_SCHEDULE_REQUIRED/,
  );
  assert.match(
    actionsRoute,
    /\["validated", "scheduled", "pending", "pending_validation"\][\s\S]*?asRecord\(statusAction\.payload\?\.editorialPlan\)[\s\S]*?INR_AGENT_EDITORIAL_SCHEDULE_REQUIRED/,
  );

  assert.match(migration, /for update;/i);
  assert.match(migration, /v_action\.scheduled_for <= v_now/);
  assert.match(
    migration,
    /insert into public\.inr_agent_scheduled_actions[\s\S]*?v_action\.scheduled_for/,
  );
  assert.match(
    migration,
    /update public\.inr_agent_actions[\s\S]*?status = 'scheduled'/,
  );
  assert.match(migration, /grant execute[\s\S]*?to service_role/);
  assert.match(migration, /revoke all[\s\S]*?from public, anon, authenticated/);
});

test("à l'échéance seules les actus éditoriales non validées passent en refusé", () => {
  const refusalSource = cronRoute.slice(
    cronRoute.indexOf("async function refuseExpiredEditorialValidations"),
    cronRoute.indexOf("async function claimAction"),
  );

  for (const guard of [
    '.eq("automation_key", "publish")',
    '.eq("action_type", "publication")',
    '.eq("target_tool", "booster")',
    '.eq("status", "pending_validation")',
    '.eq("execution_policy", "manual_validation")',
    '.eq("validation_required", true)',
    '.lte("scheduled_for", args.nowIso)',
    '.contains("metadata", { editorialPlan: true })',
  ]) {
    assert.ok(refusalSource.includes(guard), `garde manquante : ${guard}`);
  }
  assert.match(refusalSource, /status: "refused"/);
  assert.match(refusalSource, /refused_at: args\.nowIso/);
  assert.match(cronRoute, /expiredEditorialValidations/);
  assert.match(
    migration,
    /idx_inr_agent_actions_editorial_validation_due[\s\S]*?scheduled_for asc/,
  );
});

test("le repli sans RPC reste compare-and-set et annule tout job orphelin", () => {
  assert.match(scheduleRoute, /\.gt\("scheduled_for", claimNow\)/);
  assert.match(
    scheduleRoute,
    /\.eq\("status", "executing"\)[\s\S]*?\.eq\("validated_at", editorialValidationClaimedAt\)/,
  );
  assert.match(
    scheduleRoute,
    /\.in\("id", scheduledActionIds\)[\s\S]*?\.eq\("status", "scheduled"\)/,
  );
  assert.match(scheduleRoute, /await releaseScheduleClaims\(\)/);
});
