import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const require = createRequire(import.meta.url), React = require("react"), ts = require("typescript");
const root = process.env.INRCY_CHANNEL_TEST_SOURCE_ROOT || process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const source = read("app/dashboard/_components/DashboardGeneratorHub.tsx");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;

function renderHub(active: boolean) {
  const loaded = { exports: {} as Value };
  const localRequire = (name: string): Value => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next-intl") return { useTranslations: () => (key: string) => key === "generatorShortTitle" ? "Générateur" : key };
    if (name === "../_hooks/useDashboardI18n") return { useDashboardI18n: () => ({ hero: { active: "Actif", waiting: "En attente", refreshAria: "Actualiser", refreshTitle: "Actualiser" } }) };
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    return { __esModule: true, default: "orb-drawing" };
  };
  new Function("require", "module", "exports", code)(localRequire, loaded, loaded.exports);
  return loaded.exports.default({ onDesktopLeftHost() {}, onDesktopRightHost() {}, onOpenGeneratorHelp() {}, onRefreshGenerator() {}, kpisLoading: false, generatorIsActive: active });
}

function nodes(tree: Value): Value[] {
  return Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement(tree) ? [tree, ...nodes(tree.props.children)] : [];
}

test("desktop generator remains visible and describes its state without any activation or settings tooltip", () => {
  for (const active of [true, false]) {
    const hub = nodes(renderHub(active)).find(node => node.props["data-testid"] === "dashboard-generator-hub");
    assert.equal(hub.type, "div");
    assert.equal(hub.props.role, "img");
    assert.equal(hub.props["data-active"], active);
    assert.equal(hub.props["aria-label"], `Générateur · ${active ? "Actif" : "En attente"}`);
    for (const key of ["onClick", "onKeyDown", "onKeyUp", "onPointerDown", "tabIndex", "title", "aria-haspopup", "href"]) assert.equal(hub.props[key], undefined, key);
    assert.equal(nodes(hub).filter(node => node.type === "button" || node.type === "a").length, 0);
  }
  assert.doesNotMatch(source, /onOpenGeneratorSettings|settingsAria|settingsTitle/);
});

test("mobile generator and all of its JSX ancestors have no click or keyboard activation", () => {
  const file = ts.createSourceFile("ResponsiveBottomNav.tsx", read("app/dashboard/_components/ResponsiveBottomNav.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let generator: Value;
  const find = (node: Value) => {
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((attribute: Value) => ts.isJsxAttribute(attribute) && attribute.name.text === "data-testid" && attribute.initializer?.text === "dashboard-mobile-generator")) generator = node;
    ts.forEachChild(node, find);
  };
  find(file); assert.ok(generator);
  assert.equal(generator.openingElement.tagName.getText(file), "div");
  const generatorText = generator.getText(file);
  assert.match(generatorText, /aria-hidden="true"/);
  assert.match(generatorText, /<DashboardGeneratorOrb isActive=\{generatorState\.isActive\}/);
  for (let current = generator; current; current = current.parent) {
    if (!ts.isJsxElement(current)) continue;
    const opening = current.openingElement;
    assert.ok(!["button", "a"].includes(opening.tagName.getText(file)));
    for (const attribute of opening.attributes.properties) {
      if (!ts.isJsxAttribute(attribute)) continue;
      assert.ok(!["onClick", "onClickCapture", "onPointerDown", "onPointerUp", "onKeyDown", "onKeyUp", "tabIndex", "href", "aria-haspopup", "title"].includes(attribute.name.text), attribute.name.text);
      if (attribute.name.text === "role") assert.notEqual(attribute.initializer?.text, "button");
    }
  }
  assert.doesNotMatch(generatorText, /onClick|tabIndex|title=|aria-haspopup/);
});

test("orb drawing keeps animation and active state while decorative hosts have no pointer affordance", () => {
  const desktop = read("app/dashboard/_components/DashboardExperience.module.css");
  const mobile = read("app/dashboard/_components/ResponsiveBottomNav.module.css");
  const drawing = read("app/dashboard/_components/DashboardGeneratorOrb.module.css");
  const desktopRule = desktop.match(/\.channelsHub\s*\{[^}]*\}/)?.[0] || "";
  const mobileRule = mobile.match(/\.generatorItem\s*\{[^}]*\}/)?.[0] || "";
  assert.match(desktopRule, /cursor: default/); assert.doesNotMatch(desktopRule, /cursor: pointer/);
  assert.match(mobileRule, /cursor: default/); assert.match(mobileRule, /pointer-events: none/);
  assert.doesNotMatch(desktop, /\.channelsHub:(?:hover|active|focus-visible)/);
  assert.match(drawing, /animation: generatorSurface/); assert.match(drawing, /\[data-active="false"\]/); assert.match(drawing, /\[data-active="unknown"\]/);
});
