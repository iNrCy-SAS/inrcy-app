import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("Instagram classe la limite Meta comme une erreur relançable", () => {
  const publisher = read("../../lib/instagramPublish.ts");

  assert.match(publisher, /isMetaRateLimitError/);
  assert.match(publisher, /code: "instagram_rate_limited"/);
  assert.match(publisher, /retryable: true/);
  assert.match(publisher, /retryAfterMs: 60_000/);
  assert.match(publisher, /isInstagramRateLimitErrorResult/);
});

test("le worker Instagram diffère la reprise et le cron respecte l'échéance", () => {
  const route = read("../../app/api/booster/publish-now/route.ts");
  const cron = read("../../app/api/cron/booster-publications/route.ts");

  assert.match(route, /queueInstagramRateLimitRetry/);
  assert.match(route, /instagramRateLimitNextRunAt/);
  assert.match(route, /status: "queued"/);
  assert.match(route, /error: "instagram_rate_limited"/);
  assert.match(cron, /candidate_instagram_rate_limit_next_run_at/);
  assert.match(
    cron,
    /timestampMs\(row\.candidate_instagram_rate_limit_next_run_at\) > nowMs/,
  );
});
