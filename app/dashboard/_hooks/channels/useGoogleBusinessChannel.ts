"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { getClientUserFacingApiError as getSimpleFrenchApiError, getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";
import type { DashboardChannelKey } from "@/lib/dashboardChannels";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { ChannelResourcePhase } from "./channelResourcePhase";
import type { GoogleBusinessLocation } from "@/lib/googleBusinessLocations";
import type { GmbVerificationStatus } from "@/lib/googleBusinessVerification";

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
  const [gmbLocations, setGmbLocations] = useState<GoogleBusinessLocation[]>([]);
  const [gmbAccountName, setGmbAccountName] = useState<string>("");
  const [gmbLocationName, setGmbLocationNameState] = useState<string>(() => typeof initialState?.gmbLocationName === "string" ? initialState.gmbLocationName : "");
  const currentLocationRef = useRef(gmbLocationName);
  const hydrationGenerationRef = useRef(0);
  const [unavailableSelection, setUnavailableSelection] = useState<{ scope: string | null; locationName: string } | null>(null);
  const [completeListing, setCompleteListing] = useState<{ scope: string | null; complete: boolean } | null>(null);
  const [verification, setVerification] = useState<{ scope: string | null; locationName: string; status: GmbVerificationStatus }>(() => ({
    scope: getActiveBrowserUserId(), locationName: gmbLocationName,
    status: ["verified", "pending", "required", "restricted"].includes(initialState?.gmbVerificationStatus) ? initialState?.gmbVerificationStatus : "unknown",
  }));
  const currentScope = getActiveBrowserUserId();
  const gmbLocationUnavailable = unavailableSelection?.scope === currentScope && unavailableSelection?.locationName === gmbLocationName;
  const gmbLocationsComplete = completeListing?.scope === currentScope && completeListing?.complete === true;
  const gmbVerificationStatus: GmbVerificationStatus = verification.scope === currentScope && verification.locationName === gmbLocationName ? verification.status : "unknown";
  const setGmbLocationUnavailable = useCallback((unavailable: boolean) => {
    setUnavailableSelection(unavailable ? { scope: getActiveBrowserUserId(), locationName: currentLocationRef.current } : null);
  }, []);
  const setGmbLocationsComplete = useCallback((complete: boolean) => {
    setCompleteListing({ scope: getActiveBrowserUserId(), complete });
  }, []);
  const setGmbVerificationStatus = useCallback((status: GmbVerificationStatus) => {
    const scope = getActiveBrowserUserId();
    const locationName = currentLocationRef.current;
    setVerification(previous => status === "unknown" && previous.scope === scope && previous.locationName === locationName && previous.status === "pending"
      ? previous // A temporary failure cannot claim Google has validated it.
      : { scope, locationName, status });
  }, []);
  const setGmbLocationName = useCallback((value: string) => {
    // Even the same resource can belong to a newer canonical OAuth snapshot.
    hydrationGenerationRef.current += 1;
    currentLocationRef.current = value;
    setGmbLocationNameState(value);
    setUnavailableSelection(null);
  }, []);
  const [gmbLocationLabel, setGmbLocationLabel] = useState<string>(() => typeof initialState?.gmbLocationLabel === "string" ? initialState.gmbLocationLabel : "");
  const [gmbLoadingList, setGmbLoadingList] = useState(false);
  const [gmbLocationsPhase, setGmbLocationsPhase] = useState<ChannelResourcePhase>("idle");
  const [gmbListError, setGmbListError] = useState<string | null>(null);
  const gmbLocationsAutoLoadRef = useRef(false);

  const connectionRevisionRef = useRef(0);
  const selectionIntentRef = useRef(0);
  const locationsInFlightRef = useRef<{
    accountScope: string | null;
    revision: number;
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
    setGmbLocationUnavailable(false);
    setGmbLocationsComplete(false);
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
  }, [patchChannelConnectionLocally, setGmbLocationName, setGmbLocationUnavailable, setGmbLocationsComplete, setPanelError, setPanelSuccess, triggerChannelRefresh]);

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
    setGmbLocationUnavailable(false);
    setGmbLocationsComplete(false);
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
  }, [patchChannelConnectionLocally, setGmbLocationName, setGmbLocationUnavailable, setGmbLocationsComplete, setPanelError, setPanelSuccess, triggerChannelRefresh]);

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
        setGmbLocationUnavailable(false);
        setGmbLocationName(locationName);
        setGmbVerificationStatus("unknown");
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
  }, [patchChannelConnectionLocally, setGmbLocationName, setGmbLocationUnavailable, setGmbVerificationStatus, setPanelError, setPanelSuccess, triggerChannelRefresh]);

  const loadGmbAccountsAndLocations = useCallback((options?: { autoSelect?: boolean; afterOAuth?: boolean; refreshVerification?: boolean }): Promise<void> => {
    // The locations route validates the Google connection. After an OAuth
    // return, start discovery without waiting for dashboard hydration.
    if (!gmbAccountConnected && !options?.afterOAuth) return Promise.resolve();
    const revision = connectionRevisionRef.current;
    const accountScope = getActiveBrowserUserId();
    const existing = locationsInFlightRef.current;
    if (existing?.accountScope === accountScope && existing.revision === revision) {
      return existing.promise;
    }
    setGmbLoadingList(true);
    setGmbLocationsPhase("searching");
    setGmbListError(null);
    setGmbLocationsComplete(false);
    const selectionIntent = selectionIntentRef.current;
    const hydrationGeneration = hydrationGenerationRef.current;
    const isCurrentScope = () => revision === connectionRevisionRef.current && accountScope === getActiveBrowserUserId();
    const isCurrent = () => isCurrentScope() && selectionIntent === selectionIntentRef.current;
    const operation = { accountScope, revision, promise: Promise.resolve() };
    operation.promise = (async () => {
      try {
        const response = await fetch(options?.refreshVerification ? "/api/integrations/google-business/locations?refreshVerification=1" : "/api/integrations/google-business/locations", { cache: "no-store" });
        if (!response.ok) throw new Error(await getSimpleFrenchApiError(response, "Impossible de charger les établissements Google Business."));
        const payload = await response.json().catch(() => ({}));
        if (!isCurrent()) return;
        const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
        const locations = Array.isArray(payload.locations) ? payload.locations : [];
        setGmbAccounts(accounts);
        setGmbAccountName(payload.accountName || "");
        setGmbLocations(locations);
        setGmbLocationsComplete(payload.complete === true);
        const validation = payload.selectionValidation;
        const matchesCurrentSelection = hydrationGeneration === hydrationGenerationRef.current && typeof validation?.locationName === "string" && validation.locationName === currentLocationRef.current;
        if (validation?.status === "invalid" && validation.cleared === true && payload.complete === true && matchesCurrentSelection) {
          setGmbLocationUnavailable(true);
          setGmbConfigured(false);
          setGmbConnected(false);
          setGmbConnectionStatus("disconnected");
          setGmbUrl("");
          setGmbVerificationStatus("unknown");
          patchChannelConnectionLocally("gmb", {
            connected: false, accountConnected: true, configured: false,
            expired: false, resourceId: null, resourceLabel: null, resourceUrl: null,
          }, { clearData: true, clearError: true });
          void triggerChannelRefresh("gmb").catch(() => {});
        } else if (validation?.status === "valid" || validation?.status === "unselected") {
          setGmbLocationUnavailable(false);
        }
        const verificationState = payload.verification;
        if (validation?.status === "valid" && matchesCurrentSelection && verificationState?.locationName === currentLocationRef.current) {
          const status: GmbVerificationStatus = ["verified", "pending", "required", "restricted"].includes(verificationState.status) ? verificationState.status : "unknown";
          setGmbVerificationStatus(status);
          if (verificationState.clearedStatsReconnect === true) {
            setGmbConnectionStatus("connected");
            patchChannelConnectionLocally("gmb", { connectionStatus: "connected" }, { clearError: true });
          }
        }
        if (payload.locationsError) setGmbListError(payload.locationsError);
        // Discovery only reads. Even one returned establishment needs an explicit choice.
      } catch (error) {
        if (isCurrent()) setGmbListError(getSimpleFrenchErrorMessage(error, "Impossible de charger les établissements Google Business."));
      } finally {
        const ownsRequest = locationsInFlightRef.current === operation;
        if (ownsRequest) locationsInFlightRef.current = null;
        if (ownsRequest && isCurrentScope()) {
          setGmbLoadingList(false);
          setGmbLocationsPhase("idle");
        }
      }
    })();
    locationsInFlightRef.current = operation;
    return operation.promise;
  }, [gmbAccountConnected, patchChannelConnectionLocally, setGmbLocationUnavailable, setGmbLocationsComplete, setGmbVerificationStatus, triggerChannelRefresh]);

  const refreshGmbVerification = useCallback((): Promise<void> => {
    if (gmbVerificationStatus !== "pending" || !gmbAccountConnected || !gmbConfigured || gmbConnectionStatus !== "connected") return Promise.resolve();
    return loadGmbAccountsAndLocations({ refreshVerification: true });
  }, [gmbAccountConnected, gmbConfigured, gmbConnectionStatus, gmbVerificationStatus, loadGmbAccountsAndLocations]);

  useEffect(() => {
    if (gmbVerificationStatus !== "pending" || !gmbAccountConnected || !gmbConfigured || gmbConnectionStatus !== "connected") return;
    const accountScope = getActiveBrowserUserId();
    // Opening the app reuses Google's five-hour evidence cache. Subsequent
    // automatic checks run only while pending; a user can refresh immediately.
    void loadGmbAccountsAndLocations();
    const timer = window.setInterval(() => {
      if (accountScope === getActiveBrowserUserId()) void refreshGmbVerification();
    }, 5 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [gmbAccountConnected, gmbConfigured, gmbConnectionStatus, gmbVerificationStatus, loadGmbAccountsAndLocations, refreshGmbVerification]);

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
    if (!selectedLocationName) return Promise.resolve(false);
    const picked = gmbLocations.find(location => location.name === selectedLocationName);
    const accountName = picked?.accountName || gmbAccountName;
    if (!accountName || !picked) return Promise.resolve(false);
    return persistGmbLocation(accountName, selectedLocationName, picked.title || null);
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
    gmbLocationsComplete,
    gmbLocationUnavailable,
    gmbVerificationStatus,
    setGmbVerificationStatus,
    refreshGmbVerification,
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
