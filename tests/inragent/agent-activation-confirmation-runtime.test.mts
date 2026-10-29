import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Production modules cross a mocked React/API boundary with heterogeneous fixture shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const keys = ["publish", "grow", "loyalty", "stats"];
const response = (payload: unknown, ok = true) => ({ ok, json: async () => payload });

function runtime(options: { fail?: boolean; blocked?: boolean; deferred?: boolean; impact?: boolean; enabled?: string } = {}) {
  const baseline = Object.fromEntries(keys.map(key => [key, { enabled: key === options.enabled, channels: ["facebook"], label: `saved ${key}` }]));
  const configs = structuredClone(baseline);
  configs.publish.label = "unfinished draft";
  const requests: Value[] = [];
  const writes: Value[] = [];
  const notices: string[] = [];
  const settingsOpened: string[] = [];
  let complete!: (value: Value) => void;
  const pending = new Promise(resolve => { complete = resolve; });
  const require = (name: string): Value => {
    if (name === "react") return { useState: (initial: Value) => [initial, () => {}], useRef: (value: Value) => ({ current: value }) };
    if (name === "next-intl") return { useTranslations: () => (key: string) => key };
    if (name.endsWith("inrAgentSettings")) return { sanitizeInrAgentSettings: (value: Value) => value };
    if (name.endsWith("agent.settings")) return {
      settingsToConfigs: (value: Value) => structuredClone(value.configs),
      configsToSettings: (value: Value, next: Value) => ({ ...value, configs: next }),
      normalizeConfigsForConnectedChannels: (value: Value) => options.blocked ? Object.fromEntries(Object.entries(value).map(([key, config]) => [key, { ...config as object, enabled: false }])) : value,
    };
    if (name.endsWith("useAgentRuntimeData")) return { writeCachedAgentViewSnapshot() {} };
    return {};
  };
  const loaded = { exports: {} as Value };
  const code = ts.transpileModule(read("app/dashboard/agent/_hooks/useAgentAutomationController.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fetch = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push(body);
    if (options.deferred) return pending;
    if (options.impact && requests.length === 1) return response({ code: "EDITORIAL_PLAN_CHANGE_CONFIRMATION_REQUIRED", impact: { requiresConfirmation: true } }, false);
    return options.fail ? response({ error: "Save failed" }, false) : response({ settings: body.settings });
  };
  new Function("module", "exports", "require", "fetch", code)(loaded, loaded.exports, require, fetch);
  const controller = loaded.exports.useAgentAutomationController({
    agentSettings: { configs: baseline }, configs,
    setConfigs: (value: Value) => writes.push(value), setAgentSettings() {},
    agentConnectedChannels: { facebook: true }, connectedChannelsLoadState: "ready", saveState: "idle",
    setSaveState() {}, setTableMissing() {}, setNotice() {}, setSettingsKey: (key: string) => settingsOpened.push(key),
    pendingActionsByAutomation: {}, setActions() {}, refreshActions: async () => {}, setSelectedKey() {},
    selectedPreparedActionId: null, setSelectedPreparedActionId() {}, showNotice: (text: string) => notices.push(text),
  });
  return { controller, baseline, configs, requests, writes, notices, settingsOpened, complete };
}

function requestToggle(configs: Value, save: Value) {
  const source = read("app/dashboard/agent/AgentClient.tsx");
  const ast = ts.createSourceFile("AgentClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration = "";
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "requestAutomationToggle") declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration);
  const code = ts.transpileModule(declaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const dialogs: Value[] = [];
  const opened: string[] = [];
  const fn = new Function("configs", "setAutomationEnabled", "openAgentConfirmDialog", "i18nT", "setPublicationIdeasOpen", "setSettingsKey", "loadState", "saveState", `${code}; return requestAutomationToggle;`)(configs, save, (value: Value) => dialogs.push(value), (key: string) => key, () => {}, (key: string) => opened.push(key), "ready", "idle");
  return { fn, dialogs, opened };
}

for (const key of keys) test(`${key}: opening confirmation or verifying settings never activates; Yes saves the recorded settings`, async () => {
  const h = runtime();
  const ui = requestToggle(h.configs, h.controller.setAutomationEnabled);
  ui.fn(key);
  assert.equal(h.requests.length, 0);
  assert.equal(ui.dialogs.length, 1);
  assert.equal(ui.dialogs[0].hideCancel, true);
  ui.dialogs[0].onAlternate();
  assert.deepEqual(ui.opened, [key]);
  assert.equal(h.requests.length, 0);
  await ui.dialogs[0].onConfirm();
  assert.equal(h.requests.length, 1);
  const expected = structuredClone(h.baseline);
  expected[key].enabled = true;
  assert.deepEqual(h.requests[0].settings.configs, expected, "Unfinished drafts and other automations must not be activated or changed");
  assert.equal(h.writes.at(-1)[key].enabled, true);
});

test("activation is not displayed before server confirmation and rapid clicks cannot submit it twice", async () => {
  const h = runtime({ deferred: true });
  const pending = h.controller.setAutomationEnabled("publish", true);
  assert.equal(h.writes.length, 0);
  assert.equal(await h.controller.setAutomationEnabled("publish", true), false);
  assert.equal(h.requests.length, 1);
  h.complete(response({ settings: h.requests[0].settings }));
  assert.equal(await pending, true);
  assert.equal(h.writes.at(-1).publish.enabled, true);
});

test("a failed save or missing connected channel never reports successful activation", async () => {
  for (const options of [{ fail: true }, { blocked: true }]) {
    const h = runtime(options);
    assert.equal(await h.controller.setAutomationEnabled("publish", true), false);
    assert.equal(h.writes.length, 0);
    assert.ok(!h.notices.includes("automation_enabled_notice"));
    if (options.blocked) { assert.equal(h.requests.length, 0); assert.deepEqual(h.settingsOpened, ["publish"]); }
  }
});

test("the planning confirmation retains the requested activation without enabling it prematurely", async () => {
  const h = runtime({ impact: true });
  assert.equal(await h.controller.setAutomationEnabled("publish", true), false);
  assert.equal(h.writes.length, 0);
  await h.controller.confirmEditorialPlanSettings("next_cycle");
  assert.equal(h.requests[1].editorialPlanApplyMode, "next_cycle");
  assert.equal(h.requests[1].settings.configs.publish.enabled, true);
  assert.equal(h.writes.at(-1).publish.enabled, true);
});

test("pausing an already active automation does not open the activation confirmation", async () => {
  const h = runtime({ enabled: "publish" });
  const ui = requestToggle(h.configs, h.controller.setAutomationEnabled);
  ui.fn("publish");
  await new Promise(setImmediate);
  assert.equal(ui.dialogs.length, 0);
  assert.equal(h.requests[0].settings.configs.publish.enabled, false);
  assert.equal(h.writes.at(-1).publish.enabled, false);
});
