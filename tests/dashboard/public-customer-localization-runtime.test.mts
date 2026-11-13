/* eslint-disable @typescript-eslint/no-explicit-any -- isolated production TSX and browser/account boundaries */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import ts from "typescript";
import type { AppLocale } from "../../i18n/config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url)), require = createRequire(import.meta.url);
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;
const messages = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(readdirSync(path.join(root, "messages", locale)).filter(file => file.endsWith(".json")).map(file => [file.slice(0, -5), JSON.parse(readFileSync(path.join(root, "messages", locale, file), "utf8"))]))]));
const noop = () => {}, escaped = (text: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, text));
const passiveHooks = { ...React, useEffect: noop, useLayoutEffect: noop, useMemo: (callback: () => unknown) => callback(), useCallback: (callback: unknown) => callback };

function runtime(locale: AppLocale, options: { hooks?: any; boundaries?: Record<string, any>; globals?: Record<string, any>; noProvider?: boolean } = {}) {
  const translators = new Map<string, ReturnType<typeof createTranslator>>(), cache = new Map<string, any>();
  const translator = (namespace = "") => {
    if (!translators.has(namespace)) translators.set(namespace, createTranslator({ locale, messages: messages[locale], ...(namespace ? { namespace } : {}), timeZone: "Europe/Paris", onError: error => { throw error; } }));
    return translators.get(namespace)!;
  };
  const globals = { fetch: () => assert.fail("No live request is allowed in a localisation fixture"), ...options.globals };
  function load(file: string): any {
    if (cache.has(file)) return cache.get(file);
    if (file.endsWith(".json")) { const value = JSON.parse(readFileSync(path.join(root, file), "utf8")); cache.set(file, value); return value; }
    const record = { exports: {} as any }; cache.set(file, record.exports);
    const code = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("module", "exports", "require", ...Object.keys(globals), code)(record, record.exports, (id: string) => {
      if (id in (options.boundaries || {})) return options.boundaries![id];
      if (id === "react") return options.hooks || passiveHooks;
      if (id === "react/jsx-runtime") return require(id);
      if (id === "next-intl") return { createTranslator, useLocale: () => locale, useTranslations: (namespace?: string) => { assert.equal(options.noProvider, undefined, "GlobalError cannot depend on a failed layout's provider"); return translator(namespace); } };
      if (id === "next-intl/server") return { getTranslations: async (namespace?: string) => translator(namespace) };
      if (id === "next/link") return { __esModule: true, default: "a" };
      if (id === "next/image") return { __esModule: true, default: ({ unoptimized, ...props }: any) => { void unoptimized; return React.createElement("img", props); } };
      if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(root, path.dirname(file), id);
      const target = [base, base + ".ts", base + ".tsx"].find(existsSync); assert.ok(target, `${file}: ${id}`);
      return load(path.relative(root, target));
    }, ...Object.values(globals));
    cache.set(file, record.exports); return record.exports;
  }
  return { load, t: translator() };
}
const nodes = (tree: any): any[] => Array.isArray(tree) ? tree.flatMap(nodes) : React.isValidElement<any>(tree) ? [tree, ...nodes(tree.props.children)] : [];
const text = (tree: any): string => Array.isArray(tree) ? tree.map(text).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree) : React.isValidElement<any>(tree) ? text(tree.props.children) : "";

function formFixture(locale: AppLocale, state: Record<number, any>) {
  const slots: any[] = [], requests: Array<{ url: string; init: any }> = [], confirmations: string[] = [], navigation: string[] = [];
  let cursor = 0, allow = false;
  const account = { email: "personal@example.test", subscription: { access_end_date: "2026-12-24" }, deletion: null };
  const hooks = { ...passiveHooks, useState(initial: any) { const index = cursor++; if (!(index in slots)) slots[index] = index in state ? state[index] : typeof initial === "function" ? initial() : initial; return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; } };
  const auth = { getUser: async () => ({ data: { user: { email: account.email } } }), signOut: async () => {} };
  const env = runtime(locale, { hooks, boundaries: {
    "@/lib/supabaseClient": { createClient: () => ({ auth }) },
    "@/lib/browserAccountCache": { purgeAllBrowserAccountCaches() {}, setActiveBrowserUserId() {} },
    "@/lib/nativeBillingManagement": { openNativeSubscriptionManagement: async () => assert.fail("This test does not open an app store") },
    "@/lib/userFacingErrors": { getClientUserFacingErrorMessage: (_error: unknown, fallback: string) => fallback },
  }, globals: {
    window: { confirm: (message: string) => { confirmations.push(message); return allow; }, location: { replace: (url: string) => navigation.push(url) } },
    fetch: async (url: string, init: any) => { requests.push({ url, init }); return Response.json(init.method === "POST" ? { deleted: JSON.parse(init.body).mode === "immediate", end_date: "2026-12-24" } : account); },
  } });
  const Form = env.load("app/suppression-compte/DeletionRequestForm.tsx").default;
  return { ...env, slots, requests, confirmations, navigation, allow: () => { allow = true; }, render: () => { cursor = 0; return Form(); } };
}

test("deletion form renders loading, error, anonymous, partial, authenticated and scheduled states in all nine locales", () => {
  for (const locale of locales) for (const state of [
    { 0: "loading" }, { 0: "error" }, { 0: "anonymous", 7: "account" }, { 0: "anonymous", 7: "partial" },
    { 0: "authenticated", 1: { email: "personal@example.test", subscription: { access_end_date: "2026-12-24" }, deletion: null } },
    { 0: "authenticated", 1: { email: "personal@example.test", subscription: null, deletion: { status: "scheduled", scheduled_for: "2026-12-24" } } },
    { 0: "anonymous", 10: true },
  ]) {
    const app = formFixture(locale, state), tree = app.render(), markup = renderToStaticMarkup(tree);
    assert.equal(app.requests.length, 0);
    assert.doesNotMatch(markup, /public\.deletion_|\{required\}|\{date\}|\{label\}/);
    if (locale !== "fr-FR") assert.doesNotMatch(markup, /Suppression autonome|Vérification de votre session|Gérer mes données|Données ciblées|L’accès est coupé|Le compte, le profil/);
    const textarea = nodes(tree).find(node => node.type === "textarea");
    if (textarea) {
      const required = state[7] === "partial";
      assert.equal(textarea.props.required, required);
      const label = app.t.rich("public.deletion_details", { required: required ? "yes" : "no", label: app.t("public.deletion_data_to_remove"), small: chunks => React.createElement("small", null, chunks) });
      assert.ok(markup.includes(renderToStaticMarkup(React.createElement(React.Fragment, null, label))), `${locale}/required=${required}`);
      assert.equal(nodes(tree).filter(node => node.type === "input" && node.props.type === "checkbox")[0].props.required, true, "Account-holder consent remains mandatory");
    }
  }
});

test("localized irreversible confirmations never send a deletion on refusal and preserve exact action/category payloads on consent", async () => {
  for (const locale of locales) for (const [action, labelKey, confirmationKey] of [
    ["immediate", "deletion_immediate_action", "deletion_confirmation_immediate"],
    ["end_of_access", "deletion_schedule_action", "deletion_confirmation_end_access"],
    ["partial", "deletion_partial_action", "deletion_confirmation_partial"],
  ]) {
    const app = formFixture(locale, { 0: "authenticated", 1: { email: "personal@example.test", subscription: null, deletion: null }, 6: ["contacts", "documents"] });
    const button = () => nodes(app.render()).find(node => node.type === "button" && text(node) === app.t("public." + labelKey));
    assert.ok(button()); await button().props.onClick();
    assert.deepEqual(app.confirmations, [app.t("public." + confirmationKey, { count: 2 })]);
    assert.equal(app.requests.length, 0, "Refusal cannot reach an account API"); assert.equal(app.slots[2], null);
    app.allow(); await button().props.onClick();
    const posts = app.requests.filter(request => request.init.method === "POST"); assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "/api/account/deletion");
    assert.deepEqual(JSON.parse(posts[0].init.body), { mode: action, ...(action === "partial" ? { categories: ["contacts", "documents"] } : {}) });
    if (action === "immediate") assert.deepEqual(app.navigation, ["/login"]);
  }
});

test("public directory server UI localizes results, unavailable and empty states while preserving personal content and filters", async () => {
  for (const locale of locales) for (const mode of ["available", "empty", "unavailable"]) {
    const original = { slug: "fixture-company", companyName: "Entreprise personnelle · 你好", profession: "Métier personnel", city: "Ville personnelle", department: "Dpt", region: "Région personnelle", url: "https://example.test/company", qrUrl: "https://example.test/qr.svg" };
    const env = runtime(locale, { boundaries: {
      "next/headers": { headers: async () => ({ get: () => "app.inrcy.com" }) },
      "@/lib/inrDirectoryQuery": { getInrDirectoryResult: async (params: URLSearchParams) => { assert.equal(params.get("q"), "My personal filter"); if (mode === "unavailable") throw Error("PRIVATE_SERVICE_DETAIL"); return { total: mode === "empty" ? 0 : 1, page: 2, hasNext: true, items: mode === "empty" ? [] : [original], facets: { professions: [], cities: [], regions: [] } }; } },
    } });
    const Page = env.load("app/annuaire/page.tsx"), markup = renderToStaticMarkup(await Page.default({ searchParams: Promise.resolve({ q: "My personal filter", page: "2" }) }));
    assert.ok(markup.includes(escaped(env.t("public.directory_heading"))), locale);
    assert.ok(markup.includes('value="My personal filter"'));
    assert.doesNotMatch(markup, /public\.directory_|PRIVATE_SERVICE_DETAIL|\{company\}|\{count\}/);
    if (mode === "available") { assert.ok(markup.includes(original.companyName)); assert.ok(markup.includes(original.profession)); assert.ok(markup.includes("page=3")); }
    else assert.ok(markup.includes(escaped(env.t("public.directory_" + (mode === "empty" ? "empty" : "unavailable")))));
    if (mode === "unavailable") { assert.ok(markup.includes("<strong>—</strong>")); assert.ok(!markup.includes(escaped(env.t("public.directory_empty")))); }
    assert.equal((await Page.generateMetadata()).alternates.canonical, "https://inrcy.com/annuaire/");
  }
});

test("GlobalError localizes without any NextIntl provider and preserves retry and safe dashboard navigation", () => {
  for (const locale of locales) {
    let resets = 0;
    const env = runtime(locale, { noProvider: true, hooks: { ...passiveHooks, useSyncExternalStore: (_subscribe: unknown, snapshot: () => string) => snapshot() }, boundaries: { "@sentry/nextjs": { captureException: noop } }, globals: {
      document: { cookie: `inrcy_locale=${locale}`, documentElement: { lang: "fr" } },
      window: { location: { search: "" }, localStorage: { getItem: () => null } }, navigator: { languages: ["fr-FR"], language: "fr-FR" },
    } });
    const ErrorPage = env.load("app/global-error.tsx").default, tree = ErrorPage({ error: new Error("PRIVATE_ROOT_FAILURE"), reset: () => { resets++; } }), markup = renderToStaticMarkup(tree);
    assert.ok(markup.includes(escaped(env.t("public.global_error_title"))), locale);
    assert.ok(markup.includes(`lang="${locale === "zh-CN" ? locale : locale.slice(0, 2)}"`));
    assert.doesNotMatch(markup, /PRIVATE_ROOT_FAILURE|global_error_title|global_error_description/);
    nodes(tree).find(node => node.type === "button").props.onClick(); assert.equal(resets, 1);
    assert.equal(nodes(tree).find(node => node.type === "a").props.href, "/dashboard");
  }
});


test("account deletion server shell and metadata use the request locale while preserving legal notes and routes", async () => {
  for (const locale of locales) {
    const env = runtime(locale, { boundaries: { "./DeletionRequestForm": { __esModule: true, default: () => React.createElement("div", { "data-fixture-form": true }) } } });
    const Page = env.load("app/suppression-compte/page.tsx"), markup = renderToStaticMarkup(await Page.default()), metadata = await Page.generateMetadata();
    assert.ok(markup.includes(escaped(env.t("settings.suppression_du_compte_11789c76"))));
    for (const key of ["public.deletion_subtitle", "legal.suppression_meta_disconnect", "legal.suppression_meta_request", "public.deletion_legal_retention"]) assert.ok(markup.includes(escaped(env.t(key))), locale + "/" + key);
    assert.ok(markup.includes('href="/dashboard"')); assert.ok(markup.includes('href="/legal/confidentialite"'));
    assert.equal(metadata.title, env.t("public.deletion_metadata_title")); assert.equal(metadata.description, env.t("public.deletion_metadata_description"));
    assert.deepEqual(metadata.robots, { index: true, follow: true });
  }
});
