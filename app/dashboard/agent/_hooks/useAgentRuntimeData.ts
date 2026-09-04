"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  readAccountCacheValue,
  writeAccountCacheValue,
} from "@/lib/browserAccountCache";
import {
  INR_AGENT_DEFAULT_SETTINGS,
  sanitizeInrAgentSettings,
  type InrAgentSettings,
} from "@/lib/inrAgentSettings";
import type {
  AgentActionsResponse,
  AgentPreparedAction,
  AgentScheduledAction,
  CachedAgentViewSnapshot,
  ConnectedChannelMap,
  LoadState,
  ActionsLoadState,
  SaveState,
  ScheduledActionsResponse,
} from "../_lib/agent.types";
import {
  DASHBOARD_CHANNEL_STATE_CACHE_KEY,
  INR_AGENT_VIEW_CACHE_KEY,
  INR_AGENT_VIEW_CACHE_MAX_AGE_MS,
} from "../_lib/agent.config";
import {
  isCachedPreparedAction,
  isCachedScheduledAction,
  normalizeConfigsForConnectedChannels,
  sanitizeCachedConnectedChannels,
  settingsToConfigs,
} from "../_lib/agent.settings";
import { asRecord } from "../_lib/agent.utils";
import type { AutomationConfig, AutomationKey } from "../_lib/agent.types";
import {
  filterStandardAgentItems,
  restrictInrAgentSettingsForStandard,
} from "@/lib/standardAgentPolicy";

function channelMapFromConnectionStates(payload: unknown): ConnectedChannelMap {
  const states = asRecord(payload) || {};
  const isUsable = (key: string) => {
    const state = asRecord(states[key]) || {};
    return Boolean(state.connected) && state.requiresUpdate !== true;
  };

  return {
    siteInrcy: isUsable("site_inrcy"),
    siteWeb: isUsable("site_web"),
    gmb: isUsable("gmb"),
    inrSearch: isUsable("inr_search"),
    facebook: isUsable("facebook"),
    instagram: isUsable("instagram"),
    linkedin: isUsable("linkedin"),
    tiktok: isUsable("tiktok"),
    youtube: isUsable("youtube_shorts"),
    pinterest: isUsable("pinterest"),
    mails: isUsable("mails"),
  };
}

function readCachedAgentConnectedChannels(): ConnectedChannelMap | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = readAccountCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const parsedRecord = asRecord(parsed);
    const nestedState = asRecord(parsedRecord?.state);
    const state = nestedState || parsedRecord;
    if (!state) return null;
    const hasConnectionHint = [
      "siteInrcySavedUrl",
      "siteInrcyUrl",
      "siteWebSavedUrl",
      "siteWebUrl",
      "gmbConnected",
      "inrSearchConnected",
      "facebookPageConnected",
      "instagramConnected",
      "linkedinConnected",
      "tiktokConnected",
      "youtubeShortsConnected",
      "pinterestConnected",
      "mailAccountsConnectedCount",
    ].some((key) => Object.prototype.hasOwnProperty.call(state, key));
    if (!hasConnectionHint) return null;

    return {
      siteInrcy: Boolean(state.siteInrcySavedUrl || state.siteInrcyUrl),
      siteWeb: Boolean(state.siteWebSavedUrl || state.siteWebUrl),
      gmb: Boolean(
        state.gmbConnected && state.gmbConnectionStatus !== "needs_update",
      ),
      inrSearch: Boolean(state.inrSearchConnected),
      facebook: Boolean(
        state.facebookPageConnected &&
          state.facebookConnectionStatus !== "needs_update",
      ),
      instagram: Boolean(
        state.instagramConnected &&
          state.instagramConnectionStatus !== "needs_update",
      ),
      linkedin: Boolean(
        state.linkedinConnected &&
          state.linkedinConnectionStatus !== "needs_update",
      ),
      tiktok: Boolean(state.tiktokConnected),
      youtube: Boolean(state.youtubeShortsConnected),
      pinterest: Boolean(state.pinterestConnected),
      mails:
        Math.max(0, Math.round(Number(state.mailAccountsConnectedCount) || 0)) >
        0,
    };
  } catch {
    return null;
  }
}

function readCachedAgentViewSnapshot(): CachedAgentViewSnapshot | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = readAccountCacheValue(INR_AGENT_VIEW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedAgentViewSnapshot>;
    const savedAt = Number(parsed?.savedAt || 0);
    if (
      parsed?.version !== 1 ||
      !Number.isFinite(savedAt) ||
      Date.now() - savedAt > INR_AGENT_VIEW_CACHE_MAX_AGE_MS
    ) {
      return null;
    }

    const settings = parsed.settings
      ? sanitizeInrAgentSettings(parsed.settings)
      : undefined;
    const connectedChannels = sanitizeCachedConnectedChannels(
      parsed.connectedChannels,
    );
    const actions = Array.isArray(parsed.actions)
      ? parsed.actions.filter(isCachedPreparedAction).slice(0, 120)
      : undefined;
    const scheduledActions = Array.isArray(parsed.scheduledActions)
      ? parsed.scheduledActions.filter(isCachedScheduledAction).slice(0, 80)
      : undefined;

    if (
      !settings &&
      !connectedChannels &&
      !actions?.length &&
      !scheduledActions?.length
    ) {
      return null;
    }

    return {
      version: 1,
      savedAt,
      settings,
      connectedChannels: connectedChannels || undefined,
      actions,
      scheduledActions,
      tableMissing: Boolean(parsed.tableMissing),
      scheduledActionsTableMissing: Boolean(
        parsed.scheduledActionsTableMissing,
      ),
    };
  } catch {
    return null;
  }
}

export function writeCachedAgentViewSnapshot(
  patch: Partial<Omit<CachedAgentViewSnapshot, "version" | "savedAt">>,
) {
  if (typeof window === "undefined") return;

  try {
    const current = readCachedAgentViewSnapshot();
    const next: CachedAgentViewSnapshot = {
      version: 1,
      savedAt: Date.now(),
      settings: patch.settings ?? current?.settings,
      connectedChannels:
        patch.connectedChannels ?? current?.connectedChannels,
      actions: (patch.actions ?? current?.actions ?? []).slice(0, 120),
      scheduledActions: (
        patch.scheduledActions ??
        current?.scheduledActions ??
        []
      ).slice(0, 80),
      tableMissing: patch.tableMissing ?? current?.tableMissing ?? false,
      scheduledActionsTableMissing:
        patch.scheduledActionsTableMissing ??
        current?.scheduledActionsTableMissing ??
        false,
    };

    writeAccountCacheValue(INR_AGENT_VIEW_CACHE_KEY, JSON.stringify(next));
  } catch {
    // Le cache ne doit jamais bloquer l'interface iNrAgent.
  }
}

export async function warmAgentRuntimeSnapshot() {
  if (typeof window === "undefined") return;
  const cached = readCachedAgentViewSnapshot();

  const readJson = async (url: string) => {
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (!response.ok) return null;
    return response.json().catch(() => null);
  };

  const [settingsResult, channelsResult, actionsResult, scheduledResult] = await Promise.allSettled([
    cached?.settings ? Promise.resolve(null) : readJson("/api/agent/settings"),
    cached?.connectedChannels ? Promise.resolve(null) : readJson("/api/integrations/channel-states"),
    Array.isArray(cached?.actions) ? Promise.resolve(null) : readJson("/api/agent/actions"),
    Array.isArray(cached?.scheduledActions) ? Promise.resolve(null) : readJson("/api/agent/scheduled-actions"),
  ]);

  const settingsPayload = settingsResult.status === "fulfilled" ? settingsResult.value : null;
  if (settingsPayload?.settings) {
    writeCachedAgentViewSnapshot({
      settings: sanitizeInrAgentSettings(settingsPayload.settings),
      tableMissing: Boolean(settingsPayload.tableMissing),
    });
  }

  const channelsPayload = channelsResult.status === "fulfilled" ? channelsResult.value : null;
  if (channelsPayload) {
    writeCachedAgentViewSnapshot({ connectedChannels: channelMapFromConnectionStates(channelsPayload) });
  }

  const actionsPayload = actionsResult.status === "fulfilled" ? actionsResult.value : null;
  if (Array.isArray(actionsPayload?.actions)) {
    writeCachedAgentViewSnapshot({
      actions: actionsPayload.actions,
      tableMissing: Boolean(actionsPayload.tableMissing),
    });
  }

  const scheduledPayload = scheduledResult.status === "fulfilled" ? scheduledResult.value : null;
  if (Array.isArray(scheduledPayload?.scheduledActions)) {
    writeCachedAgentViewSnapshot({
      scheduledActions: scheduledPayload.scheduledActions,
      scheduledActionsTableMissing: Boolean(scheduledPayload.tableMissing),
    });
  }
}

export function useAgentRuntimeData({
  standardMode = false,
}: {
  standardMode?: boolean;
} = {}) {
  const i18nT = useTranslations("agent");
  // The server and the browser must produce the same first render. Browser
  // caches are restored immediately after hydration, then refreshed from the
  // authoritative APIs in the background.
  const deterministicInitialSettings = standardMode
    ? restrictInrAgentSettingsForStandard(INR_AGENT_DEFAULT_SETTINGS)
    : INR_AGENT_DEFAULT_SETTINGS;
  const cachedAgentSnapshotRef = useRef<CachedAgentViewSnapshot | null>(null);

  const [agentSettings, setAgentSettings] = useState<InrAgentSettings>(
    deterministicInitialSettings,
  );
  const [configs, setConfigs] = useState<
    Record<AutomationKey, AutomationConfig>
  >(() => settingsToConfigs(deterministicInitialSettings));
  const [agentConnectedChannels, setAgentConnectedChannels] =
    useState<ConnectedChannelMap | null>(null);
  const [connectedChannelsLoadState, setConnectedChannelsLoadState] =
    useState<LoadState>("loading");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [tableMissing, setTableMissing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actions, setActions] = useState<AgentPreparedAction[]>([]);
  const [scheduledActions, setScheduledActions] = useState<
    AgentScheduledAction[]
  >([]);
  const [scheduledActionsTableMissing, setScheduledActionsTableMissing] =
    useState(false);
  const [actionsLoadState, setActionsLoadState] =
    useState<ActionsLoadState>("loading");

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  }

  useEffect(() => {
    const cachedSnapshot = readCachedAgentViewSnapshot();
    const cachedConnectedChannels =
      cachedSnapshot?.connectedChannels ?? readCachedAgentConnectedChannels();
    cachedAgentSnapshotRef.current = cachedSnapshot;

    if (cachedSnapshot?.settings) {
      const nextSettings = standardMode
        ? restrictInrAgentSettingsForStandard(cachedSnapshot.settings)
        : cachedSnapshot.settings;
      setAgentSettings(nextSettings);
      setConfigs(settingsToConfigs(nextSettings));
      setLoadState("ready");
    }

    if (cachedConnectedChannels) {
      setAgentConnectedChannels(cachedConnectedChannels);
      setConnectedChannelsLoadState("ready");
    }

    if (Array.isArray(cachedSnapshot?.actions)) {
      setActions(
        standardMode
          ? filterStandardAgentItems(cachedSnapshot.actions)
          : cachedSnapshot.actions,
      );
      setActionsLoadState("ready");
    }

    if (Array.isArray(cachedSnapshot?.scheduledActions)) {
      setScheduledActions(
        standardMode
          ? filterStandardAgentItems(cachedSnapshot.scheduledActions)
          : cachedSnapshot.scheduledActions,
      );
    }

    setTableMissing(Boolean(cachedSnapshot?.tableMissing));
    setScheduledActionsTableMissing(
      Boolean(cachedSnapshot?.scheduledActionsTableMissing),
    );
  }, [standardMode]);

  useEffect(() => {
    let alive = true;

    async function loadSettings() {
      setLoadState((current) => (current === "ready" ? current : "loading"));

      try {
        const response = await fetch("/api/agent/settings", {
          method: "GET",
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as {
          settings?: Partial<InrAgentSettings>;
          error?: string;
          tableMissing?: boolean;
        } | null;

        if (!alive) return;

        if (!response.ok) {
          throw new Error(
            payload?.error || i18nT("agent_settings_unavailable"),
          );
        }

        const sanitizedSettings = sanitizeInrAgentSettings(payload?.settings);
        const nextSettings = standardMode
          ? restrictInrAgentSettingsForStandard(sanitizedSettings)
          : sanitizedSettings;
        setAgentSettings(nextSettings);
        setConfigs(settingsToConfigs(nextSettings));
        setTableMissing((current) => current || Boolean(payload?.tableMissing));
        setLoadState("ready");
        writeCachedAgentViewSnapshot({
          settings: nextSettings,
          tableMissing: Boolean(payload?.tableMissing),
        });
      } catch (error) {
        if (!alive) return;
        setLoadState((current) => (current === "ready" ? current : "error"));
        if (!cachedAgentSnapshotRef.current?.settings) {
          setNotice(i18nT("agent_settings_unavailable"));
          window.setTimeout(() => setNotice(null), 2600);
        }
      }
    }

    loadSettings();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadConnectedChannels() {
      setConnectedChannelsLoadState((current) =>
        current === "ready" ? current : "loading",
      );
      try {
        const response = await fetch("/api/integrations/channel-states", {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!alive) return;
        if (!response.ok) {
          throw new Error(i18nT("agent_channels_unavailable"));
        }

        const nextConnectedChannels = channelMapFromConnectionStates(payload);
        setAgentConnectedChannels(nextConnectedChannels);
        setConnectedChannelsLoadState("ready");
        writeCachedAgentViewSnapshot({
          connectedChannels: nextConnectedChannels,
        });
      } catch {
        if (!alive) return;
        setAgentConnectedChannels((current) => current ?? null);
        setConnectedChannelsLoadState((current) =>
          current === "ready" ? current : "error",
        );
      }
    }

    loadConnectedChannels();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!agentConnectedChannels || loadState === "loading") return;
    setConfigs((current) =>
      normalizeConfigsForConnectedChannels(current, agentConnectedChannels),
    );
  }, [agentConnectedChannels, loadState]);

  async function refreshActions(silent = false) {
    if (!silent) {
      setActionsLoadState((current) =>
        current === "ready" ? current : "loading",
      );
    }

    try {
      const response = await fetch("/api/agent/actions", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as AgentActionsResponse | null;

      if (!response.ok) {
        throw new Error(payload?.error || i18nT("agent_actions_unavailable"));
      }

      const loadedActions = Array.isArray(payload?.actions)
        ? payload.actions
        : [];
      const nextActions = standardMode
        ? filterStandardAgentItems(loadedActions)
        : loadedActions;
      const nextTableMissing = Boolean(payload?.tableMissing);
      setActions(nextActions);
      if (payload?.tableMissing) setTableMissing(true);
      setActionsLoadState("ready");
      writeCachedAgentViewSnapshot({
        actions: nextActions,
        tableMissing: nextTableMissing,
      });
    } catch (error) {
      setActionsLoadState((current) =>
        current === "ready" ? current : "error",
      );
      if (
        !silent &&
        actionsLoadState !== "ready" &&
        !Array.isArray(cachedAgentSnapshotRef.current?.actions)
      ) {
        showNotice(i18nT("agent_actions_unavailable"));
      }
    }
  }

  async function refreshScheduledActions(silent = false) {
    try {
      const response = await fetch("/api/agent/scheduled-actions", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as ScheduledActionsResponse | null;

      if (!response.ok) {
        throw new Error(
          payload?.error || i18nT("scheduled_actions_unavailable"),
        );
      }

      const loadedScheduledActions = Array.isArray(payload?.scheduledActions)
        ? payload.scheduledActions
        : [];
      const nextScheduledActions = standardMode
        ? filterStandardAgentItems(loadedScheduledActions)
        : loadedScheduledActions;
      const nextScheduledTableMissing = Boolean(payload?.tableMissing);
      setScheduledActions(nextScheduledActions);
      setScheduledActionsTableMissing(nextScheduledTableMissing);
      writeCachedAgentViewSnapshot({
        scheduledActions: nextScheduledActions,
        scheduledActionsTableMissing: nextScheduledTableMissing,
      });
    } catch (error) {
      if (!silent) {
        showNotice(i18nT("scheduled_actions_unavailable"));
      }
    }
  }

  useEffect(() => {
    void refreshActions();
    void refreshScheduledActions(true);
  }, []);

  useEffect(() => {
    const hasEditorialPreparation = actions.some((action) => {
      const editorialPlan = asRecord(action.payload?.editorialPlan);
      return (
        action.automationKey === "publish" &&
        Boolean(editorialPlan) &&
        ["draft", "executing"].includes(action.status)
      );
    });
    if (!hasEditorialPreparation) return;
    const interval = window.setInterval(() => {
      void refreshActions(true);
    }, 12_000);
    return () => window.clearInterval(interval);
  }, [actions]);

  return {
    agentSettings,
    setAgentSettings,
    configs,
    setConfigs,
    agentConnectedChannels,
    setAgentConnectedChannels,
    connectedChannelsLoadState,
    setConnectedChannelsLoadState,
    loadState,
    setLoadState,
    saveState,
    setSaveState,
    tableMissing,
    setTableMissing,
    notice,
    setNotice,
    actions,
    setActions,
    scheduledActions,
    setScheduledActions,
    scheduledActionsTableMissing,
    setScheduledActionsTableMissing,
    actionsLoadState,
    setActionsLoadState,
    refreshActions,
    refreshScheduledActions,
    showNotice,
  };
}
