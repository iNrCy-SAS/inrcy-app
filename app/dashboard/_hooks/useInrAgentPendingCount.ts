"use client";

import { useSyncExternalStore } from "react";

import {
  getActiveBrowserUserId,
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";

export const INR_AGENT_PENDING_COUNT_CACHE_KEY =
  "inrcy_inr_agent_pending_count_v1";

const INR_AGENT_PENDING_COUNT_POLL_MS = 60_000;
const listeners = new Set<() => void>();

let currentAccountId: string | null = null;
let currentCount = 0;
const requestPromisesByAccount = new Map<string, Promise<void>>();
let intervalId: number | null = null;
let controllerStarted = false;

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
}

export function readCachedPendingInrAgentCount(accountId = getActiveBrowserUserId()) {
  if (!accountId) return 0;
  try {
    return safeCount(
      readAccountCacheValue(INR_AGENT_PENDING_COUNT_CACHE_KEY, accountId),
    );
  } catch {
    return 0;
  }
}

function writeCachedPendingInrAgentCount(count: number, accountId: string) {
  try {
    writeAccountCacheValue(
      INR_AGENT_PENDING_COUNT_CACHE_KEY,
      String(safeCount(count)),
      accountId,
    );
  } catch {
    // Le cache visuel du badge ne doit jamais bloquer le dashboard.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function synchronizeAccountScope(notify = true) {
  const nextAccountId = getActiveBrowserUserId();
  if (nextAccountId === currentAccountId) return false;
  currentAccountId = nextAccountId;
  currentCount = readCachedPendingInrAgentCount(nextAccountId);
  if (notify) emit();
  return true;
}

export function refreshInrAgentPendingCount() {
  if (typeof document === "undefined" || document.hidden) {
    return Promise.resolve();
  }

  synchronizeAccountScope(false);
  const requestAccountId = currentAccountId;
  if (!requestAccountId) return Promise.resolve();
  const existingRequest = requestPromisesByAccount.get(requestAccountId);
  if (existingRequest) return existingRequest;

  const job = (async () => {
    try {
      const response = await fetch("/api/agent/actions/pending-count", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return;
      const payload = (await response.json().catch(() => null)) as {
        count?: unknown;
      } | null;
      if (requestAccountId !== getActiveBrowserUserId()) return;

      const nextCount = safeCount(payload?.count);
      writeCachedPendingInrAgentCount(nextCount, requestAccountId);
      if (nextCount === currentCount) return;
      currentCount = nextCount;
      emit();
    } catch {
      // Le dernier compteur confirmé reste affiché si le réseau est indisponible.
    }
  })();

  requestPromisesByAccount.set(requestAccountId, job);
  void job.finally(() => {
    if (requestPromisesByAccount.get(requestAccountId) === job) {
      requestPromisesByAccount.delete(requestAccountId);
    }
  });
  return job;
}

function stopPolling() {
  if (intervalId == null) return;
  window.clearInterval(intervalId);
  intervalId = null;
}

function startPolling() {
  if (intervalId != null || document.hidden || listeners.size === 0) return;
  intervalId = window.setInterval(() => {
    void refreshInrAgentPendingCount();
  }, INR_AGENT_PENDING_COUNT_POLL_MS);
}

function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
    return;
  }
  synchronizeAccountScope();
  void refreshInrAgentPendingCount();
  startPolling();
}

function handleFocus() {
  if (document.hidden) return;
  void refreshInrAgentPendingCount();
}

function handleAgentActionsChanged() {
  if (document.hidden) return;
  void refreshInrAgentPendingCount();
}

function handleActiveAccountChange() {
  synchronizeAccountScope();
  if (!document.hidden) void refreshInrAgentPendingCount();
}

function startController() {
  if (controllerStarted) return;
  controllerStarted = true;
  synchronizeAccountScope(false);
  window.addEventListener("focus", handleFocus);
  window.addEventListener("inrcy:agent-actions-changed", handleAgentActionsChanged);
  window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (!document.hidden) {
    void refreshInrAgentPendingCount();
    startPolling();
  }
}

function stopController() {
  if (!controllerStarted) return;
  controllerStarted = false;
  stopPolling();
  window.removeEventListener("focus", handleFocus);
  window.removeEventListener("inrcy:agent-actions-changed", handleAgentActionsChanged);
  window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, handleActiveAccountChange);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) startController();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopController();
  };
}

function getSnapshot() {
  synchronizeAccountScope(false);
  return currentCount;
}

function getServerSnapshot() {
  return 0;
}

function subscribeDisabled() {
  return () => {};
}

export function useInrAgentPendingCount(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribe : subscribeDisabled,
    enabled ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
}
