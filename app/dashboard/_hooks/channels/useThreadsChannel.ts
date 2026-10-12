"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { useTranslations } from "next-intl";
import { useDashboardViewerAccess } from "../../_components/DashboardViewerAccessProvider";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";

export type ThreadsConnection = {
  connected: boolean;
  requiresUpdate: boolean;
  connectionStatus: ConnectionDisplayStatus;
  username: string;
  profileUrl: string;
};
const EMPTY: ThreadsConnection = { connected: false, requiresUpdate: false, connectionStatus: "disconnected", username: "", profileUrl: "" };

export function useThreadsChannel({ initialState, panel, onConnectionChange }: {
  initialState?: Record<string, unknown> | null;
  panel: string | null;
  onConnectionChange?: (state: ThreadsConnection) => void;
}) {
  const { metaPilotEnabled, activeAccountId } = useDashboardViewerAccess();
  const requestSequenceRef = useRef(0);
  const lastAccountIdRef = useRef(activeAccountId);
  const t = useTranslations("shell");
  const [connection, setConnection] = useState<ThreadsConnection>(() => metaPilotEnabled ? {
    connected: initialState?.threadsConnected === true,
    requiresUpdate: initialState?.threadsRequiresUpdate === true,
    connectionStatus: initialState?.threadsConnectionStatus === "needs_update" ? "needs_update" : initialState?.threadsConnected === true ? "connected" : "disconnected",
    username: String(initialState?.threadsUsername || ""),
    profileUrl: String(initialState?.threadsUrl || ""),
  } : EMPTY);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    requestSequenceRef.current += 1;
    if (lastAccountIdRef.current !== activeAccountId || !metaPilotEnabled) {
      setConnection(EMPTY);
      setNotice(null);
      setError(null);
      setLoading(false);
      setBusy(false);
    }
    lastAccountIdRef.current = activeAccountId;
    return () => { requestSequenceRef.current += 1; };
  }, [activeAccountId, metaPilotEnabled]);

  const applyThreadsState = useCallback((state: ThreadsConnection) => {
    const next = metaPilotEnabled ? state : EMPTY;
    setConnection(next);
  }, [metaPilotEnabled]);
  const syncThreadsStateFromServer = useCallback(async () => {
    if (!metaPilotEnabled) return;
    const requestSequence = ++requestSequenceRef.current;
    const isCurrent = () => requestSequence === requestSequenceRef.current && (!getActiveBrowserUserId() || getActiveBrowserUserId() === activeAccountId);
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/threads/status", { cache: "no-store", credentials: "include" });
      const data = await response.json().catch(() => ({}));
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(t("threads_status_error"));
      const requiresUpdate = Boolean(data.requiresUpdate || data.expired || data.connection_status === "needs_update");
      const next: ThreadsConnection = {
        connected: Boolean(data.connected) && !requiresUpdate,
        requiresUpdate,
        connectionStatus: requiresUpdate ? "needs_update" : data.connected ? "connected" : "disconnected",
        username: String(data.username || "").replace(/^@/, ""),
        profileUrl: String(data.profile_url || ""),
      };
      applyThreadsState(next);
      onConnectionChange?.(next);
    } catch { if (isCurrent()) setError(t("threads_status_error")); }
    finally { if (isCurrent()) setLoading(false); }
  }, [activeAccountId, applyThreadsState, metaPilotEnabled, onConnectionChange, t]);
  useEffect(() => { if (panel === "threads" && metaPilotEnabled) void syncThreadsStateFromServer(); }, [metaPilotEnabled, panel, syncThreadsStateFromServer]);
  const connectThreads = useCallback(() => {
    if (!metaPilotEnabled) return;
    window.location.href = "/api/integrations/threads/start?returnTo=" + encodeURIComponent("/dashboard?panel=threads");
  }, [metaPilotEnabled]);
  const disconnectThreads = useCallback(async () => {
    if (!metaPilotEnabled || busy) return;
    const requestSequence = ++requestSequenceRef.current;
    const isCurrent = () => requestSequence === requestSequenceRef.current && (!getActiveBrowserUserId() || getActiveBrowserUserId() === activeAccountId);
    setBusy(true); setNotice(null); setError(null);
    try {
      const response = await fetch("/api/integrations/threads/disconnect", { method: "POST", credentials: "include" });
      if (!isCurrent()) return;
      if (!response.ok) throw new Error(t("threads_disconnect_error"));
      applyThreadsState(EMPTY); onConnectionChange?.(EMPTY); setNotice(t("threads_disconnected"));
    } catch { if (isCurrent()) setError(t("threads_disconnect_error")); }
    finally { if (isCurrent()) setBusy(false); }
  }, [activeAccountId, applyThreadsState, busy, metaPilotEnabled, onConnectionChange, t]);
  return { connection: metaPilotEnabled ? connection : EMPTY, applyThreadsState, loading, busy, notice, error, connectThreads, disconnectThreads, syncThreadsStateFromServer };
}
