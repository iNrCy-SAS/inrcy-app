"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import ConnectionPill from "../../_components/ConnectionPill";
import StatusMessage from "../../_components/StatusMessage";
import styles from "../../dashboard.module.css";

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

const cardStyle = {
  border: "1px solid rgba(139, 220, 255, 0.18)",
  background: "linear-gradient(135deg, rgba(8, 22, 45, 0.88), rgba(23, 18, 51, 0.72))",
  borderRadius: 16,
  padding: 16,
  display: "grid",
  gap: 13,
} as const;

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
      setConnection(next);
      emitDashboardUpdate(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de charger la connexion X.");
    } finally {
      setLoading(false);
    }
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
      setConnection(EMPTY_STATE);
      emitDashboardUpdate(EMPTY_STATE);
      setNotice("Compte X déconnecté.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible de déconnecter X.");
    } finally {
      setBusy(false);
    }
  }, []);

  const accountLabel = useMemo(() => {
    const handle = connection.username ? `@${connection.username}` : "";
    if (connection.displayName && handle) return `${connection.displayName} · ${handle}`;
    return connection.displayName || handle || "Compte X connecté";
  }, [connection.displayName, connection.username]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div>
            <div className={styles.blockTitle}>Compte X</div>
            <div className={styles.blockSub}>Connexion officielle sécurisée pour publier au nom du professionnel.</div>
          </div>
          <ConnectionPill
            connected={connection.connected}
            status={connection.connectionStatus}
            label={loading ? "Vérification…" : undefined}
          />
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            minWidth: 0,
            padding: "12px 14px",
            borderRadius: 13,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(2, 6, 23, 0.5)",
          }}
        >
          <img src="/icons/x.svg" width={42} height={42} alt="X" style={{ borderRadius: "50%", flex: "0 0 auto" }} />
          <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
            <strong style={{ color: "white", overflowWrap: "anywhere" }}>
              {connection.connected ? accountLabel : "Aucun compte connecté"}
            </strong>
            <span style={{ color: "rgba(255,255,255,0.58)", fontSize: 12 }}>
              {connection.requiresUpdate
                ? "L'autorisation doit être renouvelée avant toute publication."
                : connection.connected
                  ? "Profil autorisé par X et prêt à être utilisé dans iNrCy."
                  : "Activez d'abord X dans Bubble Access, puis autorisez le compte ici."}
            </span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
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
                Renouveler l'autorisation
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
      </section>

      {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
      {notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
    </div>
  );
}
