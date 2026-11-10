import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { aiTranscribeMedia } from "../../lib/aiGatewayTranscription.ts";

function harness(options: { statuses?: number[]; networkFailure?: boolean; guardFailure?: boolean; empty?: boolean } = {}) {
  const requests: Array<{ model: string; retries: number }> = [];
  const reservations: Array<{ feature: string; cost: number; state: string }> = [];
  let commits = 0, rollbacks = 0;
  const dependencies: Record<string, unknown> = {
    "server-only": {},
    "@/lib/aiGatewayConfig": { cleanAiGatewayEnv: (value: unknown) => String(value ?? "").trim(), getAiGatewayCredential: () => "synthetic-key", getAiGatewayTranscriptionUrl: () => "https://ai-gateway.vercel.sh/v4/ai/transcription-model", normalizeGatewayModelId: (model: string) => model },
    "@/lib/aiGatewayPolicy": { assertAllowedAiGatewayTranscriptionModel: () => undefined },
    "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async (_id: string, value: { feature: string; estimatedCostMicroUsd: number }) => {
        if (options.guardFailure) throw new Error("account_guard_denied");
        const reservation = { feature: value.feature, cost: value.estimatedCostMicroUsd, state: "reserved" }; reservations.push(reservation); return reservation;
      },
      commitAiGatewayAccountAttempt: async (value: { reservation: { state: string } | null }) => { if (value.reservation?.state === "reserved") { value.reservation.state = "committed"; commits += 1; } },
      rollbackAiGatewayAccountAttempt: async (value: { state: string } | null) => { if (value?.state === "reserved") { value.state = "rolled_back"; rollbacks += 1; } },
      recordAiGatewayAccountFailure: async () => undefined,
    },
    "@/lib/observability/fetch": { fetchWithRetry: async (_url: string, init: {
      headers: Record<string, string>; retries: number; onAttempt: (attempt: number) => Promise<void>;
      onAttemptSettled: (context: { attempt: number; response?: Response; error?: Error; willRetry: boolean }) => Promise<void>;
    }) => {
      await init.onAttempt(0);
      requests.push({ model: init.headers["ai-model-id"], retries: init.retries });
      if (options.networkFailure) {
        const error = new Error("response_lost"); await init.onAttemptSettled({ attempt: 0, error, willRetry: false }); throw error;
      }
      const status = options.statuses?.[requests.length - 1] ?? 200;
      const response = status === 200 ? Response.json({ text: options.empty ? "" : "Paroles fictives" }) : new Response("unavailable", { status });
      await init.onAttemptSettled({ attempt: 0, response, willRetry: false }); return response;
    } },
  };
  const source = readFileSync(new URL("../../lib/aiGatewayTranscription.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Buffer, Date, console: { info: () => {}, warn: () => {} }, process: { env: { AI_GATEWAY_API_KEY: "synthetic-key" } } })((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, record, record.exports);
  return { transcribe: (record.exports as { aiTranscribeMedia: typeof aiTranscribeMedia }).aiTranscribeMedia, requests, reservations, counts: () => ({ commits, rollbacks }) };
}
const file = new File(["ID3-fictional-audio"], "voice.mp3", { type: "audio/mpeg" });

test("assistant STT retains the real attempted cost and never retries or falls back after an unknown result", async () => {
  for (const options of [{ networkFailure: true }, { statuses: [500] }, { empty: true }]) {
    const h = harness(options); let attempted = 0;
    await assert.rejects(h.transcribe({ file, accountId: "account", feature: "assistant.chat", estimatedCostMicroUsd: 100_000, retries: 0, onProviderAttempt: () => { attempted += 1; } }));
    assert.equal(attempted, 1); assert.equal(h.requests.length, 1); assert.equal(h.requests[0].retries, 0);
    assert.deepEqual(h.counts(), { commits: 1, rollbacks: 0 });
    assert.equal(h.reservations[0].feature, "assistant.chat"); assert.equal(h.reservations[0].cost, 100_000);
  }
});

test("account denial occurs before the attempted-provider hook and before any HTTP request", async () => {
  const h = harness({ guardFailure: true }); let attempted = 0;
  await assert.rejects(h.transcribe({ file, accountId: "account", feature: "assistant.chat", onProviderAttempt: () => { attempted += 1; } }));
  assert.equal(attempted, 0); assert.equal(h.requests.length, 0); assert.equal(h.reservations.length, 0);
});

test("existing Booster callers keep their default feature, retry setting and Whisper fallback", async () => {
  const h = harness({ statuses: [500, 200] });
  const result = await h.transcribe({ file, accountId: "account" });
  assert.equal(result.text, "Paroles fictives"); assert.equal(result.model, "openai/whisper-1");
  assert.deepEqual(h.requests, [{ model: "openai/gpt-4o-transcribe", retries: 1 }, { model: "openai/whisper-1", retries: 1 }]);
  assert.ok(h.reservations.every(value => value.feature === "booster.transcribe"));
  assert.deepEqual(h.counts(), { commits: 1, rollbacks: 1 });
});
