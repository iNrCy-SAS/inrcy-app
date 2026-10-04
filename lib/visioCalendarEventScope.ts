import { AsyncLocalStorage } from "node:async_hooks";

type CalendarEvent = { id?: string };

type CalendarEventScope<T> = {
  events: Map<string, T | null>;
  pending: Map<string, Promise<T | null>>;
  stats: { loads: number; cacheHits: number; pendingHits: number; seeded: number };
};

/** Positive list results are reusable; absence from a date window is not deletion. */
export function createScopedCalendarEventCache<T extends CalendarEvent>() {
  const storage = new AsyncLocalStorage<CalendarEventScope<T>>();
  const keyFor = (calendarId: string, eventId: string) =>
    JSON.stringify([calendarId, eventId]);

  return {
    run<R>(operation: () => Promise<R>): Promise<R> {
      return storage.run({
        events: new Map(),
        pending: new Map(),
        stats: { loads: 0, cacheHits: 0, pendingHits: 0, seeded: 0 },
      }, operation);
    },

    stats() {
      const scope = storage.getStore();
      return scope ? { ...scope.stats } : null;
    },

    remember(calendarId: string, event: T) {
      const scope = storage.getStore();
      if (!scope || !event.id) return;
      const key = keyFor(calendarId, event.id);
      // Keep reconciliation's original snapshots separate from later writes.
      scope.events.set(key, structuredClone(event));
      scope.pending.delete(key);
      scope.stats.seeded += 1;
    },

    invalidate(calendarId: string, eventId: string) {
      const scope = storage.getStore();
      const key = keyFor(calendarId, eventId);
      scope?.events.delete(key);
      scope?.pending.delete(key);
    },

    async get(
      calendarId: string,
      eventId: string,
      load: () => Promise<T | null>,
    ): Promise<T | null> {
      const scope = storage.getStore();
      if (!scope) return load();
      const key = keyFor(calendarId, eventId);
      if (scope.events.has(key)) {
        scope.stats.cacheHits += 1;
        return structuredClone(scope.events.get(key)!);
      }
      const pending = scope.pending.get(key);
      if (pending) {
        scope.stats.pendingHits += 1;
        return structuredClone(await pending);
      }
      const promise = load();
      scope.pending.set(key, promise);
      scope.stats.loads += 1;
      try {
        const event = await promise;
        // A read started before a mutation must not overwrite its result.
        if (scope.pending.get(key) === promise) {
          scope.events.set(key, structuredClone(event));
        }
        return event;
      } finally {
        if (scope.pending.get(key) === promise) scope.pending.delete(key);
      }
    },
  };
}

/** The event resource affected by a Calendar write, including events.move. */
export function calendarEventMutationTarget(
  path: string,
  method = "GET",
  body?: BodyInit | null,
) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(method.toUpperCase())) {
    return null;
  }
  const [pathname, query = ""] = path.split("?");
  const match = pathname.match(/^\/calendars\/([^/]+)\/events(?:\/([^/]+))?(?:\/(move))?$/);
  if (!match || match[2] === "watch") return null;
  const calendarId = decodeURIComponent(match[1]);
  // An insert can race another writer and return 409. Discard a cached 404
  // before sending it so conflict recovery can read the newly created event.
  const insertedId = !match[2] && typeof body === "string"
    ? String((JSON.parse(body) as { id?: unknown }).id || "")
    : "";
  return {
    calendarId,
    eventId: match[2] ? decodeURIComponent(match[2]) : insertedId,
    resultCalendarId: match[3] === "move"
      ? new URLSearchParams(query).get("destination") || calendarId
      : calendarId,
  };
}
