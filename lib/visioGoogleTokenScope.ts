import { AsyncLocalStorage } from "node:async_hooks";

export type ScopedTokenLease<T> = {
  value: T;
  validUntilMs: number;
};

export type ScopedTokenStats = {
  loads: number;
  cacheHits: number;
  pendingHits: number;
  forcedLoads: number;
};

type Scope<T> = {
  cached?: ScopedTokenLease<T>;
  pending?: { promise: Promise<ScopedTokenLease<T>>; forced: boolean };
  stats: ScopedTokenStats;
};

/** Reuses a token only inside one async operation, never across HTTP requests. */
export function createScopedTokenCache<T>(
  load: (forceRefresh: boolean) => Promise<ScopedTokenLease<T>>,
  now: () => number = Date.now,
) {
  const storage = new AsyncLocalStorage<Scope<T>>();

  return {
    run<R>(operation: () => Promise<R>): Promise<R> {
      return storage.run(
        {
          stats: { loads: 0, cacheHits: 0, pendingHits: 0, forcedLoads: 0 },
        },
        operation,
      );
    },

    stats(): ScopedTokenStats | null {
      const scope = storage.getStore();
      return scope ? { ...scope.stats } : null;
    },

    async get(forceRefresh = false): Promise<T> {
      const scope = storage.getStore();
      if (!scope) return (await load(forceRefresh)).value;

      if (forceRefresh) {
        // A 401 invalidates the previous lease even if refresh subsequently fails.
        scope.cached = undefined;
      } else if (scope.cached && scope.cached.validUntilMs > now()) {
        scope.stats.cacheHits += 1;
        return scope.cached.value;
      }

      if (scope.pending && (!forceRefresh || scope.pending.forced)) {
        scope.stats.pendingHits += 1;
        return (await scope.pending.promise).value;
      }

      const promise = load(forceRefresh);
      const pending = { promise, forced: forceRefresh };
      scope.pending = pending;
      scope.stats.loads += 1;
      if (forceRefresh) scope.stats.forcedLoads += 1;
      try {
        const lease = await promise;
        // An older in-flight read must not overwrite a token rotated by a 401.
        if (scope.pending === pending) scope.cached = lease;
        return lease.value;
      } finally {
        if (scope.pending === pending) scope.pending = undefined;
      }
    },
  };
}
