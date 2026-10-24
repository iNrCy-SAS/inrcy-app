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
const cssModule = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
const intl = { useTranslations: () => (key: string, values: Record<string, unknown> = {}) => (messages[key] || key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? "")) };
const resultDependencies = {
  "./DashboardViewerAccessProvider": { useDashboardViewerAccess: () => ({ metaPilotEnabled: true }) },
  "@/lib/metaChannelUiAccess": { isMetaPilotChannelVisible: () => true },
  "next-intl": intl,
  "../booster/publier/components/PublishWizardFrame": wizard,
  "@/lib/publicationErrorFrench": load("lib/publicationErrorFrench.ts", {}),
  "@/lib/boosterPublicationStatus": load("lib/boosterPublicationStatus.ts", {}),
  "./PublishExecutionResultModal.module.css": cssModule,
  "./PublishExecutionProgress.module.css": cssModule,
  "./PublishExecutionProgress": load("app/dashboard/_components/PublishExecutionProgress.tsx", {
    "next-intl": intl, "./PublishExecutionProgress.module.css": cssModule,
    "@/lib/boosterPublicationStatus": load("lib/boosterPublicationStatus.ts", {}),
  }),
};
const resultModule = load("app/dashboard/_components/PublishExecutionResultModal.tsx", resultDependencies);
const Component = resultModule.default;
const Actions = resultModule.PublishExecutionResultActions;

const render = (summary: Record<string, unknown> | null, options: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Component, {
  styles: {}, summary, onClose() {}, onOpenInrSend() {}, ...options,
}));
const renderCompactActions = (summary: Record<string, unknown> | null, publicationDestinations: Array<{ key: string; label: string }> = []) => renderToStaticMarkup(createElement(Actions, {
  summary, publicationDestinations, compact: true, onRetryFailed() {}, onOpenInrSend() {},
}));

test("result renders real published channels, their logos and external destination without duplicating the CTA", () => {
  const html = render({ successCount: 1, entries: [{ channel: "facebook", label: "Facebook", ok: true, status: "published" }], channelLinks: { facebook: "https://www.facebook.com/example/posts/1" } }, { wizardSteps: ["channels", "content", "publication"] });
  assert.match(html, /1 publication en ligne/);
  assert.match(html, /data-result-tone="published"/);
  assert.match(html, /src="\/icons\/facebook.png"/);
  assert.match(html, /Facebook — Publié/);
  assert.match(html, /href="https:\/\/www.facebook.com\/example\/posts\/1" target="_blank" rel="noopener noreferrer"/);
  assert.equal((html.match(/class="inrSendButton"/g) || []).length, 1);
  assert.match(html, /<footer>.*class="inrSendButton"/);
});

test("pending jobs with ok=true are never rendered as published", () => {
  const html = render({ successCount: 1, pendingCount: 1, entries: [{ channel: "tiktok", label: "TikTok", ok: true, status: "processing", warning_kind: "pending" }] });
  assert.match(html, /Bilan de publication/);
  assert.match(html, /data-result-tone="pending"/);
  assert.match(html, /TikTok — En attente/);
  assert.match(html, /Suivi en direct/);
  assert.doesNotMatch(html, /publication[s]? en ligne|TikTok — Publié|Tout est en ligne/);
});

test("mixed outcomes preserve each status, expandable failure details and the targeted retry action", () => {
  const html = render({ successCount: 2, pendingCount: 1, failureCount: 1, retryableFailureCount: 1, entries: [
    { channel: "facebook", label: "Facebook", ok: true, status: "published" },
    { channel: "tiktok", label: "TikTok", ok: true, status: "queued" },
    { channel: "gmb", label: "Google Business", ok: false, status: "failed", error: "Une erreur empêche la publication." },
  ] }, { onRetryFailed() {}, retrying: true });
  assert.match(html, /1 publication en ligne/);
  assert.match(html, /Facebook — Publié/);
  assert.match(html, /TikTok — En attente/);
  assert.match(html, /Google Business — Échec/);
  assert.match(html, /aria-expanded="false" aria-controls=/);
  assert.match(html, /class="retryButton" disabled="" aria-busy="true"/);
  assert.doesNotMatch(html, /Tout est en ligne/);
});

test("failed, skipped and warning outcomes remain distinct and an absent summary never announces success", () => {
  const failed = render({ allFailed: true, failureCount: 1, entries: [{ channel: "x", label: "X", status: "failed", ok: false }] });
  assert.match(failed, /Bilan de publication/);
  assert.match(failed, /data-result-tone="failed"/);
  assert.doesNotMatch(failed, /publication[s]? en ligne/);
  const skipped = render({ skippedCount: 1, entries: [{ channel: "youtube", label: "YouTube", status: "skipped", ok: false, blockers: ["Vidéo obligatoire"] }] });
  assert.match(skipped, /Non envoyé/);
  assert.match(skipped, /YouTube — Ignoré avant envoi/);
  assert.match(skipped, /Vidéo obligatoire/);
  const warning = render({ successCount: 1, warningCount: 1, entries: [{ channel: "pinterest", label: "Pinterest", status: "published_with_warning", ok: true, warning_message: "Un média n’a pas été publié." }] });
  assert.match(warning, /1 publication en ligne/);
  assert.match(warning, /Publié avec avertissement/);
  assert.doesNotMatch(warning, /Tout est en ligne/);
  const empty = render(null);
  assert.match(empty, /Bilan de publication/);
  assert.doesNotMatch(empty, /avec succès|publication[s]? en ligne|Tout est en ligne/);
});

test("embedded results leave the single publication recap to the compact footer without another dialog or action bar", () => {
  const summary = { successCount: 1, retryableFailureCount: 1, entries: [
    { channel: "site_web", label: "Site Web", ok: true, status: "published" },
  ] };
  const destinations = [{ key: "site_web", label: "Site Web" }];
  const html = render(summary, { embedded: true, publicationDestinations: destinations, wizardSteps: ["channels", "content", "results"], onRetryFailed() {} });
  const footer = renderCompactActions(summary, destinations);
  assert.match(html, /class="resultBody immersive" data-result-tone="published"/);
  assert.doesNotMatch(html, /1\/1 publié|data-publication-hub-summary/);
  assert.equal((footer.match(/1\/1 publié/g) || []).length, 1);
  assert.equal((footer.match(/data-publication-hub-summary/g) || []).length, 1);
  assert.match(footer, /data-publication-result-footer/);
  assert.match(html, /Site Web — Publié/);
  assert.equal((html.match(/data-publication-visual-hub/g) || []).length, 1);
  assert.doesNotMatch(html, /class="channelGrid"|class="channelCard"/);
  assert.doesNotMatch(html, /role="dialog"|aria-modal=|data-publish-wizard|data-wizard-screen|publish-result-close/);
  assert.doesNotMatch(html, /class="(?:overlay|shell|scrollSurface|standaloneFooter|inrSendButton|retryButton)"|data-publish-result-actions/);
  assert.doesNotMatch(html, /BOOSTER|🚀|Tout est en ligne/);
});

test("the shared result hub keeps all eleven destinations in their initial order and separates completed processing from ten successful publications", () => {
  const destinations = [
    ["site_web", "Site Web"], ["gmb", "Google Business"], ["inr_search", "iNr’Search"],
    ["facebook", "Facebook"], ["instagram", "Instagram"], ["threads", "Threads"],
    ["linkedin", "LinkedIn"], ["tiktok", "TikTok"], ["youtube_shorts", "YouTube"],
    ["pinterest", "Pinterest"], ["x", "X"],
  ].map(([key, label]) => ({ key, label }));
  const entries = destinations.map(({ key, label }, index) => ({ channel: key, label, ok: index !== 1, status: index === 1 ? "failed" : "published", error: index === 1 ? "Une erreur empêche la publication." : null })).reverse();
  const summary = { successCount: 10, failureCount: 1, entries, channelLinks: { facebook: "https://www.facebook.com/example/posts/1" } };
  const html = render(summary, { embedded: true, publicationDestinations: destinations });
  const footer = renderCompactActions(summary, destinations);
  assert.doesNotMatch(html, /10\/11 publiés|data-publication-hub-summary/);
  assert.equal((footer.match(/10\/11 publiés/g) || []).length, 1);
  assert.match(html, /Bilan prêt/);
  assert.equal((html.match(/<li\b/g) || []).length, 11);
  const renderedOrder = [...html.matchAll(/<li\b[^>]+data-channel="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(renderedOrder, destinations.map(({ key }) => key));
  assert.equal((html.match(/<li\b[^>]+data-status="published"/g) || []).length, 10);
  assert.equal((html.match(/<li\b[^>]+data-status="failed"/g) || []).length, 1);
  assert.match(html, /Google Business — Échec/);
  assert.match(html, /Une erreur empêche la publication/);
  assert.match(html, /aria-label="Voir Facebook"/);
  assert.match(html, /class="corePercent">100<span>%/);
  assert.doesNotMatch(html, /11\/11 publiés|Tout est en ligne/);
  assert.doesNotMatch(footer, /11\/11 publiés|Tout est en ligne/);
});

test("result aliases reuse their original destination and pending or missing channels never count as published", () => {
  const summary = { successCount: 2, pendingCount: 1, entries: [
    { channel: "youtube", label: "YouTube", ok: true, status: "published" },
    { channel: "google_business", label: "Google Business", ok: true, status: "processing" },
  ] };
  const destinations = [
    { key: "gmb", label: "Google Business" }, { key: "youtube_shorts", label: "YouTube" }, { key: "x", label: "X" },
  ];
  const html = render(summary, { embedded: true, publicationDestinations: destinations });
  const footer = renderCompactActions(summary, destinations);
  assert.equal((html.match(/<li\b/g) || []).length, 3);
  assert.doesNotMatch(html, /1\/3 publié|data-publication-hub-summary/);
  assert.equal((footer.match(/1\/3 publié/g) || []).length, 1);
  assert.match(html, /Bilan prêt/);
  assert.match(html, /data-complete="false"/);
  assert.match(html, /Google Business — En attente/);
  assert.doesNotMatch(html, /Google Business — Publié|X — Publié/);
  assert.equal((html.match(/<li\b[^>]+data-status="published"/g) || []).length, 1);
  assert.equal((html.match(/<li\b[^>]+data-status="pending"/g) || []).length, 2);
  assert.match(html, /X — En attente/);
  assert.match(footer, /<strong>2<\/strong><span>en traitement/);
});

test("unknown results stay pending while confirmed technical outcomes retain their real state", () => {
  const summary = { successCount: 4, entries: [
    { channel: "facebook", label: "Facebook", ok: true },
    { channel: "tiktok", label: "TikTok", ok: true, status: "awaiting_platform" },
    { channel: "gmb", label: "Google Business", ok: true, technicalStatus: "published" },
    { channel: "pinterest", label: "Pinterest", ok: true, technicalStatus: "failed" },
  ] };
  for (const embedded of [true, false]) {
    const html = render(summary, { embedded });
    assert.match(html, /Facebook — En attente/);
    assert.match(html, /TikTok — En attente/);
    assert.match(html, /Google Business — Publié/);
    assert.match(html, /Pinterest — Échec/);
    assert.doesNotMatch(html, /Facebook — Publié|TikTok — Publié|Pinterest — Publié/);
    if (embedded) {
      assert.doesNotMatch(html, /1\/4 publié|data-publication-hub-summary/);
      assert.match(renderCompactActions(summary), /1\/4 publié/);
    } else {
      assert.match(html, /1 publication en ligne/);
    }
  }
});

test("the compact footer updates real publication counts and retry eligibility after a polled result changes", () => {
  const destinations = [{ key: "tiktok", label: "TikTok" }];
  const pending = { publicationId: "job-pending", successCount: 1, pendingCount: 1, entries: [
    { channel: "tiktok", label: "TikTok", ok: true, status: "processing" },
  ] };
  const before = renderCompactActions(pending, destinations);
  assert.match(before, /0\/1 publié/);
  assert.match(before, /<strong>1<\/strong><span>en traitement/);
  assert.doesNotMatch(before, /class="retryButton"/);

  const published = resultModule.mergePublicationResultSnapshot(pending, { entries: [
    { channel: "tiktok", label: "TikTok", ok: true, status: "published" },
  ] }, "job-pending");
  const after = renderCompactActions(published, destinations);
  assert.match(after, /1\/1 publié/);
  assert.doesNotMatch(after, /en traitement|class="retryButton"/);

  const failed = resultModule.mergePublicationResultSnapshot(pending, { entries: [
    { channel: "tiktok", label: "TikTok", ok: false, status: "failed", retryable: true },
  ] }, "job-pending");
  const failureFooter = renderCompactActions(failed, destinations);
  assert.match(failureFooter, /0\/1 publié/);
  assert.match(failureFooter, /class="retryButton"/);
  assert.match(failureFooter, /aria-label="Retenter 1 canal en échec"/);
  assert.doesNotMatch(failureFooter, /en traitement/);
});

test("exported result actions preserve retry eligibility, busy state and the iNrSend callback", () => {
  const renderActions = (options: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Actions, {
    summary: { retryableFailureCount: 2 }, onOpenInrSend() {}, onRetryFailed() {}, ...options,
  }));
  const ready = renderActions();
  assert.equal((ready.match(/class="inrSendButton"/g) || []).length, 1);
  assert.match(ready, /Retenter 2 canaux en échec/);
  assert.doesNotMatch(ready, /data-publication-hub-summary|class="footerRecap"/);
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

test("compact result actions retain full accessible retry wording and expose a short mobile label", () => {
  const html = renderToStaticMarkup(createElement(Actions, {
    summary: { retryableFailureCount: 1 }, compact: true, onRetryFailed() {}, onOpenInrSend() {},
  }));
  assert.match(html, /data-compact="true"/);
  assert.match(html, /aria-label="Retenter 1 canal en échec"/);
  assert.match(html, /class="actionCompactLabel" aria-hidden="true">1 échec/);
  assert.match(html, /Voir dans iNr’Send/);
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
