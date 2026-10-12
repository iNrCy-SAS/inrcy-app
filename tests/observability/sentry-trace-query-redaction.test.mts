import assert from "node:assert/strict";
import { channel } from "node:diagnostics_channel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as Sentry from "@sentry/node";
import type { SpanJSON, TransactionEvent } from "@sentry/core";
import ts from "typescript";

type RecordLike = Record<string, unknown>;
type SdkOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;
const root = process.cwd();
const SECRET = "SYNTHETIC_META_TRACE_SECRET_012345";
const url = `https://graph.threads.com/access_token?client_secret=${SECRET}&input_token=${SECRET}&fb_exchange_token=${SECRET}&safe=keep`;

function evaluate<T>(relative: string, modules: RecordLike, env: RecordLike = {}): T {
  const source = readFileSync(join(root, relative), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("exports", "require", "process", compiled)(exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`);
    return modules[name];
  }, { env });
  return exports as T;
}

const helpers = evaluate<{
  filterSentryEvent: <T>(event: T, options?: RecordLike) => T | null;
  scrubSentrySpan: <T>(span: T) => T;
}>("lib/observability/sentryEventFilter.ts", {
  "@/lib/clientExpectedErrors": { isExpectedRateLimitError: () => false, isTransientBrowserNetworkError: () => false },
});

function configuredCallbacks(relative: string): SdkOptions {
  let options: SdkOptions | undefined;
  evaluate(relative, {
    "@sentry/nextjs": { init: (input: SdkOptions) => { options = input; }, captureRouterTransitionStart() {} },
    "@/lib/observability/sentryEventFilter": helpers,
    "@/lib/clientExpectedErrors": { installExpectedClientRejectionGuard() {} },
  }, { SENTRY_DSN: "https://fakepublic@example.invalid/1", NEXT_PUBLIC_SENTRY_DSN: "https://fakepublic@example.invalid/1", NODE_ENV: "test" });
  assert.ok(options);
  return options;
}

const spanFixture = (query: string): SpanJSON => ({
  span_id: "0123456789abcdef", trace_id: "0123456789abcdef0123456789abcdef", parent_span_id: "fedcba9876543210",
  op: "http.client", description: `GET ${url}`, start_timestamp: 1, timestamp: 2, status: "ok",
  data: { "url.full": url, "http.url": url, "url.query": query, "http.query": query, "http.request.method": "GET", "http.response.status_code": 200, "http.response_content_length": 123, "form_factor": "desktop" },
});

test("span redaction handles full URLs and first query pairs with or without a question mark", () => {
  for (const prefix of ["", "?"]) {
    const span = spanFixture(`${prefix}client_secret=${SECRET}&input_token=${SECRET}&fb_exchange_token=${SECRET}&CLIENT_SECRET=${SECRET}&%61ccess_token=${SECRET}&safe=keep`);
    assert.equal(helpers.scrubSentrySpan(span), span);
    assert.equal(JSON.stringify(span).includes(SECRET), false);
    assert.equal(new URL(String(span.data["url.full"])).searchParams.get("safe"), "keep");
    assert.ok(String(span.data["url.query"]).includes("safe=keep"));
    assert.ok(String(span.data["url.query"]).includes("%61ccess_token=[Filtered]"));
    assert.equal(span.data["http.request.method"], "GET");
    assert.equal(span.data["http.response.status_code"], 200);
    assert.equal(span.data["http.response_content_length"], 123);
    assert.equal(span.data.form_factor, "desktop");
    assert.equal(span.timestamp, 2);
    assert.equal(span.trace_id, "0123456789abcdef0123456789abcdef");
  }
});

test("all three actual Sentry configs scrub span, root context and transaction request credentials", async () => {
  for (const relative of ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"]) {
    const options = configuredCallbacks(relative);
    assert.equal(options.sendDefaultPii, false);
    assert.equal(options.tracesSampleRate, 0.1);
    assert.equal(typeof options.beforeSend, "function");
    assert.equal(typeof options.beforeSendSpan, "function");
    assert.equal(typeof options.beforeSendTransaction, "function");
    const span = spanFixture(`access_token=${SECRET}&safe=keep`);
    assert.equal(options.beforeSendSpan!(span), span);
    const event = {
      type: "transaction", transaction: `GET ${url}`, start_timestamp: 1, timestamp: 2,
      contexts: { trace: { trace_id: span.trace_id, span_id: span.span_id, data: { "url.full": url, "url.query": `input_token=${SECRET}&safe=keep`, count: 3 } }, meta: { nested: { client_secret: SECRET, endpoint: url, count: 4 } } },
      spans: [spanFixture(`fb_exchange_token=${SECRET}&safe=keep`)],
      request: { url, query_string: { client_secret: SECRET, safe: "keep" }, headers: { Authorization: SECRET, Cookie: SECRET, Accept: "application/json" }, data: { input_token: SECRET } },
    };
    const filtered = await options.beforeSendTransaction!(event as TransactionEvent, {});
    assert.ok(filtered);
    assert.equal(JSON.stringify(filtered).includes(SECRET), false, relative);
    assert.equal(filtered.spans?.length, 1);
    assert.equal(filtered.spans?.[0]?.data["http.response.status_code"], 200);
    assert.equal(filtered.contexts?.trace?.trace_id, span.trace_id);
    assert.equal((filtered.contexts?.trace?.data as RecordLike).count, 3);
    assert.equal((filtered.request?.headers as RecordLike).Accept, "application/json");
    assert.equal(filtered.request?.data, undefined);
  }
});

test("trace context redaction safely handles nested metadata cycles", () => {
  const context: RecordLike = { "url.full": url, "url.query": `client_secret=${SECRET}&safe=keep`, count: 3 };
  context.self = context;
  context.query_string = context;
  assert.equal(helpers.filterSentryEvent({ contexts: { trace: { data: context } } })?.contexts.trace.data, context);
  assert.equal(context.self, context);
  assert.equal(context.count, 3);
  assert.equal(String(context["url.full"]).includes(SECRET), false);
  assert.equal(String(context["url.query"]).includes(SECRET), false);
});

test("the installed Undici instrumentation exports sampled Meta spans without credentials using an in-memory transport", async () => {
  const envelopes: unknown[] = [];
  const configured = configuredCallbacks("sentry.server.config.ts");
  let beforeSendCalls = 0;
  let beforeSendSpanCalls = 0;
  let beforeSendTransactionCalls = 0;
  Sentry.init({
    ...configured,
    tracesSampleRate: 1,
    defaultIntegrations: false,
    integrations: [Sentry.nativeNodeFetchIntegration()],
    beforeSend(event, hint) { beforeSendCalls++; return configured.beforeSend!(event, hint); },
    beforeSendSpan(span) { beforeSendSpanCalls++; return configured.beforeSendSpan!(span); },
    beforeSendTransaction(event, hint) { beforeSendTransactionCalls++; return configured.beforeSendTransaction!(event, hint); },
    transport: () => ({ send(envelope) { envelopes.push(envelope); return Promise.resolve({ statusCode: 200 }); }, flush() { return Promise.resolve(true); } }),
  });
  try {
    await Sentry.startSpan({ name: `GET ${url}`, op: "fixture", attributes: { "url.full": url, "url.query": `client_secret=${SECRET}&safe=keep` } }, async () => {
      for (const origin of ["https://graph.threads.com", "https://graph.instagram.com", "https://graph.facebook.com"]) {
        // Publish synthetic diagnostic messages through the real installed instrumentation.
        // No HTTP request, Meta credentials or Sentry transport request is involved.
        const request = { origin, path: `/access_token?client_secret=${SECRET}&input_token=${SECRET}&fb_exchange_token=${SECRET}&safe=keep`, method: "GET", headers: "", addHeader() {} };
        channel("undici:request:create").publish({ request });
        channel("undici:request:headers").publish({ request, response: { statusCode: 200, headers: [] } });
        channel("undici:request:trailers").publish({ request });
      }
    });
    await Sentry.flush(3000);
    const captured = envelopes as Array<[unknown, Array<[RecordLike, TransactionEvent]>]>;
    const transactions = captured.flatMap((envelope) => envelope[1].filter((item) => item[0].type === "transaction").map((item) => item[1]));
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].spans?.length, 3);
    assert.equal(beforeSendCalls, 0, "error hook is not called for sampled transactions");
    assert.equal(beforeSendTransactionCalls, 1);
    assert.equal(beforeSendSpanCalls, 4, "root and all three child spans are scrubbed");
    assert.equal(JSON.stringify(envelopes).includes(SECRET), false);
    for (const span of transactions[0].spans || []) {
      assert.equal(new URL(String(span.data["url.full"])).searchParams.get("client_secret"), "[Filtered]");
      assert.equal(new URL(String(span.data["url.full"])).searchParams.get("safe"), "keep");
      assert.ok(String(span.data["url.query"]).includes("safe=keep"));
      assert.ok(String(span.data["http.query"]).includes("safe=keep"));
      assert.equal(span.data["http.response.status_code"], 200);
      assert.ok(span.timestamp && span.timestamp >= span.start_timestamp);
    }
  } finally {
    await Sentry.close(3000);
  }
});
