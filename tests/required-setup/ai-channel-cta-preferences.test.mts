import { readAgentPublicationPreparationSource } from "../inragent/prepare-publication-sources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AI_CTA_CHANNELS,
  countConfiguredAiChannelCtas,
  isAiChannelCtaComplete,
  normalizeAiChannelCtaMap,
  resolveAiChannelCtaMap,
} from "../../lib/aiChannelCtaPreferences.ts";
import { buildBoosterCtaGenerationInstructions } from "../../lib/boosterCtaGenerationInstructions.ts";

test("raw saved CTA settings may remain empty and cover the ten actionable channels", () => {
  assert.equal(AI_CTA_CHANNELS.length, 10);
  assert.equal(AI_CTA_CHANNELS.map(({ key }) => String(key)).includes("inr_search"), false);
  assert.deepEqual(normalizeAiChannelCtaMap(undefined), {});
  assert.equal(countConfiguredAiChannelCtas({}), 0);
});

test("only explicit complete CTAs survive normalization", () => {
  const normalized = normalizeAiChannelCtaMap({
    gmb: { mode: "website", label: " Réserver ", url: "example.com", phone: "" },
    facebook: { mode: "call", label: "Appeler", phone: "+33 6 12 34 56 78" },
    instagram: { mode: "website", label: "Visiter", url: "example.com" },
    x: { mode: "message", label: "Écrivez-nous" },
    pinterest: { mode: "website", label: "Voir", url: "" },
  });
  assert.deepEqual(Object.keys(normalized).sort(), ["facebook", "gmb", "instagram", "pinterest", "x"]);
  assert.equal(normalized.facebook?.phone, "+33 6 12 34 56 78");
  assert.equal(normalized.gmb?.url, "https://example.com/");
  assert.equal(normalized.x?.label, "Écrivez-nous");
  assert.equal(countConfiguredAiChannelCtas(normalized), 5);
  assert.equal(isAiChannelCtaComplete("pinterest", normalized.pinterest, null), false);
  assert.equal(isAiChannelCtaComplete("pinterest", normalized.pinterest, { preferredWebsiteUrl: "https://example.com" }), true);
});

test("Appeler remains selectable with a phone on every CTA-capable channel", () => {
  const entries = Object.fromEntries(AI_CTA_CHANNELS.map(({ key }) => [
    key,
    { choice: "appeler", mode: "call", label: "Appeler", phone: "+33 6 12 34 56 78" },
  ]));
  const normalized = normalizeAiChannelCtaMap(entries);
  assert.equal(countConfiguredAiChannelCtas(normalized), AI_CTA_CHANNELS.length);
  for (const { key } of AI_CTA_CHANNELS) {
    assert.equal(normalized[key]?.choice, "appeler", key);
    assert.equal(normalized[key]?.phone, "+33 6 12 34 56 78", key);
    assert.equal(isAiChannelCtaComplete(key, normalized[key], null), true, key);
  }
  assert.equal(Object.hasOwn(normalizeAiChannelCtaMap({ inr_search: entries.gmb }), "inr_search"), false);
});

test("automatic site and call choices remain configured but need a real destination", () => {
  const normalized = normalizeAiChannelCtaMap({
    gmb: { choice: "devis", mode: "website", url: "https://" },
    x: { choice: "appeler", mode: "call", phone: "12" },
  });
  assert.equal(normalized.gmb?.choice, "devis");
  assert.equal(normalized.x?.choice, "appeler");
  assert.equal(isAiChannelCtaComplete("gmb", normalized.gmb, null), false);
  assert.equal(isAiChannelCtaComplete("x", normalized.x, { phone: "+33 6 12 34 56 78" }), true);
});

test("channel choices retain parity with Booster CTA mode policy", () => {
  const source = readFileSync(new URL("../../lib/boosterCta.ts", import.meta.url), "utf8");
  const choiceModes = {
    site: "website", devis: "website", reserver: "website", commander: "website", acheter: "website", inscrire: "website", appeler: "call", message: "message", whatsapp: "custom", custom: "custom",
  } as const;
  for (const { key } of AI_CTA_CHANNELS) {
    const match = source.match(new RegExp(`\\b${key}: \\[([^\\]]+)\\]`));
    assert.ok(match, `Booster mode policy missing ${key}`);
    const modes = JSON.parse(`[${match[1]}]`) as string[];
    for (const [choice, mode] of Object.entries(choiceModes)) {
      const normalized = normalizeAiChannelCtaMap({ [key]: {
        choice, mode, url: "https://example.com", phone: "+33 6 12 34 56 78",
      } });
      assert.equal(Boolean(normalized[key]), modes.includes(mode), `${key}/${choice}`);
    }
  }
});

test("AI writing follows configured CTA and fills an unset compatible channel from the real profile", () => {
  const instructions = buildBoosterCtaGenerationInstructions({
    channels: ["facebook", "gmb", "instagram"],
    channelCtas: normalizeAiChannelCtaMap({
      facebook: { choice: "whatsapp", mode: "custom", label: "Écrire sur WhatsApp", phone: "0612345678" },
      gmb: { choice: "devis", mode: "website", label: "Demander un devis" },
    }),
    destinations: { preferredWebsiteUrl: "https://example.com", phone: "0612345678" },
  });
  assert.match(instructions, /Facebook : invite uniquement à écrire sur WhatsApp/);
  assert.match(instructions, /Google Business : invite uniquement à demander un devis/);
  assert.match(instructions, /Instagram : invite uniquement à visiter le site/);
  assert.doesNotMatch(instructions, /https:\/\/example\.com|0612345678/);
});

test("unset CTAs prefer a real website and fall back to the phone according to channel policy", () => {
  const resolved = resolveAiChannelCtaMap({}, { siteWebUrl: "https://example.test", phone: "0612345678" });
  assert.equal(resolved.site_web?.choice, "site");
  assert.equal(resolved.gmb?.choice, "site");
  assert.equal(resolved.facebook?.choice, "site");
  assert.equal(resolved.instagram?.choice, "site");
  assert.equal(resolved.tiktok?.choice, "site");
  assert.equal(resolved.x?.choice, "site");
  assert.equal(resolved.youtube_shorts?.choice, "site");
  assert.equal(Object.hasOwn(resolved, "inr_search"), false);
  assert.equal(Object.values(resolved).every(config => config.url === "" && config.phone === ""), true, "Automatic destinations remain profile-driven");
  assert.equal(AI_CTA_CHANNELS.every(({ key }) => isAiChannelCtaComplete(key, resolved[key], { siteWebUrl: "https://example.test", phone: "0612345678" })), true);
});

test("automatic CTAs never invent a destination and adapt to the current account profile", () => {
  assert.deepEqual(resolveAiChannelCtaMap(undefined, null), {});
  assert.deepEqual(resolveAiChannelCtaMap({}, { siteWebUrl: "javascript:alert(1)", phone: "12" }), {});
  assert.deepEqual(resolveAiChannelCtaMap({}, { siteWebUrl: "https://user:password@example.test" }), {});
  const withoutWebsite = resolveAiChannelCtaMap({}, { phone: "0612345678" });
  assert.equal(Object.values(withoutWebsite).every(config => config.choice === "appeler"), true);
  const withoutPhone = resolveAiChannelCtaMap({}, { siteWebUrl: "https://example.test" });
  assert.equal(withoutPhone.facebook?.choice, "site");
  assert.equal(withoutPhone.instagram?.choice, "site");
  assert.equal(withoutPhone.tiktok?.choice, "site");
});

test("saved selections and an explicit no-CTA choice survive defaults, saving normalization and reload", () => {
  const original = {
    facebook: { choice: "whatsapp", mode: "custom", label: "Mon WhatsApp", url: "", phone: "0612345678" },
    instagram: { choice: "none", mode: "none", label: "", url: "", phone: "" },
  };
  const serialized = JSON.stringify(original);
  const saved = normalizeAiChannelCtaMap(original);
  const reloaded = resolveAiChannelCtaMap(JSON.parse(JSON.stringify(saved)), { siteWebUrl: "https://example.test", phone: "0698765432" });
  assert.equal(reloaded.facebook?.choice, "whatsapp");
  assert.equal(reloaded.facebook?.phone, "0612345678");
  assert.equal(reloaded.instagram?.choice, "none");
  assert.equal(isAiChannelCtaComplete("instagram", reloaded.instagram, null), true, "A deliberate no-CTA choice must remain saveable");
  assert.equal(countConfiguredAiChannelCtas({ instagram: reloaded.instagram }), 0);
  assert.equal(JSON.stringify(original), serialized, "Source settings are not mutated");
  const instructions = buildBoosterCtaGenerationInstructions({ channels: ["instagram"], channelCtas: saved, destinations: { siteWebUrl: "https://example.test", phone: "0698765432" } });
  assert.match(instructions, /Instagram : aucun CTA configuré/);
});

test("an unfinished explicit custom CTA is not replaced with an automatic action", () => {
  const resolved = resolveAiChannelCtaMap({ facebook: { choice: "custom", mode: "custom", label: "À terminer", url: "" } }, { siteWebUrl: "https://example.test", phone: "0612345678" });
  assert.equal(resolved.facebook?.choice, "none");
  assert.deepEqual(resolveAiChannelCtaMap(resolved, { siteWebUrl: "https://example.test", phone: "0612345678" }), resolved, "A second pass must not revive an incomplete explicit setting");
  assert.equal(resolved.gmb?.choice, "site");
});

test("Booster and iNrAgent send the same saved channel CTA defaults to the AI writer", () => {
  const shared = readFileSync(new URL("../../lib/boosterPublishGeneration.ts", import.meta.url), "utf8");
  const booster = readFileSync(new URL("../../app/api/booster/generate/route.ts", import.meta.url), "utf8");
  const agent = readAgentPublicationPreparationSource();
  const regenerated = readFileSync(new URL("../../app/api/agent/actions/regenerate-channel/route.ts", import.meta.url), "utf8");
  assert.match(shared, /buildBoosterCtaGenerationInstructions\(/);
  assert.match(shared, /const extraInstructions = \[args\.extraInstructions, ctaInstructions, instagramBudgetInstructions\]/);
  assert.match(shared, /const instagramBudgetInstructions = channels\.includes\("instagram"\)[\s\S]*?\? buildInstagramGenerationBudgetInstructions\(args\.ctaDefaults\)[\s\S]*?: ""/);
  assert.ok((shared.match(/\bextraInstructions,\s*aiFeature/g) || []).length >= 1);
  for (const source of [booster, agent, regenerated]) {
    assert.match(source, /generateSharedBoosterPosts\(\{[\s\S]*?ctaDefaults/);
  }
});
