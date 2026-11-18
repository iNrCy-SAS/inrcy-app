/* eslint-disable @typescript-eslint/no-explicit-any -- isolated renderer for the actual production controls */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as timeline from "../../lib/aiMediaVideoTimeline.ts";
import * as videoOptions from "../../lib/aiMediaVideoClientOptions.ts";

const nodeRequire = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const catalogs = Object.fromEntries(locales.map(locale => [locale, JSON.parse(read(`messages/${locale}/media.json`)) as Record<string, string>]));
let locale = "fr-FR";
function productionControls() {
  const exports: Record<string, any> = {};
  const dependencies: Record<string, unknown> = {
    "react": nodeRequire("react"), "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
    "next-intl": { useLocale: () => locale, useTranslations: () => (key: string, values = {}) => new IntlMessageFormat(catalogs[locale][key] || key, locale).format(values) },
    "@/lib/aiMediaModelCatalog": models,
    "@/lib/aiMediaVideoTimeline": timeline,
    "@/lib/aiMediaVideoClientOptions": videoOptions,
    "./MediaEngineCreditControls.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const source = ts.transpileModule(read("app/dashboard/_components/MediaEngineCreditControls.tsx"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  new Function("require", "exports", source + "\nexports.fixtureInfo = MediaEngineInfoModal;")((name: string) => {
    assert.ok(name in dependencies, `Unexpected production dependency: ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}
const controls = productionControls();
const base = { kind: "image", imageEngine: "openai", videoEngine: "omni", format: "square", resolution: "720p", referenceCount: 0,
  disabled: false, onVideoEngineChange() {}, onImageEngineChange() {}, onResolutionChange() {} };
const render = (props: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(controls.default, { ...base, ...props }));
const info = (engine: string, kind = "image") => renderToStaticMarkup(createElement(controls.fixtureInfo, {
  kind, activeEngine: engine, format: "square", videoMaxDurationSeconds: 30, onClose() {},
}));

test("all image engines explain the saved-logo reference limit beside their real selector in nine languages", () => {
  const original = locale;
  try {
    for (locale of locales) for (const model of models.AI_MEDIA_IMAGE_MODELS) {
      const html = render({ imageEngine: model.id });
      const key = model.supportsReferences ? "ai_generator_image_logo_reference_limit" : "ai_generator_image_logo_unavailable";
      const expected = new IntlMessageFormat(catalogs[locale][key], locale).format({ count: model.maxReferenceImages }) as string;
      assert.ok(html.includes(expected), `${locale}/${model.id}`);
      assert.match(html, /<select[^>]+aria-describedby="[^"]+-image-logo-reference"/);
      assert.match(html, /<small[^>]+data-image-logo-reference-hint="true"/);
      assert.doesNotMatch(html, /ai_generator_image_logo_(?:reference_limit|unavailable)/);
    }
  } finally { locale = original; }
});

test("Recraft remains an explicit available choice without known references while its logo limitation is clear", () => {
  const html = render({ imageEngine: "recraft", referenceCount: 0 });
  assert.match(html, /<option value="recraft" selected=""/);
  assert.doesNotMatch(html, /<option value="recraft"[^>]*disabled/);
  assert.match(html, /Pour inclure le logo enregistré, choisissez un moteur qui accepte les images de référence/);
  assert.match(render({ imageEngine: "grok", referenceCount: 4 }), /<option value="grok"[^>]*disabled/);
});

test("the actual image information panel describes model integration rather than a guaranteed local corner overlay", () => {
  for (const engine of ["openai", "gemini", "flux", "grok"]) {
    const html = info(engine);
    assert.match(html, /Le moteur reçoit le logo enregistré comme référence/);
    assert.match(html, /Vérifiez la fidélité du résultat/);
    assert.doesNotMatch(html, /coin supérieur droit après la génération/);
  }
  assert.match(info("recraft"), /choisissez un moteur qui accepte les images de référence/);
  assert.doesNotMatch(info("recraft"), /Le moteur reçoit le logo enregistré comme référence/);
  assert.doesNotMatch(render({ kind: "video" }), /data-image-logo-reference-hint/);
  assert.doesNotMatch(info("omni", "video"), /Le moteur reçoit le logo enregistré comme référence/);
});
