import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { PUBLISH_CHANNEL_IDENTITY } from "../../app/dashboard/booster/publier/components/publishChannelIdentity.ts";

const sourceText = readFileSync("app/dashboard/booster/publier/components/PublishChannelSelector.tsx", "utf8");
const source = ts.createSourceFile("PublishChannelSelector.tsx", sourceText, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "getChannelAccountName");
assert.ok(declaration);
const code = ts.transpileModule(declaration.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const accountName = new Function(`${code}\nreturn getChannelAccountName;`)() as (
  info: { fullLabel: string; requiresReconnect?: boolean } | null,
  connected: boolean,
  channelLabel: string,
  companyName?: string,
) => string;

test("channel subtitles use the actual account name without truncating the underlying accessible text", () => {
  assert.equal(accountName({ fullLabel: "  Atelier des lumières — Paris  " }, true, "Facebook"), "Atelier des lumières — Paris");
  assert.equal(accountName({ fullLabel: "@atelier" }, true, "Instagram"), "@atelier");
  assert.equal(accountName({ fullLabel: "exemple.fr" }, true, "Site Web"), "exemple.fr");
});

test("connection state fallbacks and duplicated channel labels never become account names", () => {
  for (const fullLabel of ["Compte X connecté", "Compte Instagram connecté", "Page Facebook connectée", "Page LinkedIn connectée", "Fiche Google connectée", "Chaîne YouTube connectée", "Page iNr'Search publiée", "Page iNr'Search indisponible", "Site web connecté"]) {
    assert.equal(accountName({ fullLabel }, true, "Canal"), "");
  }
  assert.equal(accountName({ fullLabel: "FACEBOOK" }, true, "Facebook"), "");
  assert.equal(accountName({ fullLabel: "Reconnecter dans Mes canaux", requiresReconnect: true }, true, "Facebook"), "");
  assert.equal(accountName({ fullLabel: "Connexion indisponible" }, false, "Facebook"), "");
  assert.equal(accountName(null, true, "Facebook"), "");
});

test("iNr'Search uses the current company name while preserving connection guards", () => {
  const info = { fullLabel: "Page iNr'Search publiée" };
  assert.equal(accountName(info, true, "iNr'Search", "  Atelier Lumière  "), "Atelier Lumière");
  assert.equal(accountName(info, true, "iNr'Search", ""), "");
  assert.equal(accountName(info, false, "iNr'Search", "Atelier Lumière"), "");
  assert.equal(accountName({ ...info, requiresReconnect: true }, true, "iNr'Search", "Atelier Lumière"), "");
  assert.match(sourceText, /key === "inr_search" \? companyName : undefined/);
});

const require = createRequire(import.meta.url);
const componentCode = ts.transpileModule(sourceText, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
}).outputText;
const dependencies: Record<string, unknown> = {
  react: require("react"),
  "react/jsx-runtime": require("react/jsx-runtime"),
  "react-dom": require("react-dom"),
  "next-intl": { useTranslations: () => (key: string) => key },
  "../../../_components/DashboardViewerAccessProvider": {
    useDashboardViewerAccess: () => ({ metaPilotEnabled: true }),
  },
  "../publishModal.shared": {
    BOOSTER_CHANNEL_ORDER: ["facebook", "x"],
    getLocalizedChannelLabel: (key: string) => key === "facebook" ? "Facebook" : "X",
  },
  "../publishModal.styles": { channelBtn: {}, channelBtnDisabled: {} },
  "./PublishChannelSelector.module.css": {
    __esModule: true,
    default: new Proxy({}, { get: (_target, key) => String(key) }),
  },
  "./publishChannelIdentity": { PUBLISH_CHANNEL_IDENTITY, prewarmPublishChannelIcons() {} },
};
const componentModule = { exports: {} as { default?: ComponentType<Record<string, unknown>> } };
new Function("require", "module", "exports", componentCode)((name: string) => {
  assert.ok(Object.hasOwn(dependencies, name), `Unexpected component dependency: ${name}`);
  return dependencies[name];
}, componentModule, componentModule.exports);
const ChannelSelector = componentModule.exports.default;
assert.ok(ChannelSelector);

test("both card layouts preserve real account subtitles and logos while checking connections", () => {
  for (const isMobile of [false, true]) {
    for (const connectionsPending of [false, true]) {
      for (const xConnected of [false, true]) {
        const html = renderToStaticMarkup(createElement(ChannelSelector, {
          styles: {}, isMobile, connectionsPending,
          connected: { facebook: true, x: xConnected },
          channels: { facebook: true, x: xConnected },
          channelInfoOpen: null,
          setChannelInfoOpen() {}, toggle() {}, setAllChannelsSelected() {},
          getChannelDetailInfo: (key: string) => ({
            href: null, desktopLabel: "", mobileLabel: "",
            fullLabel: key === "facebook" ? "Atelier des lumières" : "@atelier",
          }),
        }));
        const subtitles = [...html.matchAll(/<span class="accountName" title="([^"]*)">([^<]*)<\/span>/g)]
          .map((match) => ({ title: match[1], text: match[2] }));
        const names = ["Atelier des lumières", ...(xConnected ? ["@atelier"] : [])];
        assert.deepEqual(subtitles, names.map((name) => ({ title: name, text: name })),
          JSON.stringify({ isMobile, connectionsPending, xConnected }));
        assert.match(html, /<img[^>]*src="\/icons\/x\.svg"/);
        if (connectionsPending) {
          assert.match(html, /aria-busy="true"/);
          assert.doesNotMatch(html, /role="button"/);
          assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled=""/);
        }
      }
    }
  }
  assert.doesNotMatch(sourceText, /isInfoVisible|info\.desktopLabel|info\.mobileLabel/);
  assert.match(sourceText, /className=\{css\.connectionButton\}/);
  assert.match(sourceText, /className=\{css\.desktopConnection\}/);
});
