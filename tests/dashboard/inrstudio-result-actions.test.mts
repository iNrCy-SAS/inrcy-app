import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Element = { type: string; props: Record<string, unknown> };
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function footerAction(name: "MediaFreeGenerator" | "MediaModifier", overrides: Record<string, unknown> = {}) {
  const path = `app/dashboard/_components/${name}.tsx`;
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let button: ts.JsxElement | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" &&
      node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "data-media-primary-action")) {
      assert.equal(button, undefined, "There must be a single primary action in each footer");
      button = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(button, `${name} must expose its primary action`);
  const events: string[] = [];
  const context = {
    busy: false, generationBusy: false, cancellable: true, generationCancellable: true,
    canRecover: false, recoveryIncompatible: false, operationLocked: false, canGenerate: true, result: null, kind: "image",
    sourceImage: {}, instruction: "Update the background", quotaLoading: false,
    creditQuote: { ready: true, insufficient: false }, imageQuotaExhausted: false,
    styles: { primaryButton: "primaryButton" }, t: (key: string) => key,
    setStopConfirmOpen: (open: boolean) => events.push(`stop:${open}`),
    handleRequestGenerationStop: () => events.push("stop:true"),
    handleRecoverResult: () => events.push("recover"), handleRecovery: () => events.push("recover"),
    handleGenerate: () => events.push("generate"),
    ...overrides,
  };
  const output = ts.transpileModule(`const action = (${button.getText(source)});`, {
    fileName: "footer.tsx",
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type: string, props: Record<string, unknown>) => ({ type, props });
  const action = new Function("exports", "require", ...Object.keys(context), `${output}; return action;`)(
    {},
    (id: string) => {
      assert.equal(id, "react/jsx-runtime");
      return { jsx, jsxs: jsx };
    }, ...Object.values(context),
  ) as Element;
  return { action, events };
}

function text(node: unknown): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string") return node;
  return node && typeof node === "object" && "props" in node ? text((node as Element).props.children) : "";
}

function invoke(action: Element) { (action.props.onClick as () => void)(); }

test("the footer keeps its original action disabled after image or video success", () => {
  for (const name of ["MediaFreeGenerator", "MediaModifier"] as const) {
    for (const kind of name === "MediaFreeGenerator" ? ["image", "video"] : ["image"]) {
      for (const draft of [true, false]) {
        const { action, events } = footerAction(name, { kind, result: { draft, item: { media_type: kind } } });
        assert.equal(action.props.disabled, true);
        assert.match(text(action), new RegExp(name === "MediaModifier" ? "ai_modifier_action" : `ai_generator_generate_${kind}`));
        assert.doesNotMatch(text(action), /ai_generator_regenerate|↻/);
        invoke(action); // Even a direct stale handler invocation must not start a paid request.
        assert.deepEqual(events, []);
      }
    }
  }
});

test("a fresh workspace generates normally while Stop and recovery retain their existing actions", () => {
  for (const name of ["MediaFreeGenerator", "MediaModifier"] as const) {
    const fresh = footerAction(name);
    assert.equal(fresh.action.props.disabled, false);
    invoke(fresh.action);
    assert.deepEqual(fresh.events, ["generate"]);
    const stopping = footerAction(name, { busy: true, generationBusy: true });
    assert.equal(stopping.action.props.disabled, false);
    assert.match(text(stopping.action), /ai_generator_editor_stop/);
    invoke(stopping.action);
    assert.deepEqual(stopping.events, ["stop:true"]);
    assert.equal(footerAction(name, { busy: true, generationBusy: true, cancellable: false, generationCancellable: false }).action.props.disabled, true);
    const recovering = footerAction(name, { canRecover: true, canGenerate: false, creditQuote: { ready: false } });
    assert.equal(recovering.action.props.disabled, false);
    assert.match(text(recovering.action), /ai_generator_editor_recover/);
    invoke(recovering.action);
    assert.deepEqual(recovering.events, ["recover"]);
  }
});

test("the French result action uses the agreed single word Réajuster", () => {
  const messages = JSON.parse(read("messages/fr-FR/media.json"));
  assert.equal(messages.ai_generator_free_edit_prompt, "Réajuster");
});

test("an incompatible stored result cannot activate the free-generation footer recovery button", () => {
  const incompatible = footerAction("MediaFreeGenerator", {
    canRecover: true, recoveryIncompatible: true, canGenerate: false,
  });
  assert.equal(incompatible.action.props.disabled, true);
  assert.match(text(incompatible.action), /ai_generator_editor_recover/);
  assert.deepEqual(incompatible.events, []);
  const compatible = footerAction("MediaFreeGenerator", {
    canRecover: true, recoveryIncompatible: false, canGenerate: false,
  });
  assert.equal(compatible.action.props.disabled, false);
  invoke(compatible.action);
  assert.deepEqual(compatible.events, ["recover"]);
});
