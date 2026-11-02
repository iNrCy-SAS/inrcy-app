import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Slot = { deps?: readonly unknown[]; cleanup?: () => void; value?: unknown };
function hooks() {
  const slots: Slot[] = [];
  const pending: Array<() => void> = [];
  let cursor = 0;
  const changed = (before: readonly unknown[] | undefined, after: readonly unknown[]) =>
    !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  return {
    useEffect(callback: () => void | (() => void), deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (!changed(slot.deps, deps)) return;
      slot.deps = deps;
      pending.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
    },
    useEffectEvent(callback: () => unknown) {
      const slot = slots[cursor++] ??= {};
      slot.value = callback;
      // Effect Events deliberately have a new identity; they must not restart
      // the selection effect when only the latest template snapshot changes.
      return () => (slot.value as () => unknown)();
    },
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (changed(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value as T;
    },
    render<T>(run: () => T) { cursor = 0; const result = run(); pending.splice(0).forEach(effect => effect()); return result; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

function extract(path: string, predicate: (node: ts.Node, file: ts.SourceFile) => boolean) {
  const source = readFileSync(new URL(`../../app/dashboard/${path}`, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements: string[] = [];
  function visit(node: ts.Node) {
    if (predicate(node, file)) statements.push(node.getText(file));
    else ts.forEachChild(node, visit);
  }
  visit(file);
  return statements.join("\n");
}

const editors = [
  "fideliser/components/enqueter/EnqueterModal.tsx",
  "fideliser/components/informer/InformerModal.tsx",
  "fideliser/components/suivre/SuivreModal.tsx",
  "propulser/components/offrir/OffrirModal.tsx",
  "propulser/components/recolter/RecolterModal.tsx",
  "propulser/components/valoriser/ValoriserModal.tsx",
];
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

for (const path of editors) test(`${path}: selection initializes once, stale responses and restored drafts stay isolated`, async () => {
  const source = extract(path, (node, file) =>
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(file) === "onTemplateSelectionChanged")) ||
    (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === "useEffect" && node.expression.arguments[1]?.getText(file) === "[selected?.key]"));
  const runtime = hooks();
  const view = { subject: "", text: "", html: "" };
  const requests: Array<{ body: string; resolve: (value: Response) => void }> = [];
  const props = {
    selected: { key: "a", subject: "A", body: "body A" }, restoredWorkflowKeyRef: { current: "" },
    setAiContentGenerated() {}, setSubject: (value: string) => { view.subject = value; },
    setBody: (value: string) => { view.text = value; }, setBodyHtml: (value: string) => { view.html = value; },
  };
  const code = ts.transpileModule(`return function render({${Object.keys(props).join(",")}}) { ${source} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function("useEffect", "useEffectEvent", "fetch", "textToRichMailHtml", code)(
    runtime.useEffect, runtime.useEffectEvent,
    (_url: string, options: { body: string }) => new Promise<Response>(resolve => requests.push({ body: options.body, resolve })),
    (text: string) => `<p>${text}</p>`,
  );
  const render = () => runtime.render(() => run(props));
  render(); assert.equal(requests.length, 1);
  requests[0].resolve(Response.json({ subject: "rendered A", body_text: "rendered A text" })); await settle();
  view.subject = "professional edit"; view.text = "custom text";
  props.selected = { key: "a", subject: "refreshed A", body: "refreshed body A" };
  render(); render();
  assert.equal(requests.length, 1);
  assert.equal(view.subject, "professional edit"); assert.equal(view.text, "custom text");
  props.selected = { key: "b", subject: "B", body: "body B" }; render();
  props.selected = { key: "c", subject: "C", body: "body C" }; render();
  assert.equal(requests.length, 3);
  requests[1].resolve(Response.json({ subject: "obsolete B", body_text: "obsolete B" })); await settle();
  assert.equal(view.subject, "C");
  props.restoredWorkflowKeyRef.current = "restored-draft";
  view.subject = "saved subject"; view.text = "saved text";
  requests[2].resolve(Response.json({ subject: "late C", body_text: "late C" })); await settle();
  props.selected = { key: "d", subject: "D", body: "body D" }; render();
  assert.equal(requests.length, 3);
  assert.equal(view.subject, "saved subject"); assert.equal(view.text, "saved text");
  props.restoredWorkflowKeyRef.current = "";
  props.selected = { key: "e", subject: "E", body: "body E" }; render(); runtime.unmount();
  requests[3].resolve(Response.json({ subject: "after unmount" })); await settle();
  assert.equal(view.subject, "E");
});

for (const area of ["fideliser", "propulser"]) test(`${area}: confirmation actions use the current language without resetting the workflow`, async () => {
  const names = new Set(["requestCloseActiveModal", "switchActiveTheme"]);
  const source = extract(`${area}/page.tsx`, (node, file) => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.has(d.name.getText(file))));
  const runtime = hooks(), confirmations: Array<{ message: string }> = [];
  let closes = 0;
  const props = {
    i18nT: (key: string) => `fr:${key}`, active: "inform", activeHasUnsavedWork: true, activeThemeIndex: 0,
    closeActiveModal: () => { closes++; }, setWorkflowDraftMessage() {}, workflowDraftActionRef: { current: null }, setActive() {},
  };
  const code = ts.transpileModule(`return function render({${Object.keys(props).join(",")}}) { ${source} return {requestCloseActiveModal, switchActiveTheme}; }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = new Function("useCallback", "confirmInrcy", "FIDELISER_THEMES", "PROPULSER_THEMES", code)(runtime.useCallback, async (options: { message: string }) => { confirmations.push(options); return false; }, ["inform", "thanks"], ["valorize", "reviews"]);
  runtime.render(() => run(props));
  props.i18nT = key => `en:${key}`;
  const actions = runtime.render(() => run(props)) as { requestCloseActiveModal: () => Promise<void>; switchActiveTheme: (direction: number) => Promise<void> };
  await actions.requestCloseActiveModal(); await actions.switchActiveTheme(1);
  assert.equal(confirmations.length, 2); assert.ok(confirmations.every(item => item.message.startsWith("en:")));
  assert.equal(closes, 0, "declining confirmation keeps the editor open");
});
