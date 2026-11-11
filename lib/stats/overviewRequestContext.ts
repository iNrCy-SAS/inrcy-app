import type { SupabaseClient } from "@supabase/supabase-js";

type OverviewContextKey = "metaPilot" | "integrations" | "proTools" | "businessProfile" | "channelStates:0" | "channelStates:1";
export type StatsOverviewRequestContext = {
  read<T>(client: SupabaseClient, accountId: string, key: OverviewContextKey, load: () => Promise<T>): Promise<T>;
};

/** One refresh, one account, one authenticated client; never a process-wide cache. */
export function createStatsOverviewRequestContext({ supabase, userId }: { supabase: SupabaseClient; userId: string }): StatsOverviewRequestContext {
  const pending = new Map<OverviewContextKey, Promise<unknown>>();
  return {
    read<T>(client: SupabaseClient, accountId: string, key: OverviewContextKey, load: () => Promise<T>) {
      if (client !== supabase || accountId !== userId) {
        throw new Error("Le contexte des statistiques appartient à une autre requête ou un autre compte.");
      }
      if (!pending.has(key)) pending.set(key, Promise.resolve().then(load));
      return pending.get(key) as Promise<T>;
    },
  };
}
