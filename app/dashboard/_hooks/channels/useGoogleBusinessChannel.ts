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

type UseGoogleBusinessChannelOptions = {
  initialState?: Record<string, any> | null;
  panel: string | null;
  searchParams: { get(name: string): string | null };
  patchChannelConnectionLocally: PatchChannelConnectionLocally;
  triggerChannelRefresh: TriggerChannelRefresh;
  updateRootSettingsKey: UpdateRootSettingsKey;
};

export function useGoogleBusinessChannel({
  initialState,
  panel,
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
  updateRootSettingsKey,
}: UseGoogleBusinessChannelOptions) {
  const initialConnected = initialState?.gmbConnected === true;
  const initialStatus = initialState?.gmbConnectionStatus;
  const [gmbUrl, setGmbUrl] = useState<string>(() => typeof initialState?.gmbUrl === "string" ? initialState.gmbUrl : "");
  const [gmbConnected, setGmbConnected] = useState<boolean>(initialConnected);
  const [gmbConnectionStatus, setGmbConnectionStatus] = useState<ConnectionDisplayStatus>(() => (
    initialStatus === "connected" || initialStatus === "needs_update" || initialStatus === "disconnected"
      ? initialStatus
      : initialConnected ? "connected" : "disconnected"
  ));
  const [gmbAccountConnected, setGmbAccountConnected] = useState<boolean>(initialState?.gmbAccountConnected === true);
  const [gmbConfigured, setGmbConfigured] = useState<boolean>(initialState?.gmbConfigured === true);
  const [gmbAccountEmail, setGmbAccountEmail] = useState<string>(() => typeof initialState?.gmbAccountEmail === "string" ? initialState.gmbAccountEmail : "");
  const [gmbUrlNotice, setGmbUrlNotice] = useState<string | null>(null);
  const [gmbUrlError, setGmbUrlError] = useState<string | null>(null);

  const [gmbAccounts, setGmbAccounts] = useState<Array<{ name: string; accountName?: string; type?: string }>>([]);
  const [gmbLocations, setGmbLocations] = useState<Array<{ name: string; title?: string }>>([]);
  const [gmbAccountName, setGmbAccountName] = useState<string>("");
  const [gmbLocationName, setGmbLocationName] = useState<string>(() => typeof initialState?.gmbLocationName === "string" ? initialState.gmbLocationName : "");
  const [gmbLocationLabel, setGmbLocationLabel] = useState<string>(() => typeof initialState?.gmbLocationLabel === "string" ? initialState.gmbLocationLabel : "");
  const [gmbLoadingList, setGmbLoadingList] = useState(false);
  const [gmbLocationsPhase, setGmbLocationsPhase] = useState<ChannelResourcePhase>("idle");
  const [gmbListError, setGmbListError] = useState<string | null>(null);
  const gmbLocationsAutoLoadRef = useRef(false);

  const clearPanelNotices = useCallback(() => {
    setGmbUrlNotice(null);
    setGmbUrlError(null);
  }, []);

  const setPanelSuccess = useCallback((message: string, timeout = 2200) => {
    clearPanelNotices();
    const clean = message.trim();
    setGmbUrlNotice(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const setPanelError = useCallback((input: unknown, fallback: string, timeout = 3200) => {
    clearPanelNotices();
    const clean = getSimpleFrenchErrorMessage(input, fallback);
    setGmbUrlError(clean);
    window.setTimeout(clearPanelNotices, timeout);
  }, [clearPanelNotices]);

  const connectGmbAccount = useCallback(async () => {
    const returnTo = encodeURIComponent("/dashboard?panel=gmb");
    window.location.href = `/api/integrations/google-business/start?returnTo=${returnTo}`;
  }, []);

  const disconnectGmbAccount = useCallback(async () => {
    const response = await fetch("/api/integrations/google-business/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response || !response.ok || payload?.ok === false) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte Google Business.");
      return;
    }
    setGmbConnected(false);
    setGmbAccountConnected(false);
    setGmbConfigured(false);
    setGmbAccountEmail("");
    setGmbUrl("");
    setGmbAccounts([]);
    setGmbLocations([]);
    setGmbAccountName("");
    setGmbLocationName("");
    setGmbLocationLabel("");
    setGmbLocationsPhase("idle");
    await updateRootSettingsKey("gmb", { url: "", connected: false, configured: false, accountEmail: "", accountName: "", locationName: "", locationTitle: "", resource_id: "" });
    patchChannelConnectionLocally("gmb", {
      connected: false,
      accountConnected: false,
      configured: false,
      expired: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    await triggerChannelRefresh("gmb");
    setPanelSuccess("Compte Google déconnecté.");
  }, [patchChannelConnectionLocally, setPanelError, setPanelSuccess, triggerChannelRefresh, updateRootSettingsKey]);

  const disconnectGmbBusiness = useCallback(async () => {
    const res = await fetch("/api/integrations/google-business/disconnect-location", { method: "POST" }).catch(() => null);
    const js = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      setPanelError(js?.error, "Impossible de déconnecter l'établissement Google Business.");
      return;
    }
    setGmbConnected(false);
    setGmbConfigured(false);
    setGmbUrl("");
    setGmbLocationName("");
    setGmbLocationLabel("");
    setGmbLocationsPhase("idle");
    await updateRootSettingsKey("gmb", { url: "", resource_id: "", locationName: "", locationTitle: "", configured: false, connected: true });
    patchChannelConnectionLocally("gmb", {
      connected: false,
      accountConnected: true,
      configured: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    await triggerChannelRefresh("gmb");
    setPanelSuccess("Établissement Google Business déconnecté.");
  }, [patchChannelConnectionLocally, setPanelError, setPanelSuccess, triggerChannelRefresh, updateRootSettingsKey]);

  const loadGmbAccountsAndLocations = useCallback(async () => {
    if (!gmbAccountConnected) return;
    setGmbLoadingList(true);
    setGmbLocationsPhase("searching");
    setGmbListError(null);
    try {
      const r = await fetch(`/api/integrations/google-business/locations`, { cache: "no-store" });
      if (!r.ok) throw new Error(await getSimpleFrenchApiError(r, "Impossible de charger les établissements Google Business."));
      const j = await r.json().catch(() => ({}));
      const accounts = Array.isArray(j.accounts) ? j.accounts : [];
      const locations = Array.isArray(j.locations) ? j.locations : [];
      setGmbAccounts(accounts);
      setGmbAccountName(j.accountName || "");
      setGmbLocations(locations);
      if (j.locationsError) setGmbListError(j.locationsError);

      const currentLocationName = (gmbLocationName || "").trim();
      const hasCurrentSelection = Boolean(currentLocationName && locations.some((l: { name: string; title?: string | null }) => l.name === currentLocationName));
      const nextLocationName = hasCurrentSelection ? currentLocationName : String(locations?.[0]?.name || "");
      if (nextLocationName) {
        setGmbLocationName(nextLocationName);
        const matched = locations.find((l: { name: string; title?: string | null }) => l.name === nextLocationName);
        if (matched?.title) setGmbLocationLabel(String(matched.title));
      }

      if (locations.length === 1 && j.accountName) {
        const only = locations[0];
        setGmbLocationsPhase("connecting");
        const autoRes = await fetch("/api/integrations/google-business/select-location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountName: j.accountName,
            locationName: only.name,
            locationTitle: only.title || null,
          }),
        });
        const autoJson = await autoRes.json().catch(() => ({}));
        if (!autoRes.ok) throw new Error(autoJson?.error || "Impossible d’enregistrer l’établissement Google Business.");
        setGmbLocationName(String(only.name || ""));
        setGmbLocationLabel(String(only.title || ""));
        setGmbConfigured(true);
        setGmbConnected(true);
        if (autoJson?.url) setGmbUrl(String(autoJson.url));
        patchChannelConnectionLocally("gmb", {
          connected: true,
          accountConnected: true,
          configured: true,
          resourceId: only.name || null,
          resourceLabel: only.title || null,
          resourceUrl: autoJson?.url ? String(autoJson.url) : null,
        });
        await triggerChannelRefresh("gmb");
        setPanelSuccess("Établissement Google Business enregistré.");
      }
    } catch (e: any) {
      setGmbListError(getSimpleFrenchErrorMessage(e, "Impossible de charger les établissements Google Business."));
    } finally {
      setGmbLoadingList(false);
      setGmbLocationsPhase("idle");
    }
  }, [gmbAccountConnected, gmbLocationName, patchChannelConnectionLocally, setPanelSuccess, triggerChannelRefresh]);

  useEffect(() => {
    const linked = searchParams.get("linked");
    const ok = searchParams.get("ok");
    const shouldAutoLoad = panel === "gmb" && linked === "gmb" && ok === "1";

    if (!shouldAutoLoad) {
      gmbLocationsAutoLoadRef.current = false;
      return;
    }

    if (!gmbAccountConnected || gmbConfigured || gmbLoadingList || gmbLocationsAutoLoadRef.current) return;

    gmbLocationsAutoLoadRef.current = true;
    void loadGmbAccountsAndLocations();
  }, [
    panel,
    searchParams,
    gmbAccountConnected,
    gmbConfigured,
    gmbLoadingList,
    loadGmbAccountsAndLocations,
  ]);

  const saveGmbLocation = useCallback(async () => {
    if (!gmbAccountName || !gmbLocationName) return false;
    try {
      const picked = gmbLocations.find((l) => l.name === gmbLocationName);
      const res = await fetch("/api/integrations/google-business/select-location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountName: gmbAccountName,
          locationName: gmbLocationName,
          locationTitle: picked?.title || null,
        }),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(js?.error || "Impossible d’enregistrer l’établissement");

      setGmbConfigured(true);
      setGmbConnected(true);
      setGmbLocationLabel(String(picked?.title || ""));
      if (js?.url) setGmbUrl(String(js.url));
      patchChannelConnectionLocally("gmb", {
        connected: true,
        accountConnected: true,
        configured: true,
        resourceId: gmbLocationName || null,
        resourceLabel: picked?.title || null,
        resourceUrl: js?.url ? String(js.url) : null,
      });
      triggerChannelRefresh("gmb");
      setPanelSuccess("Établissement Google Business enregistré.", 1800);
      return true;
    } catch (error) {
      setPanelError(error, "Impossible d'enregistrer l'établissement Google Business.");
      return false;
    }
  }, [gmbAccountName, gmbLocationName, gmbLocations, patchChannelConnectionLocally, triggerChannelRefresh, setPanelError, setPanelSuccess]);

  return {
    gmbUrl,
    setGmbUrl,
    gmbConnected,
    setGmbConnected,
    gmbConnectionStatus,
    setGmbConnectionStatus,
    gmbAccountConnected,
    setGmbAccountConnected,
    gmbConfigured,
    setGmbConfigured,
    gmbAccountEmail,
    setGmbAccountEmail,
    gmbUrlNotice,
    gmbUrlError,
    gmbAccounts,
    setGmbAccounts,
    gmbLocations,
    setGmbLocations,
    gmbAccountName,
    setGmbAccountName,
    gmbLocationName,
    setGmbLocationName,
    gmbLocationLabel,
    setGmbLocationLabel,
    gmbLoadingList,
    gmbLocationsPhase,
    gmbListError,
    connectGmbAccount,
    disconnectGmbAccount,
    disconnectGmbBusiness,
    loadGmbAccountsAndLocations,
    saveGmbLocation,
    clearPanelNotices,
    setPanelSuccess,
    setPanelError,
  };
}
