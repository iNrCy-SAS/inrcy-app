import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown, defaultRehypePlugins, defaultRemarkPlugins } from "streamdown";
import * as navigation from "../../lib/inrAssistantNavigation.ts";
import ts from "typescript";
import type * as MessageContent from "../../app/dashboard/_components/DashboardAssistantMessageContent.tsx";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../app/dashboard/_components/DashboardAssistantMessageContent.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const moduleRecord = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleRecord, moduleRecord.exports, (name: string) => {
  if (name === "react/jsx-runtime") return require(name);
  if (name === "streamdown") return { Streamdown, defaultRehypePlugins, defaultRemarkPlugins };
  if (name === "../../../lib/inrAssistantNavigation") return navigation;
  if (name.endsWith(".module.css")) return { __esModule: true, default: { content: "assistant-content" } };
  assert.fail(`Unexpected dependency ${name}`);
});
const runtime = moduleRecord.exports as typeof MessageContent;
const render = (content: string, onInternalNavigate?: (href: string) => void) => renderToStaticMarkup(createElement(runtime.default, { content, onInternalNavigate }));

test("assistant replies render real emphasis and lists without Markdown delimiters", () => {
  const html = render("**Préparez votre canal**\n\n1. Ouvrez **Connecter**.\n2. Choisissez votre page.\n\n- Votre activité\n- Votre logo");
  assert.match(html, /<strong[^>]*>Préparez votre canal<\/strong>/);
  assert.match(html, /<ol\b/);
  assert.match(html, /<ul\b/);
  assert.equal([...html.matchAll(/<li\b/g)].length, 4);
  assert.doesNotMatch(html, /\*\*/);
});

test("tool links stay inside the application while external web URLs open in a safe tab", () => {
  const html = render("[Facebook](https://www.facebook.com/pages/create/)\n\n[Mon compte](/dashboard?panel=compte)\n\nhttps://www.inrcy.com/", () => {});
  const links = [...html.matchAll(/<a\b[^>]*>/g)].map(match => match[0]);
  assert.equal(links.length, 3);
  for (const link of [links[0], links[2]]) {
    assert.match(link, /target="_blank"/);
    assert.match(link, /rel="noopener noreferrer"/);
  }
  assert.doesNotMatch(links[1], /target=/);
  assert.match(links[1], /data-inrcy-unguarded-navigation="true"/);
  assert.match(html, /href="\/dashboard\?panel=compte"/);
});

test("saved paths, code-formatted paths and technical link labels become public tool names", () => {
  const html = render("Ouvrez /dashboard?panel=abonnement puis `/dashboard/configuration-ia`.\n\n[MediaLibraryClient.tsx](/dashboard/mediatheque)\n\nhttps://app.inrcy.com/dashboard/stats\n\n[ancien outil][media]\n\n[media]: /dashboard/generer-media");
  assert.match(html, />Mon abonnement<\/a>/);
  assert.match(html, />Configuration IA<\/a>/);
  assert.match(html, />Mes médias<\/a>/);
  assert.match(html, />iNr’Stats<\/a>/);
  assert.match(html, />iNrStudio<\/a>/);
  const visibleText = html.replace(/<[^>]*>/g, "");
  assert.doesNotMatch(visibleText, /\/dashboard|MediaLibraryClient|ancien outil/);
});

test("public tool names cover action, panel and same-app development URLs without inventing routes", () => {
  assert.deepEqual(navigation.getAssistantInternalDestination("http://localhost:3000/dashboard?panel=abonnement"), { href: "/dashboard?panel=abonnement", label: "Mon abonnement" });
  assert.deepEqual(navigation.getAssistantInternalDestination("https://app.inrcy.com/dashboard?action=channels#facebook"), { href: "/dashboard?action=channels#facebook", label: "Mes canaux" });
  assert.deepEqual(navigation.getAssistantInternalDestination("?panel=boutique"), { href: "/dashboard?panel=boutique", label: "Boutique" });
  assert.deepEqual(navigation.getAssistantInternalDestination("/dashboard?helpAction=channels"), { href: "/dashboard?action=channels", label: "Mes canaux" });
  assert.equal(navigation.getAssistantInternalDestination("/dashboard?action=delete-account"), undefined);
  assert.equal(navigation.getAssistantInternalDestination("/dashboard?panel=unknown"), undefined);
  assert.equal(navigation.getAssistantInternalDestination("/dashboard/settings/invented"), undefined);
  assert.equal(navigation.getAssistantInternalDestination("https://other.example/dashboard/stats"), undefined);
  for (const path of ["/api/account/delete", "/auth/callback", "http://localhost:3000/api/private", "https://app.inrcy.com/api/private"]) assert.equal(runtime.getSafeAssistantHref(path), undefined);
  const html = render("[introuvable](/dashboard?panel=unknown) /dashboard/invented");
  assert.doesNotMatch(html, /<a\b/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /\/dashboard|introuvable/);
});

test("a normal tool click uses the guarded callback; modified clicks retain browser behavior", () => {
  const visits: string[] = [];
  const anchor = runtime.AssistantMessageLink({ href: "https://app.inrcy.com/dashboard/mediatheque", children: "/dashboard/mediatheque", onInternalNavigate: href => visits.push(href) });
  assert.equal(anchor.type, "a");
  const props = anchor.props as { onClick: (event: object) => void; href: string; children: string };
  assert.equal(props.href, "/dashboard/mediatheque");
  assert.equal(props.children, "Mes médias");
  let prevented = 0;
  const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => { prevented++; } };
  props.onClick(event);
  assert.equal(prevented, 1);
  assert.deepEqual(visits, ["/dashboard/mediatheque"]);
  for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) props.onClick({ ...event, [modifier]: true });
  props.onClick({ ...event, button: 1 });
  props.onClick({ ...event, defaultPrevented: true });
  assert.equal(prevented, 1);
  assert.equal(visits.length, 1);
  const native = runtime.AssistantMessageLink({ href: "/dashboard/stats", children: "Stats" });
  assert.equal((native.props as Record<string, unknown>)["data-inrcy-unguarded-navigation"], undefined, "Native fallback must keep the existing unsaved-change guard");
  const external = runtime.AssistantMessageLink({ href: "https://www.facebook.com/pages/create/", children: "Créer une page Facebook", onInternalNavigate: href => visits.push(href) });
  assert.equal((external.props as Record<string, unknown>).target, "_blank");
  assert.equal((external.props as Record<string, unknown>).rel, "noopener noreferrer");
  assert.equal((external.props as Record<string, unknown>).onClick, undefined);
});

test("only HTTP, HTTPS and app-relative navigation can become links", () => {
  for (const href of ["https://example.test/a?q=1#section", "http://example.test/", "/dashboard?panel=abonnement", "#details", "?panel=compte"]) {
    assert.equal(runtime.getSafeAssistantHref(href), href);
  }
  for (const href of [undefined, "", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,attack", "vbscript:attack", "file:///private", "blob:https://example.test/id", "mailto:private@example.test", "//elsewhere.test", "/\\elsewhere.test", "https://example.test/\nattack", "https://example.test/\tattack", "https://"]) {
    assert.equal(runtime.getSafeAssistantHref(href), undefined, `Rejected link: ${String(href)}`);
  }
  const html = render("[unsafe](javascript:alert%281%29) [data](data:text/html,attack) [relative](//elsewhere.test)");
  assert.doesNotMatch(html, /<a\b/);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /unsafe/);
});

test("Markdown cannot load images, media, scripts, or raw HTML links", () => {
  const html = render("![remote image](https://tracking.example.test/pixel.png)\n\n![local image](/private/image.png)\n\n<script>alert(1)</script>\n\n<iframe src='https://tracking.example.test'></iframe>\n\n<a href='https://tracking.example.test'>HTML link</a>\n\n<video src='https://tracking.example.test/movie.mp4'></video>");
  assert.doesNotMatch(html, /<(?:img|script|iframe|video|audio|object|embed)\b/i);
  assert.doesNotMatch(html, /(?:src|srcset)=/i);
  assert.doesNotMatch(html, /<a\b/);
});

test("code examples remain escaped and readable without executing HTML", () => {
  const html = render("`<img src=x onerror=alert(1)>`\n\n```html\n<script>alert(1)</script>\n```");
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img\b|<script\b|<button\b/i);
});
