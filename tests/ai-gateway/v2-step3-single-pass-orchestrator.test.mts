import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AI_FEATURE_POLICIES } from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

test("V2 step 3 uses one primary multichannel call regardless of channel count", () => {
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(generation, /V2 Étape 3 : 1 appel principal quel que soit le nombre de canaux sélectionnés/);
  assert.match(generation, /channels,\n\s+profile: args\.profile/);
  assert.match(generation, /mode: "primary"/);
  assert.doesNotMatch(generation, /CHANNEL_BATCH_SIZE/);
  assert.doesNotMatch(generation, /buildGenerationBatches/);
  assert.doesNotMatch(generation, /single-channel-fallback/);
});

test("V2 step 3 performs local validation then at most one grouped targeted repair", () => {
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(generation, /collectChannelQualityIssues\(/);
  assert.match(generation, /async function repairChannelsOnce\(/);
  assert.match(generation, /stage: "targeted-repair-once"/);
  assert.match(generation, /mode: "repair"/);
  assert.match(generation, /retries: mode === "repair" \|\| Boolean\(args\.imagesForAI\?\.length\) \? 0 : 1/);
  assert.doesNotMatch(generation, /focused-recovery-/);
  assert.doesNotMatch(generation, /standard-retry/);
  assert.doesNotMatch(generation, /youtube-rescue-/);
});

test("V2 step 3 operation budgets are channel-count independent and fit 120 second routes", () => {
  for (const feature of ["booster.publish", "agent.publish"] as const) {
    const policy = AI_FEATURE_POLICIES[feature];
    assert.equal(policy.defaultOperationMaxCalls, 2);
    assert.ok(policy.defaultOperationMaxReservedOutputTokens >= 2 * policy.maxOutputTokens);
    assert.ok(policy.defaultOperationMaxDurationMs < 120_000);
  }
});

test("V2 step 3 removes the global 8000-token client clamp so Booster can use its own dynamic policy", () => {
  const client = read("lib/aiGatewayClient.ts");
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(client, /Math\.min\(policy\.maxOutputTokens, opts\.maxOutputTokens \?\? 700\)/);
  assert.doesNotMatch(client, /Math\.min\(policy\.maxOutputTokens, 8000,/);
  assert.match(generation, /Math\.min\(10_000, Math\.max\(minimum, contentBudget\)\)/);
});
