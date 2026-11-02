"use client";

import { useCallback, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  PROFILE_VERSION_EVENT,
  PROFILE_VERSION_FIELDS,
  getChangedProfileVersionFields,
  toProfileVersionsSnapshot,
  type ProfileVersionChangeDetail,
  type ProfileVersionsSnapshot,
} from "@/lib/profileVersioning";

const PROFILE_VERSION_FOCUS_THROTTLE_MS = 10_000;
const PROFILE_VERSION_POLL_MS = 60_000;
const PROFILE_VERSION_EVENT_COALESCE_MS = 750;

export default function ProfileRealtimeBridge() {
  const versionsRef = useRef<ProfileVersionsSnapshot | null>(null);
  const lastServerCheckAtRef = useRef(0);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);
  const pendingChangesRef = useRef(
    new Map<ProfileVersionChangeDetail["field"], ProfileVersionChangeDetail>(),
  );
  const dispatchTimerRef = useRef<number | null>(null);

  const flushPendingChanges = useCallback(() => {
    dispatchTimerRef.current = null;
    const changes = Array.from(pendingChangesRef.current.values());
    pendingChangesRef.current.clear();

    for (const change of changes) {
      window.dispatchEvent(
        new CustomEvent(PROFILE_VERSION_EVENT, { detail: change }),
      );
    }
  }, []);

  const dispatchChanges = useCallback((nextRaw: unknown) => {
    const incoming = toProfileVersionsSnapshot(nextRaw);
    const previous = versionsRef.current;
    const next = previous
      ? Object.fromEntries(
          PROFILE_VERSION_FIELDS.map((field) => [
            field,
            Math.max(previous[field], incoming[field]),
          ]),
        ) as ProfileVersionsSnapshot
      : incoming;
    versionsRef.current = next;
    if (!previous) return;

    const changes = getChangedProfileVersionFields(previous, next);
    for (const change of changes) {
      const pending = pendingChangesRef.current.get(change.field);
      pendingChangesRef.current.set(
        change.field,
        pending
          ? { ...change, previousValue: pending.previousValue }
          : change,
      );
    }

    if (changes.length > 0 && dispatchTimerRef.current == null) {
      dispatchTimerRef.current = window.setTimeout(
        flushPendingChanges,
        PROFILE_VERSION_EVENT_COALESCE_MS,
      );
    }
  }, [flushPendingChanges]);

  useEffect(() => {
    const supabase = createClient();
    const pendingChanges = pendingChangesRef.current;
    let cancelled = false;
    let userId: string | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let channelHealthy = false;
    let pollId: number | null = null;
    let activationSequence = 0;

    const loadVersions = async () => {
      let response: Response;
      try {
        response = await fetch("/api/profile/versions", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
      } catch {
        return null;
      }

      if (response.status === 401) {
        window.dispatchEvent(new CustomEvent("inrcy:auth-session-invalid"));
        return null;
      }
      if (!response.ok) return null;

      const payload = (await response.json().catch(() => null)) as {
        user_id?: string;
        versions?: unknown;
      } | null;
      const nextUserId = String(payload?.user_id || "").trim();
      return nextUserId
        ? { userId: nextUserId, versions: payload?.versions || {} }
        : null;
    };

    const refreshVersionsFromServer = async (force = false) => {
      if (!userId || cancelled) return;
      const now = Date.now();
      if (!force && now - lastServerCheckAtRef.current < PROFILE_VERSION_FOCUS_THROTTLE_MS) return;
      if (refreshPromiseRef.current) {
        await refreshPromiseRef.current;
        return;
      }

      const job: Promise<void> = (async () => {
        lastServerCheckAtRef.current = now;
        const snapshot = await loadVersions();

        if (!cancelled && snapshot?.userId === userId) {
          dispatchChanges(snapshot.versions);
        }
      })().catch(() => {});

      refreshPromiseRef.current = job;
      try {
        await job;
      } finally {
        refreshPromiseRef.current = null;
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === "hidden") return;
      void refreshVersionsFromServer(false);
    };

    const stopPolling = () => {
      if (pollId == null) return;
      window.clearInterval(pollId);
      pollId = null;
    };

    const ensureRecoveryPolling = () => {
      if (pollId != null || document.visibilityState === "hidden") return;
      pollId = window.setInterval(() => {
        if (document.visibilityState === "hidden" || channelHealthy) return;
        if (!userId) {
          void activate(false).catch(() => {});
          return;
        }
        void refreshVersionsFromServer(false);
      }, PROFILE_VERSION_POLL_MS);
    };

    const stopRealtime = () => {
      const current = channel;
      channel = null;
      channelHealthy = false;
      if (!current) return;
      try {
        void Promise.resolve(supabase.removeChannel(current)).catch(() => {});
      } catch {}
    };

    const subscribeToProfile = () => {
      if (!userId || cancelled || document.visibilityState === "hidden" || channel) return;

      const nextChannel = supabase
        .channel(`inrcy-profile-versions:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "profiles",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            dispatchChanges(payload.new ?? payload.old ?? null);
          },
        );
      channel = nextChannel;
      nextChannel.subscribe((status) => {
        if (cancelled || channel !== nextChannel) return;
        channelHealthy = status === "SUBSCRIBED";
        if (channelHealthy) {
          stopPolling();
        } else {
          ensureRecoveryPolling();
        }
      });
    };

    const activate = async (forceRefresh: boolean) => {
      if (cancelled || document.visibilityState === "hidden") return;
      const sequence = ++activationSequence;
      ensureRecoveryPolling();

      if (!userId) {
        const snapshot = await loadVersions();
        if (!snapshot || cancelled || sequence !== activationSequence) return;
        userId = snapshot.userId;
        versionsRef.current = toProfileVersionsSnapshot(snapshot.versions);
      }

      subscribeToProfile();
      if (forceRefresh) {
        await refreshVersionsFromServer(true);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        activationSequence += 1;
        stopPolling();
        stopRealtime();
        return;
      }

      // Subscribe first, then reconcile the counters to cover every change
      // committed while the tab was hidden.
      void activate(true).catch(() => {});
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    if (document.visibilityState !== "hidden") {
      void activate(false).catch(() => {});
    }

    return () => {
      cancelled = true;
      activationSequence += 1;
      stopPolling();
      stopRealtime();
      if (dispatchTimerRef.current != null) {
        window.clearTimeout(dispatchTimerRef.current);
        dispatchTimerRef.current = null;
      }
      pendingChanges.clear();
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [dispatchChanges]);

  return null;
}
