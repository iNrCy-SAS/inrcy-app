import assert from "node:assert/strict";
import test from "node:test";
import { inrAssistantUiSteps, parseInrAssistantUiSteps, bindInrAssistantUiSteps } from "../../lib/inrAssistantUiTask.ts";
import { resolveInrAssistantUiTaskResults } from "../../lib/inrAssistantUiTaskContinuation.ts";
import { inrAssistantUiActionsFromToolResult, type InrAssistantUiResult } from "../../lib/inrAssistantUiActions.ts";

const screen = { pathname: "/dashboard/ads", tool: "Ads", selection: { kind: "campaign" as const, id: "campaign_1" }, revision: "rev_1", availableCommands: ["configure_ads_draft" as const] };
const instruction = "Renomme cette campagne publicitaire en Offre été, puis crée un contact CRM Alice.";
const steps = inrAssistantUiSteps(instruction, { source: "untrusted_client", screen });
const actions = inrAssistantUiActionsFromToolResult("ui-call", { ok: true, uiCommand: { command: "configure_ads_draft", selection: screen.selection, revision: screen.revision, patch: { name: "Offre été" } } });
const source = { turnId: "11111111-1111-4111-8111-111111111111", createdAt: new Date().toISOString() };
const bound = bindInrAssistantUiSteps([{ ...steps[0], actions }], actions, source);

test("only a parsed mounted capability creates a UI step; quoted or conditional actions do not", () => {
  assert.equal(steps.length, 1);
  for (const context of [undefined, { source: "untrusted_client" as const, screen: { ...screen, revision: undefined } }, { source: "untrusted_client" as const, screen: { ...screen, pathname: "/dashboard/crm" } }]) assert.equal(inrAssistantUiSteps(instruction, context).length, 0);
  for (const message of [`Explique ce texte : « ${instruction} »`, `Si je confirme, ${instruction}`, `Ne renomme pas cette campagne publicitaire.`]) assert.equal(inrAssistantUiSteps(message, { source: "untrusted_client", screen }).length, 0);
  assert.equal(parseInrAssistantUiSteps(bound)?.length, 1);
});

test("private UI plan validation rejects forged capabilities, source paths, unbounded steps and mismatched commands", () => {
  for (const value of [[{ ...bound[0], command: "executePayment" }], [{ ...bound[0], source: { ...source, turnId: "../other" } }], [{ ...bound[0], source: { ...source, createdAt: "not-a-date" } }], [{ ...bound[0], actions: [] }], Array.from({ length: 25 }, () => bound[0]), [{ ...bound[0], instruction: "x".repeat(4001) }], [{ ...bound[0], screen: { ...screen, selection: { kind: "invoice", id: "other" } } }]]) assert.equal(parseInrAssistantUiSteps(value), null);
});

test("continuation uses the complete original replay fingerprint, exact action bytes and immutable browser status", async () => {
  for (const status of [undefined, "applied", "failed", "cancelled"] as const) {
    const results: InrAssistantUiResult[] = status ? [{ actionId: actions[0].id, source: "browser_reported", status }] : [];
    let calls = 0;
    const resolved = await resolveInrAssistantUiTaskResults(bound, async requested => { assert.deepEqual(requested, source); return { uiActions: actions }; }, async (requested, actual) => { calls++; assert.deepEqual(requested, source); assert.deepEqual(actual, actions); return results; });
    assert.deepEqual(resolved, [{ stepId: bound[0].id, status: status ?? "pending" }]);
    assert.equal(calls, 1);
  }
  await assert.rejects(resolveInrAssistantUiTaskResults(bound, async () => null, async () => []), /unavailable/);
  const changed = structuredClone(actions); if (changed[0].type === "command" && changed[0].command.command === "configure_ads_draft") changed[0].command.patch.name = "Other";
  await assert.rejects(resolveInrAssistantUiTaskResults(bound, async () => ({ uiActions: changed }), async () => []), /changed/);
  const unbound = [{ ...steps[0], actions }];
  assert.deepEqual(await resolveInrAssistantUiTaskResults(unbound, async () => { assert.fail("An unbound checkpoint must not guess a turn"); }, async () => []), [{ stepId: steps[0].id, status: "pending" }]);
});
