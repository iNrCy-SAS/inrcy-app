import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const help = read("app/dashboard/_components/HelpModal.tsx");
const dashboardHelp = read("app/dashboard/_components/DashboardHelpModals.tsx");
const channels = read("app/dashboard/_components/DashboardChannelsModal.tsx");
const css = read("app/dashboard/_components/HelpModalNativeLayer.module.css");
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(help, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Effect = () => undefined | (() => void);
type TestElement = {
  type: string;
  props: {
    role?: string;
    style?: { bottom?: string | number };
    onKeyDown?: (event: { key: string; stopPropagation: () => void }) => void;
    onCancel?: (event: { preventDefault: () => void; stopPropagation: () => void }) => void;
  };
};

function renderHelp(nativeLayer: boolean, initialOverflow: string) {
  const effects: Effect[] = [];
  const refs: Array<{ current: unknown }> = [];
  const listeners = new Map<string, (event: { key: string }) => void>();
  let closeRequests = 0;
  class Element {
    isConnected = true;
    focusCalls: Array<{ preventScroll: boolean }> = [];
    focus(options: { preventScroll: boolean }) { this.focusCalls.push(options); }
  }
  const opener = new Element();
  const closeButton = new Element();
  const document = { activeElement: opener, body: { style: { overflow: initialOverflow } } };
  const dialog = {
    open: false,
    showCalls: 0,
    closeCalls: 0,
    showModal() { this.open = true; this.showCalls += 1; },
    close() { this.open = false; this.closeCalls += 1; },
  };
  const window = {
    addEventListener(name: string, listener: (event: { key: string }) => void) { listeners.set(name, listener); },
    removeEventListener(name: string) { listeners.delete(name); },
  };
  const mockRequire = (name: string) => {
    if (name === "react") return {
      useEffect: (effect: Effect) => effects.push(effect),
      useRef: (value: unknown) => { const ref = { current: value }; refs.push(ref); return ref; },
    };
    if (name === "next-intl") return { useTranslations: () => (key: string) => key };
    if (name.endsWith(".module.css")) return { default: { nativeLayer: "nativeLayer" } };
    return require(name);
  };
  const testModule = { exports: {} as { default?: (props: unknown) => TestElement } };
  new Function("require", "module", "exports", "document", "window", "HTMLElement", compiled)(mockRequire, testModule, testModule.exports, document, window, Element);
  const view = testModule.exports.default!({ open: true, nativeLayer, title: "Canaux", children: "Contenu inchangé", onClose: () => { closeRequests += 1; } });
  refs[0].current = dialog;
  refs[1].current = closeButton;
  const cleanups = effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
  return { view, document, dialog, opener, closeButton, listeners, getCloseRequests: () => closeRequests, cleanup: () => cleanups.forEach((cleanup) => cleanup()) };
}

test("only the three channel help dialogs opt into the native layer, preserving other help screens", () => {
  const entries = [...dashboardHelp.matchAll(/<HelpModal\b([\s\S]*?)>/g)];
  assert.equal(entries.length, 7);
  const nativeEntries = entries.filter((entry) => /\bnativeLayer\b/.test(entry[1]));
  assert.deepEqual(nativeEntries.map((entry) => entry[1].match(/open=\{(\w+)\}/)?.[1]), ["helpCanauxOpen", "helpSiteInrcyOpen", "helpSiteWebOpen"]);
  assert.match(help, /nativeLayer = false/);
  assert.match(help, /if \(!nativeLayer\) return content/);
  assert.match(dashboardHelp, /premiumLocked = standardMode && channel\.premiumOnly/);
  assert.match(dashboardHelp, /siteNotSubscribed = Boolean\(channel\.requiresSiteSubscription && !siteInrcySubscribed\)/);
});

test("native help opens above the channel dialog and returns focus without releasing its scroll lock", () => {
  const harness = renderHelp(true, "hidden");
  assert.equal(harness.view.type, "dialog");
  assert.equal(harness.dialog.showCalls, 1);
  assert.equal(harness.dialog.open, true);
  assert.equal(harness.listeners.size, 0, "native help must not install a competing window keydown listener");
  assert.deepEqual(harness.closeButton.focusCalls, [{ preventScroll: true }]);
  harness.cleanup();
  assert.equal(harness.dialog.open, false);
  assert.equal(harness.document.body.style.overflow, "hidden", "the underlying channel modal keeps ownership of its scroll lock");
  assert.deepEqual(harness.opener.focusCalls, [{ preventScroll: true }]);
});

test("native help restores only its own scroll lock and does not resurrect an unmounted parent's lock", () => {
  const standalone = renderHelp(true, "auto");
  assert.equal(standalone.document.body.style.overflow, "hidden");
  standalone.cleanup();
  assert.equal(standalone.document.body.style.overflow, "auto");

  const parentUnmounted = renderHelp(true, "hidden");
  parentUnmounted.document.body.style.overflow = "";
  parentUnmounted.opener.isConnected = false;
  parentUnmounted.cleanup();
  assert.equal(parentUnmounted.document.body.style.overflow, "");
  assert.deepEqual(parentUnmounted.opener.focusCalls, []);
});

test("Escape is stopped at native help and requests only its own close once", () => {
  const harness = renderHelp(true, "hidden");
  let stopped = 0;
  let prevented = 0;
  harness.view.props.onKeyDown!({ key: "Escape", stopPropagation: () => { stopped += 1; } });
  assert.equal(stopped, 1);
  assert.equal(harness.getCloseRequests(), 0, "keydown must let native cancel own the closing action");
  harness.view.props.onCancel!({ preventDefault: () => { prevented += 1; }, stopPropagation: () => { stopped += 1; } });
  assert.equal(prevented, 1);
  assert.equal(stopped, 2);
  assert.equal(harness.getCloseRequests(), 1);
  assert.equal(harness.document.body.style.overflow, "hidden");
  harness.cleanup();
});

test("default help preserves the legacy div, mobile dock spacing and Escape listener", () => {
  const harness = renderHelp(false, "auto");
  assert.equal(harness.view.type, "div");
  assert.equal(harness.view.props.role, "dialog");
  assert.match(String(harness.view.props.style?.bottom), /inrcy-mobile-bottom-nav-total-height/);
  assert.equal(harness.dialog.showCalls, 0);
  assert.equal(harness.document.body.style.overflow, "auto");
  assert.equal(harness.listeners.size, 1);
  harness.listeners.get("keydown")!({ key: "Escape" });
  assert.equal(harness.getCloseRequests(), 1);
  harness.cleanup();
  assert.equal(harness.listeners.size, 0);
  assert.deepEqual(harness.opener.focusCalls, []);
});

test("channel help callbacks leave the bubble dialog open and the native surface is viewport-safe", () => {
  assert.match(channels, /data-dashboard-channels-dialog="true"/);
  assert.match(channels, /aria-label="Aide sur les canaux" onClick=\{onOpenHelp\}/);
  assert.match(channels, /onClick=\{\(\) => \(selected\.helpKind === "site_inrcy" \? selected\.onHelpSiteInrcy : selected\.onHelpSiteWeb\)\?\.\(\)\}/);
  assert.doesNotMatch(channels, /closeDialog\(\);\s*(?:onOpenHelp|\(selected\.helpKind)/);
  assert.match(css, /\.nativeLayer\s*\{[^}]*width: 100vw;[^}]*height: 100dvh;[^}]*overflow: hidden/);
  assert.match(css, /\.nativeLayer::backdrop\s*\{ background: transparent/);
  assert.match(help, /overflowY: "auto"/);
  assert.match(help, /role=\{nativeLayer \? undefined : "dialog"\}/);
});
