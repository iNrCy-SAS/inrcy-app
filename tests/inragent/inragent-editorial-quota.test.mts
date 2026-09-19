import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("planned iNrAgent work has its own horizon quota and still debits the shared month", () => {
  const quota = read("lib/aiUsageQuota.ts");
  const route = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(quota, /DEFAULT_INR_AGENT_QUOTA_LIMITS[\s\S]*?7:\s*18[\s\S]*?15:\s*36[\s\S]*?30:\s*72/);
  assert.match(quota, /cycleSeconds:\s*horizonDays \* 24 \* 60 \* 60/);
  assert.match(quota, /monthUsed:\s*quotaKey\("used", "month", userId\)/);
  assert.match(quota, /agentUsed:\s*inrAgentQuotaKey\("used", horizonDays, userId\)/);
  assert.match(quota, /weekly_quota_affected:\s*false/);
  assert.match(quota, /shared_monthly_quota:\s*true/);
  assert.match(route, /editorialTarget[\s\S]*?reserveInrAgentEditorialCredits\(\{/);
  assert.match(route, /horizonDays:\s*automation\.planningHorizonDays/);
  assert.match(route, /sharedMonthlyQuota:\s*true/);
  assert.match(route, /weeklyQuotaAffected:\s*false/);
});

test("an editorial slot can only be charged once across repairs and retries", () => {
  const quota = read("lib/aiUsageQuota.ts");
  const route = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(quota, /inrAgentIdempotencyDigest/);
  assert.match(quota, /chargeState == 'committed'/);
  assert.match(quota, /reservation\.state = "bypassed"/);
  assert.match(quota, /redis\.call\('SET', KEYS\[6\], 'committed'/);
  assert.match(route, /idempotencyKey:\s*editorialTarget\.id/);
});

test("on-demand preparation keeps the normal weekly and monthly quota path", () => {
  const route = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(route, /:\s*await reserveAiCredits\(\{/);
  assert.match(route, /action:\s*"booster"/);
});
