"use client";

import { useTranslations } from "next-intl";


import {
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  sanitizeInrAgentSettings,
  type InrAgentSettings,
} from "@/lib/inrAgentSettings";
import {
  inrAgentMonthlyDateCount,
  normalizeInrAgentMonthDays,
} from "@/lib/inrAgentMonthSchedule";
import type {
  AutomationConfig,
  AutomationKey,
  ConnectedChannelMap,
  PrepareActionState,
  PrepareNowConfirmState,
  PrepareProgressState,
  SaveState,
  StatsProgressState,
  AgentPreparedAction,
  EditorialPlanApplyMode,
  EditorialPlanQuotaImpact,
  LoadState,
} from "../_lib/agent.types";
import {
  automations,
  pendingActionStatuses,
} from "../_lib/agent.config";
import {
  configsToSettings,
  connectedChannelsForAutomation,
  normalizeConfigScheduleSlots,
  normalizeConfigsForConnectedChannels,
  settingsToConfigs,
} from "../_lib/agent.settings";
import {
  agentAutomationTitle,
  agentConnectedChannelMessage,
  type AgentTranslator,
} from "../_lib/agent.i18n";
import {
  prepareProgressLabel,
  statsProgressLabel,
} from "../_lib/agent.reports";
import { writeCachedAgentViewSnapshot } from "./useAgentRuntimeData";

type Setter<T> = Dispatch<SetStateAction<T>>;

type UseAgentAutomationControllerParams = {
  agentSettings: InrAgentSettings;
  setAgentSettings: Setter<InrAgentSettings>;
  configs: Record<AutomationKey, AutomationConfig>;
  setConfigs: Setter<Record<AutomationKey, AutomationConfig>>;
  agentConnectedChannels: ConnectedChannelMap | null;
  connectedChannelsLoadState: LoadState;
  saveState: SaveState;
  setSaveState: Setter<SaveState>;
  setTableMissing: Setter<boolean>;
  setNotice: Setter<string | null>;
  setSettingsKey: Setter<AutomationKey | null>;
  pendingActionsByAutomation: Record<AutomationKey, number>;
  setActions: Setter<AgentPreparedAction[]>;
  refreshActions: (silent?: boolean) => Promise<void>;
  setSelectedKey: Setter<AutomationKey>;
  showNotice: (message: string) => void;
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useAgentAutomationController({
  agentSettings,
  setAgentSettings,
  configs,
  setConfigs,
  agentConnectedChannels,
  connectedChannelsLoadState,
  saveState,
  setSaveState,
  setTableMissing,
  setNotice,
  setSettingsKey,
  pendingActionsByAutomation,
  setActions,
  refreshActions,
  setSelectedKey,
  showNotice,
}: UseAgentAutomationControllerParams) {
  const i18nT = useTranslations("agent");
  const runtimeT = i18nT as unknown as AgentTranslator;
  const [prepareActionState, setPrepareActionState] =
    useState<PrepareActionState>("idle");
  const [prepareProgress, setPrepareProgress] =
    useState<PrepareProgressState>(null);
  const [testNowKey, setTestNowKey] = useState<AutomationKey | null>(null);
  const [prepareNowConfirm, setPrepareNowConfirm] =
    useState<PrepareNowConfirmState>(null);
  const [statsProgress, setStatsProgress] = useState<StatsProgressState>(null);
  const [settingsPlanImpact, setSettingsPlanImpact] =
    useState<EditorialPlanQuotaImpact | null>(null);

  function updateConfig(key: AutomationKey, patch: Partial<AutomationConfig>) {
    setConfigs((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }));
    setSaveState("idle");
    setNotice(null);
  }

  function updateConfigFrequency(key: AutomationKey, frequency: string) {
    setConfigs((current) => {
      const currentConfig = current[key];
      const normalizedSlots = normalizeConfigScheduleSlots({
        ...currentConfig,
        frequency,
        scheduleSlots: currentConfig.scheduleSlots?.slice(0, 1),
      });
      const monthDays = normalizeInrAgentMonthDays(
        currentConfig.monthDays,
        frequency,
      );
      return {
        ...current,
        [key]: {
          ...currentConfig,
          frequency,
          scheduleSlots: normalizedSlots,
          monthDays,
          day: normalizedSlots[0].day,
          time: normalizedSlots[0].time,
        },
      };
    });
    setSaveState("idle");
    setNotice(null);
  }

  function updateConfigScheduleSlot(
    key: AutomationKey,
    index: number,
    patch: Partial<{ day: string; time: string }>,
  ) {
    setConfigs((current) => {
      const currentConfig = current[key];
      const slots = normalizeConfigScheduleSlots(currentConfig);
      slots[index] = { ...slots[index], ...patch };
      return {
        ...current,
        [key]: {
          ...currentConfig,
          scheduleSlots: slots,
          ...(index === 0 ? { day: slots[0].day, time: slots[0].time } : {}),
        },
      };
    });
    setSaveState("idle");
    setNotice(null);
  }

  function updateConfigMonthDay(
    key: AutomationKey,
    index: number,
    value: number,
  ) {
    setConfigs((current) => {
      const currentConfig = current[key];
      const count = inrAgentMonthlyDateCount(currentConfig.frequency);
      if (!count || index < 0 || index >= count) return current;
      const monthDays = normalizeInrAgentMonthDays(
        currentConfig.monthDays,
        currentConfig.frequency,
      );
      const day = Math.min(31, Math.max(1, Math.floor(Number(value)) || 1));
      if (monthDays.some((candidate, itemIndex) => itemIndex !== index && candidate === day)) {
        return current;
      }
      monthDays[index] = day;
      return {
        ...current,
        [key]: {
          ...currentConfig,
          monthDays: monthDays.sort((a, b) => a - b),
        },
      };
    });
    setSaveState("idle");
    setNotice(null);
  }

  async function persistSettings(
    options: {
      closeModal?: boolean;
      showSuccess?: boolean;
      editorialPlanApplyMode?: EditorialPlanApplyMode;
    } = {},
  ) {
    const {
      closeModal = true,
      showSuccess = true,
      editorialPlanApplyMode,
    } = options;
    const safeConfigs = agentConnectedChannels
      ? normalizeConfigsForConnectedChannels(configs, agentConnectedChannels)
      : configs;
    const nextSettings = configsToSettings(agentSettings, safeConfigs);
    setConfigs(safeConfigs);
    setSaveState("saving");
    setNotice(null);

    try {
      const response = await fetch("/api/agent/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: nextSettings,
          ...(editorialPlanApplyMode
            ? { editorialPlanApplyMode }
            : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        settings?: Partial<InrAgentSettings>;
        error?: string;
        code?: string;
        tableMissing?: boolean;
        impact?: EditorialPlanQuotaImpact;
      } | null;

      if (!response.ok) {
        if (
          (payload?.code ===
            "EDITORIAL_PLAN_CHANGE_CONFIRMATION_REQUIRED" ||
            payload?.code === "EDITORIAL_PLAN_QUOTA_INSUFFICIENT") &&
          payload.impact
        ) {
          setSettingsPlanImpact(payload.impact);
          setSaveState("idle");
          if (payload.code === "EDITORIAL_PLAN_QUOTA_INSUFFICIENT") {
            showNotice(
              "Quotas insuffisants : les publications actuelles ont été conservées.",
            );
          }
          return false;
        }
        throw new Error(payload?.error || i18nT("agent_settings_save_failed"));
      }

      const savedSettings = sanitizeInrAgentSettings(
        payload?.settings ?? nextSettings,
      );
      setAgentSettings(savedSettings);
      setConfigs(settingsToConfigs(savedSettings));
      setTableMissing((current) => current || Boolean(payload?.tableMissing));
      writeCachedAgentViewSnapshot({
        settings: savedSettings,
        tableMissing: Boolean(payload?.tableMissing),
      });
      await refreshActions(true);
      setSettingsPlanImpact(null);
      setSaveState("saved");
      if (closeModal) setSettingsKey(null);
      if (showSuccess) showNotice(i18nT("agent_settings_saved"));
      return true;
    } catch (error) {
      setSaveState("error");
      showNotice(i18nT("agent_settings_save_failed"));
      return false;
    }
  }

  async function saveSettings() {
    await persistSettings();
  }

  async function confirmEditorialPlanSettings(
    mode: EditorialPlanApplyMode,
  ) {
    const saved = await persistSettings({
      editorialPlanApplyMode: mode,
      showSuccess: false,
    });
    if (!saved) return;
    showNotice(
      mode === "next_cycle"
        ? "Réglages enregistrés pour le prochain cycle. Les contenus déjà préparés sont conservés."
        : "Réglages appliqués. Le planning est recalculé avec les quotas vérifiés.",
    );
  }

  async function runAutomationNow(key: AutomationKey) {
    if (testNowKey || prepareActionState === "saving" || saveState === "saving")
      return;

    const progressKey = key === "stats" ? null : key;
    let progressTimer: number | null = null;

    setTestNowKey(key);

    if (progressKey) {
      setPrepareProgress({
        key: progressKey,
        label: prepareProgressLabel(progressKey, 6),
        percent: 6,
      });
      progressTimer = window.setInterval(() => {
        setPrepareProgress((current) => {
          if (!current || current.key !== progressKey || current.percent >= 97)
            return current;
          const increment =
            current.percent < 22
              ? 7
              : current.percent < 52
                ? 5
                : current.percent < 78
                  ? 3
                  : 1;
          const nextPercent = Math.min(97, current.percent + increment);
          return {
            key: progressKey,
            label: prepareProgressLabel(progressKey, nextPercent),
            percent: nextPercent,
          };
        });
      }, 520);
    }

    let completed = false;

    try {
      const saved = await persistSettings({
        closeModal: false,
        showSuccess: false,
      });
      if (!saved) return;

      if (key === "publish") {
        completed = await preparePublishAction();
      } else if (key === "grow" || key === "loyalty") {
        completed = await prepareCampaignAction(key);
      } else {
        await sendStatsReport();
        completed = true;
      }

      if (completed) setSettingsKey(null);
    } finally {
      if (progressTimer) window.clearInterval(progressTimer);
      if (progressKey) {
        setPrepareProgress((current) =>
          current?.key === progressKey
            ? {
                key: progressKey,
                label: completed
                  ? i18nT("automation_progress_finalising")
                  : i18nT("automation_progress_stopped"),
                percent: 100,
              }
            : current,
        );
        await wait(completed ? 520 : 850);
        setPrepareProgress((current) =>
          current?.key === progressKey ? null : current,
        );
      }
      setTestNowKey(null);
    }
  }

  function testAutomationNow(key: AutomationKey) {
    if (testNowKey || prepareActionState === "saving" || saveState === "saving")
      return;

    const automation = automations.find((item) => item.key === key) ?? null;
    if (
      automation &&
      key !== "stats" &&
      connectedChannelsLoadState === "ready" &&
      connectedChannelsForAutomation(automation, agentConnectedChannels)
        .length === 0
    ) {
      showNotice(agentConnectedChannelMessage(automation.key, runtimeT));
      return;
    }

    if (
      (key === "grow" || key === "loyalty") &&
      pendingActionsByAutomation[key] > 0
    ) {
      setPrepareNowConfirm({
        key,
        label: agentAutomationTitle(key, runtimeT),
        pendingCount: pendingActionsByAutomation[key],
      });
      return;
    }

    void runAutomationNow(key);
  }

  async function confirmPrepareNowReplacement() {
    const confirm = prepareNowConfirm;
    if (!confirm) return;
    setPrepareNowConfirm(null);
    await runAutomationNow(confirm.key);
  }

  async function preparePublishAction() {
    if (prepareActionState === "saving") return false;

    setPrepareActionState("saving");
    setNotice(null);

    try {
      const response = await fetch("/api/agent/actions/prepare-publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as {
        action?: AgentPreparedAction;
        error?: string;
        detail?: string;
      } | null;

      if (!response.ok || !payload?.action) {
        throw new Error(
            payload?.error ||
              payload?.detail ||
              i18nT("agent_publication_prepare_failed"),
        );
      }

      const preparedAction = payload.action;
      setActions((current) => [
        preparedAction,
        ...current.filter((action) => action.id !== preparedAction.id),
      ]);
      setSelectedKey("publish");
      showNotice(i18nT("agent_publication_prepared"));
      return true;
    } catch (error) {
      showNotice(i18nT("agent_publication_prepare_failed"));
      return false;
    } finally {
      setPrepareActionState("idle");
    }
  }

  async function prepareCampaignAction(
    key: Extract<AutomationKey, "grow" | "loyalty">,
  ) {
    if (prepareActionState === "saving") return false;

    setPrepareActionState("saving");
    setNotice(null);

    try {
      const response = await fetch("/api/agent/actions/prepare-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automationKey: key }),
      });
      const payload = (await response.json().catch(() => null)) as {
        action?: AgentPreparedAction;
        movedDrafts?: Array<{
          actionId?: string | null;
          draftId?: string | null;
        }>;
        error?: string;
        detail?: string;
      } | null;

      if (!response.ok || !payload?.action) {
        throw new Error(
            payload?.error ||
              payload?.detail ||
              i18nT("agent_campaign_prepare_failed"),
        );
      }

      const preparedAction = payload.action;
      const movedActionIds = new Set(
        (payload.movedDrafts ?? [])
          .map((draft) => String(draft.actionId || "").trim())
          .filter(Boolean),
      );
      setActions((current) => [
        preparedAction,
        ...current.filter(
          (action) =>
            action.id !== preparedAction.id &&
            !movedActionIds.has(action.id) &&
            !(
              action.automationKey === key &&
              pendingActionStatuses.has(action.status)
            ),
        ),
      ]);
      void refreshActions(true);
      setSelectedKey(key);
      showNotice(i18nT(key === "grow" ? "agent_grow_campaign_prepared" : "agent_loyalty_campaign_prepared"));
      return true;
    } catch (error) {
      showNotice(i18nT("agent_campaign_prepare_failed"));
      return false;
    } finally {
      setPrepareActionState("idle");
    }
  }

  async function sendStatsReport() {
    if (prepareActionState === "saving") return;

    setPrepareActionState("saving");
    setStatsProgress({ label: i18nT("stats_be763e9a"), percent: 3 });
    setNotice(null);

    let progressTimer: number | null = null;

    try {
      progressTimer = window.setInterval(() => {
        setStatsProgress((current) => {
          const currentPercent = current?.percent ?? 3;
          if (currentPercent >= 98) return current;

          const increment =
            currentPercent < 20
              ? 4
              : currentPercent < 45
                ? 3
                : currentPercent < 70
                  ? 2
                  : 1;
          const nextPercent = Math.min(98, currentPercent + increment);
          return {
            label: statsProgressLabel(nextPercent),
            percent: nextPercent,
          };
        });
      }, 420);

      const response = await fetch("/api/agent/actions/send-stats-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as {
        action?: AgentPreparedAction | null;
        error?: string;
        detail?: string;
        sent?: boolean;
        recipientEmail?: string;
        filename?: string;
      } | null;

      if (!response.ok || !payload?.sent) {
        throw new Error(
            payload?.error ||
              payload?.detail ||
              i18nT("agent_stats_report_failed"),
        );
      }

      if (progressTimer) {
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
      setStatsProgress({ label: i18nT("bilan_envoye_ad83545d"), percent: 100 });

      await refreshActions(true);
      setSelectedKey("stats");
      showNotice(
        payload.recipientEmail
          ? i18nT("agent_stats_report_sent_to", { email: payload.recipientEmail })
          : i18nT("agent_stats_report_sent"),
      );
      await wait(800);
    } catch (error) {
      if (progressTimer) {
        window.clearInterval(progressTimer);
        progressTimer = null;
      }
      setStatsProgress({ label: i18nT("erreur_ab546c23"), percent: 100 });
      showNotice(i18nT("agent_stats_report_failed"));
      await wait(900);
    } finally {
      if (progressTimer) window.clearInterval(progressTimer);
      setPrepareActionState("idle");
      setStatsProgress(null);
    }
  }

  return {
    prepareActionState,
    prepareProgress,
    testNowKey,
    prepareNowConfirm,
    setPrepareNowConfirm,
    statsProgress,
    settingsPlanImpact,
    setSettingsPlanImpact,
    updateConfig,
    updateConfigFrequency,
    updateConfigScheduleSlot,
    updateConfigMonthDay,
    saveSettings,
    confirmEditorialPlanSettings,
    testAutomationNow,
    confirmPrepareNowReplacement,
  };
}
