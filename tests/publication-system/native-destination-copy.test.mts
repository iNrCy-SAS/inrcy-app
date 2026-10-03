import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function loadModule(
  file: string,
  cache = new Map<string, Record<string, unknown>>(),
) {
  const filename = path.resolve(root, file);
  const cached = cache.get(filename);
  if (cached) return cached;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  cache.set(filename, moduleRecord.exports);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const localRequire = (specifier: string): unknown => {
    if (specifier.startsWith("@/")) {
      return loadModule(`${specifier.slice(2)}.ts`, cache);
    }
    if (specifier.startsWith(".")) {
      return loadModule(path.resolve(path.dirname(filename), specifier), cache);
    }
    if (specifier === "twitter-text") {
      const twitterText = nativeRequire(specifier);
      return { default: twitterText };
    }
    return nativeRequire(specifier);
  };
  new Function("module", "exports", "require", code)(
    moduleRecord,
    moduleRecord.exports,
    localRequire,
  );
  return moduleRecord.exports;
}

const messages = loadModule("lib/boosterCta.ts") as typeof import("../../lib/boosterCta.ts");
const previews = loadModule("lib/boosterPublicationTextPreview.ts") as typeof import("../../lib/boosterPublicationTextPreview.ts");
const destinationUrl = "https://example.com/reservation";
const linkedInPost = {
  title: "Atelier céramique",
  content: `Nos créations sont disponibles sur ${destinationUrl} dès aujourd’hui.`,
  ctaMode: "custom",
  cta: `Réserver une visite : ${destinationUrl}`,
  ctaUrl: destinationUrl,
};

test("native destination copy keeps useful prose and label without printing the URL", () => {
  const regular = messages.buildBoosterMessage("linkedin", linkedInPost);
  const native = messages.buildBoosterNativeDestinationMessage(
    "linkedin",
    linkedInPost,
  );

  assert.equal(regular.split(destinationUrl).length - 1, 1);
  assert.doesNotMatch(native, /https?:\/\//);
  assert.match(native, /Atelier céramique/);
  assert.match(native, /Nos créations sont disponibles dès aujourd’hui\./);
  assert.match(native, /Réserver une visite/);
  assert.doesNotMatch(native, /Réserver une visite\s*:/);
});

test("native destination formatting falls back to ordinary copy without a native URL", () => {
  const post = {
    title: "Nouveauté",
    content: "Une collection pensée pour vous.",
    ctaMode: "none",
  };
  assert.equal(
    messages.buildBoosterNativeDestinationMessage("linkedin", post),
    messages.buildBoosterMessage("linkedin", post),
  );
});

test("Pinterest native CTA retains the label but not the structured Pin link", () => {
  const text = messages.buildCtaTextForNativeDestination(
    "pinterest",
    linkedInPost,
  );
  assert.equal(text, "Réserver une visite");
  assert.doesNotMatch(text, /example\.com/);
});

test("Pinterest counter follows the sent description, excluding the native link and omitted tags", () => {
  const result = previews.getBoosterPublicationTextPreview("pinterest", {
    content: "A".repeat(480),
    ctaMode: "custom",
    cta: "Voir le site",
    ctaUrl: "https://example.com/reservation",
    hashtags: ["maison"],
  });
  assert.equal(result.text, `${"A".repeat(480)}\n\nVoir le site`);
  assert.equal(result.count, result.text.length);
  assert.equal(result.hashtagsOmitted, true);
  assert.ok(result.count <= result.max);
});

test("TikTok counter excludes tags dropped at the limit", () => {
  const result = previews.getBoosterPublicationTextPreview("tiktok", {
    content: "T".repeat(2194),
    ctaMode: "none",
    hashtags: ["idee"],
  });
  assert.equal(result.count, 2194);
  assert.equal(result.hashtagsOmitted, true);
  assert.equal(result.text, "T".repeat(2194));
});

test("X counter measures the text currently sent to the provider", () => {
  const post = {
    title: "Annonce",
    content: "Un texte concis.",
    ctaMode: "none",
    hashtags: ["bonus"],
  };
  const result = previews.getBoosterPublicationTextPreview("x", post);
  assert.equal(result.text, messages.buildBoosterMessage("x", post));
  assert.doesNotMatch(result.text, /#bonus/);
});

test("YouTube counter includes its configured automatic hashtag", () => {
  const post = { content: "Une vidéo utile.", ctaMode: "none" };
  const automatic = previews.getBoosterPublicationTextPreview("youtube_shorts", post);
  const disabled = previews.getBoosterPublicationTextPreview(
    "youtube_shorts", post, undefined, { youtubeAutoHashtags: false },
  );
  assert.match(automatic.text, /#iNrCy/);
  assert.doesNotMatch(disabled.text, /#iNrCy/);
  assert.equal(automatic.max, 4800);
});

test("YouTube counter follows the description kept by the upload adapter", () => {
  const result = previews.getBoosterPublicationTextPreview("youtube_shorts", {
    content: "Y".repeat(4900), ctaMode: "none",
  });
  assert.equal(result.count, 4800);
  assert.equal(result.text.length, 4800);
});

test("Instagram counter includes the configured phone and remains renderable above its limit", () => {
  const context = { phone: "+33123456789" };
  const result = previews.getBoosterPublicationTextPreview("instagram", {
    content: "Contactez-nous.", ctaMode: "call", cta: "Appelez-nous",
  }, context);
  assert.match(result.text, /\+33\s*1\s*23\s*45\s*67\s*89/);
  const tooLong = previews.getBoosterPublicationTextPreview("instagram", {
    content: "I".repeat(2201), ctaMode: "none",
  });
  assert.ok(tooLong.count > tooLong.max);
});

test("Booster sends deduplicated copy to LinkedIn media while text fallback keeps the URL", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  assert.match(
    route,
    /const linkedInMediaMessage = buildBoosterNativeDestinationMessage\(/,
  );
  assert.equal(
    route.match(/text: linkedInMediaMessage/g)?.length,
    3,
    "video, multi-image and image must use native-destination copy",
  );
  assert.match(
    route,
    /fallbackResp = await linkedinPublishText\(\{[\s\S]*?text: canonMessage/,
  );
  assert.match(
    route,
    /const pinterestCta = buildCtaTextForNativeDestination\(/,
  );
});

test("iNrSend replacement follows the same native destination and text-fallback contract", () => {
  const source = read("lib/inrsend/publicationChannelActions.ts");
  assert.match(
    source,
    /const linkedInMediaMessage = buildBoosterNativeDestinationMessage\(/,
  );
  assert.equal(source.match(/text: linkedInMediaMessage/g)?.length, 3);
  assert.match(
    source,
    /fallbackResp = await linkedinPublishText\(\{[\s\S]*?text: canonMessage/,
  );
  assert.match(
    source,
    /const pinterestNativeMessage = buildBoosterNativeDestinationMessage\(/,
  );
  assert.match(source, /if \(pinterestNativeMessage\.length > 500\)/);
  assert.match(
    source,
    /const descriptionWithTags = \[pinterestNativeMessage, tagLine\]\s*\.filter\(Boolean\)\s*\.join\("\\n\\n"\)/,
  );
  assert.match(
    source,
    /const description = descriptionWithTags\.length <= 500\s*\? descriptionWithTags\s*:\s*pinterestNativeMessage/,
  );
});

test("Facebook Story never receives the automatic image CTA and reports the API limitation", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  const inrSend = read("lib/inrsend/publicationChannelActions.ts");

  assert.match(
    route,
    /const isFacebookStory =[\s\S]*?facebookPublicationSettings\?\.placement === "story"/,
  );
  assert.match(
    route,
    /getChannelPostForPlacement = \([\s\S]*?placement !== "story"[\s\S]*?applyImageInteractionCtaFallback/,
  );
  assert.match(route, /facebook_story_link_sticker_required/);
  assert.match(route, /Ajoutez ce sticker dans Facebook après publication/);
  assert.match(
    route,
    /facebookPublicationSettings: canonicalFacebookPublicationSettings/,
  );

  assert.match(inrSend, /isFacebookStoryOnlyPublication/);
  assert.match(
    inrSend,
    /facebookStoryLinkUnsupported \? null : imageInteractionLink/,
  );
  assert.match(inrSend, /facebook_story_link_sticker_required/);
});
