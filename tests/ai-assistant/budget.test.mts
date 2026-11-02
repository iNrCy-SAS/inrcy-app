import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Budget from "../../lib/inrAssistantBudget.ts";

function harness(options: { unavailable?: boolean; missing?: boolean; corrupt?: boolean; bypass?: boolean; production?: boolean; factor?: string } = {}) {
  const counters = new Map<string, number>(), reservations = new Map<string, { cost: number; state: string }>();
  const calls: { script: string; keys: string[]; values: number[] }[] = [];
  let sequence = 0;
  const redis = { eval: async (script: string, keys: string[], values: number[]) => {
    calls.push({ script, keys, values });
    if (options.unavailable) throw new Error("Redis down"); if (options.corrupt) return -1;
    if (script.includes("local cap")) {
      const used = counters.get(keys[0]) ?? 0;
      if (used + values[0] > values[1]) return 0;
      assert.equal(reservations.has(keys[1]), false);
      counters.set(keys[0], used + values[0]); reservations.set(keys[1], { cost: values[0], state: "reserved" }); return 1;
    }
    const reservation = reservations.get(keys[1]);
    if (!reservation) return -1;
    if (reservation.state === "finalized") return 1;
    counters.set(keys[0], counters.get(keys[0])! + values[0] - reservation.cost); reservation.state = "finalized"; return 1;
  } };
  const deps: Record<string, unknown> = { "server-only": {}, "node:crypto": { randomUUID: () => String(++sequence) }, "@upstash/redis": { Redis: class { constructor() { return redis; } } }, "./upstashMode.ts": { shouldBypassUpstashInCurrentEnv: () => options.bypass === true } };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantBudget.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, { Date, process: { env: { NODE_ENV: options.production ? "production" : "test", ...(!options.missing ? { KV_REST_API_URL: "https://test.invalid", KV_REST_API_TOKEN: "test" } : {}), INR_ASSISTANT_EUR_PER_USD_GUARD: options.factor } } })((name: string) => { assert.ok(Object.hasOwn(deps, name), name); return deps[name]; }, loadedModule, loadedModule.exports);
  return { runtime: loadedModule.exports as typeof Budget, counters, calls };
}
const input = { accountId: "account-a", edition: "basic" as const, estimatedCostMicroUsd: 1_000_000, now: new Date("2026-12-31T23:59:59Z") };
test("budget caps match the approved packs and conversion cannot silently reduce protection", () => {
  const h = harness(); assert.deepEqual(JSON.parse(JSON.stringify(h.runtime.INR_ASSISTANT_MONTHLY_BUDGET_MICRO_EUR)), { basic: 5_000_000, standard: 7_500_000, premium: 10_000_000, founder: 10_000_000 });
  for (const factor of [undefined, "0", "-1", "oops", "1", "Infinity"]) assert.equal(harness({ factor }).runtime.assistantCostMicroEur(10), 13);
  assert.equal(harness({ factor: "2" }).runtime.assistantCostMicroEur(10), 20);
  for (const value of [-1, NaN, Infinity, 0.1]) assert.throws(() => h.runtime.assistantCostMicroEur(value));
});
test("concurrent requests share the cap and no fifth Basic reservation is granted", async () => {
  const h = harness(); const results = await Promise.allSettled(Array.from({ length: 8 }, () => h.runtime.reserveInrAssistantBudget(input)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 4);
  assert.equal([...h.counters.values()][0], 5_000_000);
  for (const result of results) if (result.status === "rejected") assert.equal(result.reason.code, "assistant_monthly_budget_reached");
  assert.match(h.calls[0].script, /if used \+ cost > cap then return 0 end[\s\S]*INCRBY/);
});
test("actual usage releases only the difference; finalization and uncertain failures cannot reset spending", async () => {
  const h = harness(); const reservation = await h.runtime.reserveInrAssistantBudget(input);
  await h.runtime.finalizeInrAssistantBudget(reservation, 100_000);
  await h.runtime.finalizeInrAssistantBudget(reservation, 0);
  assert.equal([...h.counters.values()][0], 125_000);
  const unknown = await h.runtime.reserveInrAssistantBudget(input); await h.runtime.finalizeInrAssistantBudget(unknown);
  assert.equal([...h.counters.values()][0], 1_375_000);
  const notSent = await h.runtime.reserveInrAssistantBudget(input); await h.runtime.finalizeInrAssistantBudget(notSent, 0);
  assert.equal([...h.counters.values()][0], 1_375_000);
});
test("upgrade/downgrade never resets the account ledger, and rollover finalizes the original month", async () => {
  const h = harness(); const first = await h.runtime.reserveInrAssistantBudget(input);
  await h.runtime.reserveInrAssistantBudget({ ...input, edition: "premium" });
  await h.runtime.reserveInrAssistantBudget({ ...input, edition: "standard" });
  assert.equal(h.counters.size, 1);
  const january = await h.runtime.reserveInrAssistantBudget({ ...input, now: new Date("2027-01-01T00:00:00Z") });
  await h.runtime.finalizeInrAssistantBudget(first, 0);
  assert.equal(h.counters.get(first.keys[0]), 2_500_000); assert.equal(h.counters.get(january.keys[0]), 1_250_000);
  await h.runtime.reserveInrAssistantBudget({ ...input, accountId: "other" }); assert.equal(h.counters.size, 3);
  const escaped = await h.runtime.reserveInrAssistantBudget({ ...input, accountId: "a}{b" }); assert.match(escaped.keys[0], /a%7D%7Bb/);
});
test("production never bypasses missing, broken or corrupt budget storage", async () => {
  for (const options of [{ missing: true }, { unavailable: true }, { corrupt: true }, { production: true, bypass: true, missing: true }]) {
    const h = harness(options); await assert.rejects(h.runtime.reserveInrAssistantBudget(input), { code: "assistant_budget_unavailable" });
  }
});
test("local development enforces the same ceiling without granting production bypass", async () => {
  const h = harness({ bypass: true });
  for (let i = 0; i < 4; i++) await h.runtime.reserveInrAssistantBudget(input);
  await assert.rejects(h.runtime.reserveInrAssistantBudget(input), { code: "assistant_monthly_budget_reached" }); assert.equal(h.calls.length, 0);
});

test("invalid final usage is rejected before it can refund or overwrite a reservation", async () => {
  const h = harness(), reservation = await h.runtime.reserveInrAssistantBudget(input);
  for (const value of [-1, -0.1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(h.runtime.finalizeInrAssistantBudget(reservation, value), { code: "assistant_budget_unavailable" });
    assert.equal([...h.counters.values()][0], 1_250_000);
  }
  assert.equal(h.calls.length, 1, "invalid usage never reaches the finalization script");
  await h.runtime.finalizeInrAssistantBudget(reservation);
  assert.equal([...h.counters.values()][0], 1_250_000);
});

test("underestimated actual cost is retained and stops further work instead of hiding budget overrun", async () => {
  for (const bypass of [false, true]) {
    const h = harness({ bypass }), reservation = await h.runtime.reserveInrAssistantBudget(input);
    await assert.rejects(h.runtime.finalizeInrAssistantBudget(reservation, 5_000_000), { code: "assistant_budget_unavailable" });
    if (!bypass) assert.equal([...h.counters.values()][0], 6_250_000);
    await h.runtime.finalizeInrAssistantBudget(reservation, 0);
    if (!bypass) assert.equal([...h.counters.values()][0], 6_250_000, "retry cannot refund already recorded consumption");
    await assert.rejects(h.runtime.reserveInrAssistantBudget({ ...input, estimatedCostMicroUsd: 1 }), { code: "assistant_monthly_budget_reached" });
  }
});
