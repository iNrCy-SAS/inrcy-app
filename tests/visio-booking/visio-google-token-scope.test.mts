import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createScopedTokenCache } from "../../lib/visioGoogleTokenScope.ts";

test("one full reconciliation reuses its OAuth read without leaking it to another run", async () => {
  let databaseReads = 0;
  const cache = createScopedTokenCache(async () => ({
    value: `token-${++databaseReads}`,
    validUntilMs: Date.now() + 60_000,
  }));

  await cache.run(async () => {
    const tokens = await Promise.all(Array.from({ length: 100 }, () => cache.get()));
    assert.equal(new Set(tokens).size, 1);
    assert.equal(tokens[0], "token-1");
    assert.deepEqual(cache.stats(), {
      loads: 1,
      cacheHits: 0,
      pendingHits: 99,
      forcedLoads: 0,
    });
    for (let index = 0; index < 100; index += 1) {
      assert.equal(await cache.get(), "token-1");
    }
    assert.equal(databaseReads, 1, "199 of 200 repeated reads are avoided");
    assert.equal(cache.stats()?.cacheHits, 100);
  });

  assert.equal(cache.stats(), null);
  await cache.run(async () => assert.equal(await cache.get(), "token-2"));
  assert.equal(databaseReads, 2, "a later reconciliation rereads the integration");
});

test("a 401 rotates the scoped token and all subsequent requests use the new lease", async () => {
  let reads = 0;
  const cache = createScopedTokenCache(async (forceRefresh) => {
    reads += 1;
    return {
      value: forceRefresh ? "rotated-token" : "old-token",
      validUntilMs: Date.now() + 60_000,
    };
  });

  await cache.run(async () => {
    assert.equal(await cache.get(), "old-token");
    assert.equal(await cache.get(true), "rotated-token");
    assert.equal(await cache.get(), "rotated-token");
    assert.deepEqual(cache.stats(), {
      loads: 2,
      cacheHits: 1,
      pendingHits: 0,
      forcedLoads: 1,
    });
  });
  assert.equal(reads, 2);
});

test("failed refresh never falls back to the token rejected by Google", async () => {
  let reads = 0;
  const cache = createScopedTokenCache(async (forceRefresh) => {
    reads += 1;
    if (forceRefresh) throw new Error("refresh_failed");
    return {
      value: reads === 1 ? "rejected-token" : "fresh-database-token",
      validUntilMs: Date.now() + 60_000,
    };
  });

  await cache.run(async () => {
    assert.equal(await cache.get(), "rejected-token");
    await assert.rejects(cache.get(true), /refresh_failed/);
    assert.equal(await cache.get(), "fresh-database-token");
    assert.equal(cache.stats()?.loads, 3);
  });
});

test("an expired lease is reloaded, and an older in-flight read cannot undo rotation", async () => {
  let currentTime = 1_000;
  let reads = 0;
  const cache = createScopedTokenCache(
    async (forceRefresh) => ({
      value: forceRefresh ? "rotated" : `token-${++reads}`,
      validUntilMs: currentTime + 100,
    }),
    () => currentTime,
  );
  await cache.run(async () => {
    assert.equal(await cache.get(), "token-1");
    currentTime += 101;
    assert.equal(await cache.get(), "token-2");
  });

  let releaseOld!: (value: { value: string; validUntilMs: number }) => void;
  const oldRead = new Promise<{ value: string; validUntilMs: number }>((resolve) => {
    releaseOld = resolve;
  });
  const racingCache = createScopedTokenCache(
    (forceRefresh) =>
      forceRefresh
        ? Promise.resolve({ value: "rotated", validUntilMs: currentTime + 100 })
        : oldRead,
    () => currentTime,
  );
  await racingCache.run(async () => {
    const stalePending = racingCache.get();
    assert.equal(await racingCache.get(true), "rotated");
    releaseOld({ value: "stale", validUntilMs: currentTime + 100 });
    assert.equal(await stalePending, "stale");
    assert.equal(await racingCache.get(), "rotated");
  });
});

test("the Google synchronizer enables the scope only for its full reconciliation", () => {
  const source = readFileSync("lib/visioBookingGoogle.ts", "utf8");
  const fullSync = source.slice(
    source.indexOf("export async function syncVisioTeamCalendarsToShared"),
    source.indexOf("async function readFreeBusy"),
  );
  assert.match(fullSync, /googleAccessTokenCache\.run\(\(\) => performVisioTeamCalendarSync\(input\)\)/);
  assert.match(source, /if \(response\.status === 401 && retryUnauthorized\) \{[\s\S]*?getGoogleAccessToken\(true\)/);
  assert.match(fullSync, /\[visio-team-calendar-sync\]\[stage\]/);
  assert.match(source, /TEAM_MIRROR_DEFAULT_PAST_DAYS = 30/);
  assert.match(source, /TEAM_MIRROR_DEFAULT_FUTURE_DAYS = 365/);
  assert.match(readFileSync("vercel.json", "utf8"), /"path": "\/api\/cron\/visio-calendar-sync",\s*"schedule": "\*\/1 \* \* \* \*"/);
});
