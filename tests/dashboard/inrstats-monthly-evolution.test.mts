import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { statsCalendarMonths } from "../../app/dashboard/stats/stats.months.ts";
import { measuredStatsVisibility } from "../../app/dashboard/stats/stats.visibility.ts";
import { monthlyMeasuredStats, commonMonthlyChange } from "../../app/dashboard/stats/stats.monthly-metrics.ts";
import type { Overview } from "../../app/dashboard/stats/stats.shared.types.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

test("Evolution uses exact calendar months across year and Paris day boundaries", () => {
  const months = statsCalendarMonths(new Date("2026-01-01T23:30:00Z"));
  assert.deepEqual(months, [
    { key: "2025-11", start: "2025-11-01", end: "2025-11-30", days: 30, current: false },
    { key: "2025-12", start: "2025-12-01", end: "2025-12-31", days: 31, current: false },
    { key: "2026-01", start: "2026-01-01", end: "2026-01-01", days: 1, current: true },
  ]);
  const first = statsCalendarMonths(new Date("2026-03-01T12:00:00Z"));
  assert.equal(first[2].days, 0);
  assert.equal(first[1].days, 28);
});

test("visibility weight uses measured exposure, keeps zeroes and excludes followers and forecasts", () => {
  const overview = { sources: { facebook: { connected: true, metrics: { totals: { page_media_view: 0, followers_count: 20000 } } } } } as unknown as Overview;
  assert.equal(measuredStatsVisibility("facebook", overview), 0);
  assert.equal(measuredStatsVisibility("facebook", { ...overview, sources: { facebook: { connected: true, metrics: { totals: { followers_count: 20000 } } } } } as unknown as Overview), null);
  assert.equal(measuredStatsVisibility("x", overview), null);
  assert.equal(measuredStatsVisibility("mails", overview), null);
  assert.equal(measuredStatsVisibility("gmb", { sources: { gmb: { connected: true, metrics: { totals: { impressions: 0 }, daily: [{ date: "2026-10-01", impressions: 0 }] } } } } as unknown as Overview), null);
});

test("historical monthly totals reject mismatched snapshots, partial rolling windows and cumulative-only providers", () => {
  const month = statsCalendarMonths(new Date("2026-10-24T12:00:00Z"))[1];
  const source = { days: 30, meta: { snapshotDate: "2026-09-30" }, totals: { impressions: 1000, clicks: 23 }, sources: { site_web: { connected: { gsc: true, ga4: true } } } } as unknown as Overview;
  assert.deepEqual(monthlyMeasuredStats("site_web", source, month), { visibility: 1000, clicks: 23 });
  assert.deepEqual(monthlyMeasuredStats("site_web", { ...source, meta: { snapshotDate: "2026-10-23" } }, month), { visibility: null, clicks: null });
  assert.deepEqual(monthlyMeasuredStats("site_web", source, { ...month, days: 3 }), { visibility: null, clicks: null });
  assert.deepEqual(monthlyMeasuredStats("tiktok", source, month), { visibility: null, clicks: null });
});

test("monthly growth is displayed only for the same observed channel set", () => {
  assert.equal(commonMonthlyChange({ facebook: { visibility: 100, clicks: null } }, { facebook: { visibility: 150, clicks: null } }, "visibility"), .5);
  assert.equal(commonMonthlyChange({ facebook: { visibility: 100, clicks: null } }, { facebook: { visibility: 150, clicks: null }, gmb: { visibility: 20, clicks: 5 } }, "visibility"), null);
  assert.equal(commonMonthlyChange({ facebook: { visibility: 0, clicks: null } }, { facebook: { visibility: 150, clicks: null } }, "visibility"), null);
});

test("the real monthly internal endpoint scopes every count to the authenticated active account and exact dates", async () => {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const db = { from(table: string) {
    const call = { table, filters: {} as Record<string, unknown> }; calls.push(call);
    const builder = { select(_columns: string, options: unknown) { assert.deepEqual(options, { count: "exact", head: true }); return builder; },
      eq(column: string, value: unknown) { call.filters[column] = value; return builder; },
      gte(column: string, value: unknown) { call.filters[`gte:${column}`] = value; return builder; },
      lt(column: string, value: unknown) { call.filters[`lt:${column}`] = value; return builder; },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve(resolve({ error: null, count: 7 })); } };
    return builder;
  } };
  const load = runtimeModules({ "@/lib/requireUser": { requireUser: async () => ({ errorResponse: null, activeUserId: "active-establishment" }) }, "@/lib/supabaseAdmin": { supabaseAdmin: db }, "next/server": { NextResponse: { json: (body: unknown, options: unknown) => ({ body, options }) } } });
  const route = load<{ GET: () => Promise<{ body: { results: Array<{ inrbadge: { visibility: number } }> }; options: { headers: Record<string, string> } }> }>("app/api/inrstats/evolution/route.ts");
  const response = await route.GET();
  assert.ok(calls.length >= 8);
  for (const call of calls) {
    assert.equal(call.filters.user_id, "active-establishment");
    assert.equal(typeof call.filters["gte:created_at"], "string");
    assert.equal(typeof call.filters["lt:created_at"], "string");
    if (call.table === "app_events") assert.equal(call.filters.module, "inr_search");
  }
  assert.equal(response.body.results[0].inrbadge.visibility, 7);
  assert.match(response.options.headers["Cache-Control"], /private, no-store/);
  const unauthorized = runtimeModules({ "@/lib/requireUser": { requireUser: async () => ({ errorResponse: "unauthorized", activeUserId: "" }) }, "@/lib/supabaseAdmin": { supabaseAdmin: { from() { throw new Error("must not query"); } } } });
  assert.equal(await unauthorized<{ GET: () => Promise<unknown> }>("app/api/inrstats/evolution/route.ts").GET(), "unauthorized");
});

test("monthly data stays isolated by account and chart interaction has one point readout", () => {
  const source = readFileSync(new URL("../../app/dashboard/stats/StatsMeasuredEvolution.tsx", import.meta.url), "utf8");
  const loader = readFileSync(new URL("../../app/dashboard/stats/stats.evolution-loader.ts", import.meta.url), "utf8");
  assert.match(source, /snapshot\?\.scope === visibleScope/);
  assert.match(loader, /controller\.abort\(\)/);
  assert.match(source, /getActiveBrowserUserId\(\).*=== scope/);
  const chart = readFileSync(new URL("../../app/dashboard/stats/StatsTrendChart.tsx", import.meta.url), "utf8");
  assert.match(chart, /trendPointCard/);
  assert.doesNotMatch(chart, /<title>|pointerEvents="none"/);
});
