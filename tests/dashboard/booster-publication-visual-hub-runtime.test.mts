/* eslint-disable @typescript-eslint/no-explicit-any -- isolated TSX renderer with explicit framework adapters */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const nodeRequire = createRequire(import.meta.url);
const load = (path: string, dependencies: Record<string, any>) => {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const require = (name: string) => {
    if (name in dependencies) return dependencies[name];
    if (name === "react" || name === "react/jsx-runtime") return nodeRequire(name);
    throw new Error(`Unexpected renderer dependency: ${name}`);
  };
  new Function("require", "exports", code)(require, exports);
  return exports;
};
const subject = load("app/dashboard/_components/PublishExecutionProgress.tsx", {
  "next-intl": { useTranslations: () => (key: string) => key },
  "./PublishExecutionProgress.module.css": { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  "@/lib/boosterPublicationStatus": load("lib/boosterPublicationStatus.ts", {}),
});
const statusOf = subject.getPublicationDestinationStatus;
const destinations = [
  ["site_web", "Site Web"], ["gmb", "Google Business"], ["inr_search", "iNr’Search"],
  ["facebook", "Facebook"], ["instagram", "Instagram"], ["threads", "Threads"],
  ["linkedin", "LinkedIn"], ["tiktok", "TikTok"], ["youtube_shorts", "YouTube"],
  ["pinterest", "Pinterest"], ["x", "X"],
].map(([key, label]) => ({ key, label }));
const hub = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(subject.PublicationVisualHub, { progress: 39, destinations, ...props }));

test("accepted and unknown results never become published without a terminal success status", () => {
  for (const status of [undefined, "", "accepted", "queued", "preparing", "dispatching", "processing", "finalizing", "pending"]) {
    assert.equal(statusOf({ ok: true, status }), "pending", String(status));
  }
  assert.equal(statusOf({ status: "published", technicalStatus: "processing", ok: true }), "pending");
  assert.equal(statusOf({ status: "published", warning_kind: "pending", ok: true }), "pending");
  assert.equal(statusOf({ status: "failed", technicalStatus: "processing", ok: false }), "pending");
});

test("terminal publication states remain distinct, including technical failures and warnings", () => {
  assert.equal(statusOf({ status: "published", ok: true }), "published");
  assert.equal(statusOf({ technicalStatus: "completed", ok: true }), "published");
  assert.equal(statusOf({ status: "published_with_warning", ok: true }), "warning");
  assert.equal(statusOf({ status: "published", technicalStatus: "error", ok: true }), "failed");
  assert.equal(statusOf({ status: "published", ok: false }), "failed");
  assert.equal(statusOf({ status: "skipped", ok: false }), "skipped");
});

test("the same eleven destination cards preserve their order when pending states become final results", () => {
  const progress = hub({ destinations: destinations.map((item) => ({ ...item, status: "pending" })) });
  const result = hub({ progress: 100, completed: true, centerLabel: "Bilan prêt", destinations: destinations.map((item, index) => ({ ...item, status: index === 1 ? "failed" : "published" })) });
  const cardOrder = (html: string) => [...html.matchAll(/<li\b[^>]+data-channel="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(cardOrder(progress), destinations.map(({ key }) => key));
  assert.deepEqual(cardOrder(progress), cardOrder(result));
  assert.equal((result.match(/<li\b[^>]+data-status="published"/g) || []).length, 10);
  assert.equal((result.match(/<li\b[^>]+data-status="failed"/g) || []).length, 1);
  assert.match(result, /class="corePercent">100<span>%/);
  assert.match(result, /Bilan prêt/);
});

test("only destinations still pending retain an animated connection after the balance is ready", () => {
  const html = hub({ progress: 100, completed: false, destinations: [
    { key: "tiktok", label: "TikTok", status: "pending" },
    { key: "x", label: "X", status: "failed" },
    { key: "site_web", label: "Site Web", status: "published" },
  ] });
  assert.equal((html.match(/data-feeding="true"/g) || []).length, 1);
  assert.match(html, /TikTok — En attente/);
  assert.match(html, /X — Échec/);
  assert.match(html, /Site Web — Publié/);
  assert.equal((hub({ completed: true, destinations: [{ key: "x", label: "X", status: "published" }] }).match(/data-feeding="true"/g) || []).length, 0);
});

test("details remain keyboard accessible and the explicit Voir link is independent from the disclosure", () => {
  const html = hub({ destinations: [{ key: "facebook", label: "Facebook", status: "warning", details: "Une image <indisponible>.", href: "https://www.facebook.com/example/posts/1" }] });
  assert.match(html, /<details\b[^>]*><summary\b[^>]+aria-label="Facebook — Publié avec avertissement : détails"/);
  assert.match(html, /Une image &lt;indisponible&gt;/);
  assert.match(html, /<\/details><a\b[^>]+aria-label="Voir Facebook"[^>]+target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /<\/a><p class="inlineDetails">Une image &lt;indisponible&gt;\.<\/p>/);
  assert.doesNotMatch(html, /<indisponible>/);
});

test("immersive progress reflects the real bounded percentage while scheduling retains its compact presentation", () => {
  const render = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(subject.default, { styles: {}, publishProgress: 39, publishProgressLabel: "Envoi aux canaux", phaseIndex: 2, phaseTotal: 4, phaseLabel: "Publication", destinations, ...props }));
  const html = render({ variant: "immersive" });
  assert.match(html, /aria-valuenow="39"/);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 1);
  assert.match(html, /class="core" role="progressbar" aria-label="Envoi aux canaux"/);
  assert.doesNotMatch(html, /class="(?:track|fill)"/);
  assert.match(html, /stroke-dashoffset="61"/);
  assert.match(html, /Publication/);
  assert.match(render({ variant: "immersive", publishProgress: 175 }), /aria-valuenow="100"/);
  assert.match(render({ variant: "immersive", publishProgress: -2 }), /aria-valuenow="0"/);
  assert.doesNotMatch(render({ variant: "immersive", scheduling: true }), /data-publication-visual-hub/);
  assert.doesNotMatch(render({}), /data-publication-visual-hub/);
  assert.match(render({}), /style="width:39%"/);
});
