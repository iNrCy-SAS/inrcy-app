import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { IntlMessageFormat } = require("intl-messageformat") as typeof import("intl-messageformat");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
type Props = Record<string, unknown>;
type Exports = Record<string, React.ComponentType<Props>>;
const noop = () => {};

/** Execute actual view components with real catalog formatting, without account APIs. */
export function responsiveSurfaceFixture(locale: string) {
  const messages: Record<string, unknown> = Object.fromEntries(readdirSync(path.join(root, "messages", locale)).filter(file => file.endsWith(".json")).map(file => [file.slice(0, -5), JSON.parse(read(`messages/${locale}/${file}`))]));
  const modules = new Map<string, { exports: Exports }>();
  const classes = new Map<string, Record<string, string>>();
  const css: string[] = [];
  function stylesheet(file: string) {
    if (classes.has(file)) return classes.get(file)!;
    const mapping: Record<string, string> = {};
    const prefix = `surface${classes.size + 1}_`;
    classes.set(file, mapping);
    const ast = postcss.parse(read(file));
    ast.walkAtRules("import", rule => { rule.remove(); });
    ast.walkRules(rule => { rule.selector = rule.selector.replace(/:global\(([^)]+)\)/g, "$1").replace(/\.([A-Za-z_][\w-]*)/g, (_match, name: string) => `.${mapping[name] = prefix + name}`); });
    css.push(ast.toString());
    return mapping;
  }
  const translate = (namespace = "") => (key: string, values: Record<string, string | number> = {}) => {
    const value = [namespace, key].filter(Boolean).join(".").split(".").reduce<unknown>((value, part) => value && typeof value === "object" ? (value as Props)[part] : undefined, messages);
    assert.equal(typeof value, "string", `Catalog message ${namespace}.${key}`);
    return new IntlMessageFormat(value as string, locale).format(values);
  };
  function load(file: string): Exports {
    if (modules.has(file)) return modules.get(file)!.exports;
    const record = { exports: {} as Exports };
    modules.set(file, record);
    const code = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("require", "module", "exports", code)((id: string): unknown => {
      if (id === "react" || id === "react/jsx-runtime") return require(id);
      if (id === "next-intl") return { useLocale: () => locale, useTranslations: translate };
      if (id === "next/image") return { __esModule: true, default: ({ src, alt, width, height, className }: Props) => React.createElement("img", { src, alt, width, height, className }) };
      if (id === "next/link") return { __esModule: true, default: ({ children, ...props }: Props) => React.createElement("a", props, children as React.ReactNode) };
      if (id.endsWith("mailboxPhase1")) return { toolbarActionTheme: () => ({}), MAILBOX_PAGE_SIZE: 20, isGroupedActionFolder: () => false, listGridTemplateColumns: () => "minmax(0,1fr) minmax(0,1fr) 90px 40px" };
      if (id.endsWith("inrcyDialog")) return { confirmInrcy: async () => false };
      if (id.endsWith("DashboardAssistantProvider")) return { useDashboardAssistant: () => ({ openAssistant: noop, toggleAssistant: noop }) };
      if (id.endsWith("useInrAssistantLocalInterface")) return { useInrAssistantLocalInterface: noop };
      if (id.endsWith("DashboardAssistantScreenContext")) return { useInrAssistantScreen: noop };
      if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: true, actorUserId: "fixture-actor", activeAccountId: "fixture-account" }) };
      if (id.endsWith("browserAccountCache")) return { getActiveBrowserUserId: () => "fixture-account" };
      if (/SettingsDrawer|AgendaSettingsContent|HelpModal$/.test(id)) return { __esModule: true, default: () => null };
      const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : id.startsWith(".") ? path.resolve(root, path.dirname(file), id) : null;
      assert.ok(base, `Unexpected responsive fixture import ${id} from ${file}`);
      const resolved = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map(suffix => base + suffix).find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      assert.ok(resolved, `Resolve ${id} from ${file}`);
      const relative = path.relative(root, resolved).replaceAll("\\", "/");
      return relative.endsWith(".css") ? { __esModule: true, default: stylesheet(relative) } : load(relative);
    }, record, record.exports);
    return record.exports;
  }
  return {
    load,
    stylesheet,
    t: translate,
    element(file: string, props: Props, name = "default") { return React.createElement(load(file)[name], props); },
    markup(node: React.ReactNode, wrapperClass = "") {
      const markup = renderToStaticMarkup(node);
      return `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${read("app/globals.css").replace(/^@import[^;]+;/gm, "")}*{box-sizing:border-box}body{margin:0;padding:12px;background:#0b142c;color:#f4f7ff;font:14px Arial}button,input,select,textarea{font:inherit}${css.join("\n")}</style></head><body><div id="surface" class="${wrapperClass}">${markup}</div></body></html>`;
    },
    noop,
  };
}
