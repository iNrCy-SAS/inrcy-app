import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Analytics = typeof import("../../lib/linkedinAnalytics.ts");
const start = new Date("2026-10-02T00:00:00Z");
const end = new Date("2026-11-01T00:00:00Z");
const range = "(start:(year:2026,month:10,day:2),end:(year:2026,month:11,day:1))";

function runtime(options: { version?: string; legacy?: boolean; denied?: boolean; partial?: boolean; zeros?: boolean } = {}) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const rawUrl = String(input);
    const url = new URL(rawUrl);
    calls.push(rawUrl);
    assert.equal(url.origin, "https://api.linkedin.com");
    assert.equal(init?.method || "GET", "GET");
    assert.equal(init?.cache, "no-store");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer fixture-token");
    if (url.pathname.startsWith("/rest/")) {
      assert.equal(headers.get("Linkedin-Version"), options.version || "202604");
      assert.equal(headers.get("X-Restli-Protocol-Version"), "2.0.0");
    }
    if (options.denied) return Response.json({ message: "Could not authenticate" }, { status: 401 });
    if (options.legacy && url.pathname.startsWith("/rest/")) return Response.json({ message: "Not found" }, { status: 404 });
    if (url.searchParams.has("dateRange")) {
      // Match Rest.li's wire parser: record delimiters must not be percent-encoded.
      if (!rawUrl.includes(`dateRange=${range}`)) return Response.json({ message: "Invalid query parameters passed to request" }, { status: 400 });
      assert.equal(url.searchParams.get("dateRange"), range);
    }
    if (url.pathname.endsWith("/memberFollowersCount")) {
      return Response.json({ elements: [{ memberFollowersCount: options.zeros ? 0 : url.searchParams.get("q") === "me" ? 12 : 2 }] });
    }
    assert.ok(url.pathname.endsWith("/memberCreatorPostAnalytics"));
    assert.equal(url.searchParams.get("q"), "me");
    assert.equal(url.searchParams.get("aggregation"), "TOTAL");
    const metric = url.searchParams.get("queryType")!;
    if (options.partial && metric === "PROFILE_VIEW_FROM_CONTENT") return Response.json({ message: "Metric unavailable" }, { status: 403 });
    return Response.json({ elements: [{ count: options.zeros ? 0 : metric === "IMPRESSION" ? 23 : 1,
      metricType: options.version === "202610" ? metric : { "com.linkedin.adsexternalapi.memberanalytics.v3.CreatorPostAnalyticsMetricTypeV3": metric } }] });
  };
  const source = readFileSync(new URL("../../lib/linkedinAnalytics.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {} as Analytics;
  new Function("exports", "fetch", "process", code)(exports, fetchImpl, { env: { LINKEDIN_API_VERSION: options.version } });
  return { analytics: exports, calls };
}

for (const version of ["202604", "202610"]) test(`member analytics sends valid Rest.li date records and reads ${version} metric types`, async () => {
  const r = runtime({ version });
  const result = await r.analytics.liFetchMemberAnalytics("fixture-token", "urn:li:person:fixture", start, end);
  assert.equal(result.totals.impressions, 23);
  assert.equal(result.totals.followers, 12);
  assert.equal(result.totals.newFollowers, 2);
  assert.equal(result.totals.likes, 1);
  assert.deepEqual(result.range, { since: start.toISOString(), until: end.toISOString() });
  assert.equal(r.calls.length, 8, "One request per essential metric, without error-driven legacy retries");
  assert.ok(r.calls.every(url => !url.includes("/v2/")));
});

test("legacy member endpoints retain valid date range records", async () => {
  const r = runtime({ legacy: true });
  const result = await r.analytics.liFetchMemberAnalytics("fixture-token", "urn:li:person:fixture", start, end);
  assert.equal(result.totals.impressions, 23);
  assert.equal(result.totals.newFollowers, 2);
  assert.equal(r.calls.filter(url => url.includes("/v2/")).length, 8);
});

test("one unavailable optional metric preserves the measured member data", async () => {
  const r = runtime({ partial: true });
  const result = await r.analytics.liFetchMemberAnalytics("fixture-token", "urn:li:person:fixture", start, end);
  assert.equal(result.totals.impressions, 23);
  assert.equal(result.totals.followers, 12);
});

test("provider authentication failures remain errors", async () => {
  const r = runtime({ denied: true });
  await assert.rejects(r.analytics.liFetchMemberAnalytics("fixture-token", "urn:li:person:fixture", start, end), /Could not authenticate/);
});

test("the existing no-signal guard remains intact for valid all-zero responses", async () => {
  const r = runtime({ zeros: true });
  await assert.rejects(r.analytics.liFetchMemberAnalytics("fixture-token", "urn:li:person:fixture", start, end), /Aucune métrique LinkedIn membre exploitable/);
});
