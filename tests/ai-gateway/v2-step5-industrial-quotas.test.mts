import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isAiGatewayAccountCostLimitEnforced } from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("V2 step 5 reserves user quota and commits only successful user actions", () => {
  const quota = read("lib/aiUsageQuota.ts");
  assert.match(quota, /export async function reserveAiCredits/);
  assert.match(quota, /export async function commitAiCredits/);
  assert.match(quota, /export async function rollbackAiCredits/);
  assert.match(quota, /state: "reserved" \| "committed" \| "rolled_back"/);
  assert.match(quota, /RESERVE_SCRIPT/);
  assert.match(quota, /COMMIT_SCRIPT/);
  assert.match(quota, /ROLLBACK_SCRIPT/);
});

test("V2 step 5 keeps only weekly and monthly user credit quotas", () => {
  const quota = read("lib/aiUsageQuota.ts");
  assert.match(quota, /week:\s*200/);
  assert.match(quota, /month:\s*500/);
  assert.doesNotMatch(quota, /AI_QUOTA_CREDITS_DAY/);
  assert.doesNotMatch(quota, /day:\s*30/);
  assert.match(quota, /const QUOTA_PERIODS: QuotaPeriod\[\] = \["week", "month"\]/);
});

test("V2 step 5 keeps multichannel Booster quota independent from channel count", () => {
  const route = read("app/api/booster/generate/route.ts");
  assert.match(route, /credits: computeBoosterAiCredits\(\{/);
  assert.doesNotMatch(route, /credits:\s*channels\.length/);
  assert.match(route, /await commitAiCredits\(quotaReservation\)/);
  assert.match(route, /await rollbackAiCredits\(quotaReservation\)/);

  const quota = read("lib/aiUsageQuota.ts");
  assert.match(quota, /AI_QUOTA_UNIT_MODEL/);
  assert.match(quota, /channelCountMultiplier:\s*false/);
  assert.match(quota, /if \(hasVideo\) return AI_QUOTA_UNIT_MODEL\.video/);
  assert.match(quota, /if \(hasImages\) return AI_QUOTA_UNIT_MODEL\.image/);
});

test("V2 step 5 separates failed Gateway attempts from successful calls and token usage", () => {
  const guard = read("lib/aiGatewayAccountGuard.ts");
  assert.match(guard, /"attempts"/);
  assert.match(guard, /"calls"/);
  assert.match(guard, /"failures"/);
  assert.match(guard, /reserveAiGatewayAccountAttempt/);
  assert.match(guard, /commitAiGatewayAccountAttempt/);
  assert.match(guard, /rollbackAiGatewayAccountAttempt/);
  assert.match(guard, /recordAiGatewayAccountFailure/);
  assert.match(guard, /dayInputTokens/);
  assert.match(guard, /monthInputTokens/);
});

test("V2 step 5 adds configurable monetary guard without hard-coding volatile model prices", () => {
  const economics = read("lib/aiGatewayEconomics.ts");
  const guard = read("lib/aiGatewayAccountGuard.ts");
  assert.match(economics, /AI_GATEWAY_MODEL_PRICING_JSON/);
  assert.match(economics, /estimateAiGatewayCostMicroUsd/);
  assert.match(guard, /AI_GATEWAY_MAX_COST_MICRO_USD_PER_ACCOUNT_DAY/);
  assert.match(guard, /AI_GATEWAY_MAX_COST_MICRO_USD_PER_ACCOUNT_MONTH/);
});

test("the media cost fuse cannot block iNrAgent editorial work", () => {
  for (const feature of [
    "agent.publish",
    "agent.media-understanding",
    "agent.campaign",
    "agent.stats-report",
  ] as const) {
    assert.equal(isAiGatewayAccountCostLimitEnforced(feature), false);
  }
  assert.equal(isAiGatewayAccountCostLimitEnforced("media.image"), true);
  assert.equal(isAiGatewayAccountCostLimitEnforced("media.video"), true);
  assert.equal(isAiGatewayAccountCostLimitEnforced("booster.publish"), true);

  const guard = read("lib/aiGatewayAccountGuard.ts");
  assert.match(guard, /local enforceCostLimit = tonumber\(ARGV\[17\]\) == 1/);
  assert.match(guard, /if enforceCostLimit and cost \+ resCost \+ estCost > costLimit/);
  assert.match(guard, /isAiGatewayAccountCostLimitEnforced\(estimate\.feature\) \? 1 : 0/);
});

test("V2 step 5 propagates typed 429 Gateway errors and Retry-After", () => {
  const client = read("lib/aiGatewayClient.ts");
  const userErrors = read("lib/apiUserFacingErrors.ts");
  assert.match(client, /class AiGatewayHttpError/);
  assert.match(client, /ai_gateway_rate_limit/);
  assert.match(client, /res\.headers\.get\("Retry-After"\)/);
  assert.match(userErrors, /retryAfterSeconds/);
  assert.match(userErrors, /"Retry-After"/);
});
