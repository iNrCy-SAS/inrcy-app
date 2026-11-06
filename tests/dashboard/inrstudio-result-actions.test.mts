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
  let recoveryPending: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "recoveryPending") recoveryPending = node.initializer;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "button" &&
      node.openingElement.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "data-media-primary-action")) {
      assert.equal(button, undefined, "There must be a single primary action in each footer");
      button = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(button, `${name} must expose its primary action`);
  assert.ok(recoveryPending, `${name} must keep its real pending-recovery guard`);
  const events: string[] = [];
  const context: Record<string, unknown> = {
    busy: false, generationBusy: false, cancellable: true, generationCancellable: true,
    authorizationVisible: false, authorizationChecked: true, instanceId: "footer-test",
    canRecover: false, recovering: false, canPauseRecovery: false, recoveryContext: null, cancellationPending: false,
    recoveryIncompatible: false, operationLocked: false, canGenerate: true, result: null, kind: "image",
    sourceImage: {}, instruction: "Update the background", quotaLoading: false,
    creditQuote: { ready: true, insufficient: false }, imageQuotaExhausted: false,
    styles: { primaryButton: "primaryButton" }, t: (key: string) => key,
    setStopConfirmOpen: (open: boolean) => events.push(`stop:${open}`),
    handleRequestGenerationStop: () => events.push("stop:true"),
    handleRecoverResult: () => events.push("recover"), handleRecovery: () => events.push("recover"),
    handleGenerate: () => events.push("generate"),
    ...overrides,
  };
  // Evaluate the actual component's guard instead of mirroring it in a stub.
  context.recoveryPending = new Function(...Object.keys(context), `return (${recoveryPending.getText(source)});`)(...Object.values(context));
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
    assert.match(text(stopping.action), new RegExp(name === "MediaModifier" ? "ai_generator_recovery_cancel" : "ai_generator_editor_stop"));
    invoke(stopping.action);
    assert.deepEqual(stopping.events, ["stop:true"]);
    assert.equal(footerAction(name, { busy: true, generationBusy: true, cancellable: false, generationCancellable: false }).action.props.disabled, true);
    const recovering = footerAction(name, { canRecover: true, canGenerate: false, creditQuote: { ready: false } });
    assert.equal(recovering.action.props.disabled, false);
    assert.match(text(recovering.action), /ai_generator_recovery_check/);
    invoke(recovering.action);
    assert.deepEqual(recovering.events, ["recover"]);
  }
});

test("checking and paused recovery keep the same-result action separate from generation and cancellation", () => {
  for (const name of ["MediaFreeGenerator", "MediaModifier"] as const) {
    const checking = footerAction(name, { canRecover: true, recovering: true, busy: true, generationBusy: true, cancellable: false, generationCancellable: false, canGenerate: false, creditQuote: { ready: false } });
    assert.equal(checking.action.props.disabled, true, "an in-flight status check cannot be submitted again");
    assert.match(text(checking.action), /ai_generator_recovery_checking/);
    assert.doesNotMatch(text(checking.action), /ai_generator_editor_stop|ai_generator_recovery_cancel/);
    assert.deepEqual(checking.events, []);
    const paused = footerAction(name, { canRecover: true, recovering: false, canGenerate: false, creditQuote: { ready: false } });
    assert.equal(paused.action.props.disabled, false, "checking the existing result needs no new quote");
    invoke(paused.action); assert.deepEqual(paused.events, ["recover"]);
    const locked = footerAction(name, { canRecover: true, operationLocked: true, canGenerate: false, creditQuote: { ready: false } });
    assert.equal(locked.action.props.disabled, true, "microphone and other exclusive operations keep their lock");
    assert.deepEqual(locked.events, []);
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
  assert.match(text(incompatible.action), /ai_generator_recovery_check/);
  assert.deepEqual(incompatible.events, []);
  const compatible = footerAction("MediaFreeGenerator", {
    canRecover: true, recoveryIncompatible: false, canGenerate: false,
  });
  assert.equal(compatible.action.props.disabled, false);
  invoke(compatible.action);
  assert.deepEqual(compatible.events, ["recover"]);
});
