import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAiEngineOption } from "../../lib/aiEnginePreference.ts";
import { getDefaultAllowedAiGatewayModels } from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Claude uses the current Sonnet model and the policy derives its allowlist from the engine registry", () => {
  const model = getAiEngineOption("anthropic").model;
  assert.equal(model, "anthropic/claude-sonnet-4.6");
  assert.ok(getDefaultAllowedAiGatewayModels().has(model));
});

test("a full AI Gateway endpoint in env is normalized back to a base URL", () => {
  const config = read("lib/aiGatewayConfig.ts");

  assert.match(config, /replace\(\/\\\/chat\\\/completions\$\/i, ""\)/);
  assert.match(config, /replace\(\/\\\/responses\$\/i, ""\)/);
  assert.match(config, /responses\/responses/);
  assert.match(config, /chat\/completions\/responses/);
});

test("legacy Vercel model overrides migrate to the current brand model", () => {
  const config = read("lib/aiGatewayConfig.ts");
  const fallback = read("lib/aiGenerationFallback.ts");

  for (const legacyModel of [
    "openai/gpt-4o-mini",
    "anthropic/claude-haiku-4.5",
    "google/gemini-2.5-flash-lite",
    "xai/grok-4.1-fast-non-reasoning",
    "perplexity/sonar",
    "deepseek/deepseek-v3.2",
  ]) {
    assert.match(config, new RegExp(legacyModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(config, /LEGACY_GATEWAY_MODEL_MIGRATIONS\[normalized\.toLowerCase\(\)\]/);
  assert.match(fallback, /normalizeGatewayModelId\([\s\S]*?configured \|\| DEFAULT_OPENAI_DIRECT_MODEL/);
});

test("provider error details are logged privately and 404 remains eligible for fallback", () => {
  const client = read("lib/aiGatewayClient.ts");
  const fallback = read("lib/aiGenerationFallback.ts");

  assert.match(client, /detail: safeDetail \|\| undefined/);
  assert.match(fallback, /code === "ai_gateway_unavailable"/);
  assert.match(fallback, /\[404, 408, 500, 502, 503, 504\]\.includes\(status\)/);
});
