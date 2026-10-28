import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

type Job = { status: string; [key: string]: unknown };
const body = { requestId: "cancel-request-0001", mediaKind: "image", surface: "studio" };
function route(options: { authenticated?: boolean; existing?: Job; insertFails?: boolean; rateLimited?: boolean } = {}) {
  const jobs = new Map<string, Job>(); const writes: Record<string, unknown>[] = []; const filters: Array<[string, string]> = [];
  if (options.existing) jobs.set(`active-account-a:${body.requestId}`, options.existing);
  const admin = {
    from(table: string) {
      assert.equal(table, "ai_media_generation_jobs", "Cancellation may never write a wallet, reservation or credit ledger");
      const queryFilters = new Map<string, string>();
      const query = {
        async insert(value: Record<string, unknown>) {
          if (options.insertFails) return { error: { code: "23503", message: "https://private.invalid database diagnostics" } };
          const key = `${value.account_id}:${value.request_key}`;
          if (jobs.has(key)) return { error: { code: "23505" } };
          writes.push(value); jobs.set(key, value as Job); return { error: null };
        },
        select(fields: string) { assert.equal(fields, "status"); return query; },
        eq(field: string, value: string) { filters.push([field, value]); queryFilters.set(field, value); return query; },
        async maybeSingle() { const job = jobs.get(`${queryFilters.get("account_id")}:${queryFilters.get("request_key")}`); return { data: job ? { status: job.status } : null, error: null }; },
      };
      return query;
    },
  };
  const dependencies = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } }],
    ["@/lib/multicompte/server", { getCurrentInrcyAccountScope: async () => options.authenticated === false ? null : { scope: { activeUserId: "active-account-a", authUserId: "actor-a" } } }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: admin }],
    ["@/lib/dashboardEditionServer", { getDashboardEditionForAccountId: async (account: string) => { assert.equal(account, "active-account-a"); return "founder"; } }],
    ["@/lib/rateLimit", { enforceRateLimit: async (args: { identifier: string; failClosed: boolean; limit: number }) => {
      assert.equal(args.identifier, "active-account-a"); assert.equal(args.failClosed, true); assert.equal(args.limit, 30);
      return options.rateLimited ? Response.json({ ok: false, error: "Capacité momentanément atteinte." }, { status: 429 }) : null;
    } }],
  ]);
  const output = ts.transpileModule(readFileSync(new URL("../../app/api/media-generation/cancel/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", output)(record, record.exports, (id: string) => {
    assert.ok(dependencies.has(id), `Cancellation cannot import a quota RPC or provider dependency: ${id}`); return dependencies.get(id);
  });
  return { jobs, writes, filters, post: (input: unknown = body, headers: Record<string, string> = {}) => record.exports.POST(new Request("https://example.invalid/api/media-generation/cancel", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof input === "string" ? input : JSON.stringify(input),
  })) };
}

test("cancellation authenticates, validates its bounded identifiers and fails closed before any write", async () => {
  const anonymous = route({ authenticated: false }); const response = await anonymous.post();
  assert.equal(response.status, 401); assert.deepEqual(await response.json(), { ok: false, code: "UNAUTHORIZED", error: "Non authentifié." }); assert.equal(anonymous.writes.length, 0);
  for (const input of ["broken", { ...body, requestId: "bad" }, { ...body, mediaKind: "audio" }, { ...body, surface: "external" }]) {
    const invalid = route(); assert.equal((await invalid.post(input)).status, 400); assert.equal(invalid.writes.length, 0);
  }
  const oversized = route(); assert.equal((await oversized.post(body, { "content-length": "3000" })).status, 400); assert.equal(oversized.writes.length, 0);
  const limited = route({ rateLimited: true }); assert.equal((await limited.post()).status, 429); assert.equal(limited.writes.length, 0);
  const switched = route(); const conflict = await switched.post({ ...body, expectedAccountId: "old-account-a" });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "AI_MEDIA_ACCOUNT_CHANGED");
  assert.equal(switched.writes.length, 0); assert.equal(switched.filters.length, 0);
});

test("an absent key becomes a failed marker with the live schema's terminal fields and no monetary reservation", async () => {
  const current = route(); const response = await current.post({ ...body, accountId: "forbidden-other-account" });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, status: "failed", cancellationPreventedReservation: true });
  assert.match(response.headers.get("cache-control")!, /private, no-store/);
  const marker = current.writes[0];
  assert.equal(marker.account_id, "active-account-a"); assert.equal(marker.actor_auth_user_id, "actor-a"); assert.equal(marker.request_key, body.requestId);
  assert.equal(marker.status, "failed"); assert.equal(marker.quota_amount, 1); assert.equal(marker.purchased_quota_amount, 0); assert.equal(marker.quota_unit, "credit");
  assert.equal(marker.monthly_limit, 1); assert.equal(marker.edition, "founder"); assert.equal(marker.request_fingerprint, "0".repeat(64));
  assert.ok(Number.isFinite(Date.parse(String(marker.failed_at)))); assert.ok(Date.parse(String(marker.reservation_expires_at)) > Date.parse(String(marker.failed_at)));
  assert.match(String(marker.quota_period_start), /^\d{4}-\d{2}-01$/);
  assert.deepEqual(marker.metadata, { cancellation_before_reservation: true });
  assert.equal(current.filters.length, 0);
});

test("duplicate and concurrent cancellation keep a single terminal marker", async () => {
  const current = route(); const responses = await Promise.all([current.post(), current.post(), current.post()]);
  const payloads = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(payloads, [
    { ok: true, status: "failed", cancellationPreventedReservation: true },
    { ok: true, status: "failed", cancellationPreventedReservation: false },
    { ok: true, status: "failed", cancellationPreventedReservation: false },
  ], "Only the call that inserted the terminal marker prevented a reservation; duplicates only report its status");
  assert.equal(current.writes.length, 1); assert.equal(current.jobs.size, 1);
});

test("if reservation or payment won the unique key, cancellation only reads status and never fails or refunds that job", async () => {
  for (const status of ["reserved", "processing", "completed", "failed", "expired"]) {
    const original = { status, output_media_id: "paid-result-a", metadata: { private: "SECRET", gateway: "https://private.invalid" } };
    const current = route({ existing: original }); const response = await current.post(); const payload = await response.json();
    assert.equal(response.status, ["reserved", "processing"].includes(status) ? 202 : 200);
    assert.deepEqual(payload, { ok: true, status: ["reserved", "processing"].includes(status) ? "processing" : status, cancellationPreventedReservation: false });
    assert.equal(current.writes.length, 0); assert.equal(current.jobs.get(`active-account-a:${body.requestId}`), original);
    assert.deepEqual(current.filters, [["account_id", "active-account-a"], ["request_key", body.requestId]]); assert.doesNotMatch(JSON.stringify(payload), /SECRET|private.invalid|paid-result/);
  }
});

test("a failed marker insert is uncertain and exposes no internal database diagnostics", async () => {
  const current = route({ insertFails: true }); const response = await current.post(); const payload = await response.json();
  assert.equal(response.status, 503); assert.equal(payload.code, "AI_MEDIA_CANCEL_UNAVAILABLE"); assert.doesNotMatch(JSON.stringify(payload), /private.invalid|diagnostics/); assert.equal(current.writes.length, 0);
});
