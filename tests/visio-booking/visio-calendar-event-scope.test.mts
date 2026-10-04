import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calendarEventMutationTarget,
  createScopedCalendarEventCache,
} from "../../lib/visioCalendarEventScope.ts";

type Event = { id: string; status?: string; summary?: string };

test("a full calendar snapshot eliminates hundreds of repeated source and replica reads", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  let requests = 0;
  const load = async () => {
    requests += 1;
    throw new Error("snapshot event must not be fetched again");
  };
  await cache.run(async () => {
    for (let index = 0; index < 443; index += 1) {
      cache.remember("shared", { id: `event-${index}`, status: "confirmed" });
    }
    for (let member = 0; member < 4; member += 1) {
      for (let index = 0; index < 443; index += 1) {
        assert.equal((await cache.get("shared", `event-${index}`, load))?.status, "confirmed");
      }
    }
    assert.equal(requests, 0);
    assert.equal(cache.stats()?.cacheHits, 1772);
  });
});

test("an event absent from the window is fetched and only an explicit missing result is cached", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  let requests = 0;
  await cache.run(async () => {
    cache.remember("shared", { id: "in-window" });
    const outside = () => cache.get("shared", "outside-window", async () => {
      requests += 1;
      return { id: "outside-window", status: "confirmed" };
    });
    assert.equal((await outside())?.status, "confirmed");
    assert.equal((await outside())?.status, "confirmed");
    const missing = () => cache.get("shared", "deleted", async () => {
      requests += 1;
      return null;
    });
    assert.equal(await missing(), null);
    assert.equal(await missing(), null);
    assert.equal(requests, 2);
  });
});

test("snapshots retain tombstones and keep identical ids in separate calendars distinct", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  await cache.run(async () => {
    cache.remember("member", { id: "appointment", status: "cancelled" });
    cache.remember("shared", { id: "appointment", status: "confirmed" });
    const fail = async () => { throw new Error("unexpected read"); };
    assert.equal((await cache.get("member", "appointment", fail))?.status, "cancelled");
    assert.equal((await cache.get("shared", "appointment", fail))?.status, "confirmed");
  });
});

test("Google mutation responses replace the cache without changing reconciliation's original snapshots", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  const original = { id: "appointment", summary: "Original", status: "confirmed" };
  await cache.run(async () => {
    cache.remember("shared", original);
    const fail = async () => { throw new Error("unexpected read"); };
    const previous = await cache.get("shared", original.id, fail);
    cache.invalidate("shared", original.id);
    cache.remember("shared", { ...original, summary: "Moved", status: "cancelled" });
    assert.equal((await cache.get("shared", original.id, fail))?.status, "cancelled");
    assert.equal(original.summary, "Original");
    assert.equal(previous?.summary, "Original");
    previous!.summary = "Old snapshot modified by reconciliation";
    assert.equal((await cache.get("shared", original.id, fail))?.summary, "Moved");
  });
});

test("failed writes invalidate stale snapshots and failed reads are retried", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  await cache.run(async () => {
    cache.remember("shared", { id: "event", summary: "Before ambiguous write" });
    cache.invalidate("shared", "event");
    await assert.rejects(cache.get("shared", "event", async () => {
      throw new Error("temporary Google failure");
    }), /temporary Google failure/);
    const current = await cache.get("shared", "event", async () => ({
      id: "event", summary: "Write actually succeeded",
    }));
    assert.equal(current?.summary, "Write actually succeeded");
    assert.equal(cache.stats()?.loads, 2);
  });
});

test("parallel fallback reads share one request but cannot overwrite a later write", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  await cache.run(async () => {
    let resolveRead!: (event: Event) => void;
    const load = () => new Promise<Event>((resolve) => { resolveRead = resolve; });
    const first = cache.get("shared", "event", load);
    const second = cache.get("shared", "event", load);
    cache.invalidate("shared", "event");
    cache.remember("shared", { id: "event", summary: "New version" });
    resolveRead({ id: "event", summary: "Old version" });
    await Promise.all([first, second]);
    const current = await cache.get("shared", "event", async () => null);
    assert.equal(current?.summary, "New version");
    assert.equal(cache.stats()?.loads, 1);
    assert.equal(cache.stats()?.pendingHits, 1);
  });
});

test("fresh conference polling can observe Google finishing outside the current sync", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  await cache.run(async () => {
    cache.remember("shared", { id: "event", summary: "Meet pending" });
    cache.invalidate("shared", "event");
    const refreshed = await cache.get("shared", "event", async () => ({
      id: "event", summary: "Meet ready",
    }));
    assert.equal(refreshed?.summary, "Meet ready");
  });
});

test("concurrent and later syncs never reuse each other's calendar snapshots", async () => {
  const cache = createScopedCalendarEventCache<Event>();
  const summaries = await Promise.all(["A", "B"].map((summary) => cache.run(async () => {
    cache.remember("shared", { id: "event", summary });
    await Promise.resolve();
    return (await cache.get("shared", "event", async () => null))?.summary;
  })));
  assert.deepEqual(summaries, ["A", "B"]);
  assert.equal(cache.stats(), null);
  await cache.run(async () => {
    const event = await cache.get("shared", "event", async () => ({ id: "event", summary: "External edit" }));
    assert.equal(event?.summary, "External edit");
    assert.equal(cache.stats()?.loads, 1);
  });
  let requests = 0;
  const load = async () => { requests += 1; return { id: "event" }; };
  await cache.get("shared", "event", load);
  await cache.get("shared", "event", load);
  assert.equal(requests, 2, "interactive reads outside sync remain fresh");
});

test("Calendar write paths invalidate the exact resource, including insert conflicts and moves", () => {
  assert.deepEqual(calendarEventMutationTarget("/calendars/shared%40example.com/events/id%3A1?sendUpdates=none", "PATCH"), {
    calendarId: "shared@example.com", eventId: "id:1", resultCalendarId: "shared@example.com",
  });
  assert.deepEqual(calendarEventMutationTarget("/calendars/shared/events?sendUpdates=none", "POST", '{"id":"inserted"}'), {
    calendarId: "shared", eventId: "inserted", resultCalendarId: "shared",
  });
  assert.deepEqual(calendarEventMutationTarget("/calendars/member/events/id/move?destination=shared%40example.com&sendUpdates=none", "POST"), {
    calendarId: "member", eventId: "id", resultCalendarId: "shared@example.com",
  });
  assert.equal(calendarEventMutationTarget("/calendars/shared/events/watch", "POST"), null);
  assert.equal(calendarEventMutationTarget("/calendars/shared/events/id", "GET"), null);
  assert.equal(calendarEventMutationTarget("/freeBusy", "POST"), null);
});

test("the full synchronizer seeds complete listings and records writes while Meet polling stays fresh", () => {
  const source = readFileSync("lib/visioBookingGoogle.ts", "utf8");
  assert.match(source, /return googleCalendarEventCache\.run\(\(\) =>\s*googleAccessTokenCache\.run/);
  assert.match(source, /\} while \(pageToken\);\s*for \(const event of events\) \{\s*googleCalendarEventCache\.remember\(input\.calendarId, event\)/);
  assert.match(source, /calendarEventMutationTarget\(path, init\?\.method, init\?\.body\)/);
  assert.match(source, /googleCalendarEventCache\.invalidate\(mutation\.resultCalendarId, mutation\.eventId\)/);
  assert.match(source, /googleCalendarEventCache\.remember\(mutation\.resultCalendarId, payload\)/);
  assert.match(source, /getCalendarEvent\(calendarId, eventId, \{ fresh: true \}\)/);
});
