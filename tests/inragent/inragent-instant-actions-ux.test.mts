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

test("Publier, Propulser et Fidéliser proposent l'action instantanée à côté des réglages", () => {
  const cardsStart = client.indexOf("visibleAutomations.map((automation)");
  const cardsEnd = client.indexOf("className={styles.mainGrid}", cardsStart);
  const cards = client.slice(cardsStart, cardsEnd);

  assert.ok(cardsStart >= 0 && cardsEnd > cardsStart);
  assert.match(cards, /const hasInstantAction = automation\.key !== "stats"/);
  assert.match(cards, /className=\{styles\.automationCardActions\}/);
  assert.match(cards, /className=\{styles\.instantActionButton\}/);
  assert.match(cards, /onAfterExit: \(\) => testAutomationNow\(automation\.key\)/);
  assert.match(cards, /i18nT\("instant_publish_action_label"\)/);
  assert.match(cards, /i18nT\("instant_campaign_action_label"\)/);
  assert.match(cards, /title=\{`\$\{instantActionLabel\} — \$\{manualCreditsBlocked \? manualCreditHelp : instantActionHelp\}`\}/);
  assert.match(cards, /instantActionUnavailable \|\| manualCreditsBlocked/);
  assert.match(cards, /aria-description=\{manualCreditsBlocked \? manualCreditHelp : undefined\}/);
  assert.doesNotMatch(cards, /manual-publish-credit-help|styles\.manualCreditHelp|data-manual-credit-blocked/);
  assert.doesNotMatch(styles, /manualCreditHelp|data-manual-credit-blocked/);
  assert.match(cards, /<span aria-hidden>⚡<\/span>/);
  assert.match(
    styles,
    /\.automationCardActions \{[\s\S]*?display: inline-flex[\s\S]*?gap: 6px/,
  );
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
  const makeActions = new Function("persistSettings", "setSettingsKey", "showNotice", `${saveFlow}; return { saveSettings, confirmEditorialPlanSettings };`);
  for (const success of [false, true]) {
    let complete: (result: boolean) => void = () => {};
    const calls: unknown[] = [];
    const pending = new Promise<boolean>((resolve) => { complete = resolve; });
    const actions = makeActions(() => pending, (value: unknown) => calls.push(value), () => {});
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
