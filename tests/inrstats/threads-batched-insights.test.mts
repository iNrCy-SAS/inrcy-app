import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const start = new Date("2026-09-01T00:00:00Z"), end = new Date("2026-10-01T00:00:00Z");
type Snapshot = { totals: Record<string, number>; audience: Record<string, number>; error?: string; raw: { unsupportedMetrics: { account: string[] } } };
const names = ["views", "likes", "replies", "reposts", "quotes", "clicks", "followers_count"];
const rows = names.map(name => ({ name, total_value: { value: name === "likes" ? 0 : 5 } }));

function runtime(handler: (url: URL) => Promise<Response>) {
  const calls: URL[] = [];
  const exports: { fetchThreadsAccountInsights?: (token: string, user: string, start: Date, end: Date) => Promise<Snapshot> } = {};
  const code = ts.transpileModule(readFileSync(new URL("../../lib/threadsInsights.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", "require", "fetch", code)(exports, (id: string) => {
    assert.equal(id, "@/lib/threadsGraphApi");
    return { buildThreadsGraphUrl: (path: string) => `https://graph.threads.com/v1.0/${path}` };
  }, async (input: string, init: RequestInit) => {
    const url = new URL(input); calls.push(url);
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer fixture-token");
    assert.equal(url.searchParams.get("since"), String(start.getTime() / 1000));
    assert.equal(url.searchParams.get("until"), String(end.getTime() / 1000));
    return handler(url);
  });
  return { calls, run: () => exports.fetchThreadsAccountInsights!("fixture-token", "account-id", start, end) };
}

test("all seven account metrics use one period request and retain measured zero", async () => {
  const h = runtime(async url => {
    assert.equal(url.searchParams.get("metric"), names.join(","));
    return Response.json({ data: rows });
  });
  const result = await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(result.totals.likes, 0);
  assert.equal(result.audience.followers_count, 5);
  assert.equal(result.totals.total_interactions, 15);
  assert.equal(result.error, undefined);
});

test("only a missing metric is requested again and unrelated rows cannot double a total", async () => {
  const h = runtime(async url => {
    const metric = url.searchParams.get("metric");
    if (metric?.includes(",")) return Response.json({ data: rows.filter(r => r.name !== "quotes") });
    assert.equal(metric, "quotes");
    return Response.json({ data: [{ name: "quotes", total_value: { value: 2 } }, { name: "replies", total_value: { value: 999 } }] });
  });
  const result = await h.run();
  assert.equal(h.calls.length, 2);
  assert.equal(result.totals.quotes, 2);
  assert.equal(result.totals.replies, 5);
});

test("an unsupported metric does not hide the supported account metrics", async () => {
  const h = runtime(async url => {
    const metric = url.searchParams.get("metric");
    if (metric?.includes(",") || metric === "clicks") return Response.json({ error: { code: 100, message: "Unsupported metric clicks" } }, { status: 400 });
    return Response.json({ data: rows.filter(r => r.name === metric) });
  });
  const result = await h.run();
  assert.equal(h.calls.length, 8);
  assert.equal(result.totals.clicks, undefined);
  assert.ok(result.raw.unsupportedMetrics.account.includes("clicks"));
  assert.equal(result.totals.views, 5);
  assert.equal(result.error, undefined);
});

for (const [status, code] of [[401, 190], [403, 10], [400, 190], [429, 4], [500, 2]]) test(`whole-account failure ${status}/${code} never fans out into seven more calls`, async () => {
  const h = runtime(async () => Response.json({ error: { code, message: "Account insights unavailable" } }, { status }));
  const result = await h.run();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result.totals, {});
  assert.equal(result.raw.unsupportedMetrics.account.length, 7);
  assert.ok(result.error);
});

test("an ambiguous network failure is not multiplied", async () => {
  const h = runtime(async () => { throw new Error("Provider timed out"); });
  const result = await h.run();
  assert.equal(h.calls.length, 1);
  assert.ok(result.error);
  assert.deepEqual(result.totals, {});
});
