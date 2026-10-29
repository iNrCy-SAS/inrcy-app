import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const client = read("app/dashboard/agent/AgentClient.tsx");
const styles = read("app/dashboard/agent/agent.module.css");
const controller = read(
  "app/dashboard/agent/_hooks/useAgentAutomationController.ts",
);

test("each specialist exposes one guarded instant action beside its settings", () => {
  const header = read("app/dashboard/agent/_components/AgentWorkspaceHeader.tsx");
  const start = client.indexOf("<AgentWorkspaceHeader");
  const end = client.indexOf("{scheduledEditSession ?", start);
  const controls = client.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(controls, /onPrepare=\{\(\) =>/);
  assert.match(controls, /onAfterExit: \(\) => testAutomationNow\(selected\.key\)/);
  assert.match(controls, /prepareDisabled=\{loadState === "loading"[\s\S]*?prepareActionState === "saving"/);
  assert.match(controls, /selected\.key !== "stats"[\s\S]*?selectedAvailableChannels\.length === 0/);
  assert.match(controls, /selected\.key === "publish" && !manualCredits\.availability\?\.allowed/);
  assert.match(header, /onClick=\{props\.onPrepare\}/);
  assert.match(header, /disabled=\{props\.prepareDisabled\}/);
  assert.match(header, /title=\{props\.prepareHelp \|\| prepareLabel\}/);
  assert.match(header, /<span aria-hidden="true">⚡<\/span>/);
  assert.match(header, /props\.workspace === "stats" \? "sendReport"/);
  assert.match(header, /onClick=\{props\.onSettings\}/);
});

test("les modales de réglages n'exécutent plus Publier ou les campagnes, mais Stats reste inchangé", () => {
  const modalStart = client.indexOf("{settingsAutomation && settingsConfig && (");
  const modalEnd = client.indexOf("{prepareNowConfirm && (", modalStart);
  const modal = client.slice(modalStart, modalEnd);

  assert.ok(modalStart >= 0 && modalEnd > modalStart);
  assert.match(
    modal,
    /data-save-only=\{settingsAutomation\.key !== "stats" \? "true" : undefined\}/,
  );
  assert.match(modal, /\{settingsAutomation\.key === "stats" && !publicationIdeasOpen \? \(/);
  assert.equal(
    (modal.match(/onClick=\{\(\) => testAutomationNow\(settingsAutomation\.key\)\}/g) || [])
      .length,
    1,
  );
  assert.doesNotMatch(modal, /i18nT\("preparer_maintenant_e3f186ee"\)/);
  assert.match(modal, /i18nT\("envoyer_un_bilan_6dff1c99"\)/);
  assert.match(
    styles,
    /\.settingsModalFooter\[data-save-only="true"\][\s\S]*?justify-items: center/,
  );
  assert.match(
    styles,
    /\.settingsSaveAction \{[\s\S]*?width: auto !important[\s\S]*?height: 50px/,
  );
});

test("les trois éclairs préparent une seule action sans sauvegarder ni recalculer le planning", () => {
  const runStart = controller.indexOf("async function runAutomationNow");
  const runEnd = controller.indexOf("function testAutomationNow", runStart);
  const runFlow = controller.slice(runStart, runEnd);

  assert.ok(runStart >= 0 && runEnd > runStart);
  assert.match(
    runFlow,
    /if \(key === "stats"\) \{[\s\S]*?persistSettings\(/,
  );
  assert.doesNotMatch(
    runFlow,
    /try \{\s*const saved = await persistSettings\(/,
  );
  assert.match(runFlow, /key === "publish"[\s\S]*?preparePublishAction\(\)/);
  assert.match(
    runFlow,
    /key === "grow" \|\| key === "loyalty"[\s\S]*?prepareCampaignAction\(key\)/,
  );
});

test("enregistrer ferme les réglages uniquement après une sauvegarde réussie, y compris après confirmation", async () => {
  const saveStart = controller.indexOf("async function saveSettings");
  const runStart = controller.indexOf("async function runAutomationNow", saveStart);
  assert.ok(saveStart >= 0 && runStart > saveStart);
  const saveFlow = ts.transpileModule(controller.slice(saveStart, runStart), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const makeActions = new Function("persistSettings", "setSettingsKey", "showNotice", "pendingPlanConfigsRef", `${saveFlow}; return { saveSettings, confirmEditorialPlanSettings };`);
  for (const success of [false, true]) {
    let complete: (result: boolean) => void = () => {};
    const calls: unknown[] = [];
    const pending = new Promise<boolean>((resolve) => { complete = resolve; });
    const actions = makeActions(() => pending, (value: unknown) => calls.push(value), () => {}, { current: null });
    const save = actions.saveSettings();
    assert.equal(calls.length, 0, "le clic ne ferme pas la modale avant la réponse serveur");
    complete(success);
    await save;
    assert.deepEqual(calls, success ? [null] : []);
    calls.length = 0;
    await actions.confirmEditorialPlanSettings("next_cycle");
    assert.deepEqual(calls, success ? [null] : []);
  }
});

test("les libellés instantanés sont disponibles dans tous les catalogues iNrAgent", () => {
  const messagesRoot = new URL("../../messages/", import.meta.url);
  const localeDirectories = readdirSync(messagesRoot, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  );

  for (const locale of localeDirectories) {
    const catalogUrl = new URL(`${locale.name}/agent.json`, messagesRoot);
    let raw = "";
    try {
      raw = readFileSync(catalogUrl, "utf8");
    } catch {
      continue;
    }
    const catalog = JSON.parse(raw) as Record<string, string>;
    for (const key of [
      "instant_publish_action_label",
      "instant_publish_action_help",
      "instant_campaign_action_label",
      "instant_campaign_action_help",
    ]) {
      assert.equal(typeof catalog[key], "string", `${locale.name}: ${key}`);
      assert.ok(catalog[key].trim().length > 0, `${locale.name}: ${key} vide`);
    }
  }
});
