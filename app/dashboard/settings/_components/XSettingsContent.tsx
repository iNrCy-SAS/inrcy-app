"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ConnectionPill from "../../_components/ConnectionPill";
import StatusMessage from "../../_components/StatusMessage";
import styles from "../../dashboard.module.css";
import ChannelSettingsStep from "./ChannelSettingsStep";
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

function emitDashboardUpdate(state: XSettingsState) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("inrcy:x-settings-updated", {
    detail: state,
  }));
}

export default function XSettingsContent() {
  const mountedRef = useRef(true);
  const [connection, setConnection] = useState<XSettingsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/x/status", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(String(payload?.error || "Impossible de charger la connexion X."));
      }
      const next = normalizeStatus(payload);
      if (!mountedRef.current) return;
      setConnection(next);
      emitDashboardUpdate(next);
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "Impossible de charger la connexion X.");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch("/api/integrations/x/disconnect", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        throw new Error(String(payload?.error || "Impossible de déconnecter X."));
      }
      if (!mountedRef.current) return;
      setConnection(EMPTY_STATE);
      emitDashboardUpdate(EMPTY_STATE);
      setNotice("Compte X déconnecté.");
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "Impossible de déconnecter X.");
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, []);

  const accountLabel = useMemo(() => {
    const handle = connection.username ? `@${connection.username}` : "";
    if (connection.displayName && handle) return `${connection.displayName} · ${handle}`;
    return connection.displayName || handle || "Compte X connecté";
  }, [connection.displayName, connection.username]);

  return (
    <div className={guideStyles.steps}>
      <ChannelSettingsStep
        step={1}
        accent="x"
        title="Connecter le compte X"
        description="Autorisez iNrCy à publier avec le compte professionnel, via la connexion officielle et sécurisée de X."
        status={
          <ConnectionPill
            connected={connection.connected}
            status={connection.connectionStatus}
            label={loading ? "Vérification…" : undefined}
          />
        }
      >
        <div className={guideStyles.compactActionLine}>
          <div className={guideStyles.accountSurface}>
            <Image
              className={guideStyles.channelIcon}
              src="/icons/x.svg"
              width={46}
              height={46}
              alt=""
              aria-hidden="true"
            />
            <div className={guideStyles.accountCopy}>
              <strong>
                {connection.connected ? accountLabel : "Aucun compte connecté"}
              </strong>
              <span>
                {connection.requiresUpdate
                  ? "Autorisation à renouveler"
                  : connection.connected
                    ? "Compte prêt à publier"
                    : "Autorisez le compte professionnel"}
              </span>
            </div>
          </div>

          <div className={guideStyles.actionRow}>
            {!connection.connected || connection.requiresUpdate ? (
              <button
                type="button"
                className={`${styles.actionBtn} ${styles.connectBtn}`}
                onClick={connectX}
                disabled={loading || busy}
              >
                {connection.requiresUpdate ? "Reconnecter X" : "Connecter X"}
              </button>
            ) : (
              <>
                {connection.profileUrl ? (
                  <a
                    href={connection.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`${styles.actionBtn} ${styles.viewBtn}`}
                  >
                    Voir le profil
                  </a>
                ) : null}
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.secondaryBtn}`}
                  onClick={connectX}
                  disabled={busy}
                >
                  Renouveler
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.disconnectBtn}`}
                  onClick={() => void disconnectX()}
                  disabled={busy}
                >
                  {busy ? "Déconnexion…" : "Déconnecter"}
                </button>
              </>
            )}
          </div>
        </div>
      </ChannelSettingsStep>

      {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
      {notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
    </div>
  );
}
