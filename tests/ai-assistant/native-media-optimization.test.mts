import assert from "node:assert/strict";
import test from "node:test";
import { runInrAssistantNativeMediaOptimization } from "../../lib/inrAssistantNativeMediaOptimization.ts";

const SOURCE = "11111111-1111-4111-8111-111111111111", OUTPUT = "22222222-2222-4222-8222-222222222222";
function fixture(options: { completed?: boolean; fail?: boolean; anotherJob?: boolean; badProof?: boolean; noOutput?: boolean; neverDone?: boolean; small?: boolean; badSize?: boolean } = {}) {
  let active = true, now = 0, reads = 0;
  const requests: { url: string; method: string; body?: string }[] = [];
  const source = { id: SOURCE, media_type: "video", size_bytes: options.small ? 4_000_000 : 40_000_000, mime_type: "video/mp4", original_file_name: "source.mp4" };
  const output = { id: OUTPUT, media_type: "video", size_bytes: options.badSize ? "invalid" : 19_000_000, media_metadata: { library_optimization: { source_media_id: options.badProof ? "other" : SOURCE, job_id: "job-native", target_bytes: 20_000_000 } } };
  const job = { id: "job-native", media_id: SOURCE, status: options.completed ? "succeeded" : "queued", result: options.completed ? { outputMediaId: OUTPUT } : {} };
  const ports = {
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); requests.push({ url, method: init?.method || "GET", ...(init?.body ? { body: String(init.body) } : {}) }); assert.ok(init?.signal);
      if (url === "/api/media-library/optimization") return Response.json({ job }, { status: job.status === "succeeded" ? 200 : 202 });
      if (url === "/api/media-library/optimization/run") return Response.json({ ok: true });
      if (url.endsWith(SOURCE)) { reads++; return Response.json({ items: [{ ...source, ...(reads > 1 ? { optimization: { ...job, id: options.anotherJob ? "other-job" : job.id, status: options.neverDone ? "processing" : options.fail ? "failed" : "succeeded", result: { outputMediaId: OUTPUT } } } : {}) }] }); }
      if (url.endsWith(OUTPUT)) return Response.json({ items: options.noOutput ? [] : [output] });
      throw new Error(`Unexpected native URL ${url}`);
    }) as typeof fetch,
    wait: async (milliseconds: number) => { now += milliseconds; }, now: () => now,
  };
  return { input: { mediaId: SOURCE, targetBytes: 20_000_000, isCurrent: () => active }, ports, requests, invalidate: () => { active = false; } };
}

test("optimization queues once, starts the existing worker, verifies exact copy provenance and never deletes the original", async () => {
  const f = fixture(); assert.deepEqual(await runInrAssistantNativeMediaOptimization(f.input, f.ports), { sourceId: SOURCE, outputId: OUTPUT, targetBytes: 20_000_000 });
  assert.deepEqual(f.requests.filter(value => value.method === "POST").map(value => [value.url, JSON.parse(value.body!)]), [
    ["/api/media-library/optimization", { mediaId: SOURCE, targetBytes: 20_000_000 }],
    ["/api/media-library/optimization/run", { mediaId: SOURCE, jobType: "media_library_video_compress_v1" }],
  ]);
  assert.equal(f.requests.some(value => value.method === "DELETE"), false);
});

test("already completed native idempotency result is read back without restarting its worker", async () => {
  const f = fixture({ completed: true }); await runInrAssistantNativeMediaOptimization(f.input, f.ports);
  assert.equal(f.requests.filter(value => value.url.endsWith("/run")).length, 0);
});

for (const options of [{ fail: true }, { anotherJob: true }, { badProof: true }, { noOutput: true }, { badSize: true }, { neverDone: true }]) {
  test(`never acknowledges an unverified result or requeues automatically: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options); await assert.rejects(runInrAssistantNativeMediaOptimization(f.input, f.ports));
    assert.equal(f.requests.filter(value => value.url === "/api/media-library/optimization").length, 1);
    assert.equal(f.requests.some(value => value.method === "DELETE"), false);
  });
}

test("an already suitable source produces no mutation", async () => {
  const f = fixture({ small: true }); await assert.rejects(runInrAssistantNativeMediaOptimization(f.input, f.ports), /déjà cette limite/);
  assert.deepEqual(f.requests.map(value => value.method), ["GET"]);
});

for (const phase of ["source", "queue", "poll", "output"]) {
  test(`account/selection invalidation at ${phase} stops all further steps and no success is claimed`, async () => {
    const f = fixture(), original = f.ports.fetch; let sourceReads = 0;
    f.ports.fetch = async (url, init) => {
      const result = await original(url, init);
      if (String(url).endsWith(SOURCE)) sourceReads++;
      if (phase === "source" && sourceReads === 1 || phase === "queue" && String(url) === "/api/media-library/optimization"
        || phase === "poll" && sourceReads === 2 || phase === "output" && String(url).endsWith(OUTPUT)) f.invalidate();
      return result;
    };
    await assert.rejects(runInrAssistantNativeMediaOptimization(f.input, f.ports), /compte a changé/);
    if (phase === "source") assert.equal(f.requests.some(value => value.method === "POST"), false);
    if (phase === "queue") assert.equal(f.requests.some(value => value.url.endsWith("/run")), false);
  });
}

test("an uncertain queue response is never retried automatically", async () => {
  const f = fixture(), original = f.ports.fetch;
  f.ports.fetch = async (url, init) => { const result = await original(url, init); if (String(url) === "/api/media-library/optimization") throw new Error("response lost"); return result; };
  await assert.rejects(runInrAssistantNativeMediaOptimization(f.input, f.ports), /response lost/);
  assert.equal(f.requests.filter(value => value.method === "POST").length, 1);
});
