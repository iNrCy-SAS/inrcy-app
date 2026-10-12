import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type RecordLike = Record<string, unknown>;
const source = readFileSync(new URL("../../lib/observability/sentryEventFilter.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleRecord: { exports: RecordLike } = { exports: {} };
new Function("module", "exports", "require", compiled)(moduleRecord, moduleRecord.exports, () => ({ isExpectedRateLimitError: () => false, isTransientBrowserNetworkError: () => false }));
const filter = moduleRecord.exports.filterSentryEvent as <T>(event: T, options?: RecordLike) => T | null;
const SECRET = "FAKE_META_SECRET_012345";
const urlFor = (key: string) => `https://graph.threads.com/access_token?${key}=${SECRET}&safe=keep`;

test("Sentry redacts Meta query credentials in request URLs and query strings", () => {
  for (const key of ["client_secret", "input_token", "fb_exchange_token", "CLIENT_SECRET"]) {
    const event = { request: { url: urlFor(key), query_string: `${key}=${SECRET}&safe=keep` } };
    const filtered = filter(event);
    assert.ok(filtered); assert.doesNotMatch(JSON.stringify(filtered), new RegExp(SECRET));
    assert.equal(new URL(filtered.request.url).searchParams.get(key), "[Filtered]");
    assert.match(filtered.request.query_string, /safe=keep/);
    const relative = filter({ request: { url: `/callback?${key}=${SECRET}&safe=keep` } });
    assert.doesNotMatch(JSON.stringify(relative), new RegExp(SECRET));
  }
});

test("Sentry redacts Meta credential URLs from messages, exceptions and fetch breadcrumbs", () => {
  for (const key of ["client_secret", "input_token", "fb_exchange_token"]) {
    const url = urlFor(key);
    const filtered = filter({ message: `Meta request failed ${url}`, exception: { values: [{ value: `Provider error at ${url}` }] }, breadcrumbs: [{ message: `GET ${url}`, data: { url, method: "GET", nested: { endpoint: url } } }], extra: { providerUrl: url, metadata: { events: [{ target: url }] } } });
    const serialized = JSON.stringify(filtered);
    assert.doesNotMatch(serialized, new RegExp(SECRET));
    assert.match(serialized, /safe=keep/); assert.match(serialized, /\[Filtered\]/);
  }
});

test("Sentry recursively filters credential fields while preserving useful metrics and binary redaction", () => {
  const filtered = filter({
    message: `Invalid image data:image/png;base64,${"A".repeat(300)}`,
    request: { headers: { Authorization: "Bearer fixture", cookie: "fixture", Accept: "application/json" }, data: { input_token: SECRET } },
    breadcrumbs: [{ data: { nested: { client_secret: SECRET, input_token: SECRET, fb_exchange_token: SECRET, endpoint: urlFor("input_token"), count: 3 } } }],
    extra: { metadata: { list: [{ client_secret: SECRET, status: 400, endpoint: urlFor("fb_exchange_token") }] }, status: 400 },
  }, { scrubHeaders: true });
  assert.ok(filtered);
  assert.doesNotMatch(JSON.stringify(filtered), new RegExp(SECRET));
  assert.match(filtered.message, /Filtered image/);
  assert.equal("data" in filtered.request, false);
  assert.deepEqual(filtered.request.headers, { Accept: "application/json" });
  assert.equal(filtered.extra.metadata.list[0].status, 400);
  assert.equal(filtered.breadcrumbs[0].data.nested.count, 3);
});

test("Sentry recursive metadata redaction handles cycles without losing the safe diagnostic fields", () => {
  const metadata: RecordLike = { endpoint: urlFor("client_secret"), status: 400 };
  metadata.self = metadata;
  const event = { extra: { metadata } };
  assert.equal(filter(event), event);
  assert.equal(metadata.self, metadata); assert.equal(metadata.status, 400);
  assert.doesNotMatch(String(metadata.endpoint), new RegExp(SECRET));
});

test("Sentry redacts Meta credentials in SDK query-string records and preserves safe parameters", () => {
  const event = { request: { query_string: { client_secret: SECRET, input_token: SECRET, fb_exchange_token: SECRET, CLIENT_SECRET: SECRET, safe: "keep", nextUrl: urlFor("input_token") } } };
  const filtered = filter(event);
  assert.ok(filtered);
  assert.doesNotMatch(JSON.stringify(filtered), new RegExp(SECRET));
  assert.equal(filtered.request.query_string.safe, "keep");
  for (const key of ["client_secret", "input_token", "fb_exchange_token", "CLIENT_SECRET"]) assert.equal(Object.hasOwn(filtered.request.query_string, key), false);
  assert.match(filtered.request.query_string.nextUrl, /input_token=\[Filtered\]&safe=keep/);
});

test("Sentry redacts every Meta credential tuple including duplicate and mixed-case keys", () => {
  const tuples: Array<[string, string]> = [
    ["client_secret", SECRET], ["input_token", SECRET], ["fb_exchange_token", SECRET],
    ["CLIENT_SECRET", SECRET], ["input_token", SECRET], ["safe", "keep"], ["next", urlFor("fb_exchange_token")],
  ];
  const filtered = filter({ request: { query_string: tuples } });
  assert.ok(filtered);
  assert.doesNotMatch(JSON.stringify(filtered), new RegExp(SECRET));
  assert.deepEqual(filtered.request.query_string.slice(0, 5).map((pair) => pair[1]), Array(5).fill("[Filtered]"));
  assert.deepEqual(filtered.request.query_string[5], ["safe", "keep"]);
  assert.match(filtered.request.query_string[6][1], /fb_exchange_token=\[Filtered\]&safe=keep/);
});
