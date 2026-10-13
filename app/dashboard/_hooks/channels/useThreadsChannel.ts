"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { useTranslations } from "next-intl";
import { useDashboardViewerAccess } from "../../_components/DashboardViewerAccessProvider";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import { CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES, normalizeThreadsPublicationPreferences, type ThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";

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
  const preferencesSequenceRef = useRef(0);
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
  const [publicationPreferences, setPublicationPreferences] = useState<ThreadsPublicationPreferences>(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
  const [preferencesRequestLoading, setPreferencesLoading] = useState(true);
  const [preferencesAccountId, setPreferencesAccountId] = useState<string | null | undefined>(undefined);
  const preferencesLoading = preferencesRequestLoading || preferencesAccountId !== activeAccountId;
  const [preferencesSaving, setPreferencesSaving] = useState(false);
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  useEffect(() => {
    preferencesSequenceRef.current += 1;
    setPublicationPreferences(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
    setPreferencesLoading(true);
    setPreferencesSaving(false);
    setPreferencesNotice(null);
    setPreferencesError(null);
    return () => { preferencesSequenceRef.current += 1; };
  }, [activeAccountId, metaPilotEnabled]);

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
  const loadPublicationPreferences = useCallback(async () => {
    if (!metaPilotEnabled) return;
    const sequence = ++preferencesSequenceRef.current;
    const isCurrent = () => sequence === preferencesSequenceRef.current && (!getActiveBrowserUserId() || getActiveBrowserUserId() === activeAccountId);
    setPreferencesLoading(true); setPreferencesError(null);
    try {
      const response = await fetch("/api/integrations/threads/publication-preferences", { cache: "no-store", credentials: "include" });
      const data = await response.json().catch(() => null);
      if (!isCurrent()) return;
      if (response.status === 409 && data?.code === "threads_connection_required") {
        setPublicationPreferences(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
        setPreferencesAccountId(activeAccountId);
        setPreferencesError(t("threads_publication_modes_connection_required"));
        return;
      }
      if (!response.ok || !data?.preferences) throw new Error("preferences_unavailable");
      setPublicationPreferences(normalizeThreadsPublicationPreferences(data.preferences));
      setPreferencesAccountId(activeAccountId);
    } catch {
      if (isCurrent()) { setPublicationPreferences(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES); setPreferencesAccountId(activeAccountId); setPreferencesError(t("threads_publication_modes_load_error")); }
    } finally { if (isCurrent()) setPreferencesLoading(false); }
  }, [activeAccountId, metaPilotEnabled, t]);
  useEffect(() => { if (panel === "threads" && metaPilotEnabled) void loadPublicationPreferences(); }, [loadPublicationPreferences, metaPilotEnabled, panel]);
  const updatePublicationPreferences = useCallback((patch: Partial<ThreadsPublicationPreferences>) => {
    if (!metaPilotEnabled) return;
    setPublicationPreferences(current => normalizeThreadsPublicationPreferences({ ...current, ...patch }));
    setPreferencesNotice(null); setPreferencesError(null);
  }, [metaPilotEnabled]);
  const savePublicationPreferences = useCallback(async () => {
    if (!metaPilotEnabled || preferencesLoading || preferencesSaving || preferencesError) return false;
    const sequence = ++preferencesSequenceRef.current;
    const isCurrent = () => sequence === preferencesSequenceRef.current && (!getActiveBrowserUserId() || getActiveBrowserUserId() === activeAccountId);
    setPreferencesSaving(true); setPreferencesNotice(null); setPreferencesError(null);
    try {
      const response = await fetch("/api/integrations/threads/publication-preferences", { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(publicationPreferences) });
      const data = await response.json().catch(() => null);
      if (!isCurrent()) return false;
      if (!response.ok || !data?.preferences) throw new Error("preferences_save_failed");
      setPublicationPreferences(normalizeThreadsPublicationPreferences(data.preferences));
      setPreferencesNotice(t("threads_publication_modes_saved"));
      return true;
    } catch { if (isCurrent()) setPreferencesError(t("threads_publication_modes_save_error")); return false; }
    finally { if (isCurrent()) setPreferencesSaving(false); }
  }, [activeAccountId, metaPilotEnabled, preferencesError, preferencesLoading, preferencesSaving, publicationPreferences, t]);
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
  return { publicationPreferences: metaPilotEnabled && preferencesAccountId === activeAccountId ? publicationPreferences : CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES, preferencesLoading, preferencesSaving, preferencesNotice, preferencesError, updatePublicationPreferences, savePublicationPreferences, loadPublicationPreferences, connection: metaPilotEnabled ? connection : EMPTY, applyThreadsState, loading, busy, notice, error, connectThreads, disconnectThreads, syncThreadsStateFromServer };
}
