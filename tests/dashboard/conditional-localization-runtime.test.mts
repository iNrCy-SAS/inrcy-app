import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";
import { responsiveSurfaceFixture } from "../helpers/responsive-surface-fixture.mts";

const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const catalogs = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(["mails", "media", "agenda", "documents", "settings", "public", "shell", "booster", "dashboard"].map(namespace => [namespace, JSON.parse(read(`messages/${locale}/${namespace}.json`))]))]));
function translate(locale: string, namespace: string, key: string, values: Record<string, string | number> = {}) {
  const value = catalogs[locale][namespace][key];
  assert.equal(typeof value, "string", `${locale}/${namespace}/${key}`);
  return new IntlMessageFormat(value, locale).format(values) as string;
}
const ast = (file: string) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Evaluate the real production JSX attribute, including its branches, rather
 * than reproducing a ternary in a test or accepting a translation-key mock. */
function attribute(file: string, name: string, marker: string) {
  const source = ast(file); let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === name && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(source).includes(marker)) expression = node.initializer.expression;
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(expression, `${file}/${name}/${marker}`);
  const text = expression.getText(source);
  return (scope: Record<string, unknown>) => new Function(...Object.keys(scope), `return (${text});`)(...Object.values(scope));
}
type Branch = { file: string; namespace: string; name: string; marker: string; states: Array<{ scope: Record<string, unknown>; key?: string; values?: Record<string, string | number> }> };
const components = "app/dashboard/_components/", settings = "app/dashboard/settings/_components/";
const branches: Branch[] = [
  { file: components + "RichMailEditor.tsx", namespace: "mails", name: "aria-label", marker: "editor_fullscreen_label", states: [{ scope: { isExpanded: true }, key: "editor_fullscreen_label" }, { scope: { isExpanded: false } }] },
  { file: components + "RichMailEditor.tsx", namespace: "mails", name: "aria-label", marker: "editor_shrink_label", states: [{ scope: { isExpanded: true }, key: "editor_shrink_label" }, { scope: { isExpanded: false }, key: "editor_expand_label" }] },
  { file: components + "RichMailEditor.tsx", namespace: "mails", name: "title", marker: "editor_shrink", states: [{ scope: { isExpanded: true }, key: "editor_shrink" }, { scope: { isExpanded: false }, key: "editor_expand" }] },
  { file: components + "InrcyCameraCaptureModal.tsx", namespace: "media", name: "aria-label", marker: "camera_switch_to_front", states: [{ scope: { facingMode: "environment" }, key: "camera_switch_to_front" }, { scope: { facingMode: "user" }, key: "camera_switch_to_rear" }] },
  { file: components + "InrcyCameraCaptureModal.tsx", namespace: "media", name: "title", marker: "camera_front", states: [{ scope: { facingMode: "environment" }, key: "camera_front" }, { scope: { facingMode: "user" }, key: "camera_rear" }] },
  { file: components + "InrcyCameraCaptureModal.tsx", namespace: "media", name: "aria-label", marker: "camera_disable_flash", states: [{ scope: { torchSupported: true, torchOn: true }, key: "camera_disable_flash" }, { scope: { torchSupported: true, torchOn: false }, key: "camera_enable_flash" }, { scope: { torchSupported: false, torchOn: false }, key: "flash_indisponible_sur_cet_appareil_9eac5eab" }] },
  { file: components + "InrcyCameraCaptureModal.tsx", namespace: "media", name: "title", marker: "camera_flash_on", states: [{ scope: { torchSupported: true, torchOn: true }, key: "camera_flash_on" }, { scope: { torchSupported: true, torchOn: false }, key: "camera_flash" }, { scope: { torchSupported: false, torchOn: false }, key: "flash_indisponible_sur_cet_appareil_9eac5eab" }] },
  { file: components + "InrcyCameraCaptureModal.tsx", namespace: "media", name: "title", marker: "camera_video_unavailable_here", states: [{ scope: { mode: "video", allowVideo: false }, key: "camera_video_unavailable_here" }, { scope: { mode: "photo", allowVideo: false } }, { scope: { mode: "video", allowVideo: true } }] },
  { file: "app/dashboard/agenda/agenda.ui.tsx", namespace: "agenda", name: "title", marker: "draft_saving", states: [{ scope: { props: { rdvSaving: true } }, key: "draft_saving" }, { scope: { props: { rdvSaving: false } }, key: "save_as_draft" }] },
  { file: "app/dashboard/agenda/agenda.ui.tsx", namespace: "agenda", name: "title", marker: "disable_reminders_this_event", states: [{ scope: { props: { rdvRemindersAvailable: true } }, key: "disable_reminders_this_event" }, { scope: { props: { rdvRemindersAvailable: false } }, key: "no_reminder_slots_enabled" }] },
  { file: "app/dashboard/factures/ListPage.tsx", namespace: "documents", name: "title", marker: "locked_invoice_delete_unavailable", states: [{ scope: { deletionLocked: true }, key: "locked_invoice_delete_unavailable" }, { scope: { deletionLocked: false } }] },
  { file: settings + "BoutiqueContent.tsx", namespace: "settings", name: "title", marker: "insufficient_ui_balance", states: [{ scope: { canOrderUi: () => false, p: {} }, key: "insufficient_ui_balance" }, { scope: { canOrderUi: () => true, p: {} } }] },
  { file: settings + "PinterestSettingsContent.tsx", namespace: "settings", name: "label", marker: "pinterest_ready", states: [{ scope: { syncing: true, loading: false, pinterestBoardReady: false, boardOptions: [] }, key: "synchronisation_cc8ad3ae" }, { scope: { syncing: false, loading: true, pinterestBoardReady: false, boardOptions: [] }, key: "synchronisation_cc8ad3ae" }, { scope: { syncing: false, loading: false, pinterestBoardReady: true, boardOptions: [] }, key: "pinterest_ready" }, { scope: { syncing: false, loading: false, pinterestBoardReady: false, boardOptions: ["board"] }, key: "pinterest_select_board" }, { scope: { syncing: false, loading: false, pinterestBoardReady: false, boardOptions: [] }, key: "pinterest_create_board" }] },
  { file: "app/entreprises/[slug]/InrSearchExperience.tsx", namespace: "public", name: "aria-label", marker: "close_menu", states: [{ scope: { menuOpen: true }, key: "close_menu" }, { scope: { menuOpen: false }, key: "open_menu" }] },
  { file: "app/entreprises/[slug]/InrSearchExperience.tsx", namespace: "public", name: "aria-label", marker: "go_to_label", states: [{ scope: { item: { label: "My own section · 你好" }, index: 1 }, key: "go_to_label", values: { label: "My own section · 你好" } }, { scope: { item: undefined, index: 1 }, key: "go_to_section", values: { section: 2 } }] },
];

test("real editor, camera, agenda, Pinterest, billing and public-navigation branches use all nine catalogues", () => {
  for (const branch of branches) {
    const evaluate = attribute(branch.file, branch.name, branch.marker);
    for (const locale of locales) for (const state of branch.states) {
      const i18nT = (key: string, values?: Record<string, string | number>) => translate(locale, branch.namespace, key, values);
      const value = evaluate({ i18nT, ...state.scope });
      assert.equal(value, state.key ? i18nT(state.key, state.values) : undefined, `${locale}/${branch.marker}`);
      const markup = renderToStaticMarkup(React.createElement("button", { [branch.name === "label" ? "aria-label" : branch.name]: value }));
      assert.doesNotMatch(markup, /editor_fullscreen_label|camera_switch_to_front|pinterest_ready/);
    }
  }
});

test("document example branches and prompt fallbacks preserve caller values in every locale", () => {
  for (const file of ["app/dashboard/devis/new/page.tsx", "app/dashboard/factures/new/page.tsx"]) {
    const source = ast(file), expressions: ts.Expression[] = [];
    const visit = (node: ts.Node) => { if (ts.isJsxAttribute(node) && node.name.getText(source) === "placeholder" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(source).includes("example_value")) expressions.push(node.initializer.expression); ts.forEachChild(node, visit); };
    visit(source); assert.equal(expressions.length, 2);
    for (const locale of locales) for (const [depositKind, discountKind, expected] of [["amount", "percent", [300, 10]], ["percent", "amount", [30, 50]]] as const) {
      const i18nT = (key: string, values: Record<string, string | number>) => translate(locale, "documents", key, values);
      const values = expressions.map(expression => new Function("i18nT", "depositKind", "discountKind", `return (${expression.getText(source)});`)(i18nT, depositKind, discountKind));
      assert.deepEqual(values, expected.map(value => i18nT("example_value", { value })));
    }
  }
  const evaluate = attribute("app/_components/InrcyDialogProvider.tsx", "placeholder", "dialog_default_name_placeholder");
  for (const locale of locales) for (const supplied of [undefined, "Mon nom personnel · 你好"]) {
    const i18nT = (key: string) => translate(locale, "shell", key);
    assert.equal(evaluate({ i18nT, dialog: { options: { placeholder: supplied } } }), supplied || i18nT("dialog_default_name_placeholder"));
  }
  for (const entry of [
    { file: components + "RichMailEditor.tsx", variable: "placeholder", supplied: "suppliedPlaceholder", namespace: "mails", key: "votre_message_ffe7b099" },
    { file: components + "InrcyCameraCaptureModal.tsx", variable: "title", supplied: "suppliedTitle", namespace: "media", key: "camera_photo_title" },
  ]) {
    const source = ast(entry.file); let initializer: ts.Expression | undefined;
    const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === entry.variable && node.initializer?.getText(source).includes(entry.key)) initializer = node.initializer; ts.forEachChild(node, visit); };
    visit(source); assert.ok(initializer, `${entry.file}/${entry.variable}`);
    const evaluate = new Function("i18nT", entry.supplied, `return (${initializer.getText(source)});`);
    for (const locale of locales) for (const supplied of [undefined, "", "My personal text · 你好"]) {
      const i18nT = (key: string) => translate(locale, entry.namespace, key);
      assert.equal(evaluate(i18nT, supplied), supplied ?? i18nT(entry.key));
    }
  }
});

test("actual settings and attachment subtitle expressions use localized copy rather than French props", () => {
  const groups = [
    { file: settings + "AgendaSettingsContent.tsx", namespace: "agenda", keys: ["reminder_sender_description", "public_booking_settings_description"] },
    { file: settings + "NotificationsSettingsContent.tsx", namespace: "settings", keys: ["notifications_bell_description", "notifications_email_description", "notifications_performance_description", "notifications_action_description", "notifications_information_description"] },
    { file: settings + "DocumentsSettingsContent.tsx", namespace: "documents", keys: ["common_settings_description", "default_line_description", "payment_settings_description", "quote_settings_description", "invoice_settings_description", "design_settings_description"] },
    { file: components + "TemplateAttachmentPicker.tsx", namespace: "shell", keys: ["template_library_attachment_description"] },
  ];
  for (const group of groups) for (const key of group.keys) {
    const evaluate = attribute(group.file, "subtitle", key);
    for (const locale of locales) {
      const i18nT = (key: string) => translate(locale, group.namespace, key);
      assert.equal(evaluate({ i18nT }), i18nT(key));
    }
  }
});

test("the actual CTA settings panel renders nine languages, ICU progress and user CTA text without writing preferences", () => {
  const file = settings + "AiChannelCtaPanel.tsx", custom = "My original CTA · 你好";
  for (const locale of locales) for (const configured of [false, true]) {
    const fixture = responsiveSurfaceFixture(locale);
    const markup = renderToStaticMarkup(fixture.element(file, { value: configured ? { site_web: { choice: "site", mode: "website", label: custom, url: "https://example.test/custom", phone: "" } } : {}, onChange: () => assert.fail("Rendering translations must not write CTA preferences") }));
    const escaped = (value: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, value));
    assert.ok(markup.includes(escaped(translate(locale, "settings", "cta_title"))), locale);
    assert.ok(markup.includes(escaped(translate(locale, "settings", "cta_settings"))), locale);
    assert.ok(markup.includes(escaped(translate(locale, "settings", "cta_configured_count", { configured: configured ? 1 : 0, total: 10 }))), locale);
    assert.ok(markup.includes(escaped(translate(locale, "dashboard", "canal_precedent_e644dfdf"))), locale);
    if (configured) { assert.ok(markup.includes(custom)); assert.ok(markup.includes("https://example.test/custom")); }
    if (locale !== "fr-FR") assert.doesNotMatch(markup, /Un CTA adapté|Aucun CTA|RÉGLAGES DU CTA|canaux configurés|Canal précédent/);
    assert.doesNotMatch(markup, /settings\.cta_|\{configured\}|\{total\}/);
  }
});
