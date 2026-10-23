/* eslint-disable @typescript-eslint/no-explicit-any -- the TSX module is rendered through isolated framework adapters */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const messages = JSON.parse(read("messages/fr-FR/booster.json")) as Record<string, string>;
const load = (path: string, dependencies: Record<string, any>, globals: Record<string, unknown> = {}) => {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(read(path), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const require = (name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return nodeRequire(name);
    throw new Error(`Unexpected renderer dependency: ${name}`);
  };
  new Function("require", "exports", ...Object.keys(globals), code)(require, exports, ...Object.values(globals));
  return exports;
};
const wizard = {
  __esModule: true,
  default: ({ children, footer }: any) => createElement("div", { "data-publish-wizard": true }, children, createElement("footer", null, footer)),
  PublishWizardScreen: ({ children }: any) => createElement("section", { "data-wizard-screen": "results" }, children),
};
const resultDependencies = {
  "./DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: true }) },
  "@/lib/metaChannelUiAccess": { isMetaPilotChannelVisible: () => true },
  "next-intl": { useTranslations: () => (key: string, values: Record<string, unknown> = {}) => (messages[key] || key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? "")) },
  "../booster/publier/components/PublishWizardFrame": wizard,
  "@/lib/publicationErrorFrench": load("lib/publicationErrorFrench.ts", {}),
  "@/lib/boosterPublicationStatus": load("lib/boosterPublicationStatus.ts", {}),
  "./PublishExecutionResultModal.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
};
const resultModule = load("app/dashboard/_components/PublishExecutionResultModal.tsx", resultDependencies);
const Component = resultModule.default;
const Actions = resultModule.PublishExecutionResultActions;

const render = (summary: Record<string, unknown> | null, options: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Component, {
  styles: {}, summary, onClose() {}, onOpenInrSend() {}, ...options,
}));

test("result renders real published channels, their logos and external destination without duplicating the CTA", () => {
  const html = render({ successCount: 1, entries: [{ channel: "facebook", label: "Facebook", ok: true, status: "published" }], channelLinks: { facebook: "https://www.facebook.com/example/posts/1" } }, { wizardSteps: ["channels", "content", "publication"] });
  assert.match(html, /Votre publication est en ligne/);
  assert.match(html, /data-result-tone="published"/);
  assert.match(html, /src="\/icons\/facebook.png"/);
  assert.match(html, /Facebook — Publié/);
  assert.match(html, /href="https:\/\/www.facebook.com\/example\/posts\/1" target="_blank" rel="noopener noreferrer"/);
  assert.equal((html.match(/class="inrSendButton"/g) || []).length, 1);
  assert.match(html, /<footer>.*class="inrSendButton"/);
});

test("pending jobs with ok=true are never rendered as published", () => {
  const html = render({ successCount: 1, pendingCount: 1, entries: [{ channel: "tiktok", label: "TikTok", ok: true, status: "processing", warning_kind: "pending" }] });
  assert.match(html, /Publication en cours/);
  assert.match(html, /data-result-tone="pending"/);
  assert.match(html, /TikTok — En attente/);
  assert.match(html, /Suivi en direct/);
  assert.doesNotMatch(html, /Votre publication est en ligne|TikTok — Publié|Tout est en ligne/);
});

test("mixed outcomes preserve each status, expandable failure details and the targeted retry action", () => {
  const html = render({ successCount: 2, pendingCount: 1, failureCount: 1, retryableFailureCount: 1, entries: [
    { channel: "facebook", label: "Facebook", ok: true, status: "published" },
    { channel: "tiktok", label: "TikTok", ok: true, status: "queued" },
    { channel: "gmb", label: "Google Business", ok: false, status: "failed", error: "Une erreur empêche la publication." },
  ] }, { onRetryFailed() {}, retrying: true });
  assert.match(html, /Publication avec résultats mixtes/);
  assert.match(html, /Facebook — Publié/);
  assert.match(html, /TikTok — En attente/);
  assert.match(html, /Google Business — Échec/);
  assert.match(html, /aria-expanded="false" aria-controls=/);
  assert.match(html, /class="retryButton" disabled="" aria-busy="true"/);
  assert.doesNotMatch(html, /Tout est en ligne/);
});

test("failed, skipped and warning outcomes remain distinct and an absent summary never announces success", () => {
  const failed = render({ allFailed: true, failureCount: 1, entries: [{ channel: "x", label: "X", status: "failed", ok: false }] });
  assert.match(failed, /Publication échouée/);
  assert.match(failed, /data-result-tone="failed"/);
  assert.doesNotMatch(failed, /Votre publication est en ligne/);
  const skipped = render({ skippedCount: 1, entries: [{ channel: "youtube", label: "YouTube", status: "skipped", ok: false, blockers: ["Vidéo obligatoire"] }] });
  assert.match(skipped, /Non envoyé/);
  assert.match(skipped, /YouTube — Ignoré avant envoi/);
  assert.match(skipped, /Vidéo obligatoire/);
  const warning = render({ successCount: 1, warningCount: 1, entries: [{ channel: "pinterest", label: "Pinterest", status: "published_with_warning", ok: true, warning_message: "Un média n’a pas été publié." }] });
  assert.match(warning, /Publication publiée avec avertissement/);
  assert.match(warning, /Publié avec avertissement/);
  assert.doesNotMatch(warning, /Tout est en ligne/);
  const empty = render(null);
  assert.match(empty, /Bilan de publication/);
  assert.doesNotMatch(empty, /avec succès|Votre publication est en ligne|Tout est en ligne/);
});

test("embedded results render the balance once without creating another dialog, wizard or action bar", () => {
  const html = render({ successCount: 1, retryableFailureCount: 1, entries: [
    { channel: "site_web", label: "Site Web", ok: true, status: "published" },
  ] }, { embedded: true, wizardSteps: ["channels", "content", "results"], onRetryFailed() {} });
  assert.match(html, /class="resultBody" data-result-tone="published"/);
  assert.equal((html.match(/Votre publication est en ligne/g) || []).length, 1);
  assert.match(html, /Site Web — Publié/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal=|data-publish-wizard|data-wizard-screen|publish-result-close/);
  assert.doesNotMatch(html, /class="(?:overlay|shell|scrollSurface|standaloneFooter|inrSendButton|retryButton)"|data-publish-result-actions/);
  assert.doesNotMatch(html, /BOOSTER|🚀|Tout est en ligne/);
});

test("exported result actions preserve retry eligibility, busy state and the iNrSend callback", () => {
  const renderActions = (options: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Actions, {
    summary: { retryableFailureCount: 2 }, onOpenInrSend() {}, onRetryFailed() {}, ...options,
  }));
  const ready = renderActions();
  assert.equal((ready.match(/class="inrSendButton"/g) || []).length, 1);
  assert.match(ready, /Retenter 2 canaux en échec/);
  assert.doesNotMatch(ready, /disabled=""/);
  assert.match(renderActions({ retrying: true }), /class="retryButton" disabled="" aria-busy="true"/);
  assert.doesNotMatch(renderActions({ summary: { retryableFailureCount: 0 } }), /class="retryButton"/);
  assert.doesNotMatch(renderActions({ onRetryFailed: undefined }), /class="retryButton"/);
  let retries = 0;
  let navigations = 0;
  const actions = Actions({
    summary: { retryableFailureCount: 1 },
    onRetryFailed: () => { retries += 1; },
    onOpenInrSend: () => { navigations += 1; },
  });
  const buttons = actions.props.children.filter(Boolean);
  buttons.find((button: any) => button.props.className === "retryButton").props.onClick();
  buttons.find((button: any) => button.props.className === "inrSendButton").props.onClick();
  assert.equal(retries, 1);
  assert.equal(navigations, 1);
});

test("mounting an embedded completed result never takes focus or changes document scrolling", () => {
  const effects: Array<() => void | (() => void)> = [];
  const forbidDocumentAccess = new Proxy({}, { get: (_, key) => assert.fail(`Embedded result accessed document.${String(key)}`) });
  const IsolatedResult = load("app/dashboard/_components/PublishExecutionResultModal.tsx", {
    ...resultDependencies,
    react: { ...nodeRequire("react"), useEffect: (effect: () => void | (() => void)) => effects.push(effect) },
  }, {
    document: forbidDocumentAccess,
    window: new Proxy({}, { get: (_, key) => assert.fail(`Embedded result accessed window.${String(key)}`) }),
    fetch: () => assert.fail("Completed results do not need polling"),
  }).default;
  renderToStaticMarkup(createElement(IsolatedResult, {
    styles: {}, embedded: true, summary: { successCount: 1, entries: [
      { channel: "site_web", label: "Site Web", ok: true, status: "published" },
    ] }, onClose() {}, onOpenInrSend() {},
  }));
  assert.ok(effects.length > 0, "the component must register its real effects");
  for (const effect of effects) effect()?.();
});

test("standalone results retain their scroll lock and restore prior focus on unmount", () => {
  const effects: Array<() => void | (() => void)> = [];
  const focusCalls: unknown[] = [];
  class Focusable {
    isConnected = true;
    focus(options: unknown) { focusCalls.push(options); }
  }
  const document = {
    activeElement: new Focusable(),
    documentElement: { style: { overflow: "auto" } },
    body: { style: { overflow: "scroll" } },
  };
  const IsolatedResult = load("app/dashboard/_components/PublishExecutionResultModal.tsx", {
    ...resultDependencies,
    react: { ...nodeRequire("react"), useEffect: (effect: () => void | (() => void)) => effects.push(effect) },
  }, { document, HTMLElement: Focusable }).default;
  renderToStaticMarkup(createElement(IsolatedResult, { styles: {}, summary: null, onClose() {}, onOpenInrSend() {} }));
  const cleanups = effects.map((effect) => effect());
  assert.equal(document.documentElement.style.overflow, "hidden");
  assert.equal(document.body.style.overflow, "hidden");
  for (const cleanup of cleanups.reverse()) cleanup?.();
  assert.equal(document.documentElement.style.overflow, "auto");
  assert.equal(document.body.style.overflow, "scroll");
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
});
