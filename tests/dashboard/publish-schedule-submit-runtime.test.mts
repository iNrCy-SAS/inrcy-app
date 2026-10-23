import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const path = "app/dashboard/_components/PublishScheduleModal.tsx";
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function compile(name: string, scope: Record<string, unknown>) {
  let expression = "";
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer) expression = node.initializer.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, "Missing scheduling function " + name);
  const compiled = ts.transpileModule("const value = (" + expression + ");", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), compiled + "\nreturn value;")(...Object.values(scope));
}

type Selection = { channel: string; scheduledAt: string };
function harness(overrides: Record<string, unknown> = {}) {
  const result = { submissions: [] as Array<{ selections: Selection[]; immediate: string[] }>, warnings: [] as unknown[], errors: [] as string[], busy: [] as boolean[], success: [] as string[] };
  const scope = {
    busy: false, doneMessage: "", scheduleMode: "general", generalDate: "2099-04-05", generalTime: "12:45",
    defaultDateTime: { date: "2099-04-05", time: "12:45" },
    publishableItems: [{ channel: "facebook", label: "Facebook" }, { channel: "youtube_shorts", label: "YouTube" }],
    isSelected: () => true, getDate: () => "2099-04-06", getTime: () => "08:30",
    toLocalIso: compile("toLocalIso", {}),
    enableImmediateUnselectedWarning: true,
    confirmInrcy: async (request: unknown) => { result.warnings.push(request); return true; },
    i18nT: (key: string) => key,
    setLocalError: (message: string) => result.errors.push(message),
    setSubmitting: (value: boolean) => result.busy.push(value),
    setDoneMessage: (message: string) => result.success.push(message), resolvedSuccessMessage: "scheduled",
    onConfirm: async (selections: Selection[], immediate: string[]) => { result.submissions.push({ selections, immediate }); },
    onSuccess: () => {}, window: { setTimeout: () => {} }, ...overrides,
  };
  return { result, submit: compile("submit", scope) as () => Promise<void> };
}

test("general scheduling dispatches every ready channel at the same future local slot", async () => {
  const h = harness();
  await h.submit();
  assert.deepEqual(h.result.submissions, [{ selections: [
    { channel: "facebook", scheduledAt: new Date("2099-04-05T12:45:00").toISOString() },
    { channel: "youtube_shorts", scheduledAt: new Date("2099-04-05T12:45:00").toISOString() },
  ], immediate: [] }]);
  assert.deepEqual(h.result.warnings, []);
  assert.deepEqual(h.result.busy, [true, false]);
  assert.deepEqual(h.result.success, ["scheduled"]);
});

test("per-channel scheduling preserves individual slots and confirms channels left for immediate publication", async () => {
  const h = harness({
    scheduleMode: "channel",
    publishableItems: [{ channel: "facebook", label: "Facebook" }, { channel: "instagram", label: "Instagram" }, { channel: "youtube_shorts", label: "YouTube" }],
    isSelected: (channel: string) => channel !== "youtube_shorts",
    getDate: (channel: string) => channel === "facebook" ? "2099-04-06" : "2099-04-07",
    getTime: (channel: string) => channel === "facebook" ? "08:30" : "19:15",
  });
  await h.submit();
  assert.deepEqual(h.result.submissions, [{ selections: [
    { channel: "facebook", scheduledAt: new Date("2099-04-06T08:30:00").toISOString() },
    { channel: "instagram", scheduledAt: new Date("2099-04-07T19:15:00").toISOString() },
  ], immediate: ["youtube_shorts"] }]);
  assert.equal(h.result.warnings.length, 1);
});

test("past dates, an empty selection and a declined immediate-publication confirmation never dispatch", async () => {
  const past = harness({ generalDate: "2000-01-01" });
  await past.submit();
  assert.deepEqual(past.result.errors, ["schedule_future_datetime_error"]);
  assert.deepEqual(past.result.submissions, []);
  const empty = harness({ scheduleMode: "channel", isSelected: () => false });
  await empty.submit();
  assert.deepEqual(empty.result.errors, ["schedule_select_channel_error"]);
  assert.deepEqual(empty.result.submissions, []);
  const declined = harness({ scheduleMode: "channel", isSelected: (channel: string) => channel === "facebook", confirmInrcy: async () => false });
  await declined.submit();
  assert.deepEqual(declined.result.submissions, []);
  assert.deepEqual(declined.result.busy, []);
});

test("a scheduling failure leaves the form retryable and never reports success", async () => {
  const h = harness({ onConfirm: async () => { throw new Error("Connection unavailable"); } });
  await h.submit();
  assert.deepEqual(h.result.busy, [true, false]);
  assert.deepEqual(h.result.errors, ["", "Connection unavailable"]);
  assert.deepEqual(h.result.success, []);
  const busy = harness({ busy: true });
  await busy.submit();
  assert.deepEqual(busy.result.submissions, []);
});
