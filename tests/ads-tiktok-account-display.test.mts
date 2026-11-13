import { adsComponentModules } from "./helpers/ads-component-runtime.mts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { tikTokAdsAccountDisplay } from "../lib/adsTikTokAccountDisplay.ts";
import { tikTokAdsAccountCanAssociate } from "../lib/adsTikTokPolicy.ts";
import { adsAssociationDisplayReady } from "../lib/adsConnectionSnapshot.ts";
import type { AppLocale } from "../i18n/config.ts";

type Component = typeof import("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx").default;
type Props = Parameters<Component>[0];
const require = createRequire(import.meta.url);

const componentCache = new Map<AppLocale, Component>();
function settingsComponent(locale: AppLocale = "fr-FR"): Component {
  if (componentCache.has(locale)) return componentCache.get(locale)!;
  const source = readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const container = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  const css = new Proxy({}, { get: (_target, key) => String(key) });
  const stubbed: Record<string, unknown> = {
    ...adsComponentModules(locale),
    "./AdsConnectionIcon": { default: container },
    "@/app/dashboard/_components/ChannelSettingsHeader": { default: () => null },
    "@/app/dashboard/_components/ConnectionPill": { default: ({ label }: { label?: string }) => React.createElement("span", null, label) },
    "@/app/dashboard/channel-settings": { getChannelSettingsHeaderStyle: () => ({}) },
    "@/lib/adsAccountLinks": { getAdsAdvertiserAccountUrl: () => null },
    "@/lib/adsConnectionSnapshot": { adsAssociationDisplayReady },
    "@/lib/adsTikTokAccountDisplay": { tikTokAdsAccountDisplay },
  };
  const loaded = { exports: {} as { default: Component } };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return { default: css };
    assert.ok(Object.hasOwn(stubbed, name), `Unexpected module ${name}`);
    return stubbed[name];
  });
  componentCache.set(locale, loaded.exports.default);
  return loaded.exports.default;
}

function render(channel: Props["channel"], account: Props["accounts"][number], locale: AppLocale = "fr-FR", changes: Partial<Props> = {}) {
  const noop = () => {};
  const props: Props = {
    active: true, channel,
    status: { load: "ready", configured: true, connected: true, status: "connected", selectedAccountId: "", selectedAccountName: "", error: "" },
    accounts: [account], accountChoice: "", accountsLoading: false, accountsLoaded: true, accountsLoadFailed: false,
    action: null, error: "", onSelectAccount: noop, onRefreshStatus: noop, onRefreshAccounts: noop,
    onAssociateAccount: noop, onDisconnect: noop, ...changes,
  };
  return renderToStaticMarkup(React.createElement(settingsComponent(locale), props));
}

test("TikTok account status distinguishes inactive, unknown and active accounts without claiming denied permissions", () => {
  const base = { id: "123456", name: "Annonceur", currency: "EUR", eligibleToAssociate: false };
  for (const status of ["STATUS_DISABLE", "STATUS_LIMIT", "STATUS_PENDING_CONFIRM"]) {
    const result = tikTokAdsAccountDisplay({ ...base, status });
    assert.equal(result.reason, "compte non actif");
    assert.equal(result.statusLabel, "Non actif");
    assert.match(result.help, /configuration et sa facturation/);
    assert.equal(tikTokAdsAccountCanAssociate({ ...base, status }), false);
  }
  assert.equal(tikTokAdsAccountDisplay({ ...base, status: "" }).reason, "statut non confirmé");
  assert.equal(tikTokAdsAccountCanAssociate({ ...base, status: "" }), false);
  assert.equal(tikTokAdsAccountDisplay({ ...base, status: "STATUS_ENABLE" }).reason, "association à vérifier");
  assert.deepEqual(tikTokAdsAccountDisplay({ ...base, status: "STATUS_ENABLE", eligibleToAssociate: true }), { statusLabel: "Actif", reason: "", help: "" });
  assert.equal(tikTokAdsAccountDisplay({ ...base, currency: "USD", status: "STATUS_ENABLE" }).reason, "euros requis");
  assert.equal(tikTokAdsAccountCanAssociate({ ...base, currency: "USD", status: "STATUS_ENABLE" }), false);
});

test("TikTok disabled options show status and next steps while association stays unavailable", () => {
  for (const [status, reason] of [["STATUS_DISABLE", "compte non actif"], ["", "statut non confirmé"]]) {
    const html = render("tiktok", { id: "123456", name: "Annonceur", currency: "EUR", status, eligibleToAssociate: false });
    assert.match(html, new RegExp(`<option[^>]*value="123456"[^>]*disabled=""[^>]*>[\\s\\S]*?${reason}`));
    assert.match(html, /TikTok Ads Manager/);
    assert.match(html, /rechargez vos comptes/);
    assert.doesNotMatch(html, /accès insuffisant|Associer ce compte/);
  }
});

test("other external channels retain their existing insufficient access labels", () => {
  for (const channel of ["linkedin", "pinterest", "x"] as const) {
    const html = render(channel, { id: "123456", name: "Annonceur", currency: "EUR", status: "STATUS_DISABLE", eligibleToAssociate: false });
    assert.match(html, /accès insuffisant/);
    assert.doesNotMatch(html, /compte non actif|TikTok Ads Manager/);
    assert.doesNotMatch(html, /Associer ce compte/);
  }
});


const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"] as const;
const escaped = (value: string) => renderToStaticMarkup(React.createElement(React.Fragment, null, value));

test("TikTok account reasons, help and statuses render in all nine locales while native eligibility and account names are preserved", () => {
  for (const locale of locales) for (const account of [
    { id: "123456", name: "PERSONAL ACCOUNT · 你好", currency: "EUR", status: "STATUS_DISABLE", eligibleToAssociate: false },
    { id: "123456", name: "PERSONAL ACCOUNT · 你好", currency: "EUR", status: "", eligibleToAssociate: false },
    { id: "123456", name: "PERSONAL ACCOUNT · 你好", currency: "EUR", status: "STATUS_ENABLE", eligibleToAssociate: false },
    { id: "123456", name: "PERSONAL ACCOUNT · 你好", currency: "USD", status: "STATUS_ENABLE", eligibleToAssociate: false },
  ]) {
    const before = JSON.stringify(account), modules = adsComponentModules(locale), t = modules["next-intl"].useTranslations("booster"), original = tikTokAdsAccountDisplay(account);
    const html = render("tiktok", account, locale);
    assert.ok(html.includes(account.name));
    assert.ok(html.includes(escaped(modules["./adsUiCopy"].adsUiText(t, original.reason))));
    assert.ok(html.includes(escaped(modules["./adsUiCopy"].adsUiText(t, original.help))));
    const label = original.statusLabel === "Actif" ? modules["next-intl"].useTranslations()("settings.actif_2eb75f84") : t(original.statusLabel === "Non actif" ? "ads_tiktok_inactive" : "ads_tiktok_status_unconfirmed");
    assert.ok(html.includes(escaped(label)));
    assert.match(html, /<option[^>]*value="123456"[^>]*disabled=""/);
    assert.equal(JSON.stringify(account), before, "Rendering does not write native account fields");
    if (locale !== "fr-FR") assert.doesNotMatch(html, /compte non actif|statut non confirmé|association à vérifier|Non actif|Statut non confirmé|Choisissez un compte publicitaire en euros|TikTok n’a pas confirmé/);
  }
});

test("LinkedIn known roles, unknown roles and serving rights are human and localized without changing permission flags", () => {
  const roles = [["VIEWER", "ads_role_viewer"], ["CREATIVE_MANAGER", "ads_role_creative_manager"], ["CAMPAIGN_MANAGER", "ads_role_campaign_manager"], ["ACCOUNT_MANAGER", "ads_role_account_manager"], ["ACCOUNT_BILLING_ADMIN", "ads_role_account_billing_admin"], ["PRIVATE_UNKNOWN_ROLE", "ads_role_unverified"], ["toString", "ads_role_unverified"], ["", "ads_role_unverified"]] as const;
  for (const locale of locales) for (const [role, labelKey] of roles) for (const mode of ["allowed", "management_required", "unverified", "test_account"] as const) {
    const t = adsComponentModules(locale)["next-intl"].useTranslations("booster");
    const account = { id: "123456", name: "PERSONAL LINKEDIN · 你好", currency: "EUR", eligibleToAssociate: true, permissions: role ? [role] : [], canManageCampaigns: mode === "allowed", canServeCampaigns: mode === "allowed", servingStatuses: mode === "management_required" || mode === "test_account" ? ["RUNNABLE"] : [], test: mode === "test_account" };
    const before = JSON.stringify(account), html = render("linkedin", account, locale, { accountChoice: account.id });
    assert.ok(html.includes(account.name)); assert.ok(html.includes(escaped(t(labelKey))), locale + "/" + role);
    assert.ok(html.includes(escaped(t(mode === "allowed" ? "autorisee_e2fde3bc" : "ads_management_not_authorised"))));
    assert.ok(html.includes(escaped(t(mode === "allowed" ? "autorisee_e2fde3bc" : mode === "management_required" ? "ads_serving_management_required" : "ads_serving_unverified"))));
    assert.doesNotMatch(html, /VIEWER|CREATIVE_MANAGER|CAMPAIGN_MANAGER|ACCOUNT_MANAGER|ACCOUNT_BILLING_ADMIN|PRIVATE_UNKNOWN_ROLE|RUNNABLE/);
    assert.equal(JSON.stringify(account), before);
  }
});

test("Unavailable connections, selected account titles and empty account-name fallbacks localize in all nine languages", () => {
  for (const locale of locales) {
    const t = adsComponentModules(locale)["next-intl"].useTranslations("booster"), account = { id: "123456", name: "", currency: "EUR", eligibleToAssociate: true };
    const status: Props["status"] = { load: "ready", configured: true, connected: true, status: "connected", selectedAccountId: account.id, selectedAccountName: "", error: "" };
    const chosen = render("linkedin", account, locale, { accountChoice: account.id, status });
    assert.ok(chosen.includes(escaped(t("ads_account_chosen")))); assert.ok(chosen.includes(escaped(t("compte_value_ae8bd05d", { value0: account.id }))));
    const unavailable = render("linkedin", account, locale, { status: { ...status, configured: false } });
    assert.ok(unavailable.includes(escaped(t("ads_connection_unavailable", { channel: "LinkedIn Ads" }))));
    if (locale !== "fr-FR") assert.doesNotMatch(chosen + unavailable, /Compte choisi|Connexion LinkedIn Ads indisponible|Compte 123456/);
  }
});
