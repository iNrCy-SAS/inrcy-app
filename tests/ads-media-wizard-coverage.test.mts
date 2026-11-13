import { withUiCopy } from "./helpers/localized-ui-source.mjs";
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
  assert.match(withUiCopy(client), /const hasMediaStep = adsDraftHasMediaStep\(draft\)/);
  assert.match(withUiCopy(client), /data-media-step="true"/);
  assert.match(withUiCopy(client), /styles\.studioDedicatedMediaCard/);
  assert.match(withUiCopy(client), /Vos médias, visibles en entier/);
  assert.match(withUiCopy(client), /Format sponsorisé[\s\S]{0,100}<select/);
  assert.match(withUiCopy(client), /Format du post X Ads[\s\S]{0,100}<select/);
  assert.match(withUiCopy(client), /Source média : catalogue Pinterest/);
  assert.match(withUiCopy(client), /Aperçu complet du média/);
  assert.doesNotMatch(withUiCopy(client), /settings\.format === "text" \|\| settings\.format === "TEXT_AD"/);
});

test("le pack Meta expose une galerie Feed et Story-Reel sans rogner les visuels", () => {
  assert.match(withUiCopy(metaPack), /data-media-gallery="meta"/);
  assert.match(withUiCopy(metaPack), /role="list" aria-label=\{i18nT\("galerie_des_formats_meta_ads_ece13be6"\)/);
  assert.match(withUiCopy(metaPack), /role="listitem"/);
  assert.match(withUiCopy(metaPack), /id: "feed"/);
  assert.match(withUiCopy(metaPack), /id: "story_reel"/);
  assert.match(withUiCopy(metaPack), /Chaque image est affichée en entier, sans recadrage/);
  assert.match(withUiCopy(metaCss), /\.previewImage\{object-fit:contain;/);
  assert.doesNotMatch(withUiCopy(metaCss), /\.previewImage\{object-fit:cover;/);
  assert.match(withUiCopy(metaCss), /min-height:clamp\(320px,43vh,500px\)/);
});

test("les aperçus génériques restent grands, responsives et non rognés", () => {
  assert.match(withUiCopy(studioCss), /\.studioDedicatedMediaCard \.campaignMediaPreview\{height:clamp\(300px,46vh,520px\);min-height:300px/);
  assert.match(withUiCopy(studioCss), /\.campaignMediaPreviewImage\{object-fit:contain;object-position:center\}/);
  assert.match(withUiCopy(studioCss), /\.campaignMediaPreview video\{[^}]*object-fit:contain/);
  assert.match(withUiCopy(studioCss), /@media\(max-width:540px\)[^\n]*\.studioDedicatedMediaCard \.campaignMediaPreview\{height:clamp\(230px,42vh,360px\)/);
});

test("LinkedIn Ads et X Ads gardent des accents et connexions publicitaires distincts", () => {
  assert.match(withUiCopy(studioCss), /--ads-wizard-primary-rgb:10,102,194/);
  assert.match(withUiCopy(studioCss), /\.studioCard\[data-channel=linkedin\]/);
  assert.match(withUiCopy(studioCss), /\.studioCard\[data-channel=x\]/);
  assert.match(withUiCopy(connectionCss), /\.linkedin\s*\{\s*--channel-rgb:\s*10,\s*102,\s*194;/);
  assert.match(withUiCopy(connectionCss), /\.x\s*\{\s*--channel-rgb:/);
  assert.match(withUiCopy(connection), /label: "X Ads"/);
  assert.match(withUiCopy(connection), /Cette connexion est indépendante de vos publications organiques/);
  assert.match(withUiCopy(connection), /\/api\/ads\/\$\{channel\}\/start/);
});
