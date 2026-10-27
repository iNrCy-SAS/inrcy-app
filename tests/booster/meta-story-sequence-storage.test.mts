import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = { id: string; user_id: string; type: string; payload: Record<string, unknown> };
type NativeArgs = { videoUrl: string; preparedId?: string; onPrepared: (id: string | null) => Promise<void>; onPublishStarting: () => Promise<void> };
const account = "11111111-1111-4111-8111-111111111111";
const publication = "22222222-2222-4222-8222-222222222222";
const nextPublication = "33333333-3333-4333-8333-333333333333";
const copy = <T,>(value: T): T => structuredClone(value);

function harness() {
  const rows = new Map<string, Row>(); const nativeCalls: Array<{ index: number; preparedId?: string }> = [];
  const renderCalls: Array<Record<string, unknown>> = []; const soundtrackCalls: Array<{ prompt: string; soundtrackId?: string; selectionKey?: string }> = [];
  const leases: Array<Record<string, unknown>> = [];
  let failAt = -1, ambiguous = false, failWriteAt = -1, writes = 0, failRead = false, busy = false;
  let beforeUpdate: (() => void) | null = null;
  const soundtrack = { id: "atelier-vivant", sha256: "a".repeat(64), absolutePath: "fixture.wav" };
  const db = { from(table: string) {
    assert.equal(table, "app_events"); let action = "read"; let value: Record<string, unknown> | null = null;
    const filters = new Map<string, unknown>();
    const query = {
      select() { return query; }, eq(key: string, expected: unknown) { filters.set(key, expected); return query; },
      insert(input: Record<string, unknown>) { action = "insert"; value = input; return query; },
      update(input: Record<string, unknown>) { action = "update"; value = input; return query; },
      async maybeSingle() {
        if (action !== "insert") { assert.ok(filters.has("user_id"), "Every durable read/write stays in the active account"); assert.equal(filters.get("type"), "publish_meta_story_sequence"); }
        if (action === "read" && failRead) return { data: null, error: { message: "read unavailable" } };
        if (action === "insert") {
          writes++; if (writes === failWriteAt) return { data: null, error: null };
          const inserted = value as unknown as Row;
          assert.equal(inserted.user_id, account); assert.equal(inserted.type, "publish_meta_story_sequence");
          if (rows.has(inserted.id)) return { data: null, error: { code: "23505" } };
          rows.set(inserted.id, copy(inserted)); return { data: { id: inserted.id }, error: null };
        }
        if (action === "update") { writes++; beforeUpdate?.(); if (writes === failWriteAt) return { data: null, error: null }; assert.ok(filters.has("payload->>revision"), "Updates must fence stale lease owners with CAS"); }
        const row = rows.get(String(filters.get("id")));
        const matches = row && [...filters].every(([key, expected]) => key === "payload->>revision" ? String(row.payload.revision) === expected : row[key as keyof Row] === expected);
        if (!matches) return { data: null, error: null };
        if (action === "update") { row.payload = copy(value!.payload as Record<string, unknown>); return { data: { id: row.id }, error: null }; }
        return { data: copy(row), error: null };
      },
    }; return query;
  } };
  const load = runtimeModules({
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/executionIdempotency": {
      async acquireExecutionIdempotencyLock(input: Record<string, unknown>) { leases.push(input); return busy ? { state: "running", lock: { id: "lease" } } : { state: "acquired", lock: { id: "lease" } }; },
      async completeExecutionIdempotencyLockOrThrow() {}, async failExecutionIdempotencyLock() {},
    },
    "@/lib/aiMediaGenerationSoundtracks": { async loadAiMediaSoundtrack(prompt: string, options: { soundtrackId?: string; selectionKey?: string }) { soundtrackCalls.push({ prompt, ...options }); return soundtrack; } },
    "@/lib/instagramImageMotionVideo": { async createInstagramImageMotionVideo(input: Record<string, unknown>) { renderCalls.push(input); return { publicUrl: `https://storage.example/${String(input.publicationId)}.mp4` }; } },
    "@/lib/metaPhotoStoryPublisher": { async publishMetaVideoStory(input: NativeArgs) {
      const index = Number(input.videoUrl.match(/-(\d)\.mp4$/)![1]); nativeCalls.push({ index, preparedId: input.preparedId });
      if (!input.preparedId) await input.onPrepared(`container-${index}`);
      await input.onPublishStarting();
      if (index === failAt) return { ok: false, certainty: ambiguous ? "unknown" : "not_published", retryable: !ambiguous, error: "fixture refusal" };
      return { ok: true, remoteId: `story-${index}` };
    } },
  });
  const api = load<typeof import("../../lib/metaStorySequenceStorage.ts")>("lib/metaStorySequenceStorage.ts");
  const args = { accountId: account, publicationId: publication, channel: "instagram" as const, remoteAccountId: "12345", accessToken: "fixture-private-token", authMode: "facebook_login" as const, soundtrackPrompt: "Un atelier vivant", photos: [0, 1, 2, 3, 4].map(index => ({ url: `https://storage.example/${index}.jpg`, storagePath: `${account}/photo-${index}.jpg`, sourceIdentity: `jpeg-sha256:${String(index + 1).repeat(64)}` })) };
  return { rows, args, nativeCalls, renderCalls, soundtrackCalls, leases,
    run(overrides: Partial<typeof args> & { resumeRef?: unknown; deadlineAt?: number } = {}) { return api.publishPersistedMetaStorySequence({ ...args, ...overrides }); },
    fail(index: number, unknown = false) { failAt = index; ambiguous = unknown; }, clearFailure() { failAt = -1; },
    failRead() { failRead = true; }, failWriteAt(at: number) { failWriteAt = at; }, busy() { busy = true; },
    beforeUpdate(callback: () => void) { beforeUpdate = callback; },
  };
}

test("five Story videos persist every commit, share one saved track and replay confirmed IDs across a new parent", async () => {
  const h = harness(); const first = await h.run();
  assert.equal(first.ok, true); assert.deepEqual(h.nativeCalls.map(call => call.index), [0, 1, 2, 3, 4]);
  assert.equal(first.published_image_count, 5); assert.equal(first.expected_image_count, 5);
  const ref = String(first.story_sequence_resume_ref); const row = h.rows.get(ref)!;
  assert.equal(row.type, "publish_meta_story_sequence"); assert.equal(row.payload.soundtrackId, "atelier-vivant");
  assert.equal(h.soundtrackCalls.length, 1); assert.ok(h.renderCalls.every(call => call.loadedSoundtrack === h.renderCalls[0].loadedSoundtrack));
  assert.ok(h.renderCalls.every((call, index) => call.publicationId === `${ref}-${index}` && call.preserveComposition === true));
  assert.ok(!JSON.stringify(row).includes("fixture-private-token"));
  const replay = await h.run({ publicationId: nextPublication, resumeRef: ref, soundtrackPrompt: "A changed retry brief must not replace the saved track" });
  assert.equal(replay.ok, true); assert.deepEqual(replay.story_ids, first.story_ids); assert.equal(h.nativeCalls.length, 5); assert.equal(h.renderCalls.length, 5); assert.equal(h.soundtrackCalls.length, 1);
  assert.ok(h.leases.every(lease => lease.idempotencyKey === ref && lease.ttlMs === 300_000));
});

test("a certain failure resumes only its remaining frames with prepared containers and the saved soundtrack", async () => {
  const h = harness(); h.fail(3); const partial = await h.run();
  assert.equal(partial.ok, false); assert.equal(partial.retryable, true); assert.equal(partial.published_image_count, 3);
  const ref = String(partial.story_sequence_resume_ref); h.clearFailure();
  const complete = await h.run({ publicationId: nextPublication, resumeRef: ref, soundtrackPrompt: "Different text" });
  assert.equal(complete.ok, true); assert.deepEqual(h.nativeCalls.map(call => call.index), [0, 1, 2, 3, 3, 4]);
  assert.equal(h.nativeCalls[4].preparedId, "container-3");
  assert.equal(h.soundtrackCalls[1].soundtrackId, "atelier-vivant");
  assert.deepEqual(complete.story_ids, ["story-0", "story-1", "story-2", "story-3", "story-4"]);
});

test("unknown remote publication blocks every blind retry, including a new publication parent", async () => {
  const h = harness(); h.fail(2, true); const unknown = await h.run();
  assert.equal(unknown.retryable, false); assert.equal(unknown.published_image_count, 2);
  h.clearFailure(); const retry = await h.run({ publicationId: nextPublication, resumeRef: unknown.story_sequence_resume_ref });
  assert.equal(retry.ok, false); assert.equal(retry.requestMayHaveSucceeded, true); assert.equal(h.nativeCalls.length, 3);
});

test("account, channel, remote account, source bytes and source order are checked before any native API", async () => {
  const h = harness(); h.fail(1); const first = await h.run(); const ref = first.story_sequence_resume_ref; const before = h.nativeCalls.length;
  for (const overrides of [
    { accountId: "44444444-4444-4444-8444-444444444444" }, { remoteAccountId: "67890" },
    { photos: [...h.args.photos].reverse() }, { photos: h.args.photos.map((photo, index) => index ? photo : { ...photo, sourceIdentity: `jpeg-sha256:${"e".repeat(64)}` }) },
  ]) assert.equal((await h.run({ ...overrides, resumeRef: ref })).ok, false);
  assert.equal(h.nativeCalls.length, before);
  assert.equal((await h.run({ resumeRef: "https://attacker.example/ref" })).ok, false);
  assert.equal((await h.run({ resumeRef: "55555555-5555-4555-8555-555555555555" })).ok, false);
  assert.equal(h.nativeCalls.length, before);
});

test("missing durable write acknowledgement, unavailable reads or an occupied lease cannot publish", async () => {
  const first = harness(); first.failWriteAt(1); assert.equal((await first.run()).ok, false); assert.equal(first.nativeCalls.length, 0);
  const read = harness(); read.failRead(); assert.equal((await read.run()).ok, false); assert.equal(read.nativeCalls.length, 0);
  const busy = harness(); busy.busy(); assert.equal((await busy.run()).ok, false); assert.equal(busy.nativeCalls.length, 0);
  const budget = harness(); const limited = await budget.run({ deadlineAt: Date.now() - 1 }); assert.equal(limited.retryable, true); assert.equal(limited.requestMayHaveSucceeded, false); assert.equal(budget.nativeCalls.length, 0);
});

test("a stale CAS writer cannot overwrite a newer published receipt or call the provider", async () => {
  const h = harness(); let mutated = false;
  h.beforeUpdate(() => {
    if (mutated) return; mutated = true;
    const row = [...h.rows.values()][0]; const state = row.payload.state as { items: Array<Record<string, unknown>> };
    row.payload = { ...row.payload, revision: Number(row.payload.revision) + 1, state: { ...state, items: state.items.map((item, index) => ({ index, source: item.source, status: "published", remoteId: `newer-story-${index}` })) } };
  });
  assert.equal((await h.run()).ok, false); assert.equal(h.nativeCalls.length, 0);
  const state = [...h.rows.values()][0].payload.state as { items: Array<Record<string, unknown>> };
  assert.ok(state.items.every(item => item.status === "published" && String(item.remoteId).startsWith("newer-story-")));
});

test("a crash before native commit is safely resumed, while a dispatch after durable commit-start stays unknown", async () => {
  for (const started of [false, true]) {
    const h = harness(); h.fail(0); const first = await h.run(); const ref = String(first.story_sequence_resume_ref);
    const row = h.rows.get(ref)!; const state = row.payload.state as { items: Array<Record<string, unknown>> };
    const item = state.items[0]; state.items[0] = { index: 0, source: item.source, status: "dispatching" };
    const native = row.payload.nativePreparations as Array<{ publishStarted: boolean }>; native[0].publishStarted = started;
    h.clearFailure(); const before = h.nativeCalls.length; const resumed = await h.run({ publicationId: nextPublication, resumeRef: ref });
    assert.equal(resumed.ok, !started); assert.equal(h.nativeCalls.length, started ? before : before + 5);
  }
});
