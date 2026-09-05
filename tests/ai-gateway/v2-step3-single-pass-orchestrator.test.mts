import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AI_FEATURE_POLICIES } from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) =>
  readFileSync(resolve(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

test("V2 step 3 keeps one call when it fits and creates output-safe batches when required", () => {
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(generation, /export function buildOutputSafeChannelBatches/);
  assert.match(generation, /estimateMaxOutputTokens\(candidate, mode, preferences\) > safeLimit/);
  assert.match(generation, /BOOSTER_OUTPUT_BUDGET_SAFETY_RATIO = 0\.94/);
  assert.match(generation, /Promise\.allSettled\(\s*primaryBatches\.map/);
  assert.match(generation, /channels: batch,\n\s+profile: args\.profile/);
  assert.match(generation, /mode: "primary"/);
  assert.doesNotMatch(generation, /CHANNEL_BATCH_SIZE/);
  assert.doesNotMatch(generation, /single-channel-fallback/);
});

test("V2 step 3 performs local validation then one output-safe repair phase", () => {
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(generation, /collectChannelQualityIssues\(/);
  assert.match(generation, /async function repairChannelsOnce\(/);
  assert.match(generation, /stage: "targeted-repair-once"/);
  assert.match(generation, /Promise\.allSettled\(\s*repairBatches\.map/);
  assert.match(generation, /mode: "repair"/);
  assert.match(generation, /retries: mode === "repair" \|\| Boolean\(args\.imagesForAI\?\.length\) \? 0 : 1/);
  assert.doesNotMatch(generation, /focused-recovery-/);
  assert.doesNotMatch(generation, /standard-retry/);
  assert.doesNotMatch(generation, /youtube-rescue-/);
});

test("V2 step 3 defaults fit 120 second routes and deep batches resize their own operation budget", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  for (const feature of ["booster.publish", "agent.publish"] as const) {
    const policy = AI_FEATURE_POLICIES[feature];
    assert.equal(policy.defaultOperationMaxCalls, 2);
    assert.ok(policy.defaultOperationMaxReservedOutputTokens >= 2 * policy.maxOutputTokens);
    assert.ok(policy.defaultOperationMaxDurationMs < 120_000);
  }
  assert.match(generation, /maxCalls: primaryBatches\.length \+ maximumRepairBatches\.length/);
  assert.match(generation, /maxReservedOutputTokens: maximumReservedOutputTokens/);
});

test("V2 step 3 removes the global 8000-token client clamp so Booster can use its own dynamic policy", () => {
  const client = read("lib/aiGatewayClient.ts");
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(client, /Math\.min\(policy\.maxOutputTokens, opts\.maxOutputTokens \?\? 700\)/);
  assert.doesNotMatch(client, /Math\.min\(policy\.maxOutputTokens, 8000,/);
  assert.match(generation, /return Math\.min\(12_000, getAiEngineOutputTokenLimit\(engine\)\)/);
  assert.match(generation, /Math\.min\(hardLimit, Math\.max\(minimum, lengthAdjustedBudget\)\)/);
});
