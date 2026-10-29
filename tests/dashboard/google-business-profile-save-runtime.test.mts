import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import ts from "typescript";
import * as profile from "../../lib/googleBusinessProfile.ts";
import type { InrcyConfirmOptions } from "../../lib/inrcyDialog.ts";

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Element = React.ReactElement<Props>;
const copy = JSON.parse(readFileSync("messages/fr-FR/dashboard.json", "utf8")).googleBusinessProfile;
const translate = (key: string, values: Record<string, string> = {}) => {
  const value = key.split(".").reduce((entry, part) => entry?.[part], copy) || key;
  return String(value).replace(/\{(\w+)\}/g, (_, name: string) => values[name] || "");
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree: React.ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return React.isValidElement<Props>(tree) ? [tree, ...nodes(tree.props.children as React.ReactNode)] : [];
}
const original: profile.GoogleBusinessProfile = {
  title: "Chosen business", primaryPhone: "", websiteUri: "https://chosen.example", description: "Original description",
  storefrontAddress: null, regularHours: { periods: [] }, specialHours: { specialHourPeriods: [] },
};

async function fixture() {
  const slots: unknown[] = [], dependencies: (unknown[] | undefined)[] = [], cleanups: (() => void)[] = [];
  const effects: (() => void)[] = [];
  const confirmations: InrcyConfirmOptions[] = [];
  const writes: Record<string, unknown>[] = [];
  let cursor = 0, activeAccount = "account";
  let resolveConfirmation!: (confirmed: boolean) => void;
  let resolveWrite!: (response: Response) => void;
  const hooks = {
    ...React,
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useId: () => "profile-editor",
    useMemo: (read: () => unknown) => read(),
    useEffect(effect: () => (() => void) | void, deps?: unknown[]) {
      const index = cursor++;
      if (!dependencies[index] || !deps || deps.some((value, position) => value !== dependencies[index]![position])) {
        dependencies[index] = deps;
        effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
      }
    },
  };
  const modules: Record<string, unknown> = {
    react: hooks, "react/jsx-runtime": require("react/jsx-runtime"),
    "next-intl": { useTranslations: () => translate },
    "@/lib/googleBusinessProfile": profile,
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => activeAccount },
    "@/lib/inrcyDialog": { confirmInrcy: (options: InrcyConfirmOptions) => { confirmations.push(options); return new Promise<boolean>(resolve => { resolveConfirmation = resolve; }); } },
    "./GoogleBusinessWeeklyHours": { __esModule: true, default: "weekly-hours" },
    "./GoogleBusinessProfileEditor.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const code = ts.transpileModule(readFileSync("app/dashboard/_components/GoogleBusinessProfileEditor.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { default?: (props: unknown) => React.ReactNode } = {};
  const localFetch = async (_url: string, init: RequestInit) => {
    if (init.method === "PATCH") {
      writes.push(JSON.parse(String(init.body)));
      return new Promise<Response>(resolve => { resolveWrite = resolve; });
    }
    return Response.json({ ok: true, accountId: "account", accountName: "accounts/chosen", locationName: "locations/chosen", version: "version-1", profile: original });
  };
  new Function("require", "exports", "fetch", code)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, exports, localFetch);
  const onDirtyChange = () => undefined;
  const render = () => { cursor = 0; const result = nodes(exports.default!({ locationName: "locations/chosen", onDirtyChange })); effects.splice(0).forEach(effect => effect()); return result; };
  render(); await tick();
  const form = () => render().find(node => node.type === "form")!;
  const save = () => render().find(node => node.type === "button" && node.props.type === "submit")!;
  const edit = (value = "Updated description") => {
    const field = render().find(node => node.type === "textarea")!;
    (field.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  return {
    render, save, form, edit, confirmations, writes,
    submit: () => (form().props.onSubmit as (event: unknown) => void)({ preventDefault() {} }),
    choose: async (confirmed: boolean) => { resolveConfirmation(confirmed); await tick(); },
    respond: async (ok: boolean) => { resolveWrite(Response.json(ok ? { ok: true, version: "version-2", profile: { ...original, description: "Updated description" } } : { ok: false, user_message: "Google refused the change" }, { status: ok ? 200 : 502 })); await tick(); },
    switchAccount: () => { activeAccount = "different-account"; },
    unmount: () => cleanups.forEach(cleanup => cleanup()),
  };
}

test("Save is unavailable without changes and opens one confirmation containing only the changed field and selected business", async () => {
  const h = await fixture();
  assert.equal(h.save().props.children, "Enregistrer");
  assert.equal(h.save().props.disabled, true);
  h.submit(); assert.equal(h.confirmations.length, 0);
  h.edit(); assert.equal(h.save().props.disabled, false);
  h.submit(); h.submit();
  assert.equal(h.confirmations.length, 1);
  assert.match(h.confirmations[0].message, /Chosen business/);
  assert.deepEqual(h.confirmations[0].steps, ["Description : Updated description"]);
  assert.equal(h.confirmations[0].confirmLabel, "Confirmer");
  assert.equal(h.confirmations[0].cancelLabel, "Annuler");
  assert.equal(h.writes.length, 0);
  await h.choose(false);
  assert.equal(h.writes.length, 0);
  assert.equal(h.save().props.disabled, false, "Cancelling keeps the unsaved draft");
});

test("Confirm sends one scoped update and reports success only after Google confirms it", async () => {
  const h = await fixture(); h.edit(); h.submit(); await h.choose(true);
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.writes[0], { accountId: "account", accountName: "accounts/chosen", locationName: "locations/chosen", version: "version-1", profile: { ...original, description: "Updated description" } });
  assert.equal(h.form().props["aria-busy"], true);
  assert.equal(h.save().props.disabled, true);
  assert.equal(h.render().some(node => node.props.role === "status"), false);
  h.submit(); assert.equal(h.writes.length, 1);
  await h.respond(true);
  assert.equal(h.form().props["aria-busy"], false);
  assert.equal(h.save().props.disabled, true);
  assert.ok(h.render().some(node => node.props.role === "status" && String(node.props.children).includes("enregistrées auprès de Google")));
});

test("a failed save retains the draft and shows the error without claiming success", async () => {
  const h = await fixture(); h.edit(); h.submit(); await h.choose(true); await h.respond(false);
  assert.equal(h.save().props.disabled, false);
  assert.ok(h.render().some(node => node.props.role === "alert" && node.props.children === "Google refused the change"));
  assert.equal(h.render().some(node => node.props.role === "status"), false);
});

test("changing accounts or closing the editor while confirmation is open prevents any write", async () => {
  for (const exit of ["account", "unmount"]) {
    const h = await fixture(); h.edit(); h.submit();
    if (exit === "account") h.switchAccount(); else h.unmount();
    await h.choose(true);
    assert.equal(h.writes.length, 0, exit);
  }
});
