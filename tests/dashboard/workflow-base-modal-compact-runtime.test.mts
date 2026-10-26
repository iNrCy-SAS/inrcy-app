import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compiled = ts.transpileModule(read("app/dashboard/_components/WorkflowBaseModal.tsx"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
type Effect = () => void | (() => void);

function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return isValidElement<Props>(tree) ? [tree, ...elements(tree.props.children as ReactNode)] : [];
}
function find(tree: ReactNode, predicate: (node: Element) => boolean) {
  const result = elements(tree).find(predicate);
  assert.ok(result, "Expected modal element is missing");
  return result;
}

function harness(compact: boolean, maxWidth = 760) {
  const effects: Effect[] = [];
  const listeners = new Map<string, (event: { key: string }) => void>();
  const document = {
    documentElement: { style: { overflow: "auto" } },
    body: { style: { overflow: "auto", touchAction: "pan-y", overscrollBehavior: "auto" } },
  };
  const window = {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (name: string, callback: (event: { key: string }) => void) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  let closeCalls = 0;
  const loadedModule = { exports: {} as { default?: (props: Props) => ReactNode } };
  new Function("require", "module", "exports", "window", "document", compiled)((specifier: string) => {
    if (specifier === "react/jsx-runtime") return require(specifier);
    if (specifier === "react") return {
      useState: (initial: unknown) => [initial, () => undefined],
      useEffect: (effect: Effect) => effects.push(effect),
    };
    if (specifier === "next-intl") return { useTranslations: () => (key: string) => key };
    if (specifier === "./DashboardAssistantTrigger") return { __esModule: true, default: () => null };
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    throw new Error(`Unexpected modal dependency: ${specifier}`);
  }, loadedModule, loadedModule.exports, window, document);
  const tree = loadedModule.exports.default!({
    compact, maxWidth, title: "Choisir une action", onClose: () => { closeCalls += 1; },
    children: createElement("button", { type: "button" }, "Ouvrir l’outil"),
  });
  const overlay = find(tree, node => node.props.role === "dialog");
  const dialog = find(tree, node => typeof node.props.onMouseDown === "function" && node !== overlay);
  return { tree, overlay, dialog, effects, document, listeners, closeCalls: () => closeCalls };
}

test("compact selectors bypass the global full-screen opt-in while preserving their initial width", () => {
  const globalCss = read("app/globals.css");
  assert.ok(globalCss.includes(":root body [data-inrcy-tool-overlay] > [data-inrcy-tool-dialog]"));
  for (const maxWidth of [560, 760]) {
    const h = harness(true, maxWidth);
    assert.equal(h.overlay.props["data-inrcy-tool-overlay"], undefined);
    assert.equal(h.dialog.props["data-inrcy-tool-dialog"], undefined);
    const overlayStyle = h.overlay.props.style as Props;
    const dialogStyle = h.dialog.props.style as Props;
    assert.equal(overlayStyle.alignItems, "center");
    assert.equal(overlayStyle.justifyContent, "center");
    assert.equal(dialogStyle.height, "auto");
    assert.equal(dialogStyle.maxWidth, `${maxWidth}px`);
    assert.ok(String(dialogStyle.maxHeight).includes("100dvh"));
    const html = renderToStaticMarkup(h.tree);
    assert.ok(!html.includes("data-inrcy-tool-overlay"));
    assert.ok(!html.includes("data-inrcy-tool-dialog"));
  }
});

test("real tool workspaces retain the existing full-screen contract", () => {
  const h = harness(false);
  assert.equal(h.overlay.props["data-inrcy-tool-overlay"], true);
  assert.equal(h.dialog.props["data-inrcy-tool-dialog"], true);
  const dialogStyle = h.dialog.props.style as Props;
  assert.equal(dialogStyle.width, "100%");
  assert.equal(dialogStyle.height, "100%");
  assert.equal(dialogStyle.maxWidth, "100%");
  assert.ok(renderToStaticMarkup(h.tree).includes("data-inrcy-tool-overlay"));
});

test("compact selectors keep backdrop, close button, Escape and scroll restoration behaviours", () => {
  const h = harness(true);
  const cleanup = h.effects.map(effect => effect()).filter((effect): effect is () => void => typeof effect === "function");
  assert.equal(h.document.body.style.overflow, "hidden");
  assert.equal(h.document.documentElement.style.overflow, "hidden");
  (h.overlay.props.onMouseDown as () => void)();
  assert.equal(h.closeCalls(), 1);
  let stopped = 0;
  (h.dialog.props.onMouseDown as (event: unknown) => void)({ stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1);
  assert.equal(h.closeCalls(), 1, "A click inside the selector must not close it");
  const close = find(h.tree, node => node.type === "button" && node.props["aria-label"] === "fermer_5ab4ec64");
  (close.props.onClick as () => void)();
  h.listeners.get("keydown")!({ key: "Escape" });
  assert.equal(h.closeCalls(), 3);
  cleanup.forEach(effect => effect());
  assert.equal(h.listeners.size, 0);
  assert.equal(h.document.body.style.overflow, "auto");
  assert.equal(h.document.documentElement.style.overflow, "auto");
  assert.equal(h.document.body.style.touchAction, "pan-y");
  assert.equal(h.document.body.style.overscrollBehavior, "auto");
});
