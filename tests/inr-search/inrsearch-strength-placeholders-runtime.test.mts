import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

type Props = { companyName: string; strengths: string[]; inrBadgeUrl: string; inrBadgeQrUrl: string };
const compiled = ts.transpileModule(readFileSync(new URL("../../app/entreprises/[slug]/InrSearchStrengthsOrbit.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const loaded = { exports: {} as { default: React.ComponentType<Props> } };
const dependencies: Record<string, unknown> = {
  react: React, "react/jsx-runtime": await import("react/jsx-runtime"),
  "next-intl": { useTranslations: () => (key: string) => key },
  "@/lib/inrBadgeQr": { createInrBadgeQrMatrix: () => [] },
  "./inrSearchPublic.module.css": {},
};
new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected component dependency ${name}`);
  return dependencies[name];
});
const render = (strengths: string[]) => renderToStaticMarkup(React.createElement(loaded.exports.default, {
  companyName: "Utilisateur", strengths, inrBadgeUrl: "", inrBadgeQrUrl: "",
}));

test("an empty public profile shows dashes instead of inventing business commitments", () => {
  const html = render([]);
  assert.match(html, /<strong>—<\/strong>/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Rapide|Efficace|Sérieux|Proche|écoute|Utilisateur met en avant|fait partie des engagements/);
});

test("a partial list keeps only the supplied strengths and leaves the remaining slots empty", () => {
  const html = render(["Fabrication locale"]);
  assert.match(html, /Fabrication locale/);
  assert.match(html, /<strong>—<\/strong>/);
  assert.doesNotMatch(html, /Rapide|Efficace|Sérieux|Proche|écoute/);
  const complete = render(["Qualité A", "Qualité B", "Qualité C", "Qualité D", "Qualité E"]);
  assert.doesNotMatch(complete, /<strong>—<\/strong>|disabled=""/);
});
