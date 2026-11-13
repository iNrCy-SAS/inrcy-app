import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as history from "../../lib/inrAgentPublicationHistory.ts";
import * as localDriver from "../../lib/inrAssistantLocalInterface.ts";
import * as selection from "../../lib/inrAssistantHistoryUiSelection.ts";
import type { ScheduleListItem } from "../../app/dashboard/agent/_lib/agent.types.ts";

const require = createRequire(import.meta.url);
const messages = JSON.parse(readFileSync(new URL("../../messages/fr-FR/agent.json", import.meta.url), "utf8"));
const code = ts.transpileModule(readFileSync(new URL("../../app/dashboard/agent/_components/AgentActionModals.tsx", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  return isValidElement<Props>(node) ? [node, ...elements(node.props.children as ReactNode)] : [];
}

let mountSequence = 0;
const localScope = { actorUserId: "planning-actor", accountId: "planning-account", pathname: "/dashboard/agent/publications" };
function fixture(nativePorts = false, exportName = "AgentScheduleModal") {
  const state: unknown[] = [];
  const layout: Array<() => void | (() => void)> = [], cleanups: Array<() => void> = [];
  const mountId = `planning-native-${++mountSequence}`;
  let cursor = 0;
  const calls = { edit: [] as string[], reschedule: [] as string[], delete: [] as string[] };
  const compiledModule = { exports: {} as Record<string, (props: Props) => ReactNode> };
  const react = {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useMemo: (factory: () => unknown) => factory(), useEffect: () => {},
      useRef(initial: unknown) { const slot = cursor++; state[slot] ??= { current: initial }; return state[slot]; },
      useId() { const slot = cursor++; state[slot] ??= `${mountId}-${slot}`; return state[slot]; },
      useLayoutEffect(callback: () => void | (() => void)) { layout.push(callback); },
  };
  let nativeHook: Record<string, unknown> | undefined;
  const load = (id: string): unknown => {
    if (id === "react") return react;
    if (id.endsWith("useInrAssistantLocalInterface")) {
      if (!nativePorts) return { useInrAssistantLocalInterface() {} };
      if (!nativeHook) {
        const record = { exports: {} as Record<string, unknown> };
        const hookCode = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useInrAssistantLocalInterface.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
        new Function("module", "exports", "require", hookCode)(record, record.exports, load); nativeHook = record.exports;
      }
      return nativeHook;
    }
    if (id === "@/lib/inrAssistantHistoryUiSelection") return selection;
    if (id === "@/lib/inrAssistantLocalInterface") return localDriver;
    if (id === "next/navigation") return { usePathname: () => localScope.pathname };
    if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ actorUserId: localScope.actorUserId, activeAccountId: localScope.accountId }) };
    if (id === "react/jsx-runtime") return require(id);
    if (id === "next-intl") return { useLocale: () => "fr-FR", useTranslations: () => (key: string) => {
      assert.equal(typeof messages[key], "string", `Missing message ${key}`);
      return messages[key];
    } };
    if (id === "@/lib/inrAgentPublicationHistory") return history;
    if (id.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (id.includes("MediaLibraryPickerModal")) return { __esModule: true, default: () => null };
    if (id.endsWith("agent.config")) return { channelOptions: {} };
    if (id.endsWith("agent.campaign-preview")) return {};
    throw new Error(`Unexpected planning fixture import ${id}`);
  };
  new Function("require", "module", "exports", code)(load, compiledModule, compiledModule.exports);
  return {
    calls,
    dispose() { cleanups.splice(0).forEach(cleanup => cleanup()); },
    render(items: ScheduleListItem[], options: Props = {}) {
      cursor = 0; layout.length = 0;
      const tree = compiledModule.exports[exportName]({ open: true, items, mutationState: "idle", onClose: () => {},
        onOpenContent: (item: ScheduleListItem) => calls.edit.push(item.id),
        onReschedule: (item: ScheduleListItem) => calls.reschedule.push(item.id),
        onDelete: (item: ScheduleListItem) => calls.delete.push(item.id), ...options });
      for (const callback of layout) { const cleanup = callback(); if (cleanup) cleanups.push(cleanup); }
      return { tree, nodes: elements(tree), html: renderToStaticMarkup(tree) };
    },
  };
}

function item(id: string, automationKey: ScheduleListItem["automationKey"], day: number): ScheduleListItem {
  const date = new Date();
  date.setDate(10 + day);
  return { id, automationKey, action: id, date: `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`, time: "12:00",
    typeLabel: id, channelLabel: "Facebook", channelLabels: ["Facebook"], originLabel: "Booster", source: "manual", status: "Programmé", statusKey: "scheduled",
    scheduledAtIso: date.toISOString(), editable: true, removable: true };
}
const items = [item("publication-from-booster", "publish", 1), item("stats-report-hidden-in-basic", "stats", 2), item("campaign-hidden-in-basic", "grow", 3)];
function control(nodes: Element[], predicate: (node: Element) => boolean) {
  const node = nodes.find(predicate);
  assert.ok(node, "Expected planning control is absent");
  return node;
}

test("Basic planning only counts publications and preserves their edit, reschedule and delete controls", () => {
  const h = fixture();
  const { html, nodes } = h.render(items, { showStats: false, showCampaigns: false });
  assert.match(html, /publication-from-booster/);
  assert.doesNotMatch(html, /stats-report-hidden-in-basic|campaign-hidden-in-basic|scheduleFilterPopover/);
  assert.match(html, /aria-label="1 actions du mois"/);
  for (const name of ["edit", "reschedule", "delete"] as const) {
    const node = control(nodes, node => node.props["data-schedule-action"] === name);
    assert.notEqual(node.props.disabled, true);
    (node.props.onClick as (event: unknown) => void)({ currentTarget: { closest: () => null }, stopPropagation() {}, preventDefault() {} });
    assert.deepEqual(h.calls[name], ["publication-from-booster"]);
  }
});

test("Standard retains its Stats filter and Premium retains campaign filters", () => {
  for (const showCampaigns of [false, true]) {
    const h = fixture();
    const { nodes } = h.render(items, { showCampaigns });
    (control(nodes, node => node.props["aria-controls"] === "inr-agent-schedule-filters").props.onClick as () => void)();
    const result = h.render(items, { showCampaigns });
    assert.match(result.html, /data-filter="stats"/);
    assert.match(result.html, /stats-report-hidden-in-basic/);
    assert.equal(result.html.includes('data-filter="campaigns"'), showCampaigns);
    assert.equal(result.html.includes("campaign-hidden-in-basic"), showCampaigns);
    assert.match(result.html, new RegExp(`aria-label="${showCampaigns ? 3 : 2} actions du mois"`));
  }
});

test("an earlier filter selection cannot hide the only Basic publication category", () => {
  const h = fixture();
  const first = h.render(items);
  (control(first.nodes, node => node.props["aria-controls"] === "inr-agent-schedule-filters").props.onClick as () => void)();
  const filters = h.render(items);
  const publicationFilter = control(filters.nodes, node => node.props["data-filter"] === "publications");
  const checkbox = control(elements(publicationFilter), node => node.type === "input");
  (checkbox.props.onChange as (event: unknown) => void)({ currentTarget: { checked: false } });
  assert.doesNotMatch(h.render(items).html, /publication-from-booster/);
  const basic = h.render(items, { showStats: false, showCampaigns: false });
  assert.match(basic.html, /publication-from-booster/);
  assert.doesNotMatch(basic.html, /stats-report-hidden-in-basic|campaign-hidden-in-basic|scheduleFilterPopover/);
});

function localCommand(id: localDriver.InrAssistantLocalInterface, operation: localDriver.InrAssistantLocalOperation, value: string | null = null) {
  const hint = localDriver.getInrAssistantLocalInterfaceHints(localScope)?.find(item => item.id === id);
  assert.ok(hint, `Expected mounted native port ${id}`);
  return { command: "control_local_interface" as const, selection: { kind: "account_document" as const, id }, operation, value, revision: hint.revision };
}

test("Basic planning month and day ports execute native controls only after their rendered commit", async t => {
  const h = fixture(true); t.after(() => h.dispose());
  const first = item("same-day-first", "publish", 1), second = { ...first, id: "same-day-second", action: "same-day-second", time: "13:00" };
  const records = [first, second], options = { showStats: false, showCampaigns: false };
  const initial = h.render(records, options);
  let complete = false;
  const next = localDriver.runInrAssistantLocalInterface(localCommand("planning_calendar", "next"), localScope, () => true).then(ok => { complete = true; return ok; });
  await Promise.resolve(); assert.equal(complete, false);
  const changed = h.render(records, options); assert.equal(await next, true); assert.notEqual(changed.html, initial.html);
  const previous = localDriver.runInrAssistantLocalInterface(localCommand("planning_calendar", "previous"), localScope, () => true);
  h.render(records, options); assert.equal(await previous, true);
  const parts = first.date.split("/"); const day = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  const dayCommand = localCommand("planning_day", "select", JSON.stringify({ day, direction: 1 }));
  const moveDay = localDriver.runInrAssistantLocalInterface(dayCommand, localScope, () => true);
  const afterDay = h.render(records, options); assert.equal(await moveDay, true);
  assert.match(afterDay.html, /same-day-second/);
  assert.equal(await localDriver.runInrAssistantLocalInterface({ ...dayCommand, value: JSON.stringify({ day: "2099-01-01", direction: 1 }) }, localScope, () => true), false);
  assert.ok(!localDriver.getInrAssistantLocalInterfaceHints(localScope)?.some(port => port.id === "planning_filters"));
  assert.deepEqual(h.calls, { edit: [], reschedule: [], delete: [] }, "Read-only navigation never invokes content writes");
});

test("native planning filter and close ports respect visible categories and the parent close decision", async t => {
  const h = fixture(true); t.after(() => h.dispose());
  let closeCalls = 0;
  const options = { showCampaigns: false, onClose: () => { closeCalls++; } };
  h.render(items, options);
  const open = localDriver.runInrAssistantLocalInterface(localCommand("planning_filters", "open"), localScope, () => true);
  h.render(items, options); assert.equal(await open, true);
  assert.equal(await localDriver.runInrAssistantLocalInterface(localCommand("planning_filters", "select", JSON.stringify({ filter: "campaigns", enabled: true })), localScope, () => true), false);
  const hideStats = localDriver.runInrAssistantLocalInterface(localCommand("planning_filters", "select", JSON.stringify({ filter: "stats", enabled: false })), localScope, () => true);
  const filtered = h.render(items, options); assert.equal(await hideStats, true); assert.doesNotMatch(filtered.html, /stats-report-hidden-in-basic/);
  const close = localDriver.runInrAssistantLocalInterface(localCommand("planning_calendar", "close"), localScope, () => true);
  await Promise.resolve(); assert.equal(closeCalls, 1);
  h.render(items, { ...options, open: false }); assert.equal(await close, true);
  assert.equal(localDriver.getInrAssistantLocalInterfaceHints(localScope), undefined);
});

test("Basic Planning editor choice waits for the actual requested text or media editor rather than just closing the chooser", async t => {
  const h = fixture(true, "PublishEditChoiceModal"); t.after(() => h.dispose()); let text = 0, media = 0;
  const options = { isPublishView: true, hasPreparedAction: true, activeEditor: null, onOpenText: () => { text++; }, onOpenMedia: () => { media++; } };
  h.render([], options);
  assert.equal(await localDriver.runInrAssistantLocalInterface(localCommand("planning_edit_choice", "select", "invalid"), localScope, () => true), false);
  let done = false;
  const select = localDriver.runInrAssistantLocalInterface(localCommand("planning_edit_choice", "select", "text"), localScope, () => true).then(result => { done = true; return result; });
  await Promise.resolve(); assert.equal(text, 1); assert.equal(media, 0); assert.equal(done, false);
  h.render([], { ...options, open: false }); await Promise.resolve(); assert.equal(done, false, "Closing alone cannot certify that the requested editor opened");
  h.render([], { ...options, open: false, activeEditor: "text" }); assert.equal(await select, true);
  h.render([], options);
  const second = localDriver.runInrAssistantLocalInterface(localCommand("planning_edit_choice", "select", "media"), localScope, () => true);
  h.render([], { ...options, open: false, activeEditor: "media" }); assert.equal(await second, true); assert.equal(media, 1);
});

test("Basic Planning opens only a currently visible manual schedule and verifies the exact native editor and disclosures", async t => {
  const h = fixture(true); t.after(() => h.dispose());
  const id = "10000000-0000-4000-8000-000000000001";
  const first = { ...item("manual-current", "publish", 1), scheduledActionId: id, channelLabels: ["Facebook", "Instagram"] };
  const options = { showStats: false, showCampaigns: false };
  h.render([first], options);
  for (const action of ["actions", "channels"]) {
    const expand = localDriver.runInrAssistantLocalInterface(localCommand("planning_item", "select", JSON.stringify({ id, action, open: true })), localScope, () => true);
    const result = h.render([first], options); assert.equal(await expand, true);
    assert.ok(result.nodes.some(node => node.type === "details" && node.props.open === true));
  }
  const absent = localCommand("planning_item", "select", JSON.stringify({ id: "20000000-0000-4000-8000-000000000002", action: "open_content", open: null }));
  assert.equal(await localDriver.runInrAssistantLocalInterface(absent, localScope, () => true), false); assert.deepEqual(h.calls.edit, []);
  let done = false;
  const open = localDriver.runInrAssistantLocalInterface(localCommand("planning_item", "select", JSON.stringify({ id, action: "open_content", open: null })), localScope, () => true).then(result => { done = true; return result; });
  await Promise.resolve(); assert.deepEqual(h.calls.edit, ["manual-current"]); assert.equal(done, false);
  h.render([first], { ...options, open: false, openedItemId: id }); assert.equal(await open, true);
});
