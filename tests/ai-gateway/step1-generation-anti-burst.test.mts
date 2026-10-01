import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getBoosterGenerationSpecialErrorMessage,
  isAutomaticBoosterGenerationRetryEligible,
} from "../../lib/boosterGenerationErrorPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Booster generation anti-burst is raised to 20 requests per minute", () => {
  const route = read("app/api/booster/generate/route.ts");
  assert.match(route, /BOOSTER_GENERATION_BURST_LIMIT = 20/);
  assert.match(route, /code: "booster_generation_burst_limit"/);
});

test("local anti-burst and product quota responses never trigger an immediate retry", () => {
  assert.equal(
    isAutomaticBoosterGenerationRetryEligible(429, {
      code: "booster_generation_burst_limit",
    }),
    false,
  );
  assert.equal(
    isAutomaticBoosterGenerationRetryEligible(429, {
      code: "ai_quota_reached",
    }),
    false,
  );
  assert.equal(isAutomaticBoosterGenerationRetryEligible(429, {}), false);
});

test("a typed provider failure can still use the existing one-shot engine fallback", () => {
  assert.equal(
    isAutomaticBoosterGenerationRetryEligible(429, {
      error_code: "ai_gateway_rate_limit",
    }),
    true,
  );
  assert.equal(
    isAutomaticBoosterGenerationRetryEligible(503, {
      error_code: "ai_gateway_unavailable",
    }),
    true,
  );
});

test("an exhausted generation deadline never triggers a second doomed request", () => {
  assert.equal(
    isAutomaticBoosterGenerationRetryEligible(504, {
      error_code: "ai_operation_deadline_exceeded",
    }),
    false,
  );
});

test("anti-burst and quota messages are explicitly different", () => {
  assert.match(
    getBoosterGenerationSpecialErrorMessage({
      status: 429,
      payload: { code: "booster_generation_burst_limit" },
      retryAfterHeader: "17",
    }) || "",
    /17 secondes/,
  );
  assert.match(
    getBoosterGenerationSpecialErrorMessage({
      status: 429,
      payload: {
        code: "ai_quota_reached",
        error: "Vous avez atteint votre quota IA hebdomadaire sur ce compte.",
      },
    }) || "",
    /quota IA hebdomadaire/,
  );
});

test("the intent panel deduplicates identical media and generation errors", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );
  assert.match(
    panel,
    /new Set\([\s\S]*pdfAttachmentError\.trim\(\),[\s\S]*imgError\.trim\(\),[\s\S]*genError\.trim\(\)/,
  );
  assert.match(panel, /visibleErrors\.map/);
});
