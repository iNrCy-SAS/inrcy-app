import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const client = read("app/dashboard/agent/AgentClient.tsx");
const styles = read("app/dashboard/agent/agent.module.css");

test("les réglages iNrAgent exploitent une disposition desktop large et équilibrée", () => {
  assert.match(client, /className=\{styles\.settingsModalLayout\}/);
  assert.match(client, /className=\{styles\.settingsContentColumn\}/);
  assert.match(client, /styles\.settingsPreferredMediaFullWidth/);
  assert.match(
    styles,
    /\.settingsModal\.automationSettingsModal \{[\s\S]*?width: min\(1180px,/,
  );
  assert.match(
    styles,
    /\.settingsModalLayout \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /\.settingsPreferredMediaFullWidth \{[\s\S]*?grid-column: 1 \/ -1/,
  );
  assert.match(
    styles,
    /@media \(max-width: 980px\) \{[\s\S]*?\.automationSettingsModal \{[\s\S]*?overflow-y: auto !important/,
  );
  assert.match(
    styles,
    /@media \(max-height: 820px\) \{[\s\S]*?\.automationSettingsModal \{[\s\S]*?overflow-y: auto !important/,
  );
});

test("les onglets Publier sont intégrés au header et passent sur une ligne dédiée en responsive", () => {
  const headerStart =
    client.match(/<header\r?\n\s+className=\{styles\.settingsModalHeader\}/)
      ?.index ?? -1;
  const tabsStart = client.indexOf("className={styles.settingsPublishTabs}", headerStart);
  const headerEnd = client.indexOf("</header>", headerStart);

  assert.ok(headerStart >= 0);
  assert.ok(tabsStart > headerStart);
  assert.ok(tabsStart < headerEnd);
  assert.match(client, /aria-current=\{[\s\S]*?settingsPublishTab === "settings"/);
  assert.match(
    styles,
    /\.settingsModalHeader\[data-has-tabs="true"\] \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 980px\) \{[\s\S]*?grid-template-areas:[\s\S]*?"tabs tabs"/,
  );
  assert.match(
    styles,
    /\.automationSettingsModal \.settingsModalHeader\[data-has-tabs="true"\] \{[\s\S]*?"tabs tabs"[\s\S]*?\.settingsPublishTabs \{[\s\S]*?grid-area: tabs;[\s\S]*?width: 100%/,
  );
});

test("chaque jour et son horaire partagent une seule carte", () => {
  assert.match(
    styles,
    /\.scheduleSlotPair \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?border:/,
  );
  assert.match(
    styles,
    /\.settingsScheduleGrid[\s\S]*?\.scheduleSlotPair[\s\S]*?> label \{[\s\S]*?background: transparent/,
  );
});

test("les canaux déconnectés restent visibles mais non sélectionnables", () => {
  assert.match(client, /settingsDisplayedChannels\.map\(\(channelKey\) =>/);
  assert.match(client, /disabled=\{!connected\}/);
  assert.match(client, /styles\.channelChoiceDisconnected/);
  assert.match(styles, /\.channelChoiceDisconnected \{[\s\S]*?cursor: not-allowed/);
});
