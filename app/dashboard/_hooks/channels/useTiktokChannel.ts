"use client";

import { useCallback, useEffect, useState } from "react";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import {
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";

import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";

import {
  normalizeTiktokCommercialContent,
  normalizeTiktokDefaults,
  normalizeTiktokPreferredMedia,
  normalizeTiktokSettings,
  type TiktokCommercialContent,
  type TiktokPreferredMedia,
} from "@/lib/tiktokSettings";

type UseTiktokChannelArgs = {
  panel: string | null;
  patchChannelConnectionLocally?: (
    channel: DashboardChannelKey,
    patch: Partial<InrstatsChannelBlock["connection"]>,
    options?: { clearData?: boolean; clearError?: boolean },
  ) => void;
  triggerChannelRefresh?: (channel: DashboardChannelKey) => Promise<void>;
};

const DASHBOARD_CHANNEL_STATE_CACHE_KEY = "inrcy_dashboard_channel_state_v1";

type CachedTiktokState = {
  connected: boolean;
  username: string;
  profileUrl: string;
};

function readCachedTiktokState(): CachedTiktokState {
  const fallback: CachedTiktokState = {
    connected: false,
    username: "",
    profileUrl: "",
  };

  try {
    const raw = readAccountCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const state =
      parsed?.state && typeof parsed.state === "object" && !Array.isArray(parsed.state)
        ? (parsed.state as Record<string, unknown>)
        : parsed;
    if (!state || typeof state !== "object" || Array.isArray(state)) return fallback;
    return {
      connected: typeof state.tiktokConnected === "boolean" ? state.tiktokConnected : false,
      username: typeof state.tiktokUsername === "string" ? state.tiktokUsername : "",
      profileUrl: typeof state.tiktokProfileUrl === "string" ? state.tiktokProfileUrl : "",
    };
  } catch {
    return fallback;
  }
}

function writeCachedTiktokState(next: CachedTiktokState) {
  try {
    const raw = readAccountCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const currentState =
      parsed?.state && typeof parsed.state === "object" && !Array.isArray(parsed.state)
        ? (parsed.state as Record<string, unknown>)
        : parsed;
    writeAccountCacheValue(
      DASHBOARD_CHANNEL_STATE_CACHE_KEY,
      JSON.stringify({
        cachedAt: Date.now(),
        state: {
          ...(currentState && typeof currentState === "object" ? currentState : {}),
          tiktokConnected: next.connected,
          tiktokUsername: next.username,
          tiktokProfileUrl: next.profileUrl,
        },
      }),
    );
  } catch {
    // Le cache reste optionnel : l’état serveur demeure la source de vérité.
  }
}

async function readJson(res: Response) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) {
    throw new Error(getClientUserFacingErrorMessage(json?.error, "Erreur TikTok"));
  }
  return json;
}

export function useTiktokChannel({ panel, patchChannelConnectionLocally, triggerChannelRefresh }: UseTiktokChannelArgs) {
  const [cachedTiktokState] = useState<CachedTiktokState>(readCachedTiktokState);
  const [tiktokConnected, setTiktokConnected] = useState(cachedTiktokState.connected);
  const [tiktokUsername, setTiktokUsername] = useState(cachedTiktokState.username);
  const [tiktokProfileUrl, setTiktokProfileUrl] = useState(cachedTiktokState.profileUrl);
  const [tiktokProfileUrlNotice, setTiktokProfileUrlNotice] = useState<string | null>(null);
  const [tiktokProfileUrlError, setTiktokProfileUrlError] = useState<string | null>(null);
  const [tiktokSettingsNotice, setTiktokSettingsNotice] = useState<string | null>(null);
  const [tiktokSettingsError, setTiktokSettingsError] = useState<string | null>(null);
  const [tiktokLoading, setTiktokLoading] = useState(false);

  const [tiktokPreferredMedia, setTiktokPreferredMediaState] = useState<TiktokPreferredMedia>("video");
  const [tiktokAllowComments, setTiktokAllowComments] = useState(true);
  const [tiktokAllowDuo, setTiktokAllowDuo] = useState(true);
  const [tiktokAllowStitch, setTiktokAllowStitch] = useState(true);
  const [tiktokPhotoAutoMusic, setTiktokPhotoAutoMusic] = useState(true);
  const [tiktokCommercialContent, setTiktokCommercialContentState] = useState<TiktokCommercialContent>("none");
  const [tiktokAiContent, setTiktokAiContent] = useState(false);

  const setTiktokPreferredMedia = useCallback((value: string) => {
    setTiktokPreferredMediaState(normalizeTiktokPreferredMedia(value));
    setTiktokSettingsNotice(null);
    setTiktokSettingsError(null);
  }, []);

  const setTiktokCommercialContent = useCallback((value: string) => {
    setTiktokCommercialContentState(normalizeTiktokCommercialContent(value));
    setTiktokSettingsNotice(null);
    setTiktokSettingsError(null);
  }, []);

  const applyTiktok = useCallback((payload: unknown, options?: { refresh?: boolean }) => {
    const source = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const tiktok = normalizeTiktokSettings(payload);
    const defaults = normalizeTiktokDefaults(tiktok.defaults);

    const requiresUpdate = Boolean(source.requiresUpdate || source.connectionStatus === "needs_update");
    const connected = Boolean(tiktok.connected && !requiresUpdate);
    const username = connected ? (tiktok.username || "") : "";
    const profileUrl = connected ? (tiktok.profileUrl || "") : "";

    setTiktokConnected(connected);
    setTiktokUsername(username);
    setTiktokProfileUrl(profileUrl);
    writeCachedTiktokState({ connected, username, profileUrl });
    setTiktokPreferredMediaState(defaults.preferredMedia);
    setTiktokAllowComments(defaults.allowComments);
    setTiktokAllowDuo(defaults.allowDuo);
    setTiktokAllowStitch(defaults.allowStitch);
    setTiktokPhotoAutoMusic(defaults.photoAutoMusic);
    setTiktokCommercialContentState(defaults.commercialContent);
    setTiktokAiContent(defaults.aiContent);

    patchChannelConnectionLocally?.("tiktok", {
      connected,
      accountConnected: connected,
      configured: connected,
      statsConnected: connected,
      expired: requiresUpdate,
      requiresUpdate,
      connectionStatus: requiresUpdate ? "needs_update" : connected ? "connected" : "disconnected",
      resourceId: connected ? (username || profileUrl || null) : null,
      resourceLabel: connected ? (username || null) : null,
      resourceUrl: connected ? (profileUrl || null) : null,
    // Cette synchronisation est une hydratation de démarrage : on ne doit
    // pas effacer un bloc iNrStats encore valide pendant que le serveur
    // confirme l'état courant.
    }, { clearData: !connected, clearError: true });

    if (options?.refresh !== false) {
      void triggerChannelRefresh?.("tiktok").catch((error) => {
        console.warn("[tiktok] channel refresh failed", error);
      });
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("inrcy:tiktok-settings-updated", {
        detail: { connected, username, profileUrl },
      }));
    }
  }, [patchChannelConnectionLocally, triggerChannelRefresh]);

  // Le dashboard peut recevoir l'état de connexion commun avant la réponse
  // détaillée de /api/integrations/tiktok/status. On hydrate uniquement la
  // connexion pour éviter le flash "à connecter" sans réinitialiser les
  // réglages TikTok ni lancer un refresh statistiques coûteux.
  const applyTiktokConnectionState = useCallback((payload: unknown) => {
    const source = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const connected = Boolean(source.connected);
    const requiresUpdate = Boolean(source.requiresUpdate);
    const username = connected && typeof source.username === "string" ? source.username : "";
    const profileUrl = connected && typeof source.profileUrl === "string" ? source.profileUrl : "";

    setTiktokConnected(connected);
    setTiktokUsername(username);
    setTiktokProfileUrl(profileUrl);
    writeCachedTiktokState({ connected, username, profileUrl });

    patchChannelConnectionLocally?.("tiktok", {
      connected,
      accountConnected: connected || requiresUpdate,
      configured: connected || requiresUpdate,
      statsConnected: connected && !requiresUpdate,
      expired: false,
      requiresUpdate,
      connectionStatus: requiresUpdate ? "needs_update" : connected ? "connected" : "disconnected",
      resourceId: connected ? (username || profileUrl || null) : null,
      resourceLabel: connected ? (username || null) : null,
      resourceUrl: connected ? (profileUrl || null) : null,
    // Cette synchronisation est une hydratation de démarrage : on ne doit
    // pas effacer un bloc iNrStats encore valide pendant que le serveur
    // confirme l'état courant.
    }, { clearData: false, clearError: true });
  }, [patchChannelConnectionLocally]);

  const loadTiktokStatus = useCallback(async () => {
    setTiktokLoading(true);
    try {
      const json = await readJson(await fetch("/api/integrations/tiktok/status", { credentials: "include" }));
      applyTiktok(json.tiktok);
    } catch (error) {
      setTiktokSettingsError(getClientUserFacingErrorMessage(error, "Impossible de charger TikTok."));
    } finally {
      setTiktokLoading(false);
    }
  }, [applyTiktok]);

  useEffect(() => {
    void loadTiktokStatus();
  }, [loadTiktokStatus]);

  useEffect(() => {
    if (panel !== "tiktok") return;
    void loadTiktokStatus();
  }, [panel, loadTiktokStatus]);

  const connectTiktok = useCallback(() => {
    setTiktokLoading(true);
    setTiktokProfileUrlNotice(null);
    setTiktokProfileUrlError(null);
    const returnTo = encodeURIComponent("/dashboard?panel=tiktok");
    window.location.href = `/api/integrations/tiktok/start?returnTo=${returnTo}`;
  }, []);

  const disconnectTiktok = useCallback(async () => {
    setTiktokLoading(true);
    try {
      const json = await readJson(await fetch("/api/integrations/tiktok/disconnect-account", {
        method: "POST",
        credentials: "include",
      }));
      applyTiktok(json.tiktok);
      setTiktokProfileUrlNotice("Compte TikTok déconnecté.");
      setTiktokProfileUrlError(null);
      setTiktokSettingsError(null);
    } catch (error) {
      setTiktokProfileUrlError(getClientUserFacingErrorMessage(error, "Déconnexion TikTok impossible."));
    } finally {
      setTiktokLoading(false);
    }
  }, [applyTiktok]);

  const saveTiktokProfileUrl = useCallback(async () => {
    setTiktokLoading(true);
    try {
      const json = await readJson(await fetch("/api/integrations/tiktok/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl: tiktokProfileUrl }),
      }));
      applyTiktok(json.tiktok);
      setTiktokProfileUrlNotice("Lien TikTok enregistré.");
      setTiktokProfileUrlError(null);
    } catch (error) {
      setTiktokProfileUrlError(getClientUserFacingErrorMessage(error, "Lien TikTok invalide."));
      setTiktokProfileUrlNotice(null);
    } finally {
      setTiktokLoading(false);
    }
  }, [applyTiktok, tiktokProfileUrl]);

  const saveTiktokDefaults = useCallback(async () => {
    setTiktokLoading(true);
    try {
      const json = await readJson(await fetch("/api/integrations/tiktok/settings", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaults: {
            preferredMedia: tiktokPreferredMedia,
            allowComments: tiktokAllowComments,
            allowDuo: tiktokAllowDuo,
            allowStitch: tiktokAllowStitch,
            photoAutoMusic: tiktokPhotoAutoMusic,
            commercialContent: tiktokCommercialContent,
            aiContent: tiktokAiContent,
          },
        }),
      }));
      applyTiktok(json.tiktok);
      setTiktokSettingsNotice("Réglages TikTok enregistrés.");
      setTiktokSettingsError(null);
    } catch (error) {
      setTiktokSettingsError(getClientUserFacingErrorMessage(error, "Réglages TikTok impossibles à enregistrer."));
      setTiktokSettingsNotice(null);
    } finally {
      setTiktokLoading(false);
    }
  }, [applyTiktok, tiktokAiContent, tiktokAllowComments, tiktokAllowDuo, tiktokAllowStitch, tiktokCommercialContent, tiktokPhotoAutoMusic, tiktokPreferredMedia]);

  return {
    tiktokConnected,
    tiktokUsername,
    tiktokProfileUrl,
    setTiktokProfileUrl,
    tiktokProfileUrlNotice,
    tiktokProfileUrlError,
    tiktokSettingsNotice,
    tiktokSettingsError,
    tiktokLoading,
    connectTiktok,
    disconnectTiktok,
    saveTiktokProfileUrl,
    tiktokPreferredMedia,
    setTiktokPreferredMedia,
    tiktokAllowComments,
    setTiktokAllowComments,
    tiktokAllowDuo,
    setTiktokAllowDuo,
    tiktokAllowStitch,
    setTiktokAllowStitch,
    tiktokPhotoAutoMusic,
    setTiktokPhotoAutoMusic,
    tiktokCommercialContent,
    setTiktokCommercialContent,
    tiktokAiContent,
    setTiktokAiContent,
    saveTiktokDefaults,
    applyTiktokConnectionState,
    loadTiktokStatus,
  };
}
