/* eslint-disable @typescript-eslint/no-explicit-any -- execute actual component projections and JSX with isolated read-only fixtures */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlMessageFormat } from "intl-messageformat";
import { getSubscriptionBillingPresentation } from "../../lib/subscriptionBillingPresentation.ts";
import { canStartSubscriptionCheckout } from "../../lib/subscriptionCheckoutPolicy.ts";
import { currentSubscriptionBillingPlan } from "../../lib/subscriptionPlanChangePolicy.ts";
import * as offers from "../../lib/subscriptionOffers.ts";

const nodeRequire = createRequire(import.meta.url);
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const standard = ts.createSourceFile("standard.tsx", read("app/dashboard/settings/_components/StandardSubscriptionContent.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const legacy = ts.createSourceFile("legacy.tsx", read("app/dashboard/settings/_components/AbonnementContent.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const account = ts.createSourceFile("account.tsx", read("app/dashboard/settings/_components/AccountContent.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const catalogs = Object.fromEntries(["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"].map(locale => [locale, JSON.parse(read(`messages/${locale}/settings.json`)) as Record<string, string>]));
function find(source: ts.SourceFile, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); };
  visit(source); assert.ok(found); return found;
}
function expression(source: string, scope: Record<string, unknown> = {}): any {
  const code = ts.transpileModule(`const value = (${source});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  return new Function("require", "exports", ...Object.keys(scope), code + "\nreturn value;")(nodeRequire, {}, ...Object.values(scope));
}
function fn(source: ts.SourceFile, name: string, scope: Record<string, unknown> = {}) {
  return expression(find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source), scope);
}
function initializer(source: ts.SourceFile, name: string) {
  return (find(source, node => ts.isVariableDeclaration(node) && node.name.getText(source) === name) as ts.VariableDeclaration).initializer!;
}
const endedOnRenewal = { plan: "Standard", app_edition: "standard", billing_provider: "stripe", stripe_subscription_id: "sub_synthetic", status: "active", billing_cycle: "monthly",
  start_date: "2026-07-15", cancel_requested_at: "2026-11-16T14:00:00Z", end_date: "2026-12-15", next_renewal_date: "2026-12-15", monthly_price_eur: 58 };
const t = (locale: string) => (key: string, values = {}) => new IntlMessageFormat(catalogs[locale][key] || key, locale).format(values) as string;
const normalizeStatus = fn(standard, "normalizeStatus");
const formatDate = fn(standard, "formatDate");
const statusPresentation = fn(standard, "statusPresentation", { normalizeStatus, getSubscriptionBillingPresentation });
function standardView(subscription: Record<string, unknown>, locale = "fr-FR") {
  const memo = initializer(standard, "view") as ts.CallExpression;
  return expression(memo.arguments[0].getText(standard), { subscription, locale, paidActionsLocked: false, i18nT: t(locale), normalizeStatus,
    getSubscriptionBillingPresentation, canStartSubscriptionCheckout, currentSubscriptionBillingPlan, formatDate, statusPresentation })();
}
function management(subscription: Record<string, unknown>, locale = "fr-FR") {
  return renderToStaticMarkup(expression(initializer(standard, "management").getText(standard), {
    view: standardView(subscription, locale), i18nT: t(locale), styles: {}, secondaryButton: {}, busyAction: null,
    openPortal() {}, updateCancellation() {}, downgradeScheduled: false,
  }));
}

test("a canceled period boundary is never presented as a next payment, including residual dates and trial cancellation", () => {
  for (const row of [endedOnRenewal, { ...endedOnRenewal, billing_cycle: "yearly" },
    { ...endedOnRenewal, status: "canceled", cancel_requested_at: null, end_date: null },
    { ...endedOnRenewal, status: "cancelled" },
    { ...endedOnRenewal, status: "trialing", next_renewal_date: "2026-11-30" }]) {
    assert.equal(getSubscriptionBillingPresentation(row).nextChargeDate, null);
    assert.equal(getSubscriptionBillingPresentation(row).noFurtherRenewal, true);
  }
  const finalNotice = getSubscriptionBillingPresentation({ ...endedOnRenewal, end_date: "2027-01-15" });
  assert.equal(finalNotice.nextChargeDate, "2026-12-15");
  assert.equal(finalNotice.finalChargeBeforeEnd, true);
  assert.equal(finalNotice.noFurtherRenewal, false);
  assert.equal(getSubscriptionBillingPresentation({ ...endedOnRenewal, cancel_requested_at: null, end_date: null }).nextChargeDate, "2026-12-15");
  assert.equal(getSubscriptionBillingPresentation({ ...endedOnRenewal, next_renewal_date: null }, "2026-11-15").nextChargeDate, null, "a guessed anniversary cannot establish another charge after cancellation");
});

test("the real Standard billing details show access through 15 December and no extra renewal in all nine locales", () => {
  for (const locale of Object.keys(catalogs)) {
    const html = management(endedOnRenewal, locale);
    const date = formatDate("2026-12-15", locale);
    assert.ok(html.includes(t(locale)("acces_maintenu_jusqu_au_4270c8d3")), locale);
    assert.ok(html.includes(date), locale);
    assert.ok(html.includes(t(locale)("resiliation_programmee_09802990")), locale);
    assert.ok(html.includes(t(locale)("subscription_no_further_renewal")), locale);
    assert.ok(!html.includes(t(locale)("premium_next_renewal_label", { date })), locale);
    assert.ok(!html.includes(t(locale)("derniere_mensualite_prevue_le_f3d69894")), locale);
  }
  assert.match(management({ ...endedOnRenewal, end_date: "2027-01-15" }), /Dernière mensualité prévue le/);
  assert.match(management({ ...endedOnRenewal, cancel_requested_at: null, end_date: null }), /Prochaine échéance/);
});

test("the actual legacy date tiles use the same cancellation boundary without a fictional renewal", () => {
  const scope: Record<string, unknown> = { ...offers, getSubscriptionBillingPresentation };
  for (const name of ["normalizePlan", "parseYMD", "lastMonthlyAnniversary", "addMonthsSafe", "addDays", "frDate", "statusLabel", "monthlyPriceTtcFromPlan", "planShortLabel"]) scope[name] = fn(legacy, name, scope);
  const memo = initializer(legacy, "computed") as ts.CallExpression;
  const computed = expression(memo.arguments[0].getText(legacy), { ...scope, sub: endedOnRenewal, checkoutState: null, locale: "fr-FR", i18nT: t("fr-FR"), accountCreatedAt: "2025-01-01" })();
  const html = renderToStaticMarkup(expression(initializer(legacy, "datesSummary").getText(legacy), { computed, styles: {}, i18nT: t("fr-FR"), SubscriptionSummaryIcon: () => null }));
  assert.match(html, /Aucun renouvellement supplémentaire prévu/);
  assert.equal(computed.nextChargeDate, null);
  assert.equal(computed.monthlyNoticeCancellation, false);
  assert.equal(computed.statusText, "Résiliation programmée");
});

test("the actual account summary never advertises a residual renewal for canceled status", () => {
  const formatSubscriptionDate = fn(account, "formatSubscriptionDate");
  const present = fn(account, "accountPlanPresentation", { formatSubscriptionDate, getSubscriptionBillingPresentation });
  for (const status of ["canceled", "cancelled"]) {
    const view = present("standard", { ...endedOnRenewal, status, cancel_requested_at: null, end_date: null }, t("fr-FR"), "fr-FR");
    assert.equal(view.detail, "Aucun renouvellement supplémentaire prévu.");
    assert.equal(view.statusView.label, t("fr-FR")("resilie_1ca48fe3"));
  }
  const scheduled = present("standard", endedOnRenewal, t("fr-FR"), "fr-FR");
  assert.match(scheduled.detail, /15\/12\/2026/);
  assert.equal(scheduled.statusView.label, "Résiliation programmée");
});
