import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import ts from "typescript";

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
const assistantName = "Ouvrir iNr’Assistant";
const code = ts.transpileModule(readFileSync(new URL("../../app/dashboard/SettingsDrawer.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

/** Render the real drawer markup after hydration. Lifecycle hooks are inert;
 * Chromium computes accessible names and focus from the actual rendered DOM. */
function drawerMarkup(title: string, width: number, customHeader: boolean) {
  const react = { ...React, useId: () => "settings-drawer-title", useEffect() {}, useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value === false ? true : value === 1440 ? width : typeof value === "function" ? value() : value, () => {}],
  };
  const contexts = Object.fromEntries(["DrawerHeaderTabsContext", "DrawerHeaderActionsContext", "DrawerHeaderDetailsContext"].map(name => [name, React.createContext(null)]));
  const record = { exports: {} as { default: (props: Props) => React.ReactNode } };
  new Function("module", "exports", "require", "document", code)(record, record.exports, (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react-dom") return { createPortal: (children: React.ReactNode) => children };
    if (name === "./DrawerHeaderTabs") return contexts;
    if (name === "./_hooks/useDashboardI18n") return { useDashboardI18n: () => ({ drawer: { close: "Fermer" } }) };
    if (name === "./_components/DashboardAssistantTrigger") return { __esModule: true, default: () => React.createElement("button", { type: "button", "aria-label": assistantName }, "robot") };
    if (name.endsWith(".module.css")) return { __esModule: true, default: {} };
    throw new Error(`Unexpected drawer dependency: ${name}`);
  }, { body: {} });
  return renderToStaticMarkup(record.exports.default({ title, isOpen: true, onClose() {}, children: React.createElement("p", {}, "Abonnement"), ...(customHeader ? { headerContent: React.createElement("strong", {}, title) } : {}) }));
}

test("settings dialogs keep the exact title as their accessible name while assistant access stays focusable", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [title, width, customHeader] of [["Mon compte", 1440, false], ["Réglages Agenda", 390, false], ["Mon compte", 1440, true]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.setContent(drawerMarkup(title, width, customHeader));
      assert.equal(await page.getByRole("dialog", { name: title, exact: true }).count(), 1, "Assistant text must not become part of the dialog name");
      if (!customHeader) assert.equal(await page.getByRole("heading", { name: title, exact: true }).count(), 1);
      const assistant = page.getByRole("button", { name: assistantName, exact: true });
      assert.equal(await assistant.isVisible(), true);
      await assistant.focus();
      assert.equal(await assistant.evaluate(element => element === document.activeElement), true);
    }
  } finally { await browser.close(); }
});
