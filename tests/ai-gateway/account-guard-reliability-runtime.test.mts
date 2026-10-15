import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Guard from "../../lib/aiGatewayAccountGuard.ts";

function harness(options: { diagnosticFailure?: boolean; economicFailure?: boolean; reservationFailure?: boolean } = {}) {
  let now = Date.parse("2026-12-31T23:59:59Z");
  const calls: { script: string; keys: string[] }[] = [];
  const diagnostics: string[] = [];
  const redis = {
    eval: async (script: string, keys: string[]) => {
      calls.push({ script, keys });
      if (calls.length === 1) {
        if (options.reservationFailure) throw new Error("redis reserve unavailable");
        return [1, 0, 0];
      }
      if (options.economicFailure) throw new Error("redis commit unavailable");
      return 1;
    },
    incr: async (key: string) => {
      diagnostics.push(key);
      if (options.diagnosticFailure) throw new Error("diagnostics unavailable");
      return 1;
    },
    ttl: async () => 10,
    expire: async () => 1,
  };
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "@upstash/redis": { Redis: class { constructor() { return redis; } } },
    "@/lib/upstashMode": { shouldBypassUpstashInCurrentEnv: () => false },
    "@/lib/aiGatewayPolicy": { isAiGatewayAccountCostLimitEnforced: () => true },
    "@/lib/aiGatewayEconomics": { estimateAiGatewayCostMicroUsd: () => 10 },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/aiGatewayAccountGuard.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {
    Date: class extends Date { constructor() { super(now); } static now() { return now; } },
    process: { env: { KV_REST_API_URL: "https://test.invalid", KV_REST_API_TOKEN: "synthetic" } },
    console: { error() {}, warn() {} },
  })((id: string) => {
    if (!(id in stubs)) throw new Error(`unexpected_dependency:${id}`);
    return stubs[id];
  }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof Guard;
  return { runtime, calls, diagnostics, nextYear: () => { now = Date.parse("2027-01-01T00:00:10Z"); } };
}

for (const action of ["commit", "rollback"] as const) test(`${action} uses the original UTC day/month after midnight and year rollover`, async () => {
  const h = harness();
  const reservation = await h.runtime.reserveAiGatewayAccountAttempt("account-test", { estimatedCostMicroUsd: 800_000 });
  h.nextYear();
  if (action === "commit") await h.runtime.commitAiGatewayAccountAttempt({
    reservation, feature: "media.video", model: "test", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: 800_000,
  });
  else await h.runtime.rollbackAiGatewayAccountAttempt(reservation);
  assert.deepEqual(h.calls[1].keys, h.calls[0].keys);
  assert.match(h.calls[0].keys[0], /:day:2026-12-31:/);
  assert.match(h.calls[0].keys[10], /:month:2026-12:/);
  assert.equal(reservation?.state, action === "commit" ? "committed" : "rolled_back");
  for (const key of h.diagnostics) assert.match(key, /:day:2026-12-31:/);
});

test("noncritical diagnostic failures preserve the successful commit and do not double count a replay", async () => {
  const h = harness({ diagnosticFailure: true });
  const reservation = await h.runtime.reserveAiGatewayAccountAttempt("account-test");
  const args = { reservation, feature: "media.image" as const, model: "test", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
  await h.runtime.commitAiGatewayAccountAttempt(args);
  await h.runtime.commitAiGatewayAccountAttempt(args);
  assert.equal(reservation?.state, "committed");
  assert.equal(h.calls.length, 2);
  assert.equal(h.diagnostics.length, 2);
});

test("mandatory reservation and accounting failures remain blocking", async () => {
  const unavailable = harness({ reservationFailure: true });
  await assert.rejects(unavailable.runtime.reserveAiGatewayAccountAttempt("account-test"), /protection économique/);
  const h = harness({ economicFailure: true });
  const reservation = await h.runtime.reserveAiGatewayAccountAttempt("account-test");
  await assert.rejects(h.runtime.commitAiGatewayAccountAttempt({
    reservation, feature: "media.video", model: "test", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }), /redis commit unavailable/);
  assert.equal(reservation?.state, "reserved");
  assert.equal(h.diagnostics.length, 0);
});
