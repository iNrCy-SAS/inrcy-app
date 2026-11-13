/* eslint-disable @typescript-eslint/no-explicit-any -- isolated real TSX renderer with controlled hooks */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const repo = fileURLToPath(new URL("../../", import.meta.url)), nodeRequire = createRequire(import.meta.url);
const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const catalogs = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(["shell", "booster"].map(namespace => [namespace, JSON.parse(readFileSync(path.join(repo, "messages", locale, namespace + ".json"), "utf8"))]))]));
let activeLocale = "fr-FR";
const t = (key: string, values: Record<string, string | number> = {}, namespace = "shell") => {
  assert.equal(typeof catalogs[activeLocale][namespace][key], "string", `${activeLocale}/${namespace}/${key} missing`);
  return new IntlMessageFormat(catalogs[activeLocale][namespace][key], activeLocale).format(values) as string;
};
const escape = (value: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, value));
const hooks = {
  ...React,
  useState: (initial: any) => [typeof initial === "function" ? initial() : initial, () => {}],
  useEffect() {}, useLayoutEffect() {},
  useEffectEvent: (callback: any) => callback,
  useRef: (initial: any) => ({ current: initial }),
  useId: () => "editor-runtime",
  useMemo: (fn: () => any) => fn(), useCallback: (callback: any) => callback,
};
function runtime() {
  const cache: Record<string, any> = {};
  const load = (relative: string): any => {
    if (cache[relative]) return cache[relative];
    const file = path.resolve(repo, relative), exports: Record<string, any> = {}; cache[relative] = exports;
    const require = (name: string): any => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime" || name === "react-dom") return nodeRequire(name);
      if (name === "next-intl") return { useLocale: () => activeLocale, useTranslations: (namespace: string) => (key: string, values = {}) => t(key, values, namespace) };
      if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (name.endsWith("useUnsavedExitGuard")) return { useUnsavedExitGuard: ({ onConfirmExit }: any) => ({ confirmExit: onConfirmExit, confirmExitIfCurrent: async () => { onConfirmExit?.(); return true; } }) };
      if (name.endsWith("useInrAssistantLocalClose")) return { useInrAssistantLocalClose() {} };
      const base = name.startsWith("@/") ? path.join(repo, name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, base + ".ts", base + ".tsx"].find(existsSync);
      if (target) return load(path.relative(repo, target));
      throw Error(`Unexpected editor fixture import: ${name}`);
    };
    const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function("require", "exports", code)(require, exports);
    return exports;
  };
  return load;
}
const load = runtime();
const Modal = load("app/dashboard/_components/channel-image-adapter/modal.tsx").ChannelImageAdapterModal;
const Preview = load("app/dashboard/_components/channel-image-adapter/publication-preview.tsx").ChannelPublicationPreview;
const { FinalImageFrame, VideoPreviewFrame } = load("app/dashboard/_components/channel-image-adapter/frames.tsx");
function nodes(tree: any): any[] { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === "object" ? [tree, ...nodes(tree.props?.children)] : []; }
function nodeText(tree: any): string { return Array.isArray(tree) ? tree.map(nodeText).join("") : typeof tree === "string" || typeof tree === "number" ? String(tree) : tree && typeof tree === "object" ? nodeText(tree.props?.children) : ""; }
const noop = () => {};
const modalProps = { open: true, title: "User image", subtitle: "User subtitle", aspectRatio: "1 / 1", backgroundMode: "black", fitLabel: "Plein cadre", zoomLabel: "100 %", previewSrc: "https://fixture.invalid/photo.jpg", buttonClassName: "button", pillButtonStyle: {}, pillButtonActiveStyle: {}, onClose: noop, onZoomOut: noop, onZoomIn: noop, onContain: noop, onCover: noop, onReset: noop, onSave: noop, onBackgroundModeChange: noop };
const image = { previewUrl: "https://fixture.invalid/photo.jpg", imageMeta: { width: 1000, height: 1000 }, preset: { width: 1000, height: 1000 } };
const userText = "Mon contenu personnalisé — 你好";

test("the image adapter renders nine localized control sets without changing user overlay text and localizes only newly added defaults", () => {
  try {
    for (const locale of locales) {
      activeLocale = locale;
      const changes: Array<{ items: Array<{ text: string }> }> = [];
      const overlay = { items: [{ id: "user-overlay", text: userText, width: 70, x: 50, y: 50 }] };
      const tree = Modal({ ...modalProps, overlay, onOverlayChange: (value: any) => { changes.push(value); } });
      const html = renderToStaticMarkup(tree);
      assert.ok(html.includes(escape(userText)), locale);
      assert.equal(changes.length, 0, "Rendering or translating controls must never rewrite user text");
      for (const key of ["textes_et_liens_8c9d0ac3", "lien_de_ce_texte_d7919d22", "couleur_du_texte_37e78173", "epaisseur_de_la_bordure_a843eaa2", "plein_cadre_96d0dd78"]) assert.ok(html.includes(escape(t(key))), `${locale}/${key}`);
      if (locale !== "fr-FR") assert.doesNotMatch(html, /Textes et liens|Couleur du texte|Épaisseur de la bordure|Style du bandeau|Plein cadre|Image entière/);
      const textarea = nodes(tree).find(node => node.type === "textarea");
      assert.equal(textarea.props.value, userText);
      textarea.props.onChange({ target: { value: "USER EDIT — français conservé" } });
      const changed = changes.at(-1);
      assert.ok(changed, "Editing overlay text must emit an updated overlay");
      assert.equal(changed.items[0].text, "USER EDIT — français conservé");

      changes.length = 0;
      const empty = Modal({ ...modalProps, onOverlayChange: (value: any) => { changes.push(value); } });
      const add = nodes(empty).find(node => node.type === "button" && nodeText(node) === t("ajouter_le_premier_texte_a8b4d549"));
      assert.ok(add, locale);
      add.props.onClick();
      const added = changes.at(-1);
      assert.ok(added, "Adding the first text block must emit an overlay");
      assert.equal(added.items[0].text, t("texte_value_7b74730f", { value0: 1 }));
      assert.ok(renderToStaticMarkup(empty).includes(escape(t("ajouter_le_premier_texte_a8b4d549"))), locale);
    }
  } finally { activeLocale = "fr-FR"; }
});

test("publication previews localize channel notes and empty content in all nine languages while preserving publication text", () => {
  const cases = [
    ["site_web", "preview_site_images_note"], ["instagram", "preview_instagram_images_note"], ["gmb", "preview_google_image_note"],
    ["tiktok", "preview_tiktok_images_note"], ["youtube_shorts", "preview_youtube_requires_video"], ["x", "preview_x_images_note"],
  ];
  try {
    for (const locale of locales) {
      activeLocale = locale;
      for (const [channelKey, noteKey] of cases) {
        const preview = { channelKey, channelLabel: "Fixture channel", title: "User title", content: userText, images: [image] };
        const html = renderToStaticMarkup(React.createElement(Preview, { preview }));
        assert.ok(html.includes(escape(t(noteKey))), `${locale}/${channelKey}/${noteKey}`);
        assert.ok(html.includes(escape(userText)), `${locale}/${channelKey} user text`);
        if (locale !== "fr-FR") assert.doesNotMatch(html, /Aperçu séparé|Cliquez sur une image|aperçu du post|ce canal attend une vidéo|rendu iframe intégré/);
      }
      const empty = renderToStaticMarkup(React.createElement(Preview, { preview: { channelKey: "site_web", channelLabel: "Fixture channel" } }));
      assert.ok(empty.includes(escape(t("preview_content_placeholder"))), locale);
      assert.doesNotMatch(empty, /preview_(?:content_placeholder|site_images_note)|\{channel\}/);
    }
  } finally { activeLocale = "fr-FR"; }
});

test("real image and video frames translate fit labels and format video sizes for the active locale", () => {
  try {
    for (const locale of locales) {
      activeLocale = locale;
      for (const [fitLabel, key] of [["Plein cadre", "plein_cadre_96d0dd78"], ["Image entière", "image_entiere_76cd8175"], ["Adaptée", "adapter_fit_adapted"], ["Personnalisée", "adapter_fit_custom"]]) {
        const html = renderToStaticMarkup(React.createElement(FinalImageFrame, { image: { ...image, transform: { overlay: { items: [{ text: userText }] } } }, aspectRatio: "1 / 1", fitLabel }));
        assert.ok(html.includes(escape(t(key))), `${locale}/${fitLabel}`);
        assert.ok(html.includes(escape(userText)), locale);
      }
      const html = renderToStaticMarkup(React.createElement(VideoPreviewFrame, { video: { previewUrl: "https://fixture.invalid/video.mp4", size: 1.5 * 1024 * 1024, duration: 64 }, aspectRatio: "9 / 16" }));
      const expectedSize = new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", unitDisplay: "short", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1.5);
      assert.ok(html.includes(escape(expectedSize)), `${locale}: ${expectedSize}`);
      assert.ok(html.includes(escape(t("preview_video"))), locale);
      assert.match(html, /1:04/);
      if (locale === "en-GB") assert.doesNotMatch(html, /1,5\s*Mo/);
      const suppressed = renderToStaticMarkup(React.createElement(VideoPreviewFrame, { video: { previewUrl: "https://fixture.invalid/video.mp4" }, aspectRatio: "9 / 16", badge: "" }));
      assert.equal(suppressed.includes(escape(t("preview_video"))), false, "An explicit empty badge must remain suppressed");
      const custom = renderToStaticMarkup(React.createElement(VideoPreviewFrame, { video: { previewUrl: "https://fixture.invalid/video.mp4" }, aspectRatio: "9 / 16", badge: userText }));
      assert.ok(custom.includes(escape(userText)), "Custom user badge content stays unchanged");
    }
  } finally { activeLocale = "fr-FR"; }
});

test("the X CTA help selects the translated label for links, calls, private messages and WhatsApp in all nine languages", () => {
  const filename = "app/dashboard/booster/publier/publishModal.shared.tsx", source = ts.createSourceFile(filename, readFileSync(path.join(repo, filename), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "getLocalizedCtaModeHelp");
  assert.ok(declaration);
  const callable = ts.transpileModule(`return (${declaration.getText(source).replace(/^export\s+/, "")});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const help = new Function(callable)() as (channel: string, mode: string, translate: (key: string) => string, preferredChoice?: string) => string;
  try {
    for (const locale of locales) {
      activeLocale = locale;
      for (const [mode, preferred, key] of [["website", undefined, "cta_help_x_link"], ["custom", undefined, "cta_help_x_link"], ["call", undefined, "cta_help_x_call"], ["message", undefined, "cta_help_x_message"], ["custom", "whatsapp", "cta_help_x_whatsapp"]]) {
        const text = help("x", mode!, key => t(key, {}, "booster"), preferred);
        assert.equal(text, t(key!, {}, "booster"));
        const html = renderToStaticMarkup(React.createElement("p", null, text));
        if (locale !== "fr-FR") assert.doesNotMatch(html, /sera ajouté|publication si|Le lien sera|Le texte|WhatsApp sera/);
      }
    }
  } finally { activeLocale = "fr-FR"; }
});
