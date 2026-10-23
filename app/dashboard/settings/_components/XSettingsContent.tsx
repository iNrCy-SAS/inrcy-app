"use client";

import type { ChannelBubbleRenderer } from "../../_components/channel-bubble.types";
import { readChannelWorkspaceSnapshot, writeChannelWorkspaceSnapshot } from "../../_components/channel-workspace-snapshot";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import EditableChannelUrlField from "../../_components/EditableChannelUrlField";
import guideStyles from "./ChannelSettingsSteps.module.css";

type XConnectionStatus = "connected" | "disconnected" | "needs_update";

type XSettingsState = {
  connected: boolean;
  requiresUpdate: boolean;
  connectionStatus: XConnectionStatus;
  username: string;
  displayName: string;
  profileUrl: string;
};

const EMPTY_STATE: XSettingsState = {
  connected: false,
  requiresUpdate: false,
  connectionStatus: "disconnected",
  username: "",
  displayName: "",
  profileUrl: "",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeStatus(value: unknown): XSettingsState {
  const source = asRecord(value);
  const requiresUpdate = Boolean(
    source.requiresUpdate ||
    source.expired ||
    source.connection_status === "needs_update" ||
    source.connectionStatus === "needs_update",
  );
  const connected = Boolean(source.connected ?? source.accountConnected) && !requiresUpdate;
  const rawUsername = String(source.username || "").trim().replace(/^@/, "");
  const profileUrl = String(source.profile_url || source.profileUrl || "").trim() ||
    (rawUsername ? `https://x.com/${encodeURIComponent(rawUsername)}` : "");

  return {
    connected,
    requiresUpdate,
    connectionStatus: requiresUpdate ? "needs_update" : connected ? "connected" : "disconnected",
    username: rawUsername,
    displayName: String(source.display_name || source.displayName || "").trim(),
    profileUrl,
  };
}

function emitDashboardUpdate(state: XSettingsState, refresh = false) {
  if (typeof window === "undefined") return;
  writeChannelWorkspaceSnapshot("x", state);
  window.dispatchEvent(new CustomEvent("inrcy:x-settings-updated", {
    detail: { ...state, refresh },
  }));
}

export default function XSettingsContent({
  onUnsavedChange, renderBubble,
}: {
  renderBubble: ChannelBubbleRenderer;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
}) {
  const mountedRef = useRef(true);
  const connectionRevisionRef = useRef(0);
  const disconnectInFlightRef = useRef(false);
  const [connection, setConnection] = useState<XSettingsState>(() => normalizeStatus(readChannelWorkspaceSnapshot("x", EMPTY_STATE)));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (disconnectInFlightRef.current) return;
    const revision = ++connectionRevisionRef.current;
    const accountId = getActiveBrowserUserId();
    const isCurrent = () => mountedRef.current && revision === connectionRevisionRef.current && accountId === getActiveBrowserUserId();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/x/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || "Impossible de charger la connexion X."));
      }
      const next = normalizeStatus(payload);
      if (!isCurrent()) return;
      setConnection(next);
      emitDashboardUpdate(next);
    } catch (caught) {
      if (isCurrent()) {
        setError(caught instanceof Error ? caught.message : "Impossible de charger la connexion X.");
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectionRevisionRef.current++;
    };
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("linked") !== "x") return;
    if (params.get("ok") === "1") {
      setNotice("Compte X connecté.");
      void loadStatus();
      return;
    }
    if (params.get("ok") === "0") {
      setError(params.get("message") || "La connexion X n'a pas pu être finalisée.");
    }
  }, [loadStatus]);

  const connectX = useCallback(() => {
    setNotice(null);
    setError(null);
    const returnTo = "/dashboard?panel=x";
    window.location.href = `/api/integrations/x/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  const disconnectX = useCallback(async () => {
    if (disconnectInFlightRef.current) return false;
    disconnectInFlightRef.current = true;
    // An older status response must not restore a connection after this mutation.
    connectionRevisionRef.current++;
    const accountId = getActiveBrowserUserId();
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/x/disconnect", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(String(payload?.error || "Impossible de déconnecter X."));
      }
      if (accountId !== getActiveBrowserUserId()) return;
      emitDashboardUpdate(EMPTY_STATE, true);
      if (!mountedRef.current) return;
      setConnection(EMPTY_STATE);
      setNotice("Compte X déconnecté.");
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "Impossible de déconnecter X.");
      }
    } finally {
      disconnectInFlightRef.current = false;
      if (mountedRef.current) { setBusy(false); setLoading(false); }
    }
  }, []);

  const accountLabel = useMemo(() => {
    const handle = connection.username ? `@${connection.username}` : "";
    if (connection.displayName && handle) return `${connection.displayName} · ${handle}`;
    return connection.displayName || handle || "Compte X connecté";
  }, [connection.displayName, connection.username]);

  const publicLinks = connection.connected ? (
    <EditableChannelUrlField
      editorOnly
      id="x-profile-url"
      channel="x"
      value={connection.profileUrl}
      onSaved={(url) => {
        const next = { ...connection, profileUrl: url };
        setConnection(next);
        emitDashboardUpdate(next, true);
        setNotice("Lien public X enregistré.");
        setError(null);
      }}
      onDirtyChange={onUnsavedChange}
      ariaLabel="Lien public du profil X"
      placeholder="https://x.com/moncompte"
      viewLabel="Voir le profil"
      disabled={loading || busy}
      inputClassName={guideStyles.control}
      inputStyle={{
        width: "100%",
        minWidth: 0,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(15,23,42,0.65)",
        colorScheme: "dark",
        padding: "10px 12px",
        color: "white",
        outline: "none",
      }}
    />
  ) : undefined;

  return renderBubble({
    accountConnected: connection.connected || connection.requiresUpdate,
    resourceLabel: connection.connected || connection.requiresUpdate ? accountLabel : "",
    onConnect: connectX,
    onDisconnect: disconnectX,
    loading,
    busy,
    error,
    notice,
    publicLinks,
  });
}
