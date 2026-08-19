import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function typescriptStyle(source: string, name: string) {
  const match = source.match(new RegExp(`const ${name}: CSSProperties = \\{[\\s\\S]*?\\n\\};`));
  assert.ok(match, `Style ${name} introuvable`);
  return match[0];
}

function cssRule(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Règle ${selector} introuvable`);
  return match[0];
}

const sharedDialog = read("app/_components/InrcyDialogProvider.tsx");
const agentStyles = read("app/dashboard/agent/agent.module.css");
const badgeStyles = read("app/badge/[slug]/badge.module.css");
const inrSearchSettings = read("app/dashboard/settings/_components/InrSearchSettingsContent.tsx");
const aiEngineModal = read("app/dashboard/_components/AiEngineInfoModal.tsx");
const boosterLayer = read("app/dashboard/_components/DashboardBoosterModalLayer.tsx");

test("shared confirmations scroll on the overlay without an inner scrollbar", () => {
  const overlay = typescriptStyle(sharedDialog, "overlayStyle");
  const card = typescriptStyle(sharedDialog, "cardStyle");

  assert.match(overlay, /overflowY: "auto"/);
  assert.match(card, /margin: "auto"/);
  assert.match(card, /overflow: "hidden"/);
  assert.doesNotMatch(card, /maxHeight|overflowY|overscrollBehavior/);
});

test("Booster exit warnings use the shared confirmation dialog", () => {
  assert.match(boosterLayer, /await confirmInrcy\(\{/);
  assert.match(boosterLayer, /title: i18nT\("quitter_la_publication_509848c0"\)/);
  assert.match(boosterLayer, /confirmLabel: i18nT\("quitter_3e4126f5"\)/);
});

test("compact iNrAgent dialogs override the generic scrolling modal", () => {
  const compactOverride = agentStyles.match(
    /\.campaignDraftModal,\s*\.campaignEditModal,\s*\.validationChoiceModal \{[\s\S]*?\n\}/,
  );
  assert.ok(compactOverride);
  assert.match(compactOverride[0], /max-height: none/);
  assert.match(compactOverride[0], /overflow: hidden !important/);
  assert.ok(
    agentStyles.indexOf(compactOverride[0]) > agentStyles.lastIndexOf("overflow-y: auto !important"),
    "L'override compact doit rester après les règles génériques de défilement",
  );
});

test("public badge mini-sheets delegate emergency scrolling to their overlay", () => {
  const layer = cssRule(badgeStyles, ".sheetLayer");
  const sheet = cssRule(badgeStyles, ".sheet");

  assert.match(layer, /overflow-y: auto/);
  assert.match(sheet, /margin: auto/);
  assert.match(sheet, /overflow: hidden/);
  assert.doesNotMatch(sheet, /max-height|overflow: auto/);
});

test("informational mini-modals remain bounded and usable on short screens", () => {
  assert.match(
    inrSearchSettings,
    /aria-labelledby="inrsearch-helper-title"[\s\S]*?overflowY: "auto"[\s\S]*?<div style=\{\{ width: "min\(680px, 100%\)", margin: "auto", overflow: "hidden"/,
  );
  assert.doesNotMatch(
    inrSearchSettings,
    /width: "min\(680px, 100%\)", maxHeight: "min\(760px, 90vh\)", overflowY: "auto"/,
  );

  assert.match(aiEngineModal, /overflowX: "hidden",\s*overflowY: "auto"/);
  assert.match(
    aiEngineModal,
    /width: "min\(620px, 100%\)",[\s\S]{0,180}maxHeight: `calc\(100dvh - \$\{MOBILE_DOCK_HEIGHT\} - 32px\)`[\s\S]{0,120}margin: "auto",[\s\S]{0,80}overflowX: "hidden",\s*overflowY: "auto"/,
  );
  assert.match(aiEngineModal, /overscrollBehavior: "contain"/);
});
