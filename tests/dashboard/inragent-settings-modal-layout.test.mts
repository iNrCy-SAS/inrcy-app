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

test("les idées Publier ont leur raccourci et leur espace distincts des réglages", () => {
  assert.match(client, /className=\{styles\.ideasActionButton\}/);
  assert.match(client, /setSettingsKey\(null\);\s*setPublicationIdeasDraft\(configs\.publish\.publicationIdeas\);\s*setPublicationIdeasOpen\(true\)/);
  assert.match(client, /publicationIdeasOpen \? styles\.publicationIdeasWorkspace : ""/);
  assert.match(client, /display: publicationIdeasOpen \? "none" : undefined/);
  assert.match(client, /\{publicationIdeasOpen \? \(\s*<section className=\{styles\.publicationIdeasPanel\}>/);
  assert.doesNotMatch(client, /className=\{styles\.settingsPublishTabs\}/);
  assert.match(
    styles,
    /\.settingsModal\.automationSettingsModal\.publicationIdeasWorkspace \{[\s\S]*?width: min\(1500px, calc\(100vw - 32px\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.settingsModal\.automationSettingsModal\.publicationIdeasWorkspace \{[\s\S]*?width: min\(100%, 430px\)/,
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
