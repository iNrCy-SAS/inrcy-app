import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { INSTAGRAM_PUBLICATION_CAPABILITIES, canRemoveInstagramDraftLocally } from "../../lib/inrsend/instagramCapabilities.ts";
import { hasInstagramDeletionUnconfirmedAnnotation, isInstagramDeletionUnconfirmed, normalizeInstagramDeletionResult } from "../../lib/inrsend/instagramDeletionStatus.ts";

type Node = { type: unknown; props: Record<string, unknown> };
const text = readFileSync(new URL("../../app/dashboard/mails/_components/MailboxDetailsModal.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("MailboxDetailsModal.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const catalog = JSON.parse(readFileSync(new URL("../../messages/fr-FR/mails.json", import.meta.url), "utf8"));
const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function find<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T[] {
  const result: T[] = [];
  const visit = (node: ts.Node) => { if (predicate(node)) result.push(node); ts.forEachChild(node, visit); };
  visit(source); return result;
}
function declaration(name: string) {
  const result = find((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && node.name.getText(source) === name)[0];
  assert.ok(result?.initializer, name); return result.initializer.getText(source);
}
const action = find((node): node is ts.ConditionalExpression => ts.isConditionalExpression(node) && node.condition.getText(source) === "!isDraftItem && !isExternalVideoPublicationEntry")[0];
assert.ok(action, "the actual channel delete action must remain present");
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as Node; return [node, ...nodes(node.props?.children)];
}
function render({ channel = "instagram", result = {}, status = "published", deliveries, live }: { channel?: string; result?: Record<string, unknown>; status?: string; deliveries?: unknown; live?: unknown } = {}) {
  let requests = 0;
  const context = {
    activePublicationEntry: { key: channel }, activePublicationResult: result,
    detailsItem: { status, raw: {} }, payload: { results_delivery: deliveries }, publicationLiveStatus: live,
    exports: {}, INSTAGRAM_PUBLICATION_CAPABILITIES, canRemoveInstagramDraftLocally,
    isExternalVideoPublicationEntry: false, detailsActionBusy: false, detailsEditMode: false,
    styles: { btnDangerSmall: "danger-hover" }, instagramDeleteNoticeId: "instagram-delete-help",
    i18nT: (key: string) => catalog[key], deleteChannelPublicationAndSyncStatus: () => { requests += 1; },
  };
  const code = compile("const isDraftItem = " + declaration("isDraftItem") + "; const instagramLocalRemovalAllowed = " + declaration("instagramLocalRemovalAllowed") + "; const instagramPublishedDeleteUnavailable = " + declaration("instagramPublishedDeleteUnavailable") + "; return (" + action.getText(source) + ");");
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const tree = new Function("require", ...Object.keys(context), code)((id: string) => { assert.equal(id, "react/jsx-runtime"); return { jsx, jsxs: jsx }; }, ...Object.values(context));
  return { tree, button: nodes(tree).find(node => node.type === "button"), note: nodes(tree).find(node => node.props.role === "note"), requests: () => requests };
}

for (const authMode of ["instagram_login", "facebook_login"]) {
  test("actual delete control disables published Instagram through " + authMode + " and associates the visible explanation", () => {
    const view = render({ result: { ok: true, external_id: "180123456789", auth_mode: authMode } });
    assert.equal(view.button?.props.disabled, true);
    assert.equal(view.button?.props.onClick, undefined);
    assert.equal(view.button?.props.className, undefined, "the remote-unavailable action does not retain the hover-enabled delete class");
    assert.equal(view.button?.props["aria-describedby"], view.note?.props.id);
    assert.equal(view.note?.props.children, "Impossible de supprimer cette publication depuis l’application. Supprimez-la directement sur Instagram.");
    assert.equal(view.requests(), 0);
  });
}

test("local failed Instagram without a published media keeps its local removal action", () => {
  const view = render({ result: { ok: false, status: "failed", error: "upload_failed" }, status: "failed" });
  assert.equal(view.button?.props.disabled, false);
  assert.equal(typeof view.button?.props.onClick, "function");
  assert.equal(view.note, undefined);
  (view.button!.props.onClick as () => void)(); assert.equal(view.requests(), 1);
});

test("a draft does not acquire the published-channel delete restriction", () => {
  const view = render({ status: "draft", result: { status: "draft" } });
  assert.equal(view.tree, null, "draft removal remains handled by its existing local action");
  assert.equal(view.requests(), 0);
});

test("uncertain Instagram publication and a delivery proof block remote deletion despite a failed local result", () => {
  const uncertain = render({ result: { ok: false, status: "publish_unknown", requestMayHaveSucceeded: true } });
  assert.equal(uncertain.button?.props.disabled, true);
  for (const deliveries of [{ instagram: { status: "delivered" } }, [{ channel: "instagram", status: "published" }]]) {
    const delivered = render({ result: { ok: false, status: "failed" }, deliveries });
    assert.equal(delivered.button?.props.disabled, true);
  }
  const live = render({ result: { ok: false, status: "failed" }, live: { summary: { entries: [{ channel: "instagram", status: "published" }] } } });
  assert.equal(live.button?.props.disabled, true);
});

test("Threads and Facebook keep their own existing delete action", () => {
  for (const channel of ["threads", "facebook"]) {
    const view = render({ channel, result: { ok: true, external_id: "123" } });
    assert.equal(view.button?.props.disabled, false);
    assert.equal(view.note, undefined);
    (view.button!.props.onClick as () => void)(); assert.equal(view.requests(), 1);
  }
});


const phaseSource = ts.createSourceFile("mailboxPhase1.tsx", readFileSync(new URL("../../app/dashboard/mails/_lib/mailboxPhase1.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functionNames = ["isDeletedChannelResult", "isCancelledChannelResult", "isFailedChannelResult", "isWarningChannelResult", "isProcessingChannelResult", "getWarningChannelMessage", "getChannelIndicatorMeta"];
const functions = phaseSource.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && Boolean(node.name && functionNames.includes(node.name.text)));
assert.equal(functions.length, functionNames.length);
const classifierCode = compile(functions.map(fn => fn.getText(phaseSource)).join("\n") + "\nreturn {" + functionNames.join(",") + "};");
const classifiers = new Function("exports", "hasInstagramDeletionUnconfirmedAnnotation", "isInstagramDeletionUnconfirmed", "normalizeChannelKey", "styles", "getFrenchPublicationErrorMessage", classifierCode)({}, hasInstagramDeletionUnconfirmedAnnotation, isInstagramDeletionUnconfirmed, (channel: string) => channel, { channelWarningDot: "warning", channelDeletedDot: "deleted" }, (_channel: string, message: string) => message);
const statusFunction = find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "getPublicationStatusMeta")[0];
assert.ok(statusFunction);
const statusMeta = new Function("isInstagramDeletionUnconfirmed", "isCancelledChannelResult", "isDeletedChannelResult", "isFailedChannelResult", "isWarningChannelResult", "getTiktokStatusMeta", compile(statusFunction.getText(source) + "\nreturn getPublicationStatusMeta;"))(isInstagramDeletionUnconfirmed, classifiers.isCancelledChannelResult, classifiers.isDeletedChannelResult, classifiers.isFailedChannelResult, classifiers.isWarningChannelResult, () => ({}));

test("legacy unconfirmed Instagram deletion is a warning rather than deleted, failed or retryable", () => {
  const result = normalizeInstagramDeletionResult({ ok: false, status: "deleted", deleted: true, external_id: "180123456789", error: "remote_deletion_failed" });
  assert.equal(classifiers.isDeletedChannelResult(result), false);
  assert.equal(classifiers.isFailedChannelResult(result), false);
  assert.equal(classifiers.isProcessingChannelResult(result, "instagram"), false);
  assert.equal(classifiers.isWarningChannelResult(result, "instagram"), true);
  assert.equal(classifiers.getChannelIndicatorMeta(result, "instagram").kind, "warning");
  const meta = statusMeta("instagram", result, { ok: false, status: "deletion_unconfirmed" }, (key: string) => catalog[key]);
  assert.equal(meta.tone, "warning");
  assert.equal(meta.label, "Suppression non confirmée");
  assert.equal(meta.title, catalog.instagram_deletion_unconfirmed_help);
  const view = render({ result });
  assert.equal(view.button?.props.disabled, true);
  assert.equal(view.button?.props.onClick, undefined);
});

test("confirmed deletion and actual deleted results from other channels retain their deleted status", () => {
  const confirmed = { ok: true, deleted: true, status: "deleted", external_id: "180123456789", remoteDeletionConfirmed: true };
  assert.equal(classifiers.isDeletedChannelResult(confirmed), true);
  assert.equal(classifiers.getChannelIndicatorMeta(confirmed, "instagram").kind, "deleted");
  for (const channel of ["facebook", "threads", "site_web"]) {
    const deleted = { ok: true, deleted: true, status: "deleted", external_id: "123" };
    assert.equal(classifiers.isDeletedChannelResult(deleted), true);
    assert.equal(classifiers.getChannelIndicatorMeta(deleted, channel).kind, "deleted");
    assert.equal(statusMeta(channel, deleted, null, (key: string) => catalog[key]).tone, "muted");
  }
});


test("the actual mailbox list labels the Instagram warning as unconfirmed deletion", () => {
  const listSource = ts.createSourceFile("MailboxList.tsx", readFileSync(new URL("../../app/dashboard/mails/_components/MailboxList.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const functions = listSource.statements.filter((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && ["localizedIndicatorTitle", "renderLocalizedPublicationChannels"].includes(node.name?.text || ""));
  assert.equal(functions.length, 2);
  const code = compile(functions.map(fn => fn.getText(listSource)).join("\n") + "\nreturn renderLocalizedPublicationChannels;");
  const instagram = normalizeInstagramDeletionResult({ ok: false, deleted: true, status: "deleted", external_id: "180123456789" });
  const threads = { ok: true, deleted: true, status: "deleted", external_id: "123" };
  const entries = [{ key: "instagram", result: instagram, indicator: classifiers.getChannelIndicatorMeta(instagram, "instagram") }, { key: "threads", result: threads, indicator: classifiers.getChannelIndicatorMeta(threads, "threads") }];
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const renderList = new Function("exports", "require", "isInstagramDeletionUnconfirmed", "getPublicationChannelStatuses", "localizedChannelLabel", "styles", code)({}, () => ({ jsx, jsxs: jsx }), isInstagramDeletionUnconfirmed, () => entries, (channel: string) => channel, {});
  const tree = renderList({}, [], (key: string) => catalog[key]);
  const dots = nodes(tree).filter(node => node.props["aria-label"]);
  assert.equal(dots[0].props.title, "Suppression non confirmée");
  assert.equal(dots[0].props["aria-label"], "Suppression non confirmée");
  assert.equal(dots[1].props.title, catalog.publication_supprimee_sur_ce_canal_ea8177eb);
});
