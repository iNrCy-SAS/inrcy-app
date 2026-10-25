import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Element = { type: string; props: Record<string, unknown> };
type Props = { field: "title" | "tags"; value: string; disabled?: boolean; onSave: (field: string, value: string) => Promise<void>; onEditingChange: (editing: boolean) => void };
const code = ts.transpileModule(readFileSync(new URL("../../app/dashboard/mediatheque/MediaMetadataField.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

function editorHarness(field: "title" | "tags" = "title") {
  const slots: unknown[] = []; const cleanups: Array<() => void> = []; const effects: Array<() => void> = [];
  const saved: Array<[string, string]> = []; const editing: boolean[] = [];
  let cursor = 0; let tree: Element; let unmounted = false; let lateUpdates = 0;
  let save: (field: string, value: string) => Promise<void> = async () => {};
  let props: Props = { field, value: "Valeur initiale", onSave: async (field, value) => { saved.push([field, value]); await save(field, value); }, onEditingChange: (value) => editing.push(value) };
  const react = {
    useId: () => "metadata-test",
    useRef(initial: unknown) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index]; },
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (update: unknown) => { if (unmounted) lateUpdates++; slots[index] = typeof update === "function" ? (update as (value: unknown) => unknown)(slots[index]) : update; }]; },
    useEffect(effect: () => (() => void) | void, deps: unknown[]) {
      const index = cursor++; const previous = slots[index] as unknown[] | undefined;
      if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { slots[index] = deps; effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); }
    },
  };
  const moduleRecord = { exports: {} as { default: (props: Props) => Element } };
  new Function("module", "exports", "require", code)(moduleRecord, moduleRecord.exports, (name: string) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }), jsxs: (type: string, props: Record<string, unknown>) => ({ type, props }) };
    if (name === "next-intl") return { useTranslations: () => (key: string) => key };
    if (name === "@/lib/userFacingErrors") return { getClientUserFacingErrorMessage: () => "library_edit_failed" };
    if (name.endsWith(".css")) return { default: {} };
    throw new Error(name);
  });
  function render() { cursor = 0; tree = moduleRecord.exports.default(props); effects.splice(0).forEach((effect) => effect()); }
  function elements(type: string) { const found: Element[] = []; function visit(value: unknown) { if (Array.isArray(value)) return value.forEach(visit); if (!value || typeof value !== "object" || !("props" in value)) return; const node = value as Element; if (node.type === type) found.push(node); visit(node.props.children); } visit(tree); return found; }
  const tick = async () => { await new Promise((resolve) => setImmediate(resolve)); render(); };
  render();
  return { render, elements, saved, editing, tick,
    begin() { (elements("button")[0].props.onClick as () => void)(); render(); },
    type(value: string) { (elements("input")[0].props.onChange as (event: unknown) => void)({ target: { value } }); render(); },
    clickSave() { (elements("button")[0].props.onClick as () => void)(); },
    cancel() { (elements("button")[1].props.onClick as () => void)(); render(); },
    key(key: string) { (elements("input")[0].props.onKeyDown as (event: unknown) => void)({ key, nativeEvent: { isComposing: false }, preventDefault() {}, stopPropagation() {} }); render(); },
    update(value: string) { props = { ...props, value }; render(); },
    setSave(callback: typeof save) { save = callback; },
    unmount() { unmounted = true; cleanups.forEach((cleanup) => cleanup()); },
    lateUpdates() { return lateUpdates; },
  };
}

test("an active draft survives refreshed server props, then saves explicitly", async () => {
  const h = editorHarness(); h.begin(); h.type("Mon brouillon"); h.update("Titre serveur actualisé");
  assert.equal(h.elements("input")[0].props.value, "Mon brouillon");
  h.key("Enter"); await h.tick();
  assert.deepEqual(h.saved, [["title", "Mon brouillon"]]); assert.equal(h.elements("input").length, 0);
  assert.deepEqual(h.editing, [true, false]);
  h.update("Titre validé"); h.begin(); assert.equal(h.elements("input")[0].props.value, "Titre validé");
});

test("failed saves retain the editable draft and allow retry", async () => {
  const h = editorHarness("tags"); h.setSave(async () => { throw new Error("offline"); });
  h.begin(); h.type("photo, équipe"); h.clickSave(); await h.tick();
  assert.equal(h.elements("input")[0].props.value, "photo, équipe");
  assert.equal(h.elements("input")[0].props["aria-invalid"], true);
  assert.ok(h.elements("small").some((item) => item.props.role === "alert"));
  h.setSave(async () => {}); h.clickSave(); await h.tick();
  assert.equal(h.elements("input").length, 0); assert.equal(h.saved.length, 2);
});

test("Escape and Cancel discard only the draft without issuing a request", () => {
  const h = editorHarness(); h.begin(); h.type("Abandonné"); h.key("Escape");
  assert.equal(h.elements("input").length, 0); assert.deepEqual(h.saved, []);
  h.begin(); assert.equal(h.elements("input")[0].props.value, "Valeur initiale");
  h.cancel(); assert.deepEqual(h.saved, []);
});

test("double save is blocked synchronously and late completions after unmount do not update state", async () => {
  const h = editorHarness(); let complete!: () => void;
  h.setSave(() => new Promise<void>((resolve) => { complete = resolve; }));
  h.begin(); h.type("Une seule requête"); h.clickSave(); h.clickSave(); h.render();
  assert.equal(h.saved.length, 1); assert.equal(h.elements("input")[0].props.disabled, true);
  h.unmount(); complete(); await h.tick();
  assert.equal(h.lateUpdates(), 0);
});
