"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslations } from "next-intl";

import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import {
  BUSINESS_DNA_DASHBOARD_CHANNELS,
  type BusinessDnaDashboardChannelAvailability,
} from "@/lib/businessDnaChannelAvailability";
import {
  EMPTY_AI_BUSINESS_KNOWLEDGE,
  EMPTY_AI_MEMORY,
  getAiWorkspaceCompletionScore,
  mergeAiBusinessDnaAnalysis,
  normalizeAiBusinessKnowledge,
  normalizeAiMemory,
  type AiBusinessKnowledge,
  type AiMemory,
} from "@/lib/aiMemory";
import { hasPremiumDashboardAccess, type DashboardEdition } from "@/lib/dashboardEdition";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { refreshPublicProfileDependents } from "@/lib/publicProfileRefreshClient";
import BusinessDnaRichTextEditor from "./BusinessDnaRichTextEditor";
import BusinessScheduleEditor from "./BusinessScheduleEditor";
import EditableTags from "./EditableTags";

type ProfileFoundation = { sector: string; profession: string };
type WorkspaceTab = "analysis" | "activity" | "audience" | "local" | "identity" | "strategy";
type AnalysisSource = {
  key: string;
  label: string;
  status: "analyzed" | "not_connected" | "needs_reconnect" | "failed";
  itemCount: number;
  message: string | null;
};
type AnalysisSummary = {
  analyzedAt: string;
  changedFields: string[];
  addedItems: number;
  sources: AnalysisSource[];
};
type AnalysisQuota = {
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
};

type Props = {
  edition?: DashboardEdition;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
};

function apiErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const source = payload as { user_message?: unknown; error?: unknown };
  return String(source.user_message || source.error || fallback);
}

function workspaceSignature(memory: AiMemory, businessKnowledge: AiBusinessKnowledge) {
  return JSON.stringify({ memory, businessKnowledge });
}

function parseAnalysisQuota(value: unknown): AnalysisQuota | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const limit = Number(source.limit);
  const used = Number(source.used);
  const remaining = Number(source.remaining);
  if (![limit, used, remaining].every((item) => Number.isInteger(item) && item >= 0)) return null;
  return {
    limit,
    used,
    remaining,
    resetAt: String(source.resetAt || ""),
  };
}

function disconnectedAnalysisChannels(): BusinessDnaDashboardChannelAvailability[] {
  return BUSINESS_DNA_DASHBOARD_CHANNELS.map((channel) => ({
    ...channel,
    status: "not_connected" as const,
  }));
}

function parseAnalysisChannels(value: unknown): BusinessDnaDashboardChannelAvailability[] {
  if (!Array.isArray(value)) return disconnectedAnalysisChannels();
  const allowedKeys = new Set(BUSINESS_DNA_DASHBOARD_CHANNELS.map((channel) => channel.key));
  const allowedStatuses = new Set(["connected", "not_connected", "needs_reconnect"]);
  const statuses = new Map<
    BusinessDnaDashboardChannelAvailability["key"],
    BusinessDnaDashboardChannelAvailability["status"]
  >();

  value.forEach((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const source = item as Record<string, unknown>;
    const key = String(source.key || "") as BusinessDnaDashboardChannelAvailability["key"];
    const status = String(source.status || "") as BusinessDnaDashboardChannelAvailability["status"];
    if (allowedKeys.has(key) && allowedStatuses.has(status)) statuses.set(key, status);
  });

  return BUSINESS_DNA_DASHBOARD_CHANNELS.map((channel) => ({
    ...channel,
    status: statuses.get(channel.key) || "not_connected",
  }));
}

export default function AiMemoryContent({
  edition = "standard",
  onUnsavedChange,
}: Props) {
  const t = useTranslations("dashboard.aiMemory");
  const moduleT = useTranslations("dashboard.moduleCards");
  const settingsT = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("analysis");
  const [memory, setMemory] = useState<AiMemory>(EMPTY_AI_MEMORY);
  const [businessKnowledge, setBusinessKnowledge] = useState<AiBusinessKnowledge>(
    EMPTY_AI_BUSINESS_KNOWLEDGE,
  );
  const [foundation, setFoundation] = useState<ProfileFoundation>({ sector: "", profession: "" });
  const [premiumEnabled, setPremiumEnabled] = useState(hasPremiumDashboardAccess(edition));
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [analysisQuota, setAnalysisQuota] = useState<AnalysisQuota | null>(null);
  const [analysisChannels, setAnalysisChannels] =
    useState<BusinessDnaDashboardChannelAvailability[]>(disconnectedAnalysisChannels);
  const memoryRef = useRef<AiMemory>(EMPTY_AI_MEMORY);
  const businessKnowledgeRef = useRef<AiBusinessKnowledge>(EMPTY_AI_BUSINESS_KNOWLEDGE);
  const savedSignatureRef = useRef(
    workspaceSignature(EMPTY_AI_MEMORY, EMPTY_AI_BUSINESS_KNOWLEDGE),
  );
  const analysisProgressTimerRef = useRef<number | null>(null);
  const tabSwipeStartRef = useRef<{ x: number; y: number; enabled: boolean } | null>(null);

  const updateMemory = useCallback((update: SetStateAction<AiMemory>) => {
    const nextMemory = typeof update === "function" ? update(memoryRef.current) : update;
    memoryRef.current = nextMemory;
    setMemory(nextMemory);
  }, []);

  const updateBusinessKnowledge = useCallback(
    (update: SetStateAction<AiBusinessKnowledge>) => {
      const nextBusinessKnowledge = typeof update === "function"
        ? update(businessKnowledgeRef.current)
        : update;
      businessKnowledgeRef.current = nextBusinessKnowledge;
      setBusinessKnowledge(nextBusinessKnowledge);
    },
    [],
  );

  const signature = useMemo(
    () => workspaceSignature(memory, businessKnowledge),
    [businessKnowledge, memory],
  );
  const completionScore = getAiWorkspaceCompletionScore(memory, businessKnowledge, {
    includePremium: premiumEnabled,
  });

  useEffect(() => {
    if (loading) {
      onUnsavedChange?.(false);
      return;
    }
    onUnsavedChange?.(signature !== savedSignatureRef.current);
  }, [loading, onUnsavedChange, signature]);

  useEffect(() => () => {
    if (analysisProgressTimerRef.current !== null) {
      window.clearInterval(analysisProgressTimerRef.current);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setLoaded(false);
      setError("");
      try {
        const [response, quotaResponse] = await Promise.all([
          fetch("/api/ai-memory", { cache: "no-store", credentials: "include" }),
          fetch("/api/ai-memory/analyze-channels", { cache: "no-store", credentials: "include" })
            .catch(() => null),
        ]);
        const payload = await response.json().catch(() => ({}));
        const quotaPayload = quotaResponse?.ok
          ? await quotaResponse.json().catch(() => ({}))
          : {};
        if (!response.ok) throw new Error(apiErrorMessage(payload, t("loadError")));
        if (!active) return;

        const nextPremiumEnabled = Boolean(payload.premiumEnabled);
        const rawFoundation = payload.profileFoundation || {};
        const rawBusinessKnowledge = payload.businessKnowledge || {};
        const nextMemory = normalizeAiMemory(payload.memory, {
          includePremium: nextPremiumEnabled,
        });
        const nextBusinessKnowledge = normalizeAiBusinessKnowledge({
          ...rawBusinessKnowledge,
          description: rawBusinessKnowledge.description ?? nextMemory.detailedDescription,
          services: rawBusinessKnowledge.services ?? rawFoundation.services ?? [],
          strengths: rawBusinessKnowledge.strengths ?? nextMemory.differentiators,
        });
        const synchronizedMemory = normalizeAiMemory(
          {
            ...nextMemory,
            detailedDescription: nextBusinessKnowledge.description,
            differentiators: nextBusinessKnowledge.strengths,
          },
          { includePremium: nextPremiumEnabled },
        );

        updateMemory(synchronizedMemory);
        updateBusinessKnowledge(nextBusinessKnowledge);
        setFoundation({
          sector: String(rawFoundation.sector || ""),
          profession: String(rawFoundation.profession || ""),
        });
        setPremiumEnabled(nextPremiumEnabled);
        setAnalysisQuota(parseAnalysisQuota(quotaPayload.quota));
        setAnalysisChannels(parseAnalysisChannels(quotaPayload.channels));
        setLoaded(true);
        savedSignatureRef.current = workspaceSignature(synchronizedMemory, nextBusinessKnowledge);
        onUnsavedChange?.(false);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : t("loadError"));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [loadAttempt, onUnsavedChange, t, updateBusinessKnowledge, updateMemory]);

  const setField = <K extends keyof AiMemory>(key: K, value: AiMemory[K]) => {
    setSaved(false);
    setError("");
    updateMemory((current) => ({ ...current, [key]: value }));
  };

  const setBusinessField = <K extends keyof AiBusinessKnowledge>(
    key: K,
    value: AiBusinessKnowledge[K],
  ) => {
    setSaved(false);
    setError("");
    updateBusinessKnowledge((current) => ({ ...current, [key]: value }));
    if (key === "description") {
      updateMemory((current) => ({ ...current, detailedDescription: String(value) }));
    }
    if (key === "strengths") {
      updateMemory((current) => ({ ...current, differentiators: value as string[] }));
    }
  };

  const setRichDescription = (next: { text: string; html: string }) => {
    setSaved(false);
    setError("");
    updateBusinessKnowledge((current) => ({ ...current, description: next.text }));
    updateMemory((current) => ({
      ...current,
      detailedDescription: next.text,
      richText: { ...current.richText, detailedDescription: next.html },
    }));
  };

  const setPremiumRichField = (
    key: "offersAndArguments" | "proofsAndObjections" | "editorialStrategy",
    next: { text: string; html: string },
  ) => {
    setSaved(false);
    setError("");
    updateMemory((current) => ({
      ...current,
      [key]: next.text,
      richText: { ...current.richText, [key]: next.html },
    }));
  };

  const toggleCustomerType = (customerType: string) => {
    const currentCustomerTypes = businessKnowledgeRef.current.customerTypes;
    const next = currentCustomerTypes.includes(customerType)
      ? currentCustomerTypes.filter((item) => item !== customerType)
      : [...currentCustomerTypes, customerType];
    setBusinessField("customerTypes", next);
  };

  const save = async () => {
    if (saving || !loaded) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const synchronizedMemory = normalizeAiMemory({
        ...memory,
        detailedDescription: businessKnowledge.description,
        differentiators: businessKnowledge.strengths,
      });
      const response = await fetch("/api/ai-memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ memory: synchronizedMemory, businessKnowledge }),
      });
      const payload = await response.json().catch(() => ({}));
      const nextQuota = parseAnalysisQuota(payload.quota);
      if (nextQuota) setAnalysisQuota(nextQuota);
      if (!response.ok) throw new Error(apiErrorMessage(payload, t("saveError")));

      const nextPremiumEnabled = Boolean(payload.premiumEnabled);
      const nextBusinessKnowledge = normalizeAiBusinessKnowledge(
        payload.businessKnowledge || businessKnowledge,
      );
      const nextMemory = normalizeAiMemory(payload.memory, {
        includePremium: nextPremiumEnabled,
      });
      updateMemory(nextMemory);
      updateBusinessKnowledge(nextBusinessKnowledge);
      setPremiumEnabled(nextPremiumEnabled);
      savedSignatureRef.current = workspaceSignature(nextMemory, nextBusinessKnowledge);
      onUnsavedChange?.(false);
      setSaved(true);

      const [publicProfileRefreshed] = await Promise.all([
        refreshPublicProfileDependents("activity"),
        invalidateBoosterGenerationContextClient("professional"),
      ]);
      if (!publicProfileRefreshed) console.warn("[business-dna] public profile refresh deferred");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  const cancelChanges = async () => {
    if (signature === savedSignatureRef.current) return;
    const confirmed = await confirmInrcy({
      title: t("cancelTitle"),
      message: t("cancelMessage"),
      confirmLabel: t("cancelConfirm"),
      variant: "warning",
    });
    if (!confirmed) return;
    try {
      const savedWorkspace = JSON.parse(savedSignatureRef.current) as {
        memory?: unknown;
        businessKnowledge?: unknown;
      };
      const savedMemory = normalizeAiMemory(savedWorkspace.memory, {
        includePremium: premiumEnabled,
      });
      const savedBusinessKnowledge = normalizeAiBusinessKnowledge(savedWorkspace.businessKnowledge);
      updateMemory(savedMemory);
      updateBusinessKnowledge(savedBusinessKnowledge);
      setSaved(false);
      setError("");
      onUnsavedChange?.(false);
    } catch {
      // La signature est toujours créée par JSON.stringify sur des objets validés.
    }
  };

  const resetWorkspace = async () => {
    const confirmed = await confirmInrcy({
      title: t("resetTitle"),
      message: t("resetMessage"),
      confirmLabel: t("resetConfirm"),
      variant: "danger",
    });
    if (!confirmed) return;
    updateMemory(normalizeAiMemory(EMPTY_AI_MEMORY, { includePremium: premiumEnabled }));
    updateBusinessKnowledge(normalizeAiBusinessKnowledge(EMPTY_AI_BUSINESS_KNOWLEDGE));
    setSaved(false);
    setError("");
    setAnalysisError("");
  };

  const analyzeChannels = async () => {
    if (analyzing || loading || !loaded) return;
    setAnalyzing(true);
    setAnalysisProgress(4);
    if (analysisProgressTimerRef.current !== null) {
      window.clearInterval(analysisProgressTimerRef.current);
    }
    analysisProgressTimerRef.current = window.setInterval(() => {
      setAnalysisProgress((current) => {
        const step = current < 25 ? 7 : current < 57 ? 4 : current < 79 ? 2 : 1;
        return Math.min(94, current + step);
      });
    }, 420);
    setAnalysisError("");
    setAnalysisSummary(null);
    setSaved(false);
    try {
      const response = await fetch("/api/ai-memory/analyze-channels", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({}));
      const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
      const sources = rawSources
        .map((source: unknown): AnalysisSource | null => {
          if (!source || typeof source !== "object" || Array.isArray(source)) return null;
          const record = source as Record<string, unknown>;
          const status = String(record.status || "not_connected");
          if (!["analyzed", "not_connected", "needs_reconnect", "failed"].includes(status)) return null;
          return {
            key: String(record.key || ""),
            label: String(record.label || ""),
            status: status as AnalysisSource["status"],
            itemCount: Math.max(0, Number(record.itemCount || 0)),
            message: record.message ? String(record.message) : null,
          };
        })
        .filter((source: AnalysisSource | null): source is AnalysisSource => Boolean(source?.key && source.label));

      if (!response.ok) {
        if (sources.length) {
          setAnalysisSummary({ analyzedAt: "", changedFields: [], addedItems: 0, sources });
        }
        throw new Error(apiErrorMessage(payload, t("analysisError")));
      }

      const suggestion = payload.suggestion && typeof payload.suggestion === "object"
        ? payload.suggestion as Record<string, unknown>
        : {};
      const merged = mergeAiBusinessDnaAnalysis(
        memoryRef.current,
        businessKnowledgeRef.current,
        suggestion.memory,
        suggestion.businessKnowledge,
        { includePremium: premiumEnabled },
      );
      updateMemory(merged.memory);
      updateBusinessKnowledge(merged.businessKnowledge);
      setAnalysisSummary({
        analyzedAt: String(payload.analyzedAt || new Date().toISOString()),
        changedFields: merged.changedFields,
        addedItems: merged.addedItems,
        sources,
      });
    } catch (analysisFailure) {
      setAnalysisError(
        analysisFailure instanceof Error ? analysisFailure.message : t("analysisError"),
      );
    } finally {
      if (analysisProgressTimerRef.current !== null) {
        window.clearInterval(analysisProgressTimerRef.current);
        analysisProgressTimerRef.current = null;
      }
      setAnalysisProgress(100);
      window.setTimeout(() => {
        setAnalyzing(false);
        setAnalysisProgress(0);
      }, 420);
      void fetch("/api/ai-memory/analyze-channels", {
        cache: "no-store",
        credentials: "include",
      })
        .then(async (response) => response.ok ? response.json() : null)
        .then((payload) => {
          const refreshedQuota = parseAnalysisQuota(payload?.quota);
          if (refreshedQuota) setAnalysisQuota(refreshedQuota);
          const refreshedChannels = parseAnalysisChannels(payload?.channels);
          if (refreshedChannels.length) setAnalysisChannels(refreshedChannels);
        })
        .catch(() => undefined);
    }
  };

  const memoryTags = (
    key:
      | "specialties"
      | "targetAudiences"
      | "customerNeeds"
      | "values"
      | "brandPersonality"
      | "commitments"
      | "preferredVocabulary"
      | "forbiddenVocabulary",
    addLabel: string,
    placeholder: string,
    inlineAdd = false,
  ) => (
    <EditableTags
      values={memory[key]}
      onChange={(values) => setField(key, values)}
      addLabel={addLabel}
      placeholder={placeholder}
      emptyText={t("tagsEmpty")}
      maxItems={16}
      inlineAdd={inlineAdd}
    />
  );

  const tabs: Array<{ key: WorkspaceTab; icon: string; label: string; premium?: boolean }> = [
    { key: "analysis", icon: "✦", label: t("tabAnalysis") },
    { key: "activity", icon: "🏢", label: t("tabActivity") },
    { key: "audience", icon: "🎯", label: t("tabAudience") },
    { key: "local", icon: "📍", label: t("tabLocal") },
    { key: "identity", icon: "🧭", label: t("tabIdentity") },
    { key: "strategy", icon: "💎", label: t("tabStrategy"), premium: true },
  ];
  const activeTabIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTab));
  const activeTabDefinition = tabs[activeTabIndex] ?? tabs[0];
  const selectTabAt = (index: number) => {
    const next = tabs[index];
    if (next) setActiveTab(next.key);
  };

  return (
    <div data-ai-memory-workspace style={pageStyle}>
      <nav data-ai-memory-desktop-tabs aria-label={t("title")} role="tablist" style={tabListStyle}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              style={{ ...tabButtonStyle, ...(active ? activeTabButtonStyle : {}) }}
            >
              <span aria-hidden>{tab.icon}</span>
              <span>{tab.label}</span>
              {tab.premium ? (
                <span
                  aria-label={t("premiumBadge")}
                  title={t("premiumBadge")}
                  style={miniPremiumBadgeStyle}
                />
              ) : null}
            </button>
          );
        })}
      </nav>

      <nav data-ai-memory-mobile-tabs aria-label={t("title")} style={mobileTabNavigatorStyle}>
        <button
          type="button"
          disabled={activeTabIndex === 0}
          aria-label={activeTabIndex > 0 ? tabs[activeTabIndex - 1].label : activeTabDefinition.label}
          onClick={() => selectTabAt(activeTabIndex - 1)}
          style={mobileTabArrowStyle}
        >
          <span aria-hidden>←</span>
        </button>
        <div aria-live="polite" style={mobileTabCurrentStyle}>
          <span style={mobileTabLabelStyle}>
            <span aria-hidden>{activeTabDefinition.icon}</span>
            <strong>{activeTabDefinition.label}</strong>
            {activeTabDefinition.premium ? <span aria-hidden style={miniPremiumBadgeStyle} /> : null}
          </span>
          <span style={mobileTabPositionStyle}>{activeTabIndex + 1} / {tabs.length}</span>
          <span aria-hidden style={mobileTabProgressTrackStyle}>
            <span style={{ ...mobileTabProgressValueStyle, width: `${((activeTabIndex + 1) / tabs.length) * 100}%` }} />
          </span>
        </div>
        <button
          type="button"
          disabled={activeTabIndex === tabs.length - 1}
          aria-label={activeTabIndex < tabs.length - 1 ? tabs[activeTabIndex + 1].label : activeTabDefinition.label}
          onClick={() => selectTabAt(activeTabIndex + 1)}
          style={mobileTabArrowStyle}
        >
          <span aria-hidden>→</span>
        </button>
      </nav>

      {loading ? (
        <section style={cardStyle}>{t("loading")}</section>
      ) : !loaded ? (
        <section style={cardStyle}>
          <span style={hintStyle}>{t("loadError")}</span>
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} style={secondaryButtonStyle}>
            {t("retry")}
          </button>
        </section>
      ) : (
        <div
          key={activeTab}
          role="tabpanel"
          data-ai-memory-active-tab={activeTab}
          style={tabPanelStyle}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            const target = event.target as HTMLElement | null;
            tabSwipeStartRef.current = touch
              ? {
                  x: touch.clientX,
                  y: touch.clientY,
                  enabled: !target?.closest("input, textarea, select, button, [contenteditable='true']"),
                }
              : null;
          }}
          onTouchEnd={(event) => {
            const start = tabSwipeStartRef.current;
            tabSwipeStartRef.current = null;
            const touch = event.changedTouches[0];
            if (!start?.enabled || !touch) return;
            const deltaX = touch.clientX - start.x;
            const deltaY = touch.clientY - start.y;
            if (Math.abs(deltaX) < 54 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
            selectTabAt(activeTabIndex + (deltaX < 0 ? 1 : -1));
          }}
        >
            {activeTab === "analysis" ? (
              <section
                data-business-dna-channel-analysis
                data-analysis-running={analyzing ? "true" : "false"}
                style={analysisLandingStyle}
              >
                <div data-business-dna-analysis-orb style={analysisOrbStageStyle}>
                  <div data-dna-score-summary style={analysisScoreBubbleStyle}>
                    <span>{t("scoreLabel")} :</span>
                    <strong>{completionScore}%</strong>
                    <span
                      data-dna-score-help
                      data-tooltip={t("scoreHelp")}
                      tabIndex={0}
                      role="img"
                      aria-label={t("scoreHelp")}
                      style={analysisScoreHelpStyle}
                    >
                      i
                    </span>
                  </div>
                  <span aria-hidden data-analysis-aura style={analysisOrbAuraStyle} />
                  <span aria-hidden data-dna-stream="left" style={analysisStreamLeftStyle}>
                    {Array.from({ length: 6 }, (_, index) => (
                      <i key={index} style={{ ...analysisStreamParticleStyle, top: `${12 + index * 14}%`, animationDelay: `${-index * 0.31}s` }} />
                    ))}
                  </span>
                  <span aria-hidden data-dna-stream="right" style={analysisStreamRightStyle}>
                    {Array.from({ length: 6 }, (_, index) => (
                      <i key={index} style={{ ...analysisStreamParticleStyle, top: `${16 + index * 13}%`, animationDelay: `${-index * 0.27}s` }} />
                    ))}
                  </span>
                  <div data-dna-assembly style={analysisDnaAssemblyStyle}>
                    <div data-dna-model aria-hidden="true" style={analysisDnaModelStyle}>
                      {Array.from({ length: 15 }, (_, index) => (
                        <span
                          key={index}
                          data-dna-rung
                          style={{
                            top: `${3 + index * 6.7}%`,
                            "--dna-delay": `${-index * 0.22}s`,
                          } as CSSProperties}
                        >
                          <i data-dna-bridge />
                          <i data-dna-node="a" />
                          <i data-dna-node="b" />
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div style={analysisIntroStyle}>
                  <h2 style={analysisTitleStyle}>{t("analysisTitle")}</h2>
                  <p style={analysisDescriptionStyle}>{t("analysisDescription")}</p>
                </div>

                {analysisChannels.length ? (
                  <div
                    data-business-dna-channel-states
                    aria-label={t("analysisChannelsAria")}
                    style={analysisChannelRailStyle}
                  >
                    {analysisChannels.map((channel) => {
                      const channelName = moduleT(`${channel.key}.name`);
                      const statusLabel = channel.status === "connected"
                        ? t("analysisChannelConnected")
                        : channel.status === "needs_reconnect"
                          ? t("analysisChannelReconnect")
                          : t("analysisChannelDisconnected");
                      const coverageLabel = channel.analyzable
                        ? t("analysisChannelIncluded")
                        : t("analysisChannelNotIncluded");
                      const tooltip = t("analysisChannelTooltip", {
                        status: statusLabel,
                        coverage: coverageLabel,
                      });
                      return (
                        <span
                          key={channel.key}
                          data-channel-key={channel.key}
                          data-channel-status={channel.status}
                          data-channel-analyzable={channel.analyzable ? "true" : "false"}
                          title={tooltip}
                          aria-label={`${channelName} — ${tooltip}`}
                          style={{
                            ...analysisChannelPillStyle,
                            ...(channel.status === "connected"
                              ? analysisChannelConnectedStyle
                              : channel.status === "needs_reconnect"
                                ? analysisChannelReconnectStyle
                                : analysisChannelDisconnectedStyle),
                          }}
                        >
                          <span
                            aria-hidden
                            style={{
                              ...analysisChannelDotStyle,
                              ...(channel.status === "connected"
                                ? analysisChannelConnectedDotStyle
                                : channel.status === "needs_reconnect"
                                  ? analysisChannelReconnectDotStyle
                                  : analysisChannelDisconnectedDotStyle),
                            }}
                          />
                          <span>{channelName}</span>
                          {channel.status === "needs_reconnect" ? (
                            <span aria-hidden style={analysisChannelReconnectIconStyle}>↻</span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                ) : null}

                {analyzing ? (
                  <div
                    data-analysis-progress
                    data-running="true"
                    role="progressbar"
                    aria-label={t("analysisRunning")}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={analysisProgress}
                    style={analysisProgressStyle}
                  >
                    <div style={progressTrackStyle}>
                      <span style={{ ...progressValueStyle, width: `${analysisProgress}%` }} />
                    </div>
                    <strong style={scoreStyle}>{analysisProgress}%</strong>
                  </div>
                ) : null}

                <div style={analysisActionGroupStyle}>
                  <button
                    type="button"
                    disabled={analyzing || analysisQuota?.remaining === 0}
                    aria-busy={analyzing}
                    onClick={() => void analyzeChannels()}
                    style={{
                      ...analysisButtonStyle,
                      opacity: analyzing || analysisQuota?.remaining === 0 ? 0.58 : 1,
                      cursor: analyzing || analysisQuota?.remaining === 0 ? "default" : "pointer",
                    }}
                  >
                    {analyzing
                      ? t("analysisRunning")
                      : analysisQuota?.remaining === 0
                        ? t("analysisQuotaReachedButton")
                        : t("analysisButton")}
                  </button>
                  {analysisQuota ? (
                    <span style={analysisQuotaStyle}>
                      <span aria-hidden style={analysisQuotaDotStyle} />
                      {t("analysisQuota", {
                        remaining: analysisQuota.remaining,
                        limit: analysisQuota.limit,
                      })}
                    </span>
                  ) : null}
                  <span style={analysisPrivacyStyle}>{t("analysisPrivacy")}</span>
                </div>

                {analysisSummary?.analyzedAt ? (
                  <div style={analysisReportStyle}>
                    <strong style={{ color: analysisSummary.changedFields.length ? "#a5f3fc" : "#cbd5e1", fontSize: 12 }}>
                      {analysisSummary.changedFields.length
                        ? t("analysisApplied", {
                            fields: analysisSummary.changedFields.length,
                            items: analysisSummary.addedItems,
                          })
                        : t("analysisNoChange")}
                    </strong>
                  </div>
                ) : null}
                {analysisError ? <div style={analysisErrorStyle}>{analysisError}</div> : null}
              </section>
            ) : null}

            {activeTab === "activity" ? (
              <div data-ai-memory-tab="activity" style={sectionStackStyle}>
                <section style={foundationCardStyle}>
                  <span aria-hidden style={foundationCompactIconStyle}>🔗</span>
                  <div style={foundationCompactContentStyle}>
                    <div style={foundationCompactValuesStyle}>
                      <strong><span style={foundationCompactLabelStyle}>{t("sectorLabel")} :</span> {foundation.sector || t("foundationEmpty")}</strong>
                      <span aria-hidden style={foundationCompactDividerStyle} />
                      <strong><span style={foundationCompactLabelStyle}>{t("professionLabel")} :</span> {foundation.profession || t("foundationEmpty")}</strong>
                    </div>
                    <span style={foundationCompactHintStyle}>{t("foundationTitle")}</span>
                  </div>
                </section>

                <section style={cardStyle}>
                  <SectionHeader icon="🏢" title={t("identityTitle")} description={t("identityDescription")} />
                  <div style={fieldStyle}>
                    <BusinessDnaRichTextEditor
                      label={t("detailedDescriptionLabel")}
                      value={businessKnowledge.description}
                      html={memory.richText.detailedDescription}
                      maxLength={5000}
                      onChange={setRichDescription}
                      placeholder={t("detailedDescriptionPlaceholder")}
                      minHeight={165}
                    />
                  </div>
                  <div style={fieldStyle}>
                    <span style={labelStyle}>{t("baseServicesLabel")}</span>
                    <EditableTags
                      values={businessKnowledge.services}
                      onChange={(values) => setBusinessField("services", values)}
                      addLabel={settingsT("ajouter_une_prestation_f819082b")}
                      placeholder={settingsT("ex_intervention_week_end_931e57fb")}
                      emptyText={t("baseServicesEmpty")}
                      maxItems={20}
                      inlineAdd
                    />
                    <span style={hintStyle}>{settingsT("inrcy_propose_automatiquement_les_prestations_li_7e2f1891")}</span>
                  </div>
                  <div style={fieldStyle}>
                    <span style={labelStyle}>{t("specialtiesLabel")}</span>
                    {memoryTags("specialties", t("specialtiesAdd"), t("specialtiesPlaceholder"))}
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === "audience" ? (
              <div data-ai-memory-tab="audience" style={sectionStackStyle}>
                <section style={cardStyle}>
                  <SectionHeader
                    icon="🤝"
                    title={t("audienceTitle")}
                    description={t("audienceDescription")}
                    trailing={<CompletionPill label={t("completion")} score={completionScore} />}
                  />
                  <div style={fieldStyle}>
                    <span style={labelStyle}>{settingsT("typologie_de_clientele_4d08c355")}</span>
                    <div style={checkboxGridStyle}>
                      {[
                        { value: "particuliers", label: settingsT("particuliers_918ed212") },
                        { value: "professionnels", label: settingsT("professionnels_8d94a78e") },
                        { value: "collectivites", label: settingsT("collectivites_c0c84588") },
                      ].map((option) => {
                        const checked = businessKnowledge.customerTypes.includes(option.value);
                        return (
                          <label key={option.value} style={{ ...choiceStyle, ...(checked ? selectedChoiceStyle : {}) }}>
                            <input type="checkbox" checked={checked} onChange={() => toggleCustomerType(option.value)} style={{ accentColor: "#38bdf8" }} />
                            <span>{option.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    <span style={hintStyle}>{settingsT("aide_l_ia_a_adapter_les_35ed6a9c")}</span>
                  </div>
                  <div style={twoColumnsStyle}>
                    <div style={fieldStyle}>
                      <span style={labelStyle}>{t("targetAudiencesLabel")}</span>
                      {memoryTags("targetAudiences", t("targetAudiencesAdd"), t("targetAudiencesPlaceholder"))}
                    </div>
                    <div style={fieldStyle}>
                      <span style={labelStyle}>{t("customerNeedsLabel")}</span>
                      {memoryTags("customerNeeds", t("customerNeedsAdd"), t("customerNeedsPlaceholder"))}
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === "local" ? (
              <section data-ai-memory-tab="local" style={localTabStyle}>
                <div data-local-presence-grid style={localPresenceGridStyle}>
                  <div style={localZonesCardStyle}>
                    <span style={labelStyle}>{settingsT("zones_d_intervention_a4999f61")}</span>
                    <EditableTags
                      values={businessKnowledge.interventionZones}
                      onChange={(values) => setBusinessField("interventionZones", values)}
                      addLabel={settingsT("ajouter_une_zone_85f56481")}
                      placeholder={settingsT("ex_arras_c3287f39")}
                      emptyText={settingsT("ajoutez_les_villes_secteurs_ou_rayons_dc934f3a")}
                      maxItems={30}
                    />
                    <span style={hintStyle}>{settingsT("une_zone_par_tag_aide_l_7516e004")}</span>
                  </div>
                  <div style={localScheduleCardStyle}>
                    <div style={{ display: "grid", gap: 3 }}>
                      <span style={labelStyle}>{t("openingScheduleLabel")}</span>
                      <span style={hintStyle}>{t("openingScheduleHint")}</span>
                    </div>
                    <BusinessScheduleEditor
                      value={businessKnowledge.weeklySchedule}
                      onChange={(value) => setBusinessField("weeklySchedule", value)}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "identity" ? (
              <div data-ai-memory-tab="identity" style={sectionStackStyle}>
                <section style={cardStyle}>
                  <SectionHeader
                    icon="🧭"
                    title={t("expertiseTitle")}
                    description={t("expertiseDescription")}
                    trailing={<CompletionPill label={t("completion")} score={completionScore} />}
                  />
                  <div style={identityCoreGridStyle}>
                    <label style={identityMissionCardStyle}>
                      <span style={identityMissionHeadingStyle}>
                        <span style={labelStyle}>{t("missionLabel")}</span>
                        <span style={identityCounterStyle}>{memory.mission.length}/800</span>
                      </span>
                      <textarea
                        value={memory.mission}
                        onChange={(event) => setField("mission", event.target.value.slice(0, 800))}
                        maxLength={800}
                        rows={3}
                        placeholder={t("missionPlaceholder")}
                        style={identityTextareaStyle}
                      />
                    </label>
                    <div style={identityTagRowsStyle}>
                      <div style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{settingsT("vos_forces_29964107")}</span>
                        <div style={identityTagContentStyle}>
                        <EditableTags
                          values={businessKnowledge.strengths}
                          onChange={(values) => setBusinessField("strengths", values)}
                          addLabel={settingsT("ajouter_une_force_58699841")}
                          placeholder={settingsT("ex_intervention_rapide_e8d23c44")}
                          emptyText={settingsT("ajoutez_3_a_6_forces_qui_c9dbc997")}
                          maxItems={16}
                          inlineAdd
                        />
                        </div>
                      </div>
                      <div style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{t("valuesLabel")}</span>
                        <div style={identityTagContentStyle}>
                          {memoryTags("values", t("valuesAdd"), t("valuesPlaceholder"), true)}
                        </div>
                      </div>
                      <div style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{t("brandPersonalityLabel")}</span>
                        <div style={identityTagContentStyle}>
                          {memoryTags(
                            "brandPersonality",
                            t("brandPersonalityAdd"),
                            t("brandPersonalityPlaceholder"),
                            true,
                          )}
                        </div>
                      </div>
                      <div style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{t("commitmentsLabel")}</span>
                        <div style={identityTagContentStyle}>
                          {memoryTags(
                            "commitments",
                            t("commitmentsAdd"),
                            t("commitmentsPlaceholder"),
                            true,
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={identityVocabularySectionStyle}>
                    <div style={identityVocabularyHeadingStyle}>
                      <strong style={identityVocabularyTitleStyle}>{t("languageTitle")}</strong>
                      <span style={hintStyle}>{t("languageDescription")}</span>
                    </div>
                    <div style={identityTagRowsStyle}>
                      <div style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{t("preferredVocabularyLabel")}</span>
                        <div style={identityTagContentStyle}>
                          {memoryTags(
                            "preferredVocabulary",
                            t("preferredVocabularyAdd"),
                            t("preferredVocabularyPlaceholder"),
                            true,
                          )}
                        </div>
                      </div>
                      <div style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{t("forbiddenVocabularyLabel")}</span>
                        <div style={identityTagContentStyle}>
                          {memoryTags(
                            "forbiddenVocabulary",
                            t("forbiddenVocabularyAdd"),
                            t("forbiddenVocabularyPlaceholder"),
                            true,
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : null}

            {activeTab === "strategy" ? (
              <section data-ai-memory-tab="strategy" style={{ ...cardStyle, ...premiumCardStyle }}>
                <div style={sectionHeadingRowStyle}>
                  <SectionHeader
                    icon="💎"
                    title={t("premiumTitle")}
                    description={t("premiumDescription")}
                    trailing={<CompletionPill label={t("completion")} score={completionScore} />}
                  />
                  <span style={premiumBadgeStyle}>{t("premiumBadge")}</span>
                </div>
                {!premiumEnabled ? <div style={lockedNoticeStyle}>🔒 {t("premiumLocked")}</div> : null}
                <div style={premiumGridStyle}>
                  <PremiumTextarea label={t("offersLabel")} placeholder={t("offersPlaceholder")} value={memory.offersAndArguments} html={memory.richText.offersAndArguments} disabled={!premiumEnabled} onChange={(next) => setPremiumRichField("offersAndArguments", next)} />
                  <PremiumTextarea label={t("proofsLabel")} placeholder={t("proofsPlaceholder")} value={memory.proofsAndObjections} html={memory.richText.proofsAndObjections} disabled={!premiumEnabled} onChange={(next) => setPremiumRichField("proofsAndObjections", next)} />
                  <PremiumTextarea label={t("editorialLabel")} placeholder={t("editorialPlaceholder")} value={memory.editorialStrategy} html={memory.richText.editorialStrategy} disabled={!premiumEnabled} onChange={(next) => setPremiumRichField("editorialStrategy", next)} />
                </div>
              </section>
            ) : null}
        </div>
      )}

      {error ? <div style={errorStyle}>{error}</div> : null}
      {saved ? <div style={successStyle}>{t("saved")}</div> : null}

      {!loading && loaded && (activeTab !== "analysis" || signature !== savedSignatureRef.current) ? (
        <div data-ai-memory-actions style={actionsStyle}>
          <button type="button" disabled={saving} onClick={() => void resetWorkspace()} style={dangerButtonStyle}>{t("reset")}</button>
          <button type="button" disabled={saving || signature === savedSignatureRef.current} onClick={() => void cancelChanges()} style={secondaryButtonStyle}>{t("cancelChanges")}</button>
          <button type="button" disabled={saving} aria-busy={saving} onClick={() => void save()} style={{ ...primaryButtonStyle, opacity: saving ? 0.7 : 1 }}>{saving ? t("saving") : t("save")}</button>
        </div>
      ) : null}

      <style jsx>{`
        section[data-business-dna-channel-analysis]::before,
        section[data-business-dna-channel-analysis]::after {
          content: "";
          position: absolute;
          z-index: -1;
          pointer-events: none;
        }
        section[data-business-dna-channel-analysis]::before {
          inset: -48%;
          border-radius: 50%;
          background: conic-gradient(from 20deg, transparent 0 11%, rgba(38,207,238,.20) 19%, transparent 31% 45%, rgba(118,81,236,.23) 54%, transparent 66% 79%, rgba(236,72,157,.18) 88%, transparent 97%);
          filter: blur(96px);
          opacity: .46;
          animation: dnaAurora 18s ease-in-out infinite alternate;
        }
        section[data-business-dna-channel-analysis]::after {
          inset: 0;
          background-image: radial-gradient(circle, rgba(103,232,249,.68) 0 1px, transparent 1.8px), radial-gradient(circle, rgba(167,139,250,.55) 0 1px, transparent 1.7px), radial-gradient(circle, rgba(244,114,182,.46) 0 1px, transparent 1.6px);
          background-position: 12px 19px, 43px 71px, 88px 31px;
          background-size: 112px 112px, 157px 157px, 193px 193px;
          mask-image: radial-gradient(circle at 50% 36%, #000 0 18%, rgba(0,0,0,.72) 48%, transparent 86%);
          opacity: .25;
          animation: dnaParticles 12s ease-in-out infinite alternate;
        }
        [data-analysis-aura] { animation: dnaAura 5.4s ease-in-out infinite; }
        [data-dna-assembly] { animation: dnaAssemblyFloat 5.2s ease-in-out infinite; }
        [data-dna-rung] {
          position: absolute;
          left: 50%;
          width: 0;
          height: 0;
          transform-style: preserve-3d;
        }
        [data-dna-rung] i { position: absolute; display: block; animation-duration: 5.4s; animation-timing-function: cubic-bezier(.45,.02,.55,.98); animation-iteration-count: infinite; animation-delay: var(--dna-delay); }
        [data-dna-node] {
          top: -6px;
          left: -6px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }
        [data-dna-node="a"] {
          background: radial-gradient(circle at 32% 26%, #ecfeff, #38bdf8 42%, #0369a1 78%);
          box-shadow: 0 0 10px rgba(56,189,248,.94), 0 0 26px rgba(6,182,212,.46);
          animation-name: dnaTurnA;
        }
        [data-dna-node="b"] {
          background: radial-gradient(circle at 32% 26%, #fdf2f8, #f472b6 42%, #be185d 78%);
          box-shadow: 0 0 10px rgba(244,114,182,.92), 0 0 26px rgba(236,72,153,.44);
          animation-name: dnaTurnB;
        }
        [data-dna-bridge] {
          top: -1px;
          left: -82px;
          width: 164px;
          height: 2px;
          border-radius: 999px;
          background: linear-gradient(90deg, rgba(56,189,248,.90), rgba(167,139,250,.76) 48%, rgba(244,114,182,.90));
          box-shadow: 0 0 9px rgba(167,139,250,.42);
          animation-name: dnaBridgeTurn;
        }
        [data-dna-stream] i { animation-duration: 3.2s; animation-timing-function: cubic-bezier(.22,.68,.3,1); animation-iteration-count: infinite; animation-play-state: paused; }
        [data-dna-stream="left"] i { animation-name: dnaStreamLeft; }
        [data-dna-stream="right"] i { animation-name: dnaStreamRight; }
        [data-analysis-running="true"] [data-analysis-aura] { animation-duration: 1.45s; opacity: 1; }
        [data-analysis-running="true"] [data-dna-rung] i { animation-duration: 2.15s; }
        [data-analysis-running="true"] [data-dna-stream] i { animation-play-state: running; }
        [data-analysis-running="true"] [data-dna-assembly] { animation-duration: 2.1s; }
        [data-analysis-progress][data-running="true"] > div > span {
          position: relative;
          overflow: hidden;
        }
        [data-analysis-progress][data-running="true"] > div > span::after {
          content: "";
          position: absolute;
          inset: 0;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,.82), transparent);
          transform: translateX(-100%);
          animation: dnaProgressSweep 1.25s ease-in-out infinite;
        }
        [data-dna-score-help]::after {
          content: attr(data-tooltip);
          position: absolute;
          z-index: 20;
          top: 50%;
          left: calc(100% + 12px);
          width: min(228px, 58vw);
          padding: 11px 13px;
          border: 1px solid rgba(125, 211, 252, .28);
          border-radius: 14px;
          background: linear-gradient(145deg, rgba(8, 24, 49, .98), rgba(35, 23, 70, .98));
          box-shadow: 0 16px 38px rgba(0, 0, 0, .32), 0 0 24px rgba(56, 189, 248, .10);
          color: rgba(239, 246, 255, .88);
          font-size: 10.5px;
          font-weight: 720;
          line-height: 1.42;
          text-align: left;
          white-space: normal;
          letter-spacing: 0;
          pointer-events: none;
          opacity: 0;
          transform: translate(4px, -50%);
          transition: opacity .18s ease, transform .18s ease;
        }
        [data-dna-score-help]:hover::after,
        [data-dna-score-help]:focus-visible::after {
          opacity: 1;
          transform: translate(0, -50%);
        }
        @media (max-width: 640px) {
          [data-dna-score-help]::after {
            top: calc(100% + 10px);
            right: -2px;
            left: auto;
            width: min(220px, calc(100vw - 76px));
            transform: translateY(-4px);
          }
          [data-dna-score-help]:hover::after,
          [data-dna-score-help]:focus-visible::after {
            transform: translateY(0);
          }
        }
        @keyframes dnaAssemblyFloat { 50% { transform: translateY(-5px) scale(1.025); filter: drop-shadow(0 0 24px rgba(139,92,246,.28)); } }
        @keyframes dnaAura { 50% { transform: scale(1.12); opacity: .84; } }
        @keyframes dnaTurnA {
          0%,100% { transform: translate3d(-82px,0,-18px) scale(.62); opacity: .42; filter: saturate(.7); }
          25% { transform: translate3d(0,0,-32px) scale(.42); opacity: .18; }
          50% { transform: translate3d(82px,0,22px) scale(1.18); opacity: 1; filter: saturate(1.2); }
          75% { transform: translate3d(0,0,32px) scale(1.34); opacity: .94; }
        }
        @keyframes dnaTurnB {
          0%,100% { transform: translate3d(82px,0,22px) scale(1.18); opacity: 1; filter: saturate(1.2); }
          25% { transform: translate3d(0,0,32px) scale(1.34); opacity: .94; }
          50% { transform: translate3d(-82px,0,-18px) scale(.62); opacity: .42; filter: saturate(.7); }
          75% { transform: translate3d(0,0,-32px) scale(.42); opacity: .18; }
        }
        @keyframes dnaBridgeTurn {
          0%,50%,100% { transform: scaleX(1); opacity: .68; }
          24%,76% { transform: scaleX(.035); opacity: .12; }
        }
        @keyframes dnaStreamLeft {
          0% { left: 0; transform: scale(.35); opacity: 0; }
          18% { opacity: .82; }
          78% { left: calc(100% - 6px); transform: scale(1.1); opacity: .92; }
          100% { left: calc(100% - 2px); transform: scale(.1); opacity: 0; }
        }
        @keyframes dnaStreamRight {
          0% { right: 0; transform: scale(.35); opacity: 0; }
          18% { opacity: .82; }
          78% { right: calc(100% - 6px); transform: scale(1.1); opacity: .92; }
          100% { right: calc(100% - 2px); transform: scale(.1); opacity: 0; }
        }
        @keyframes dnaAurora { 0% { transform: translate3d(-3%,-2%,0) rotate(-8deg) scale(.94); } 55% { transform: translate3d(3%,1%,0) rotate(7deg) scale(1.04); } 100% { transform: translate3d(-1%,4%,0) rotate(16deg) scale(1.08); } }
        @keyframes dnaParticles { 0% { transform: translate3d(0,0,0); opacity: .18; } 55% { opacity: .36; } 100% { transform: translate3d(18px,-14px,0); opacity: .24; } }
        @keyframes dnaProgressSweep { to { transform: translateX(100%); } }
        @media (min-width: 721px) and (max-width: 1180px) {
          nav[role="tablist"] {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            overflow: visible !important;
          }
        }
        @media (max-width: 720px) {
          nav[data-ai-memory-desktop-tabs] { display: none !important; }
          nav[data-ai-memory-mobile-tabs] { display: grid !important; }
          nav[data-ai-memory-mobile-tabs] button:disabled {
            opacity: .28 !important;
            cursor: default !important;
          }
          section[data-business-dna-channel-analysis] { height: auto !important; min-height: 590px !important; padding: 24px 14px !important; }
          [data-business-dna-analysis-orb] {
            width: 100% !important;
            height: 270px !important;
            box-sizing: border-box;
            padding-top: 48px;
          }
          [data-dna-score-summary] { top: -4px !important; }
          [data-business-dna-channel-states] {
            width: 100% !important;
            flex-wrap: wrap !important;
            justify-content: center !important;
            overflow: visible !important;
            padding: 2px 0 4px;
          }
          [data-business-dna-channel-states] > span {
            min-height: 25px !important;
            padding: 5px 8px !important;
            font-size: 9.8px !important;
          }
          div[data-ai-memory-actions] {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          }
          div[data-ai-memory-actions] button:last-child {
            grid-column: 1 / -1;
          }
          div[data-local-presence-grid] {
            grid-template-columns: 1fr !important;
          }
          div[data-ai-memory-active-tab] {
            animation: aiMemoryMobileTabEnter .22s ease both;
            touch-action: pan-y;
          }
        }
        @keyframes aiMemoryMobileTabEnter {
          from { opacity: .55; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          section[data-business-dna-channel-analysis]::before,
          section[data-business-dna-channel-analysis]::after,
          [data-business-dna-analysis-orb] span,
          [data-analysis-progress] span::after { animation: none !important; }
        }
      `}</style>
    </div>
  );
}

function SectionHeader({ icon, title, description, trailing }: { icon: string; title: string; description: string; trailing?: ReactNode }) {
  return (
    <header style={sectionHeaderStyle}>
      <span aria-hidden style={sectionIconStyle}>{icon}</span>
      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <strong style={{ color: "white", fontSize: 15 }}>{title}</strong>
        <span style={hintStyle}>{description}</span>
      </span>
      {trailing ? <span style={{ marginLeft: "auto", flex: "0 0 auto" }}>{trailing}</span> : null}
    </header>
  );
}

function CompletionPill({ label, score }: { label: string; score: number }) {
  return (
    <span aria-label={`${label} : ${score}%`} title={label} style={completionPillStyle}>
      <span aria-hidden style={completionPillSparkStyle}>✦</span>
      <strong>{score}%</strong>
    </span>
  );
}

function PremiumTextarea({ label, placeholder, value, html, disabled, onChange }: { label: string; placeholder: string; value: string; html: string; disabled: boolean; onChange: (next: { text: string; html: string }) => void }) {
  return (
    <div style={{ ...fieldStyle, opacity: disabled ? 0.56 : 1 }}>
      <BusinessDnaRichTextEditor label={label} value={value} html={html} disabled={disabled} maxLength={5000} minHeight={112} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

const pageStyle: CSSProperties = { display: "grid", gap: 11, width: "100%", maxWidth: 1380, margin: "0 auto", paddingBottom: "max(14px, var(--inrcy-safe-area-bottom))" };
const cardStyle: CSSProperties = { display: "grid", gap: 18, padding: "clamp(14px, 2.2vw, 22px)", borderRadius: 20, border: "1px solid rgba(125,211,252,0.17)", background: "linear-gradient(145deg, rgba(11,27,52,0.82), rgba(31,23,58,0.70))", boxShadow: "0 16px 44px rgba(0,0,0,0.18)", minWidth: 0 };
const analysisLandingStyle: CSSProperties = { position: "relative", isolation: "isolate", overflow: "hidden", height: "clamp(610px, calc(100svh - 245px), 780px)", minHeight: 0, display: "grid", justifyItems: "center", alignContent: "center", gap: "clamp(15px, 1.8vh, 22px)", padding: "clamp(24px, 3vw, 40px) clamp(14px, 3vw, 34px)", borderRadius: 22, border: "1px solid rgba(125,211,252,0.20)", background: "radial-gradient(circle at 50% 28%, rgba(79,70,229,0.22), transparent 31%), radial-gradient(circle at 15% 15%, rgba(6,182,212,0.10), transparent 28%), radial-gradient(circle at 88% 86%, rgba(236,72,153,0.10), transparent 29%), linear-gradient(145deg, rgba(5,18,39,0.96), rgba(24,11,48,0.93))", boxShadow: "0 24px 68px rgba(0,0,0,0.24)", textAlign: "center" };
const analysisOrbStageStyle: CSSProperties = { position: "relative", width: "min(530px, 92vw)", height: 285, display: "grid", placeItems: "center", perspective: 760 };
const analysisScoreBubbleStyle: CSSProperties = { position: "absolute", zIndex: 8, top: -24, left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 34, padding: "7px 9px 7px 13px", borderRadius: 999, border: "1px solid rgba(125,211,252,.30)", background: "linear-gradient(115deg, rgba(3,20,48,.96), rgba(45,25,91,.96) 58%, rgba(91,22,72,.94))", boxShadow: "0 12px 30px rgba(0,0,0,.30), 0 0 25px rgba(124,58,237,.20)", color: "rgba(226,232,240,.82)", fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap", letterSpacing: ".01em" };
const analysisScoreHelpStyle: CSSProperties = { position: "relative", width: 19, height: 19, display: "inline-grid", placeItems: "center", borderRadius: "50%", border: "1px solid rgba(165,243,252,.38)", background: "rgba(56,189,248,.12)", color: "#a5f3fc", fontSize: 10.5, fontWeight: 950, lineHeight: 1, cursor: "help", outline: "none", boxShadow: "0 0 12px rgba(56,189,248,.18)" };
const analysisOrbAuraStyle: CSSProperties = { position: "absolute", inset: "4% 12%", borderRadius: "46%", background: "radial-gradient(ellipse, rgba(124,58,237,0.40), rgba(6,182,212,0.14) 43%, rgba(236,72,153,.08) 58%, transparent 74%)", filter: "blur(23px)", opacity: 0.72 };
const analysisDnaAssemblyStyle: CSSProperties = { position: "relative", zIndex: 4, width: 210, height: 220, display: "grid", placeItems: "center", transformStyle: "preserve-3d" };
const analysisDnaModelStyle: CSSProperties = { position: "relative", width: 184, height: 188, transform: "translateY(-13px) rotate(-2deg)", transformStyle: "preserve-3d", filter: "drop-shadow(0 0 22px rgba(139,92,246,.24))" };
const analysisStreamLeftStyle: CSSProperties = { position: "absolute", zIndex: 2, left: 0, top: "16%", width: "calc(50% - 110px)", height: "68%", overflow: "hidden", maskImage: "linear-gradient(90deg, transparent, black 20%, black)" };
const analysisStreamRightStyle: CSSProperties = { position: "absolute", zIndex: 2, right: 0, top: "16%", width: "calc(50% - 110px)", height: "68%", overflow: "hidden", maskImage: "linear-gradient(270deg, transparent, black 20%, black)" };
const analysisStreamParticleStyle: CSSProperties = { position: "absolute", width: 5, height: 5, borderRadius: "50%", background: "#fdf2f8", boxShadow: "0 0 8px #f472b6, 0 0 20px rgba(56,189,248,.72)", opacity: 0.24 };
const analysisIntroStyle: CSSProperties = { width: "min(680px, 100%)", display: "grid", justifyItems: "center", gap: 8 };
const analysisTitleStyle: CSSProperties = { margin: 0, color: "white", fontSize: "clamp(22px, 2.7vw, 34px)", lineHeight: 1.08, letterSpacing: "-0.035em", textWrap: "balance" };
const analysisDescriptionStyle: CSSProperties = { margin: 0, maxWidth: 650, color: "rgba(213,226,250,0.70)", fontSize: "clamp(11.5px, 1.25vw, 13.5px)", lineHeight: 1.42, textWrap: "balance" };
const analysisChannelRailStyle: CSSProperties = { width: "min(1060px, 100%)", display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 6, minWidth: 0 };
const analysisChannelPillStyle: CSSProperties = { minHeight: 27, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "5px 9px", borderRadius: 999, fontSize: 10.5, fontWeight: 850, lineHeight: 1, whiteSpace: "nowrap", transition: "border-color .18s ease, background .18s ease, box-shadow .18s ease, color .18s ease" };
const analysisChannelConnectedStyle: CSSProperties = { border: "1px solid rgba(103,232,249,.34)", background: "linear-gradient(115deg, rgba(8,145,178,.18), rgba(109,40,217,.18) 60%, rgba(219,39,119,.15))", color: "rgba(240,249,255,.94)", boxShadow: "0 0 15px rgba(56,189,248,.12), 0 0 18px rgba(168,85,247,.10)" };
const analysisChannelDisconnectedStyle: CSSProperties = { border: "1px solid rgba(148,163,184,.13)", background: "rgba(71,85,105,.09)", color: "rgba(203,213,225,.46)" };
const analysisChannelReconnectStyle: CSSProperties = { border: "1px solid rgba(251,146,60,.38)", background: "linear-gradient(115deg, rgba(194,65,12,.18), rgba(190,24,93,.18))", color: "#fed7aa", boxShadow: "0 0 16px rgba(244,114,182,.12)" };
const analysisChannelDotStyle: CSSProperties = { width: 6, height: 6, flex: "0 0 auto", borderRadius: "50%" };
const analysisChannelConnectedDotStyle: CSSProperties = { background: "#38bdf8", boxShadow: "0 0 7px #38bdf8, 0 0 13px rgba(244,114,182,.72)" };
const analysisChannelDisconnectedDotStyle: CSSProperties = { background: "#64748b", boxShadow: "none" };
const analysisChannelReconnectDotStyle: CSSProperties = { background: "#fb923c", boxShadow: "0 0 8px rgba(251,146,60,.78)" };
const analysisChannelReconnectIconStyle: CSSProperties = { color: "#f9a8d4", fontSize: 11.5, fontWeight: 950, lineHeight: 1 };
const analysisQuotaStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, color: "rgba(221,214,254,.78)", fontSize: 10.5, fontWeight: 800 };
const analysisQuotaDotStyle: CSSProperties = { width: 6, height: 6, borderRadius: "50%", background: "#f472b6", boxShadow: "0 0 10px rgba(244,114,182,.72)" };
const analysisProgressStyle: CSSProperties = { width: "min(650px, 88%)", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 11, padding: "3px 0" };
const analysisActionGroupStyle: CSSProperties = { display: "grid", justifyItems: "center", gap: 9 };
const analysisPrivacyStyle: CSSProperties = { maxWidth: 720, color: "rgba(165,243,252,0.58)", fontSize: 10, lineHeight: 1.35 };
const analysisButtonStyle: CSSProperties = { minHeight: 42, borderRadius: 13, border: "1px solid rgba(103,232,249,0.40)", background: "linear-gradient(105deg, rgba(8,145,178,0.96), rgba(109,40,217,0.96) 58%, rgba(219,39,119,0.92))", color: "white", padding: "9px 18px", fontSize: 12.5, fontWeight: 950, boxShadow: "0 13px 32px rgba(124,58,237,0.24)" };
const analysisReportStyle: CSSProperties = { display: "grid", gap: 9, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" };
const analysisErrorStyle: CSSProperties = { borderRadius: 11, border: "1px solid rgba(248,113,113,0.26)", background: "rgba(127,29,29,0.16)", color: "#fecaca", padding: "9px 11px", fontSize: 11.5, fontWeight: 750 };
const scoreStyle: CSSProperties = { minWidth: 38, color: "#ddd6fe", fontSize: 12, textAlign: "right" };
const progressTrackStyle: CSSProperties = { height: 5, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,0.09)" };
const progressValueStyle: CSSProperties = { display: "block", height: "100%", minWidth: 4, borderRadius: 999, background: "linear-gradient(90deg, #38bdf8, #8b5cf6 58%, #ec4899)", boxShadow: "0 0 18px rgba(139,92,246,.42)", transition: "width .25s ease" };
const tabListStyle: CSSProperties = { position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 7, padding: 6, overflowX: "auto", scrollSnapType: "x proximity", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(5,13,28,0.94)", boxShadow: "0 12px 34px rgba(0,0,0,0.20)", backdropFilter: "blur(18px)" };
const tabButtonStyle: CSSProperties = { minWidth: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 7, borderRadius: 11, border: "1px solid transparent", background: "transparent", color: "rgba(255,255,255,0.66)", padding: "9px 7px", cursor: "pointer", fontSize: 12.5, fontWeight: 850, whiteSpace: "nowrap" };
const activeTabButtonStyle: CSSProperties = { border: "1px solid rgba(125,211,252,0.28)", background: "linear-gradient(135deg, rgba(14,165,233,0.18), rgba(124,58,237,0.18))", color: "white", boxShadow: "0 7px 22px rgba(14,165,233,0.10)" };
const mobileTabNavigatorStyle: CSSProperties = { position: "relative", zIndex: 3, display: "none", gridTemplateColumns: "42px minmax(0, 1fr) 42px", alignItems: "stretch", gap: 7, padding: 7, borderRadius: 16, border: "1px solid rgba(125,211,252,.20)", background: "linear-gradient(135deg, rgba(4,18,38,.98), rgba(25,16,54,.98))", boxShadow: "0 13px 34px rgba(0,0,0,.24)" };
const mobileTabArrowStyle: CSSProperties = { minWidth: 0, minHeight: 48, display: "grid", placeItems: "center", borderRadius: 11, border: "1px solid rgba(125,211,252,.18)", background: "rgba(56,189,248,.08)", color: "rgba(240,249,255,.92)", fontSize: 19, fontWeight: 900, cursor: "pointer" };
const mobileTabCurrentStyle: CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", columnGap: 8, rowGap: 5, padding: "3px 4px" };
const mobileTabLabelStyle: CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: "white", fontSize: 11.5, lineHeight: 1.2, textAlign: "center" };
const mobileTabPositionStyle: CSSProperties = { color: "rgba(186,230,253,.72)", fontSize: 10.5, fontWeight: 850, whiteSpace: "nowrap" };
const mobileTabProgressTrackStyle: CSSProperties = { gridColumn: "1 / -1", height: 3, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.08)" };
const mobileTabProgressValueStyle: CSSProperties = { display: "block", height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #38bdf8, #8b5cf6 58%, #ec4899)", transition: "width .2s ease" };
const miniPremiumBadgeStyle: CSSProperties = { width: 8, height: 8, flex: "0 0 auto", borderRadius: 999, border: "1px solid rgba(253,230,138,0.86)", background: "#fbbf24", boxShadow: "0 0 11px rgba(251,191,36,0.65)" };
const tabPanelStyle: CSSProperties = { minWidth: 0 };
const sectionStackStyle: CSSProperties = { display: "grid", gap: 15, minWidth: 0 };
const foundationCardStyle: CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 11, padding: "11px 14px", borderRadius: 16, border: "1px solid rgba(103,232,249,0.22)", background: "linear-gradient(145deg, rgba(8,145,178,0.13), rgba(38,20,78,0.68))", boxShadow: "0 14px 38px rgba(0,0,0,.16)" };
const foundationCompactIconStyle: CSSProperties = { width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 11, border: "1px solid rgba(103,232,249,.22)", background: "rgba(56,189,248,.10)" };
const foundationCompactContentStyle: CSSProperties = { display: "grid", gap: 3, minWidth: 0 };
const foundationCompactValuesStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "5px 12px", color: "white", fontSize: 12.5, lineHeight: 1.35 };
const foundationCompactLabelStyle: CSSProperties = { color: "#67e8f9", fontSize: 10.5, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em" };
const foundationCompactDividerStyle: CSSProperties = { width: 1, height: 15, background: "rgba(255,255,255,.15)" };
const foundationCompactHintStyle: CSSProperties = { color: "rgba(203,213,225,.60)", fontSize: 10.5, lineHeight: 1.35 };
const sectionHeadingRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start", gap: 12 };
const sectionHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 11, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.09)" };
const sectionIconStyle: CSSProperties = { width: 36, height: 36, flex: "0 0 auto", display: "grid", placeItems: "center", borderRadius: 11, border: "1px solid rgba(125,211,252,0.22)", background: "rgba(56,189,248,0.10)" };
const completionPillStyle: CSSProperties = { minWidth: 61, height: 31, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 9px", borderRadius: 999, border: "1px solid rgba(196,181,253,0.25)", background: "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(124,58,237,0.18))", color: "#ddd6fe", fontSize: 11.5, boxShadow: "0 7px 22px rgba(76,29,149,0.13)" };
const completionPillSparkStyle: CSSProperties = { color: "#67e8f9", fontSize: 10, textShadow: "0 0 10px rgba(103,232,249,.72)" };
const fieldStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0 };
const labelStyle: CSSProperties = { color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: 850, lineHeight: 1.35 };
const hintStyle: CSSProperties = { color: "rgba(255,255,255,0.60)", fontSize: 11.5, lineHeight: 1.4 };
const twoColumnsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 18, minWidth: 0 };
const identityCoreGridStyle: CSSProperties = { display: "grid", gap: 12, minWidth: 0 };
const identityMissionCardStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0, padding: 13, borderRadius: 16, border: "1px solid rgba(56,189,248,0.18)", background: "linear-gradient(145deg, rgba(8,47,73,.28), rgba(20,20,54,.38))" };
const identityMissionHeadingStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 };
const identityTagRowsStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0 };
const identityTagRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "8px 18px", minWidth: 0, padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(167,139,250,0.14)", background: "linear-gradient(145deg, rgba(30,41,79,.34), rgba(41,23,70,.25))" };
const identityTagLabelStyle: CSSProperties = { flex: "1 1 180px", maxWidth: 235, paddingTop: 9, color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: 850, lineHeight: 1.35 };
const identityTagContentStyle: CSSProperties = { flex: "5 1 560px", minWidth: 0 };
const identityTextareaStyle: CSSProperties = { width: "100%", minHeight: 104, resize: "vertical", borderRadius: 13, border: "1px solid rgba(255,255,255,0.13)", background: "rgba(3,10,30,0.52)", color: "white", padding: "11px 12px", font: "inherit", fontSize: 12.5, lineHeight: 1.5, outline: "none" };
const identityCounterStyle: CSSProperties = { flex: "0 0 auto", color: "rgba(255,255,255,0.42)", fontSize: 10.5 };
const identityVocabularySectionStyle: CSSProperties = { display: "grid", gap: 14, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.09)" };
const identityVocabularyHeadingStyle: CSSProperties = { display: "grid", gap: 3 };
const identityVocabularyTitleStyle: CSSProperties = { color: "white", fontSize: 14.5, lineHeight: 1.3 };
const localTabStyle: CSSProperties = { minHeight: "clamp(500px, calc(100svh - 305px), 650px)", display: "grid", alignItems: "stretch" };
const localPresenceGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(240px, .30fr) minmax(0, .70fr)", alignItems: "stretch", gap: 12 };
const localZonesCardStyle: CSSProperties = { display: "grid", alignContent: "start", gap: 12, padding: 16, borderRadius: 18, border: "1px solid rgba(56,189,248,0.18)", background: "linear-gradient(145deg, rgba(10,39,68,.72), rgba(20,21,56,.62))", boxShadow: "0 16px 44px rgba(0,0,0,.16)" };
const localScheduleCardStyle: CSSProperties = { display: "grid", alignContent: "start", gap: 9, padding: 14, borderRadius: 18, border: "1px solid rgba(167,139,250,0.18)", background: "linear-gradient(145deg, rgba(18,27,62,.72), rgba(42,22,72,.62))", boxShadow: "0 16px 44px rgba(0,0,0,.16)" };
const checkboxGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 9 };
const choiceStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.88)" };
const selectedChoiceStyle: CSSProperties = { border: "1px solid rgba(56,189,248,0.34)", background: "rgba(56,189,248,0.10)" };
const premiumCardStyle: CSSProperties = { border: "1px solid rgba(251,191,36,0.28)", background: "linear-gradient(145deg, rgba(92,55,7,0.20), rgba(49,24,71,0.66))" };
const premiumGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 14 };
const premiumBadgeStyle: CSSProperties = { flex: "0 0 auto", borderRadius: 999, border: "1px solid rgba(251,191,36,0.38)", background: "rgba(251,191,36,0.13)", color: "#fde68a", padding: "5px 9px", fontSize: 10.5, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em" };
const lockedNoticeStyle: CSSProperties = { borderRadius: 12, border: "1px solid rgba(251,191,36,0.20)", background: "rgba(120,53,15,0.16)", color: "#fde68a", padding: "10px 11px", fontSize: 12, lineHeight: 1.4, fontWeight: 800 };
const actionsStyle: CSSProperties = { position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "minmax(105px, 130px) minmax(135px, 175px) minmax(220px, 310px)", justifyContent: "end", gap: 8, padding: "2px 0 0", background: "transparent" };
const secondaryButtonStyle: CSSProperties = { minHeight: 38, borderRadius: 11, border: "1px solid rgba(255,255,255,0.13)", background: "rgba(255,255,255,0.05)", color: "white", padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 800 };
const dangerButtonStyle: CSSProperties = { minHeight: 38, borderRadius: 11, border: "1px solid rgba(248,113,113,0.22)", background: "rgba(127,29,29,0.13)", color: "#fecaca", padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 850 };
const primaryButtonStyle: CSSProperties = { minHeight: 38, borderRadius: 11, border: "1px solid rgba(196,181,253,0.38)", background: "linear-gradient(100deg, #0ea5e9, #7c3aed 55%, #ec4899)", color: "white", padding: "8px 11px", cursor: "pointer", fontSize: 12.5, fontWeight: 950, boxShadow: "0 10px 24px rgba(124,58,237,0.18)" };
const errorStyle: CSSProperties = { padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.30)", background: "rgba(127,29,29,0.18)", color: "#fecaca", fontSize: 13, fontWeight: 800 };
const successStyle: CSSProperties = { padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(103,232,249,0.28)", background: "rgba(8,145,178,0.14)", color: "#a5f3fc", fontSize: 13, fontWeight: 850 };
