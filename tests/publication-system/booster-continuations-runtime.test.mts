import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { createPublishNowContinuations } from "../../app/api/booster/publish-now/publishNow.continuations.ts";

type Service = ReturnType<typeof createPublishNowContinuations>;
const now = Date.parse("2026-11-02T12:00:00Z");
const instagramCheckpoint = { state: "processing", containerId: "container-owned" } as Parameters<Service["persistInstagramVideoCheckpoint"]>[0];
const youtubeCheckpoint = { state: "uploading", offset: 1024, totalBytes: 8192 } as Parameters<Service["persistYoutubeUploadCheckpoint"]>[0];
const pinterestCheckpoint = { phase: "polling", mediaId: "media-owned", nextPollAt: new Date(now + 15_000).toISOString() } as Parameters<Service["persistPinterestVideoCheckpoint"]>[0];
const tikTokCheckpoint = { publishId: "publish-owned" } as unknown as Parameters<Service["persistTikTokUploadCheckpoint"]>[0];

function runtime(options: { async?: boolean; eventId?: string; updateFailures?: number; failDelivery?: boolean; failLock?: boolean } = {}) {
  const calls: Array<{ kind: string; data?: Record<string, unknown> }> = [];
  const delays: number[] = [];
  const database = {};
  let remainingFailures = options.updateFailures || 0;
  const record = { exports: {} as { createPublishNowContinuations: typeof createPublishNowContinuations } };
  const code = ts.transpileModule(readFileSync(new URL("../../app/api/booster/publish-now/publishNow.continuations.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "require", "setTimeout", "Date", "console", code)(record, record.exports, (name: string) => {
    if (name === "next/server") return { NextResponse: { json: Response.json } };
    if (name === "@/lib/supabaseAdmin") return { supabaseAdmin: database };
    if (name === "@/lib/boosterAsyncPublication") return { updateAsyncChannelEvent: async (data: Record<string, unknown>) => {
      calls.push({ kind: "checkpoint", data });
      assert.equal(data.userId, "account-owned"); assert.equal(data.eventId, "event-owned");
      if (remainingFailures-- > 0) throw new Error("checkpoint unavailable");
    } };
    if (name === "@/lib/executionIdempotency") return { failExecutionIdempotencyLock: async (data: Record<string, unknown>) => {
      assert.equal(data.supabase, database); assert.equal(data.lockId, "claim-owned");
      calls.push({ kind: "lock", data }); if (options.failLock) throw new Error("lock unavailable");
    } };
    throw new Error(`Unexpected continuation dependency: ${name}`);
  }, (callback: () => void, delay: number) => { delays.push(delay); callback(); }, class extends Date {
    constructor(value?: string | number) { super(value ?? now); }
    static now() { return now; }
  }, { info() {} });
  const service = record.exports.createPublishNowContinuations({
    userId: "account-owned", publicationId: "publication-owned", internalAsyncDispatch: options.async !== false,
    asyncChannelEventId: options.eventId ?? "event-owned", asyncChannelLockId: "claim-owned",
    setDelivery: async (channel, patch) => { calls.push({ kind: "delivery", data: { channel, ...patch } }); if (options.failDelivery) throw new Error("delivery unavailable"); },
    clearAsyncFailureContext: () => { calls.push({ kind: "clear" }); },
  });
  return { service, calls, delays };
}

test("binding a claimed dispatch is inert and invalid worker contexts cannot persist protected checkpoints", async () => {
  for (const options of [{ async: false }, { eventId: "" }]) {
    const h = runtime(options);
    assert.deepEqual(h.calls, []);
    await h.service.persistTikTokUploadCheckpoint(tikTokCheckpoint);
    await assert.rejects(h.service.persistInstagramVideoCheckpoint(instagramCheckpoint), /requires_async_worker/);
    await assert.rejects(h.service.persistYoutubeUploadCheckpoint(youtubeCheckpoint), /requires_async_worker/);
    await assert.rejects(h.service.persistPinterestVideoCheckpoint(pinterestCheckpoint), /requires_async_worker/);
    assert.equal(await h.service.queueInstagramRateLimitRetry({ error: "Limit" }), null);
    assert.deepEqual(h.calls, []);
  }
});

test("checkpoint retries retain the exact account, event and bytes with the original bounded backoff", async () => {
  for (const provider of ["instagram", "youtube", "pinterest", "tiktok"] as const) {
    const h = runtime({ updateFailures: 2 });
    if (provider === "instagram") await h.service.persistInstagramVideoCheckpoint(instagramCheckpoint);
    if (provider === "youtube") await h.service.persistYoutubeUploadCheckpoint(youtubeCheckpoint);
    if (provider === "pinterest") await h.service.persistPinterestVideoCheckpoint(pinterestCheckpoint);
    if (provider === "tiktok") await h.service.persistTikTokUploadCheckpoint(tikTokCheckpoint);
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.calls[0], h.calls[1]); assert.deepEqual(h.calls[1], h.calls[2]);
    assert.deepEqual(h.delays, provider === "tiktok" ? [250, 500] : [200, 400]);
  }
});

test("Instagram continuation saves the container before delivery, lock release and clearing failure context", async () => {
  const h = runtime();
  const response = await h.service.queueInstagramVideoContinuation({ checkpoint: instagramCheckpoint, phaseResult: { ok: true, phase: "poll", outcome: "processing", checkpoint: instagramCheckpoint, retryAfterMs: 75_000 } } as Parameters<Service["queueInstagramVideoContinuation"]>[0]);
  assert.deepEqual(h.calls.map(({ kind }) => kind), ["checkpoint", "delivery", "lock", "clear"]);
  const patch = h.calls[0].data!.patch as Record<string, unknown>;
  assert.equal(patch.instagramVideoCheckpoint, instagramCheckpoint);
  assert.equal(patch.instagramVideoNextPollAt, new Date(now + 60_000).toISOString());
  assert.equal(patch.status, "queued");
  assert.equal(response.status, 202); assert.equal(response.headers.get("Retry-After"), "60");
  const payload = await response.json();
  assert.equal(payload.results.instagram.container_id, "container-owned");
  assert.equal(payload.publication_id, "publication-owned");
  assert.equal(payload.done, false); assert.equal(payload.queued, true);
});

test("YouTube continuation preserves uploaded offset and uses its own default polling interval", async () => {
  const h = runtime();
  const response = await h.service.queueYoutubeUploadContinuation({ checkpoint: youtubeCheckpoint, phaseResult: { ok: true, phase: "upload", outcome: "processing", checkpoint: youtubeCheckpoint } } as Parameters<Service["queueYoutubeUploadContinuation"]>[0]);
  assert.deepEqual(h.calls.map(({ kind }) => kind), ["checkpoint", "delivery", "lock", "clear"]);
  const patch = h.calls[0].data!.patch as Record<string, unknown>;
  assert.equal(patch.youtubeUploadCheckpoint, youtubeCheckpoint);
  assert.equal(patch.youtubeUploadOffset, 1024); assert.equal(patch.youtubeUploadTotalBytes, 8192);
  assert.equal(patch.youtubeUploadNextRunAt, new Date(now + 2000).toISOString());
  const payload = await response.json();
  assert.equal(response.headers.get("Retry-After"), "2");
  assert.equal(payload.results.youtube_shorts.offset, 1024);
  assert.equal(payload.results.youtube_shorts.total_bytes, 8192);
});

test("Pinterest uses its persisted poll deadline and corrects expired deadlines without losing its media ID", async () => {
  for (const retryAt of [new Date(now + 23_000).toISOString(), new Date(now - 1).toISOString()]) {
    const h = runtime();
    const response = await h.service.queuePinterestVideoContinuation({ step: { checkpoint: pinterestCheckpoint, state: "waiting", retryAt } } as Parameters<Service["queuePinterestVideoContinuation"]>[0]);
    assert.deepEqual(h.calls.map(({ kind }) => kind), ["checkpoint", "delivery", "lock", "clear"]);
    const payload = await response.json();
    assert.equal(payload.pollAfterMs, Date.parse(retryAt) > now ? 23_000 : 1000);
    assert.equal(payload.results.pinterest.media_id, "media-owned");
    assert.equal((h.calls[0].data!.patch as Record<string, unknown>).pinterestVideoCheckpoint, pinterestCheckpoint);
  }
});

test("Meta rate-limit retries preserve their separate 30-second to five-minute policy", async () => {
  for (const [requested, expected] of [[100, 30_000], [600_000, 300_000], [undefined, 60_000]] as const) {
    const h = runtime();
    const response = await h.service.queueInstagramRateLimitRetry({ error: "Meta limit", retryAfterMs: requested });
    assert.ok(response);
    assert.deepEqual(h.calls.map(({ kind }) => kind), ["checkpoint", "delivery", "lock", "clear"]);
    const payload = await response.json();
    assert.equal(payload.pollAfterMs, expected);
    assert.equal(payload.results.instagram.retryable, true);
    assert.equal((h.calls[0].data!.patch as Record<string, unknown>).lastInstagramRateLimitError, "Meta limit");
  }
});

test("a persistence, delivery or lock failure cannot acknowledge a continuation or clear failure context", async () => {
  for (const [options, expectedKinds] of [
    [{ updateFailures: 3 }, ["checkpoint", "checkpoint", "checkpoint"]],
    [{ failDelivery: true }, ["checkpoint", "delivery"]],
    [{ failLock: true }, ["checkpoint", "delivery", "lock"]],
  ] as const) {
    const h = runtime(options);
    await assert.rejects(h.service.queueYoutubeUploadContinuation({ checkpoint: youtubeCheckpoint, phaseResult: { ok: true, phase: "upload", outcome: "processing", checkpoint: youtubeCheckpoint } } as Parameters<Service["queueYoutubeUploadContinuation"]>[0]), /unavailable/);
    assert.deepEqual(h.calls.map(({ kind }) => kind), expectedKinds);
  }
});
