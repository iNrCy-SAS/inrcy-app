import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import type { BoosterChannelKey, BoosterPostLike } from "../../lib/boosterCta.ts";

const root = path.resolve(import.meta.dirname, "../..");
const nativeRequire = createRequire(import.meta.url);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function loadModule(file: string, fetchImpl?: typeof fetch, cache = new Map<string, Record<string, unknown>>()) {
  const filename = path.resolve(root, file);
  const cached = cache.get(filename);
  if (cached) return cached;
  const moduleRecord = { exports: {} as Record<string, unknown> };
  cache.set(filename, moduleRecord.exports);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const localRequire = (specifier: string): unknown => {
    if (specifier.startsWith("@/")) return loadModule(specifier.slice(2) + ".ts", fetchImpl, cache);
    if (specifier.startsWith(".")) return loadModule(path.resolve(path.dirname(filename), specifier), fetchImpl, cache);
    return nativeRequire(specifier);
  };
  new Function("module", "exports", "require", "fetch", code)(moduleRecord, moduleRecord.exports, localRequire, fetchImpl);
  return moduleRecord.exports;
}

const cta = loadModule("lib/boosterImageInteractionCta.ts") as typeof import("../../lib/boosterImageInteractionCta.ts");
const messages = loadModule("lib/boosterCta.ts") as typeof import("../../lib/boosterCta.ts");
const link = { label: "Réserver une visite", url: "https://example.com/visite" };
const post: BoosterPostLike = { title: "Notre atelier", content: "Découvrez notre travail.", ctaMode: "none" };
const image = { imageKey: "first", imageMeta: { interactions: { version: 1, items: [{ text: link.label, linkUrl: link.url }] } } };

test("image CTA respects provider support and existing explicit CTAs", () => {
  for (const channel of ["gmb", "facebook", "linkedin", "pinterest"] as BoosterChannelKey[]) {
    const enriched = cta.applyImageInteractionCtaFallback(channel, post, link);
    assert.equal(enriched.ctaMode, "custom");
    assert.equal(enriched.ctaUrl, link.url);
    for (const explicit of [
      { ...post, ctaMode: "website", ctaUrl: "https://other.test" },
      { ...post, cta: "Contactez-nous" },
      { ...post, ctaUrl: "https://other.test" },
      { ...post, ctaPhone: "+33123456789" },
    ]) assert.equal(cta.applyImageInteractionCtaFallback(channel, explicit, link), explicit);
  }
  for (const channel of ["inrcy_site", "site_web", "inr_search", "instagram", "tiktok", "youtube_shorts", "x"] as BoosterChannelKey[]) {
    assert.equal(cta.applyImageInteractionCtaFallback(channel, post, link), post);
  }
  assert.equal(post.ctaUrl, undefined, "shared source post must remain immutable");
});

test("primary destination follows image order and rejects unsafe or textless destinations", () => {
  assert.equal(cta.getPrimaryImageInteractionLink([image])?.url, link.url);
  assert.equal(cta.getPrimaryImageInteractionLink([{ image_interactions: { version: 1, items: [
    { text: "Danger", linkUrl: "javascript:alert(1)" },
    { linkUrl: "https://example.com/no-text" },
  ] } }]), null);
  const second = { image_interactions: { version: 1, items: [{ text: "Deuxième", linkUrl: "https://second.test" }] } };
  assert.equal(cta.getPrimaryImageInteractionLink([second, image])?.url, "https://second.test/");
});

test("the current channel transform link wins over the baked Studio interaction", () => {
  const adapted = {
    ...image,
    transform: {
      overlay: {
        items: [
          {
            id: "channel-cta",
            text: "Offre LinkedIn",
            linkUrl: "https://linkedin.example.com/offre",
            x: 50,
            y: 82,
            width: 34,
            height: 12,
          },
        ],
      },
    },
  };
  const selected = cta.getPrimaryImageInteractionLink([adapted]);
  assert.equal(selected?.url, "https://linkedin.example.com/offre");
  assert.equal(selected?.label, "Offre LinkedIn");

  const unsafeAdaptation = {
    ...image,
    transform: {
      overlay: {
        text: "Danger",
        linkUrl: "javascript:alert(1)",
      },
    },
  };
  assert.equal(
    cta.getPrimaryImageInteractionLink([unsafeAdaptation])?.url,
    link.url,
    "an invalid channel link must fall back to the safe baked interaction",
  );

  const explicit = { ...post, ctaMode: "website", ctaUrl: "https://manual.example.com" };
  assert.equal(
    cta.applyImageInteractionCtaFallback("linkedin", explicit, selected),
    explicit,
    "an explicit publication CTA must still win over every image link",
  );
});

test("async serialization and a second resolver pass do not duplicate a CTA or its caption URL", () => {
  const first = cta.applyImageInteractionCtaFallback("linkedin", post, link);
  const persisted = JSON.parse(JSON.stringify(first)) as BoosterPostLike;
  const retried = cta.applyImageInteractionCtaFallback("linkedin", persisted, link);
  assert.equal(retried, persisted);
  assert.equal(messages.buildBoosterMessage("linkedin", retried).split(link.url).length - 1, 1);
  const route = read("app/api/booster/publish-now/route.ts");
  assert.match(route, /const baseValue = \{[\s\S]*?\.\.\.getChannelPost\(channel\)/);
  assert.match(route, /post: channelPost,\s*postByChannel: \{ \[channel\]: channelPost \}/);
});

test("the real route resolver never borrows image links for video, no media, or an explicit empty selection", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  const start = route.indexOf("const getChannelPost = (channel: ChannelKey) => {");
  const end = route.indexOf("const firstPost =", start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(route.slice(start, end) + "\nreturn getChannelPost;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const factory = new Function("mediaModeByChannel", "imagesByChannel", "images", "resolveChannelPost", "getPrimaryImageInteractionLink", "applyImageInteractionCtaFallback", code);
  const resolve = (mode: string, channelImages: Record<string, unknown>) => (factory(
    { linkedin: mode }, channelImages, [image], () => ({ ...post }), cta.getPrimaryImageInteractionLink, cta.applyImageInteractionCtaFallback,
  ) as (channel: string) => BoosterPostLike)("linkedin");
  assert.equal(resolve("video", {}).ctaUrl, undefined);
  assert.equal(resolve("none", {}).ctaUrl, undefined);
  assert.equal(resolve("images", { linkedin: [] }).ctaUrl, undefined);
  assert.equal(resolve("images", { linkedin: [{ imageKey: "no-links" }] }).ctaUrl, undefined);
  assert.equal(resolve("images", {}).ctaUrl, link.url);
  assert.equal(resolve("images", { linkedin: [image] }).ctaUrl, link.url);
});

for (const scenario of ["single", "multi", "one-input", "partial", "unsafe", "no-link", "ambiguous"] as const) {
  test(`LinkedIn destination payload: ${scenario}`, async () => {
    const creates: Record<string, unknown>[] = [];
    let uploads = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/rest/images?action=initializeUpload")) {
        uploads += 1;
        return Response.json({ value: { uploadUrl: `https://upload.test/${uploads}`, image: `urn:li:image:${uploads}` } });
      }
      if (url.startsWith("https://image.test/")) {
        return scenario === "partial" && url.endsWith("2.jpg")
          ? new Response("missing", { status: 404 })
          : new Response(Uint8Array.of(1), { headers: { "content-type": "image/jpeg" } });
      }
      if (url.startsWith("https://upload.test/")) return new Response("", { status: 201 });
      if (url === "https://api.linkedin.com/rest/posts") {
        creates.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        if (scenario === "ambiguous") throw new Error("network interruption after POST");
        return Response.json({}, { status: 201, headers: { "x-restli-id": "urn:li:share:test" } });
      }
      throw new Error("Unexpected mocked endpoint");
    };
    const linkedin = loadModule("lib/linkedinPublish.ts", fakeFetch) as typeof import("../../lib/linkedinPublish.ts");
    const params = {
      accessToken: "test-only", authorUrn: "urn:li:person:test", text: "Notre atelier",
      landingPageUrl: scenario === "unsafe" ? "javascript:alert(1)" : scenario === "no-link" ? undefined : link.url,
    };
    const result = scenario === "multi" || scenario === "partial" || scenario === "one-input"
      ? await linkedin.linkedinPublishMultiImage({ ...params, imageUrls: scenario === "one-input" ? ["https://image.test/1.jpg"] : ["https://image.test/1.jpg", "https://image.test/2.jpg"] })
      : await linkedin.linkedinPublishImage({ ...params, imageUrl: "https://image.test/1.jpg" });
    assert.equal(creates.length, 1, "one publish POST only, including an ambiguous failure");
    if (scenario === "ambiguous") {
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.safeTextFallback, false);
        assert.equal(result.requestMayHaveSucceeded, true);
      }
    } else assert.equal(result.ok, true);
    const expectedUrl = scenario === "unsafe" || scenario === "no-link" ? undefined : link.url;
    assert.equal(creates[0].contentLandingPage, expectedUrl);
    assert.equal(creates[0].contentCallToActionLabel, expectedUrl ? "LEARN_MORE" : undefined);
    assert.equal(creates[0].commentary, params.text, "no provider-side duplicate caption URL");
  });
}
