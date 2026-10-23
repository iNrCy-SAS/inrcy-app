"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
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
  searchParams,
  patchChannelConnectionLocally,
  triggerChannelRefresh,
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

  const connectionRevisionRef = useRef(0);
  const selectionIntentRef = useRef(0);
  const configuredRef = useRef(gmbConfigured);
  configuredRef.current = gmbConfigured;
  const locationsInFlightRef = useRef<{
    accountScope: string | null;
    revision: number;
    autoSelect: boolean;
    promise: Promise<void>;
  } | null>(null);
  const selectionInFlightRef = useRef<{
    accountScope: string | null;
    revision: number;
    locationName: string;
    promise: Promise<boolean>;
  } | null>(null);

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
    const accountScope = getActiveBrowserUserId();
    gmbLocationsAutoLoadRef.current = true;
    connectionRevisionRef.current += 1;
    setGmbLoadingList(false);
    setGmbLocationsPhase("idle");
    const response = await fetch("/api/integrations/google-business/disconnect-account", { method: "POST" }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (accountScope !== getActiveBrowserUserId()) return false;
    if (!response || !response.ok || payload?.ok !== true) {
      setPanelError(payload?.error, "Impossible de déconnecter le compte Google Business.");
      return false;
    }
    connectionRevisionRef.current += 1;
    setGmbConnectionStatus("disconnected");
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
    patchChannelConnectionLocally("gmb", {
      connected: false,
      accountConnected: false,
      configured: false,
      expired: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    void triggerChannelRefresh("gmb").catch(() => {});
    setPanelSuccess("Compte Google déconnecté.");
    return true;
  }, [patchChannelConnectionLocally, setPanelError, setPanelSuccess, triggerChannelRefresh]);

  const disconnectGmbBusiness = useCallback(async () => {
    const accountScope = getActiveBrowserUserId();
    gmbLocationsAutoLoadRef.current = true;
    connectionRevisionRef.current += 1;
    setGmbLoadingList(false);
    setGmbLocationsPhase("idle");
    const res = await fetch("/api/integrations/google-business/disconnect-location", { method: "POST" }).catch(() => null);
    const js = res ? await res.json().catch(() => ({})) : {};
    if (accountScope !== getActiveBrowserUserId()) return false;
    if (!res || !res.ok || js?.ok !== true) {
      setPanelError(js?.error, "Impossible de déconnecter l'établissement Google Business.");
      return false;
    }
    connectionRevisionRef.current += 1;
    setGmbConnectionStatus("disconnected");
    setGmbConnected(false);
    setGmbConfigured(false);
    setGmbUrl("");
    setGmbLocationName("");
    setGmbLocationLabel("");
    setGmbLocationsPhase("idle");
    patchChannelConnectionLocally("gmb", {
      connected: false,
      accountConnected: true,
      configured: false,
      resourceId: null,
      resourceLabel: null,
      resourceUrl: null,
    }, { clearData: true });
    void triggerChannelRefresh("gmb").catch(() => {});
    setPanelSuccess("Établissement Google Business déconnecté.");
    return true;
  }, [patchChannelConnectionLocally, setPanelError, setPanelSuccess, triggerChannelRefresh]);

  const persistGmbLocation = useCallback((
    accountName: string,
    locationName: string,
    locationTitle: string | null,
  ): Promise<boolean> => {
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    const existing = selectionInFlightRef.current;
    if (existing?.accountScope === accountScope && existing.revision === revision && existing.locationName === locationName) {
      return existing.promise;
    }
    const selectionIntent = ++selectionIntentRef.current;
    const isCurrent = () => revision === connectionRevisionRef.current && accountScope === getActiveBrowserUserId() && selectionIntent === selectionIntentRef.current;
    const operation = { accountScope, revision, locationName, promise: Promise.resolve(false) };
    operation.promise = (async () => {
      try {
        // A later user choice must also be the last write on the server.
        if (existing?.accountScope === accountScope && existing.revision === revision) await existing.promise;
        if (!isCurrent()) return false;
        const res = await fetch("/api/integrations/google-business/select-location", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountName, locationName, locationTitle }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!isCurrent()) return false;
        if (!res.ok || payload?.ok !== true) throw new Error(payload?.error || "Impossible d’enregistrer l’établissement Google Business.");

        setGmbAccountConnected(true);
        setGmbConfigured(true);
        setGmbConnected(true);
        setGmbConnectionStatus("connected");
        setGmbLocationName(locationName);
        setGmbLocationLabel(locationTitle || "");
        if (payload?.url) setGmbUrl(String(payload.url));
        patchChannelConnectionLocally("gmb", {
          connected: true,
          accountConnected: true,
          configured: true,
          expired: false,
          resourceId: locationName,
          resourceLabel: locationTitle,
          resourceUrl: payload?.url ? String(payload.url) : null,
        });
        void triggerChannelRefresh("gmb").catch(() => {});
        setPanelSuccess("Établissement Google Business enregistré.");
        return true;
      } catch (error) {
        if (isCurrent()) setPanelError(error, "Impossible d'enregistrer l'établissement Google Business.");
        return false;
      } finally {
        if (selectionInFlightRef.current === operation) selectionInFlightRef.current = null;
      }
    })();
    selectionInFlightRef.current = operation;
    return operation.promise;
  }, [patchChannelConnectionLocally, setPanelError, setPanelSuccess, triggerChannelRefresh]);

  const loadGmbAccountsAndLocations = useCallback((options?: { autoSelect?: boolean; afterOAuth?: boolean }): Promise<void> => {
    // The locations route validates the Google connection. After an OAuth
    // return, start discovery without waiting for dashboard hydration.
    if (!gmbAccountConnected && !options?.afterOAuth) return Promise.resolve();
    const revision = connectionRevisionRef.current;
    const selectionIntent = selectionIntentRef.current;
    const accountScope = getActiveBrowserUserId();
    const autoSelect = options?.autoSelect !== false;
    const existing = locationsInFlightRef.current;
    if (existing?.accountScope === accountScope && existing.revision === revision) {
      existing.autoSelect ||= autoSelect;
      return existing.promise;
    }
    setGmbLoadingList(true);
    setGmbLocationsPhase("searching");
    setGmbListError(null);
    const isCurrent = () => revision === connectionRevisionRef.current && accountScope === getActiveBrowserUserId();
    const operation = { accountScope, revision, autoSelect, promise: Promise.resolve() };
    operation.promise = (async () => {
      try {
        const response = await fetch("/api/integrations/google-business/locations", { cache: "no-store" });
        if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible de charger les établissements Google Business."));
        const payload = await response.json().catch(() => ({}));
        if (!isCurrent()) return;
        const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
        const locations = Array.isArray(payload.locations) ? payload.locations : [];
        setGmbAccounts(accounts);
        setGmbAccountName(payload.accountName || "");
        setGmbLocations(locations);
        if (payload.locationsError) setGmbListError(payload.locationsError);
        if (!operation.autoSelect || configuredRef.current || selectionIntent !== selectionIntentRef.current) return;

        // One location can be confirmed directly after OAuth. With several
        // locations, retain the user's choice rather than choosing the first.
        if (locations.length === 1 && payload.accountName) {
          const only = locations[0];
          setGmbLocationsPhase("connecting");
          await persistGmbLocation(String(payload.accountName), String(only.name), only.title ? String(only.title) : null);
        }
      } catch (error) {
        if (isCurrent()) setGmbListError(getSimpleFrenchErrorMessage(error, "Impossible de charger les établissements Google Business."));
      } finally {
        if (locationsInFlightRef.current === operation) locationsInFlightRef.current = null;
        if (isCurrent()) {
          setGmbLoadingList(false);
          setGmbLocationsPhase("idle");
        }
      }
    })();
    locationsInFlightRef.current = operation;
    return operation.promise;
  }, [gmbAccountConnected, persistGmbLocation]);

  const oauthAccountScope = getActiveBrowserUserId();
  useEffect(() => {
    const shouldAutoLoad = searchParams.get("linked") === "gmb" && searchParams.get("ok") === "1";
    if (!shouldAutoLoad) {
      gmbLocationsAutoLoadRef.current = false;
      return;
    }
    if (!oauthAccountScope || gmbLocationsAutoLoadRef.current) return;

    // Consume this callback before starting I/O. Subsequent hydration, opening
    // the selector, or disconnecting must never replay the OAuth selection.
    gmbLocationsAutoLoadRef.current = true;
    if (!gmbConfigured) void loadGmbAccountsAndLocations({ afterOAuth: true });
  }, [searchParams, oauthAccountScope, gmbConfigured, loadGmbAccountsAndLocations]);

  const saveGmbLocation = useCallback((selectedLocationName = gmbLocationName) => {
    if (!gmbAccountName || !selectedLocationName) return Promise.resolve(false);
    const picked = gmbLocations.find(location => location.name === selectedLocationName);
    return persistGmbLocation(gmbAccountName, selectedLocationName, picked?.title || null);
  }, [gmbAccountName, gmbLocationName, gmbLocations, persistGmbLocation]);

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
