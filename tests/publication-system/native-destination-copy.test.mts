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
  assert.match(source, /description = \[pinterestNativeMessage, tagLine\]/);
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
