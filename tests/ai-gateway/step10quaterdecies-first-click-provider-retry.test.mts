import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Booster retries a recoverable provider failure automatically with a fresh request", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(modal, /getAutomaticAiRetryEngine/);
  assert.match(modal, /executeGenerationRequestWithRecovery\(selectedAiPreferredEngine\)/);
  assert.match(modal, /return await executeGenerationRequest\(engine\)/);
  assert.match(modal, /isAutomaticBoosterGenerationRetryEligible/);
  assert.doesNotMatch(modal, /\[429, 502, 503, 504\]\.includes\(response\.status\)/);
  assert.match(modal, /executeGenerationRequestWithRecovery\(retryEngine\)/);
  assert.match(modal, /i18nT\("generation_engine_retry"/);
  assert.match(modal, /i18nT\("value_n_a_pas_repondu_au_e653b7e3"/);
});

test("Automatic retry never changes the saved preferred engine", () => {
  const engines = read("lib/aiEnginePreference.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(engines, /getAutomaticAiRetryEngine/);
  assert.match(engines, /primary === "openai" \? "google" : "openai"/);
  assert.doesNotMatch(modal, /setSelectedAiPreferredEngine\(retryEngine\)/);
});

test("Multimodal provider-specific 400/409/422 errors remain eligible for another engine", () => {
  const gateway = read("lib/aiGatewayClient.ts");

  assert.match(gateway, /function classifyAiAttemptFallback/);
  assert.match(gateway, /hasImages/);
  assert.match(gateway, /ai_gateway_invalid_request/);
  assert.match(gateway, /\[400, 409, 422\]\.includes\(status\)/);
  assert.match(gateway, /reason: "provider_incompatible"/);
  assert.equal((gateway.match(/classifyAiAttemptFallback\(error, hasImages\)/g) || []).length, 2);
});

test("Media generation switches provider instead of retrying the same failing model", () => {
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(
    generation,
    /retries: mode === "repair" \|\| Boolean\(args\.imagesForAI\?\.length\) \? 0 : 1/,
  );
});
