import assert from "node:assert/strict";
import test from "node:test";
import { DiscardedReviewPageError, ReviewPageCache } from "../../app/dashboard/e-reputation/review-page-cache.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

test("clicking a page during its preload shares the request and reuses the loaded result", async () => {
  const cache = new ReviewPageCache<string[]>();
  const response = deferred<string[]>();
  let calls = 0;
  const read = () => { calls++; return response.promise; };
  const preload = cache.load("account-a:location-a", "page-2", read);
  const click = cache.load("account-a:location-a", "page-2", read);
  assert.equal(click, preload);
  response.resolve(["review-51", "review-52"]);
  assert.deepEqual(await click, ["review-51", "review-52"]);
  assert.deepEqual(await cache.load("account-a:location-a", "page-2", read), ["review-51", "review-52"]);
  assert.equal(calls, 1);
});

test("refresh invalidates both loaded pages and a late preload before it can reach the current view", async () => {
  const cache = new ReviewPageCache<string>();
  await cache.load("account-a:location-a", "page-1", async () => "old first page");
  const response = deferred<string>();
  const pending = cache.load("account-a:location-a", "page-2", () => response.promise);
  const rejected = assert.rejects(pending, DiscardedReviewPageError);
  const oldRevision = cache.revision;
  cache.clear();
  const fresh = await cache.load("account-a:location-a", "page-1", async () => "new first page");
  response.resolve("outdated second page");
  await rejected;
  assert.equal(fresh, "new first page");
  assert.equal(cache.isCurrent("account-a:location-a", oldRevision), false);
});

test("identical page tokens from another account or establishment never reuse or publish the old page", async () => {
  for (const nextScope of ["account-b:location-a", "account-a:location-b"]) {
    const cache = new ReviewPageCache<string>();
    const response = deferred<string>();
    const old = cache.load("account-a:location-a", "next", () => response.promise);
    const rejected = assert.rejects(old, DiscardedReviewPageError);
    assert.equal(await cache.load(nextScope, "next", async () => "current reviews"), "current reviews");
    response.resolve("foreign reviews");
    await rejected;
    assert.equal(await cache.load(nextScope, "next", async () => { throw Error("Must reuse the current page"); }), "current reviews");
  }
});

test("a failed background preload remains retryable by the professional's next click", async () => {
  const cache = new ReviewPageCache<string>();
  await assert.rejects(cache.load("account-a:location-a", "next", async () => { throw Error("Temporary network failure"); }));
  assert.equal(await cache.load("account-a:location-a", "next", async () => "loaded on retry"), "loaded on retry");
});
