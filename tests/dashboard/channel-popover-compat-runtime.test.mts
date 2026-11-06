import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import * as popovers from "../../lib/browserPopover.ts";

class FakeDocument extends EventTarget {
  defaultView = { Event };
  activeElement: FakeButton | FakeDialog | null = null;
  stack: FakeDialog[] = [];
}
class FakeButton {
  disabled = false; isConnected = true; focusCount = 0;
  ownerDocument: FakeDocument; private attrs: Record<string, string>;
  constructor(ownerDocument: FakeDocument, attrs: Record<string, string>) { this.ownerDocument = ownerDocument; this.attrs = attrs; }
  getAttribute(name: string) { return this.attrs[name] || null; }
  closest() { return this; }
  focus() { this.ownerDocument.activeElement = this; this.focusCount++; }
}
class FakeDialog extends EventTarget {
  open = false; isConnected = true; modalShows = 0; closes = 0;
  ownerDocument: FakeDocument; id: string;
  constructor(ownerDocument: FakeDocument, id: string) { super(); this.ownerDocument = ownerDocument; this.id = id; }
  matches() { throw new SyntaxError("':popover-open' is not a valid selector in Firefox 115"); }
  showModal() { assert.equal(this.open, false); this.open = true; this.modalShows++; this.ownerDocument.stack.push(this); this.ownerDocument.activeElement = this; }
  close() { this.open = false; this.closes++; this.ownerDocument.stack = this.ownerDocument.stack.filter(dialog => dialog !== this); this.dispatchEvent(new Event("close")); }
  getBoundingClientRect() { return { left: 20, right: 220, top: 20, bottom: 180 }; }
  closest() { return null; }
}
type Adapted = FakeDialog & { showPopover(): void; hidePopover(): void; togglePopover(force?: boolean | { force?: boolean }): boolean };
const asDialog = (element: FakeDialog) => element as unknown as HTMLDialogElement;
function click(document: FakeDocument, target: FakeButton | FakeDialog, coordinates = { clientX: 50, clientY: 50 }) {
  const event = new Event("click", { cancelable: true });
  Object.defineProperties(event, { target: { value: target }, clientX: { value: coordinates.clientX }, clientY: { value: coordinates.clientY } });
  if (target instanceof FakeDialog) target.dispatchEvent(event); else document.dispatchEvent(event);
  return event;
}

const source = readFileSync(new URL("../../app/dashboard/_components/CompatiblePopover.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { fileName: "CompatiblePopover.tsx", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function component(react: unknown, jsx: unknown) {
  const record = { exports: {} as { default: unknown } };
  new Function("module", "exports", "require", compiled)(record, record.exports, (id: string) => {
    if (id === "react") return react;
    if (id === "react/jsx-runtime") return jsx;
    if (id === "@/lib/browserPopover") return popovers;
    assert.fail(`Unexpected component dependency ${id}`);
  });
  return record.exports.default;
}
function mount(document: FakeDocument, id: string) {
  const dialog = new FakeDialog(document, id) as Adapted;
  const forwarded = { current: null as HTMLDialogElement | null };
  const cleanup: Array<() => void> = [];
  const effects: Array<() => void | (() => void)> = [];
  const render = component({
    forwardRef: (render: (props: Record<string, unknown>, ref: typeof forwarded) => unknown) => (props: Record<string, unknown>) => render(props, forwarded),
    useRef: () => ({ current: dialog }),
    useImperativeHandle: (ref: typeof forwarded, value: () => HTMLDialogElement) => { ref.current = value(); },
    useLayoutEffect: (effect: () => void | (() => void)) => effects.push(effect),
  }, { jsx: (type: string, props: Record<string, unknown>) => ({ type, props }) }) as (props: Record<string, unknown>) => { type: string; props: Record<string, unknown> };
  const transitions: string[] = [];
  const onToggle = (event: Event & { oldState: string; newState: string }) => transitions.push(`${event.type}:${event.oldState}>${event.newState}`);
  const tree = render({ id, className: "typesMenu", role: "group", "aria-label": "Connexion Google", onBeforeToggle: onToggle, onToggle });
  for (const effect of effects) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
  dialog.addEventListener("beforetoggle", tree.props.onBeforeToggle as EventListener);
  dialog.addEventListener("toggle", tree.props.onToggle as EventListener);
  return { dialog, tree, forwarded, transitions, unmount() { cleanup.forEach(dispose => dispose()); } };
}

test("Firefox 115 mounts the actual compatible dialog closed, opens its target and reports React/assistant toggle state", () => {
  const document = new FakeDocument();
  const h = mount(document, "google-menu");
  assert.equal(h.tree.type, "dialog"); assert.equal(h.tree.props.popover, "auto");
  assert.equal(h.tree.props["aria-label"], "Connexion Google"); assert.equal(h.forwarded.current, asDialog(h.dialog));
  assert.equal(popovers.supportsNativePopover(asDialog(h.dialog)), false);
  assert.equal(popovers.isBrowserPopoverOpen(asDialog(h.dialog)), false);
  assert.equal(h.dialog.open, false);
  const trigger = new FakeButton(document, { popovertarget: h.dialog.id }); trigger.focus();
  const event = click(document, trigger);
  assert.equal(event.defaultPrevented, true);
  assert.equal(h.dialog.modalShows, 1); assert.equal(popovers.isBrowserPopoverOpen(asDialog(h.dialog)), true);
  assert.deepEqual(h.transitions, ["beforetoggle:closed>open", "toggle:closed>open"]);
  click(document, new FakeButton(document, { popovertarget: h.dialog.id, popovertargetaction: "hide" }));
  assert.equal(h.dialog.open, false); assert.equal(document.activeElement, trigger);
  assert.deepEqual(h.transitions.slice(2), ["beforetoggle:open>closed", "toggle:open>closed"]);
  h.unmount();
});

test("Firefox fallback remains above an existing modal, dismisses only itself and restores its trigger focus", () => {
  const document = new FakeDocument(); const parent = new FakeDialog(document, "settings-modal"); parent.showModal();
  const h = mount(document, "child-menu"); const trigger = new FakeButton(document, { popovertarget: h.dialog.id }); trigger.focus();
  h.dialog.showPopover();
  assert.deepEqual(document.stack, [parent, h.dialog]);
  const cancel = new Event("cancel", { cancelable: true }); h.dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true); assert.equal(parent.open, true); assert.equal(h.dialog.open, false);
  assert.deepEqual(document.stack, [parent]); assert.equal(document.activeElement, trigger);
  h.dialog.showPopover(); click(document, h.dialog, { clientX: 50, clientY: 50 }); assert.equal(h.dialog.open, true, "inside padding does not dismiss");
  click(document, h.dialog, { clientX: 0, clientY: 0 }); assert.equal(h.dialog.open, false, "backdrop dismisses the child");
  assert.equal(parent.open, true); h.unmount();
});

test("fallback force toggle, cancellation, disabled triggers and unmount leave no instance patches or document handlers", () => {
  const document = new FakeDocument(); const h = mount(document, "popover-cleanup");
  const disabled = new FakeButton(document, { popovertarget: h.dialog.id }); disabled.disabled = true;
  click(document, disabled); assert.equal(h.dialog.open, false);
  const preventOpen = (event: Event) => event.preventDefault(); h.dialog.addEventListener("beforetoggle", preventOpen);
  h.dialog.showPopover(); assert.equal(h.dialog.open, false); assert.equal(h.dialog.modalShows, 0);
  h.dialog.removeEventListener("beforetoggle", preventOpen);
  assert.equal(h.dialog.togglePopover(true), true); assert.equal(h.dialog.togglePopover({ force: true }), true);
  assert.equal(h.dialog.modalShows, 1); assert.equal(h.dialog.togglePopover(false), false);
  h.dialog.showPopover(); h.unmount();
  assert.equal(h.dialog.open, false); assert.equal(Object.hasOwn(h.dialog, "showPopover"), false);
  assert.equal(Object.hasOwn(h.dialog, "hidePopover"), false); assert.equal(Object.hasOwn(h.dialog, "togglePopover"), false);
  click(document, new FakeButton(document, { popovertarget: h.dialog.id })); assert.equal(h.dialog.open, false);
});

test("the actual React cancel wrapper stops a nested popover Escape from closing its parent dialog", () => {
  const document = new FakeDocument(); const parent = new FakeDialog(document, "channel-parameters"); parent.showModal();
  const h = mount(document, "parameters-popover"); h.dialog.showPopover();
  let prevented = false, stopped = false;
  (h.tree.props.onCancel as (event: unknown) => void)({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  if (!stopped) parent.close(); // React's parent onCancel must not receive it.
  assert.equal(prevented, true); assert.equal(stopped, true); assert.equal(h.dialog.open, false); assert.equal(parent.open, true);
  h.unmount();
});

test("opening another automatic fallback closes the first and cleanup does not steal focus from another surface", () => {
  const document = new FakeDocument(); const first = mount(document, "first-menu"); const second = mount(document, "second-menu");
  const triggerOne = new FakeButton(document, { popovertarget: first.dialog.id }); triggerOne.focus(); first.dialog.showPopover();
  const triggerTwo = new FakeButton(document, { popovertarget: second.dialog.id }); triggerTwo.focus(); second.dialog.showPopover();
  assert.equal(first.dialog.open, false); assert.equal(second.dialog.open, true); assert.deepEqual(document.stack, [second.dialog]);
  second.dialog.hidePopover(); assert.equal(document.activeElement, triggerTwo);
  second.dialog.showPopover(); const otherSurface = new FakeButton(document, {}); otherSurface.focus(); second.unmount();
  assert.equal(second.dialog.open, false); assert.equal(document.activeElement, otherSurface);
  first.unmount();
});

test("external dialog close emits one closing pair and repeat disposal restores instance descriptors", () => {
  const document = new FakeDocument(); const h = mount(document, "external-close");
  const additionalRelease = popovers.installBrowserPopoverFallback(asDialog(h.dialog));
  h.dialog.showPopover(); h.dialog.close();
  assert.deepEqual(h.transitions, ["beforetoggle:closed>open", "toggle:closed>open", "beforetoggle:open>closed", "toggle:open>closed"]);
  h.unmount(); assert.equal(typeof h.dialog.showPopover, "function", "the second mounted owner keeps its adapter");
  additionalRelease(); assert.equal(Object.hasOwn(h.dialog, "showPopover"), false);
});

test("native Popover browsers keep their native methods, events and selector-based open state", () => {
  const document = new FakeDocument(); const native = new FakeDialog(document, "native-menu") as Adapted;
  let shown = false;
  Object.assign(native, { showPopover() { shown = true; }, hidePopover() { shown = false; }, matches() { return shown; } });
  const originalShow = native.showPopover;
  assert.equal(popovers.supportsNativePopover(asDialog(native)), true);
  const cleanup = popovers.installBrowserPopoverFallback(asDialog(native));
  assert.equal(native.showPopover, originalShow); native.showPopover();
  assert.equal(native.open, false); assert.equal(popovers.isBrowserPopoverOpen(asDialog(native)), true);
  native.hidePopover(); assert.equal(popovers.isBrowserPopoverOpen(asDialog(native)), false);
  cleanup(); assert.equal(native.showPopover, originalShow); assert.equal(native.modalShows, 0);
});

test("the real React server renderer always emits one closed dialog without browser capability-dependent markup", () => {
  const require = createRequire(import.meta.url);
  const react = require("react"); const jsx = require("react/jsx-runtime");
  const CompatiblePopover = component(react, jsx);
  const { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(react.createElement(CompatiblePopover, { id: "ssr-menu", role: "group", "aria-label": "Canaux", children: "Options" }));
  assert.match(html, /^<dialog\b/); assert.match(html, /popover="auto"/); assert.doesNotMatch(html, /\bopen=/);
  assert.match(html, /aria-label="Canaux"/); assert.match(html, /Options<\/dialog>$/);
});
