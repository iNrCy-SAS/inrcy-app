"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { ChannelResourcePhase } from "./channelResourcePhase";

type PatchChannelConnectionLocally = (
  channel: DashboardChannelKey,
  patch: Partial<InrstatsChannelBlock["connection"]>,
  options?: { clearData?: boolean; clearError?: boolean },
) => void;

type TriggerChannelRefresh = (channel: DashboardChannelKey) => Promise<void>;

type UpdateRootSettingsKey = (key: "gmb" | "facebook" | "instagram" | "linkedin", nextObj: any) => Promise<void>;

type UseInstagramChannelOptions = {
  panel: string | null;
  searchParams: { get(name: string): string | null };
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
  updateRootSettingsKey: UpdateRootSettingsKey;
};

export function useInstagramChannel({
  panel,
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
  updateRootSettingsKey,
}: UseInstagramChannelOptions) {
  const [instagramUrl, setInstagramUrl] = useState<string>("");
  const [instagramAccountConnected, setInstagramAccountConnected] = useState<boolean>(false);
  const [instagramConnected, setInstagramConnected] = useState<boolean>(false);
  const [instagramConnectionStatus, setInstagramConnectionStatus] = useState<ConnectionDisplayStatus>("disconnected");
  const [instagramUsername, setInstagramUsername] = useState<string>("");
  const [instagramUrlNotice, setInstagramUrlNotice] = useState<string | null>(null);
  const [instagramUrlError, setInstagramUrlError] = useState<string | null>(null);

  const [igAccounts, setIgAccounts] = useState<Array<{ page_id: string; page_name?: string; ig_id: string; username?: string; page_access_token?: string }>>([]);
  const [igAccountsLoading, setIgAccountsLoading] = useState(false);
  const [igAccountsPhase, setIgAccountsPhase] = useState<ChannelResourcePhase>("idle");
  const [igSelectedPageId, setIgSelectedPageId] = useState<string>("");
  const [igAccountsError, setIgAccountsError] = useState<string | null>(null);
  const igAccountsAutoLoadRef = useRef(false);

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

  const syncInstagramStateFromServer = useCallback(async (options?: { preserveSelection?: boolean }) => {
    try {
      const res = await fetch("/api/integrations/instagram/status", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null) as {
        accountConnected?: boolean;
        connected?: boolean;
        expired?: boolean;
        resource_id?: string | null;
        username?: string | null;
        profile_url?: string | null;
        requiresUpdate?: boolean;
        connection_status?: ConnectionDisplayStatus;
      } | null;
      if (!json) return null;

      const nextAccountConnected = !!json.accountConnected;
      const nextConnected = !!json.connected;
      const nextUsername = typeof json.username === "string" ? json.username : "";
      const nextProfileUrl = typeof json.profile_url === "string" ? json.profile_url : "";
      const nextResourceId = typeof json.resource_id === "string" ? json.resource_id : null;
      const nextConnectionStatus = (json.connection_status || (nextConnected ? "connected" : "disconnected")) as ConnectionDisplayStatus;

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

  const disconnectInstagramAccount = useCallback(async () => {
    const response = await fetch("/api/integrations/instagram/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.ok === false) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte Instagram.");
      return;
    }
    setInstagramAccountConnected(false);
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
    await updateRootSettingsKey("instagram", {
      accountConnected: false,
      connected: false,
      username: "",
      url: "",
      pageId: "",
      igId: "",
    });
    await triggerChannelRefresh("instagram");
    await syncInstagramStateFromServer();
    setPanelSuccess("Compte Instagram déconnecté.");
  }, [patchChannelConnectionLocally, updateRootSettingsKey, triggerChannelRefresh, setPanelError, setPanelSuccess, syncInstagramStateFromServer]);

  const disconnectInstagramProfile = useCallback(async () => {
    const response = await fetch("/api/integrations/instagram/disconnect-profile", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.ok === false) {
      setPanelError(payload?.error, "Impossible de déconnecter le profil Instagram.");
      return;
    }
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
    await updateRootSettingsKey("instagram", {
      accountConnected: true,
      connected: false,
      username: "",
      url: "",
      pageId: "",
      igId: "",
    });
    await triggerChannelRefresh("instagram");
    await syncInstagramStateFromServer();
    setPanelSuccess("Profil Instagram déconnecté.");
  }, [patchChannelConnectionLocally, updateRootSettingsKey, triggerChannelRefresh, setPanelError, setPanelSuccess, syncInstagramStateFromServer]);

  const loadInstagramAccounts = useCallback(async () => {
    if (!instagramAccountConnected) return;
    setIgAccountsLoading(true);
    setIgAccountsPhase("searching");
    setIgAccountsError(null);
    try {
      const r = await fetch("/api/integrations/instagram/accounts", { cache: "no-store" });
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de charger vos comptes Instagram."));
      const j = await r.json().catch(() => ({}));
      setIgAccounts(j.accounts || []);
      if (!igSelectedPageId && (j.accounts?.[0]?.page_id)) setIgSelectedPageId(j.accounts[0].page_id);

      if ((j.accounts || []).length === 1) {
        const only = j.accounts[0];
        setIgAccountsPhase("connecting");
        const autoRes = await fetch("/api/integrations/instagram/select-profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId: only.page_id }),
        });
        const autoJson = await autoRes.json().catch(() => ({}));
        if (!autoRes.ok) throw new Error(autoJson?.error || "Impossible d’enregistrer Instagram.");
        setInstagramConnected(true);
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
        await updateRootSettingsKey("instagram", {
          accountConnected: true,
          connected: true,
          username: nextUsername,
          url: nextInstagramUrl,
          pageId: String(only.page_id || ""),
          igId: String(only.ig_id || only.page_id || ""),
        });
        await triggerChannelRefresh("instagram");
        await syncInstagramStateFromServer({ preserveSelection: true });
        setPanelSuccess("Compte Instagram enregistré.");
      return true;
      }
    } catch (e: unknown) {
      setIgAccountsError(getSimpleFrenchErrorMessage(e, "Impossible de charger vos comptes Instagram."));
    } finally {
      setIgAccountsLoading(false);
      setIgAccountsPhase("idle");
    }
  }, [instagramAccountConnected, igSelectedPageId, patchChannelConnectionLocally, setPanelSuccess, triggerChannelRefresh, updateRootSettingsKey, syncInstagramStateFromServer]);

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

  const saveInstagramProfile = useCallback(async () => {
    const picked = igAccounts.find((a) => a.page_id === igSelectedPageId);
    if (!picked?.page_id) return false;

    const r = await fetch("/api/integrations/instagram/select-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: picked.page_id }),
    });
    const j = await r.json().catch(() => ({}));
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
      await updateRootSettingsKey("instagram", {
        accountConnected: true,
        connected: true,
        username: nextUsername,
        url: nextProfileUrl,
        pageId: String(picked.page_id || ""),
        igId: String(picked.ig_id || picked.page_id || ""),
      });
      await triggerChannelRefresh("instagram");
      await syncInstagramStateFromServer({ preserveSelection: true });
      setPanelSuccess("Compte Instagram enregistré.");
      return true;
    } else {
      setPanelError(j?.error, "Impossible d'enregistrer Instagram.");
      return false;
    }
  }, [igAccounts, igSelectedPageId, patchChannelConnectionLocally, triggerChannelRefresh, updateRootSettingsKey, setPanelSuccess, setPanelError, syncInstagramStateFromServer]);

  return {
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
