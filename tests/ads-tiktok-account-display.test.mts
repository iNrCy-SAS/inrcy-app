import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { tikTokAdsAccountDisplay } from "../lib/adsTikTokAccountDisplay.ts";
import { tikTokAdsAccountCanAssociate } from "../lib/adsTikTokPolicy.ts";

type Component = typeof import("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx").default;
type Props = Parameters<Component>[0];
const require = createRequire(import.meta.url);

function settingsComponent(): Component {
  const source = readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const container = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  const css = new Proxy({}, { get: (_target, key) => String(key) });
  const stubbed: Record<string, unknown> = {
    "@/app/dashboard/SettingsDrawer": { default: container },
    "@/app/dashboard/_components/ChannelSettingsHeader": { default: () => null },
    "@/app/dashboard/_components/ConnectionPill": { default: ({ label }: { label?: string }) => React.createElement("span", null, label) },
    "@/app/dashboard/channel-settings": { getChannelSettingsHeaderStyle: () => ({}) },
    "@/lib/adsAccountLinks": { getAdsAdvertiserAccountUrl: () => null },
    "@/lib/adsConnectionSnapshot": { adsAssociationDisplayReady: () => false },
    "@/lib/adsTikTokAccountDisplay": { tikTokAdsAccountDisplay },
  };
  const loaded = { exports: {} as { default: Component } };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    if (name.endsWith(".module.css")) return { default: css };
    assert.ok(Object.hasOwn(stubbed, name), `Unexpected module ${name}`);
    return stubbed[name];
  });
  return loaded.exports.default;
}

function render(channel: Props["channel"], account: Props["accounts"][number]) {
  const noop = () => {};
  const props: Props = {
    isOpen: true, channel, previous: { name: "Précédent", onSelect: noop }, next: { name: "Suivant", onSelect: noop },
    onClose: noop, status: { load: "ready", configured: true, connected: true, status: "connected", selectedAccountId: "", selectedAccountName: "", error: "" },
    accounts: [account], accountChoice: "", accountsLoading: false, accountsLoaded: true, accountsLoadFailed: false,
    action: null, error: "", onSelectAccount: noop, onRefreshStatus: noop, onRefreshAccounts: noop,
    onAssociateAccount: noop, onDisconnect: noop,
  };
  return renderToStaticMarkup(React.createElement(settingsComponent(), props));
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
