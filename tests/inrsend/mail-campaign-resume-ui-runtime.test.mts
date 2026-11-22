import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { IntlMessageFormat } from "intl-messageformat";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMailCampaignReason, formatMailCampaignResumeTime, formatMailCampaignRetryResult } from "../../lib/mailCampaignUiFeedback.ts";
import { userFacingErrorsFixture } from "../helpers/user-facing-errors-fixture.mts";

type Data = Record<string, unknown>;
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const nativeRequire = createRequire(import.meta.url);
function translator(locale = "fr-FR") {
  const catalog = JSON.parse(readFileSync(new URL(`../../messages/${locale}/mails.json`, import.meta.url), "utf8"));
  return (key: string, values: { date: string } | undefined = undefined) => new IntlMessageFormat(catalog[key], locale).format(values) as string;
}
const source = ts.createSourceFile("MailboxClient.tsx", readFileSync(new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
function actualFunction(name: string, scope: Data) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(declaration, name);
  const code = ts.transpileModule(`return (${declaration.getText(source)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope)) as (id: string) => Promise<void>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function controller(options: { response?: Data; status?: number; networkFailure?: boolean; historyFailure?: boolean; transport?: Promise<unknown>; history?: Promise<unknown>; locale?: string } = {}) {
  const calls: Array<{ url: string; method: string; credentials?: string }> = [];
  const toasts: string[] = [], busy: unknown[] = [], reads: string[] = [], guards: Array<() => boolean> = [];
  const scopeRef = { current: { actorUserId: "actor-a", accountId: "account-a" } };
  const requestRef: { current: object | null } = { current: null };
  let browserAccountId = "account-a";
  const response = options.response || { success: true, campaignStatus: "queued", distributionState: "ready", resumed: true, queuedForBackgroundDispatch: true };
  const scope = {
    campaignActionScopeRef: scopeRef, campaignActionRequestRef: requestRef,
    getActiveBrowserUserId: () => browserAccountId,
    setCampaignActionBusyId: (value: unknown) => busy.push(value),
    setToast: (value: string) => toasts.push(value),
    getClientUserFacingErrorMessage: userFacingErrorsFixture.getClientUserFacingErrorMessage,
    formatMailCampaignReason, formatMailCampaignRetryResult,
    i18nT: translator(options.locale), locale: options.locale || "fr-FR",
    fetch: async (url: string, init: { method: string; credentials?: string }) => {
      calls.push({ url, method: init.method, credentials: init.credentials });
      if (options.transport) await options.transport;
      if (options.networkFailure) throw new Error("PRIVATE_GRAPH_TOKEN SQL auth.example.test");
      const status = options.status || 200;
      return { ok: status < 400, status, json: async () => response };
    },
    loadHistory: async () => { reads.push("history"); if (options.history) await options.history; if (options.historyFailure) throw new Error("PRIVATE_SQL"); },
    detailsOpen: true, detailsId: "campaign-a", detailsItem: { raw: {} }, campaignRecipientsFilter: "all",
    loadCampaignRecipients: async (_id: string, _page: number, _filter: string, guard: () => boolean) => { reads.push("recipients"); guards.push(guard); },
    loadCampaignHealth: async (_id: string, _raw: unknown, guard: () => boolean) => { reads.push("health"); guards.push(guard); },
  };
  return { run: actualFunction("retryCampaignFailedRecipients", scope), calls, toasts, busy, reads, guards, scopeRef, requestRef,
    changeAccount: (account: string) => { browserAccountId = account; scopeRef.current.accountId = account; },
    changeBrowserOnly: (account: string) => { browserAccountId = account; },
  };
}

test("all nine locales explain the recorded mailbox protection without exposing raw diagnostics", () => {
  for (const locale of locales) {
    const t = translator(locale);
    const message = formatMailCampaignReason({ status: "paused", pause_reason: "mailbox_reputation_paused", last_error: "PRIVATE_TOKEN Bearer abc SQL failed", resume_at: "2030-11-18T21:12:18Z" }, t, locale);
    assert.ok(message.includes(t("campaign_pause_mailbox_protection")), locale);
    assert.doesNotMatch(message, /PRIVATE|Bearer|SQL|mailbox_reputation_paused|mail_action_failed/);
    assert.notEqual(message, t("mail_action_failed"));
    assert.ok(message.includes(new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date("2030-11-18T21:12:18Z"))), locale);
  }
});

test("the actual detail error JSX renders safe campaign guidance instead of the generic failure", () => {
  const modal = ts.createSourceFile("MailboxDetailsModal.tsx", readFileSync(new URL("../../app/dashboard/mails/_components/MailboxDetailsModal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let reason: ts.VariableDeclaration | undefined, error: ts.JsxExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(modal) === "campaignBusinessReason") reason = node;
    if (ts.isJsxExpression(node) && node.expression?.getText(modal).startsWith("(detailsItem.error || campaignBusinessReason)")) error = node;
    ts.forEachChild(node, visit);
  };
  visit(modal); assert.ok(reason?.initializer); assert.ok(error?.expression);
  const code = ts.transpileModule(`const campaignBusinessReason = ${reason.initializer.getText(modal)}; const rendered = (${error.expression.getText(modal)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const locale of locales) {
    const i18nT = translator(locale);
    const detailsItem = { source: "mail_campaigns", error: "PRIVATE_SQL_TABLE Bearer secret", raw: { status: "paused", pause_reason: "mailbox_reputation_paused", last_error: "PRIVATE_SQL_TABLE Bearer secret" } };
    const scope = { detailsItem, i18nT, locale, formatMailCampaignReason, activeInstagramDeletionUnconfirmed: false, visiblePublicationItemError: "", styles: { detailsError: "detailsError" } };
    const element = new Function("exports", "require", ...Object.keys(scope), `${code}\nreturn rendered;`)({}, nativeRequire, ...Object.values(scope));
    const html = renderToStaticMarkup(element);
    assert.ok(html.includes(i18nT("campaign_pause_mailbox_protection")), locale);
    assert.equal(html.includes(i18nT("mail_action_failed")), false, locale);
    assert.doesNotMatch(html, /PRIVATE_SQL_TABLE|Bearer|secret|mailbox_reputation_paused/);
  }
});

test("unknown reasons and invalid or expired dates never reveal SQL or promise an automatic restart", () => {
  const t = translator();
  const input = { status: "paused", reasonCode: "SQL PRIVATE_TOKEN", deferredReason: "Bearer secret", resumeAt: "not-a-date PRIVATE" };
  assert.equal(formatMailCampaignReason(input, t, "fr-FR"), t("campaign_pause_generic"));
  assert.equal(formatMailCampaignReason({ last_error: "SQL PRIVATE_TOKEN" }, t, "fr-FR"), "");
  assert.equal(formatMailCampaignResumeTime({ resumeAt: "2000-01-01" }, t, "fr-FR"), "");
  assert.equal(formatMailCampaignReason({ failure_kind: "account_blocked" }, t, "fr-FR"), t("campaign_pause_account_blocked"));
});

test("each locale explains Outlook message pacing and uses the generic pause for a temporary service error", () => {
  for (const locale of locales) {
    const t = translator(locale);
    assert.equal(formatMailCampaignReason({ pause_reason: "outlook_transfer_budget" }, t, locale), t("campaign_pause_outlook_weight"));
    assert.equal(formatMailCampaignReason({ pause_reason: "outlook_transfer_unavailable" }, t, locale), t("campaign_pause_generic"));
  }
});

test("the actual paused header and expired resume row promise neither automatic sending nor a defective mailbox", () => {
  const modal = ts.createSourceFile("MailboxDetailsModal.tsx", readFileSync(new URL("../../app/dashboard/mails/_components/MailboxDetailsModal.tsx", import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let header: ts.FunctionDeclaration | undefined, row: ts.JsxExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "localizedOutboxStatus") header = node;
    if (ts.isJsxExpression(node) && node.expression?.getText(modal).startsWith("formatMailCampaignResumeTime(detailsItem.raw")) row = node;
    ts.forEachChild(node, visit);
  };
  visit(modal); assert.ok(header); assert.ok(row?.expression);
  const t = translator();
  const scope = { formatMailCampaignResumeTime, localizedCampaignProgress: () => "20/216", detailsItem: { source: "mail_campaigns", raw: { status: "paused", resume_at: "2000-01-01T00:00:00Z" } }, i18nT: t, locale: "fr-FR" };
  const code = ts.transpileModule(`${header.getText(modal)}\nreturn { header: localizedOutboxStatus(detailsItem, locale, i18nT), row: (${row.expression.getText(modal)}) };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const rendered = new Function(...Object.keys(scope), code)(...Object.values(scope));
  assert.equal(rendered.row, t("rafraichir_le_suivi_02fcaec9"));
  assert.match(rendered.header, /Campagne en pause/);
  assert.doesNotMatch(`${rendered.header} ${rendered.row}`, /automatique|correction de la boîte|2000/);
  scope.detailsItem.raw.resume_at = "2030-11-18T21:12:18Z";
  const future = new Function(...Object.keys(scope), code)(...Object.values(scope));
  assert.match(future.header, /Nouvelle vérification possible/);
  assert.doesNotMatch(`${future.header} ${future.row}`, /automatique|correction de la boîte/);
});

test("paused and waiting responses never claim the campaign has resumed or been queued", async () => {
  for (const response of [
    { success: true, resumed: false, campaignStatus: "paused", distributionState: "paused", pauseReason: "mailbox_reputation_paused", queuedForBackgroundDispatch: false },
    { success: true, resumed: false, campaignStatus: "failed", distributionState: "waiting_turn", reasonCode: "waiting_turn", queuedForBackgroundDispatch: false },
    { success: true, resumed: false, campaignStatus: "paused", distributionState: "paused", reasonCode: "provider_quota", queuedForBackgroundDispatch: false },
  ]) {
    const h = controller({ response });
    await h.run("campaign-a");
    assert.equal(h.calls.length, 1);
    assert.doesNotMatch(h.toasts.join(" "), /La campagne a repris|replacée dans la file|PRIVATE/);
    assert.equal(h.busy.at(-1), null);
  }
});

test("a confirmed queue response reports queued and preserves that truth if history refresh fails", async () => {
  for (const historyFailure of [false, true]) {
    const h = controller({ historyFailure });
    await h.run("campaign-a");
    assert.deepEqual(h.toasts, [translator()("campaign_requeued")]);
    assert.equal(h.calls[0].credentials, "include");
    assert.deepEqual(h.busy, ["campaign-a", null]);
  }
});

test("network errors are caught, visible, and never automatically retried", async () => {
  const h = controller({ networkFailure: true });
  await h.run("campaign-a");
  assert.deepEqual(h.toasts, [translator()("campaign_resume_network_error")]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.busy, ["campaign-a", null]);
});

test("structured reconnect errors show safe business guidance and raw server errors stay private", async () => {
  const reconnect = controller({ status: 409, response: { code: "mailbox_reconnect_required", error: "PRIVATE_GRAPH_TOKEN" } });
  await reconnect.run("campaign-a");
  assert.deepEqual(reconnect.toasts, [translator()("campaign_pause_reconnect")]);
  const missing = controller({ status: 409, response: { code: "mailbox_missing", error: "PRIVATE_INTEGRATION_ID" } });
  await missing.run("campaign-a");
  assert.deepEqual(missing.toasts, [translator()("campaign_pause_mailbox_missing")]);
  assert.doesNotMatch(missing.toasts[0], /Reconnectez|réutiliser|nouvelle campagne|PRIVATE/);
  const unknown = controller({ status: 500, response: { code: "campaign_resume_unavailable", error: "SQL PRIVATE_TOKEN", message: "Bearer secret" } });
  await unknown.run("campaign-a");
  assert.equal(unknown.toasts.length, 1);
  assert.doesNotMatch(unknown.toasts[0], /PRIVATE|SQL|Bearer|campaign_resume_unavailable/);
});

test("duplicate clicks share one request and a stale account or actor gets no delayed updates", async () => {
  for (const change of ["account", "actor"]) {
    const gate = deferred<void>();
    const h = controller({ transport: gate.promise });
    const pending = h.run("campaign-a");
    await h.run("campaign-a");
    assert.equal(h.calls.length, 1);
    if (change === "account") h.changeAccount("account-b");
    else h.scopeRef.current.actorUserId = "actor-b";
    gate.resolve(); await pending;
    assert.deepEqual(h.toasts, []);
    assert.deepEqual(h.reads, []);
    assert.deepEqual(h.busy, ["campaign-a"]);
  }
});

test("an already switched browser refuses dispatch and a switch during refresh refuses detail reads", async () => {
  const stale = controller(); stale.changeBrowserOnly("account-b"); await stale.run("campaign-a");
  assert.deepEqual(stale.calls, []);
  const gate = deferred<void>();
  const h = controller({ history: gate.promise });
  const pending = h.run("campaign-a");
  await new Promise(setImmediate);
  assert.deepEqual(h.reads, ["history"]);
  h.changeAccount("account-b"); gate.resolve(); await pending;
  assert.deepEqual(h.reads, ["history"]);
});

test("detail refresh callbacks receive the same live scope guard", async () => {
  const h = controller(); await h.run("campaign-a");
  assert.equal(h.guards.length, 2);
  assert.equal(h.guards.every(guard => guard()), true);
  h.changeAccount("account-b");
  assert.equal(h.guards.every(guard => !guard()), true);
});
