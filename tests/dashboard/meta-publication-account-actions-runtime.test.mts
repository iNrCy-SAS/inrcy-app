import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";
import { userFacingErrorsFixture as errors } from "../helpers/user-facing-errors-fixture.mts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { getProviderPublicationErrorMessage } from "../../lib/publicationErrorFrench.ts";
import { isRetryablePublicationEntry, publicationEntryRequiresAccountAction } from "../../lib/publicationStorySequenceRetry.ts";
import { isBoosterPublicationPendingStatus } from "../../lib/boosterPublicationStatus.ts";

const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const parse = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const modal = parse("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
const result = parse("app/dashboard/_components/PublishExecutionResultModal.tsx");
const require = createRequire(import.meta.url);
function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); };
  visit(source); assert.ok(found, "Required production expression"); return found;
}
function variable(source: ts.SourceFile, name: string) {
  const declaration = find(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === name);
  assert.ok(ts.isVariableDeclaration(declaration) && declaration.initializer);
  return declaration.initializer.getText(source);
}
function evaluate<T>(expression: string, scope: Record<string, unknown>): T {
  const code = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function("require", "exports", ...Object.keys(scope), `${code}\nreturn value;`)(require, {}, ...Object.values(scope));
}
const facebook = { ok: false, code: "meta_placements_failed", placements: { classic: {
  ok: false, code: "facebook_publish_failed", error: "Confirmez votre identité avant de pouvoir publier au nom de cette Page. Ouvrez Facebook sur votre mobile.",
} } };
const instagram = { ok: false, code: "meta_placements_failed", placements: { classic: {
  ok: false, code: "instagram_publish_failed", error: "PRIVATE_PROVIDER_ACCESS_TOKEN Bearer secret",
  diagnostics: { createResponse: { error: { message: "PRIVATE_PROVIDER_RESPONSE", type: "OAuthException", code: 25, error_subcode: 2207050, fbtrace_id: "PRIVATE_TRACE" } } },
} } };
const privatePattern = /PRIVATE|Bearer|secret|OAuthException|2207050|fbtrace_id|meta_placements_failed|instagram_publish_failed|facebook_publish_failed/;

test("MPS historical aggregate payloads display distinct safe account actions in all nine languages", () => {
  const outputs = locales.map(locale => {
    const fb = errors.getLocalizedErrorMessage({ ...facebook, channel: "facebook" }, locale, "fallback", { allowUnknownMessage: false });
    const ig = errors.getLocalizedErrorMessage({ ...instagram, channel: "instagram" }, locale, "fallback", { allowUnknownMessage: false });
    assert.notEqual(fb, ig); assert.notEqual(fb, "fallback"); assert.notEqual(ig, "fallback");
    assert.doesNotMatch(`${fb} ${ig}`, privatePattern);
    assert.equal(errors.getLocalizedErrorMessage({ code: "facebook_identity_confirmation_required" }, locale), fb);
    assert.equal(errors.getLocalizedErrorMessage({ code: "instagram_account_restricted" }, locale), ig);
    return `${fb}|${ig}`;
  });
  assert.equal(new Set(outputs).size, 9);
  assert.match(outputs[0], /Facebook.*mobile.*profil.*Page.*vérification/);
  assert.match(outputs[0], /Instagram.*inactif.*vérification de sécurité.*application Instagram.*connectez-vous.*actions demandées.*Statut du compte/);
  assert.doesNotMatch(outputs[0], /reconnect|quelques minutes/i);
  assert.match(getProviderPublicationErrorMessage("facebook", facebook) || "", /confirmation d’identité/);
  assert.match(getProviderPublicationErrorMessage("instagram", instagram) || "", /Statut du compte/);
});

test("the actual historical error JSX renders the nested restriction instead of a generic diagnostic", () => {
  const expression = find(modal, node => ts.isJsxExpression(node) && Boolean(node.expression?.getText(modal).startsWith('detailsItem.source === "app_events" && activePublicationFailed && activePublicationFailureMessage')));
  assert.ok(ts.isJsxExpression(expression) && expression.expression);
  for (const locale of locales) for (const [channel, activePublicationResult] of Object.entries({ facebook, instagram })) {
    const catalog = JSON.parse(read(`messages/${locale}/mails.json`));
    const i18nT = (key: string) => { assert.equal(typeof catalog[key], "string", key); return new IntlMessageFormat(catalog[key], locale).format() as string; };
    const scope = { activePublicationFailed: true, activePublicationResult, activePublicationEntry: { key: channel }, i18nT,
      getSafeClientErrorMessage: (input: unknown, fallback: string, options: { allowUnknownMessage?: boolean }) => errors.getLocalizedErrorMessage(input, locale, fallback, options),
      detailsItem: { source: "app_events" }, styles: { detailsError: "detailsError" } };
    const activePublicationFailureMessage = evaluate<string>(variable(modal, "activePublicationFailureMessage"), scope);
    const html = renderToStaticMarkup(evaluate<Parameters<typeof renderToStaticMarkup>[0]>(expression.expression.getText(modal), { ...scope, activePublicationFailureMessage }));
    assert.ok(html.includes(activePublicationFailureMessage), `${locale}/${channel}`);
    assert.doesNotMatch(html, privatePattern);
    assert.notEqual(activePublicationFailureMessage, i18nT("la_publication_n_a_pas_abouti_9368e2ed"));
  }
});

test("manual retry requires confirmation, cancellation sends nothing, and a double click invokes one callback", async () => {
  for (const confirmed of [false, true]) {
    let callbacks = 0, confirmations = 0;
    let answer!: (value: boolean) => void;
    const confirm = new Promise<boolean>(resolve => { answer = resolve; });
    const retryInFlightRef = { current: false };
    const requestRetry = evaluate<() => Promise<void>>(variable(result, "requestRetry"), {
      retrying: false, retryInFlightRef, requiresAccountAction: true, i18nT: (key: string) => key,
      confirmInrcy: async () => { confirmations++; return confirm; }, onRetryFailed: async () => { callbacks++; },
    });
    const first = requestRetry(); await requestRetry();
    assert.equal(callbacks, 0); assert.equal(confirmations, 1);
    answer(confirmed); await first;
    assert.equal(callbacks, confirmed ? 1 : 0); assert.equal(retryInFlightRef.current, false);
  }
});

test("only known failed account actions can override automatic nonretryability, preserving successful placements", () => {
  const failed = { channel: "facebook", targetKey: "facebook:story", placement: "story", label: "Facebook", status: "failed", ok: false, retryable: false, code: "facebook_identity_confirmation_required" };
  const successful = { ...failed, targetKey: "facebook:classic", placement: "classic", status: "published", ok: true };
  assert.equal(publicationEntryRequiresAccountAction(failed), true);
  assert.equal(isRetryablePublicationEntry(failed), true);
  for (const entry of [successful, { ...failed, status: "processing" }, { ...failed, warning_kind: "pending" }, { ...failed, code: "unsupported_media_type" }, { ...failed, code: "unknown_provider_failure" }]) {
    assert.equal(isRetryablePublicationEntry(entry), false);
  }
  const progress = parse("app/dashboard/_components/PublishExecutionProgress.tsx");
  const fn = find(progress, node => ts.isFunctionDeclaration(node) && node.name?.text === "getPublicationDestinationStatus");
  const getPublicationDestinationStatus = evaluate<(value: unknown) => string>(fn.getText(progress).replace(/^export /, ""), { isBoosterPublicationPendingStatus });
  const payload = runtimeModules({ "../../_components/PublishExecutionProgress": { getPublicationDestinationStatus } })<typeof import("../../app/dashboard/booster/publier/publicationSubmissionPayload.ts")>("app/dashboard/booster/publier/publicationSubmissionPayload.ts");
  const previous = { publicationId: "original", entries: [successful, failed] };
  assert.deepEqual(payload.getRetryPublicationTargets(previous, ["facebook"]), [{ key: "facebook:story", channel: "facebook", placement: "story" }]);
  const merged = payload.mergeRetriedPublicationSummary(previous, { entries: [{ ...failed, ok: true, status: "published", code: undefined }] }, "retry", ["facebook"]);
  assert.equal(merged.total, 2); assert.equal(merged.successCount, 2);
  assert.equal(merged.entries.find(entry => entry.placement === "classic")?.publicationId, "original");
  assert.equal(merged.entries.find(entry => entry.placement === "story")?.publicationId, "retry");
});
