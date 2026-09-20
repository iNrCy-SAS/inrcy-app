import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("generation fallback chain is bounded and ordered: selected model, Gateway model, OpenAI direct", () => {
  const client = read("lib/aiGatewayClient.ts");
  const primary = client.indexOf('stage: "primary"');
  const gatewayFallback = client.indexOf('stage: "gateway_model"');
  const directFallback = client.indexOf('stage: "openai_direct"');

  assert.ok(primary > 0);
  assert.ok(gatewayFallback > primary);
  assert.ok(directFallback > gatewayFallback);
  assert.match(client, /retries:\s*Math\.max\(0, Math\.min\(1, opts\.retries \?\? 0\)\)/);
  assert.equal((client.match(/retries:\s*0/g) || []).length, 2);
  assert.match(client, /resolveNextStagesReserveMs/);
});

test("Gateway fallback uses another provider and safe defaults", () => {
  const fallback = read("lib/aiGenerationFallback.ts");
  assert.match(fallback, /startsWith\("openai\/"\)[\s\S]*?\?[\s\S]*?"google"[\s\S]*?:[\s\S]*?"openai"/);
  assert.match(fallback, /AI_GATEWAY_FALLBACK_MODEL/);
  assert.match(fallback, /AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL/);
  assert.match(fallback, /expectedProviderPrefix/);
  const engines = read("lib/aiEnginePreference.ts");
  assert.match(engines, /openai\/gpt-5\.6-luna/);
  assert.match(engines, /google\/gemini-3-flash/);
});

test("economic and operation guard failures are never bypassed by fallback", () => {
  const fallback = read("lib/aiGenerationFallback.ts");
  for (const code of [
    "ai_operation_budget_exceeded",
    "ai_operation_deadline_exceeded",
    "ai_gateway_account_limit_reached",
    "ai_gateway_guard_unavailable",
  ]) {
    assert.match(fallback, new RegExp(code));
  }
  assert.match(fallback, /eligible:\s*false/);
});

test("OpenAI direct fallback is server-only, unique, non-persistent and guarded", () => {
  const client = read("lib/aiGatewayClient.ts");
  const fallback = read("lib/aiGenerationFallback.ts");
  assert.equal((client.match(/api\.openai\.com/g) || []).length, 1);
  assert.match(client, /store:\s*false/);
  assert.match(client, /reserveAiGatewayAccountAttempt/);
  assert.match(client, /commitAiGatewayAccountAttempt/);
  assert.match(fallback, /OPENAI_API_KEY/);
  assert.match(fallback, /OPENAI_DIRECT_FALLBACK_MODEL/);
  assert.match(client, /^import "server-only";/);
  assert.match(fallback, /^import "server-only";/);
});

test("all transports reuse the same prompt, schema, images and output budget", () => {
  const client = read("lib/aiGatewayClient.ts");
  assert.match(client, /async function executeAiJsonAttempt/);
  assert.match(client, /buildEffectiveSystemPrompt\(opts, target\.jsonMode\)/);
  assert.match(client, /buildStructuredFormat\(opts, target\.jsonMode\)/);
  assert.match(client, /opts\.images \|\| \[\]\)\.map/);
  assert.match(client, /max_output_tokens:\s*args\.policyMaxOutputTokens/);
  assert.match(client, /input:\s*\[[\s\S]*?\{ role: "system"/);
});

test("fallback does not multiply the product quota but counts every supplier attempt", () => {
  const client = read("lib/aiGatewayClient.ts");
  assert.equal((client.match(/reserveAiOperationBudget\(opts\.budget, maxOutputTokens\)/g) || []).length, 1);
  assert.match(client, /reserveAiGatewayAccountAttempt\(opts\.accountId/);
  assert.match(client, /Les quotas produit ne sont débités qu'une fois/);
});

test("Booster exposes the actual fallback to the user without changing saved preferences", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  const route = read("app/api/booster/generate/route.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const panel = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");

  assert.match(generation, /getAiGenerationFallbackInfo/);
  assert.match(route, /\.\.\.\(aiFallback \? \{ aiFallback \} : \{\}\)/);
  assert.match(modal, /setGenerationNotice/);
  assert.match(modal, /via la connexion OpenAI de secours/);
  assert.match(panel, /role="status"/);
  assert.doesNotMatch(generation, /ai_preferred_engine\s*=/);
});

test("deployment checks document the optional model fallback and recommended direct key", () => {
  const verify = read("scripts/verify-env.mjs");
  const admin = read("app/api/admin/settings/route.ts");
  const docs = read("docs/ENVIRONMENT_CHECKLIST.md");

  for (const variable of [
    "AI_GATEWAY_FALLBACK_MODEL",
    "AI_GATEWAY_OPENAI_PRIMARY_FALLBACK_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_DIRECT_FALLBACK_MODEL",
  ]) {
    assert.match(verify, new RegExp(variable));
    assert.match(admin, new RegExp(variable));
    assert.match(docs, new RegExp(variable));
  }
});
