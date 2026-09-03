"use client";

import { useTranslations } from "next-intl";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "../../dashboard.module.css";
import { createClient } from "@/lib/supabaseClient";
import ConnectionPill from "../../_components/ConnectionPill";
import StatusMessage from "../../_components/StatusMessage";

const cardStyle = {
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.03)",
  borderRadius: 14,
  padding: 12,
  display: "grid",
  gap: 10,
} as const;

const inputStyle = {
  width: "100%",
  minWidth: 0,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(15,23,42,0.65)",
  colorScheme: "dark" as const,
  padding: "10px 12px",
  color: "white",
  outline: "none",
} as const;

const selectStyle = {
  ...inputStyle,
  background: "rgba(15,23,42,0.95)",
} as const;

const switchRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 10,
  alignItems: "stretch",
} as const;

function PreferenceToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(15,23,42,0.45)",
        borderRadius: 12,
        padding: "10px 12px",
        color: "rgba(255,255,255,0.92)",
        fontSize: 14,
      }}
    >
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

type YoutubeShortsSettings = {
  connected: boolean;
  accountConnected: boolean;
  requiresUpdate: boolean;
  connectionStatus: "connected" | "disconnected" | "needs_update";
  channelUrl: string;
  channelHandle: string;
  channelName: string;
  channelId: string;
  accountEmail: string;
  accountName: string;
  avatarUrl: string;
  scopes: string;
  expiresAt: string | null;
  defaultVisibility: "public" | "unlisted" | "private";
  preferredFormat: "shorts" | "video";
  madeForKids: boolean;
  autoHashtags: boolean;
  stats: {
    subscriberCount: number | null;
    videoCount: number | null;
    viewCount: number | null;
  };
};

const DEFAULT_SETTINGS: YoutubeShortsSettings = {
  connected: false,
  accountConnected: false,
  requiresUpdate: false,
  connectionStatus: "disconnected",
  channelUrl: "",
  channelHandle: "",
  channelName: "",
  channelId: "",
  accountEmail: "",
  accountName: "",
  avatarUrl: "",
  scopes: "",
  expiresAt: null,
  defaultVisibility: "public",
  preferredFormat: "shorts",
  madeForKids: false,
  autoHashtags: true,
  stats: {
    subscriberCount: null,
    videoCount: null,
    viewCount: null,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeSettings(value: unknown): YoutubeShortsSettings {
  const source = asRecord(value);
  const defaults = asRecord(source.defaults);
  const stats = asRecord(source.stats);
  const defaultVisibility = ["public", "unlisted", "private"].includes(String(source.defaultVisibility || defaults.defaultVisibility))
    ? String(source.defaultVisibility || defaults.defaultVisibility) as YoutubeShortsSettings["defaultVisibility"]
    : DEFAULT_SETTINGS.defaultVisibility;
  const preferredFormat = ["shorts", "video"].includes(String(source.preferredFormat || defaults.preferredFormat))
    ? String(source.preferredFormat || defaults.preferredFormat) as YoutubeShortsSettings["preferredFormat"]
    : DEFAULT_SETTINGS.preferredFormat;

  return {
    ...DEFAULT_SETTINGS,
    connected: Boolean(source.connected),
    accountConnected: Boolean(source.accountConnected ?? source.connected),
    requiresUpdate: Boolean(source.requiresUpdate || source.connectionStatus === "needs_update"),
    connectionStatus: source.connectionStatus === "needs_update"
      ? "needs_update"
      : source.connected ? "connected" : "disconnected",
    channelUrl: String(source.channelUrl || source.url || ""),
    channelHandle: String(source.channelHandle || source.handle || ""),
    channelName: String(source.channelName || source.name || ""),
    channelId: String(source.channelId || ""),
    accountEmail: String(source.accountEmail || ""),
    accountName: String(source.accountName || ""),
    avatarUrl: String(source.avatarUrl || ""),
    scopes: String(source.scopes || ""),
    expiresAt: typeof source.expiresAt === "string" ? source.expiresAt : null,
    defaultVisibility,
    preferredFormat,
    madeForKids: Boolean(source.madeForKids ?? defaults.madeForKids),
    autoHashtags: (source.autoHashtags ?? defaults.autoHashtags) !== false,
    stats: {
      subscriberCount: safeNum(stats.subscriberCount),
      videoCount: safeNum(stats.videoCount),
      viewCount: safeNum(stats.viewCount),
    },
  };
}

function serializeSettings(settings: YoutubeShortsSettings) {
  return {
    connected: settings.connected,
    accountConnected: settings.accountConnected,
    channelUrl: settings.channelUrl,
    channelHandle: settings.channelHandle,
    channelName: settings.channelName,
    channelId: settings.channelId,
    accountEmail: settings.accountEmail,
    accountName: settings.accountName,
    avatarUrl: settings.avatarUrl,
    scopes: settings.scopes,
    expiresAt: settings.expiresAt,
    stats: settings.stats,
    defaults: {
      defaultVisibility: settings.defaultVisibility,
      preferredFormat: settings.preferredFormat,
      madeForKids: settings.madeForKids,
      autoHashtags: settings.autoHashtags,
    },
  };
}

function emitDashboardUpdate(settings: YoutubeShortsSettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("inrcy:youtube-shorts-settings-updated", {
    detail: {
      connected: settings.connected,
      requiresUpdate: settings.requiresUpdate,
      connectionStatus: settings.connectionStatus,
      channelUrl: settings.connected ? settings.channelUrl : "",
      channelHandle: settings.connected ? settings.channelHandle : "",
      channelName: settings.connected ? settings.channelName : "",
      channelId: settings.connected ? settings.channelId : "",
    },
  }));
}

export default function YoutubeShortsSettingsContent({ onUnsavedChange }: { onUnsavedChange?: (hasUnsavedChanges: boolean) => void }) {
  const i18nT = useTranslations("settings");
  const [settings, setSettings] = useState<YoutubeShortsSettings>(DEFAULT_SETTINGS);
  const settingsBaselineRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patchSettings = useCallback((patch: Partial<YoutubeShortsSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/integrations/youtube-shorts/status", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(String(json?.error || "status_failed"));

      const nextSettings = normalizeSettings(json?.youtube_shorts);
      setSettings(nextSettings);
      settingsBaselineRef.current = JSON.stringify(nextSettings);
      emitDashboardUpdate(nextSettings);
    } catch (err) {
      console.warn("[youtube-shorts-settings] status failed", err);
      setError(i18nT("chargement_de_la_connexion_youtube_impossible_c09a1176"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!loading && settingsBaselineRef.current) {
      onUnsavedChange?.(JSON.stringify(settings) !== settingsBaselineRef.current);
    }
  }, [loading, onUnsavedChange, settings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("linked") !== "youtube_shorts") return;
    if (params.get("ok") === "1") {
      setNotice(i18nT("chaine_youtube_connectee_29fa0e53"));
      void loadSettings();
    }
    if (params.get("ok") === "0") setError(params.get("message") || "Connexion YouTube impossible.");
  }, [loadSettings]);

  const saveSettings = useCallback(async (nextPatch?: Partial<YoutubeShortsSettings>) => {
    const nextSettings = { ...settings, ...(nextPatch ?? {}) };
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const user = authData?.user;
      if (!user) throw new Error("Utilisateur non authentifié.");

      const { data, error: readError } = await supabase
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .maybeSingle();
      if (readError) throw readError;

      const current = asRecord((data as any)?.settings);
      const merged = {
        ...current,
        youtube_shorts: serializeSettings(nextSettings),
      };

      const { error: upsertError } = await supabase
        .from("pro_tools_configs")
        .upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: merged }, { onConflict: "user_id" });
      if (upsertError) throw upsertError;

      setSettings(nextSettings);
      settingsBaselineRef.current = JSON.stringify(nextSettings);
      onUnsavedChange?.(false);
      emitDashboardUpdate(nextSettings);
      setNotice(i18nT("reglages_youtube_enregistres_f74dc0ab"));
    } catch (err) {
      console.warn("[youtube-shorts-settings] save failed", err);
      setError(i18nT("enregistrement_des_reglages_youtube_impossible_a3106df5"));
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const connectYoutube = useCallback(() => {
    const returnTo = "/dashboard?panel=youtube_shorts";
    window.location.href = `/api/integrations/youtube-shorts/start?returnTo=${encodeURIComponent(returnTo)}`;
  }, []);

  const disconnectYoutube = useCallback(async () => {
    setSaving(true);
    setNotice(null);
    setError(null);

    try {
      const res = await fetch("/api/integrations/youtube-shorts/disconnect", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.ok === false) throw new Error(String(json?.error || "disconnect_failed"));
      const nextSettings = normalizeSettings(json?.youtube_shorts);
      setSettings(nextSettings);
      settingsBaselineRef.current = JSON.stringify(nextSettings);
      onUnsavedChange?.(false);
      emitDashboardUpdate(nextSettings);
      setNotice(i18nT("chaine_youtube_deconnectee_2b548afe"));
    } catch (err) {
      console.warn("[youtube-shorts-settings] disconnect failed", err);
      setError(i18nT("deconnexion_youtube_impossible_76706752"));
    } finally {
      setSaving(false);
    }
  }, []);



  const connected = Boolean(settings.connected && !settings.requiresUpdate);
  const statusLabel = settings.requiresUpdate ? "À reconnecter" : connected ? "Connecté" : "À connecter";
  const statusColor = settings.requiresUpdate ? "rgba(251,146,60,0.95)" : connected ? "rgba(34,197,94,0.95)" : "rgba(148,163,184,0.9)";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(15,23,42,0.65)",
            padding: "8px 10px",
            borderRadius: 999,
            color: "rgba(255,255,255,0.92)",
            fontSize: 13,
          }}
        >
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: statusColor }} />
          {i18nT("statut_b20e7fc2")}{" "}<strong>{statusLabel}</strong>
        </span>
      </div>

      {loading ? (
        <div style={{ border: "1px solid rgba(125,211,252,0.18)", background: "rgba(14,165,233,0.08)", borderRadius: 12, padding: "10px 12px", color: "rgba(224,242,254,0.96)", fontSize: 13 }}>
          {i18nT("chargement_de_la_connexion_youtube_f58580a0")}{" "}</div>
      ) : null}

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("compte_youtube_dad8e6eb")}</div>
          <ConnectionPill connected={connected} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("le_professionnel_autorise_inrcy_a_publier_70c0c2bc")}{" "}</div>

        <input
          value={connected ? (settings.channelName || settings.channelHandle || "Chaîne YouTube connectée") : ""}
          readOnly
          placeholder={connected ? "Chaîne YouTube connectée" : "Aucune chaîne connectée"}
          style={{ ...inputStyle, opacity: connected ? 1 : 0.8 }}
        />

        {connected ? (
          <div style={{ color: "rgba(226,232,240,0.86)", fontSize: 12 }}>
            {i18nT("compte_utilise_7b6629db")}{" "}<strong>{settings.accountEmail || i18nT("compte_google_connecte_38f3b9c6")}</strong>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {!connected ? (
            <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={connectYoutube} disabled={saving || loading}>
              {saving ? i18nT("connexion_7adf849f") : i18nT("connecter_youtube_b64d7544")}
            </button>
          ) : (
            <>
              <button type="button" className={`${styles.actionBtn} ${styles.secondaryBtn}`} onClick={connectYoutube} disabled={saving || loading}>
                {i18nT("reconnecter_youtube_c66fd70d")}{" "}</button>
              <button type="button" className={`${styles.actionBtn} ${styles.disconnectBtn}`} onClick={() => void disconnectYoutube()} disabled={saving || loading}>
                {saving ? i18nT("deconnexion_f5a5666d") : i18nT("deconnecter_9c1ef392")}
              </button>
            </>
          )}
        </div>
      </div>

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("lien_de_la_chaine_815204fe")}</div>
          <ConnectionPill connected={Boolean(connected && settings.channelUrl?.trim())} />
        </div>
        <div className={styles.blockSub}>
          {i18nT("lien_public_utilise_pour_le_bouton_e782e367")}{" "}<strong>{i18nT("voir_la_chaine_3c999e92")}</strong> {" "}{i18nT("dans_la_bulle_du_dashboard_689d3e85")}{" "}</div>

        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={settings.channelUrl}
            onChange={(event) => patchSettings({ channelUrl: event.target.value })}
            placeholder="https://www.youtube.com/@monentreprise"
            style={inputStyle}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void saveSettings()} disabled={saving || loading}>
              {saving ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_f7c8bcd8")}
            </button>
            <a
              href={settings.channelUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className={`${styles.actionBtn} ${styles.viewBtn}`}
              style={{ pointerEvents: settings.channelUrl ? "auto" : "none", opacity: settings.channelUrl ? 1 : 0.5 }}
            >
              {i18nT("voir_la_chaine_3c999e92")}{" "}</a>
          </div>
        </div>
      </div>

      <div style={cardStyle}>
        <div className={styles.blockHeaderRow}>
          <div className={styles.blockTitle}>{i18nT("reglages_youtube_par_defaut_1426d0d1")}</div>
        </div>
        <div className={styles.blockSub}>
          {i18nT("ces_preferences_serviront_dans_booster_pour_2d5a6e2f")}{" "}</div>

        <div
          style={{
            border: "1px solid rgba(56,189,248,0.22)",
            background: "rgba(14,165,233,0.08)",
            borderRadius: 12,
            padding: "10px 12px",
            color: "rgba(224,242,254,0.96)",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {i18nT("inrcy_publie_vos_videos_sur_fefeedf5")}{" "}<strong>{i18nT("youtube_558865a1")}</strong>{i18nT("si_la_video_est_courte_et_0b9de2b1")}{" "}</div>

        <div style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span className={styles.blockSub} style={{ opacity: 0.92 }}>{i18nT("visibilite_par_defaut_68ad92d8")}</span>
            <select value={settings.defaultVisibility} onChange={(event) => patchSettings({ defaultVisibility: event.target.value as YoutubeShortsSettings["defaultVisibility"] })} style={selectStyle}>
              <option value="public">{i18nT("public_dc5eb704")}</option>
              <option value="unlisted">{i18nT("non_repertorie_42775da7")}</option>
              <option value="private">{i18nT("prive_6e735639")}</option>
            </select>
          </label>

          <div style={switchRowStyle}>
            <PreferenceToggle label={i18nT("hashtags_automatiques_49295275")} checked={settings.autoHashtags} onChange={(autoHashtags) => patchSettings({ autoHashtags })} />
            <PreferenceToggle label={i18nT("contenu_destine_aux_enfants_e07f8415")} checked={settings.madeForKids} onChange={(madeForKids) => patchSettings({ madeForKids })} />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void saveSettings()} disabled={saving || loading}>
              {saving ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_mes_reglages_ec1b1b65")}
            </button>
          </div>
        </div>
      </div>

      {notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
      {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
    </div>
  );
}
