import assert from "node:assert/strict";
import test from "node:test";
import { extractStatsTrend, statsTrendSegments, statsWeeklyChange, type StatsTrendPoint } from "../../app/dashboard/stats/stats.trends.ts";
import type { CubeKey, Overview } from "../../app/dashboard/stats/stats.shared.types.ts";

const overview = (key: CubeKey, metrics: unknown) => ({ sources: { [key]: { connected: true, metrics } } }) as unknown as Overview;
const consecutive = (length: number): StatsTrendPoint[] => Array.from({ length }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10), value: i < 7 ? 10 : 20 }));

test("provider daily charts preserve actual values and zeroes without inventing observations", () => {
  const trend = extractStatsTrend("facebook", overview("facebook", { daily: [
    { date: "2026-10-02", values: { page_media_view: "21" } },
    { date: "2026-10-01", values: { page_media_view: 0 } },
    { date: "2026-10-03", values: {} },
    { date: "2026-10-04", values: { page_media_view: null } },
    { date: "2026-02-31", values: { page_media_view: 999 } },
    { date: "2026-10-05", values: { page_media_view: -7 } },
  ] }), true);
  assert.equal(trend?.metricLabelKey, "vues_ff576f2b");
  assert.deepEqual(trend?.points, [{ date: "2026-10-01", value: 0 }, { date: "2026-10-02", value: 21 }]);
});

test("daily metric choice stays consistent across dates and excludes stale disconnected data", () => {
  const data = overview("youtube_shorts", { daily: [{ day: "2026-10-01", views: 7 }, { day: "2026-10-02", views: 9 }] });
  assert.equal(extractStatsTrend("youtube_shorts", data, false), null);
  assert.deepEqual(extractStatsTrend("youtube_shorts", data, true)?.points.map(point => point.value), [7, 9]);
  assert.equal(extractStatsTrend("youtube_shorts", overview("youtube_shorts", { ...data.sources.youtube_shorts?.metrics, error: "unavailable" }), true), null);
  assert.equal(extractStatsTrend("site_web", data, true), null);
  assert.equal(extractStatsTrend("facebook", overview("facebook", { daily: [{ date: "2026-10-01", values: { page_media_view: 5 } }, { date: "2026-10-02", values: { page_views_total: 7 } }] }), true), null);
});

test("Pinterest and Google Business use their normalized daily response without mixing totals", () => {
  for (const key of ["pinterest"] as const) {
    const trend = extractStatsTrend(key, overview(key, { totals: { impressions: 9_999 }, daily: [{ date: "2026-10-02", impressions: 3 }, { date: "2026-10-01", impressions: 2 }, { date: "2026-10-02", impressions: 4 }] }), true);
    assert.deepEqual(trend?.points, [{ date: "2026-10-01", value: 2 }, { date: "2026-10-02", value: 4 }]);
  }
});

test("Google Business excludes zero-filled dates without provider observations", () => {
  const daily = [{ date: "2026-10-01", impressions: 0 }, { date: "2026-10-02", impressions: 0 }];
  assert.equal(extractStatsTrend("gmb", overview("gmb", { daily }), true), null);
  const raw = { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{ dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", timeSeries: { datedValues: [{ date: { year: 2026, month: 10, day: 1 }, value: "0" }, { date: { year: 2026, month: 10, day: 3 }, value: "12" }] } }] }] };
  assert.deepEqual(extractStatsTrend("gmb", overview("gmb", { daily, raw }), true)?.points, [{ date: "2026-10-01", value: 0 }, { date: "2026-10-03", value: 12 }]);
});

test("weekly evolution requires two fully observed seven-day windows", () => {
  const points = consecutive(14);
  assert.equal(statsWeeklyChange(points), 1);
  assert.equal(statsWeeklyChange(points.slice(1)), null);
  assert.equal(statsWeeklyChange([...points.slice(0, 5), ...points.slice(6), { date: "2026-10-15", value: 20 }]), null);
  assert.equal(statsWeeklyChange(points.map((point, i) => ({ ...point, value: i < 7 ? 0 : 20 }))), null);
  assert.equal(statsWeeklyChange(points.map(point => ({ ...point, value: 5 }))), 0);
});

test("missing dates break chart lines rather than imply continuous data", () => {
  const points = [{ date: "2026-10-01", value: 1 }, { date: "2026-10-02", value: 4 }, { date: "2026-10-05", value: 6 }];
  assert.deepEqual(statsTrendSegments(points), [points.slice(0, 2), points.slice(2)]);
});

test("Instagram plots real daily reach without turning a range total into impressions", () => {
  const data=overview("instagram", {totals:{views:19374,reach:19474},daily:[{date:"2026-10-01",values:{reach:120}},{date:"2026-10-02",values:{reach:0}},{date:"2026-10-03",values:{follower_count:250}}]});
  assert.equal(extractStatsTrend("instagram",data,true)?.metricLabelKey,"metric_reach");
  assert.deepEqual(extractStatsTrend("instagram",data,true)?.points,[{date:"2026-10-01",value:120},{date:"2026-10-02",value:0}]);
  assert.equal(extractStatsTrend("instagram",overview("instagram",{totals:{views:19374}}),true),null);
  assert.equal(extractStatsTrend("instagram",data,false),null);
});
