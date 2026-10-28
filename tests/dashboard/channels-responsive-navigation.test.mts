import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

// Run real event closures with isolated hooks; never call live account services.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const require = createRequire(import.meta.url);
const React = require("react");
const ts = require("typescript");
const sourceRoot = process.env.INRCY_CHANNEL_TEST_SOURCE_ROOT || process.cwd();
const source = readFileSync(path.join(sourceRoot, "app/dashboard/_components/DashboardChannelsModal.tsx"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const items = Array.from({ length: 14 }, (_, index) => ({ key: index === 0 ? "gmb" : `channel-${index}`, name: `Canal ${index}`, logoSrc: "/test.svg", bubbleStatus: "connected", bubbleStatusText: "Connecté", onConfigure() {} }));

function fixture() {
  let cursor = 0;
  const slots: Value[] = [];
  let allowed = true;
  let mobile = true;
  let guards = 0;
  const hooks = { ...React,
    useState(initial: Value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (next: Value) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(initial: Value) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId: () => "channels-test", useEffect() {}, useMemo: (fn: Value) => fn(), useCallback: (fn: Value) => fn,
  };
  const localRequire = (name: string): Value => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    if (name === "./dashboard-channel-presentation") return { getChannelTone: () => "connected", getChannelSceneLayout: () => ({ centerSize: 300, centerY: 220, satelliteSize: 120, slots: Array.from({ length: 13 }, () => ({ x: 20, y: 20, size: 100 })) }) };
    if (name === "./DashboardUnsavedNavigationProvider") return { useDashboardUnsavedNavigation: () => ({ requestNavigation: async (fn: () => void) => { guards++; if (allowed) fn(); return allowed; } }) };
    return { __esModule: true, default: "test-component" };
  };
  const loaded = { exports: {} as Value };
  new Function("require", "module", "exports", "window", code)(localRequire, loaded, loaded.exports, { matchMedia: () => ({ matches: mobile }) });
  const nodes = (tree: Value): Value[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement(tree) ? [tree, ...nodes(tree.props.children)] : [];
  const render = () => { cursor = 0; return nodes(loaded.exports.default({ items, onClose() {} })); };
  const current = () => render().find(node => node.props.item)?.props.item.key;
  const swipe = (dx: number, dy = 0, options: { interactive?: boolean; cancel?: boolean; primary?: boolean; pointerId?: number } = {}) => {
    const target = render().find(node => typeof node.props.onPointerDown === "function");
    target.props.onPointerDown({ isPrimary: options.primary ?? true, button: 0, pointerType: "touch", pointerId: 1, clientX: 200, clientY: 100, target: { closest: () => options.interactive ? {} : null }, currentTarget: { setPointerCapture() {} } });
    if (options.cancel) target.props.onPointerCancel();
    target.props.onPointerUp({ pointerId: options.pointerId ?? 1, clientX: 200 + dx, clientY: 100 + dy });
  };
  return { render, current, swipe, setAllowed: (value: boolean) => { allowed = value; }, setMobile: (value: boolean) => { mobile = value; }, guards: () => guards };
}

test("mobile channel chooser includes every channel and marks exactly the selected logo", () => {
  const app = fixture();
  let logos = app.render().filter(node => node.props["data-channel-mini"]);
  assert.equal(logos.length, 14);
  assert.deepEqual(logos.filter(node => node.props["aria-pressed"]).map(node => node.props["data-channel-mini"]), ["gmb"]);
  logos[9].props.onClick();
  assert.equal(app.current(), "channel-9");
  logos = app.render().filter(node => node.props["data-channel-mini"]);
  assert.deepEqual(logos.filter(node => node.props["aria-pressed"]).map(node => node.props["data-channel-mini"]), ["channel-9"]);
});

test("horizontal swipes select next and previous channels and wrap at both ends", () => {
  const app = fixture();
  app.swipe(-90, 8); assert.equal(app.current(), "channel-1");
  app.swipe(90, 8); assert.equal(app.current(), "gmb");
  app.swipe(90); assert.equal(app.current(), "channel-13");
  app.swipe(-90); assert.equal(app.current(), "gmb");
});

test("scrolling, short gestures, controls, cancelled pointers and desktop drags never change a channel", () => {
  const app = fixture();
  for (const [dx, dy] of [[0, 100], [40, 2], [70, 80]]) { app.swipe(dx, dy); assert.equal(app.current(), "gmb"); }
  app.swipe(-100, 0, { interactive: true }); assert.equal(app.current(), "gmb");
  app.swipe(-100, 0, { cancel: true }); assert.equal(app.current(), "gmb");
  app.swipe(-100, 0, { primary: false }); assert.equal(app.current(), "gmb");
  app.swipe(-100, 0, { pointerId: 2 }); assert.equal(app.current(), "gmb");
  app.setMobile(false); app.swipe(-100); assert.equal(app.current(), "gmb");
  assert.equal(app.guards(), 0);
});

test("swipes, arrows and logo taps all preserve the unsaved-change navigation guard", () => {
  const app = fixture(); app.setAllowed(false);
  app.swipe(-90); assert.equal(app.current(), "gmb");
  app.render().find(node => node.props["aria-label"] === "Canal suivant").props.onClick(); assert.equal(app.current(), "gmb");
  app.render().find(node => node.props["data-channel-mini"] === "channel-8").props.onClick(); assert.equal(app.current(), "gmb");
  assert.equal(app.guards(), 3);
  app.setAllowed(true); app.swipe(-90); assert.equal(app.current(), "channel-1");
});
