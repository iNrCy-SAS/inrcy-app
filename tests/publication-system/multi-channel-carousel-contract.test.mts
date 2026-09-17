import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Booster conserve les lots partiels sur chaque canal multi-images", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  for (const channel of [
    "inr_search",
    "inrcy_site",
    "site_web",
    "x",
    "facebook",
    "instagram",
    "linkedin",
    "tiktok",
    "pinterest",
    "gmb",
  ]) {
    const channelIndex = route.indexOf(`ch === \"${channel}\"`);
    assert.notEqual(channelIndex, -1, `${channel} doit avoir une voie dédiée`);
  }
  assert.match(route, /channelLabel:\s*"Facebook"[\s\S]*?publishedCount:\s*Number\(resp\.uploadedImages/);
  assert.match(route, /channelLabel:\s*"LinkedIn"[\s\S]*?resp\.publishedImageCount/);
  assert.match(route, /tiktokPublishedImageUrls\s*=\s*tiktokImageUrls\.filter/);
  assert.match(route, /channelLabel:\s*"TikTok"/);
  assert.match(route, /channelLabel:\s*"Pinterest"/);
  assert.match(route, /xMediaFailures[\s\S]*?channelLabel:\s*"X"/);
  assert.doesNotMatch(
    route,
    /expectedCount\s*>\s*4[\s\S]{0,180}x_media_count_invalid/,
  );
});

test("les adaptateurs utilisent le format multi-images natif de chaque fournisseur", () => {
  const facebook = read("lib/facebookPublish.ts");
  const linkedin = read("lib/linkedinPublish.ts");
  const tiktok = read("lib/tiktokPublish.ts");
  const pinterest = read("lib/pinterestImagePinPayload.ts");
  const googleBusiness = read("lib/googleBusiness.ts");
  const x = read("lib/xPublish.ts");

  assert.match(facebook, /attached_media\[\$\{i\}\]/);
  assert.match(linkedin, /multiImage:[\s\S]*?images:\s*uploadedImages\.map/);
  assert.match(tiktok, /photo_images:\s*imageUrls\.slice\(0, 35\)/);
  assert.match(pinterest, /source_type:\s*"multiple_image_urls"/);
  assert.match(googleBusiness, /payload\.media\s*=\s*media/);
  assert.match(x, /body\.media\s*=\s*\{\s*media_ids:\s*mediaIds\s*\}/);
});

test("YouTube reste vidéo uniquement et les sites stockent tout le tableau d'images", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  assert.match(route, /const youtubeUserError = "YouTube nécessite une vidéo\."/);
  assert.match(route, /images:\s*siteImageUrls/);
  assert.match(route, /image_count:\s*siteImageUrls\.length/);
});

test("iNrSend préserve les tableaux et les avertissements lors d'un remplacement", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");
  assert.match(actions, /channelLabel:\s*"Facebook"/);
  assert.match(actions, /channelLabel:\s*"LinkedIn"/);
  assert.match(actions, /channelLabel:\s*"Pinterest"/);
  assert.match(actions, /images:\s*siteImages/);
  assert.match(actions, /getExpectedImageCount\(resolvedImageSet/);
});

test("iNrSearch expose et affiche toutes les photos dans un carrousel", () => {
  const publicData = read("lib/inrSearchPublic.ts");
  const showcase = read(
    "app/entreprises/[slug]/InrSearchNewsShowcase.tsx",
  );
  const styles = read(
    "app/entreprises/[slug]/inrSearchPublic.module.css",
  );

  assert.match(publicData, /imageUrls:\s*string\[\]/);
  assert.match(publicData, /publicationImageUrls\(/);
  assert.match(publicData, /imageUrl:\s*imageUrls\[0\]\s*\|\|\s*null/);
  assert.match(showcase, /activePublication\.imageUrls/);
  assert.match(showcase, /moveImage\(-1\)/);
  assert.match(showcase, /moveImage\(1\)/);
  assert.match(showcase, /newsOrbitImageNavigation/);
  assert.match(styles, /\.newsOrbitImageNavigation/);
});
