import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { BOOSTER_CHANNEL_CONTENT_RULES, limitBoosterChannelContent } from "../../lib/boosterChannelRules.ts";
import type { BoosterCtaDefaults } from "../../lib/boosterCtaPreferences.ts";

const load = runtimeModules();
const caption = load<typeof import("../../lib/boosterCta.ts")>("lib/boosterCta.ts");
const previews = load<typeof import("../../lib/boosterPublicationTextPreview.ts")>("lib/boosterPublicationTextPreview.ts");
const { fitGeneratedInstagramPost } = load<typeof import("../../lib/instagramGeneratedCaption.ts")>("lib/instagramGeneratedCaption.ts");
const { applyImageInteractionCtaFallback } = load<typeof import("../../lib/boosterImageInteractionCta.ts")>("lib/boosterImageInteractionCta.ts");

test("Instagram validates the complete caption at 2200 UTF-16 units including selected hashtags and keeps invalid copy visible", () => {
  for (const content of ["a".repeat(2200), "🙂".repeat(1100)]) {
    const state = caption.getBoosterInstagramCaptionState({ content, ctaMode: "none", hashtags: [] });
    assert.equal(state.length, 2200); assert.equal(state.issue, null); assert.equal(caption.buildBoosterInstagramCaption({ content, ctaMode: "none" }), content);
  }
  const post = { content: "a".repeat(2197), ctaMode: "none", hashtags: ["projet"] };
  const state = caption.getBoosterInstagramCaptionState(post);
  assert.equal(state.issue?.code, "instagram_caption_too_long"); assert.equal(state.issue?.excess, state.length - 2200);
  assert.match(state.caption, /#projet$/); assert.ok(state.caption.includes(post.content));
  assert.throws(() => caption.buildBoosterInstagramCaption(post), /trop longue/);
  const preview = previews.getBoosterPublicationTextPreview("instagram", post);
  assert.equal(preview.text, state.caption); assert.equal(preview.count, state.length); assert.equal(preview.hashtagsOmitted, false);
  assert.equal(limitBoosterChannelContent("instagram", "a".repeat(2201)), "a".repeat(2201), "manual input must not be silently fitted by generated-copy ceilings");
});

test("fresh Instagram copy is fitted to the real title, CTA URL and hashtags before review without modifying the original", () => {
  const post = { title: "Notre savoir-faire en images", content: "Une réalisation préparée avec soin. ".repeat(70), cta: "Découvrez notre travail", ctaMode: "website", ctaUrl: `https://example.test/${"destination-".repeat(60)}`, hashtags: Array.from({ length: 8 }, (_, index) => `projet${index}${"local".repeat(6)}`) };
  const before = structuredClone(post), original = caption.getBoosterInstagramCaptionState(post);
  assert.ok(original.issue);
  const fitted = fitGeneratedInstagramPost(post);
  assert.deepEqual(post, before); assert.equal(fitted.ctaUrl, post.ctaUrl); assert.equal(fitted.cta, post.cta); assert.equal(fitted.title, post.title);
  assert.deepEqual(fitted.hashtags, post.hashtags); assert.ok(fitted.content.length < 1800); assert.match(fitted.content, /[.!?…]$/);
  const result = caption.getBoosterInstagramCaptionState(fitted); assert.equal(result.issue, null); assert.ok(result.length <= 2200);
  assert.ok(result.caption.includes(post.ctaUrl));
});

test("fresh Instagram image-link fitting budgets the rendered image CTA without persisting it as an explicit CTA", () => {
  const post = { title: "Notre projet", content: "Le projet avance avec une méthode claire. ".repeat(70), cta: "", ctaMode: "none", hashtags: ["renovation", "artisan"] };
  const link = { label: "Voir cette réalisation", url: `https://example.test/${"photo-".repeat(170)}` };
  const fitted = fitGeneratedInstagramPost(post, undefined, link);
  assert.equal(fitted.ctaMode, "none"); assert.equal(fitted.cta, ""); assert.equal("ctaUrl" in fitted, false);
  assert.deepEqual(fitted.hashtags, post.hashtags);
  const sent = caption.getBoosterInstagramCaptionState(applyImageInteractionCtaFallback("instagram", fitted, link));
  assert.equal(sent.issue, null); assert.ok(sent.caption.includes(link.url)); assert.ok(fitted.content.length < 1800);
});

test("Instagram generation fitting never cuts an emoji pair or rewrites an oversized fixed CTA", () => {
  const fitted = fitGeneratedInstagramPost({ title: "Projet", content: "🙂".repeat(1400), cta: "", ctaMode: "none", hashtags: ["artisan"] });
  assert.ok(fitted.content.length <= 1800); assert.doesNotMatch(fitted.content, /[\uD800-\uDBFF]$/u); assert.equal(caption.getBoosterInstagramCaptionState(fitted).issue, null);
  const impossible = { title: "Projet", content: "Texte utile.", ctaMode: "custom", cta: "Voir le projet", ctaUrl: `https://example.test/${"x".repeat(2300)}`, hashtags: ["artisan"] };
  const before = structuredClone(impossible);
  assert.throws(() => fitGeneratedInstagramPost(impossible), /trop longue/); assert.deepEqual(impossible, before);
  const noRoom = { title: "Projet", content: "Texte utile.", ctaMode: "custom", cta: "Voir le projet", ctaUrl: "https://example.test/", hashtags: Array.from({ length: 8 }, (_, index) => `projet${index}${"local".repeat(6)}`) };
  const overhead = caption.getBoosterInstagramCaptionState({ ...noRoom, content: "" }).length;
  noRoom.ctaUrl += "x".repeat(2198 - overhead);
  assert.equal(caption.getBoosterInstagramCaptionState({ ...noRoom, content: "" }).length, 2198);
  assert.throws(() => fitGeneratedInstagramPost(noRoom), /trop longue/, "do not present an empty body as successful generated copy");
});

test("the real shared generation pipeline budgets the configured Instagram CTA and fits locally without a second AI call", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const longUrl = `https://business.example.test/${"notre-savoir-faire-".repeat(45)}`;
  const providerPost = { title: "Un projet pensé pour vous", content: "Votre projet se construit avec une méthode claire. Nous préparons chaque étape avec vous pour un résultat soigné. ".repeat(25), cta: "", hashtags: ["renovation", "artisan", "projetlocal"] };
  const loader = runtimeModules({
    "@/lib/aiGatewayClient": { aiGenerateJSON: async (args: Record<string, unknown>) => { calls.push(args); return { versions: { instagram: structuredClone(providerPost) } }; } },
    "@/lib/aiGatewayPolicy": { createAiOperationBudget: () => ({ startedAt: Date.now(), maxDurationMs: 120_000 }) },
  });
  const generation = loader<typeof import("../../lib/boosterPublishGeneration.ts")>("lib/boosterPublishGeneration.ts");
  const defaults: BoosterCtaDefaults = { preferredWebsiteUrl: longUrl, siteWebUrl: longUrl, preferredWebsiteLabel: "Site", phone: "", preferredCta: "site", channelCtas: {} };
  const result = await generation.generateSharedBoosterPosts({ idea: "Un projet préparé avec soin", theme: "conseil", channels: ["instagram"], preferredEngine: "openai", ctaDefaults: defaults, profile: {}, business: {} });
  assert.equal(calls.length, 1, "local fitting does not trigger another paid generation");
  const prompt = `${calls[0].system}\n${calls[0].input}`; assert.match(prompt, /BUDGET INSTAGRAM/); assert.match(prompt, /1 800 caractères/);
  const post = result.versions.instagram!; assert.equal(post.ctaUrl, longUrl); assert.deepEqual(post.hashtags, providerPost.hashtags);
  assert.ok(post.content.length <= 1800); assert.equal(caption.getBoosterInstagramCaptionState(post).issue, null);
  assert.equal(BOOSTER_CHANNEL_CONTENT_RULES.instagram.max, 1800); assert.equal(BOOSTER_CHANNEL_CONTENT_RULES.facebook.max, 2200);
});
