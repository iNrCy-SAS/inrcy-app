import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  appendPromptOnlyJsonContract,
  extractAiGatewayResponseText,
  parseAiGatewayJsonObject,
} from "../../lib/aiGatewayResponse.ts";
import { AI_ENGINE_OPTIONS } from "../../lib/aiEnginePreference.ts";
import { AI_FEATURE_POLICIES } from "../../lib/aiGatewayPolicy.ts";
import {
  sanitizeBoosterSiteText,
  stripSiteTextFormattingPreserveLayout,
} from "../../lib/boosterFormatting.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Responses API text extraction supports output_text and nested output content", () => {
  assert.equal(extractAiGatewayResponseText({ output_text: '{"ok":true}' }), '{"ok":true}');
  assert.equal(
    extractAiGatewayResponseText({ output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }] }),
    '{"ok":true}',
  );
});

test("multi-provider JSON parser accepts clean, fenced, wrapped and double-encoded objects", () => {
  assert.deepEqual(parseAiGatewayJsonObject('{"ok":true}'), { ok: true });
  assert.deepEqual(parseAiGatewayJsonObject('```json\n{"ok":true}\n```'), { ok: true });
  assert.deepEqual(parseAiGatewayJsonObject('Voici le résultat :\n{"ok":true}\nMerci.'), { ok: true });
  assert.deepEqual(parseAiGatewayJsonObject(JSON.stringify('{"ok":true}')), { ok: true });
});

test("JSON parser rejects arrays and primitives instead of accepting an invalid app contract", () => {
  assert.throws(() => parseAiGatewayJsonObject('[{"ok":true}]'), /finalisée/);
  assert.throws(() => parseAiGatewayJsonObject('"ok"'), /finalisée/);
});


test("multi-provider JSON parser repairs literal line breaks and trailing commas conservatively", () => {
  const malformed = '{"title":"Test","content":"Ligne 1\n\nLigne 2", "hashtags":["test",],}';
  const parsed = parseAiGatewayJsonObject<{ title: string; content: string; hashtags: string[] }>(malformed);
  assert.equal(parsed.title, "Test");
  assert.equal(parsed.content, "Ligne 1\n\nLigne 2");
  assert.deepEqual(parsed.hashtags, ["test"]);
});

test("Booster uses JSON Schema structured output instead of provider-specific loose JSON mode", () => {
  const client = read("lib/aiGatewayClient.ts");
  const booster = read("lib/boosterPublishGeneration.ts");
  assert.match(client, /type:\s*"json_schema"/);
  assert.match(client, /schema:\s*opts\.responseSchema\.schema/);
  assert.match(booster, /responseSchema:\s*buildBoosterResponseSchema\(args\.channels\)/);
  assert.doesNotMatch(booster, /buildFlatChannelPostResponseSchema/);
  assert.match(booster, /Le parcours standard reste un appel/);
  assert.match(booster, /buildOutputSafeChannelBatches/);
});

test("AI generation does not retry 429 immediately and Booster stops recovery storms", () => {
  const client = read("lib/aiGatewayClient.ts");
  const booster = read("lib/boosterPublishGeneration.ts");
  assert.match(client, /retryStatuses:\s*\[408, 500, 502, 503, 504\]/);
  assert.doesNotMatch(client, /retryStatuses:\s*\[[^\]]*429/);
  assert.match(booster, /shouldAbortAiRecovery/);
  assert.match(booster, /AI Gateway error/);
  assert.match(booster, /429/);
  assert.match(booster, /rethrowIfRecoveryMustStop\(error\)/);
  assert.match(booster, /targeted-repair-once/);
  assert.doesNotMatch(booster, /single-channel-fallback|focused-recovery-/);
});

test("paragraph breaks survive JSON parsing and Booster sanitization", () => {
  const parsed = parseAiGatewayJsonObject<{ content: string }>(
    JSON.stringify({ content: "Premier paragraphe.\n\nDeuxième paragraphe.\n\nTroisième paragraphe." }),
  );
  assert.equal(parsed.content.split("\n\n").length, 3);
  assert.equal(stripSiteTextFormattingPreserveLayout(parsed.content), parsed.content);
  assert.equal(sanitizeBoosterSiteText(parsed.content), parsed.content);
});

test("social layout sanitizer removes formatting without compacting authored blank lines", () => {
  const input = "**Accroche**\n\nParagraphe deux.\n\nParagraphe trois.";
  assert.equal(
    stripSiteTextFormattingPreserveLayout(input),
    "Accroche\n\nParagraphe deux.\n\nParagraphe trois.",
  );
});

test("prompt-only engines receive a universal JSON-only and paragraph-preservation contract", () => {
  const contract = appendPromptOnlyJsonContract("SYSTEME METIER");
  assert.match(contract, /uniquement un objet JSON valide/i);
  assert.match(contract, /Aucun bloc Markdown/i);
  assert.match(contract, /deux sauts de ligne consécutifs/i);
  assert.match(contract, /Ne compacte jamais plusieurs paragraphes/i);

  const promptOnlyEngines = AI_ENGINE_OPTIONS.filter((engine) => engine.jsonMode === "prompt-only");
  assert.deepEqual(promptOnlyEngines.map((engine) => engine.value), ["perplexity", "deepseek", "meta"]);
});

test("Booster prompt explicitly requires airy paragraphs for every channel", () => {
  const prompt = read("lib/boosterPrompt.ts");
  assert.match(prompt, /paragraphes courts pour TOUS les canaux/i);
  assert.match(prompt, /deux sauts de ligne consécutifs/i);
  assert.match(prompt, /ne jamais les supprimer/i);
});

test("the per-channel length grid raises capacity with a bounded safety margin", () => {
  assert.equal(AI_FEATURE_POLICIES["booster.publish"].maxOutputTokens, 12_000);
  assert.equal(AI_FEATURE_POLICIES["agent.publish"].maxOutputTokens, 12_000);
  assert.equal(AI_FEATURE_POLICIES["templates.generate"].maxOutputTokens, 3000);

  const boosterGeneration = read("lib/boosterPublishGeneration.ts");
  const channelRules = read("lib/boosterChannelRules.ts");
  assert.match(
    boosterGeneration,
    /content:\s*limitBoosterGeneratedContent\([\s\S]*?channel,[\s\S]*?siteChannel/,
  );
  assert.match(channelRules, /inrcy_site:\s*\{[\s\S]*?deep:\s*\{ min:\s*2700, max:\s*3800 \}[\s\S]*?max:\s*4200/);
  assert.match(channelRules, /site_web:\s*\{[\s\S]*?deep:\s*\{ min:\s*3000, max:\s*4500 \}[\s\S]*?max:\s*5000/);
  assert.match(channelRules, /inr_search:\s*\{[\s\S]*?max:\s*300/);
  assert.match(
    channelRules,
    /return truncateAtNaturalBoundary\([\s\S]*?BOOSTER_CHANNEL_CONTENT_RULES\[channel\]\.max/,
  );
  assert.match(boosterGeneration, /getBoosterContentLengthForChannel/);
  assert.match(boosterGeneration, /Math\.ceil\(rule\.max \/ estimatedCharsPerToken\) \+ 260/);
  assert.match(boosterGeneration, /languageCode === "zh"[\s\S]*?languageCode === "th"/);
  assert.match(boosterGeneration, /Math\.max\(baseBudget, applyAiEngineOutputTokenCalibration\(baseBudget, engine\)\)/);
  assert.match(boosterGeneration, /return Math\.min\(12_000, getAiEngineOutputTokenLimit\(engine\)\)/);
});

test("all eight engines keep explicit model, vision and JSON-mode contracts", () => {
  assert.equal(AI_ENGINE_OPTIONS.length, 8);
  for (const engine of AI_ENGINE_OPTIONS) {
    assert.match(engine.model, /^[a-z0-9-]+\/[a-z0-9.-]+$/i);
    assert.equal(typeof engine.supportsVision, "boolean");
    assert.ok(engine.jsonMode === "strict" || engine.jsonMode === "prompt-only");
  }
});

test("final QA commands include offline, catalog and optional live checks", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(typeof pkg.scripts["qa:ai-gateway"], "string");
  assert.equal(typeof pkg.scripts["verify:ai-gateway-catalog"], "string");
  assert.equal(typeof pkg.scripts["qa:ai-gateway:live"], "string");
  assert.equal(typeof pkg.scripts["qa:ai-gateway:final"], "string");
});
