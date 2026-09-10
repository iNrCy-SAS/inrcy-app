import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const client = read("app/dashboard/agent/AgentClient.tsx");
const styles = read("app/dashboard/agent/agent.module.css");

test("les réglages iNrAgent exploitent une disposition desktop large sans scroll interne", () => {
  assert.match(client, /className=\{styles\.settingsModalLayout\}/);
  assert.match(client, /className=\{styles\.settingsContentColumn\}/);
  assert.match(
    styles,
    /\.settingsModal\.automationSettingsModal \{[\s\S]*?width: min\(1180px,/,
  );
  assert.match(
    styles,
    /\.settingsModalLayout \{[\s\S]*?grid-template-columns: minmax\(430px, 0\.9fr\) minmax\(520px, 1\.1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 980px\), \(max-height: 720px\) \{[\s\S]*?\.automationSettingsModal \{[\s\S]*?overflow-y: auto !important/,
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
