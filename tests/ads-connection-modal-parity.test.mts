import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const internalSettings = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.tsx", import.meta.url), "utf8");
const externalSettings = readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8");
const connectionStyles = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.module.css", import.meta.url), "utf8");
const adsStyles = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const drawer = readFileSync(new URL("../app/dashboard/SettingsDrawer.tsx", import.meta.url), "utf8");

test("les six modales iNrADS suivent le même cycle sans fermer le panneau", () => {
  const catalog = client.split("const CHANNEL_CATALOG")[1]?.split("];", 1)[0] || "";
  const order = ["meta", "google", "linkedin", "tiktok", "pinterest", "x"];
  let cursor = -1;
  for (const channel of order) {
    const next = catalog.indexOf(`id: "${channel}"`);
    assert.ok(next > cursor, `${channel} doit suivre l’ordre global des canaux`);
    cursor = next;
  }
  assert.match(client, /previousConnectionChannel[\s\S]*connectionChannelIndex - 1/);
  assert.match(client, /nextConnectionChannel[\s\S]*connectionChannelIndex \+ 1/);
  assert.match(client, /openChannelConfiguration\(previousConnectionChannel\.id\)/);
  assert.match(client, /openChannelConfiguration\(nextConnectionChannel\.id\)/);
  assert.match(internalSettings, /<ChannelSettingsHeader[\s\S]*previous=\{previous\}[\s\S]*next=\{next\}/);
  assert.match(externalSettings, /<ChannelSettingsHeader[\s\S]*previous=\{previous\}[\s\S]*next=\{next\}/);
  assert.match(internalSettings, /keepMounted/);
  assert.match(externalSettings, /keepMounted/);
  assert.match(drawer, /keepMounted \|\| isOpen/);
});

test("LinkedIn, TikTok, Pinterest et X réutilisent les deux cartes horizontales de Meta et Google", () => {
  for (const channel of ["linkedin", "tiktok", "pinterest", "x"]) {
    assert.match(externalSettings, new RegExp(`\\b${channel}: \\{`));
    assert.match(connectionStyles, new RegExp(`\\.${channel} \\{[\\s\\S]*?--channel-rgb:`));
  }
  assert.match(externalSettings, /socialStyles\.stepCard/);
  assert.match(externalSettings, /Étape 1 : Votre connexion/);
  assert.match(externalSettings, /Étape 2 : Compte annonceur/);
  assert.match(externalSettings, /<ConnectionPill/);
  assert.match(externalSettings, /channelSettingsAllChannelsButton/);
  assert.doesNotMatch(client, /externalSettingsIntro/);
  assert.doesNotMatch(client, /externalSettingsGrid/);
  assert.match(connectionStyles, /\.resourceControls\s*\{[\s\S]*?grid-template-columns:\s*minmax\(260px, 1fr\) auto/);
  assert.match(connectionStyles, /@media \(max-width: 1280px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(connectionStyles, /\.step\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/);
});

test("Pinterest conserve sa touche rouge et magenta sans modifier ses routes OAuth", () => {
  assert.match(connectionStyles, /\.pinterest \{\s*--channel-rgb: 230, 0, 35;\s*--channel-secondary-rgb: 190, 24, 93;/);
  assert.match(externalSettings, /pinterest:[\s\S]*?logo: "\/ads-logos\/pinterest\.svg"/);
  assert.match(externalSettings, /`\/api\/ads\/\$\{channel\}\/start/);
  assert.match(externalSettings, /Autoriser la gestion/);
  assert.match(externalSettings, /oauthHref\(channel, "manage"\)/);
});

test("un compte Pinterest associé expose Voir le compte dans la carte et dans la modale", () => {
  assert.match(client, /externalAdvertiserAccountUrl = externalChannel[\s\S]*getAdsAdvertiserAccountUrl\(externalChannel, externalStatuses\[externalChannel\]\.selectedAccountId\)/);
  assert.match(client, /externalAdvertiserAccountUrl \? <a className=\{styles\.channelViewAccount\}[\s\S]*?target="_blank"[\s\S]*?>Voir le compte<\/a>/);
  assert.match(externalSettings, /configuredAccountUrl = getAdsAdvertiserAccountUrl\(channel, status\.selectedAccountId\)/);
  assert.match(externalSettings, /configuredAccountUrl \? <a[\s\S]*?target="_blank"[\s\S]*?>Voir le compte<\/a>/);
});

test("le studio affiche le canal choisi dans le titre de création", () => {
  for (const [channel, label] of Object.entries({
    meta: "Meta",
    google: "Google",
    linkedin: "LinkedIn",
    tiktok: "TikTok",
    pinterest: "Pinterest",
    x: "X",
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
