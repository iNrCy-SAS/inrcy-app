import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as React from "react";
import ts from "typescript";
import * as profile from "../../lib/googleBusinessProfile.ts";
import * as nativeInterfaces from "../../lib/inrAssistantLocalInterface.ts";

const require = createRequire(import.meta.url);
// The runtime harness executes real TSX handlers with minimal React state slots.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
const copy = JSON.parse(readFileSync("messages/fr-FR/dashboard.json", "utf8")).googleBusinessProfile;
function nodes(tree: React.ReactNode): Array<React.ReactElement<Record<string, RuntimeValue>>> {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return React.isValidElement<Record<string, RuntimeValue>>(tree) ? [tree, ...nodes(tree.props.children)] : [];
}
function fixture(initial: profile.GoogleBusinessPeriod[], native = false) {
  const slots: RuntimeValue[] = [];
  const effects: Array<() => void | (() => void)> = [], cleanups: Array<() => void> = [];
  let cursor = 0;
  let value = initial;
  const hooks = { ...React, useId() { const index = cursor++; return slots[index] ??= `weekly-hours-${index}`; }, useLayoutEffect(effect: () => void | (() => void)) { effects.push(effect); }, useEffect() {}, useRef(input: RuntimeValue) { const index = cursor++; return slots[index] ??= { current: input }; }, useState(input: RuntimeValue) { const index = cursor++; if (!(index in slots)) slots[index] = input; return [slots[index], (next: RuntimeValue) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; } };
  const modules: Record<string, RuntimeValue> = {
    react: hooks, "react-dom": { createPortal: (children: React.ReactNode) => children }, "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => "/dashboard" },
    "../_components/DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ actorUserId: native ? "actor" : "", activeAccountId: native ? "account" : "" }) },
    "@/lib/inrAssistantLocalInterface": nativeInterfaces,
    "next-intl": { useTranslations: () => (key: string) => key.split(".").reduce((source, part) => source?.[part], copy) || key },
    "@/lib/googleBusinessProfile": profile,
    "./GoogleBusinessWeeklyHours.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  };
  const nativeHook = { exports: {} };
  const nativeHookCode = ts.transpileModule(readFileSync("app/dashboard/_hooks/useInrAssistantLocalInterface.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", nativeHookCode)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, nativeHook, nativeHook.exports);
  modules["../_hooks/useInrAssistantLocalInterface"] = nativeHook.exports;
  const code = ts.transpileModule(readFileSync("app/dashboard/_components/GoogleBusinessWeeklyHours.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { default?: (props: unknown) => React.ReactNode } = {};
  new Function("require", "exports", code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports);
  const host = {};
  const render = () => { cursor = 0; const result = nodes(exports.default!({ periods: value, onChange: (next: profile.GoogleBusinessPeriod[]) => { value = next; } })); for (const node of result) if (node.props["data-google-weekly-hours"] && node.props.ref) node.props.ref.current = { closest: () => host }; effects.splice(0).forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); return result; };
  const control = (label: string) => render().find(node => node.props["aria-label"] === label)!;
  return { render, control, value: () => value,
    runNative: (operation: nativeInterfaces.InrAssistantLocalOperation, value: string | null = null, revision?: string) => { render(); const scope = { accountId: "account", actorUserId: "actor", pathname: "/dashboard" }; const hint = nativeInterfaces.getInrAssistantLocalInterfaceHints(scope)?.find(row => row.id === "google_weekly_hours"); assert.ok(hint); return nativeInterfaces.runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id: "google_weekly_hours" }, revision: revision || hint.revision, operation, value }, scope, () => true); },
    unmount: () => cleanups.forEach(cleanup => cleanup()),
  };
}
const periods: profile.GoogleBusinessPeriod[] = [
  { openDay: "MONDAY", openTime: { hours: 9 }, closeDay: "MONDAY", closeTime: { hours: 12 } },
  { openDay: "MONDAY", openTime: { hours: 14 }, closeDay: "MONDAY", closeTime: { hours: 18 } },
  { openDay: "TUESDAY", openTime: { hours: 8 }, closeDay: "TUESDAY", closeTime: { hours: 17 } },
];

test("Basic native Google weekly hours opens the chosen existing day and pages its actual slots without changing any hours", async () => {
  const h = fixture(periods, true), tick = () => new Promise(resolve => setImmediate(resolve)); try {
    h.render(); assert.equal(await h.runNative("open", "SATURDAY"), false); assert.equal(await h.runNative("open", "invented"), false);
    let settled = false; const opening = h.runNative("open", "MONDAY").then(ok => { settled = true; return ok; }); await tick(); assert.equal(settled, false); h.render(); assert.equal(await opening, true); assert.ok(h.render().some(node => node.props.role === "dialog" && node.props["aria-label"] === "Créneaux — Lundi"));
    const next = h.runNative("next"); await tick(); h.render(); assert.equal(await next, true); assert.equal(h.control("Suivant").props.disabled, true);
    const previous = h.runNative("previous"); await tick(); h.render(); assert.equal(await previous, true); assert.equal(h.control("Précédent").props.disabled, true);
    const closing = h.runNative("close"); await tick(); h.render(); assert.equal(await closing, true); assert.equal(h.render().some(node => node.props.role === "dialog"), false); assert.deepEqual(h.value(), periods);
  } finally { h.unmount(); }
});

test("the weekly grid exposes all seven day checkboxes and disables times for closed days", () => {
  const h = fixture(periods);
  const boxes = h.render().filter(node => node.type === "input" && node.props.type === "checkbox");
  assert.equal(boxes.length, 7);
  assert.deepEqual(boxes.map(node => node.props.checked), [true, true, false, false, false, false, false]);
  assert.equal(h.control("Ouverture — Samedi").props.disabled, true);
  assert.equal(h.control("Ouverture — Lundi").props.value, "09:00");
  assert.equal(h.control("Créneaux — Lundi").props.children, "+1", "A split day retains its additional period");
});
test("closing and reopening a day restores its split hours without touching another day", () => {
  const h = fixture(periods);
  h.control("Ouvert — Lundi").props.onChange({ target: { checked: false } });
  assert.deepEqual(h.value(), [periods[2]]);
  h.control("Ouvert — Lundi").props.onChange({ target: { checked: true } });
  assert.deepEqual(h.value(), periods);
  assert.equal(h.value()[2], periods[2]);
});
test("an inline time edit changes only the chosen period, preserving lunch breaks and other days", () => {
  const h = fixture(periods);
  h.control("Ouverture — Lundi").props.onChange({ target: { value: "10:15" } });
  assert.deepEqual(h.value()[0].openTime, { hours: 10, minutes: 15 });
  assert.equal(h.value()[1], periods[1]);
  assert.equal(h.value()[2], periods[2]);
});
test("an overnight closing follows the next day and a newly checked day receives its own period", () => {
  const h = fixture([periods[0], periods[2]]);
  h.control("Fermeture — Lundi").props.onChange({ target: { value: "01:30" } });
  assert.equal(h.value()[0].closeDay, "TUESDAY");
  h.control("Fermeture — Lundi").props.onChange({ target: { value: "12:00" } });
  assert.equal(h.value()[0].closeDay, "MONDAY");
  h.control("Ouvert — Samedi").props.onChange({ target: { checked: true } });
  assert.equal(h.value().filter(row => row.openDay === "SATURDAY").length, 1);
  assert.equal(h.value()[1], periods[2]);
});
