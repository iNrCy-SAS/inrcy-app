import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React, { type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { IntlMessageFormat } from "intl-messageformat";

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return React.isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children as ReactNode)] : [];
}
function load(file: string, stubs: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} as { default: (props: Props) => ReactNode } };
  new Function("module", "exports", "require", compiled)(loadedModule, loadedModule.exports, (name: string) => {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    return require(name);
  });
  return loadedModule.exports;
}
const mobile = load("app/dashboard/_components/DashboardMobileSelect.tsx");
const catalogs = new Map<string, Record<string, string>>();
const folderModules = new Map<string, ReturnType<typeof load>>();
function translate(locale: string, key: string, values: Record<string, string | number> = {}) {
  if (!catalogs.has(locale)) catalogs.set(locale, JSON.parse(readFileSync(new URL(`../../messages/${locale}/mails.json`, import.meta.url), "utf8")));
  const message = catalogs.get(locale)![key];
  assert.equal(typeof message, "string", `Missing ${locale}.mails.${key}`);
  return new IntlMessageFormat(message, locale).format(values) as string;
}
function folderModule(locale: string) {
  if (!folderModules.has(locale)) folderModules.set(locale, load("app/dashboard/mails/_components/FolderTabs.tsx", {
    react: { ...React, useId: () => "folder-count-error" },
    "next-intl": { useTranslations: (namespace: string) => { assert.equal(namespace, "mails"); return (key: string, values?: Record<string, string | number>) => translate(locale, key, values); } },
    "../../_components/DashboardMobileSelect": mobile,
    "../_lib/mailboxPhase1": { ALL_FOLDERS: ["mails", "factures"], folderTheme: () => ({}) },
  }));
  return folderModules.get(locale)!;
}
function render(props: Props = {}, locale = "fr-FR") {
  const selected: string[] = [];
  let adsSelected = 0;
  const tree = folderModule(locale).default({ folder: "mails", counts: { mails: 4, factures: 2 }, onSelectFolder: (folder: string) => selected.push(folder), adsTab: { active: false, count: 7, onSelect: () => { adsSelected++; } }, ...props });
  const component = nodes(tree).find(node => node.type === mobile.default)!;
  const select = nodes(mobile.default(component.props)).find(node => node.type === "select")!;
  const options = nodes(select).filter(node => node.type === "option");
  const change = (value: string) => (select.props.onChange as (event: unknown) => void)({ currentTarget: { value } });
  return { tree, select, options, change, selected, adsSelected: () => adsSelected };
}

test("iNrSend mobile folders and ADS retain distinct navigation callbacks and the routed selection", () => {
  const h = render();
  assert.equal(h.select.props["aria-label"], "Dossiers");
  assert.deepEqual(h.options.map(option => [option.props.value, option.props.children]), [["mails", "Mails · 4"], ["factures", "Factures · 2"], ["campagnes-ads", "ADS · 7"]]);
  h.change("mails");
  h.change("unknown");
  assert.deepEqual(h.selected, []);
  h.change("factures");
  assert.deepEqual(h.selected, ["factures"]);
  h.change("campagnes-ads");
  assert.equal(h.adsSelected(), 1);
  assert.deepEqual(h.selected, ["factures"]);
  assert.equal(h.select.props.value, "mails", "The owner remains authoritative until routing finishes");
});

test("iNrSend mobile selection cannot enter a folder or ADS that the account does not expose", () => {
  const h = render({ folders: ["mails"], adsTab: undefined });
  assert.deepEqual(h.options.map(option => option.props.value), ["mails"]);
  h.change("factures");
  h.change("campagnes-ads");
  assert.deepEqual(h.selected, []);
  assert.equal(h.adsSelected(), 0);
});

test("iNrSend mobile keeps loading and failed counts distinct from zero and announces ADS errors", () => {
  const loading = render({ countsLoading: true, adsTab: { active: true, count: null, onSelect() {} } });
  assert.equal(loading.select.props.value, "campagnes-ads");
  assert.deepEqual(loading.options.map(option => option.props.children), ["Mails · …", "Factures · …", "ADS · …"]);
  const failed = render({ adsTab: { active: true, count: null, countError: "Comptage indisponible", onSelect() {} } });
  assert.equal(failed.options.at(-1)?.props.children, "ADS · —");
  assert.equal(failed.select.props["aria-describedby"], "folder-count-error");
  const status = nodes(failed.tree).find(node => node.props.id === failed.select.props["aria-describedby"]);
  assert.equal(status?.props.role, "status");
  assert.equal((status?.props.children as ReactNode[]).join("").replace(/\s*:\s*/, ": "), "ADS: Comptage indisponible");
});

for (const locale of ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
  test(`${locale}: mobile folder names and the accessible selector label use their distinct catalog messages`, () => {
    const h = render({}, locale);
    const label = translate(locale, "dossiers_2a59919f");
    assert.equal(h.select.props["aria-label"], label);
    assert.deepEqual(h.options.map(option => [option.props.value, option.props.children]), [
      ["mails", `${translate(locale, "mails_8d79d3a8")} · 4`],
      ["factures", `${translate(locale, "factures_da35e4f2")} · 2`],
      ["campagnes-ads", "ADS · 7"],
    ]);
    assert.notEqual(h.options[0].props.children, `${label} · 4`, "the selector label must not replace the folder name");
    h.change("factures"); h.change("campagnes-ads");
    assert.deepEqual(h.selected, ["factures"]);
    assert.equal(h.adsSelected(), 1);
  });
}
