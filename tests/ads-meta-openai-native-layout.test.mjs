import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const nativeTargets = [
  { key: "native-lille", type: "city", name: "Lille", countryCode: "FR", region: "Hauts-de-France" },
  { key: "native-hdf", type: "region", name: "Hauts-de-France", countryCode: "FR" },
  { key: "native-lyon", type: "city", name: "Lyon", countryCode: "FR", region: "Auvergne-Rhône-Alpes" },
];
const aliases = {};
for (const name of ["adsMetaCampaignSettings", "adsOpenaiCampaignSettings", "adsMetaResources"]) {
  const compiled = ts.transpileModule(await readFile(new URL(`../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, require);
  aliases[`@/lib/${name}`] = exports;
}
async function component(name, seedPicker = false) {
  let source = await readFile(new URL(`../app/dashboard/ads/${name}.tsx`, import.meta.url), "utf8");
  if (seedPicker) {
    const parsed = ts.createSourceFile(name + ".tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const replacements = [];
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(parsed) === "useState") {
        const field = node.name.elements[0].name.getText(parsed);
        const value = field === "rows" ? nativeTargets.map((target) => ({ query: target.name, selected: target, options: [target, { ...target, key: target.key + "-be", countryCode: "BE", region: "Région différente" }] })) : field === "extraOptions" ? nativeTargets : field === "query" ? "Lille" : undefined;
        const argument = node.initializer.arguments[0];
        if (value !== undefined && argument) replacements.push({ start: argument.getStart(parsed), end: argument.end, text: JSON.stringify(value) });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed);
    for (const change of replacements.sort((left, right) => right.start - left.start)) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  }
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function("exports", "require", compiled)(exports, (path) => aliases[path] || (path === "./ads.module.css" ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : require(path)));
  return exports;
}
const meta = await component("MetaAdsCampaignControls");
const openai = await component("ChatGPTAdsCampaignControls");
const picker = await component("MetaAdsLocationPicker", true);
const noop = () => {};
const markup = (component, props) => renderToStaticMarkup(createElement(component, props));
const calendar = { type: "total", totalEuros: 200, startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" };
function fixture(channel, stage, compact) {
  const settings = channel === "meta" ? aliases["@/lib/adsMetaCampaignSettings"].defaultMetaDeliverySettings() : aliases["@/lib/adsOpenaiCampaignSettings"].defaultOpenaiDeliverySettings();
  settings.budget = calendar;
  const budget = markup(channel === "meta" ? meta.MetaAdsBudget : openai.ChatGPTAdsBudget, { settings, dailyBudget: 25, endDate: "2026-10-21", timeZone: "Europe/Paris", onChange: noop, onDailyChange: noop, onEndDateChange: noop });
  const geography = channel === "meta" ? markup(picker.default, { accountId: "account-a", locations: nativeTargets.map((target) => target.name), targets: nativeTargets, active: true, onChange: noop, onReadyChange: noop, onAddLocation: noop }) : markup(openai.ChatGPTAdsGeography, { resources: { geographyOptions: nativeTargets.map((target) => ({ id: target.key, name: target.name, canonicalName: `${target.name}, ${target.region || "Région française"}, France`, type: target.type, countryCode: target.countryCode })) }, locations: nativeTargets.map((target) => `${target.name}, ${target.region || "Région française"}, France`), loading: false, query: "Lille", error: "", onQueryChange: noop, onSearch: noop, onLocationsChange: noop });
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#08111a}${css.replace(/:global\(([^)]+)\)/g, "$1")}.fixtureCanvas{width:calc(100% - 128px);height:calc(100dvh - 220px);margin:130px auto 0;padding:0}@media(max-width:999px){.fixtureCanvas{width:100%;height:auto;margin:0;padding:12px}}</style></head><body><main class="workspace studioWorkspace fixtureCanvas" data-channel="${channel}" ${compact ? 'data-compact="true"' : ""}><nav class="stepper" aria-label="Étapes de création">${Array.from({ length: 11 }, (_, index) => `<button type="button" aria-label="Étape ${index + 1}"><span>${index + 1}</span></button>`).join("")}</nav><section class="card studioCard ${stage === "geography" ? "studioTargetingCard" : "studioBudgetCard"}" data-channel="${channel}" ${stage === "geography" ? `data-${channel === "meta" ? "meta" : "openai"}-geography="true"` : ""}><header class="studioStepHeader"><span class="studioStepLabel">VOTRE CAMPAGNE</span><h2>${stage === "geography" ? "Zones géographiques" : "Budget et calendrier"}</h2></header><div class="studioGrid">${stage === "geography" ? geography : budget}</div></section></main></body></html>`;
}

test("Les contrôles natifs Meta et ChatGPT restent complets et accessibles sur mobile et ordinateur", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[320, 568], [390, 844], [1366, 768], [1707, 842]]) {
      for (const channel of ["meta", "openai"]) for (const stage of ["geography", "budget"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          await page.setContent(fixture(channel, stage, width < 1000));
          const layout = await page.evaluate(() => {
            const card = document.querySelector(".studioCard");
            const workspace = document.querySelector(".studioWorkspace");
            const styles = getComputedStyle(workspace);
            return { page: document.documentElement.scrollWidth, viewport: innerWidth, card: card.clientWidth, scroll: card.scrollWidth,
              content: workspace.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight),
              overflows: [...card.querySelectorAll("input,select,button,fieldset")].filter((element) => { const bounds = element.getBoundingClientRect(); const parent = card.getBoundingClientRect(); return bounds.left < parent.left - 1 || bounds.right > parent.right + 1; }).map((element) => element.outerHTML.slice(0, 150)),
            };
          });
          const context = `${channel}/${stage} ${width}×${height}: ${JSON.stringify(layout)}`;
          assert.ok(layout.page <= layout.viewport + 1, context);
          assert.ok(layout.scroll <= layout.card + 1, context);
          assert.ok(Math.abs(layout.card - layout.content) <= 3, context);
          assert.deepEqual(layout.overflows, [], context);
          const controls = page.locator(".studioCard input:not([type=hidden]),.studioCard select,.studioCard button:not([disabled])");
          assert.ok(await controls.count() >= (stage === "budget" ? 5 : 4), context);
          for (const control of await controls.all()) {
            await control.evaluate((element) => element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
            const accessible = await control.evaluate((element) => { const bounds = element.getBoundingClientRect(); const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && (top === element || element.contains(top)); });
            assert.equal(accessible, true, context);
          }
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});
