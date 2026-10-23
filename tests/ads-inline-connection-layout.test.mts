import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const internalSettings = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.tsx", import.meta.url), "utf8");
const externalSettings = readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8");
const openaiSettings = readFileSync(new URL("../app/dashboard/ads/OpenaiAdsConnectionSettings.tsx", import.meta.url), "utf8");
const connectionStyles = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.module.css", import.meta.url), "utf8");
const adsStyles = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");

test("connection forms are inline, with no modal, duplicate channel header or step numbering", () => {
  for (const form of [internalSettings, externalSettings, openaiSettings]) {
    assert.doesNotMatch(form, /SettingsDrawer|ChannelSettingsHeader|stepNumber|Étape [12] :|onClose|isOpen/);
    assert.match(form, /hidden=\{!active\}/);
    assert.match(form, /data-ads-connection-controls/);
  }
  assert.match(client, /data-testid="ads-inline-connection"/);
  assert.doesNotMatch(client, /setConfiguring|setExternalConfiguring|setOpenaiConfiguring/);
});

test("account lists follow the selected card and preserve their caches", () => {
  assert.match(client, /providerAccountsCache = useRef<Partial<Record<AdsProvider, AccountResponse>>>/);
  assert.match(client, /externalAccountsCache = useRef<Record<ExternalChannelId, ExternalAccountsCacheEntry>>/);
  assert.match(client, /if \(cached && providerAccountsFetchedRevision\.current\[activeProvider\] === refreshRevision\)/);
  assert.match(client, /if \(cached\.loaded && !force\)/);
  assert.doesNotMatch(client, /externalConfiguring/);
  assert.match(client, /if \(isExternalChannel\(next\)\) \{[\s\S]*?setExternalAccounts\(locked \? \[\] : cached\.accounts\)/);
});

test("the original card geometry stays fixed and only the fields and icons adapt", () => {
  assert.match(connectionStyles, /grid-template-rows: var\(--field-height\) var\(--field-height\)/);
  assert.match(connectionStyles, /\.content\[hidden\] \{ display: none;/);
  assert.doesNotMatch(adsStyles, /height: auto; min-height: 100dvh; overflow-x: clip/);
  assert.match(adsStyles, /channelConnectionDot/);
  assert.match(internalSettings, /<details className=\{styles\.identityMenu\}/);
  assert.doesNotMatch(internalSettings, /<span>(Voir|Déconnecter|Comptes|Instagram)<\/span>/);
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
    assert.match(client, new RegExp(`${channel}: "${label}"`));
  }
  assert.match(client, /campaignCreationTitle = `Créer une campagne \$\{CAMPAIGN_CHANNEL_NAMES\[channelId\]\}`/);
  assert.match(client, /<SettingsDrawer title=\{campaignCreationTitle\}[\s\S]*?headerStyle=\{campaignHeaderStyle\(channelId\)\}/);
  assert.match(client, /wizardChannelLogo[\s\S]*?channelMeta\.logo/);
  assert.match(client, /\{campaignCreationTitle\}<small>\{displayedStepNames\[step\]\}/);
  assert.match(adsStyles, /data-channel="pinterest"[^}]*--ads-wizard-primary-rgb:230,0,35;--ads-wizard-secondary-rgb:190,24,93/);
  assert.match(adsStyles, /data-channel="linkedin"[^}]*--ads-wizard-primary-rgb:10,102,194;--ads-wizard-secondary-rgb:14,165,233/);
  assert.match(adsStyles, /\.wizardTitle \.wizardChannelLogo\{[\s\S]*?--ads-wizard-primary-rgb/);
});
