import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; setter?: (value: unknown) => void };
function runtime() {
  const slots: Slot[] = [], pending: Array<() => void> = [];
  let cursor = 0;
  const changed = (before: readonly unknown[] | undefined, after: readonly unknown[]) =>
    !before || before.length !== after.length || after.some((value, index) => !Object.is(value, before[index]));
  return {
    useState(initial: unknown) {
      const slot = slots[cursor++] ??= { value: typeof initial === "function" ? initial() : initial };
      slot.setter ??= value => { slot.value = typeof value === "function" ? value(slot.value) : value; };
      return [slot.value, slot.setter];
    },
    useEffect(callback: () => void | (() => void), deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (!changed(slot.deps, deps)) return;
      slot.deps = deps;
      pending.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; });
    },
    useEffectEvent(callback: (...args: unknown[]) => unknown) {
      const slot = slots[cursor++] ??= {}; slot.value = callback;
      return (...args: unknown[]) => (slot.value as typeof callback)(...args);
    },
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const slot = slots[cursor++] ??= {};
      if (changed(slot.deps, deps)) { slot.value = callback; slot.deps = deps; }
      return slot.value as T;
    },
    render<T>(run: () => T) { cursor = 0; const value = run(); pending.splice(0).forEach(effect => effect()); return value; },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

function selectedStatements(path: string, names: string[], effectMarker?: string) {
  const source = readFileSync(new URL(`../../app/dashboard/${path}`, import.meta.url), "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const statements: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) statements.push(node.getText(file).replace(/^export\s+/, ""));
    else if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(file)))) statements.push(node.getText(file));
    else if (effectMarker && ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === "useEffect" && node.getText(file).includes(effectMarker)) statements.push(node.getText(file));
    else ts.forEachChild(node, visit);
  }
  visit(file);
  return statements.join("\n");
}

function compile(source: string, props: Record<string, unknown>, globals: Record<string, unknown>, result = "") {
  const code = ts.transpileModule(`return function render({${Object.keys(props).join(",")}}) { ${source}\n${result} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(globals), code)(...Object.values(globals)) as (props: Record<string, unknown>) => unknown;
}
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

test("document URL prefill is an initial session snapshot and fresh form objects never overwrite edits", () => {
  const state: Record<string, string> = {};
  const setters = ["ClientName", "ClientAddress", "ClientEmail", "ClientSiren", "ClientVatNumber", "BillingAddress", "BillingPostalCode", "BillingCity", "DeliveryAddress", "DeliveryPostalCode", "DeliveryCity"];
  const form = Object.fromEntries(setters.map(name => [`set${name}`, (update: (value: string) => string) => { state[name] = update(state[name] || ""); }]));
  const props = { searchParams: new URLSearchParams({ clientName: "Initial client", clientEmail: "initial@example.test" }), form };
  const h = runtime();
  const source = selectedStatements("_documents/useDocumentEditorHooks.ts", ["useDocumentClientQueryPrefill"]);
  const run = compile(source, props, { ...h, splitFrenchAddress: (address: string) => ({ address, postal_code: "", city: "" }) }, "useDocumentClientQueryPrefill(searchParams, form);");
  const render = () => h.render(() => run(props));
  render(); assert.equal(state.ClientName, "Initial client");
  state.ClientName = "Edited client"; state.ClientEmail = "";
  props.form = { ...form }; props.searchParams = new URLSearchParams({ clientName: "Different URL", clientEmail: "different@example.test" });
  render(); render();
  assert.equal(state.ClientName, "Edited client"); assert.equal(state.ClientEmail, "");
  h.unmount();
});

test("document CRM loader keeps one request for stable sinks and ignores a replaced sink's pending response", async () => {
  const requests: Array<(response: Response) => void> = [], oldRows: unknown[] = [], currentRows: unknown[] = [];
  const props = { setContacts: (rows: unknown) => oldRows.push(rows), setLoading() {}, setError() {} };
  const h = runtime();
  const source = selectedStatements("_documents/useDocumentEditorHooks.ts", ["useDocumentCrmContactsLoader"]);
  const run = compile(source, props, { ...h, fetch: () => new Promise<Response>(resolve => requests.push(resolve)), getClientUserFacingErrorMessage: () => "error" }, "useDocumentCrmContactsLoader({setContacts, setLoading, setError});");
  const render = () => h.render(() => run(props));
  render(); render(); assert.equal(requests.length, 1);
  props.setContacts = rows => currentRows.push(rows); render(); assert.equal(requests.length, 2);
  requests[0](Response.json({ contacts: [{ id: "old" }] })); await settle(); assert.deepEqual(oldRows, []);
  requests[1](Response.json({ contacts: [{ id: "current" }] })); await settle(); assert.deepEqual(currentRows, [[{ id: "current" }]]);
  h.unmount();
});

for (const area of ["devis", "factures"]) test(`${area}: loaded defaults use the current application callback without refetching or resetting edits`, async () => {
  const h = runtime(), pending: Array<(response: Response) => void> = [], applied: string[] = [];
  const listeners = new Map<string, () => void>();
  const props = {
    searchParams: new URLSearchParams(), setDocumentsSettings() {}, applyDocumentDefaults: () => applied.push("old VAT"),
    documentEdits: { dirty: false },
  };
  const source = selectedStatements(`${area}/new/page.tsx`, ["onDocumentSettingsLoaded"], "const loadSettings");
  const run = compile(source, props, { ...h, fetch: () => new Promise<Response>(resolve => pending.push(resolve)), normalizeInrDocumentsSettings: (value: unknown) => value,
    INRDOCUMENTS_SETTINGS_UPDATED_EVENT: "settings-updated", window: { addEventListener: (name: string, callback: () => void) => listeners.set(name, callback), removeEventListener: (name: string) => listeners.delete(name) },
  });
  const render = () => h.render(() => run(props));
  render(); props.applyDocumentDefaults = () => applied.push("current VAT"); render();
  assert.equal(pending.length, 1);
  pending[0](Response.json({ settings: {} })); await settle(); assert.deepEqual(applied, ["current VAT"]);
  props.applyDocumentDefaults = () => applied.push("edited form replaced"); render(); render();
  assert.equal(pending.length, 1); assert.equal(applied.length, 1);
  listeners.get("settings-updated")!(); assert.equal(pending.length, 2);
  pending[1](Response.json({ settings: {} })); await settle(); assert.equal(applied.length, 2);
  props.documentEdits = { dirty: true }; render();
  listeners.get("settings-updated")!();
  pending[2](Response.json({ settings: {} })); await settle(); assert.equal(applied.length, 2, "late defaults must not overwrite a local edit");
  listeners.get("settings-updated")!(); h.unmount();
  pending[3](Response.json({ settings: {} })); await settle(); assert.equal(applied.length, 2); assert.equal(listeners.size, 0);
});

type SavedRow = { id: string; payload: { marker: string } };
function database(account: string, pending: Array<{ account: string; id: string; resolve: (result: { data: SavedRow | null; error: null }) => void }>) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: account } } }) },
    from() {
      let id = "";
      const query = { select() { return query; }, eq(key: string, value: string) { if (key === "id") id = value; return query; },
        maybeSingle: () => new Promise<{ data: SavedRow | null; error: null }>(resolve => pending.push({ account, id, resolve })),
      };
      return query;
    },
  };
}

for (const area of ["devis", "factures"]) test(`${area}: requested save changes cancel old account results and editing never reapplies a loaded snapshot`, async () => {
  const h = runtime(), pending: Array<{ account: string; id: string; resolve: (result: { data: SavedRow | null; error: null }) => void }> = [];
  const applied: unknown[] = [], selected: unknown[] = [], messages: unknown[] = [];
  const props = {
    searchParams: new URLSearchParams({ saveId: "save-a" }), supabase: database("account-a", pending),
    applyDraftSnapshot: (snapshot: unknown) => applied.push(snapshot), setCurrentSaveId: (id: unknown) => selected.push(id),
    setFormMessage: (message: unknown) => messages.push(message), i18nT: (key: string) => `fr:${key}`,
    documentEdits: { requestNavigation: async (action: () => void) => { action(); return true; } },
  };
  const source = selectedStatements(`${area}/new/page.tsx`, ["onRequestedSaveLoadFailed", "onRequestedSaveLoaded"], "const loadRequestedSave");
  const run = compile(source, props, { ...h, SAVES_TYPE: area, resolveActiveBrowserUserId: (id: string) => id });
  const render = () => h.render(() => run(props));
  render(); await settle(); assert.equal(pending.length, 1);
  props.searchParams = new URLSearchParams({ saveId: "save-b" }); props.supabase = database("account-b", pending); render(); await settle();
  pending[0].resolve({ data: { id: "save-a", payload: { marker: "obsolete" } }, error: null }); await settle(); assert.equal(applied.length, 0);
  props.applyDraftSnapshot = snapshot => applied.push({ current: snapshot }); props.i18nT = key => `en:${key}`; render();
  assert.equal(pending.length, 2);
  pending[1].resolve({ data: { id: "save-b", payload: { marker: "current" } }, error: null }); await settle();
  assert.deepEqual([...applied], [{ current: { marker: "current" } }]); assert.deepEqual(selected, ["save-b"]);
  assert.ok((messages[0] as { text: string }).text.startsWith("en:"));
  props.applyDraftSnapshot = snapshot => applied.push({ overwritten: snapshot }); render(); render();
  assert.equal(pending.length, 2); assert.equal(applied.length, 1);
  h.unmount();
});

test("invoice conversion keeps its query/settings triggers, cancelling obsolete results and ignoring form-only renders", async () => {
  const h = runtime(), pending: Array<{ account: string; id: string; resolve: (result: { data: SavedRow | null; error: null }) => void }> = [];
  const conversions: unknown[][] = [];
  const props = {
    searchParams: new URLSearchParams({ fromDevisSaveId: "quote-a" }), supabase: database("account-a", pending), vatDispense: false,
    documentsSettings: { invoice: { dueDays: 30 } }, onDevisConversionLoadFailed() {},
    onDevisConversionLoaded: (...args: unknown[]) => conversions.push(args),
  };
  const source = selectedStatements("factures/new/page.tsx", [], "const loadDevisForConversion");
  const run = compile(source, props, { ...h, resolveActiveBrowserUserId: (id: string) => id, dateWithAddedDays: (_date: string, days: number) => `due:${days}` });
  const render = () => h.render(() => run(props));
  render(); await settle();
  props.searchParams = new URLSearchParams({ fromDevisSaveId: "quote-b" }); render(); await settle();
  pending[0].resolve({ data: { id: "quote-a", payload: { marker: "old" } }, error: null }); await settle(); assert.equal(conversions.length, 0);
  pending[1].resolve({ data: { id: "quote-b", payload: { marker: "new" } }, error: null }); await settle(); assert.equal(conversions.length, 1);
  assert.deepEqual(conversions[0].slice(0, 2), [{ marker: "new" }, "quote-b"]);
  render(); render(); assert.equal(pending.length, 2); assert.equal(conversions.length, 1);
  h.unmount();
});
