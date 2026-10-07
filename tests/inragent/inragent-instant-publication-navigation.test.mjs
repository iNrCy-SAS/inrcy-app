import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const ROOT = resolve(import.meta.dirname, "../..");

function compile(relativePath) {
  return ts.transpileModule(readFileSync(resolve(ROOT, relativePath), "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
}

const carouselModule = { exports: {} };
runInNewContext(compile("app/dashboard/agent/_lib/agent.publication-carousel.ts"), {
  module: carouselModule, exports: carouselModule.exports,
}, { filename: "agent.publication-carousel.js" });
const carousel = carouselModule.exports;
const PENDING_ID = carousel.INSTANT_PUBLICATION_PREPARATION_ID;
assert.equal(typeof PENDING_ID, "string");
const controllerJavascript = compile("app/dashboard/agent/_hooks/useAgentAutomationController.ts");

async function flush() {
  for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

function createController({ selectedId = "previous-publication", selectedKey = "publish" } = {}) {
  const state = [];
  const timeouts = [];
  const intervals = new Map();
  const notices = [];
  let timerId = 0;
  let resolveFetch;
  let selectedPublicationId = selectedId;
  let selectedAutomationKey = selectedKey;
  const initialActions = [
    { id: "previous-publication", automationKey: "publish", title: "Publication précédente" },
    { id: "another-publication", automationKey: "publish", title: "Autre publication" },
  ];
  const initialSnapshot = structuredClone(initialActions);
  let actions = initialActions;
  const compiledModule = { exports: {} };
  const dependencies = {
    "next-intl": { useTranslations: () => (key) => key },
    "react": {
      useState: (initial) => {
        const index = state.length;
        state.push(initial);
        return [initial, (next) => {
          state[index] = typeof next === "function" ? next(state[index]) : next;
        }];
      },
      useRef: (initial) => ({ current: initial }),
    },
    "@/lib/inrAgentSettings": {},
    "@/lib/inrAgentMonthSchedule": {},
    "../_lib/agent.config": { automations: [{ key: "publish" }], pendingActionStatuses: new Set() },
    "../_lib/agent.settings": { connectedChannelsForAutomation: () => ["siteWeb"] },
    "../_lib/agent.i18n": {},
    "../_lib/agent.reports": { prepareProgressLabel: (key, percent) => `${key}-${percent}` },
    "../_lib/agent.publication-carousel": carousel,
    "./useAgentRuntimeData": {},
  };
  runInNewContext(controllerJavascript, {
    module: compiledModule, exports: compiledModule.exports,
    require: (id) => {
      assert.ok(id in dependencies, `Unexpected controller import ${id}`);
      return dependencies[id];
    },
    window: {
      setInterval: (callback) => { const id = ++timerId; intervals.set(id, callback); return id; },
      clearInterval: (id) => intervals.delete(id),
      setTimeout: (callback, ms) => { timeouts.push({ callback, ms }); return ++timerId; },
    },
    fetch: (url, options) => {
      assert.equal(url, "/api/agent/actions/prepare-publish");
      assert.equal(options.method, "POST");
      return new Promise((resolveResponse) => { resolveFetch = resolveResponse; });
    },
  }, { filename: "useAgentAutomationController.js" });
  const controller = compiledModule.exports.useAgentAutomationController({
    agentSettings: {}, setAgentSettings: () => {}, configs: {}, setConfigs: () => {},
    agentConnectedChannels: {}, connectedChannelsLoadState: "ready",
    saveState: "idle", setSaveState: () => {}, setTableMissing: () => {}, setNotice: () => {},
    setSettingsKey: () => {},
    pendingActionsByAutomation: { publish: 0, grow: 0, loyalty: 0, stats: 0 },
    setActions: (next) => { actions = typeof next === "function" ? next(actions) : next; },
    refreshActions: async () => {},
    selectedPreparedActionId: selectedId,
    setSelectedKey: (next) => {
      selectedAutomationKey = typeof next === "function" ? next(selectedAutomationKey) : next;
    },
    setSelectedPreparedActionId: (next) => {
      selectedPublicationId = typeof next === "function" ? next(selectedPublicationId) : next;
    },
    showNotice: (notice) => notices.push(notice),
  });
  return {
    controller, state, timeouts, intervals, notices,
    preparationActive: () => state[6],
    snapshot: () => ({ selectedId: selectedPublicationId, selectedKey: selectedAutomationKey, actions }),
    browse: (id) => { selectedPublicationId = id; },
    switchAutomation: (key) => { selectedAutomationKey = key; },
    respond: async (ok, payload) => {
      resolveFetch({ ok, json: async () => payload });
      await flush();
    },
    finish: async () => {
      for (let count = 0; timeouts.length && count < 10; count += 1) {
        timeouts.shift().callback();
        await flush();
      }
      assert.equal(timeouts.length, 0);
      assert.equal(intervals.size, 0);
      assert.equal(state[2], null, "Preparation busy state must clear after finalisation");
      assert.equal(state[6], false, "The pending publication slot must clear after finalisation");
    },
    assertOriginalActionsUnchanged: () => assert.deepEqual(initialActions, initialSnapshot),
  };
}

const preparedPublication = {
  id: "new-publication", automationKey: "publish", actionType: "publication", title: "Nouvelle publication",
};

test("l'éclair sélectionne immédiatement une case provisoire sans créer de fausse action", () => {
  const runtime = createController({ selectedKey: "grow" });
  runtime.controller.testAutomationNow("publish");
  assert.equal(runtime.snapshot().selectedKey, "publish");
  assert.equal(runtime.snapshot().selectedId, PENDING_ID);
  assert.equal(runtime.state[2], "publish");
  assert.equal(runtime.preparationActive(), true);
  assert.equal(runtime.state[1].percent, 6);
  assert.equal(runtime.snapshot().actions.length, 2);
  assert.ok(runtime.snapshot().actions.every((action) => action.id !== PENDING_ID));
  runtime.assertOriginalActionsUnchanged();
});

test("la publication prête remplace la case provisoire sélectionnée et conserve l'historique", async () => {
  const runtime = createController();
  runtime.controller.testAutomationNow("publish");
  await runtime.respond(true, { action: preparedPublication });
  assert.equal(runtime.preparationActive(), false, "A ready publication must remove the pending slot immediately");
  assert.equal(runtime.snapshot().selectedId, preparedPublication.id);
  assert.deepEqual(Array.from(runtime.snapshot().actions, (action) => action.id),
    ["new-publication", "previous-publication", "another-publication"]);
  assert.ok(runtime.snapshot().actions.every((action) => action.id !== PENDING_ID));
  runtime.assertOriginalActionsUnchanged();
  await runtime.finish();
  assert.equal(runtime.snapshot().selectedId, preparedPublication.id);
});

test("la réussite conserve la publication consultée pendant le travail", async () => {
  const runtime = createController();
  runtime.controller.testAutomationNow("publish");
  runtime.browse("another-publication");
  await runtime.respond(true, { action: preparedPublication });
  assert.equal(runtime.snapshot().selectedId, "another-publication");
  assert.equal(runtime.snapshot().actions[0].id, preparedPublication.id);
  await runtime.finish();
  assert.equal(runtime.snapshot().selectedId, "another-publication");
  runtime.assertOriginalActionsUnchanged();
});

test("revenir sur la case provisoire avant la réussite affiche la nouvelle publication", async () => {
  const runtime = createController();
  runtime.controller.testAutomationNow("publish");
  runtime.browse("another-publication");
  runtime.browse(PENDING_ID);
  await runtime.respond(true, { action: preparedPublication });
  await runtime.finish();
  assert.equal(runtime.snapshot().selectedId, preparedPublication.id);
});

test("un échec restaure la sélection précédente uniquement depuis la case provisoire", async () => {
  for (const browseAway of [false, true]) {
    const runtime = createController();
    runtime.controller.testAutomationNow("publish");
    if (browseAway) runtime.browse("another-publication");
    await runtime.respond(false, { error: "Création indisponible" });
    assert.equal(runtime.preparationActive(), true, "A failed request keeps its pending state until selection is restored");
    await runtime.finish();
    assert.equal(runtime.snapshot().selectedId, browseAway ? "another-publication" : "previous-publication");
    assert.equal(runtime.snapshot().actions.length, 2);
    assert.ok(runtime.notices.includes("agent_publication_prepare_failed"));
    runtime.assertOriginalActionsUnchanged();
  }
});

test("sans sélection précédente, l'échec retire proprement la case provisoire", async () => {
  const runtime = createController({ selectedId: null });
  runtime.controller.testAutomationNow("publish");
  await runtime.respond(false, null);
  await runtime.finish();
  assert.equal(runtime.snapshot().selectedId, null);
  assert.equal(runtime.snapshot().actions.length, 2);
});

test("changer de mission pendant la création est conservé à la réussite comme à l'échec", async () => {
  for (const ok of [true, false]) {
    const runtime = createController();
    runtime.controller.testAutomationNow("publish");
    runtime.switchAutomation("loyalty");
    await runtime.respond(ok, ok ? { action: preparedPublication } : { error: "Indisponible" });
    assert.equal(runtime.snapshot().selectedKey, "loyalty");
    await runtime.finish();
    assert.equal(runtime.snapshot().selectedKey, "loyalty");
  }
});

test("la case provisoire disparaît dès la réussite et ne revient pas pendant la finalisation", async () => {
  const runtime = createController();
  runtime.controller.testAutomationNow("publish");
  runtime.browse("another-publication");
  await runtime.respond(true, { action: preparedPublication });
  assert.equal(runtime.snapshot().selectedId, "another-publication");
  assert.equal(runtime.preparationActive(), false);
  const selectedAction = runtime.snapshot().actions.find((action) => action.id === "another-publication");
  const items = carousel.buildPublicationViewerItems(
    runtime.snapshot().actions, selectedAction, runtime.preparationActive(),
  );
  assert.ok(items.every((item) => item.id !== PENDING_ID));
  const nextId = carousel.nextPublicationViewerId(items, "another-publication", 1);
  assert.equal(nextId, preparedPublication.id);
  runtime.browse(nextId);
  await runtime.finish();
  assert.equal(runtime.snapshot().selectedId, preparedPublication.id);
});

test("le carrousel conserve les publications réelles autour de la case provisoire", () => {
  const actions = Object.freeze([
    Object.freeze({ id: "first", title: "Première publication" }),
    Object.freeze({ id: "last", title: "Dernière publication" }),
  ]);
  const items = carousel.buildPublicationViewerItems(actions, null, true);
  assert.deepEqual(Array.from(items, (item) => item.id), [PENDING_ID, "first", "last"]);
  assert.equal(items[0].action, null);
  assert.equal(items[1].action, actions[0]);
  assert.equal(items[2].action, actions[1]);
  assert.equal(carousel.nextPublicationViewerId(items, PENDING_ID, 1), "first");
  assert.equal(carousel.nextPublicationViewerId(items, PENDING_ID, -1), "last");
  assert.equal(carousel.nextPublicationViewerId(items, "last", 1), PENDING_ID);
  assert.equal(carousel.nextPublicationViewerId(items, "first", -1), PENDING_ID);
  assert.equal(carousel.nextPublicationViewerId(items, "first", 1), "last");
});

test("la sélection explicite hors carrousel reste accessible sans doublon", () => {
  const actions = [{ id: "first" }, { id: "last" }];
  const outsideAction = { id: "selected-outside" };
  const items = carousel.buildPublicationViewerItems(actions, outsideAction, true);
  assert.deepEqual(Array.from(items, (item) => item.id), [PENDING_ID, "selected-outside", "first", "last"]);
  const selectedInside = carousel.buildPublicationViewerItems(actions, actions[0], true);
  assert.equal(selectedInside.filter((item) => item.id === "first").length, 1);
});

test("un carrousel vide ou une seule case ne produit aucune navigation", () => {
  assert.equal(carousel.nextPublicationViewerId([], null, 1), null);
  const pendingOnly = carousel.buildPublicationViewerItems([], null, true);
  assert.equal(pendingOnly.length, 1);
  assert.equal(carousel.nextPublicationViewerId(pendingOnly, PENDING_ID, 1), null);
  const pendingAndOne = carousel.buildPublicationViewerItems([{ id: "existing" }], null, true);
  assert.equal(carousel.nextPublicationViewerId(pendingAndOne, PENDING_ID, 1), "existing");
  assert.equal(carousel.nextPublicationViewerId(pendingAndOne, "existing", 1), PENDING_ID);
});

test("retirer la case provisoire conserve les identités des publications consultables", () => {
  const actions = [{ id: "new-publication" }, { id: "previous-publication" }];
  const items = carousel.buildPublicationViewerItems(actions, actions[1], false);
  assert.deepEqual(Array.from(items, (item) => item.id), ["new-publication", "previous-publication"]);
  assert.ok(items.every((item) => item.action !== null && item.id !== PENDING_ID));
  assert.equal(carousel.nextPublicationViewerId(items, "previous-publication", 1), "new-publication");
});
