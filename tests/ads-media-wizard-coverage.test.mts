import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const studioCss = readFileSync(new URL("../app/dashboard/ads/ads.module.css", import.meta.url), "utf8");
const metaPack = readFileSync(new URL("../app/dashboard/ads/MetaAdsMediaPack.tsx", import.meta.url), "utf8");
const metaCss = readFileSync(new URL("../app/dashboard/ads/MetaAdsMediaPack.module.css", import.meta.url), "utf8");
const connection = readFileSync(new URL("../app/dashboard/ads/ExternalAdsConnectionSettings.tsx", import.meta.url), "utf8");
const connectionCss = readFileSync(new URL("../app/dashboard/ads/AdsConnectionSettings.module.css", import.meta.url), "utf8");

test("le wizard réserve un écran distinct aux médias et choisit le format en amont", () => {
  assert.match(client, /const hasMediaStep = adsDraftHasMediaStep\(draft\)/);
  assert.match(client, /data-media-step="true"/);
  assert.match(client, /styles\.studioDedicatedMediaCard/);
  assert.match(client, /Vos médias, visibles en entier/);
  assert.match(client, /Format sponsorisé<select/);
  assert.match(client, /Format du post X Ads<select/);
  assert.match(client, /Source média : catalogue Pinterest/);
  assert.match(client, /Aperçu complet du média/);
  assert.doesNotMatch(client, /settings\.format === "text" \|\| settings\.format === "TEXT_AD"/);
});

test("le pack Meta expose une galerie Feed et Story-Reel sans rogner les visuels", () => {
  assert.match(metaPack, /data-media-gallery="meta"/);
  assert.match(metaPack, /role="list" aria-label="Galerie des formats Meta Ads"/);
  assert.match(metaPack, /role="listitem"/);
  assert.match(metaPack, /id: "feed"/);
  assert.match(metaPack, /id: "story_reel"/);
  assert.match(metaPack, /Chaque image est affichée en entier, sans recadrage/);
  assert.match(metaCss, /\.previewImage\{object-fit:contain;/);
  assert.doesNotMatch(metaCss, /\.previewImage\{object-fit:cover;/);
  assert.match(metaCss, /min-height:clamp\(320px,43vh,500px\)/);
});

test("les aperçus génériques restent grands, responsives et non rognés", () => {
  assert.match(studioCss, /\.studioDedicatedMediaCard \.campaignMediaPreview\{height:clamp\(300px,46vh,520px\);min-height:300px/);
  assert.match(studioCss, /\.campaignMediaPreviewImage\{object-fit:contain;object-position:center\}/);
  assert.match(studioCss, /\.campaignMediaPreview video\{[^}]*object-fit:contain/);
  assert.match(studioCss, /@media\(max-width:540px\)[^\n]*\.studioDedicatedMediaCard \.campaignMediaPreview\{height:clamp\(230px,42vh,360px\)/);
});

test("LinkedIn Ads et X Ads gardent des accents et connexions publicitaires distincts", () => {
  assert.match(studioCss, /--ads-wizard-primary-rgb:10,102,194/);
  assert.match(studioCss, /\.studioCard\[data-channel=linkedin\]/);
  assert.match(studioCss, /\.studioCard\[data-channel=x\]/);
  assert.match(connectionCss, /\.linkedin\s*\{\s*--channel-rgb:\s*10,\s*102,\s*194;/);
  assert.match(connectionCss, /\.x\s*\{\s*--channel-rgb:/);
  assert.match(connection, /label: "X Ads"/);
  assert.match(connection, /Cette connexion est indépendante de vos publications organiques/);
  assert.match(connection, /\/api\/ads\/\$\{channel\}\/start/);
});
