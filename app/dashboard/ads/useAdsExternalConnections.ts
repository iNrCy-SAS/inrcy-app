"use client";
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AdsChannelId } from "@/lib/adsValidation";
import type { AdsConnectionSnapshot, AdsConnectionSnapshots } from "@/lib/adsConnectionSnapshot";
import { readJson, readAdsConnectionStatus } from "./adsClientHttp";
export const EXTERNAL_CHANNELS = ["linkedin", "tiktok", "pinterest", "x"] as const;
export type ExternalChannelId = (typeof EXTERNAL_CHANNELS)[number];
export type ExternalAdsAccount = {
  id: string;
  name: string;
  currency?: string | null;
  status?: string;
  eligibleToAssociate?: boolean | null;
  canManageCampaigns?: boolean;
  canServeCampaigns?: boolean;
};
type ExternalAccountsCacheEntry = {
  accounts: ExternalAdsAccount[];
  choice: string;
  loaded: boolean;
  failed: boolean;
};
export type ExternalConnectorStatus = {
  load: "idle" | "loading" | "ready" | "error";
  configured: boolean;
  connected: boolean;
  status: string;
  selectedAccountId: string;
  selectedAccountName: string;
  scopes?: string[];
  missingScopes?: string[];
  selectedAccountCanManage?: boolean;
  selectedAccountCanServe?: boolean;
  publicationEnabled?: boolean;
  error: string;
};
export function isExternalChannel(value: unknown): value is ExternalChannelId {
  return typeof value === "string" && EXTERNAL_CHANNELS.some((channel) => channel === value);
}
function externalStatusFromSnapshot(snapshot: AdsConnectionSnapshot): ExternalConnectorStatus {
  return {
    load: snapshot.status === "unknown" ? "idle" : "ready",
    configured: true,
    connected: snapshot.status === "connected",
    status: snapshot.status,
    selectedAccountId: snapshot.accountId,
    selectedAccountName: snapshot.accountLabel,
    selectedAccountCanManage: false,
    selectedAccountCanServe: false,
    publicationEnabled: false,
    error: "",
  };
}
const EXTERNAL_DISCONNECT_CHANNELS: readonly ExternalChannelId[] = ["linkedin", "pinterest", "tiktok", "x"];
/** Owns provider discovery state and request revisions; the screen owns navigation triggers. */
export default function useAdsExternalConnections({ initialChannel, initialConnections, setConnectionSnapshots }: {
  initialChannel: AdsChannelId;
  initialConnections: AdsConnectionSnapshots;
  setConnectionSnapshots: Dispatch<SetStateAction<AdsConnectionSnapshots>>;
}) {
  const [externalStatuses, setExternalStatuses] = useState<Record<ExternalChannelId, ExternalConnectorStatus>>({
    linkedin: externalStatusFromSnapshot(initialConnections.linkedin), tiktok: externalStatusFromSnapshot(initialConnections.tiktok),
    pinterest: externalStatusFromSnapshot(initialConnections.pinterest), x: externalStatusFromSnapshot(initialConnections.x),
  });
  const [externalAccounts, setExternalAccounts] = useState<ExternalAdsAccount[]>([]);
  const [externalAccountChoice, setExternalAccountChoice] = useState(initialConnections[initialChannel].accountId);
  const [externalAccountsLoading, setExternalAccountsLoading] = useState(false);
  const [externalAccountsLoadFailed, setExternalAccountsLoadFailed] = useState(false);
  const [externalAction, setExternalAction] = useState<"associate" | "disconnect" | null>(null);
  const [externalError, setExternalError] = useState("");
  const externalAccountsRequest = useRef(0);
  const externalAccountsCache = useRef<Record<ExternalChannelId, ExternalAccountsCacheEntry>>({
    linkedin: { accounts: [], choice: initialConnections.linkedin.accountId, loaded: false, failed: false },
    pinterest: { accounts: [], choice: initialConnections.pinterest.accountId, loaded: false, failed: false },
    tiktok: { accounts: [], choice: initialConnections.tiktok.accountId, loaded: false, failed: false },
    x: { accounts: [], choice: initialConnections.x.accountId, loaded: false, failed: false },
  });
  const externalStatusRequests = useRef<Record<ExternalChannelId, number>>({ linkedin: 0, pinterest: 0, tiktok: 0, x: 0 });
  const refreshExternalStatus = useCallback(async (channel: ExternalChannelId, options?: {
    silent?: boolean;
  }) => {
    const requestId = ++externalStatusRequests.current[channel];
    setExternalStatuses((current) => ({
      ...current,
      [channel]: {
        ...current[channel],
        load: options?.silent && current[channel].load === "ready" ? "ready" : "loading",
        publicationEnabled: channel === "linkedin" ? false : current[channel].publicationEnabled,
        error: "",
      },
    }));
    try {
      const data = await readAdsConnectionStatus(await fetch(`/api/ads/${channel}/status`, { cache: "no-store" }));
      if (requestId !== externalStatusRequests.current[channel])
        return;
      const status = typeof data.status === "string" ? data.status : "disconnected";
      const selectedAccountId = typeof data.selectedAccountId === "string" ? data.selectedAccountId : "";
      const selectedAccountName = typeof data.selectedAccountName === "string" ? data.selectedAccountName
        : typeof data.selectedAccountLabel === "string" ? data.selectedAccountLabel : "";
      const scopes = Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [];
      const missingScopes = Array.isArray(data.missingScopes) ? data.missingScopes.filter((scope): scope is string => typeof scope === "string") : [];
      setExternalStatuses((current) => ({
        ...current,
        [channel]: {
          load: "ready",
          configured: data.configured !== false && status !== "not_configured" && status !== "configuration_missing",
          connected: data.connected === true,
          status,
          selectedAccountId,
          selectedAccountName,
          scopes,
          missingScopes,
          selectedAccountCanManage: data.selectedAccountCanManage === true,
          selectedAccountCanServe: data.selectedAccountCanServe === true,
          publicationEnabled: data.publicationEnabled === true,
          error: "",
        },
      }));
      setConnectionSnapshots((current) => ({ ...current, [channel]: {
          status: status === "connected" ? "connected" : status === "needs_update" || status === "needs_reconnect" ? "needs_update" : "disconnected",
          accountId: selectedAccountId,
          accountLabel: selectedAccountName,
          pageId: "",
        } }));
    }
    catch (error) {
      if (requestId !== externalStatusRequests.current[channel])
        return;
      setExternalStatuses((current) => ({
        ...current,
        [channel]: { ...current[channel], load: "error", error: error instanceof Error ? error.message : "État indisponible." },
      }));
    }
  }, [setConnectionSnapshots]);
  const loadExternalAccounts = useCallback(async (channel: ExternalChannelId, persistedAccountId: string, force = false) => {
    const cached = externalAccountsCache.current[channel];
    if (cached.loaded && !force) {
      setExternalAccounts(cached.accounts);
      setExternalAccountChoice(cached.choice || persistedAccountId);
      setExternalAccountsLoadFailed(cached.failed);
      setExternalAccountsLoading(false);
      return;
    }
    const requestId = ++externalAccountsRequest.current;
    setExternalAccountsLoading(true);
    setExternalAccountsLoadFailed(false);
    try {
      const data = await readJson(await fetch(`/api/ads/${channel}/accounts`, { cache: "no-store" }));
      if (requestId !== externalAccountsRequest.current)
        return;
      const nextAccounts = Array.isArray(data.accounts)
        ? data.accounts.filter((account): account is ExternalAdsAccount => account && typeof account === "object" && typeof account.id === "string" && typeof account.name === "string")
        : [];
      const storedChoice = externalAccountsCache.current[channel].choice;
      const nextChoice = nextAccounts.some((account) => account.id === storedChoice)
        ? storedChoice : typeof data.selectedAccountId === "string" ? data.selectedAccountId : persistedAccountId;
      externalAccountsCache.current[channel] = { accounts: nextAccounts, choice: nextChoice, loaded: true, failed: false };
      setExternalAccounts(nextAccounts);
      setExternalAccountChoice(nextChoice);
      setExternalStatuses((current) => ({
        ...current,
        [channel]: {
          ...current[channel],
          selectedAccountCanManage: data.selectedAccountCanManage === true,
          selectedAccountCanServe: data.selectedAccountCanServe === true,
          // Account discovery does not own LinkedIn's rollout authorization.
          publicationEnabled: channel === "linkedin"
            ? current[channel].publicationEnabled
            : data.publicationEnabled === true,
        },
      }));
      setExternalError("");
    }
    catch (error) {
      if (requestId === externalAccountsRequest.current) {
        externalAccountsCache.current[channel] = { ...cached, failed: true };
        setExternalAccountsLoadFailed(true);
        setExternalError(error instanceof Error ? error.message : "Comptes indisponibles.");
        void refreshExternalStatus(channel, { silent: true });
      }
    }
    finally {
      if (requestId === externalAccountsRequest.current)
        setExternalAccountsLoading(false);
    }
  }, [refreshExternalStatus]);
  async function associateExternalAccount(channelId: AdsChannelId) {
    if (!isExternalChannel(channelId) || !externalAccountChoice || externalAction)
      return;
    setExternalAction("associate");
    setExternalError("");
    try {
      await readJson(await fetch(`/api/ads/${channelId}/accounts`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: externalAccountChoice }),
      }));
      externalAccountsCache.current[channelId] = {
        ...externalAccountsCache.current[channelId],
        choice: externalAccountChoice,
      };
      await refreshExternalStatus(channelId);
    }
    catch (error) {
      setExternalError(error instanceof Error ? error.message : "Association impossible.");
    }
    finally {
      setExternalAction(null);
    }
  }
  async function disconnectExternalChannel(channelId: AdsChannelId) {
    if (!isExternalChannel(channelId) || !EXTERNAL_DISCONNECT_CHANNELS.includes(channelId) || externalAction)
      return;
    setExternalAction("disconnect");
    setExternalError("");
    try {
      await readJson(await fetch(`/api/ads/${channelId}/disconnect`, { method: "POST" }));
      externalAccountsCache.current[channelId] = { accounts: [], choice: "", loaded: false, failed: false };
      setExternalAccounts([]);
      setExternalAccountChoice("");
      await refreshExternalStatus(channelId);
    }
    catch (error) {
      setExternalError(error instanceof Error ? error.message : "Déconnexion impossible.");
    }
    finally {
      setExternalAction(null);
    }
  }
  const clearExternalAccountsCache = useCallback((channel: ExternalChannelId) => {
    externalAccountsCache.current[channel] = { accounts: [], choice: "", loaded: false, failed: false };
  }, []);
  const cancelExternalAccountsLoad = useCallback(() => { externalAccountsRequest.current += 1; }, []);
  const stopExternalAccountsLoading = useCallback(() => { setExternalAccountsLoading(false); }, []);
  function hydrateExternalChannel(next: ExternalChannelId, locked: boolean) {
    const cached = externalAccountsCache.current[next];
    setExternalAccounts(locked ? [] : cached.accounts);
    setExternalAccountChoice(locked ? "" : cached.choice || externalStatuses[next].selectedAccountId);
    setExternalAccountsLoadFailed(!locked && cached.failed);
    setExternalAccountsLoading(!locked && externalStatuses[next].connected && !cached.loaded);
    setExternalError("");
  }
  function selectExternalAccount(channel: ExternalChannelId, id: string) {
    externalAccountsCache.current[channel].choice = id;
    setExternalAccountChoice(id);
  }
  function mergeExternalStatus(channel: ExternalChannelId, status: Partial<ExternalConnectorStatus>) {
    setExternalStatuses((current) => ({ ...current, [channel]: { ...current[channel], ...status } }));
  }
  return {
    externalStatuses, externalAccounts, externalAccountChoice, externalAccountsLoading,
    externalAccountsLoadFailed, externalAction, externalError, setExternalError,
    refreshExternalStatus, loadExternalAccounts, associateExternalAccount, disconnectExternalChannel,
    clearExternalAccountsCache, cancelExternalAccountsLoad, stopExternalAccountsLoading,
    hydrateExternalChannel, selectExternalAccount, mergeExternalStatus,
    externalAccountsLoaded: (channel: ExternalChannelId) => externalAccountsCache.current[channel].loaded,
  };
}
