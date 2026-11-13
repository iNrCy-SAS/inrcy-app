/* eslint-disable @typescript-eslint/no-explicit-any -- isolated TSX renderer and browser download adapters */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url)), nodeRequire = createRequire(import.meta.url);
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
let activeLocale = "fr-FR";
const settings = Object.fromEntries(locales.map(locale => [locale, JSON.parse(readFileSync(path.join(root, "messages", locale, "settings.json"), "utf8"))]));
const documents = Object.fromEntries(locales.map(locale => [locale, JSON.parse(readFileSync(path.join(root, "messages", locale, "documents.json"), "utf8"))]));
const format = (messages: Record<string, string>, key: string, locale: string, values = {}) => new IntlMessageFormat(messages[key] || key, locale).format(values) as string;
function runtime(globals: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const cache: Record<string, any> = {};
  const load = (relative: string): any => {
    if (cache[relative]) return cache[relative];
    const file = path.resolve(root, relative), exports: Record<string, any> = {}; cache[relative] = exports;
    const require = (id: string): any => {
      if (id in overrides) return overrides[id];
      if (id === "next-intl") return {
        useLocale: () => activeLocale,
        useTranslations: (namespace: string) => (key: string, values = {}) => format((namespace === "documents" ? documents : settings)[activeLocale], key, activeLocale, values),
        createTranslator: ({ locale, messages }: any) => (key: string, values = {}) => format(messages, key, locale, values),
      };
      if (id === "react" || id === "react/jsx-runtime") return nodeRequire(id);
      if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (id.endsWith("ChannelParametersDialog")) return { __esModule: true, default: ({ children }: any) => children };
      if (/useInrAssistant(?:Refresh|BadgeCommands|LocalInterface)$/.test(id)) return new Proxy({}, { get: () => () => {} });
      if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ metaPilotEnabled: true, actorUserId: "fixture", activeAccountId: "fixture" }) };
      if (id.endsWith("DashboardEditionProvider")) return { useDashboardEdition: () => "premium" };
      if (id === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => "fixture" };
      const base = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
      const target = [base, base + ".ts", base + ".tsx"].find(existsSync);
      if (target?.endsWith(".json")) return JSON.parse(readFileSync(target, "utf8"));
      if (target) return load(path.relative(root, target));
      throw Error(`Unexpected settings renderer import: ${id}`);
    };
    const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("require", "exports", ...Object.keys(globals), source)(require, exports, ...Object.values(globals));
    return exports;
  };
  return load;
}

test("Search and Badge settings render translated descriptions, statuses and all theme presets in nine locales", () => {
  const load = runtime(), Search = load("app/dashboard/settings/_components/InrSearchSettingsContent.tsx").default, Badge = load("app/dashboard/settings/_components/InrBadgeSettingsContent.tsx").default;
  try {
    for (const locale of locales) {
      activeLocale = locale;
      const search = renderToStaticMarkup(React.createElement(Search, { initialConnected: false, renderBubble: ({ parameters }: any) => parameters }));
      const badge = renderToStaticMarkup(React.createElement(Badge, { profile: { userId: "fixture", logoUrl: "", companyLegalName: "", firstName: "", lastName: "", phone: "", contactEmail: "" }, publicUrl: "https://app.inrcy.com/badge/fixture", profileReady: true, channels: Object.fromEntries(["inrSearch", "siteWeb", "googleBusiness", "facebook", "instagram", "threads", "linkedin", "mails", "tiktok"].map(key => [key, { connected: false }])), onOpenProfile() {}, onOpenCalendarSettings() {} }));
      for (const key of ["search_intro", "search_explainer", "search_disconnected_status"]) assert.ok(search.includes(format(settings[locale], key, locale)), `${locale}/${key}`);
      for (const key of ["badge_appearance", "badge_identity", "badge_theme_sunset_label", "badge_theme_forest_description"]) assert.ok(badge.includes(format(settings[locale], key, locale)), `${locale}/${key}`);
      if (locale !== "fr-FR") assert.doesNotMatch(search + badge, /Votre site automatisé|Choisissez une ambiance|Aperçu des couleurs|Analyse du logo|Couleurs détectées|Le bouton Mail utilisera|Page déconnectée|Crépuscule|Émeraude, sapin/);
      assert.doesNotMatch(search + badge, /badge_theme_[a-z]+_(?:label|description)|search_(?:intro|explainer|pending)|\{provider\}/);
    }
  } finally { activeLocale = "fr-FR"; }
});

test("actual document settings localize all option labels and descriptions without changing stored enum values", () => {
  const load = runtime({}, { "./BusinessLegalSettingsCard": { __esModule: true, default: () => null } });
  const Documents = load("app/dashboard/settings/_components/DocumentsSettingsContent.tsx").default;
  const optionKeys = ["vente_9e7753e0", "prestation_de_services_700b1a5a", "virement_bancaire_8306f08e", "carte_bancaire_9e3d9bfa", "cheque_8bbb89a9", "especes_b7679d62", "facture_d_acompte_ce9f9da4", "en_attente_de_paiement_9b68eb63", "design_framed", "color_blue", "color_violet", "color_orange", "color_green", "color_professional_gray", "color_rose", "color_teal", "color_gold"];
  try {
    for (const locale of locales) {
      activeLocale = locale;
      const markup = renderToStaticMarkup(React.createElement(Documents, {}));
      for (const key of optionKeys) {
        assert.equal(typeof documents[locale][key], "string", `${locale}/${key}`);
        const label = renderToStaticMarkup(React.createElement(React.Fragment, null, format(documents[locale], key, locale)));
        assert.ok(markup.includes(`>${label}</option>`), `${locale}/${key}`);
      }
      for (const value of ["vente", "prestation", "virement", "cb", "cheque", "especes", "deposit", "en_attente_paiement", "encadre", "blue", "violet", "green", "gray", "gold"]) assert.ok(markup.includes(`value="${value}"`), `${locale}/${value}`);
      if (locale !== "fr-FR") assert.doesNotMatch(markup, />Gris pro<\/option>|>Encadré<\/option>|>Virement bancaire<\/option>|Conditions de règlement reprises|Réglages appliqués uniquement aux nouvelles factures/);
    }
  } finally { activeLocale = "fr-FR"; }
});

test("Badge PNG and PDF downloads keep Thai and Chinese captions and respect scope revocation after loading copy", async () => {
  for (const locale of ["th-TH", "zh-CN"]) for (const formatName of ["png", "pdf"] as const) {
    const text: string[] = [], downloads: string[] = [], images: unknown[] = [];
    const canvas = { width: 0, height: 0, getContext: () => ({ fillRect() {}, fillText: (value: string) => text.push(value) }), toBlob: (callback: (value: Blob) => void) => callback(new Blob(["PNG"])), toDataURL: () => "data:image/png;base64,fixture" };
    const document = { documentElement: { lang: locale }, body: { appendChild() {} }, createElement: (name: string) => name === "canvas" ? canvas : { href: "", download: "", click() { downloads.push(this.download); }, remove() {} } };
    const load = runtime({ document, window: { setTimeout() {} } }, { jspdf: { jsPDF: class { internal = { pageSize: { getWidth: () => 595, getHeight: () => 842 } }; addImage(...args: unknown[]) { images.push(args); } output() { return new Blob(["PDF"]); } } } });
    const download = load("app/dashboard/settings/_components/InrBadgeSettingsContent.tsx").downloadInrBadgeQr;
    assert.equal(await download("https://app.inrcy.com/badge/fixture", {}, formatName), true);
    assert.ok(text.includes(settings[locale].badge_qr_header), locale);
    assert.ok(text.includes(settings[locale].badge_your_name), locale);
    assert.equal(downloads.length, 1);
    assert.equal(images.length, formatName === "pdf" ? 1 : 0);
    let scopeChecks = 0;
    assert.equal(await download("https://app.inrcy.com/badge/fixture", {}, formatName, () => ++scopeChecks < 2), false);
    assert.equal(downloads.length, 1, "No download after the account scope changes during the locale load");
  }
});
