import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Children, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const compiledModules = new Map();

// Execute the client adapters and their actual pure dependencies without Next's
// alias resolver. No server, account, browser profile or persisted setting is used.
function loadTs(relativeFile) {
  const filename = path.resolve(root, relativeFile);
  if (compiledModules.has(filename)) return compiledModules.get(filename);
  const exports = {};
  compiledModules.set(filename, exports);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const importModule = (specifier) => {
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
    const target = specifier.startsWith("@/")
      ? path.resolve(root, specifier.slice(2))
      : path.resolve(path.dirname(filename), specifier);
    return loadTs(target.endsWith(".ts") ? target : `${target}.ts`);
  };
  new Function("exports", "require", compiled)(exports, importModule);
  return exports;
}

const settingsModule = loadTs("lib/inrAgentSettings.ts");
const adapters = loadTs("app/dashboard/agent/_lib/agent.settings.ts");
const configModule = loadTs("app/dashboard/agent/_lib/agent.config.ts");
const source = readFileSync(path.join(root, "app/dashboard/agent/AgentClient.tsx"), "utf8");
const css = readFileSync(path.join(root, "app/dashboard/agent/agent.module.css"), "utf8");
const parsed = ts.createSourceFile("AgentClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let mediaRow;
const declarations = new Map();
function inspect(node) {
  if (ts.isJsxElement(node)
    && node.openingElement.attributes.getText(parsed) === "className={styles.settingsMediaPreferencesRow}") {
    mediaRow = node;
  }
  if (ts.isVariableDeclaration(node)
    && ["settingsPublicationMediaTypes", "settingsSingleImagePercent"].includes(node.name.getText(parsed))) {
    declarations.set(node.name.getText(parsed), node.getText(parsed));
  }
  ts.forEachChild(node, inspect);
}
inspect(parsed);
assert.ok(mediaRow, "La vraie ligne de préférences média doit être rendue");
assert.equal(declarations.size, 2);
const fixtureSource = `
const { normalizeInrAgentPublicationMediaTypes } = require("settings");
const styles = new Proxy({}, {get: (_, key) => String(key)});
export function MediaPreferences({settingsConfig, updateConfig, messages}) {
  const settingsAutomation = {key:"publish"};
  const i18nT = (key) => messages[key] || key;
  ${[...declarations.values()].map((declaration) => `const ${declaration};`).join("\n")}
  return ${mediaRow.getText(parsed)};
}`;
const fixtureCompiled = ts.transpileModule(fixtureSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const fixtureExports = {};
new Function("exports", "require", fixtureCompiled)(fixtureExports, (specifier) => specifier === "settings" ? settingsModule : require(specifier));
const messages = JSON.parse(readFileSync(path.join(root, "messages/fr-FR/agent.json"), "utf8"));

function descendants(element, predicate) {
  return Children.toArray(element?.props?.children).flatMap((child) => [
    ...(predicate(child) ? [child] : []),
    ...descendants(child, predicate),
  ]);
}

test("les choix de formats se cumulent et gardent toujours l’image de base", () => {
  let config = structuredClone(configModule.defaultConfigs.publish);
  const updateConfig = (key, changes) => {
    assert.equal(key, "publish");
    config = { ...config, ...changes };
  };
  const render = () => fixtureExports.MediaPreferences({ settingsConfig: config, updateConfig, messages });
  const inputs = () => descendants(render(), (element) => element.type === "input");
  const imageShare = () => descendants(render(), (element) => element.type === "small")[0].props.children[0];

  assert.equal(inputs().length, 3);
  assert.equal(inputs()[0].props.checked, true);
  assert.equal(inputs()[0].props.disabled, true);
  assert.equal(inputs()[0].props.onChange, undefined);
  assert.equal(imageShare(), 100);

  inputs()[1].props.onChange({ target: { checked: true } });
  assert.equal(imageShare(), 90);
  inputs()[2].props.onChange({ target: { checked: true } });
  assert.equal(imageShare(), 70);
  assert.deepEqual(config.publicationMediaTypes, { singleImage: true, video: true, carousel: true });
  inputs()[1].props.onChange({ target: { checked: false } });
  assert.equal(imageShare(), 80);
  assert.equal(config.publicationMediaTypes.carousel, true);

  const aiButton = descendants(render(), (element) => element.type === "button")[2];
  aiButton.props.onClick();
  assert.equal(config.preferredMediaSource, "ai_generation");
  assert.deepEqual(config.publicationMediaTypes, { singleImage: true, video: false, carousel: true });
  inputs()[2].props.onChange({ target: { checked: false } });
  assert.equal(imageShare(), 100);
});

test("enregistrer puis rouvrir les quatre combinaisons conserve les autres réglages", () => {
  const base = structuredClone(settingsModule.INR_AGENT_DEFAULT_SETTINGS);
  base.automations.publish.metadata.customExistingSetting = { preserve: true };
  const configs = adapters.settingsToConfigs(base);
  const reference = adapters.configToAutomationSettings("publish", configs.publish, base.automations.publish);

  for (const video of [false, true]) {
    for (const carousel of [false, true]) {
      const formats = { singleImage: true, video, carousel };
      const saved = adapters.configToAutomationSettings("publish", {
        ...configs.publish,
        publicationMediaTypes: formats,
      }, base.automations.publish);
      assert.deepEqual(saved.publicationMediaTypes, formats);
      assert.deepEqual(saved.metadata.publicationMediaTypes, formats);
      const reopened = adapters.settingsToConfigs({
        ...base, automations: { ...base.automations, publish: saved },
      });
      assert.deepEqual(reopened.publish.publicationMediaTypes, formats);
      assert.deepEqual({
        ...saved,
        publicationMediaTypes: reference.publicationMediaTypes,
        metadata: { ...saved.metadata, publicationMediaTypes: reference.metadata.publicationMediaTypes },
      }, reference);
    }
  }
});

test("les anciens réglages restent à une image et les autres automations gardent leurs métadonnées", () => {
  const legacy = structuredClone(settingsModule.INR_AGENT_DEFAULT_SETTINGS);
  delete legacy.automations.publish.publicationMediaTypes;
  delete legacy.automations.publish.metadata.publicationMediaTypes;
  assert.deepEqual(adapters.settingsToConfigs(legacy).publish.publicationMediaTypes,
    { singleImage: true, video: false, carousel: false });

  legacy.automations.publish.metadata.publicationMediaTypes = { singleImage: false, video: true, carousel: true };
  assert.deepEqual(adapters.settingsToConfigs(legacy).publish.publicationMediaTypes,
    { singleImage: true, video: true, carousel: true });

  const configs = adapters.settingsToConfigs(legacy);
  for (const key of ["grow", "loyalty", "stats"]) {
    const existing = legacy.automations[key];
    const saved = adapters.configToAutomationSettings(key, {
      ...configs[key], publicationMediaTypes: { singleImage: true, video: true, carousel: true },
    }, existing);
    assert.deepEqual(saved.publicationMediaTypes, existing.publicationMediaTypes);
    assert.deepEqual(saved.metadata.publicationMediaTypes, existing.metadata.publicationMediaTypes);
  }
});

function fixture(locale = "fr-FR") {
  const translated = JSON.parse(readFileSync(path.join(root, `messages/${locale}/agent.json`), "utf8"));
  const markup = renderToStaticMarkup(createElement(fixtureExports.MediaPreferences, {
    settingsConfig: { ...configModule.defaultConfigs.publish, publicationMediaTypes: { singleImage: true, video: true, carousel: true } },
    updateConfig: () => {}, messages: translated,
  }));
  return `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#0b1636}
    ${css.replace(/:global\(([^)]+)\)/g, "$1")}
    body{display:grid;place-items:center;min-height:100dvh;padding:12px}
    </style></head><body><section class="settingsModal automationSettingsModal" data-automation="publish" role="dialog">
      <div class="settingsModalLayout"><div class="modalSection settingsPreferredMediaFullWidth">
        <span>${translated.preferred_media_title}</span><p class="modalHint">${translated.preferred_media_hint}</p>${markup}
      </div></div></section></body></html>`;
}

test("les sources et formats tiennent sur une ligne desktop et restent intégralement accessibles en responsive", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [375, 667], [768, 1024], [1024, 768], [1366, 768], [1707, 842]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      try {
        await page.setContent(fixture());
        assert.equal(await page.getByRole("checkbox").count(), 3);
        assert.equal(await page.getByRole("group", { name: "Types de médias" }).count(), 1);
        assert.equal(await page.getByRole("checkbox", { name: "1 image 70 %" }).isDisabled(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: débordement horizontal`);
        const layout = await page.locator(".settingsMediaPreferencesRow").evaluate((row) => {
          const sourceBounds = row.querySelector(".choiceGrid").getBoundingClientRect();
          const formatsBounds = row.querySelector("fieldset").getBoundingClientRect();
          return {
            fits: row.scrollWidth <= row.clientWidth && row.scrollHeight <= row.clientHeight,
            oneLine: Math.abs((sourceBounds.y + sourceBounds.height / 2) - (formatsBounds.y + formatsBounds.height / 2)) < 2,
          };
        });
        assert.equal(layout.fits, true, `${width}: ligne coupée`);
        if (width >= 1024) assert.equal(layout.oneLine, true, `${width}: sources et formats doivent partager la ligne`);
        for (const control of await page.locator(".settingsMediaPreferencesRow button, .publicationMediaTypes label").all()) {
          await control.scrollIntoViewIfNeeded();
          const accessible = await control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const visible = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
              && element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1
              && (element === visible || element.contains(visible));
          });
          assert.equal(accessible, true, `${width}: contrôle masqué ou texte coupé`);
        }
        await page.getByRole("checkbox", { name: "Vidéo 8 s 10 %" }).focus();
        assert.equal(await page.getByRole("checkbox", { name: "Vidéo 8 s 10 %" }).evaluate((element) => element === document.activeElement), true);
      } finally { await page.close(); }
    }
    for (const locale of ["en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
      const page = await browser.newPage({ viewport: { width: 320, height: 667 } });
      try {
        await page.setContent(fixture(locale));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${locale}: débordement horizontal mobile`);
        assert.equal(await page.locator(".publicationMediaTypes").evaluate((element) => element.scrollWidth <= element.clientWidth), true, `${locale}: options coupées`);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
