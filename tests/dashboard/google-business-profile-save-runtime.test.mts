import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import * as React from "react";
import ts from "typescript";
import * as profile from "../../lib/googleBusinessProfile.ts";
import type { InrcyConfirmOptions } from "../../lib/inrcyDialog.ts";
import * as nativeInterfaces from "../../lib/inrAssistantLocalInterface.ts";

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

async function fixture(initial: profile.GoogleBusinessProfile = original, failedLoads = 0) {
  const slots: unknown[] = [], dependencies: (unknown[] | undefined)[] = [], cleanups: (() => void)[] = [];
  const effects: (() => void)[] = [];
  const confirmations: InrcyConfirmOptions[] = [];
  const writes: Record<string, unknown>[] = [];
  let cursor = 0, activeAccount = "account", actorUserId = "actor", readCount = 0;
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
    useId: () => { const index = cursor++; return slots[index] ??= `profile-editor-${index}`; },
    useMemo: (read: () => unknown) => read(),
    useEffect(effect: () => (() => void) | void, deps?: unknown[]) {
      const index = cursor++;
      if (!dependencies[index] || !deps || deps.some((value, position) => value !== dependencies[index]![position])) {
        dependencies[index] = deps;
        effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
      }
    },
    useLayoutEffect(effect: () => (() => void) | void) { effects.push(() => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }); },
  };
  const modules: Record<string, unknown> = {
    react: hooks, "react/jsx-runtime": require("react/jsx-runtime"),
    "next-intl": { useTranslations: () => translate },
    "next/navigation": { usePathname: () => "/dashboard" },
    "./DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ actorUserId, activeAccountId: activeAccount }) },
    "../_components/DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ actorUserId, activeAccountId: activeAccount }) },
    "@/lib/inrAssistantLocalInterface": nativeInterfaces,
    "@/lib/googleBusinessProfile": profile,
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => activeAccount },
    "@/lib/inrcyDialog": { confirmInrcy: (options: InrcyConfirmOptions) => { confirmations.push(options); return new Promise<boolean>(resolve => { resolveConfirmation = resolve; }); } },
    "./GoogleBusinessWeeklyHours": { __esModule: true, default: "weekly-hours" },
    "./GoogleBusinessCategoriesEditor": { __esModule: true, default: "category-editor" },
    "../_hooks/useInrAssistantRefresh": { useInrAssistantRefresh: () => undefined },
    "./GoogleBusinessProfileEditor.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  };
  const nativeHook = { exports: {} };
  const nativeHookCode = ts.transpileModule(readFileSync("app/dashboard/_hooks/useInrAssistantLocalInterface.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", nativeHookCode)((name: string) => { assert.ok(name in modules, name); return modules[name]; }, nativeHook, nativeHook.exports);
  modules["../_hooks/useInrAssistantLocalInterface"] = nativeHook.exports;
  const code = ts.transpileModule(readFileSync("app/dashboard/_components/GoogleBusinessProfileEditor.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: { default?: (props: unknown) => React.ReactNode } = {};
  const localFetch = async (_url: string, init: RequestInit) => {
    if (init.method === "PATCH") {
      writes.push(JSON.parse(String(init.body)));
      return new Promise<Response>(resolve => { resolveWrite = resolve; });
    }
    if (++readCount <= failedLoads) return Response.json({ ok: false, user_message: "Temporary native read failure" }, { status: 502 });
    return Response.json({ ok: true, accountId: "account", accountName: "accounts/chosen", locationName: "locations/chosen", version: "version-1", profile: initial });
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
  const runLocal = (id: nativeInterfaces.InrAssistantLocalInterface, operation: nativeInterfaces.InrAssistantLocalOperation, value: string | null = null, revision?: string) => {
    const hint = nativeInterfaces.getInrAssistantLocalInterfaceHints({ accountId: activeAccount, actorUserId, pathname: "/dashboard" })?.find(hint => hint.id === id); assert.ok(hint);
    const boundActor = actorUserId, boundAccount = activeAccount;
    return nativeInterfaces.runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id }, operation, value, revision: revision || hint.revision }, { accountId: boundAccount, actorUserId: boundActor, pathname: "/dashboard" }, () => boundActor === actorUserId && boundAccount === activeAccount);
  };
  return {
    render, save, form, edit, confirmations, writes,
    editCategories: (value: profile.GoogleBusinessCategories) => (render().find(node => node.type === "category-editor")!.props.onChange as (value: profile.GoogleBusinessCategories) => void)(value),
    categorySearchPending: (pending: boolean) => (render().find(node => node.type === "category-editor")!.props.onPendingChange as (pending: boolean) => void)(pending),
    submit: () => (form().props.onSubmit as (event: unknown) => void)({ preventDefault() {} }),
    choose: async (confirmed: boolean) => { resolveConfirmation(confirmed); await tick(); },
    respond: async (ok: boolean) => { resolveWrite(Response.json(ok ? { ok: true, version: "version-2", profile: { ...original, description: "Updated description" } } : { ok: false, user_message: "Google refused the change" }, { status: ok ? 200 : 502 })); await tick(); },
    switchAccount: () => { activeAccount = "different-account"; },
    switchActor: () => { actorUserId = "different-actor"; render(); },
    nativeHints: () => nativeInterfaces.getInrAssistantLocalInterfaceHints({ accountId: activeAccount, actorUserId, pathname: "/dashboard" }),
    runLocal,
    runNative: (operation: "review" | "clear", revision?: string) => runLocal("google_profile_draft", operation, null, revision),
    unmount: () => cleanups.forEach(cleanup => cleanup()),
  };
}

test("Basic Google native sections and exception paging wait for the displayed selection and preserve the exact unsaved draft", async () => {
  const initial = { ...original, specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 24 }, closed: true }, { startDate: { year: 2026, month: 12, day: 25 }, closed: true }] } };
  const h = await fixture(initial); try {
    h.edit("Keep this local description"); h.render();
    assert.equal(await h.runLocal("google_profile_sections", "select", "invented"), false);
    let settled = false; const opened = h.runLocal("google_profile_sections", "select", "exceptions").then(ok => { settled = true; return ok; }); await tick(); assert.equal(settled, false); h.render(); assert.equal(await opened, true);
    assert.equal(h.render().find(node => node.props.role === "tab" && node.props["aria-selected"] === true)?.props.children, translate("tabs.exceptions"));
    const old = h.nativeHints()?.find(hint => hint.id === "google_special_hours"); assert.ok(old); assert.deepEqual(old.operations, ["next"]);
    const next = h.runLocal("google_special_hours", "next"); await tick(); h.render(); assert.equal(await next, true);
    assert.equal(await h.runLocal("google_special_hours", "next", null, old.revision), false); assert.deepEqual(h.nativeHints()?.find(hint => hint.id === "google_special_hours")?.operations, ["previous"]);
    const back = h.runLocal("google_profile_sections", "select", "information"); await tick(); h.render(); assert.equal(await back, true); assert.equal(h.render().find(node => node.type === "textarea")?.props.value, "Keep this local description");
    assert.equal(h.confirmations.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.save().props.disabled, false);
  } finally { h.unmount(); }
});

test("Basic Google native retry acknowledges a completed scoped profile read and never a retry increment or failed response", async () => {
  for (const failedLoads of [1, 2]) {
    const h = await fixture(original, failedLoads); try {
      h.render(); let settled = false; const retry = h.runLocal("google_profile_reload", "retry").then(ok => { settled = true; return ok; }); await tick(); assert.equal(settled, false);
      h.render(); await tick(); h.render();
      if (failedLoads === 1) assert.equal(await retry, true);
      else { assert.equal(settled, false); assert.ok(h.render().some(node => node.props.role === "alert" && node.props.children === "Temporary native read failure")); h.switchActor(); assert.equal(await retry, false); }
      assert.equal(h.writes.length, 0); assert.equal(h.confirmations.length, 0);
    } finally { h.unmount(); }
  }
});

test("Basic Google draft review acknowledges only the native confirmation opening and never saves on behalf of the professional", async () => {
  const h = await fixture(); try { h.edit(); h.render(); let settled = false;
    const pending = h.runNative("review").then(ok => { settled = true; return ok; }); await tick(); assert.equal(settled, false); assert.equal(h.confirmations.length, 1); assert.equal(h.writes.length, 0);
    h.render(); assert.equal(await pending, true); assert.equal(h.writes.length, 0); await h.choose(false); h.render(); assert.equal(h.writes.length, 0); assert.equal(h.save().props.disabled, false);
  } finally { h.unmount(); }
});
test("Basic Google draft cancellation preserves edits when declined and clears only after the native confirmation and committed reset", async () => {
  const h = await fixture(); try { h.edit(); h.render(); const declined = h.runNative("clear"); await tick(); assert.equal(h.confirmations.length, 1); await h.choose(false); assert.equal(await declined, false); assert.equal(h.save().props.disabled, false);
    const approved = h.runNative("clear"); await tick(); await h.choose(true); h.render(); assert.equal(await approved, true); assert.equal(h.save().props.disabled, true); assert.equal(h.writes.length, 0);
  } finally { h.unmount(); }
});
test("Basic Google draft review refuses a stale edit revision and an actor change during personal confirmation", async () => {
  const h = await fixture(); try { h.edit("First edit"); h.render(); const old = h.nativeHints()?.find(hint => hint.id === "google_profile_draft"); assert.ok(old); h.edit("New edit"); h.render(); assert.equal(await h.runNative("review", old.revision), false); assert.equal(h.confirmations.length, 0);
    const pending = h.runNative("review"); await tick(); h.render(); assert.equal(await pending, true); h.switchActor(); await h.choose(true); assert.equal(h.writes.length, 0);
  } finally { h.unmount(); }
});

test("an unfinished category search cannot save and category confirmation shows both lists", async () => {
  const h = await fixture(); h.edit(); h.categorySearchPending(true);
  assert.equal(h.save().props.disabled, true);
  h.submit(); assert.equal(h.confirmations.length, 0);
  h.categorySearchPending(false);
  h.editCategories({ primaryCategory: { name: "categories/gcid:plumber", displayName: "Plombier" }, additionalCategories: [{ name: "categories/gcid:heating_contractor", displayName: "Chauffagiste" }] });
  h.submit(); assert.equal(h.confirmations.length, 1);
  assert.ok(h.confirmations[0].steps?.some(step => step.includes("Activité principale : Plombier") && step.includes("Activités secondaires : Chauffagiste")));
  assert.match(h.confirmations[0].message, /nouvelle validation/);
  await h.choose(false); assert.equal(h.writes.length, 0);
});

test("editing the draft after opening a confirmation makes that confirmation stale", async () => {
  const h = await fixture(); h.edit("First edit"); h.submit(); h.edit("Later edit");
  await h.choose(true); assert.equal(h.writes.length, 0);
});

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
