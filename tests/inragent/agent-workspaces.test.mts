import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { INR_AGENT_WORKSPACES, filterAgentWorkspaceActions, filterAgentWorkspaceSchedule, isAutomationInAgentWorkspace } from "../../lib/inrAgentWorkspaces.ts";
import { rebrandAgentMessages } from "../../app/dashboard/agent/_lib/agent.workspace-messages.ts";

test("each specialist only displays its own actions, keeping both mail missions together", () => {
  const actions = [
    { id: "p1", automationKey: "publish", payload: { title: "Publication" } },
    { id: "g1", automationKey: "grow", payload: { title: "Prospection" } },
    { id: "l1", automationKey: "loyalty", payload: { title: "Fidélisation" } },
    { id: "s1", automationKey: "stats", payload: { title: "Bilan" } },
    { id: "other", automationKey: "unknown", payload: { title: "Other" } },
  ];
  assert.deepEqual(filterAgentWorkspaceActions("publications", actions), [actions[0]]);
  assert.deepEqual(filterAgentWorkspaceActions("campaigns", actions), [actions[1], actions[2]]);
  assert.deepEqual(filterAgentWorkspaceActions("stats", actions), [actions[3]]);
  assert.equal(actions.length, 5, "view filtering never deletes or alters stored actions");
  assert.equal(isAutomationInAgentWorkspace("campaigns", "publish"), false);
  assert.equal(isAutomationInAgentWorkspace("publications", "stats"), false);
});

test("scoped UI wording uses the chosen agent without changing catalog keys or ICU placeholders", () => {
  const catalog = { heading: "Dernières recommandations iNr’Agent", nested: { message: "{count} contenus d’iNrAgent pour {channel}" } };
  const branded = rebrandAgentMessages(catalog, "Agent Stats");
  assert.deepEqual(branded, { heading: "Dernières recommandations Agent Stats", nested: { message: "{count} contenus de l’Agent Stats pour {channel}" } });
  assert.equal(catalog.heading, "Dernières recommandations iNr’Agent");
  assert.deepEqual(Object.keys(branded), Object.keys(catalog));
});

test("each planning includes its manual actions and its agent actions without mixing email campaigns with publications", () => {
  const items = [
    { id: "publication", source: "manual", scheduledActionId: "manual-publish", automationKey: null },
    { id: "prospection", source: "manual", scheduledActionId: "manual-grow", automationKey: null },
    { id: "loyalty", source: "manual", scheduledActionId: "manual-loyalty", automationKey: null },
    { id: "report", source: "prepared", automationKey: "stats" },
    { id: "auto-mail", source: "prepared", automationKey: "grow" },
    { id: "history", source: "history", automationKey: null },
  ];
  const manualAutomations = new Map([["manual-publish", "publish"], ["manual-grow", "grow"], ["manual-loyalty", "loyalty"]]);
  assert.deepEqual(filterAgentWorkspaceSchedule("publications", items, manualAutomations).map((item) => item.id), ["publication", "history"]);
  assert.deepEqual(filterAgentWorkspaceSchedule("campaigns", items, manualAutomations).map((item) => item.id), ["prospection", "loyalty", "auto-mail"]);
  assert.deepEqual(filterAgentWorkspaceSchedule("stats", items, manualAutomations).map((item) => item.id), ["report"]);
  assert.equal(items.length, 6);
});

test("three dedicated local routes keep one shared runtime and three different approved icons", () => {
  assert.equal(new Set(Object.values(INR_AGENT_WORKSPACES).map((workspace) => workspace.icon)).size, 3);
  for (const [key, workspace] of Object.entries(INR_AGENT_WORKSPACES)) {
    const page = readFileSync(new URL(`../../app${workspace.href}/page.tsx`, import.meta.url), "utf8");
    assert.ok(page.includes(`<AgentClient workspace="${key}" />`));
    assert.equal(isAutomationInAgentWorkspace(key as keyof typeof INR_AGENT_WORKSPACES, workspace.initialAutomation), true);
  }
});
