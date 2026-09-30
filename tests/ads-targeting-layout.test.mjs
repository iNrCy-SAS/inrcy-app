import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = await readFile(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const parsed = ts.createSourceFile("AdsClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const samples = {
  PinterestLocationSearch: [
    { id: "250059", name: "France: Nord", type: "LOCATION", kind: "metro" },
    { id: "250062", name: "France: Pas-de-Calais", type: "LOCATION", kind: "metro" },
    { id: "FR-HDF", name: "France: Hauts-de-France", type: "GEO", kind: "region" },
    { id: "FR-IDF", name: "France: Île-de-France", type: "GEO", kind: "region" },
  ],
  GoogleLocationSearch: [
    { id: "100001", name: "Lille", canonicalName: "Lille,Hauts-de-France,France", country: "FR" },
    { id: "100002", name: "Lille", canonicalName: "Lille,Flanders,Belgium", country: "BE" },
    { id: "100003", name: "Lille", canonicalName: "Lille,Nord,Hauts-de-France,France", country: "FR" },
    { id: "100004", name: "Lille", canonicalName: "Lille,Maine,United States", country: "US" },
  ],
};

function functionSource(name) {
  const node = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Composant ${name} absent`);
  let text = node.getText(parsed);
  if (!samples[name]) return text;
  // Only seed initial hook state to represent a completed search. Rendered JSX,
  // paging and all production class names are preserved from the actual source.
  const replacements = [];
  const visit = (child) => {
    if (ts.isVariableDeclaration(child) && ts.isArrayBindingPattern(child.name)
      && child.initializer && ts.isCallExpression(child.initializer)
      && child.initializer.expression.getText(parsed) === "useState") {
      const stateName = child.name.elements[0]?.name?.getText(parsed);
      const value = stateName === "options" ? samples[name] : stateName === "state" ? "ready" : stateName === "query" ? "Lille" : undefined;
      const initial = child.initializer.arguments[0];
      if (value !== undefined && initial) replacements.push({ start: initial.getStart(parsed) - node.getStart(parsed), end: initial.end - node.getStart(parsed), value: JSON.stringify(value) });
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) text = text.slice(0, replacement.start) + replacement.value + text.slice(replacement.end);
  return text;
}

let targetingSection;
function findTargeting(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === "section"
    && node.openingElement.attributes.getText(parsed).includes("studioTargetingCard")) targetingSection = node;
  else ts.forEachChild(node, findTargeting);
}
findTargeting(parsed);
assert.ok(targetingSection, "Section ciblage absente");

const fixtureSource = `
const { useCallback, useEffect, useId, useRef, useState } = require("react");
const styles = new Proxy({}, { get: (_, key) => String(key) });
function MediaSubjectVoiceButton({ contextLabel }) {
  return <span style={{display:"inline-flex",flex:"0 0 auto"}}><button type="button" aria-label={"Micro : " + contextLabel} style={{minWidth:34,height:32,padding:"0 8px"}}>🎙️</button></span>;
}
${["TagField", "PinterestLocationSearch", "GoogleLocationSearch", "StudioStepHeader"].map(functionSource).join("\n")}
export function TargetingFixture({channelId}) {
  const step = 3, targetingStep = 3;
  const channelMeta = { label: channelId === "google" ? "Google Ads" : "Pinterest Ads" };
  const nativeSettings = channelId === "pinterest" ? {channel:"pinterest",targetingMode:"automatic"} : null;
  const draft = { adAccountId:"1234567890", targetLocations:["Hauts-de-France","Arras","Lille","Valenciennes","Saint-Omer","Sallaumines"],
    targetAudiences:["Professionnels indépendants","Artisans et commerçants","TPE et PME souhaitant améliorer leur visibilité en ligne","Responsables communication de petites structures"], languages:["fr"], keywords:[] };
  const externalStatuses = {pinterest:{selectedAccountId:"1234567890"}}, configuredAccountId = "1234567890";
  const updateDraft = () => {}, updatePinterestTargetingMode = () => {};
  return ${targetingSection.getText(parsed)};
}`;
const compiled = ts.transpileModule(fixtureSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const moduleExports = {};
new Function("exports", "require", compiled)(moduleExports, require);

function fixture(channelId, mobile) {
  const markup = renderToStaticMarkup(createElement(moduleExports.TargetingFixture, { channelId }));
  return `<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;background:#0b1636}
  ${css.replace(/:global\(([^)]+)\)/g, "$1")}
  .fixtureCanvas{width:calc(100% - 128px);max-width:none;height:calc(100dvh - 270px);margin:160px auto 0;padding:0}
  @media(max-width:999px){.fixtureCanvas{width:100%;height:auto;margin:0;padding:12px;overflow:visible}}
  </style></head><body><main class="workspace studioWorkspace fixtureCanvas" ${mobile ? 'data-compact="true"' : ""}>${markup}</main></body></html>`;
}

test("le vrai ciblage Google et Pinterest avec trois résultats tient dans le canevas desktop", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [width, height] of [[1707, 842], [1366, 768]]) {
      for (const channel of ["google", "pinterest"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        try {
          await page.setContent(fixture(channel, false));
          const list = page.locator(".pinterestLocationOptions");
          assert.equal(await list.locator("li").count(), 3, `${channel}: la recherche doit montrer trois résultats`);
          assert.equal(await page.getByRole("navigation", { name: /Parcourir les zones/ }).count(), 1, `${channel}: pagination absente`);
          const layout = await page.locator(".studioTargetingCard").evaluate((card) => ({ height: card.clientHeight, scrollHeight: card.scrollHeight, width: card.clientWidth, scrollWidth: card.scrollWidth }));
          assert.ok(layout.scrollHeight <= layout.height + 1, `${channel} ${width}×${height}: débordement ${JSON.stringify(layout)}`);
          assert.ok(layout.scrollWidth <= layout.width + 1, `${channel} ${width}×${height}: débordement horizontal`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});

test("le vrai ciblage conserve la recherche, ses résultats et les langues accessibles sur mobile", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 375]) {
      for (const channel of ["google", "pinterest"]) {
        const page = await browser.newPage({ viewport: { width, height: 667 } });
        try {
          await page.setContent(fixture(channel, true));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${channel} ${width}: scroll horizontal`);
          for (const control of [page.locator(".pinterestLocationSearchActions input"), page.locator(".pinterestLocationOptions button").last(), page.locator(".studioLanguageField input")]) {
            await control.scrollIntoViewIfNeeded();
            const visible = await control.evaluate((element) => {
              const bounds = element.getBoundingClientRect();
              const topmost = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
              return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight && (element === topmost || element.contains(topmost));
            });
            assert.equal(visible, true, `${channel} ${width}: contrôle inaccessible`);
          }
        } finally { await page.close(); }
      }
    }
  } finally { await browser.close(); }
});
