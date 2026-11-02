import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as tokenScope from "../../lib/visioGoogleTokenScope.ts";
import * as eventScope from "../../lib/visioCalendarEventScope.ts";
import * as retryPolicy from "../../lib/googleCalendarRetryPolicy.ts";
import { VISIO_BOOKING_TIMEZONE } from "../../lib/visioBookingPolicy.ts";

type Client = typeof import("../../lib/visioGoogleCalendarClient.ts");
const compiled = ts.transpileModule(readFileSync(new URL("../../lib/visioGoogleCalendarClient.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(responses: Array<() => Response>) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const reads: Array<Array<[string, unknown]>> = [];
  const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const delays: number[] = [];
  const row: Record<string, unknown> = { id: "integration-a", user_id: "staff-a", access_token_enc: "old-token", refresh_token_enc: "refresh-token", expires_at: "2099-01-01T00:00:00Z", status: "connected" };
  const database = { from(table: string) {
    assert.equal(table, "integrations");
    const filters: Array<[string, unknown]> = [];
    let patch: Record<string, unknown> | undefined;
    const query = {
      select(columns: string) { assert.equal(columns, "id,user_id,access_token_enc,refresh_token_enc,expires_at,status"); return query; },
      eq(key: string, value: unknown) { filters.push([key,value]); return query; },
      order(key: string, options: unknown) { assert.equal(key, "updated_at"); assert.deepEqual(options, { ascending: false }); return query; },
      limit(count: number) { assert.equal(count, 1); return query; },
      update(value: Record<string, unknown>) { patch = value; return query; },
      async maybeSingle() { reads.push(filters); return { data: { ...row }, error: null }; },
      then(resolve: (value: unknown) => unknown) { assert.ok(patch); updates.push({ patch, filters }); Object.assign(row, patch); return Promise.resolve({ error: null }).then(resolve); },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/oauthCrypto": { encryptToken: (token: string) => token, tryDecryptToken: (token: string) => token },
    "@/lib/env": { requireEnv: (key: string) => { assert.ok(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].includes(key)); return "fixture"; } },
    "@/lib/visioGoogleTokenScope": tokenScope, "@/lib/visioCalendarEventScope": eventScope,
    "@/lib/googleCalendarRetryPolicy": { ...retryPolicy, googleCalendarRetryDelayMs: (input: Parameters<typeof retryPolicy.googleCalendarRetryDelayMs>[0]) => retryPolicy.googleCalendarRetryDelayMs({ ...input, random: 0.25 }) },
    "@/lib/visioBookingPolicy": { VISIO_BOOKING_TIMEZONE },
  };
  const exports = {} as Client;
  new Function("require", "exports", "fetch", "setTimeout", compiled)(
    (name: string) => { assert.ok(name in dependencies, "Unexpected import " + name); return dependencies[name]; }, exports,
    async (url: string, init?: RequestInit) => { requests.push({ url, init }); const next = responses.shift(); assert.ok(next, "Unexpected provider call"); return next(); },
    (callback: () => void, delay: number) => { delays.push(delay); callback(); },
  );
  return { api: exports, requests, reads, updates, delays, row };
}

test("Google transport refreshes one unauthorized token and stores it under integration and staff scope", async () => {
  const f = fixture([
    () => Response.json({ error: "expired" }, { status: 401 }),
    () => Response.json({ access_token: "rotated-token", expires_in: 3600 }),
    () => Response.json({ id: "event-a" }),
  ]);
  assert.equal((await f.api.googleCalendarRequest<{ id: string }>("/calendars/team/events/event-a")).id, "event-a");
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[1].url, "https://oauth2.googleapis.com/token");
  assert.equal((f.requests[0].init?.headers as Record<string, string>).Authorization, "Bearer old-token");
  assert.equal((f.requests[2].init?.headers as Record<string, string>).Authorization, "Bearer rotated-token");
  assert.deepEqual(f.updates[0].filters, [["id", "integration-a"], ["user_id", "staff-a"]]);
  for (const filters of f.reads) assert.deepEqual(filters, [["provider", "google"], ["source", "internal_staff"], ["product", "visio_booking"], ["status", "connected"]]);
});

test("a second unauthorized response is terminal and cannot start another token refresh", async () => {
  const f = fixture([
    () => Response.json({}, { status: 401 }),
    () => Response.json({ access_token: "rotated-token" }),
    () => Response.json({ error: { message: "unauthorized" } }, { status: 401 }),
  ]);
  await assert.rejects(f.api.googleCalendarRequest("/calendars/team/events"), /visio_google_api_failed:401/);
  assert.equal(f.updates.length, 1);
  assert.equal(f.requests.length, 3);
});

test("transient retries preserve the same request and respect the existing delay policy", async () => {
  const f = fixture([
    () => Response.json({ error: { message: "busy" } }, { status: 503, headers: { "retry-after": "2" } }),
    () => Response.json({ error: { message: "busy" } }, { status: 503 }),
    () => Response.json({ id: "event-a" }),
  ]);
  const init = { method: "PATCH", body: JSON.stringify({ summary: "Updated" }) };
  await f.api.googleCalendarRequest("/calendars/team/events/event-a", init);
  assert.deepEqual(f.delays, [2000, 2250]);
  assert.equal(new Set(f.requests.map(request => request.url)).size, 1);
  for (const request of f.requests) { assert.equal(request.init?.method, "PATCH"); assert.equal(request.init?.body, init.body); assert.equal(request.init?.cache, "no-store"); }
});

test("paginated listings seed only their scoped event cache and explicit fresh reads bypass it", async () => {
  const f = fixture([
    () => Response.json({ items: [{ id: "event-a", status: "confirmed" }, { id: "cancelled", status: "cancelled" }], nextPageToken: "page-2" }),
    () => Response.json({ items: [{ id: "event-b", status: "confirmed" }] }),
    () => Response.json({ id: "event-a", summary: "fresh" }),
  ]);
  await f.api.googleCalendarEventCache.run(() => f.api.googleAccessTokenCache.run(async () => {
    const events = await f.api.listGoogleCalendarEvents({ calendarId: "team@calendar", timeMin: new Date("2026-11-01T00:00:00Z"), timeMax: new Date("2026-12-01T00:00:00Z") });
    assert.deepEqual(events.map(event => event.id), ["event-a", "event-b"]);
    assert.equal((await f.api.getCalendarEvent("team@calendar", "event-a"))?.id, "event-a");
    assert.equal(f.requests.length, 2);
    assert.equal((await f.api.getCalendarEvent("team@calendar", "event-a", { fresh: true }))?.summary, "fresh");
  }));
  assert.equal(f.reads.length, 1, "the real request-scoped token cache reuses its integration lookup");
  assert.equal(new URL(f.requests[1].url).searchParams.get("pageToken"), "page-2");
  assert.equal(new URL(f.requests[0].url).searchParams.get("timeZone"), VISIO_BOOKING_TIMEZONE);
});

test("watch registration retains its webhook token, lifetime and encoded calendar identifier", async () => {
  const f = fixture([() => Response.json({ id: "watch-a", resourceId: "resource-a" })]);
  await f.api.createVisioGoogleCalendarWatch({ calendarId: "team@example.test", channelId: "watch-a", address: "https://app.example.test/callback", token: "watch-secret", ttlSeconds: 3600 });
  assert.match(f.requests[0].url, /calendars\/team%40example.test\/events\/watch$/);
  assert.equal(f.requests[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(f.requests[0].init?.body)), { id: "watch-a", type: "web_hook", address: "https://app.example.test/callback", token: "watch-secret", params: { ttl: "3600" } });
});
