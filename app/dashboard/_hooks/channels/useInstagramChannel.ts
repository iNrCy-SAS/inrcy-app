"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import {
  DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES,
  normalizeInstagramPublicationPreferences,
  type InstagramPublicationPreferences,
} from "@/lib/instagramPublicationPreferences";
import { useDashboardViewerAccess } from "../../_components/DashboardViewerAccessProvider";
import type { ChannelResourcePhase } from "./channelResourcePhase";

type PatchChannelConnectionLocally = (
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void;

type TriggerChannelRefresh = (channel: DashboardChannelKey) => Promise<void>;

type UpdateRootSettingsKey = (key: "gmb" | "facebook" | "instagram" | "linkedin", nextObj: any) => Promise<void>;

type UseInstagramChannelOptions = {
  initialState?: Record<string, any> | null;
  panel: string | null;
  searchParams: { get(name: string): string | null };
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
  updateRootSettingsKey: UpdateRootSettingsKey;
};

const INSTAGRAM_SETUP_HELP =
  "Configuration Instagram à vérifier : le compte doit être Professionnel ou Créateur et être associé à votre Page Facebook professionnelle.";

function withInstagramSetupHelp(input: unknown, fallback: string) {
  const message = getSimpleFrenchErrorMessage(input, fallback).trim();
  const normalized = message.toLocaleLowerCase("fr");
  if (normalized.includes("professionnel") && normalized.includes("facebook")) {
    return message;
  }
  return `${message} ${INSTAGRAM_SETUP_HELP}`;
}

export function useInstagramChannel({
  initialState,
  panel,
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
}: UseInstagramChannelOptions) {
  const { metaPilotEnabled } = useDashboardViewerAccess();
  const [instagramAuthMode, setInstagramAuthMode] = useState<"instagram_login" | "facebook_login">(initialState?.instagramAuthMode === "instagram_login" ? "instagram_login" : "facebook_login");
  const initialConnected = initialState?.instagramConnected === true;
  const initialStatus = initialState?.instagramConnectionStatus;
  const [instagramUrl, setInstagramUrl] = useState<string>(() => typeof initialState?.instagramUrl === "string" ? initialState.instagramUrl : "");
  const [instagramAccountConnected, setInstagramAccountConnected] = useState<boolean>(initialState?.instagramAccountConnected === true);
  const [instagramConnected, setInstagramConnected] = useState<boolean>(initialConnected);
  const [instagramConnectionStatus, setInstagramConnectionStatus] = useState<ConnectionDisplayStatus>(() => (
    initialStatus === "connected" || initialStatus === "needs_update" || initialStatus === "disconnected"
      ? initialStatus
      : initialConnected ? "connected" : "disconnected"
  ));
  const [instagramUsername, setInstagramUsername] = useState<string>(() => typeof initialState?.instagramUsername === "string" ? initialState.instagramUsername : "");
  const [instagramUrlNotice, setInstagramUrlNotice] = useState<string | null>(null);
  const [instagramUrlError, setInstagramUrlError] = useState<string | null>(null);
  const [instagramPublicationPreferences, setInstagramPublicationPreferences] =
    useState<InstagramPublicationPreferences>(() =>
      normalizeInstagramPublicationPreferences(
        initialState?.instagramPublicationPreferences ||
          DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES,
      ),
    );
  const [instagramPublicationPreferencesLoading, setInstagramPublicationPreferencesLoading] =
    useState(false);
  const [instagramPublicationPreferencesSaving, setInstagramPublicationPreferencesSaving] =
    useState(false);
  const [instagramPublicationPreferencesNotice, setInstagramPublicationPreferencesNotice] =
    useState<string | null>(null);
  const [instagramPublicationPreferencesError, setInstagramPublicationPreferencesError] =
    useState<string | null>(null);

  const [igAccounts, setIgAccounts] = useState<Array<{ page_id: string; page_name?: string; ig_id: string; username?: string }>>([]);
  const [igAccountsLoading, setIgAccountsLoading] = useState(false);
  const [igAccountsPhase, setIgAccountsPhase] = useState<ChannelResourcePhase>("idle");
  const [igSelectedPageId, setIgSelectedPageId] = useState<string>("");
  const [igAccountsError, setIgAccountsError] = useState<string | null>(null);
  const igAccountsAutoLoadRef = useRef(false);

  const connectionRevisionRef = useRef(0);

  const clearPanelNotices = useCallback(() => {
    setInstagramUrlNotice(null);
    setInstagramUrlError(null);
  }, []);

  const setPanelSuccess = useCallback((message: string, timeout = 2200) => {
    clearPanelNotices();
    const clean = message.trim();
    setInstagramUrlNotice(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const setPanelError = useCallback((input: unknown, fallback: string, timeout = 3200) => {
    clearPanelNotices();
    const clean = getSimpleFrenchErrorMessage(input, fallback);
    setInstagramUrlError(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const loadInstagramPublicationPreferences = useCallback(async () => {
    setInstagramPublicationPreferencesLoading(true);
    setInstagramPublicationPreferencesError(null);
    try {
      const response = await fetch(
        "/api/integrations/instagram/publication-preferences",
        { cache: "no-store", credentials: "include" },
      );
      if (!response.ok) {
        throw new Error(
          await getSimpleFrenchApiError(
            response,
            "Impossible de charger les formats Instagram.",
          ),
        );
      }
      const payload = await response.json().catch(() => null);
      setInstagramPublicationPreferences(
        normalizeInstagramPublicationPreferences(payload?.preferences),
      );
    } catch (error) {
      setInstagramPublicationPreferencesError(
        getSimpleFrenchErrorMessage(
          error,
          "Impossible de charger les formats Instagram.",
        ),
      );
    } finally {
      setInstagramPublicationPreferencesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panel !== "instagram") return;
    void loadInstagramPublicationPreferences();
  }, [panel, loadInstagramPublicationPreferences]);

  const updateInstagramPublicationPreferences = useCallback(
    (patch: Partial<InstagramPublicationPreferences>) => {
      setInstagramPublicationPreferences((current) =>
        normalizeInstagramPublicationPreferences({ ...current, ...patch }),
      );
      setInstagramPublicationPreferencesNotice(null);
      setInstagramPublicationPreferencesError(null);
    },
    [],
  );

  const saveInstagramPublicationPreferences = useCallback(async (patch?: Partial<InstagramPublicationPreferences>) => {
    if (instagramPublicationPreferencesSaving) return false;
    const previous = instagramPublicationPreferences;
    const nextPreferences = normalizeInstagramPublicationPreferences({ ...previous, ...patch });
    if (patch) setInstagramPublicationPreferences(nextPreferences);
    setInstagramPublicationPreferencesSaving(true);
    setInstagramPublicationPreferencesNotice(null);
    setInstagramPublicationPreferencesError(null);
    try {
      const response = await fetch(
        "/api/integrations/instagram/publication-preferences",
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nextPreferences),
        },
      );
      if (!response.ok) {
        throw new Error(
          await getSimpleFrenchApiError(
            response,
            "Impossible d’enregistrer les formats Instagram.",
          ),
        );
      }
      const payload = await response.json().catch(() => null);
      setInstagramPublicationPreferences(
        normalizeInstagramPublicationPreferences(payload?.preferences),
      );
      setInstagramPublicationPreferencesNotice("Formats Instagram enregistrés.");
      return true;
    } catch (error) {
      if (patch) setInstagramPublicationPreferences(previous);
      setInstagramPublicationPreferencesError(
        getSimpleFrenchErrorMessage(
          error,
          "Impossible d’enregistrer les formats Instagram.",
        ),
      );
      return false;
    } finally {
      setInstagramPublicationPreferencesSaving(false);
    }
  }, [instagramPublicationPreferences, instagramPublicationPreferencesSaving]);

  const syncInstagramStateFromServer = useCallback(async (options?: { preserveSelection?: boolean }) => {
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    try {
      const res = await fetch("/api/integrations/instagram/status", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null) as {
        auth_mode?: "instagram_login" | "facebook_login";
        accountConnected?: boolean;
        connected?: boolean;
        expired?: boolean;
        resource_id?: string | null;
        username?: string | null;
        profile_url?: string | null;
        requiresUpdate?: boolean;
        connection_status?: ConnectionDisplayStatus;
      } | null;
      if (!json || revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return null;

      const nextAccountConnected = !!json.accountConnected;
      const nextConnected = !!json.connected;
      const nextUsername = typeof json.username === "string" ? json.username : "";
      const nextProfileUrl = typeof json.profile_url === "string" ? json.profile_url : "";
      const nextResourceId = typeof json.resource_id === "string" ? json.resource_id : null;
      const nextConnectionStatus = (json.connection_status || (nextConnected ? "connected" : "disconnected")) as ConnectionDisplayStatus;

      setInstagramAuthMode(json.auth_mode === "instagram_login" ? "instagram_login" : "facebook_login");
      setInstagramAccountConnected(nextAccountConnected);
      setInstagramConnected(nextConnected);
      setInstagramConnectionStatus(nextConnectionStatus);
      setInstagramUsername(nextUsername);
      setInstagramUrl(nextProfileUrl);
      if (!nextAccountConnected) setIgAccounts([]);
      if (!nextConnected && !options?.preserveSelection) setIgSelectedPageId("");

      patchChannelConnectionLocally("instagram", {
        connected: nextConnected,
        accountConnected: nextAccountConnected,
        configured: nextConnected,
        expired: !!json.expired,
        requiresUpdate: nextConnectionStatus === "needs_update",
        connectionStatus: nextConnectionStatus,
        resourceId: nextConnected ? nextResourceId : null,
        resourceLabel: nextConnected ? (nextUsername || null) : null,
        resourceUrl: nextConnected ? (nextProfileUrl || null) : null,
      }, { clearData: !nextConnected });

      return json;
    } catch {
      return null;
    }
  }, [patchChannelConnectionLocally]);

  const connectInstagramAccount = useCallback(async (options?: { repair?: boolean }) => {
    const returnTo = encodeURIComponent("/dashboard?panel=instagram");
    const repairParam = options?.repair ? "&repair=1" : "";
    window.location.href = `/api/integrations/instagram/start?returnTo=${returnTo}&mode=standard${repairParam}`;
  }, []);

  const connectInstagramBusinessAccount = useCallback(async () => {
    const returnTo = encodeURIComponent("/dashboard?panel=instagram");
    window.location.href = `/api/integrations/instagram/start?returnTo=${returnTo}&mode=business`;
  }, []);

  const connectInstagramDirectAccount = useCallback(() => {
    if (!metaPilotEnabled) return;
    const returnTo = encodeURIComponent("/dashboard?panel=instagram");
    window.location.href = `/api/integrations/instagram-direct/start?returnTo=${returnTo}`;
  }, [metaPilotEnabled]);

  const disconnectInstagramAccount = useCallback(async () => {
    const accountScope = getActiveBrowserUserId();
    connectionRevisionRef.current += 1;
    setIgAccountsLoading(false);
    setIgAccountsPhase("idle");
    const response = await fetch(instagramAuthMode === "instagram_login" ? "/api/integrations/instagram-direct/disconnect" : "/api/integrations/instagram/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (accountScope !== getActiveBrowserUserId()) return false;
    if (!response || !response.ok || payload?.ok !== true) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte Instagram.");
      return false;
    }
    setInstagramAccountConnected(false);
    connectionRevisionRef.current += 1;
    setInstagramConnectionStatus("disconnected");
    setInstagramConnected(false);
    setInstagramUsername("");
    setInstagramUrl("");
    setIgAccounts([]);
    setIgSelectedPageId("");
    setIgAccountsPhase("idle");
    patchChannelConnectionLocally("instagram", {
      connected: false,
      accountConnected: false,
      configured: false,
      expired: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    void triggerChannelRefresh("instagram").catch(() => {});
    setPanelSuccess("Compte Instagram déconnecté.");
    return true;
  }, [instagramAuthMode, patchChannelConnectionLocally, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const disconnectInstagramProfile = useCallback(async () => {
    const accountScope = getActiveBrowserUserId();
    connectionRevisionRef.current += 1;
    setIgAccountsLoading(false);
    setIgAccountsPhase("idle");
    const response = await fetch("/api/integrations/instagram/disconnect-profile", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (accountScope !== getActiveBrowserUserId()) return false;
    if (!response || !response.ok || payload?.ok !== true) {
      setPanelError(payload?.error, "Impossible de déconnecter le profil Instagram.");
      return false;
    }
    connectionRevisionRef.current += 1;
    setInstagramConnectionStatus("disconnected");
    setInstagramConnected(false);
    setInstagramUsername("");
    setInstagramUrl("");
    setIgSelectedPageId("");
    setIgAccountsPhase("idle");
    patchChannelConnectionLocally("instagram", {
      connected: false,
      accountConnected: true,
      configured: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    void triggerChannelRefresh("instagram").catch(() => {});
    setPanelSuccess("Profil Instagram déconnecté.");
    return true;
  }, [instagramAuthMode, patchChannelConnectionLocally, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  const loadInstagramAccounts = useCallback(async (options?: { autoSelect?: boolean }) => {
    if (!instagramAccountConnected || instagramAuthMode === "instagram_login") return;
    setIgAccountsLoading(true);
    setIgAccountsPhase("searching");
    setIgAccountsError(null);
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    try {
      const r = await fetch("/api/integrations/instagram/accounts", { cache: "no-store" });
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de charger vos comptes Instagram."));
      const j = await r.json().catch(() => ({}));
      if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return;
      const accounts = Array.isArray(j.accounts) ? j.accounts.map((account: Record<string, unknown>) => ({ page_id: String(account.page_id || ""), page_name: String(account.page_name || ""), ig_id: String(account.ig_id || ""), username: String(account.username || "") })) : [];
      setIgAccounts(accounts);
      if (options?.autoSelect === false || instagramConnected) return;
      if (!accounts.length) {
        setIgAccountsError(
          `Aucun profil Instagram compatible n’a été trouvé. ${INSTAGRAM_SETUP_HELP}`,
        );
        return false;
      }
      if (accounts.length === 1 && j.discovery?.complete !== false) {
        const only = accounts[0];
        setIgAccountsPhase("connecting");
        const autoRes = await fetch("/api/integrations/instagram/select-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId: only.page_id }),
        });
        const autoJson = await autoRes.json().catch(() => ({}));
        if (!autoRes.ok) throw new Error(autoJson?.error || "Impossible d’enregistrer Instagram.");
        if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return;
        setInstagramConnected(true);
        setIgSelectedPageId(only.page_id);
        const nextUsername = autoJson?.username ? String(autoJson.username) : String(only.username || "");
        if (nextUsername) setInstagramUsername(nextUsername);
        const nextInstagramUrl = autoJson?.profileUrl ? String(autoJson.profileUrl) : (only.username ? `https://www.instagram.com/${only.username}/` : "");
        setInstagramUrl(nextInstagramUrl);
        patchChannelConnectionLocally("instagram", {
          connected: true,
          accountConnected: true,
          configured: true,
          resourceId: only.ig_id || only.page_id,
          resourceLabel: nextUsername || null,
          resourceUrl: nextInstagramUrl || null,
        });
        void triggerChannelRefresh("instagram").catch(() => {});
        setPanelSuccess("Compte Instagram enregistré.");
        return true;
      }
    } catch (e: unknown) {
      if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return;
      setIgAccountsError(
        withInstagramSetupHelp(e, "Impossible de charger vos comptes Instagram."),
      );
    } finally {
      if (revision === connectionRevisionRef.current && accountScope === getActiveBrowserUserId()) {
        setIgAccountsLoading(false);
        setIgAccountsPhase("idle");
      }
    }
  }, [instagramAccountConnected, instagramConnected, instagramAuthMode, igSelectedPageId, patchChannelConnectionLocally, setPanelSuccess, triggerChannelRefresh, syncInstagramStateFromServer]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const ok = searchParams.get("ok");
    const shouldAutoLoad = panel === "instagram" && linked === "instagram" && ok === "1";

    if (!shouldAutoLoad) {
      igAccountsAutoLoadRef.current = false;
      return;
    }

    if (!instagramAccountConnected || instagramConnected || igAccountsLoading || igAccountsAutoLoadRef.current) return;

    igAccountsAutoLoadRef.current = true;
    void loadInstagramAccounts();
  }, [
    panel,
    searchParams,
    instagramAccountConnected,
    instagramConnected,
    igAccountsLoading,
    loadInstagramAccounts,
  ]);

  const saveInstagramProfile = useCallback(async (selectedPageId = igSelectedPageId) => {
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    const picked = igAccounts.find((a) => a.page_id === selectedPageId);
    if (!picked?.page_id) return false;

    const r = await fetch("/api/integrations/instagram/select-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: picked.page_id }),
    });
    const j = await r.json().catch(() => ({}));
    if (revision !== connectionRevisionRef.current || accountScope !== getActiveBrowserUserId()) return false;
    if (r.ok) {
      setInstagramConnected(true);
      const nextUsername = j?.username ? String(j.username) : String(picked.username || "");
      const nextProfileUrl = j?.profileUrl ? String(j.profileUrl) : (picked.username ? `https://www.instagram.com/${picked.username}/` : "");
      if (nextUsername) setInstagramUsername(nextUsername);
      if (nextProfileUrl) setInstagramUrl(nextProfileUrl);
      patchChannelConnectionLocally("instagram", {
        connected: true,
        accountConnected: true,
        configured: true,
        resourceId: picked.ig_id || picked.page_id,
        resourceLabel: nextUsername || null,
        resourceUrl: nextProfileUrl || null,
      });
      void triggerChannelRefresh("instagram").catch(() => {});
      setPanelSuccess("Compte Instagram enregistré.");
      setIgSelectedPageId(selectedPageId);
      return true;
    } else {
      const setupError = withInstagramSetupHelp(
        j?.error,
        "Impossible d'enregistrer Instagram.",
      );
      setPanelError(setupError, setupError, 6000);
      return false;
    }
  }, [igAccounts, igSelectedPageId, patchChannelConnectionLocally, triggerChannelRefresh, setPanelSuccess, setPanelError, syncInstagramStateFromServer]);

  return {
    instagramAuthMode,
    setInstagramAuthMode,
    connectInstagramDirectAccount,
    instagramUrl,
    setInstagramUrl,
    instagramAccountConnected,
    setInstagramAccountConnected,
    instagramConnected,
    setInstagramConnected,
    instagramConnectionStatus,
    setInstagramConnectionStatus,
    instagramUsername,
    setInstagramUsername,
    instagramUrlNotice,
    instagramUrlError,
    instagramPublicationPreferences,
    instagramPublicationPreferencesLoading,
    instagramPublicationPreferencesSaving,
    instagramPublicationPreferencesNotice,
    instagramPublicationPreferencesError,
    updateInstagramPublicationPreferences,
    saveInstagramPublicationPreferences,
    loadInstagramPublicationPreferences,
    igAccounts,
    setIgAccounts,
    igAccountsLoading,
    igAccountsPhase,
    igSelectedPageId,
    setIgSelectedPageId,
    igAccountsError,
    connectInstagramAccount,
    connectInstagramBusinessAccount,
    disconnectInstagramAccount,
    disconnectInstagramProfile,
    loadInstagramAccounts,
    saveInstagramProfile,
    syncInstagramStateFromServer,
    clearPanelNotices,
    setPanelSuccess,
    setPanelError,
  };
}
