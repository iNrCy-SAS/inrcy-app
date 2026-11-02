import { createClient } from "@/lib/supabaseClient";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import { inferChannelsFromRealtimePayload } from "./dashboard.shared";

/** Owns one account-scoped Realtime subscription and its visibility lifecycle. */
export function startDashboardChannelRealtime({
  readLastRefreshAt, refreshChannels, refreshFallback, onAccountChange, refreshSiteSettings, clearScheduledRefreshes,
}: {
  readLastRefreshAt: () => number;
  refreshChannels: (channels: DashboardChannelKey[]) => unknown;
  refreshFallback: () => unknown;
  onAccountChange: () => void;
  refreshSiteSettings: () => unknown;
  clearScheduledRefreshes: () => void;
}) {
  const supabase = createClient();
  let disposed = false;
  let t: number | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let authUserId: string | null = null;
  let subscribedUserId: string | null = null;
  let refreshAfterVisibilityRestore = false;

  const isSafeUserId = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

  const resolveScopedUserId = (candidate?: unknown) => {
    if (isSafeUserId(candidate)) return candidate;
    if (!isSafeUserId(authUserId)) return null;
    const resolved = resolveActiveBrowserUserId(authUserId);
    return isSafeUserId(resolved) ? resolved : authUserId;
  };

  const removeRealtimeChannel = () => {
    const current = channel;
    channel = null;
    subscribedUserId = null;
    if (!current) return;
    try {
      void Promise.resolve(supabase.removeChannel(current)).catch(() => {});
    } catch {}
  };

  const scheduleRefresh = (payload?: any) => {
    if (disposed) return;
    if (document.visibilityState === "hidden") {
      refreshAfterVisibilityRestore = true;
      return;
    }
    if (Date.now() - readLastRefreshAt() < 2500) return;
    if (t) window.clearTimeout(t);

    const impactedChannels = inferChannelsFromRealtimePayload(payload);

    t = window.setTimeout(() => {
      if (disposed) return;
      if (Date.now() - readLastRefreshAt() < 2500) return;
      if (impactedChannels.length) {
        void refreshChannels(impactedChannels);
        return;
      }

      void refreshFallback();
    }, 500);
  };

  const subscribeForUser = (userId: string | null) => {
    if (
      disposed ||
      document.visibilityState === "hidden" ||
      !isSafeUserId(userId) ||
      subscribedUserId === userId
    ) {
      return;
    }

    removeRealtimeChannel();
    subscribedUserId = userId;
    const userFilter = `user_id=eq.${userId}`;
    channel = supabase
      .channel(`inrcy-generator-sync:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "integrations", filter: userFilter },
        (payload: any) => scheduleRefresh(payload),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pro_tools_configs", filter: userFilter },
        (payload: any) => scheduleRefresh(payload),
      )
      .subscribe();
  };

  const handleVisibility = () => {
    if (document.visibilityState === "hidden") {
      refreshAfterVisibilityRestore = true;
      if (t) {
        window.clearTimeout(t);
        t = null;
      }
      removeRealtimeChannel();
      return;
    }

    subscribeForUser(resolveScopedUserId());
    if (refreshAfterVisibilityRestore) {
      refreshAfterVisibilityRestore = false;
      void refreshFallback();
    }
  };

  const handleActiveAccountChange = (event: Event) => {
    const nextUserId = (event as CustomEvent<{ activeUserId?: unknown }>).detail?.activeUserId;
    const scopedUserId = resolveScopedUserId(nextUserId);
    if (!scopedUserId) return;
    onAccountChange();
    refreshAfterVisibilityRestore = true;
    subscribeForUser(scopedUserId);
    void refreshSiteSettings();
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange as EventListener);

  void supabase.auth.getUser().then(({ data }) => {
    if (disposed) return;
    authUserId = data.user?.id ?? null;
    subscribeForUser(resolveScopedUserId());
  });

  return () => {
    disposed = true;
    if (t) window.clearTimeout(t);
    clearScheduledRefreshes();
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange as EventListener);
    removeRealtimeChannel();
  };
}
