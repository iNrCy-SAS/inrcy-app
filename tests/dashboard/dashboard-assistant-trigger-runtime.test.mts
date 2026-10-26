import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../app/dashboard/_components/DashboardAssistantTrigger.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return isValidElement<Props>(tree) ? [tree, ...elements(tree.props.children as ReactNode)] : [];
}

for (const state of [null, "active", "pending", "unread"] as const) {
  test(`a tool header opens the existing assistant without navigation: ${state || "idle"}`, () => {
    let toggles = 0;
    const record = { exports: {} as { default: () => Element; DashboardAssistantBadge: (props: { state: typeof state }) => ReactNode } };
    new Function("module", "exports", "require", compiled)(record, record.exports, (name: string) => {
      if (name === "react/jsx-runtime") return require(name);
      if (name === "next/image") return { __esModule: true, default: "img" };
      if (name === "./DashboardAssistantProvider") return { useDashboardAssistant: () => ({ toggleAssistant: () => { toggles += 1; }, assistantLabel: "Resume conversation", assistantOpen: false, assistantPending: state === "pending", assistantBadgeState: state }) };
      if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      assert.fail(`Unexpected header dependency ${name}`);
    });
    const trigger = record.exports.default();
    assert.equal(trigger.type, "button");
    assert.equal(trigger.props["aria-controls"], "inrcy-assistant-dialog", "Drawer focus management must be able to follow the assistant portal");
    assert.equal(trigger.props["aria-haspopup"], "dialog");
    assert.equal(trigger.props["aria-busy"], state === "pending" ? true : undefined);
    assert.equal(elements(trigger).find(node => node.type === "img")?.props.src, "/agent/agent-assist-pink-v2.png");
    assert.equal(trigger.props.href, undefined);
    (trigger.props.onClick as () => void)();
    assert.equal(toggles, 1);
    const badge = record.exports.DashboardAssistantBadge({ state });
    if (!state) assert.equal(badge, null);
    else {
      assert.ok(isValidElement<Props>(badge));
      assert.equal(badge.props["data-state"], state);
      assert.equal(badge.props["aria-hidden"], "true", "The labeled robot already describes the assistant state");
    }
  });
}
