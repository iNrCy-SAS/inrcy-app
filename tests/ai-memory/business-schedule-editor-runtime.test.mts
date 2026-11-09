import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import * as schedules from "../../lib/businessWeeklySchedule.ts";

type Props = Record<string, unknown>;
type Change = (event: { target: { value: string } }) => void;
const require = createRequire(import.meta.url);
const copy = JSON.parse(readFileSync("messages/fr-FR/dashboard.json", "utf8")).aiMemory;
const source = readFileSync("app/dashboard/settings/_components/BusinessScheduleEditor.tsx", "utf8");
const compiled = ts.transpileModule(source, {
  fileName: "BusinessScheduleEditor.tsx",
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function elements(tree: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!isValidElement<Props>(tree)) return [];
  return [tree, ...elements(tree.props.children as ReactNode)];
}

/** Real controlled TSX handlers, parent state feedback and canonical persistence. */
function editor(initial = schedules.parseBusinessWeeklyScheduleText("Lundi : 9h-12h et 14h-18h")) {
  let value = initial;
  const slots: unknown[] = [];
  let cursor = 0;
  const dependencies: Props = {
    react: { useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    } },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next-intl": { useLocale: () => "fr-FR", useTranslations: () => (key: string) => copy[key] || key },
    "@/lib/businessWeeklySchedule": schedules,
    "../../_components/MediaSubjectVoiceButton": { __esModule: true, default: function Voice() {} },
  };
  const loaded = { exports: {} as { default: (props: Props) => ReactNode } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  const render = () => { cursor = 0; return elements(loaded.exports.default({ value, onChange: (next: schedules.BusinessWeeklySchedule) => { value = next; } })); };
  const notes = () => render().find(node => node.props.id === "business-dna-schedule-notes")!;
  const enter = (next: string) => (notes().props.onChange as Change)({ target: { value: next } });
  return { render, notes, enter, value: () => value,
    type(text: string) { for (const character of text) { const next = String(notes().props.value) + character; enter(next); assert.equal(notes().props.value, next, `Preserve the keystroke ${JSON.stringify(character)}`); } },
    reload() { value = schedules.decodeBusinessWeeklySchedule(schedules.encodeBusinessWeeklySchedule(value), ""); slots.length = 0; },
    replace(next: schedules.BusinessWeeklySchedule) { value = next; },
  };
}

test("useful schedule details retain every typed space and newline through controlled rerenders", () => {
  const h = editor();
  const days = structuredClone(h.value().days);
  h.type("Sur rendez-vous uniquement\nUrgences  le week-end ");
  assert.equal(h.notes().props.value, "Sur rendez-vous uniquement\nUrgences  le week-end ");
  assert.deepEqual(h.value().days, days);
  h.reload();
  assert.equal(h.notes().props.value, "Sur rendez-vous uniquement\nUrgences  le week-end");
  assert.deepEqual(h.value().days, days);
});

test("editing hours preserves an unfinished notes word separator", () => {
  const h = editor(); h.enter("Sur ");
  const start = h.render().find(node => node.props["aria-label"] === "Lundi Début")!;
  assert.ok(start);
  (start.props.onChange as Change)({ target: { value: "10:00" } });
  assert.equal(h.notes().props.value, "Sur ");
  h.type("rendez-vous");
  assert.equal(h.value().notes, "Sur rendez-vous");
  assert.equal(h.value().days.monday.slots[0].start, "10:00");
});

test("an autosave echo cannot remove the next word separator while typing", () => {
  const h = editor(); h.type("Sur ");
  h.replace(schedules.normalizeBusinessWeeklySchedule(h.value()));
  assert.equal(h.notes().props.value, "Sur ");
  h.type("rendez-vous");
  assert.equal(h.value().notes, "Sur rendez-vous");
  (h.notes().props.onBlur as () => void)();
  assert.equal(h.notes().props.value, "Sur rendez-vous");
});

test("external schedule refreshes and dictated notes replace the displayed draft", () => {
  const h = editor(); h.type("Brouillon ");
  h.replace({ ...h.value(), notes: "Uniquement sur rendez-vous" });
  assert.equal(h.notes().props.value, "Uniquement sur rendez-vous");
  const voice = h.render().find(node => node.props.contextLabel === copy.scheduleNotes)!;
  (voice.props.onChange as (notes: string) => void)("Urgences possibles le dimanche");
  assert.equal(h.notes().props.value, "Urgences possibles le dimanche");
});
