import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AI_CTA_CHANNELS,
  countConfiguredAiChannelCtas,
  isAiChannelCtaComplete,
  normalizeAiChannelCtaMap,
} from "../../lib/aiChannelCtaPreferences.ts";
import { buildBoosterCtaGenerationInstructions } from "../../lib/boosterCtaGenerationInstructions.ts";

test("CTA configuration starts empty and covers the ten actionable channels", () => {
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
  assert.deepEqual(Object.keys(normalized).sort(), ["gmb", "pinterest", "x"]);
  assert.equal(normalized.gmb?.url, "https://example.com/");
  assert.equal(normalized.x?.label, "Écrivez-nous");
  assert.equal(countConfiguredAiChannelCtas(normalized), 3);
  assert.equal(isAiChannelCtaComplete("pinterest", normalized.pinterest, null), false);
  assert.equal(isAiChannelCtaComplete("pinterest", normalized.pinterest, { preferredWebsiteUrl: "https://example.com" }), true);
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
    site: "website", devis: "website", appeler: "call", message: "message", whatsapp: "custom", custom: "custom",
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

test("AI writing follows configured CTA per channel and leaves unconfigured channels without CTA", () => {
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
  assert.match(instructions, /Instagram : aucun CTA configuré ; laisse le champ cta vide/);
  assert.doesNotMatch(instructions, /https:\/\/example\.com|0612345678/);
});

test("Booster and iNrAgent send the same saved channel CTA defaults to the AI writer", () => {
  const shared = readFileSync(new URL("../../lib/boosterPublishGeneration.ts", import.meta.url), "utf8");
  const booster = readFileSync(new URL("../../app/api/booster/generate/route.ts", import.meta.url), "utf8");
  const agent = readFileSync(new URL("../../app/api/agent/actions/prepare-publish/route.ts", import.meta.url), "utf8");
  const regenerated = readFileSync(new URL("../../app/api/agent/actions/regenerate-channel/route.ts", import.meta.url), "utf8");
  assert.match(shared, /buildBoosterCtaGenerationInstructions\(/);
  assert.match(shared, /const extraInstructions = \[args\.extraInstructions, ctaInstructions\]/);
  assert.ok((shared.match(/\bextraInstructions,\s*aiFeature/g) || []).length >= 1);
  for (const source of [booster, agent, regenerated]) {
    assert.match(source, /generateSharedBoosterPosts\(\{[\s\S]*?ctaDefaults/);
  }
});
