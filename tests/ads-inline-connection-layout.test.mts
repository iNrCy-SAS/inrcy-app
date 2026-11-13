import { withUiCopy } from "./helpers/localized-ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const externalConnections = readFileSync(new URL("../app/dashboard/ads/useAdsExternalConnections.ts", import.meta.url), "utf8");
const internalSettings = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.tsx", import.meta.url), "utf8");
const externalSettings = readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8");
const openaiSettings = readFileSync(new URL("../app/dashboard/ads/OpenaiAdsConnectionSettings.tsx", import.meta.url), "utf8");
const connectionStyles = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.module.css", import.meta.url), "utf8");
const adsStyles = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

test("connection forms are inline, with no modal, duplicate channel header or step numbering", () => {
  for (const form of [internalSettings, externalSettings, openaiSettings]) {
    assert.doesNotMatch(withUiCopy(form), /SettingsDrawer|ChannelSettingsHeader|stepNumber|Étape [12] :|onClose|isOpen/);
    assert.match(withUiCopy(form), /hidden=\{!active\}/);
    assert.match(withUiCopy(form), /data-ads-connection-controls/);
  }
  assert.match(withUiCopy(client), /data-testid="ads-inline-connection"/);
  assert.doesNotMatch(withUiCopy(client), /setConfiguring|setExternalConfiguring|setOpenaiConfiguring/);
});

test("account lists follow the selected card and preserve their caches", () => {
  assert.match(withUiCopy(client), /providerAccountsCache = useRef<Partial<Record<AdsProvider, AccountResponse>>>/);
  assert.match(withUiCopy(externalConnections), /externalAccountsCache = useRef<Record<ExternalChannelId, ExternalAccountsCacheEntry>>/);
  assert.match(withUiCopy(client), /if \(cached && providerAccountsFetchedRevision\.current\[activeProvider\] === refreshRevision\)/);
  assert.match(withUiCopy(externalConnections), /if \(cached\.loaded && !force\)/);
  assert.doesNotMatch(withUiCopy(client), /externalConfiguring/);
  assert.match(withUiCopy(client), /if \(isExternalChannel\(next\)\) \{[\s\S]*?hydrateExternalChannel\(next, locked\)/);
  assert.match(withUiCopy(externalConnections), /setExternalAccounts\(locked \? \[\] : cached\.accounts\)/);
});

test("the original card geometry stays fixed and only the fields and icons adapt", () => {
  assert.match(withUiCopy(connectionStyles), /grid-template-rows: var\(--field-height\) var\(--field-height\)/);
  assert.match(withUiCopy(connectionStyles), /\.content\[hidden\] \{ display: none;/);
  assert.doesNotMatch(withUiCopy(adsStyles), /height: auto; min-height: 100dvh; overflow-x: clip/);
  assert.match(withUiCopy(adsStyles), /channelConnectionDot/);
  assert.match(withUiCopy(internalSettings), /<details className=\{styles\.identityMenu\}/);
  assert.doesNotMatch(withUiCopy(internalSettings), /<span>(Voir|Déconnecter|Comptes|Instagram)<\/span>/);
});

test("le studio affiche le canal choisi dans le titre de création", () => {
  for (const [channel, label] of Object.entries({
    meta: "Meta",
    google: "Google",
    linkedin: "LinkedIn",
    tiktok: "TikTok",
    pinterest: "Pinterest",
    x: "X",
    openai: "ChatGPT",
  })) {
    assert.match(withUiCopy(client), new RegExp(`${channel}: "${label}"`));
  }
  assert.match(withUiCopy(client), /campaignCreationTitle = i18nT\("ads_ui_4617896f39", \{ value0: CAMPAIGN_CHANNEL_NAMES\[channelId\] \}\)/);
  assert.match(withUiCopy(client), /<SettingsDrawer title=\{campaignCreationTitle\}[\s\S]*?headerStyle=\{campaignHeaderStyle\(channelId\)\}/);
  assert.match(withUiCopy(client), /wizardChannelLogo[\s\S]*?channelMeta\.logo/);
  assert.match(withUiCopy(client), /\{campaignCreationTitle\}<small>\{adsUiText\(i18nT, displayedStepNames\[step\]\)\}/);
  assert.match(withUiCopy(adsStyles), /data-channel="pinterest"[^}]*--ads-wizard-primary-rgb:230,0,35;--ads-wizard-secondary-rgb:190,24,93/);
  assert.match(withUiCopy(adsStyles), /data-channel="linkedin"[^}]*--ads-wizard-primary-rgb:10,102,194;--ads-wizard-secondary-rgb:14,165,233/);
  assert.match(withUiCopy(adsStyles), /\.wizardTitle \.wizardChannelLogo\{[\s\S]*?--ads-wizard-primary-rgb/);
});
