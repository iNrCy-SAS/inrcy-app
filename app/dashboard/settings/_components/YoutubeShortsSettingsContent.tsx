"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";


import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";

import { useCallback, useEffect, useRef, useState } from "react";

import styles from "../../dashboard.module.css";
import { createClient } from "@/lib/supabaseClient";
import ConnectionPill from "../../_components/ConnectionPill";
import GoogleOAuthConsentBanner from "../../_components/GoogleOAuthConsentBanner";
import StatusMessage from "../../_components/StatusMessage";
import ChannelSettingsStep from "./ChannelSettingsStep";
import guideStyles from "./ChannelSettingsSteps.module.css";

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
    <label className={guideStyles.choiceCard} data-selected={checked ? "true" : undefined}>
      <span>{label}</span>
      <input
        className={guideStyles.choiceInput}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={guideStyles.choiceIndicator} aria-hidden="true" />
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
  const mountedRef = useRef(true);
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
      if (!mountedRef.current) return;
      setSettings(nextSettings);
      settingsBaselineRef.current = JSON.stringify(nextSettings);
      emitDashboardUpdate(nextSettings);
    } catch (err) {
      console.warn("[youtube-shorts-settings] status failed", err);
      if (mountedRef.current) {
        setError(i18nT("chargement_de_la_connexion_youtube_impossible_c09a1176"));
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
      if (!mountedRef.current) return;
      const user = authData?.user;
      if (!user) throw new Error("Utilisateur non authentifié.");

      const { data, error: readError } = await supabase
        .from("pro_tools_configs")
        .select("settings")
        .eq("user_id", resolveActiveBrowserUserId(user.id))
        .maybeSingle();
      if (!mountedRef.current) return;
      if (readError) throw readError;

      const current = asRecord((data as any)?.settings);
      const merged = {
        ...current,
        youtube_shorts: serializeSettings(nextSettings),
      };

      const { error: upsertError } = await supabase
        .from("pro_tools_configs")
        .upsert({ user_id: resolveActiveBrowserUserId(user.id), settings: merged }, { onConflict: "user_id" });
      if (!mountedRef.current) return;
      if (upsertError) throw upsertError;

      setSettings(nextSettings);
      settingsBaselineRef.current = JSON.stringify(nextSettings);
      onUnsavedChange?.(false);
      emitDashboardUpdate(nextSettings);
      setNotice(i18nT("reglages_youtube_enregistres_f74dc0ab"));
    } catch (err) {
      console.warn("[youtube-shorts-settings] save failed", err);
      if (mountedRef.current) {
        setError(i18nT("enregistrement_des_reglages_youtube_impossible_a3106df5"));
      }
    } finally {
      if (mountedRef.current) setSaving(false);
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
      if (!mountedRef.current) return;
      setSettings(nextSettings);
      settingsBaselineRef.current = JSON.stringify(nextSettings);
      onUnsavedChange?.(false);
      emitDashboardUpdate(nextSettings);
      setNotice(i18nT("chaine_youtube_deconnectee_2b548afe"));
    } catch (err) {
      console.warn("[youtube-shorts-settings] disconnect failed", err);
      if (mountedRef.current) {
        setError(i18nT("deconnexion_youtube_impossible_76706752"));
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, []);



  const connected = Boolean(settings.connected && !settings.requiresUpdate);
  const statusLabel = settings.requiresUpdate ? "À reconnecter" : connected ? "Connecté" : "À connecter";

  return (
    <div className={guideStyles.steps}>
      <ChannelSettingsStep
        step={1}
        accent="youtube"
        title={i18nT("compte_youtube_dad8e6eb")}
        description={i18nT("le_professionnel_autorise_inrcy_a_publier_70c0c2bc")}
        status={<ConnectionPill connected={connected} />}
      >
        <div className={guideStyles.compactActionLine}>
          <div className={guideStyles.accountSurface}>
            <Image
              className={guideStyles.channelIcon}
              src="/icons/youtube-shorts.png"
              width={46}
              height={46}
              alt=""
              aria-hidden="true"
            />
            <div className={guideStyles.accountCopy}>
              <strong>
                {connected
                  ? settings.channelName || settings.channelHandle || "Chaîne YouTube connectée"
                  : "Aucune chaîne connectée"}
              </strong>
              <span>
                {i18nT("statut_b20e7fc2")} <b>{statusLabel}</b>
                {connected
                  ? ` · ${settings.accountEmail || i18nT("compte_google_connecte_38f3b9c6")}`
                  : ""}
              </span>
            </div>
          </div>

          <div className={`${guideStyles.actionRow} ${guideStyles.accountActions}`}>
            <GoogleOAuthConsentBanner panel="youtube_shorts" variant="inline" />
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

        <div className={guideStyles.inlineSection}>
          <label className={guideStyles.fieldLabel} htmlFor="youtube-channel-url">
            {i18nT("lien_de_la_chaine_815204fe")}
          </label>
          <div className={guideStyles.actionRow}>
            <input
              id="youtube-channel-url"
              value={settings.channelUrl}
              onChange={(event) => patchSettings({ channelUrl: event.target.value })}
              placeholder="https://www.youtube.com/@monentreprise"
              className={guideStyles.control}
              style={inputStyle}
            />
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
      </ChannelSettingsStep>

      <ChannelSettingsStep
        step={2}
        accent="youtube"
        title={i18nT("reglages_youtube_par_defaut_1426d0d1")}
        description={i18nT("ces_preferences_serviront_dans_booster_pour_2d5a6e2f")}
      >
        <div className={guideStyles.compactSettings}>
          <label className={guideStyles.fieldGroup}>
            <span className={guideStyles.fieldLabel}>{i18nT("visibilite_par_defaut_68ad92d8")}</span>
            <select className={guideStyles.control} value={settings.defaultVisibility} onChange={(event) => patchSettings({ defaultVisibility: event.target.value as YoutubeShortsSettings["defaultVisibility"] })} style={selectStyle}>
              <option value="public">{i18nT("public_dc5eb704")}</option>
              <option value="unlisted">{i18nT("non_repertorie_42775da7")}</option>
              <option value="private">{i18nT("prive_6e735639")}</option>
            </select>
          </label>

          <div className={guideStyles.choiceGrid}>
            <PreferenceToggle label={i18nT("hashtags_automatiques_49295275")} checked={settings.autoHashtags} onChange={(autoHashtags) => patchSettings({ autoHashtags })} />
            <PreferenceToggle label={i18nT("contenu_destine_aux_enfants_e07f8415")} checked={settings.madeForKids} onChange={(madeForKids) => patchSettings({ madeForKids })} />
          </div>

          <div className={guideStyles.actionRow}>
            <button type="button" className={`${styles.actionBtn} ${styles.connectBtn}`} onClick={() => void saveSettings()} disabled={saving || loading}>
              {saving ? i18nT("enregistrement_9bf1058a") : i18nT("enregistrer_mes_reglages_ec1b1b65")}
            </button>
          </div>
        </div>
      </ChannelSettingsStep>

      {notice ? <StatusMessage variant="success">{notice}</StatusMessage> : null}
      {error ? <StatusMessage variant="error">{error}</StatusMessage> : null}
    </div>
  );
}
