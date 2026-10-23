/* eslint-disable @typescript-eslint/no-explicit-any -- isolated callbacks execute the real TSX event handlers without a browser or network */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { canOpenPublishWizardStep } from "../../app/dashboard/booster/publier/components/publishWizard.ts";
import { mergePreflightFailuresIntoPublicationSummary } from "../../lib/boosterPublicationOutcome.ts";
import { isBoosterPublicationPendingStatus } from "../../lib/boosterPublicationStatus.ts";

const parse = (path: string) => ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const modal = parse("app/dashboard/booster/publier/PublishModal.tsx");
const layer = parse("app/dashboard/_components/DashboardBoosterModalLayer.tsx");
const progress = parse("app/dashboard/_components/PublishExecutionProgress.tsx");
const resultModal = parse("app/dashboard/_components/PublishExecutionResultModal.tsx");
function find(source: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (!result && predicate(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(result, "Required production handler was not found");
  return result;
}
function variable(source: ts.SourceFile, name: string): ts.Expression {
  const declaration = find(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration;
  assert.ok(declaration.initializer);
  return declaration.initializer;
}
function attribute(source: ts.SourceFile, tag: string, name: string): ts.Expression {
  const element = find(source, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === tag) as ts.JsxOpeningElement;
  const prop = element.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(source) === name) as ts.JsxAttribute | undefined;
  assert.ok(prop?.initializer && ts.isJsxExpression(prop.initializer) && prop.initializer.expression, `${tag}.${name} is required`);
  return (prop.initializer as ts.JsxExpression).expression!;
}
function evaluate(expression: string, scope: Record<string, unknown> = {}): any {
  const compiled = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), compiled + "\nreturn value;")(...Object.values(scope));
}
function callback(name: string, scope: Record<string, unknown>) {
  return evaluate(variable(layer, name).getText(layer), { useCallback: (fn: unknown) => fn, ...scope });
}
const destinationStatus = evaluate(find(progress, node => ts.isFunctionDeclaration(node) && node.name?.text === "getPublicationDestinationStatus").getText(progress).replace(/^export\s+/, ""), { isBoosterPublicationPendingStatus });
const mergeRetrySummary = evaluate(find(modal, node => ts.isFunctionDeclaration(node) && node.name?.text === "mergeRetriedPublicationSummary").getText(modal), { getPublicationDestinationStatus: destinationStatus });
function resultProps(scope: Record<string, unknown>) {
  return evaluate(attribute(layer, "PublishModal", "publicationResult").getText(layer), {
    publishSuccessOpen: true, publishSummary: { publicationId: "previous" }, publishRetrying: false,
    publishRetryError: "", publishRetryFailedRef: { current: null }, ...scope,
  });
}

test("acknowledged immediate publications retain the mounted Booster while standalone callers still close", () => {
  const runPublish = variable(modal, "runPublish") as ts.ArrowFunction;
  const tryStatement = find(runPublish, ts.isTryStatement) as ts.TryStatement;
  const completion = tryStatement.tryBlock.statements.filter(statement => ts.isIfStatement(statement) && (
    statement.expression.getText(modal) === "!options?.suppressPublishSuccess" ||
    statement.expression.getText(modal).includes("options?.closeOnSuccess !== false")
  ));
  assert.equal(completion.length, 2);
  const execute = (options: Record<string, unknown> | undefined, hasHandler: boolean, publicationAccepted = true) => {
    const calls: string[] = [];
    evaluate(`() => { ${completion.map(node => node.getText(modal)).join("\n")} }`, {
      options, publicationAccepted, result: { summary: { successCount: 1 } }, channelLinks: {},
      preflightFailedChannels: [], remainingRetryChannels: [], retryFailed: undefined, completedSummary: { successCount: 1 },
      onPublishSuccess: hasHandler ? () => calls.push("result") : undefined,
      onClose: () => calls.push("close"),
    })();
    return calls;
  };
  assert.deepEqual(execute(undefined, true), ["result"]);
  assert.deepEqual(execute({ closeOnSuccess: true }, true), ["result"]);
  assert.deepEqual(execute(undefined, false), ["close"]);
  assert.deepEqual(execute({ suppressPublishSuccess: true }, true), ["close"]);
  assert.deepEqual(execute({ closeOnSuccess: false }, false), []);
  assert.deepEqual(execute(undefined, true, false), ["result"]);
});

test("retry executes only its failed targets and explicitly carries the previous balance across the stale initial closure", async () => {
  const completedSummary = { publicationId: "publication-A", channelLinks: { site_web: "https://example.test/post" }, entries: [
    { channel: "site_web", label: "Site Web", ok: true, status: "published" },
    { channel: "gmb", label: "Google Business", ok: false, status: "failed", retryable: true },
    { channel: "tiktok", label: "TikTok", ok: true, status: "processing" },
  ] };
  const calls: any[] = [];
  const retry = evaluate(variable(modal, "retryFailed").getText(modal), {
    remainingRetryChannels: ["gmb"], completedSummary, latestPublicationSummaryRef: { current: completedSummary }, getPublicationDestinationStatus: destinationStatus, runPublish: async (request: unknown) => calls.push(request),
    preparedPostsByChannel: { gmb: { content: "Prepared content" } }, options: undefined, tiktokPublicationSettings: null,
    publicationResult: undefined,
  });
  await retry();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].channels, ["gmb"]);
  assert.equal(calls[0].retryPreviousSummary, completedSummary);
  assert.equal(calls[0].throwOnError, true);
  const runPublish = variable(modal, "runPublish");
  const destinationUpdate = find(runPublish, node => ts.isCallExpression(node) && node.expression.getText(modal) === "setPublicationDestinations") as ts.CallExpression;
  const update = evaluate(destinationUpdate.arguments[0].getText(modal), {
    publicationResult: undefined, options: calls[0], publishTargetChannels: ["gmb"],
    CHANNEL_LABELS: { gmb: "Google Business" }, getPublicationDestinationStatus: destinationStatus,
  });
  const destinations = completedSummary.entries.map(({ channel, label }) => ({ key: channel, label }));
  const next = update(destinations);
  assert.deepEqual(next.map((destination: any) => destination.key), ["site_web", "gmb", "tiktok"]);
  assert.deepEqual(next.map((destination: any) => destination.status), ["published", "pending", "pending"]);
});

test("a pending channel that later fails updates the footer and retries only the current retryable failure", async () => {
  const completedSummary = { publicationId: "publication-A", pendingCount: 1, entries: [
    { channel: "site_web", label: "Site Web", status: "published", ok: true },
    { channel: "tiktok", label: "TikTok", status: "processing", ok: true },
    { channel: "youtube_shorts", label: "YouTube", status: "failed", ok: false, retryable: false },
  ] };
  const latestPublicationSummaryRef = { current: completedSummary };
  const requests: any[] = [];
  const retry = evaluate(variable(modal, "retryFailed").getText(modal), {
    remainingRetryChannels: [], completedSummary, latestPublicationSummaryRef,
    getPublicationDestinationStatus: destinationStatus,
    runPublish: async (request: unknown) => requests.push(request),
    preparedPostsByChannel: {}, options: undefined, tiktokPublicationSettings: null,
  });
  assert.equal(typeof retry, "function", "a pending result retains a callback for a later confirmed failure");
  await retry();
  assert.equal(requests.length, 0, "pending and non-retryable channels are never resent");
  let livePublicationResult: any = null;
  const onSummaryChange = evaluate(variable(modal, "handlePublicationSummaryChange").getText(modal), {
    useCallback: (fn: unknown) => fn, latestPublicationSummaryRef,
    publicationResult: { summary: completedSummary },
    setLivePublicationResult: (update: any) => { livePublicationResult = update(livePublicationResult); },
  });
  const forwardingEffect = find(resultModal, node => ts.isCallExpression(node) && node.expression.getText(resultModal) === "useEffect" && Boolean(node.arguments[1]?.getText(resultModal).includes("onSummaryChange"))) as ts.CallExpression;
  const failed = { ...completedSummary, pendingCount: 0, retryableFailureCount: 1, entries: completedSummary.entries.map(entry => entry.channel === "tiktok" ? { ...entry, status: "failed", ok: false, retryable: true } : entry) };
  evaluate(forwardingEffect.arguments[0].getText(resultModal), { liveSummary: failed, summary: completedSummary, onSummaryChange })();
  assert.equal(latestPublicationSummaryRef.current, failed);
  const unchangedLiveResult = livePublicationResult;
  onSummaryChange(failed);
  assert.equal(livePublicationResult, unchangedLiveResult, "receiving the same summary must not create a render loop");
  const publicationSummaryForActions = evaluate(variable(modal, "publicationSummaryForActions").getText(modal), { livePublicationResult, publicationResult: { summary: completedSummary } });
  assert.equal(publicationSummaryForActions.retryableFailureCount, 1);
  assert.equal(evaluate(attribute(modal, "PublishExecutionResultActions", "summary").getText(modal), { publicationSummaryForActions }), failed);
  await retry();
  assert.deepEqual(requests.map(request => request.channels), [["tiktok"]]);
  assert.equal(requests[0].retryPreviousSummary, failed);
  evaluate(forwardingEffect.arguments[0].getText(resultModal), { liveSummary: { ...failed, publicationId: "older-publication" }, summary: completedSummary, onSummaryChange })();
  assert.equal(latestPublicationSummaryRef.current, failed, "an old effect cannot replace the latest operation");
});

test("retry summary replaces only retried channels and preserves successes, preflight failures, order and original pending provenance", () => {
  const previous = { publicationId: "publication-A", entries: [
    { channel: "site_web", label: "Site Web", ok: true, status: "published" },
    { channel: "gmb", label: "Google Business", ok: false, status: "failed", retryable: true },
    { channel: "tiktok", label: "TikTok", ok: true, status: "processing" },
    { channel: "youtube_shorts", label: "YouTube", ok: false, status: "failed", retryable: false, blockers: ["Vidéo obligatoire"] },
  ] };
  const merged = mergeRetrySummary(previous, { entries: [
    { channel: "gmb", label: "Google Business", ok: true, status: "published" },
    { channel: "site_web", label: "Site Web", ok: false, status: "failed" },
  ] }, "publication-B", ["gmb"]);
  assert.deepEqual(merged.entries.map((entry: any) => entry.channel), previous.entries.map(entry => entry.channel));
  assert.deepEqual(merged.entries.map((entry: any) => entry.status), ["published", "published", "processing", "failed"]);
  assert.deepEqual(merged.entries.map((entry: any) => entry.publicationId), ["publication-A", "publication-B", "publication-A", "publication-A"]);
  assert.equal(merged.successCount, 3);
  assert.equal(merged.pendingCount, 1);
  assert.equal(merged.failureCount, 1);
  assert.equal(merged.total, 4);
  assert.equal(merged.allFailed, false);
  assert.equal(merged.allSucceeded, false);
  assert.deepEqual(merged.entries[3].blockers, ["Vidéo obligatoire"]);
  assert.equal(previous.entries[1].status, "failed", "the prior balance must not be mutated");
  const missing = mergeRetrySummary(previous, { entries: [] }, "publication-B", ["gmb"]);
  assert.equal(missing.entries[1].status, "failed", "an absent retry result must not invent a success");
});

test("partial retry retains the existing account links and refreshes only the channels sent again", () => {
  const links = evaluate(variable(modal, "channelLinks").getText(modal), {
    options: { retryPreviousSummary: { channelLinks: { pinterest: "https://www.pinterest.fr/inrcy/", site_web: "https://example.test/post", gmb: "https://example.test/old-business" } } },
    publishableChannels: ["gmb"], channelDetails: { gmb: { href: "https://example.test/business" } },
    normalizeExternalHref: (value: unknown) => String(value || ""), recoveredPinterestHref: "",
  });
  assert.deepEqual(links, { pinterest: "https://www.pinterest.fr/inrcy/", site_web: "https://example.test/post", gmb: "https://example.test/business" });
});

test("a successful partial retry keeps all eleven original channels and recalculates a full successful balance", () => {
  const previous = { publicationId: "publication-A", entries: Array.from({ length: 11 }, (_, index) => ({
    channel: `channel-${index}`, label: `Canal ${index}`, ok: index !== 4, status: index === 4 ? "failed" : "published",
  })) };
  const merged = mergeRetrySummary(previous, { entries: [{ channel: "channel-4", label: "Canal 4", ok: true, status: "published" }] }, "publication-B", ["channel-4"]);
  assert.equal(merged.entries.length, 11);
  assert.equal(merged.successCount, 11);
  assert.equal(merged.failureCount, 0);
  assert.equal(merged.pendingCount, 0);
  assert.equal(merged.allSucceeded, true);
  assert.deepEqual(merged.failedChannels, []);
});

test("a result is terminal, a retry temporarily shows execution, and no result leaves editable navigation intact", () => {
  const state = (publicationResult: unknown, saving = false, scheduleSaving = false) => {
    const scope = { publicationResult, saving, scheduleSaving, wizardStep: "control", creationMode: "manual", connectedChannelsLoadState: "ready", selectedChannels: ["facebook"], showContentWorkspace: true, wizardBusy: saving || scheduleSaving, canOpenPublishWizardStep };
    return {
      step: evaluate(variable(modal, "activeWizardStep").getText(modal), scope),
      canOpen: evaluate(variable(modal, "canOpenWizardStep").getText(modal), scope),
    };
  };
  const result = state({ summary: { failureCount: 1 } });
  assert.equal(result.step, "results");
  for (const step of ["channels", "intention", "content", "media", "control"]) assert.equal(result.canOpen(step), false);
  assert.equal(state({ summary: {} }, true).step, "publication");
  assert.equal(state(undefined, false, true).step, "publication");
  assert.equal(state(undefined).step, "control");
  assert.equal(state(undefined).canOpen("content"), true);
});

test("the received result preserves failures, targeted retry and the publication id without closing Booster", () => {
  let stored: any;
  let open = false;
  const retry = async () => {};
  const retryRef = { current: null as unknown };
  const invalidated: string[] = [];
  const success = evaluate(attribute(layer, "PublishModal", "onPublishSuccess").getText(layer), {
    publishRetryFailedRef: retryRef, mergePreflightFailuresIntoPublicationSummary,
    invalidateModuleSnapshot: (key: string) => invalidated.push(key), MODULE_SNAPSHOT_KEYS: { inrSendDefault: "inrsend" },
    setPublishSummary: (value: unknown) => { stored = value; }, setPublishSuccessOpen: (value: boolean) => { open = value; },
    setPublishRetryError: () => {},
  });
  success({ publication_id: "publication-1", summary: { successCount: 1, entries: [{ channel: "facebook", label: "Facebook", ok: true, status: "published" }] },
    preflightFailedChannels: [{ channel: "youtube_shorts", label: "YouTube", blockers: ["Vidéo obligatoire"] }],
    retryFailed: retry, retryFailedChannels: ["gmb"], channelLinks: { facebook: "https://example.test/post" } });
  assert.equal(open, true);
  assert.equal(retryRef.current, retry);
  assert.equal(stored.publicationId, "publication-1");
  assert.equal(stored.retryableFailureCount, 1);
  assert.equal(stored.entries.length, 2);
  assert.equal(stored.entries.find((entry: any) => entry.channel === "youtube_shorts").status, "failed");
  assert.equal(stored.entries.find((entry: any) => entry.channel === "youtube_shorts").retryable, false);
  assert.deepEqual(invalidated, ["inrsend"]);
});

test("a failed retry keeps the previous result, exposes its error and releases the busy state", async () => {
  const busy: boolean[] = [];
  const errors: string[] = [];
  const props = resultProps({
    publishRetryFailedRef: { current: async () => { throw new Error("Connexion interrompue pendant la publication"); } },
    setPublishRetrying: (value: boolean) => busy.push(value),
    setPublishRetryError: (value: string) => errors.push(value),
    getSimpleFrenchErrorMessage: (error: Error) => error.message,
  });
  await assert.doesNotReject(props.onRetryFailed());
  assert.deepEqual(busy, [true, false]);
  assert.equal(errors[0], "");
  assert.match(errors.at(-1) || "", /Connexion interrompue/);
  assert.equal(props.summary.publicationId, "previous");
  let called = false;
  await resultProps({ publishRetrying: true, publishRetryFailedRef: { current: async () => { called = true; } } }).onRetryFailed();
  assert.equal(called, false);
});

test("closing the result clears Booster state and iNrSend navigation never invokes the dashboard reset", () => {
  const calls: unknown[] = [];
  const ref = { current: async () => {} } as { current: unknown };
  const scope = {
    setPublishSuccessOpen: (value: boolean) => calls.push(["open", value]),
    setPublishSummary: (value: unknown) => calls.push(["summary", value]),
    setPublishEditorOverlayOpen: (value: boolean) => calls.push(["overlay", value]),
    setPublishHasUnsavedChanges: (value: boolean) => calls.push(["dirty", value]),
    setPublishRetrying: (value: boolean) => calls.push(["retrying", value]),
    setPublishRetryError: (value: string) => calls.push(["retryError", value]),
    publishRetryFailedRef: ref, onClose: () => calls.push("close"),
    router: { push: (href: string) => calls.push(href) },
  };
  callback("closePublishModal", scope)();
  assert.equal(calls.at(-1), "close");
  assert.equal(ref.current, null);
  assert.ok(calls.some(value => JSON.stringify(value) === '["summary",null]'));
  calls.length = 0;
  resultProps(scope).onOpenInrSend();
  assert.equal(calls.at(-1), "/dashboard/mails?folder=publications");
  assert.ok(!calls.includes("close"));
});

test("a terminal result releases the unsaved guard while ordinary changed drafts remain protected", () => {
  const scope = {
    useMemo: (factory: () => unknown) => factory(), pdfFile: null,
    hasDraftablePublicationContent: true, currentPublicationDraftSnapshot: "changed",
    lastPublicationDraftSnapshot: "saved", publicationResult: undefined,
  };
  const expression = variable(modal, "hasUnsavedChanges").getText(modal);
  assert.equal(evaluate(expression, scope), true);
  assert.equal(evaluate(expression, { ...scope, publicationResult: { summary: { successCount: 1 } } }), false);
  assert.equal(evaluate(expression, { ...scope, currentPublicationDraftSnapshot: "saved" }), false);
});

test("switching drafts clears the terminal result only after accepting the unsaved-work prompt", async () => {
  const calls: unknown[] = [];
  const scope = {
    activePublishDraftId: "draft-old", publishHasUnsavedChanges: true,
    i18nT: (key: string) => key, searchParams: new URLSearchParams("action=publish&draftId=draft-old"),
    setPublishSuccessOpen: (value: boolean) => calls.push(["open", value]),
    setPublishSummary: (value: unknown) => calls.push(["summary", value]),
    router: { replace: (href: string) => calls.push(href) },
  };
  await callback("openPublishDraft", { ...scope, confirmInrcy: async () => false })("draft-new");
  assert.deepEqual(calls, []);
  await callback("openPublishDraft", { ...scope, confirmInrcy: async () => true })("draft-new");
  assert.deepEqual(calls, [["open", false], ["summary", null], "/dashboard?action=publish&draftId=draft-new"]);
});

test("scheduling keeps the existing close path and hands immediate channels back to the mounted publication flow", () => {
  const invoke = (request: unknown) => {
    const calls: unknown[] = [];
    evaluate(attribute(modal, "PublishScheduleModal", "onSuccess").getText(modal), {
      pendingImmediatePublishAfterSchedule: request,
      setScheduleModalOpen: (value: boolean) => calls.push(["schedule", value]),
      setPendingImmediatePublishAfterSchedule: (value: unknown) => calls.push(["pending", value]),
      publishImmediateChannelsAfterSchedule: (value: unknown) => calls.push(["immediate", value]),
      onClose: () => calls.push("close"),
    })();
    return calls;
  };
  assert.equal(invoke(null).at(-1), "close");
  const request = { immediateChannels: ["facebook"] };
  assert.deepEqual(invoke(request), [["schedule", false], ["pending", null], ["immediate", request]]);
});
