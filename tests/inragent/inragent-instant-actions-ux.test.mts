import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const client = read("app/dashboard/agent/AgentClient.tsx");
const styles = read("app/dashboard/agent/agent.module.css");

test("Publier, Propulser et Fidéliser proposent l'action instantanée à côté des réglages", () => {
  const cardsStart = client.indexOf("visibleAutomations.map((automation)");
  const cardsEnd = client.indexOf("className={styles.mainGrid}", cardsStart);
  const cards = client.slice(cardsStart, cardsEnd);

  assert.ok(cardsStart >= 0 && cardsEnd > cardsStart);
  assert.match(cards, /const hasInstantAction = automation\.key !== "stats"/);
  assert.match(cards, /className=\{styles\.automationCardActions\}/);
  assert.match(cards, /className=\{styles\.instantActionButton\}/);
  assert.match(cards, /onClick=\{\(\) => testAutomationNow\(automation\.key\)\}/);
  assert.match(cards, /i18nT\("instant_publish_action_label"\)/);
  assert.match(cards, /i18nT\("instant_campaign_action_label"\)/);
  assert.match(cards, /title=\{`\$\{instantActionLabel\} — \$\{instantActionHelp\}`\}/);
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
  assert.match(modal, /\{settingsAutomation\.key === "stats" \? \(/);
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
