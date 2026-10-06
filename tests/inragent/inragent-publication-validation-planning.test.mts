import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { publicationValidationState } from "../../app/dashboard/agent/_lib/agent.publication-validation.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

test("le choix de validation garde la même couleur pendant le cycle de publication", () => {
  assert.equal(publicationValidationState(null), "pending");
  assert.equal(publicationValidationState({ status: "pending_validation", validatedAt: null }), "pending");
  assert.equal(publicationValidationState({ status: "scheduled", validatedAt: "2026-10-06T08:00:00Z" }), "validated");
  assert.equal(publicationValidationState({ status: "scheduled", validatedAt: null }), "validated");
  assert.equal(publicationValidationState({ status: "executing", validatedAt: "2026-10-06T08:00:00Z" }), "validated");
  assert.equal(publicationValidationState({ status: "failed", validatedAt: "2026-10-06T08:00:00Z" }), "validated");
  assert.equal(publicationValidationState({ status: "refused", validatedAt: "2026-10-06T08:00:00Z" }), "refused");
});

test("le planning lit la validation de l'action et se recharge à son ouverture", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const scheduleItems = read("app/dashboard/agent/_lib/agent.schedule-items.ts");
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");
  const scheduleRoute = read("app/api/agent/actions/schedule/route.ts");

  assert.match(scheduleRoute, /status: "scheduled",[\s\S]*?validated_at: automaticExecution/);
  assert.match(client, /const selectedPublicationValidationState = publicationValidationState\(/);
  assert.match(client, /setScheduleOpen\(true\);\s*void refreshActions\(true\);/);
  assert.match(scheduleItems, /const validationState = publicationValidationState\(action\);[\s\S]*?approvalState:/);
  assert.match(scheduleItems, /publication\.status === "refused"[\s\S]*?approvalState:/);
  assert.match(modal, /if \(item\.approvalState\) return item\.approvalState;/);
  assert.match(modal, /item\.source !== "history" \|\| item\.approvalState \? \(/);
  assert.match(modal, /data-state=\{approvalState\}/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="approved"\]\s*\{\s*background: #34d399;/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="pending"\]\s*\{\s*background: #fb923c;/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="refused"\]\s*\{\s*background: #fb7185;/);
});
