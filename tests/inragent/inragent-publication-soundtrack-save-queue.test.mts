import assert from "node:assert/strict";
import test from "node:test";
import { createInrAgentPublicationSoundtrackSaveQueue } from "../../lib/inrAgentPublicationSoundtrackSaveQueue.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("rapid choices for one channel coalesce before starting and every waiter follows the saved final choice", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), calls: string[] = [];
  const first = queue.enqueue(async () => { calls.push("piano"); }, "publication:facebook");
  const second = queue.enqueue(async () => { calls.push("jazz"); }, "publication:facebook");
  const third = queue.enqueue(async () => { calls.push("Auto"); }, "publication:facebook");
  await Promise.all([first, second, third, queue.flush()]);
  assert.deepEqual(calls, ["Auto"]);
});

test("an active request finishes before the latest waiting selection, without losing another channel", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), gate = deferred(), calls: string[] = [];
  let active = 0, maximum = 0;
  const task = (name: string, wait?: Promise<void>) => async () => {
    active++; maximum = Math.max(maximum, active); calls.push(`start:${name}`);
    if (wait) await wait;
    calls.push(`end:${name}`); active--;
  };
  const first = queue.enqueue(task("facebook:piano", gate.promise), "publication:facebook");
  await Promise.resolve();
  const discarded = queue.enqueue(task("facebook:funk"), "publication:facebook");
  const instagram = queue.enqueue(task("instagram:rock"), "publication:instagram");
  const last = queue.enqueue(task("facebook:jazz"), "publication:facebook");
  let flushed = false;
  const flushing = queue.flush().then(() => { flushed = true; });
  await Promise.resolve(); assert.equal(flushed, false);
  gate.resolve();
  await Promise.all([first, discarded, instagram, last, flushing]);
  assert.deepEqual(calls, ["start:facebook:piano", "end:facebook:piano", "start:facebook:jazz", "end:facebook:jazz", "start:instagram:rock", "end:instagram:rock"]);
  assert.equal(maximum, 1);
});

test("flush also waits for a choice enqueued by a completion callback while the queue becomes idle", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), gate = deferred(), started = deferred(), calls: string[] = [];
  const first = queue.enqueue(async () => { calls.push("first"); }, "facebook");
  void first.then(() => queue.enqueue(async () => { calls.push("last"); started.resolve(); await gate.promise; }, "instagram"));
  let flushed = false;
  const flushing = queue.flush().then(() => { flushed = true; });
  await first; await started.promise;
  assert.deepEqual(calls, ["first", "last"]); assert.equal(flushed, false);
  gate.resolve(); await flushing;
});

test("a failed latest choice rejects completion and flush until a successful retry repairs that channel", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), error = new Error("save_failed");
  await assert.rejects(queue.enqueue(async () => { throw error; }, "facebook"), { message: "save_failed" });
  await assert.rejects(queue.flush(), { message: "save_failed" });
  await queue.enqueue(async () => {}, "instagram");
  await assert.rejects(queue.flush(), { message: "save_failed" }, "Saving another channel cannot erase the failure");
  await queue.enqueue(async () => {}, "facebook");
  await queue.flush();
});

test("an obsolete in-flight failure does not poison a newer successful selection", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), gate = deferred(), calls: string[] = [];
  const first = queue.enqueue(async () => { calls.push("old"); await gate.promise; }, "facebook");
  await Promise.resolve();
  const latest = queue.enqueue(async () => { calls.push("latest"); }, "facebook");
  const flushing = queue.flush();
  gate.reject(new Error("obsolete_failure"));
  await assert.rejects(first, /obsolete_failure/); await latest; await flushing;
  assert.deepEqual(calls, ["old", "latest"]);
});

test("unkeyed tasks stay distinct and synchronous failures do not stop following saves", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), calls: string[] = [];
  const failed = queue.enqueue(() => { calls.push("failed"); throw new Error("sync_failure"); });
  const second = queue.enqueue(() => { calls.push("second"); });
  const third = queue.enqueue(() => { calls.push("third"); });
  await assert.rejects(failed, /sync_failure/); await Promise.all([second, third]);
  await assert.rejects(queue.flush(), /sync_failure/);
  assert.deepEqual(calls, ["failed", "second", "third"]);
});

test("acknowledging a confirmed rollback clears only that failure and never discards an active save", async () => {
  const queue = createInrAgentPublicationSoundtrackSaveQueue(), gate = deferred();
  await assert.rejects(queue.enqueue(() => { throw new Error("facebook_failed"); }, "facebook"));
  const saving = queue.enqueue(async () => { await gate.promise; }, "instagram");
  await Promise.resolve();
  queue.acknowledgeFailure("facebook");
  let flushed = false;
  const flushing = queue.flush().then(() => { flushed = true; });
  await Promise.resolve(); assert.equal(flushed, false);
  gate.resolve(); await saving; await flushing;
  await assert.rejects(queue.enqueue(() => { throw new Error("instagram_failed"); }, "instagram"));
  queue.acknowledgeFailure("facebook");
  await assert.rejects(queue.flush(), /instagram_failed/);
  queue.acknowledgeFailure("instagram"); await queue.flush();
});
