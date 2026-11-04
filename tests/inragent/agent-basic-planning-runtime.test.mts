import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as history from "../../lib/inrAgentPublicationHistory.ts";
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

function fixture() {
  const state: unknown[] = [];
  let cursor = 0;
  const calls = { edit: [] as string[], reschedule: [] as string[], delete: [] as string[] };
  const compiledModule = { exports: {} as { AgentScheduleModal: (props: Props) => ReactNode } };
  new Function("require", "module", "exports", code)((id: string) => {
    if (id === "react") return {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
        return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useMemo: (factory: () => unknown) => factory(), useEffect: () => {}, useRef: () => ({ current: false }),
    };
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
  }, compiledModule, compiledModule.exports);
  return {
    calls,
    render(items: ScheduleListItem[], options: Props = {}) {
      cursor = 0;
      const tree = compiledModule.exports.AgentScheduleModal({ open: true, items, mutationState: "idle", onClose: () => {},
        onOpenContent: (item: ScheduleListItem) => calls.edit.push(item.id),
        onReschedule: (item: ScheduleListItem) => calls.reschedule.push(item.id),
        onDelete: (item: ScheduleListItem) => calls.delete.push(item.id), ...options });
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
    (node.props.onClick as () => void)();
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
