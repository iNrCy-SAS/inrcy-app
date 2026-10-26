import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { hasInrAssistantPremiumAccess } from "../../lib/inrAssistantPolicy.ts";
import type * as Quota from "../../lib/inrAssistantQuota.ts";

function harness(options: { bypass?: boolean; error?: boolean; response?: unknown; credentials?: boolean } = {}) {
  const calls: { script: string; keys: string[]; args: number[] }[] = [];
  const redis = { eval: async (script: string, keys: string[], args: number[]) => {
    calls.push({ script, keys, args });
    if (options.error) throw new Error("Synthetic Redis failure");
    return options.response === undefined ? 1 : options.response;
  } };
  const stubs: Record<string, unknown> = {
    "server-only": {}, "@upstash/redis": { Redis: class { constructor() { return redis; } } },
    "./inrAssistantPolicy.ts": { hasInrAssistantPremiumAccess },
    "./upstashMode.ts": { shouldBypassUpstashInCurrentEnv: () => options.bypass === true },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantQuota.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
    Date, process: { env: options.credentials === false ? {} : { KV_REST_API_URL: "https://quota-test.invalid", KV_REST_API_TOKEN: "synthetic" } }, console: { warn() {} },
  })((id: string) => { if (!(id in stubs)) throw new Error(`Unexpected dependency: ${id}`); return stubs[id]; }, moduleRecord, moduleRecord.exports);
  return { runtime: moduleRecord.exports as typeof Quota, calls };
}
const input = { billingAccountId: "billing-owner-1", requestId: "server-generated-1", edition: "premium" as const, complexity: "complex" as const, now: new Date("2026-12-31T23:59:59Z") };

test("one atomic reservation receives eligibility once per real user request", async () => {
  const h = harness();
  const quota = await h.runtime.reserveInrAssistantRequest(input);
  assert.equal(quota.solReserved, true);
  assert.equal(quota.trackingAvailable, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[0], 1);
  assert.equal(h.calls[0].args[1], 40 * 24 * 60 * 60);
  assert.match(h.calls[0].script, /\(sol \+ 1\) \* 5 <= total \+ 1/);
  assert.match(h.calls[0].script, /if existingSol then return tonumber\(existingSol\) end/);
});

test("Standard and routine requests cannot use even a previous Redis Sol grant", async () => {
  for (const args of [{ ...input, edition: "standard" as const }, { ...input, complexity: "routine" as const }]) {
    const h = harness();
    const quota = await h.runtime.reserveInrAssistantRequest(args);
    assert.equal(h.calls[0].args[0], 0);
    assert.equal(quota.solReserved, false);
  }
});

test("missing, disabled, failing or invalid Redis never unlocks Sol", async () => {
  for (const options of [{ bypass: true }, { credentials: false }, { error: true }, { response: 2 }, { response: "invalid" }]) {
    const h = harness(options);
    const quota = await h.runtime.reserveInrAssistantRequest(input);
    assert.equal(quota.solReserved, false);
    assert.equal(quota.trackingAvailable, false);
    await h.runtime.finalizeInrAssistantRequest(quota, { success: true });
    assert.ok(h.calls.length <= 1);
  }
});

test("finalization retains original UTC month and account after rollover", async () => {
  const h = harness({ response: 0 });
  const quota = await h.runtime.reserveInrAssistantRequest(input);
  await h.runtime.finalizeInrAssistantRequest(quota, { success: true });
  assert.deepEqual(h.calls[1].keys, h.calls[0].keys);
  assert.match(h.calls[1].keys[0], /billing-owner-1:2026-12/);
  assert.equal(h.calls[1].args[0], 1);
  assert.match(h.calls[1].script, /state ~= 'pending' then return 0/);
  assert.match(h.calls[1].script, /sol ~= '1' and tonumber\(ARGV\[1\]\) == 1/);
});

test("failed requests finalize without creating cheap success credit or refunding Sol", async () => {
  const h = harness({ response: 0 });
  const quota = await h.runtime.reserveInrAssistantRequest(input);
  await h.runtime.finalizeInrAssistantRequest(quota, { success: false });
  assert.equal(h.calls[1].args[0], 0);
  assert.doesNotMatch(h.calls[1].script, /HINCRBY[^\n]+['"]sol['"]/);
});

test("billing accounts, UTC months and server request IDs have isolated keys", async () => {
  const h = harness();
  await h.runtime.reserveInrAssistantRequest(input);
  await h.runtime.reserveInrAssistantRequest({ ...input, billingAccountId: "billing-owner-2" });
  await h.runtime.reserveInrAssistantRequest({ ...input, now: new Date("2027-01-01T00:00:01Z") });
  await h.runtime.reserveInrAssistantRequest({ ...input, requestId: "server-generated-2" });
  assert.notEqual(h.calls[0].keys[0], h.calls[1].keys[0]);
  assert.notEqual(h.calls[0].keys[0], h.calls[2].keys[0]);
  assert.equal(h.calls[0].keys[0], h.calls[3].keys[0]);
  assert.notEqual(h.calls[0].keys[1], h.calls[3].keys[1]);
  for (const call of h.calls) assert.equal(call.keys[0].match(/\{([^}]+)\}/)?.[1], call.keys[1].match(/\{([^}]+)\}/)?.[1]);
});

test("scope characters cannot inject Redis cluster hash tags", async () => {
  const h = harness();
  await h.runtime.reserveInrAssistantRequest({ ...input, billingAccountId: "a}{other", requestId: "b}:usage" });
  assert.match(h.calls[0].keys[0], /a%7D%7Bother/);
  assert.match(h.calls[0].keys[1], /b%7D%3Ausage/);
});

test("empty scope, invalid date and oversized request IDs fail before Redis", async () => {
  const h = harness();
  await assert.rejects(h.runtime.reserveInrAssistantRequest({ ...input, billingAccountId: " " }), /billing account/);
  await assert.rejects(h.runtime.reserveInrAssistantRequest({ ...input, requestId: "x".repeat(181) }), /request ID/);
  await assert.rejects(h.runtime.reserveInrAssistantRequest({ ...input, now: new Date("bad") }), /date/);
  assert.equal(h.calls.length, 0);
});
