import type { SupabaseClient } from "@supabase/supabase-js";

type OverviewCacheKey = { prefix: string; connectionSignature: string; suffix: string };
type CacheRow = { payload: unknown; expires_at: string };
type ReadOne = () => Promise<CacheRow | null>;
export type OverviewCacheReader = (client: SupabaseClient, accountId: string, key: OverviewCacheKey, readOne: ReadOne) => Promise<CacheRow | null>;

type PendingRead = {
  prefix: string;
  rangeKey: string;
  readOne: ReadOne;
  promise: Promise<CacheRow | null>;
  resolve: (row: CacheRow | null | PromiseLike<CacheRow | null>) => void;
};
type PendingGroup = { connectionSignature: string; suffix: string; reads: Map<string, PendingRead> };

function escapeRegexp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createOverviewCacheBatch({ supabase, userId, source }: { supabase: SupabaseClient; userId: string; source: string }): OverviewCacheReader {
  const pending = new Map<string, PendingGroup>();

  async function flush({ connectionSignature, suffix, reads }: PendingGroup) {
    const entries = [...reads.values()];
    const [first, ...others] = entries;
    if (entries.length === 1) {
      first.resolve(Promise.resolve().then(first.readOne));
      return;
    }

    // Preserve the indexable common prefix and include the long connection signature only once.
    let commonPrefix = first.prefix;
    for (const { prefix } of others) {
      while (!prefix.startsWith(commonPrefix)) commonPrefix = commonPrefix.slice(0, -1);
    }
    const variants = entries.map(({ prefix }) => escapeRegexp(prefix.slice(commonPrefix.length))).join("|");
    const pattern = `^${escapeRegexp(commonPrefix)}(${variants})${escapeRegexp(connectionSignature)}${escapeRegexp(suffix)}$`;
    const requested = new Set(entries.map(({ rangeKey }) => rangeKey));
    const hits = new Map<string, CacheRow>();
    let incomplete = true;
    try {
      const { data, error, count } = await supabase
        .from("stats_cache")
        .select("range_key, payload, expires_at", { count: "exact" })
        .eq("user_id", userId)
        .eq("source", source)
        .filter("range_key", "match", pattern)
        .gt("expires_at", new Date().toISOString())
        .order("expires_at", { ascending: false })
        .limit(entries.length);
      if (!error && data) {
        incomplete = count !== data.length;
        for (const row of data) {
          if (requested.has(row.range_key) && !hits.has(row.range_key)) hits.set(row.range_key, row);
        }
      }
    } catch {
      // The ordinary exact-key read still works if the batch request fails.
    }

    for (const entry of entries) {
      entry.resolve(hits.get(entry.rangeKey) ?? (incomplete ? Promise.resolve().then(entry.readOne) : null));
    }
  }

  return (client, accountId, { prefix, connectionSignature, suffix }, readOne) => {
    if (client !== supabase || accountId !== userId) {
      throw new Error("Le contexte des statistiques appartient à une autre requête ou un autre compte.");
    }
    const groupKey = JSON.stringify([connectionSignature, suffix]);
    let group = pending.get(groupKey);
    if (!group) {
      const newGroup = { connectionSignature, suffix, reads: new Map<string, PendingRead>() };
      group = newGroup;
      pending.set(groupKey, newGroup);
      setImmediate(() => {
        pending.delete(groupKey);
        void flush(newGroup);
      });
    }
    const queued = group.reads.get(prefix);
    if (queued) return queued.promise;
    let resolve!: PendingRead["resolve"];
    const promise = new Promise<CacheRow | null>((settle) => { resolve = settle; });
    group.reads.set(prefix, { prefix, rangeKey: `${prefix}${connectionSignature}${suffix}`, readOne, promise, resolve });
    return promise;
  };
}
