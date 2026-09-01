import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BOOSTER_ORIGINAL_ALPHA_PRESERVING_CHANNELS,
  getBoosterOriginalPublicationExtension,
  shouldPreserveBoosterOriginalAlpha,
} from "../../lib/boosterImageOutputPolicy.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("les trois surfaces iNrCy conservent les originaux transparents", () => {
  assert.deepEqual(BOOSTER_ORIGINAL_ALPHA_PRESERVING_CHANNELS, [
    "inrcy_site",
    "site_web",
    "inr_search",
  ]);
  for (const channel of BOOSTER_ORIGINAL_ALPHA_PRESERVING_CHANNELS) {
    assert.equal(
      getBoosterOriginalPublicationExtension({
        channel,
        sourceMime: "image/png",
      }),
      "png",
    );
    assert.equal(
      shouldPreserveBoosterOriginalAlpha({
        channel,
        sourceMime: "image/webp",
      }),
      true,
    );
  }
});

test("les canaux sociaux opaques restent en JPEG léger", () => {
  for (const channel of ["gmb", "facebook", "instagram", "linkedin"] as const) {
    assert.equal(
      getBoosterOriginalPublicationExtension({
        channel,
        sourceMime: "image/png",
      }),
      "jpg",
    );
  }
});

test("le chemin original ne rend ni ne persiste de variante par canal", () => {
  const source = read("lib/boosterImageServerPreparation.ts");
  assert.match(source, /CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 8/);
  assert.match(source, /"Originale" is reference-only/);
  assert.match(source, /let cachedVariantsPromise/);
  assert.doesNotMatch(source, /renderPublicationOriginal/);
  assert.doesNotMatch(source, /originalOutputPolicy/);
});

test("Facebook envoie au plus deux images simultanément et garde l'ordre", () => {
  const source = read("lib/facebookPublish.ts");
  assert.match(source, /FACEBOOK_IMAGE_UPLOAD_CONCURRENCY = 2/);
  assert.match(source, /mapWithConcurrency/);
  assert.match(source, /new Array<R>\(values\.length\)/);
  assert.match(source, /results\[index\] = await mapper/);
});

test("Google Business ne dégrade jamais une publication avec image en texte seul", () => {
  const immediate = read("app/api/booster/publish-now/route.ts");
  const inrSend = read("lib/inrsend/publicationChannelActions.ts");
  const immediateGmb = immediate.slice(
    immediate.indexOf('if (ch === "gmb")'),
    immediate.indexOf("const unsupportedChannelMessage =", immediate.indexOf('if (ch === "gmb")')),
  );
  const inrSendGmb = inrSend.slice(
    inrSend.indexOf('if (channel === "gmb")'),
    inrSend.indexOf('if (channel === "tiktok")', inrSend.indexOf('if (channel === "gmb")')),
  );

  assert.doesNotMatch(immediateGmb, /retryWithoutMedia|published_without_image/);
  assert.doesNotMatch(inrSendGmb, /withoutMedia|published_without_image/);
  assert.match(immediateGmb, /gmb_media_preflight_failed/);
  assert.match(immediateGmb, /rebuildGoogleBusinessImages/);
  assert.match(inrSendGmb, /rebuildGoogleBusinessImagesFromSources/);
  assert.match(inrSendGmb, /gmbPatchLocalPost/);
  assert.match(inrSendGmb, /gmbDeleteLocalPost/);
});

test("aucun fond flouté n'est réintroduit", () => {
  const source = read("lib/boosterImageServerPreparation.ts");
  assert.match(source, /blurBackground: false/);
  assert.doesNotMatch(source, /\.blur\(/);
});
