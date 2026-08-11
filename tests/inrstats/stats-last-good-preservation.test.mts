import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OVERVIEW_HISTORY_RETENTION_MS,
  hasUsableGmbMetrics,
  isRecentOverviewCandidate,
} from "../../lib/stats/overviewPreservation.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Google Business rejects normalized zero rows produced from an empty provider response", () => {
  assert.equal(hasUsableGmbMetrics({
    totals: {
      impressions: 0,
      websiteClicks: 0,
      callClicks: 0,
      directionRequests: 0,
      conversations: 0,
    },
    daily: [{ date: "2026-08-10", impressions: 0 }],
    raw: {},
  }), false);
});

test("Google Business accepts positive metrics and explicit provider series, including real zero series", () => {
  assert.equal(hasUsableGmbMetrics({ totals: { impressions: 41 }, raw: {} }), true);
  assert.equal(hasUsableGmbMetrics({
    totals: { impressions: 0 },
    raw: {
      multiDailyMetricTimeSeries: [
        { dailyMetricTimeSeries: [{ dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [] } }] },
      ],
    },
  }), true);
  assert.equal(hasUsableGmbMetrics({ error: "provider unavailable" }), false);
});

test("overview fallback candidates are bounded to the seven-day recovery window", () => {
  const now = Date.parse("2026-08-11T20:00:00.000Z");
  assert.equal(isRecentOverviewCandidate(new Date(now - OVERVIEW_HISTORY_RETENTION_MS + 1).toISOString(), now), true);
  assert.equal(isRecentOverviewCandidate(new Date(now - OVERVIEW_HISTORY_RETENTION_MS - 1).toISOString(), now), false);
});

test("iNrStats keeps a durable last-good source and the cleanup cron retains overview history", () => {
  const overview = read("lib/stats/buildOverview.ts");
  const shared = read("lib/stats/buildOverview.shared.ts");
  const cleanup = read("app/api/cron/cleanup-stats-cache/route.ts");
  const invalidation = read("lib/statsCache.ts");

  assert.match(overview, /source:\s*OVERVIEW_LAST_GOOD_SOURCE/);
  assert.match(overview, /cubeHasUsableData\(payload, requestedCube\)/);
  assert.match(shared, /\[OVERVIEW_LAST_GOOD_SOURCE, OVERVIEW_CACHE_SOURCE\]/);
  assert.match(shared, /if \(cube === "gmb"\) return hasUsableGmbMetrics\(metricsRec\)/);
  assert.match(cleanup, /overviewRetentionCutoff/);
  assert.match(cleanup, /\.neq\("source", OVERVIEW_CACHE_SOURCE\)/);
  assert.match(invalidation, /\.not\("source", "like", "%last_good%"\)/);
});
