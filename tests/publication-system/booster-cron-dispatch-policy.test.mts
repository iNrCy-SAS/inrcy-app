import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOOSTER_DISPATCH_DEFAULT_RETRY_AFTER_MS,
  BOOSTER_DISPATCH_MAX_RETRY_AFTER_MS,
  parseBoosterDispatchRetryAfterMs,
} from "../../lib/boosterCronDispatchPolicy.ts";

test("Retry-After est compris en secondes et en date HTTP avec des bornes sûres", () => {
  const nowMs = Date.parse("2026-09-18T10:00:00.000Z");

  assert.equal(parseBoosterDispatchRetryAfterMs("75", nowMs), 75_000);
  assert.equal(
    parseBoosterDispatchRetryAfterMs("Fri, 18 Sep 2026 10:02:00 GMT", nowMs),
    120_000,
  );
  assert.equal(
    parseBoosterDispatchRetryAfterMs("invalid", nowMs),
    BOOSTER_DISPATCH_DEFAULT_RETRY_AFTER_MS,
  );
  assert.equal(
    parseBoosterDispatchRetryAfterMs("999999", nowMs),
    BOOSTER_DISPATCH_MAX_RETRY_AFTER_MS,
  );
});

test("un HTTP 425 diffère le job et restaure le compteur de tentative", () => {
  const route = readFileSync(
    new URL("../../app/api/cron/booster-publications/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /response\.status === 425/);
  assert.match(route, /response\.headers\.get\("retry-after"\)/);
  assert.match(route, /\.\.\.retainedAttemptPatch/);
  assert.match(route, /dispatchDeferredUntil: deferredUntil/);
  assert.match(route, /candidate_dispatch_deferred_until/);
  assert.match(route, /booster_channel_dispatch_deferred/);
  assert.doesNotMatch(
    route.slice(
      route.indexOf('if (response.status === 425)'),
      route.indexOf('if (!response.ok)', route.indexOf('if (response.status === 425)')),
    ),
    /log\.warn|console\.warn/,
  );
});
