import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardEdition } from "../../lib/dashboardEdition.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const notice = (index: number, patch: Row = {}): Row => ({
  id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  user_id: ACCOUNT, category: "information", kind: "cockpit_status", title: `Notification ${index}`, body: "Information utile",
  cta_label: "Ouvrir", cta_url: "/dashboard", read_at: null, meta: {}, dedupe_key: `notice:${index}`, created_at: "2026-11-15T08:00:00Z", ...patch,
});

function harness(records: Row[], options: { edition?: DashboardEdition; disabled?: boolean; preferenceFailure?: boolean; editionFailure?: boolean; scanFailure?: boolean; unauthorized?: boolean } = {}) {
  const rows = structuredClone(records), calls: Array<{ table: string; start?: number; end?: number }> = [], lookups: string[] = [];
  const db = { from(table: string) {
    assert.ok(["notification_preferences", "notifications"].includes(table));
    const filters: Array<[string, unknown]> = [], orders: string[] = [];
    let start = 0, end = 0;
    const finish = () => {
      assert.ok(filters.some(([key, value]) => key === "user_id" && value === ACCOUNT), "every query is scoped to the active account");
      if (table === "notification_preferences") {
        calls.push({ table });
        return { data: { user_id: ACCOUNT, in_app_enabled: !options.disabled }, error: options.preferenceFailure ? new Error("preferences unavailable") : null };
      }
      assert.deepEqual(orders, ["created_at", "id"], "source pagination has a deterministic tie breaker");
      assert.ok(filters.some(([key, value]) => key === "read_at" && value === null));
      calls.push({ table, start, end });
      const eligible = rows.filter(row => filters.every(([key, value]) => row[key] === value)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)));
      return { data: eligible.slice(start, end + 1), error: options.scanFailure ? new Error("notifications unavailable") : null };
    };
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      is(key: string, value: unknown) { filters.push([key, value]); return query; },
      order(key: string, config: { ascending: boolean }) { assert.equal(config.ascending, false); orders.push(key); return query; },
      range(first: number, last: number) { start = first; end = last; assert.ok(last - first < 500); return query; },
      maybeSingle: async () => finish(),
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return Promise.resolve().then(finish).then(resolve, reject); },
    };
    // No update, insert, delete or upsert method exists: the actual GET must remain read-only.
    return query;
  } };
  const load = runtimeModules({
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/requireUser": { requireUser: async () => ({ activeUserId: ACCOUNT, errorResponse: options.unauthorized ? Response.json({}, { status: 401 }) : null }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async (id: string) => { lookups.push(id); if (options.editionFailure) throw new Error("edition unavailable"); return options.edition ?? "standard"; } },
    "@/lib/notificationWriter": { insertNotificationOnce: () => assert.fail("GET cannot initialize notifications") },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "Unavailable" }, { status: 500 }) },
  });
  const route = load<typeof import("../../app/api/notifications/feed/route.ts")>("app/api/notifications/feed/route.ts");
  return { rows, calls, lookups, async get(query = "") { const response = await route.GET(new Request(`https://app.inrcy.test/api/notifications/feed${query}`)); return { response, body: await response.json() }; } };
}

test("the real feed resolves the active pack, hides old Premium recommendations and keeps business events without mutating them", async () => {
  const records = [
    notice(1, { kind: "cross_sell_mail" }), notice(2, { kind: "crm_refresh", cta_url: "/dashboard/crm" }),
    notice(3, { kind: "connect_channels", title: "2 canaux encore activables", body: "Gmail et Microsoft", meta: { missing_channels: ["Gmail", "Microsoft"] } }),
    notice(4, { kind: "inrsearch_lead", body: "Un client vous a contacté", cta_url: "/dashboard/crm" }),
    notice(5, { kind: "connect_channels", body: "Facebook et Gmail", meta: { missing_channels: ["Facebook", "Gmail", "Microsoft"] } }),
    notice(6, { kind: "onboarding_connect_gmb", cta_url: "/dashboard?panel=gmb" }),
    notice(7, { user_id: "other-account" }), notice(8, { read_at: "2026-11-15T09:00:00Z" }),
  ];
  for (const edition of ["basic", "standard", "premium", "founder"] as const) {
    const h = harness(records, { edition });
    const { response, body } = await h.get("?limit=50");
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(h.lookups, [ACCOUNT]); assert.deepEqual(h.rows, records);
    assert.equal(body.countKnown, true); assert.equal(body.nextOffset, null);
    assert.equal(body.totalCount, edition === "basic" || edition === "standard" ? 3 : 6);
    assert.equal(body.unreadCount, body.totalCount);
    const lead = body.items.find((row: Row) => row.kind === "inrsearch_lead");
    assert.equal(lead.body, "Un client vous a contacté");
    assert.equal(lead.cta_url, edition === "basic" || edition === "standard" ? "/dashboard" : "/dashboard/crm");
    if (edition === "basic" || edition === "standard") {
      assert.doesNotMatch(JSON.stringify(body), /Gmail|Microsoft|cross_sell_mail|crm_refresh/);
      const mixed = body.items.find((row: Row) => row.kind === "connect_channels");
      assert.equal(mixed.title, "1 canal encore activable"); assert.deepEqual(mixed.meta.missing_channels, ["Facebook"]);
    }
  }
});

test("feed pagination filters across source pages and reports an eligible count instead of source count", async () => {
  const h = harness([
    ...Array.from({ length: 520 }, (_, index) => notice(1000 + index, { kind: "cross_sell_mail" })),
    ...Array.from({ length: 17 }, (_, index) => notice(index)),
  ]);
  const first = await h.get("?limit=5"), second = await h.get("?limit=5&offset=5"), last = await h.get("?limit=5&offset=15");
  assert.deepEqual(first.body.items.map((row: Row) => row.id), [16, 15, 14, 13, 12].map(index => notice(index).id));
  assert.deepEqual(second.body.items.map((row: Row) => row.id), [11, 10, 9, 8, 7].map(index => notice(index).id));
  assert.equal(first.body.totalCount, 17); assert.equal(first.body.nextOffset, 5); assert.equal(first.body.countKnown, true);
  assert.equal(second.body.nextOffset, 10); assert.equal(last.body.items.length, 2); assert.equal(last.body.nextOffset, null);
  assert.ok(h.calls.some(call => call.start === 500 && call.end === 999));
});

test("the bounded scan distinguishes an exact 10,000 notifications from an incomplete count", async () => {
  for (const length of [10000, 10001]) {
    const h = harness(Array.from({ length }, (_, index) => notice(index)));
    const { body } = await h.get("?limit=5&offset=9995");
    assert.equal(body.items.length, 5); assert.equal(body.totalCount, 10000); assert.equal(body.countKnown, length === 10000); assert.equal(body.nextOffset, null);
    const sourceCalls = h.calls.filter(call => call.table === "notifications");
    assert.equal(sourceCalls.length, 21); assert.deepEqual(sourceCalls.at(-1), { table: "notifications", start: 10000, end: 10000 });
  }
});

test("disabled, unauthorized and unavailable feeds never change preferences or expose a fallback Premium catalogue", async () => {
  const disabled = harness([notice(1)], { disabled: true });
  const empty = await disabled.get(); assert.equal(empty.body.totalCount, 0); assert.equal(empty.body.nextOffset, null); assert.equal(empty.body.countKnown, true);
  assert.equal(disabled.calls.length, 1); assert.equal(disabled.lookups.length, 0);
  const forbidden = harness([notice(1)], { unauthorized: true }); assert.equal((await forbidden.get()).response.status, 401); assert.equal(forbidden.calls.length, 0);
  for (const option of ["preferenceFailure", "editionFailure", "scanFailure"] as const) {
    const h = harness([notice(1)], { [option]: true }); assert.equal((await h.get()).response.status, 500, option);
    assert.deepEqual(h.rows, [notice(1)]);
  }
});
