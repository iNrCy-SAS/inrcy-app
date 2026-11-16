import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { catalogTranslator } from "../helpers/catalog-translator.mts";
import { userFacingErrorsFixture } from "../helpers/user-facing-errors-fixture.mts";
const translate = catalogTranslator("booster");

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
    submitGuardRef: { current: false },
    defaultDateTime: { date: "2099-04-05", time: "12:45" },
    publishableItems: [{ channel: "facebook", label: "Facebook" }, { channel: "youtube_shorts", label: "YouTube" }],
    isSelected: () => true, getDate: () => "2099-04-06", getTime: () => "08:30",
    toLocalIso: compile("toLocalIso", {}),
    enableImmediateUnselectedWarning: true,
    confirmInrcy: async (request: unknown) => { result.warnings.push(request); return true; },
    i18nT: translate, getSafeClientErrorMessage: userFacingErrorsFixture.getClientUserFacingErrorMessage,
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
  assert.deepEqual(past.result.errors, [translate("schedule_future_datetime_error")]);
  assert.deepEqual(past.result.submissions, []);
  const empty = harness({ scheduleMode: "channel", isSelected: () => false });
  await empty.submit();
  assert.deepEqual(empty.result.errors, [translate("schedule_select_channel_error")]);
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
  assert.equal(h.result.errors[0], "");
  assert.match(h.result.errors.at(-1) || "", /réessay|connexion|indisponible/i);
  assert.doesNotMatch(h.result.errors.at(-1) || "", /Connection unavailable/);
  assert.deepEqual(h.result.success, []);
  const busy = harness({ busy: true });
  await busy.submit();
  assert.deepEqual(busy.result.submissions, []);
});

test("a rapid double click and queued click after acknowledgement schedule once and finish once", async () => {
  let acknowledge!: () => void;
  const response = new Promise<void>(resolve => { acknowledge = resolve; });
  let calls = 0, finished = 0;
  const timers: Array<() => void> = [];
  const h = harness({
    onConfirm: async () => { calls++; await response; },
    onSuccess: () => { finished++; },
    window: { setTimeout: (callback: () => void) => timers.push(callback) },
  });
  const first = h.submit();
  await h.submit();
  assert.equal(calls, 1);
  assert.equal(finished, 0, "Booster must stay open until the server acknowledges the schedule");
  acknowledge();
  await first;
  await h.submit();
  assert.equal(calls, 1, "the old render cannot publish the same schedule again");
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(finished, 1);
});

test("the confirmation dialog also holds the synchronous submit lock and decline allows retry", async () => {
  let answer!: (confirmed: boolean) => void;
  const confirmation = new Promise<boolean>(resolve => { answer = resolve; });
  let dialogs = 0, calls = 0;
  const h = harness({
    scheduleMode: "channel",
    isSelected: (channel: string) => channel === "facebook",
    confirmInrcy: async () => { dialogs++; return dialogs === 1 ? confirmation : true; },
    onConfirm: async () => { calls++; },
  });
  const first = h.submit();
  await h.submit();
  assert.equal(dialogs, 1);
  assert.equal(calls, 0);
  answer(false);
  await first;
  await h.submit();
  assert.equal(dialogs, 2);
  assert.equal(calls, 1);
});

function boosterScheduleSuccess() {
  const file = "app/dashboard/booster/publier/PublishModal.tsx";
  const modal = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let handler = "";
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(modal) === "PublishScheduleModal") {
        const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(modal) === "onSuccess");
        if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          handler = attribute.initializer.expression?.getText(modal) || "";
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(modal);
  assert.ok(handler, "the production schedule completion handler is connected");
  let closed = 0;
  const overlays: boolean[] = [], continuations: unknown[] = [];
  const receipt: { current: unknown } = { current: undefined };
  const compiled = ts.transpileModule(`const handler = ${handler};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const finish = new Function("scheduleSubmissionRef", "setScheduleModalOpen", "publishImmediateChannelsAfterSchedule", "onClose", compiled + "\nreturn handler;")(
    receipt,
    (value: boolean) => overlays.push(value),
    (request: unknown) => continuations.push(request),
    () => { closed++; },
  ) as () => void;
  return { finish, receipt, overlays, continuations, closed: () => closed };
}

test("Booster closes after a recorded complete schedule and never closes without acknowledgement", () => {
  const h = boosterScheduleSuccess();
  h.finish();
  assert.equal(h.closed(), 0);
  h.receipt.current = null;
  h.finish();
  assert.deepEqual(h.overlays, [false]);
  assert.equal(h.closed(), 1);
  assert.deepEqual(h.continuations, []);
});

test("the schedule completion callback reads the current receipt and continues only explicitly confirmed other channels", () => {
  const h = boosterScheduleSuccess();
  // Simulate a callback captured before the asynchronous schedule request.
  const acknowledged = { immediateChannels: ["facebook"], preparedPostsByChannel: {} };
  h.receipt.current = acknowledged;
  h.finish();
  assert.deepEqual(h.overlays, [false]);
  assert.deepEqual(h.continuations, [acknowledged]);
  assert.equal(h.closed(), 0, "explicit immediate channels keep their execution/result screen");
});
