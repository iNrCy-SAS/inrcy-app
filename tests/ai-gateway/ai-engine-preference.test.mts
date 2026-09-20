import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_ENGINE_OPTIONS,
  DEFAULT_AI_PREFERRED_ENGINE,
  getAiEngineOption,
  getAiPreferredEngineFromBusiness,
  normalizeAiPreferredEngine,
  resolveAiEngineRequestRouting,
} from "../../lib/aiEnginePreference.ts";

test("default engine preserves existing OpenAI behavior", () => {
  assert.equal(DEFAULT_AI_PREFERRED_ENGINE, "openai");
  assert.equal(normalizeAiPreferredEngine(undefined), "openai");
  assert.equal(getAiPreferredEngineFromBusiness(null), "openai");
});

test("legacy labels migrate to provider engine codes", () => {
  assert.equal(normalizeAiPreferredEngine("ChatGPT"), "openai");
  assert.equal(normalizeAiPreferredEngine("Claude"), "anthropic");
  assert.equal(normalizeAiPreferredEngine("Gemini"), "google");
  assert.equal(normalizeAiPreferredEngine("Mistral AI"), "mistral");
  assert.equal(normalizeAiPreferredEngine("Grok"), "xai");
  assert.equal(normalizeAiPreferredEngine("Sonar"), "perplexity");
  assert.equal(normalizeAiPreferredEngine("Deep-Seek"), "deepseek");
  assert.equal(normalizeAiPreferredEngine("Llama"), "meta");
});

test("the eight selectable engines map to provider/model Gateway identifiers", () => {
  assert.equal(AI_ENGINE_OPTIONS.length, 8);
  assert.deepEqual(
    AI_ENGINE_OPTIONS.map((option) => option.value),
    ["openai", "anthropic", "google", "mistral", "xai", "perplexity", "deepseek", "meta"],
  );

  for (const option of AI_ENGINE_OPTIONS) {
    assert.match(option.model, /^[a-z0-9-]+\/[a-z0-9.-]+$/i);
    assert.equal(getAiEngineOption(option.value).model, option.model);
  }

  assert.deepEqual(
    Object.fromEntries(AI_ENGINE_OPTIONS.map((option) => [option.value, option.model])),
    {
      openai: "openai/gpt-5.6-luna",
      anthropic: "anthropic/claude-sonnet-4.6",
      google: "google/gemini-3-flash",
      mistral: "mistral/mistral-medium-3.5",
      xai: "spacexai/grok-4.1-fast-non-reasoning",
      perplexity: "perplexity/sonar-pro",
      deepseek: "deepseek/deepseek-v4-pro-0813",
      meta: "meta/llama-4-maverick",
    },
  );
});

test("vision capability is explicit so image flows never select a text-only model blindly", () => {
  assert.equal(getAiEngineOption("deepseek").supportsVision, false);
  for (const engine of ["openai", "anthropic", "google", "mistral", "xai", "perplexity", "meta"] as const) {
    assert.equal(getAiEngineOption(engine).supportsVision, true);
  }
});

test("prompt-only JSON compatibility is explicit for engines with heterogeneous provider support", () => {
  assert.equal(getAiEngineOption("perplexity").jsonMode, "prompt-only");
  assert.equal(getAiEngineOption("deepseek").jsonMode, "prompt-only");
  assert.equal(getAiEngineOption("meta").jsonMode, "prompt-only");
  assert.equal(getAiEngineOption("openai").jsonMode, "strict");
});


test("DeepSeek keeps the selected author and requires a neutral vision prepass", () => {
  assert.deepEqual(resolveAiEngineRequestRouting("deepseek", false), {
    model: "deepseek/deepseek-v4-pro-0813",
    jsonMode: "prompt-only",
  });
  assert.throws(
    () => resolveAiEngineRequestRouting("deepseek", true),
    /préanalyse visuelle neutre/i,
  );
});
