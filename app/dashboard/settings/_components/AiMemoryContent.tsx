"use client";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";

import { useDashboardViewerAccess } from "../../_components/DashboardViewerAccessProvider";
import DrawerHeaderTabs from "../../DrawerHeaderTabs";
import DashboardMobileSelect from "../../_components/DashboardMobileSelect";
import { useInrAssistantBusinessFormCommands, type BusinessFormActionScope } from "../../_hooks/useInrAssistantBusinessFormCommands";
import { useInrAssistantLocalInterface } from "../../_hooks/useInrAssistantLocalInterface";
import type { InrAssistantBusinessFormPatch } from "@/lib/inrAssistantBusinessFormUiCommands";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useLocale, useTranslations } from "next-intl";
import { createPortal } from "react-dom";

import { invalidateBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import { uploadFileToPreparedStorageIntent } from "@/lib/universalMediaUploadClient";
import {
  BUSINESS_DNA_DASHBOARD_CHANNELS,
  type BusinessDnaDashboardChannelAvailability,
} from "@/lib/businessDnaChannelAvailability";
import {
  buildBusinessDnaWorkspaceSavePatch,
  isBusinessDnaManualAnalysisPending,
  parseBusinessDnaManualAnalysisJob,
  type BusinessDnaManualAnalysisJob,
} from "@/lib/businessDnaManualAnalysisJob";
import {
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
  AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES,
  EMPTY_AI_BUSINESS_KNOWLEDGE,
  EMPTY_AI_MEMORY,
  getAiMemoryReferenceDocumentStorage,
  getAiWorkspaceCompletionScore,
  mergeAiBusinessDnaAnalysis,
  normalizeAiBusinessKnowledge,
  normalizeAiMemory,
  updateAiMemoryRecentNewsItem,
  type AiBusinessKnowledge,
  type AiMemory,
  type AiMemoryReferenceDocument,
} from "@/lib/aiMemory";
import { type DashboardEdition } from "@/lib/dashboardEdition";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { refreshPublicProfileDependents } from "@/lib/publicProfileRefreshClient";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import { useInrAssistantRefresh } from "../../_hooks/useInrAssistantRefresh";
import { reconcileSavedDraft } from "@/lib/reconcileSavedDraft";
import MediaSubjectVoiceButton from "../../_components/MediaSubjectVoiceButton";
import BusinessDnaRichTextEditor from "./BusinessDnaRichTextEditor";
import type { InrAssistantBusinessRichTextField } from "@/lib/inrAssistantBusinessRichText";
import BusinessDnaAnalysisScheduleModal from "./BusinessDnaAnalysisScheduleModal";
import BusinessScheduleEditor from "./BusinessScheduleEditor";
import BusinessDnaAnalysisWorkspace from "./BusinessDnaAnalysisWorkspace";
import EditableTags from "./EditableTags";
import ActivityContent, { type ActivityContentHandle } from "./ActivityContent";
import ProfilContent, { type ProfilContentHandle } from "./ProfilContent";
import BusinessLocationFields, { type BusinessLocationFieldsHandle } from "./BusinessLocationFields";

export type AiMemoryWorkspaceTab =
  | "analysis"
  | "documents"
  | "profile"
  | "activity"
  | "audience"
  | "local"
  | "identity"
  | "news"
  | "strategy";
type EmbeddedWorkspaceTab = Extract<AiMemoryWorkspaceTab, "profile" | "activity" | "local">;
type VoiceTarget =
  | "detailedDescription"
  | "mission"
  | "scheduleNotes"
  | "offersAndArguments"
  | "keyArguments"
  | "proofsAndObjections"
  | "objectionResponses"
  | "editorialStrategy"
  | "campaignCalendar"
  | "recentNewsItem0"
  | "recentNewsItem1"
  | "recentNewsItem2"
  | "recentNewsItem3";
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

function summaryFromAnalysisJob(job: BusinessDnaManualAnalysisJob): AnalysisSummary {
  const applied = job.result.applied as Record<string, unknown> | undefined;
  return {
    analyzedAt: job.status === "succeeded" ? String(job.result.analyzedAt || job.completedAt || "") : "",
    changedFields: Array.isArray(applied?.changedFields) ? applied.changedFields as string[] : [],
    addedItems: Math.max(0, Number(applied?.addedItems || 0)),
    sources: Array.isArray(job.result.sources) ? job.result.sources as AnalysisSource[] : [],
  };
}

const RECENT_NEWS_SOURCE_LABELS: Record<string, string> = {
  google_business: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
  inrcy_publications: "iNrCy",
};

type Props = {
  edition?: DashboardEdition;
  initialTab?: AiMemoryWorkspaceTab;
  visibleTabs?: readonly AiMemoryWorkspaceTab[];
  hideNavigation?: boolean;
  assistantActive?: boolean;
  vocabularyPortalTarget?: HTMLDivElement | null;
  profileLabel?: string;
  onTabChange?: (tab: AiMemoryWorkspaceTab) => void;
  onProfileSaved?: () => unknown | Promise<unknown>;
  onProfileReset?: () => unknown | Promise<unknown>;
  onActivitySaved?: () => unknown | Promise<unknown>;
  onActivityReset?: () => unknown | Promise<unknown>;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  onVoiceBusyChange?: (busy: boolean) => void;
  onAnalysisCompleted?: () => void;
};

export type AiMemoryContentHandle = {
  /** Enregistre toutes les modifications encore en attente. */
  savePendingChanges: () => Promise<boolean>;
  /** Abandonne explicitement les modifications locales encore en attente. */
  discardPendingChanges: () => void;
  runAssistantAction: (patch: InrAssistantBusinessFormPatch, scopeCurrent: BusinessFormActionScope) => Promise<boolean>;
  selectTab?: (tab: AiMemoryWorkspaceTab) => void;
};

type WorkspaceSaveReason = "manual" | "auto" | "tab-change" | "analysis" | "exit";
type WorkspaceSaveOptions = {
  reason?: WorkspaceSaveReason;
  /**
   * Une analyse construit son résultat dans le navigateur. Ce brouillon est
   * passé explicitement afin d'être persisté dans la même opération, sans
   * attendre le prochain cycle de rendu ou une sauvegarde manuelle.
   */
  aiMemoryDraft?: {
    memory: AiMemory;
    businessKnowledge: AiBusinessKnowledge;
    profession?: unknown;
  };
};

function apiErrorMessage(payload: unknown, fallback: string) {
  return getSafeClientErrorMessage(payload, fallback);
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

const AiMemoryContent = forwardRef<AiMemoryContentHandle, Props>(function AiMemoryContent({
  initialTab = "analysis",
  visibleTabs,
  hideNavigation = false,
  assistantActive = true,
  vocabularyPortalTarget = null,
  profileLabel = "Mon profil",
  onTabChange,
  onProfileSaved,
  onProfileReset,
  onActivitySaved,
  onActivityReset,
  onUnsavedChange,
  onVoiceBusyChange,
  onAnalysisCompleted,
}: Props, ref) {
  const { metaPilotEnabled, actorUserId, activeAccountId } = useDashboardViewerAccess();
  const resetViewerRef = useRef({ actorUserId, activeAccountId });
  useLayoutEffect(() => { resetViewerRef.current = { actorUserId, activeAccountId }; });
  const [resetDialogTab, setResetDialogTab] = useState<AiMemoryWorkspaceTab | "all" | null>(null);
  const t = useTranslations("dashboard.aiMemory");
  const locale = useLocale();
  const settingsT = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<AiMemoryWorkspaceTab>(initialTab === "documents" ? "analysis" : initialTab);
  const [mountedEmbeddedTabs, setMountedEmbeddedTabs] = useState<Set<EmbeddedWorkspaceTab>>(
    () => new Set(
      initialTab === "profile" || initialTab === "activity" || initialTab === "local" ? [initialTab] : [],
    ),
  );
  const [profileDirty, setProfileDirty] = useState(false);
  const [activityDirty, setActivityDirty] = useState(false);
  const [locationDirty, setLocationDirty] = useState(false);
  const [memory, setMemory] = useState<AiMemory>(EMPTY_AI_MEMORY);
  const [businessKnowledge, setBusinessKnowledge] = useState<AiBusinessKnowledge>(
    EMPTY_AI_BUSINESS_KNOWLEDGE,
  );
  // La stratégie fait désormais partie du socle iNrADN de toutes les éditions.
  const strategyEnabled = true;
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [completedLoadAttempt, setCompletedLoadAttempt] = useState(-1);
  const [saving, setSaving] = useState(false);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [profileDraftSignature, setProfileDraftSignature] = useState("");
  const [activityDraftSignature, setActivityDraftSignature] = useState("");
  const [locationDraftSignature, setLocationDraftSignature] = useState("");
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "scheduled" | "saving" | "failed">("idle");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisJob, setAnalysisJob] = useState<BusinessDnaManualAnalysisJob | null>(null);
  const analysisAccountIdRef = useRef("");
  const [voiceTarget, setVoiceTarget] = useState<VoiceTarget | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisSummary | null>(null);
  const [excludedAnalysisChannels, setExcludedAnalysisChannels] = useState<Set<string>>(() => new Set());
  const [analysisQuota, setAnalysisQuota] = useState<AnalysisQuota | null>(null);
  const [analysisScheduleOpen, setAnalysisScheduleOpen] = useState(false);
  const [documentAnalysisConsent, setDocumentAnalysisConsent] = useState(false);
  const [documentUploadState, setDocumentUploadState] = useState<
    "idle" | "uploading" | "analysing" | "deleting"
  >("idle");
  const [documentUploadError, setDocumentUploadError] = useState("");
  const [analysisChannels, setAnalysisChannels] =
    useState<BusinessDnaDashboardChannelAvailability[]>(disconnectedAnalysisChannels);
  const memoryRef = useRef<AiMemory>(EMPTY_AI_MEMORY);
  const businessKnowledgeRef = useRef<AiBusinessKnowledge>(EMPTY_AI_BUSINESS_KNOWLEDGE);
  const savedSignatureRef = useRef(
    workspaceSignature(EMPTY_AI_MEMORY, EMPTY_AI_BUSINESS_KNOWLEDGE),
  );
  const analysisProgressTimerRef = useRef<number | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const tabSwipeStartRef = useRef<{ x: number; y: number; enabled: boolean } | null>(null);
  const voiceTargetRef = useRef<VoiceTarget | null>(null);
  const profileContentRef = useRef<ProfilContentHandle | null>(null);
  const activityContentRef = useRef<ActivityContentHandle | null>(null);
  const businessLocationRef = useRef<BusinessLocationFieldsHandle | null>(null);
  const [activityContentRevision, setActivityContentRevision] = useState(0);
  const [profileContentRevision, setProfileContentRevision] = useState(0);
  const [locationContentRevision, setLocationContentRevision] = useState(0);
  const autoSaveTimerRef = useRef<number | null>(null);
  const failedAutoSaveSignatureRef = useRef<string | null>(null);
  const workspaceSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const profileDraftRef = useRef({ dirty: false, signature: "" });
  const activityDraftRef = useRef({ dirty: false, signature: "" });
  const locationDraftRef = useRef({ dirty: false, signature: "" });
  const workspaceOwnerRef = useRef({ accountId: "", browserScope: "" });
  const workspaceMountedRef = useRef(true);
  const memorySaveRunningRef = useRef(false);
  const assistantBusyRef = useRef(false);

  useEffect(() => {
    workspaceMountedRef.current = true;
    return () => { workspaceMountedRef.current = false; };
  }, []);

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
    includePremium: strategyEnabled,
  });
  const documentStorage = useMemo(
    () => getAiMemoryReferenceDocumentStorage(memory.referenceDocuments),
    [memory.referenceDocuments],
  );
  const documentStorageUsedMb = documentStorage.usedBytes / (1024 * 1024);
  const documentStorageLimitMb = documentStorage.limitBytes / (1024 * 1024);
  const documentStorageLabel = t("documentsStorageUsage", {
    used: Number(documentStorageUsedMb.toFixed(1)),
    limit: Number(documentStorageLimitMb.toFixed(0)),
  });
  const documentStorageStatusLabel =
    documentStorage.status === "reached"
      ? t("documentsStorageReached")
      : documentStorage.status === "near"
        ? t("documentsStorageNear")
        : t("documentsStorageAvailable");
  const memoryDirty = !loading && loaded && signature !== savedSignatureRef.current;
  const hasWorkspaceChanges = memoryDirty || profileDirty || activityDirty || locationDirty;
  useInrAssistantLocalInterface("dna_sources", { loaded, loading, completedLoadAttempt, error }, {
    retry: { invoke: () => setLoadAttempt(attempt => attempt + 1), matches: snapshot => Boolean(snapshot && typeof snapshot === "object" && "completedLoadAttempt" in snapshot && "loading" in snapshot && "loaded" in snapshot && "error" in snapshot && Number(snapshot.completedLoadAttempt) > loadAttempt && snapshot.loading === false && snapshot.loaded === true && !snapshot.error) },
  }, assistantActive, loading || saving || workspaceSaving || analyzing || voiceTarget !== null || hasWorkspaceChanges || documentUploadState !== "idle" || !error);
  const workspaceDraftSignature = useMemo(
    () => [
      signature,
      profileDirty ? profileDraftSignature : "",
      activityDirty ? activityDraftSignature : "",
      locationDirty ? locationDraftSignature : "",
    ].join("::"),
    [activityDirty, activityDraftSignature, locationDirty, locationDraftSignature, profileDirty, profileDraftSignature, signature],
  );
  const voiceBusy = voiceTarget !== null;
  assistantBusyRef.current = loading || !loaded || saving || workspaceSaving || analyzing || voiceBusy || documentUploadState !== "idle" || analysisScheduleOpen || autoSaveState === "scheduled" || autoSaveState === "saving";
  const voiceOperationsLocked = saving || analyzing || loading || !loaded;
  const voiceDisabledFor = (target: VoiceTarget) =>
    voiceOperationsLocked || (voiceTarget !== null && voiceTarget !== target);
  const handleVoiceBusyChange = (target: VoiceTarget, busy: boolean) => {
    const current = voiceTargetRef.current;
    const next = busy ? target : current === target ? null : current;
    voiceTargetRef.current = next;
    setVoiceTarget(next);
    onVoiceBusyChange?.(next !== null);
  };

  const markWorkspaceDraftUpdated = useCallback(() => {
    failedAutoSaveSignatureRef.current = null;
    setWorkspaceError("");
    setAutoSaveState("idle");
  }, []);

  const handleProfileUnsavedChange = useCallback(
    (dirty: boolean, draftSignature = "") => {
      profileDraftRef.current = { dirty, signature: draftSignature };
      setProfileDirty(dirty);
      setProfileDraftSignature(draftSignature);
      if (dirty) markWorkspaceDraftUpdated();
    },
    [markWorkspaceDraftUpdated],
  );

  const handleActivityUnsavedChange = useCallback(
    (dirty: boolean, draftSignature = "") => {
      activityDraftRef.current = { dirty, signature: draftSignature };
      setActivityDirty(dirty);
      setActivityDraftSignature(draftSignature);
      if (dirty) markWorkspaceDraftUpdated();
    },
    [markWorkspaceDraftUpdated],
  );

  const handleLocationUnsavedChange = useCallback(
    (dirty: boolean, draftSignature = "") => {
      locationDraftRef.current = { dirty, signature: draftSignature };
      setLocationDirty(dirty);
      setLocationDraftSignature(draftSignature);
      if (dirty) markWorkspaceDraftUpdated();
    },
    [markWorkspaceDraftUpdated],
  );

  useInrAssistantRefresh({ topics: ["business"], scopeKey: analysisAccountIdRef.current, blocked: assistantBusyRef.current || hasWorkspaceChanges, refresh: async ({ accountId, canApply }) => {
    const canRefresh = () => canApply() && workspaceMountedRef.current && !assistantBusyRef.current && !memorySaveRunningRef.current && !workspaceSavePromiseRef.current && !voiceTargetRef.current && autoSaveTimerRef.current === null
      && !profileDraftRef.current.dirty && !activityDraftRef.current.dirty && !locationDraftRef.current.dirty
      && workspaceSignature(memoryRef.current, businessKnowledgeRef.current) === savedSignatureRef.current
      && analysisAccountIdRef.current === accountId && workspaceOwnerRef.current.accountId === accountId
      && (getActiveBrowserUserId() || "") === accountId && workspaceOwnerRef.current.browserScope === accountId;
    if (!canRefresh()) return false;
    const [response, quotaResponse] = await Promise.all([
      fetch("/api/ai-memory", { cache: "no-store", credentials: "include" }),
      fetch("/api/ai-memory/analyze-channels", { cache: "no-store", credentials: "include" }),
    ]);
    const [payload, quotaPayload] = await Promise.all([response.json(), quotaResponse.json()]);
    if (!response.ok || !quotaResponse.ok || payload.ok !== true || quotaPayload.ok !== true || payload.accountId !== accountId || quotaPayload.accountId !== accountId || !canRefresh()) return false;
    const nextStrategyEnabled = payload.strategyEnabled !== false, rawFoundation = payload.profileFoundation || {}, rawKnowledge = payload.businessKnowledge || {};
    const nextMemory = normalizeAiMemory(payload.memory, { includePremium: nextStrategyEnabled });
    const nextKnowledge = normalizeAiBusinessKnowledge({ ...rawKnowledge, description: rawKnowledge.description ?? nextMemory.detailedDescription, services: rawKnowledge.services ?? rawFoundation.services ?? [], strengths: rawKnowledge.strengths ?? nextMemory.differentiators });
    const synchronizedMemory = normalizeAiMemory({ ...nextMemory, detailedDescription: nextKnowledge.description, differentiators: nextKnowledge.strengths }, { includePremium: nextStrategyEnabled });
    if (!canRefresh()) return false;
    // Advance the baseline before the React setters: reflecting a server save
    // is a read, and must never schedule the workspace's autosave back to it.
    savedSignatureRef.current = workspaceSignature(synchronizedMemory, nextKnowledge);
    failedAutoSaveSignatureRef.current = null;
    updateMemory(synchronizedMemory);
    updateBusinessKnowledge(nextKnowledge);
    setAnalysisQuota(parseAnalysisQuota(quotaPayload.quota));
    setAnalysisChannels(parseAnalysisChannels(quotaPayload.channels));
    const job = parseBusinessDnaManualAnalysisJob(quotaPayload.job);
    setAnalysisJob(job);
    setAnalyzing(isBusinessDnaManualAnalysisPending(job));
    setAnalysisError(job?.status === "failed" ? getSafeClientErrorMessage(job.error, t("analysisError")) : "");
    setAnalysisSummary(job && (job.status === "succeeded" || job.status === "failed") ? summaryFromAnalysisJob(job) : null);
    setError("");
    setWorkspaceError("");
    setAutoSaveState("idle");
    setProfileContentRevision(current => current + 1);
    setActivityContentRevision(current => current + 1);
    setLocationContentRevision(current => current + 1);
    return true;
  } });

  const changeTab = useCallback((tab: AiMemoryWorkspaceTab) => {
    if (tab === "profile" || tab === "activity" || tab === "local") {
      setMountedEmbeddedTabs((current) => {
        if (current.has(tab)) return current;
        const next = new Set(current);
        next.add(tab);
        return next;
      });
    }
    setActiveTab(tab);
    onTabChange?.(tab);
  }, [onTabChange]);

  useEffect(() => {
    onUnsavedChange?.(hasWorkspaceChanges);
  }, [hasWorkspaceChanges, onUnsavedChange]);

  useEffect(() => {
    if (hasWorkspaceChanges) setSaved(false);
  }, [hasWorkspaceChanges]);

  useEffect(() => {
    setActiveTab(initialTab === "documents" ? "analysis" : initialTab);
    if (initialTab === "profile" || initialTab === "activity" || initialTab === "local") {
      setMountedEmbeddedTabs((current) => {
        if (current.has(initialTab)) return current;
        const next = new Set(current);
        next.add(initialTab);
        return next;
      });
    }
  }, [initialTab]);

  useEffect(() => () => {
    if (analysisProgressTimerRef.current !== null) {
      window.clearInterval(analysisProgressTimerRef.current);
    }
  }, []);

  useEffect(() => () => {
    voiceTargetRef.current = null;
    onVoiceBusyChange?.(false);
  }, [onVoiceBusyChange]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const browserScope = getActiveBrowserUserId() || "";
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
        if (!active || (getActiveBrowserUserId() || "") !== browserScope) return;

        const nextStrategyEnabled = payload.strategyEnabled !== false;
        const rawFoundation = payload.profileFoundation || {};
        const rawBusinessKnowledge = payload.businessKnowledge || {};
        const nextMemory = normalizeAiMemory(payload.memory, {
          includePremium: nextStrategyEnabled,
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
          { includePremium: nextStrategyEnabled },
        );

        updateMemory(synchronizedMemory);
        updateBusinessKnowledge(nextBusinessKnowledge);
        setAnalysisQuota(parseAnalysisQuota(quotaPayload.quota));
        setAnalysisChannels(parseAnalysisChannels(quotaPayload.channels));
        setExcludedAnalysisChannels(new Set());
        analysisAccountIdRef.current = String(payload.accountId || quotaPayload.accountId || "");
        workspaceOwnerRef.current = { accountId: analysisAccountIdRef.current, browserScope };
        const job = parseBusinessDnaManualAnalysisJob(quotaPayload.job);
        setAnalysisJob(job);
        setAnalyzing(isBusinessDnaManualAnalysisPending(job));
        setAnalysisError(job?.status === "failed" ? getSafeClientErrorMessage(job.error, t("analysisError")) : "");
        setAnalysisSummary(job && (job.status === "succeeded" || job.status === "failed")
          ? summaryFromAnalysisJob(job) : null);
        setLoaded(true);
        savedSignatureRef.current = workspaceSignature(synchronizedMemory, nextBusinessKnowledge);
      } catch (loadError) {
        if (active) setError(getSafeClientErrorMessage(loadError, t("loadError")));
      } finally {
        if (active) { setCompletedLoadAttempt(loadAttempt); setLoading(false); }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [loadAttempt, t, updateBusinessKnowledge, updateMemory]);

  useEffect(() => {
    if (!analyzing) return;
    setAnalysisProgress(4);
    analysisProgressTimerRef.current = window.setInterval(() => {
      setAnalysisProgress((current) => Math.min(94, current + (current < 25 ? 7 : current < 57 ? 4 : current < 79 ? 2 : 1)));
    }, 420);
    return () => {
      if (analysisProgressTimerRef.current !== null) {
        window.clearInterval(analysisProgressTimerRef.current);
        analysisProgressTimerRef.current = null;
      }
    };
  }, [analyzing]);

  const analysisJobPending = isBusinessDnaManualAnalysisPending(analysisJob);
  useEffect(() => {
    if (!analysisJobPending) return;
    let active = true;
    let polling = false;
    const accountId = analysisAccountIdRef.current;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await fetch("/api/ai-memory/analyze-channels", { credentials: "include", cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        if (String(payload.accountId || "") !== accountId) {
          // Un changement d'établissement ne doit jamais appliquer le résultat
          // du précédent compte dans le brouillon nouvellement affiché.
          setAnalysisJob(null);
          setAnalyzing(false);
          setLoadAttempt((current) => current + 1);
          return;
        }
        const job = parseBusinessDnaManualAnalysisJob(payload.job);
        if (!job) return;
        setAnalysisQuota(parseAnalysisQuota(payload.quota));
        setAnalysisChannels(parseAnalysisChannels(payload.channels));
        if (job.status === "succeeded") {
          const memoryResponse = await fetch("/api/ai-memory", { credentials: "include", cache: "no-store" });
          const savedPayload = await memoryResponse.json();
          if (!active || !memoryResponse.ok || savedPayload.accountId !== accountId) return;
          const savedMemory = normalizeAiMemory(savedPayload.memory, { includePremium: strategyEnabled });
          const savedKnowledge = normalizeAiBusinessKnowledge(savedPayload.businessKnowledge);
          const cleanDraft = workspaceSignature(memoryRef.current, businessKnowledgeRef.current) === savedSignatureRef.current;
          const next = cleanDraft ? { memory: savedMemory, businessKnowledge: savedKnowledge }
            : mergeAiBusinessDnaAnalysis(memoryRef.current, businessKnowledgeRef.current, savedMemory, savedKnowledge, { includePremium: strategyEnabled });
          savedSignatureRef.current = workspaceSignature(savedMemory, savedKnowledge);
          updateMemory(next.memory);
          updateBusinessKnowledge(next.businessKnowledge);
          if (!activityDirty) setActivityContentRevision((current) => current + 1);
          if (!profileDirty) setProfileContentRevision((current) => current + 1);
          if (!locationDirty) setLocationContentRevision((current) => current + 1);
          onAnalysisCompleted?.();
          void invalidateBoosterGenerationContextClient("professional");
          void refreshPublicProfileDependents("activity");
          setAnalysisSummary(summaryFromAnalysisJob(job));
          setAnalysisError("");
          setSaved(true);
        } else if (job.status === "failed") {
          setAnalysisError(getSafeClientErrorMessage(job.error, t("analysisError")));
          setAnalysisSummary(summaryFromAnalysisJob(job));
        }
        setAnalysisJob(job);
        setAnalyzing(isBusinessDnaManualAnalysisPending(job));
      } catch {
        // Une perte réseau du navigateur n'annule pas la tâche serveur. Le
        // prochain passage sur la page retrouve son état persistant.
      } finally {
        polling = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [analysisJob?.id, analysisJob?.status, analysisJobPending, activityDirty, profileDirty, locationDirty, onAnalysisCompleted, strategyEnabled, t, updateBusinessKnowledge, updateMemory]);

  const setField = <K extends keyof AiMemory>(key: K, value: AiMemory[K]) => {
    setSaved(false);
    setError("");
    markWorkspaceDraftUpdated();
    updateMemory((current) => ({ ...current, [key]: value }));
  };

  const setBusinessField = <K extends keyof AiBusinessKnowledge>(
    key: K,
    value: AiBusinessKnowledge[K],
  ) => {
    setSaved(false);
    setError("");
    markWorkspaceDraftUpdated();
    updateBusinessKnowledge((current) => ({ ...current, [key]: value }));
    if (key === "description") {
      updateMemory((current) => ({ ...current, detailedDescription: String(value) }));
    }
    if (key === "strengths") {
      updateMemory((current) => ({ ...current, differentiators: value as string[] }));
    }
  };

  const setRecentNewsItem = (index: number, value: string) => {
    setSaved(false);
    setError("");
    markWorkspaceDraftUpdated();
    updateMemory((current) => updateAiMemoryRecentNewsItem(current, index, value));
  };

  const applyPersistedReferenceDocuments = useCallback(
    (documents: AiMemoryReferenceDocument[]) => {
      const normalizedDocuments = normalizeAiMemory({
        referenceDocuments: documents,
      }).referenceDocuments;
      updateMemory((current) => ({
        ...current,
        referenceDocuments: normalizedDocuments,
      }));

      try {
        const savedWorkspace = JSON.parse(savedSignatureRef.current) as {
          memory?: unknown;
          businessKnowledge?: unknown;
        };
        const savedMemory = normalizeAiMemory(savedWorkspace.memory, {
          includePremium: true,
        });
        const savedBusinessKnowledge = normalizeAiBusinessKnowledge(
          savedWorkspace.businessKnowledge,
        );
        savedSignatureRef.current = workspaceSignature(
          { ...savedMemory, referenceDocuments: normalizedDocuments },
          savedBusinessKnowledge,
        );
      } catch {
        // La signature est toujours créée localement à partir d'objets validés.
      }
    },
    [updateMemory],
  );

  const uploadReferenceDocuments = async (files: File[]) => {
    if (!files.length || documentUploadState !== "idle") return;
    if (!documentAnalysisConsent) {
      const approved = await confirmInrcy({
        title: t("documentsConsentTitle"),
        message: t("documentsConsentDescription"),
        confirmLabel: t("documentsUploadButton"),
        cancelLabel: settingsT("annuler_49ba3292"),
      });
      if (!approved) return;
      setDocumentAnalysisConsent(true);
    }

    const remaining = Math.max(
      0,
      AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS -
        memoryRef.current.referenceDocuments.length,
    );
    if (!remaining) {
      setDocumentUploadError(t("documentsLimitReached", {
        limit: AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
      }));
      return;
    }

    setDocumentUploadError("");
    const selected = files.slice(0, remaining);
    let selectedTotalBytes = memoryRef.current.referenceDocuments.reduce(
      (total, document) => total + Math.max(0, Number(document.size) || 0),
      0,
    );
    try {
      for (const file of selected) {
        if (file.size > AI_MEMORY_REFERENCE_DOCUMENT_MAX_BYTES) {
          throw new Error(t("documentsSizeError"));
        }
        if (selectedTotalBytes + file.size > AI_MEMORY_REFERENCE_DOCUMENT_MAX_TOTAL_BYTES) {
          throw new Error(t("documentsTotalSizeError"));
        }
        selectedTotalBytes += file.size;
        setDocumentUploadState("uploading");
        const prepareResponse = await fetch("/api/ai-memory/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "prepare",
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            size: file.size,
          }),
        });
        const prepared = await prepareResponse.json().catch(() => ({}));
        if (!prepareResponse.ok) {
          throw new Error(apiErrorMessage(prepared, t("documentsUploadError")));
        }

        const uploadMimeType = String(
          prepared.mimeType || file.type || "application/octet-stream",
        );
        const uploadProtocol =
          prepared.protocol === "tus"
            ? "tus"
            : prepared.protocol === "signed"
              ? "signed"
              : null;
        if (!uploadProtocol) {
          throw new Error(t("documentsUploadError"));
        }
        await uploadFileToPreparedStorageIntent(file, {
          protocol: uploadProtocol,
          bucket: String(prepared.bucket || "inrcy-ai-documents"),
          storagePath: String(prepared.storagePath || ""),
          token: String(prepared.token || ""),
          contentType: uploadMimeType,
          resumableEndpoint: String(prepared.resumableEndpoint || ""),
        });

        setDocumentUploadState("analysing");
        const finalizeResponse = await fetch("/api/ai-memory/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "finalize",
            id: prepared.id,
            name: file.name,
            mimeType: uploadMimeType,
            size: file.size,
            storagePath: prepared.storagePath,
            analysisConsent: true,
          }),
        });
        const finalized = await finalizeResponse.json().catch(() => ({}));
        if (!finalizeResponse.ok) {
          throw new Error(apiErrorMessage(finalized, t("documentsAnalysisError")));
        }
        applyPersistedReferenceDocuments(
          Array.isArray(finalized.documents) ? finalized.documents : [],
        );
        await invalidateBoosterGenerationContextClient("professional");
      }
    } catch (uploadError) {
      setDocumentUploadError(
        getSafeClientErrorMessage(uploadError, t("documentsUploadError")),
      );
    } finally {
      setDocumentUploadState("idle");
    }
  };

  const deleteReferenceDocument = async (document: AiMemoryReferenceDocument) => {
    if (documentUploadState !== "idle") return;
    const confirmed = await confirmInrcy({
      title: t("documentsDeleteTitle"),
      message: t("documentsDeleteMessage", { name: document.name }),
      confirmLabel: t("documentsDeleteConfirm"),
      variant: "danger",
    });
    if (!confirmed) return;

    setDocumentUploadState("deleting");
    setDocumentUploadError("");
    try {
      const response = await fetch("/api/ai-memory/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: document.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, t("documentsDeleteError")));
      }
      applyPersistedReferenceDocuments(
        Array.isArray(payload.documents) ? payload.documents : [],
      );
      await invalidateBoosterGenerationContextClient("professional");
    } catch (deleteError) {
      setDocumentUploadError(
        getSafeClientErrorMessage(deleteError, t("documentsDeleteError")),
      );
    } finally {
      setDocumentUploadState("idle");
    }
  };

  const resetCurrentTab = async (tabToReset: AiMemoryWorkspaceTab | "all" = activeTab, scopeCurrent: BusinessFormActionScope = () => true) => {
    if (voiceBusy || saving || workspaceSaving || documentUploadState !== "idle") return false;
    const expectedAccountId = resetViewerRef.current.activeAccountId, expectedActorUserId = resetViewerRef.current.actorUserId;
    const current = () => scopeCurrent() && resetViewerRef.current.activeAccountId === expectedAccountId && resetViewerRef.current.actorUserId === expectedActorUserId
      && getActiveBrowserUserId() === expectedAccountId;
    if (!expectedAccountId || !expectedActorUserId || !current()) return false;
    const isGlobalReset = tabToReset === "all";
    setResetDialogTab(tabToReset);
    const confirmed = await confirmInrcy({
      title: isGlobalReset
        ? t("resetTitle")
        : t("irreversibleResetTabTitle", { tab: activeTabDefinition.label }),
      message: isGlobalReset
        ? t("irreversibleResetAllMessage")
        : t("irreversibleResetTabMessage"),
      confirmLabel: isGlobalReset ? t("irreversibleResetAllConfirm") : t("reset"),
      variant: "danger",
    });
    setResetDialogTab(null);
    if (!confirmed || !current()) return false;

    setWorkspaceError("");
    setError("");
    try {
      const response = await fetch("/api/ai-memory/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ tab: tabToReset, preserveVocabulary: hideNavigation && tabToReset === "identity", expectedAccountId, expectedActorUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(apiErrorMessage(payload, t("saveError")));
      if (!current()) return false;

      if (isGlobalReset || activeTab === "profile" || activeTab === "activity") {
        // A global reset and embedded forms own data outside this component.
        // Rehydrate every panel from the server to avoid retaining a stale draft.
        window.location.reload();
        return true;
      }
      if (activeTab === "analysis") {
        setAnalysisSummary(null);
        setAnalysisError("");
      } else {
        const nextMemory = normalizeAiMemory(payload.memory, { includePremium: true });
        const nextBusinessKnowledge = (() => {
          const current = businessKnowledgeRef.current;
          if (activeTab === "audience") return { ...current, customerTypes: [] };
          if (activeTab === "local") return {
            ...current,
            interventionZones: [],
            weeklySchedule: EMPTY_AI_BUSINESS_KNOWLEDGE.weeklySchedule,
          };
          if (activeTab === "identity") return { ...current, strengths: [] };
          return current;
        })();
        updateMemory(nextMemory);
        updateBusinessKnowledge(nextBusinessKnowledge);
        savedSignatureRef.current = workspaceSignature(nextMemory, nextBusinessKnowledge);
        setSaved(true);
        setAutoSaveState("idle");
        onUnsavedChange?.(false);
      }
      await invalidateBoosterGenerationContextClient("professional");
      return current();
    } catch (resetError) {
      setWorkspaceError(
        getSafeClientErrorMessage(resetError, t("saveError")),
      );
      return false;
    }
  };

  const setRichDescription = (next: { text: string; html: string }) => {
    setSaved(false);
    setError("");
    markWorkspaceDraftUpdated();
    updateBusinessKnowledge((current) => ({ ...current, description: next.text }));
    updateMemory((current) => ({
      ...current,
      detailedDescription: next.text,
      richText: { ...current.richText, detailedDescription: next.html },
    }));
  };

  const setMissionRichField = (next: { text: string; html: string }) => {
    setSaved(false);
    setError("");
    markWorkspaceDraftUpdated();
    updateMemory((current) => ({
      ...current,
      mission: next.text,
      richText: { ...current.richText, mission: next.html },
    }));
  };

  const setPremiumRichField = (
    key: "offersAndArguments" | "keyArguments" | "proofsAndObjections" | "objectionResponses" | "editorialStrategy" | "campaignCalendar",
    next: { text: string; html: string },
  ) => {
    setSaved(false);
    setError("");
    markWorkspaceDraftUpdated();
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

  const saveAiMemory = useCallback(async (
    draft: {
      memory?: AiMemory;
      businessKnowledge?: AiBusinessKnowledge;
      profession?: unknown;
      reconciliationBase?: { memory: AiMemory; businessKnowledge: AiBusinessKnowledge };
    } = {},
  ): Promise<{ ok: boolean; message?: string }> => {
    if (memorySaveRunningRef.current || !loaded || voiceTargetRef.current) return { ok: false };
    memorySaveRunningRef.current = true;
    setSaving(true);
    setSaved(false);
    setError("");
    const owner = workspaceOwnerRef.current;
    const assertOwner = () => {
      if (!workspaceMountedRef.current || !owner.accountId || workspaceOwnerRef.current !== owner ||
          (getActiveBrowserUserId() || "") !== owner.browserScope) throw new Error(t("saveError"));
    };
    try {
      assertOwner();
      const draftMemory = draft.memory ?? memoryRef.current;
      const draftBusinessKnowledge = draft.businessKnowledge ?? businessKnowledgeRef.current;
      const reconciliationBase = draft.reconciliationBase ?? { memory: draftMemory, businessKnowledge: draftBusinessKnowledge };
      const synchronizedMemory = normalizeAiMemory({
        ...draftMemory,
        detailedDescription: draftBusinessKnowledge.description,
        differentiators: draftBusinessKnowledge.strengths,
      });
      const previousWorkspace = JSON.parse(savedSignatureRef.current) as {
        memory?: unknown; businessKnowledge?: unknown;
      };
      const response = await fetch("/api/ai-memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          memory: buildBusinessDnaWorkspaceSavePatch(previousWorkspace.memory, synchronizedMemory),
          businessKnowledge: buildBusinessDnaWorkspaceSavePatch(previousWorkspace.businessKnowledge, draftBusinessKnowledge),
          ...(draft.profession ? { activityProfessionSuggestion: draft.profession } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      assertOwner();
      const nextQuota = parseAnalysisQuota(payload.quota);
      if (nextQuota) setAnalysisQuota(nextQuota);
      if (!response.ok) throw new Error(apiErrorMessage(payload, t("saveError")));

      const nextStrategyEnabled = payload.strategyEnabled !== false;
      const nextBusinessKnowledge = normalizeAiBusinessKnowledge(
        payload.businessKnowledge || draftBusinessKnowledge,
      );
      const nextMemory = normalizeAiMemory(payload.memory, {
        includePremium: nextStrategyEnabled,
      });
      const reconciledMemory = reconcileSavedDraft(reconciliationBase.memory, memoryRef.current, nextMemory);
      const reconciledBusinessKnowledge = reconcileSavedDraft(reconciliationBase.businessKnowledge, businessKnowledgeRef.current, nextBusinessKnowledge);
      updateMemory(reconciledMemory);
      updateBusinessKnowledge(reconciledBusinessKnowledge);
      savedSignatureRef.current = workspaceSignature(nextMemory, nextBusinessKnowledge);
      setSaved(workspaceSignature(reconciledMemory, reconciledBusinessKnowledge) === savedSignatureRef.current);

      const [publicProfileRefreshed] = await Promise.all([
        refreshPublicProfileDependents("activity"),
        invalidateBoosterGenerationContextClient("professional"),
      ]);
      if (!publicProfileRefreshed) console.warn("[business-dna] public profile refresh deferred");
      assertOwner();
      return { ok: true };
    } catch (saveError) {
      const message = getSafeClientErrorMessage(saveError, t("saveError"));
      if (workspaceMountedRef.current && workspaceOwnerRef.current === owner) setError(message);
      return { ok: false, message };
    } finally {
      memorySaveRunningRef.current = false;
      if (workspaceMountedRef.current) setSaving(false);
    }
  }, [loaded, t, updateMemory, updateBusinessKnowledge]);

  const restoreAiMemoryDraft = useCallback(() => {
    try {
      const savedWorkspace = JSON.parse(savedSignatureRef.current) as {
        memory?: unknown;
        businessKnowledge?: unknown;
      };
      const savedMemory = normalizeAiMemory(savedWorkspace.memory, {
        includePremium: strategyEnabled,
      });
      const savedBusinessKnowledge = normalizeAiBusinessKnowledge(savedWorkspace.businessKnowledge);
      updateMemory(savedMemory);
      updateBusinessKnowledge(savedBusinessKnowledge);
      setSaved(false);
      setError("");
    } catch {
      // La signature est toujours créée par JSON.stringify sur des objets validés.
    }
  }, [strategyEnabled, updateMemory, updateBusinessKnowledge]);

  const hasPendingWorkspaceChanges = useCallback(() =>
    profileDraftRef.current.dirty || activityDraftRef.current.dirty || locationDraftRef.current.dirty ||
    workspaceSignature(memoryRef.current, businessKnowledgeRef.current) !== savedSignatureRef.current,
  []);

  const saveWorkspace = useCallback(async (options: WorkspaceSaveOptions = {}): Promise<boolean> => {
    const inFlightSave = workspaceSavePromiseRef.current;
    if (inFlightSave) return inFlightSave;
    if (!loaded || voiceTargetRef.current || memorySaveRunningRef.current) return false;

    const saveReason = options.reason || "manual";
    const shouldSaveProfile = profileDraftRef.current.dirty;
    const shouldSaveActivity = activityDraftRef.current.dirty;
    const backgroundSave = saveReason === "auto" || saveReason === "tab-change";
    const shouldSaveLocation = locationDraftRef.current.dirty && (!backgroundSave || businessLocationRef.current?.canAutoSave() === true);
    const shouldSaveAiMemory = Boolean(options.aiMemoryDraft) || workspaceSignature(memoryRef.current, businessKnowledgeRef.current) !== savedSignatureRef.current || shouldSaveActivity;
    const reconciliationBase = { memory: memoryRef.current, businessKnowledge: businessKnowledgeRef.current };

    if (!shouldSaveProfile && !shouldSaveActivity && !shouldSaveLocation && !shouldSaveAiMemory) {
      setAutoSaveState("idle");
      return true;
    }

    const shouldSurfaceFailure = saveReason === "manual" || saveReason === "exit" || saveReason === "analysis";
    const failedDraftSignature = workspaceDraftSignature;
    const run = async (): Promise<boolean> => {
      setWorkspaceSaving(true);
      setSaved(false);
      setError("");
      setWorkspaceError("");
      if (saveReason === "auto" || saveReason === "tab-change") {
        setAutoSaveState("saving");
      }

      try {
        if (shouldSaveProfile) {
          const profile = profileContentRef.current;
          if (!profile?.isReady() || !(await profile.save())) {
            setWorkspaceError(t("saveError"));
            if (shouldSurfaceFailure) changeTab("profile");
            return false;
          }
        }

        if (shouldSaveLocation) {
          const location = businessLocationRef.current;
          if (!location?.isReady() || !(await location.save())) {
            setWorkspaceError(t("locationSaveError"));
            if (shouldSurfaceFailure) changeTab("local");
            return false;
          }
        }

        let nextMemory = options.aiMemoryDraft?.memory ?? reconciliationBase.memory;
        let nextBusinessKnowledge = options.aiMemoryDraft?.businessKnowledge ?? reconciliationBase.businessKnowledge;
        if (shouldSaveActivity) {
          const activity = activityContentRef.current;
          if (!activity?.isReady()) {
            setWorkspaceError(t("saveError"));
            if (shouldSurfaceFailure) changeTab("activity");
            return false;
          }

          const activityDraft = activity.getBusinessKnowledgePatch();
          if (!(await activity.save())) {
            setWorkspaceError(t("saveError"));
            if (shouldSurfaceFailure) changeTab("activity");
            return false;
          }

          // Les informations métier de ce formulaire recouvrent une partie de
          // l'ADN. Elles ont été explicitement modifiées par le professionnel :
          // elles doivent donc être reprises dans l'écriture globale, sans
          // écraser l'analyse avec une ancienne copie locale.
          nextBusinessKnowledge = normalizeAiBusinessKnowledge({
            ...nextBusinessKnowledge,
            ...activityDraft,
          });
          nextMemory = normalizeAiMemory({
            ...nextMemory,
            detailedDescription: nextBusinessKnowledge.description,
            differentiators: nextBusinessKnowledge.strengths,
          });
        }

        if (shouldSaveAiMemory) {
          const result = await saveAiMemory({
            memory: nextMemory,
            businessKnowledge: nextBusinessKnowledge,
            profession: options.aiMemoryDraft?.profession,
            reconciliationBase,
          });
          if (!result.ok) {
            setWorkspaceError(getSafeClientErrorMessage(result.message, t("saveError")));
            return false;
          }

          // Une analyse enregistrée peut enrichir les champs affichés dans
          // Activité. Recharge ce sous-formulaire au prochain affichage afin
          // qu'il ne conserve jamais une copie antérieure de l'ADN.
          if (mountedEmbeddedTabs.has("activity") && !activityDraftRef.current.dirty) {
            setActivityContentRevision((current) => current + 1);
          }
        }

        failedAutoSaveSignatureRef.current = null;
        setWorkspaceError("");
        setAutoSaveState("idle");
        const stillPending = hasPendingWorkspaceChanges();
        setSaved(!stillPending);
        onUnsavedChange?.(stillPending);
        return true;
      } finally {
        setWorkspaceSaving(false);
      }
    };

    const savePromise = run();
    workspaceSavePromiseRef.current = savePromise;
    try {
      const savedWorkspace = await savePromise;
      if (!savedWorkspace && (saveReason === "auto" || saveReason === "tab-change")) {
        failedAutoSaveSignatureRef.current = failedDraftSignature;
        setAutoSaveState("failed");
      }
      return savedWorkspace;
    } catch (workspaceSaveError) {
      const message = getSafeClientErrorMessage(workspaceSaveError, t("saveError"));
      setWorkspaceError(message);
      if (saveReason === "auto" || saveReason === "tab-change") {
        failedAutoSaveSignatureRef.current = failedDraftSignature;
        setAutoSaveState("failed");
      }
      return false;
    } finally {
      if (workspaceSavePromiseRef.current === savePromise) {
        workspaceSavePromiseRef.current = null;
      }
    }
  }, [
    changeTab,
    saveAiMemory,
    loaded,
    mountedEmbeddedTabs,
    onUnsavedChange,
    t,
    workspaceDraftSignature,
    hasPendingWorkspaceChanges,
  ]);

  const discardAllWorkspaceChanges = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    profileContentRef.current?.cancelChanges();
    activityContentRef.current?.cancelChanges();
    businessLocationRef.current?.cancelChanges();
    restoreAiMemoryDraft();
    profileDraftRef.current = { dirty: false, signature: "" };
    activityDraftRef.current = { dirty: false, signature: "" };
    locationDraftRef.current = { dirty: false, signature: "" };
    failedAutoSaveSignatureRef.current = null;
    setProfileDirty(false);
    setActivityDirty(false);
    setLocationDirty(false);
    setProfileDraftSignature("");
    setActivityDraftSignature("");
    setLocationDraftSignature("");
    setWorkspaceError("");
    setAutoSaveState("idle");
    onUnsavedChange?.(false);
  }, [onUnsavedChange, restoreAiMemoryDraft]);

  const cancelActiveTabChanges = async () => {
    if (workspaceSaving || voiceTargetRef.current) return;
    if (activeTab === "profile") {
      profileDraftRef.current = { dirty: false, signature: "" };
      profileContentRef.current?.cancelChanges();
      setProfileDirty(false);
      setProfileDraftSignature("");
    } else if (activeTab === "activity") {
      activityDraftRef.current = { dirty: false, signature: "" };
      activityContentRef.current?.cancelChanges();
      setActivityDirty(false);
      setActivityDraftSignature("");
    } else {
      if (activeTab === "local") {
        locationDraftRef.current = { dirty: false, signature: "" };
        businessLocationRef.current?.cancelChanges();
        setLocationDirty(false);
        setLocationDraftSignature("");
      }
      restoreAiMemoryDraft();
    }
    failedAutoSaveSignatureRef.current = null;
    setWorkspaceError("");
    setAutoSaveState("idle");
  };

  useEffect(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }

    if (
      !hasWorkspaceChanges ||
      !loaded ||
      voiceBusy ||
      saving ||
      workspaceSaving ||
      analyzing
    ) {
      if (!hasWorkspaceChanges) setAutoSaveState("idle");
      return;
    }

    // Keep an unfinished implantation draft local until it is complete or the
    // professional explicitly saves it. Navigating to another tab keeps it mounted.
    if (locationDirty && !memoryDirty && !profileDirty && !activityDirty && !businessLocationRef.current?.canAutoSave()) {
      setAutoSaveState("idle");
      return;
    }

    if (failedAutoSaveSignatureRef.current === workspaceDraftSignature) {
      setAutoSaveState("failed");
      return;
    }

    setAutoSaveState("scheduled");
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void saveWorkspace({ reason: "auto" });
    }, 1000);

    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [
    analyzing,
    hasWorkspaceChanges,
    loaded,
    locationDirty,
    memoryDirty,
    profileDirty,
    activityDirty,
    saveWorkspace,
    saving,
    voiceBusy,
    workspaceDraftSignature,
    workspaceSaving,
  ]);

  const resetWorkspace = async (scopeCurrent: BusinessFormActionScope = () => true) => {
    if (voiceTargetRef.current) return false;
    const confirmed = await confirmInrcy({
      title: t("resetTitle"),
      message: t("resetMessage"),
      confirmLabel: t("resetConfirm"),
      variant: "danger",
    });
    if (!confirmed || !scopeCurrent()) return false;
    updateMemory(
      normalizeAiMemory(
        {
          ...EMPTY_AI_MEMORY,
          recentNewsManualItems: [],
          // Les documents ont leur propre suppression explicite afin qu'un
          // clic sur "Réinitialiser" ne laisse jamais de fichier orphelin.
          referenceDocuments: memoryRef.current.referenceDocuments,
        },
        { includePremium: strategyEnabled },
      ),
    );
    updateBusinessKnowledge(normalizeAiBusinessKnowledge(EMPTY_AI_BUSINESS_KNOWLEDGE));
    setSaved(false);
    setError("");
    setAnalysisError("");
    return true;
  };

  const runAssistantAction = useInrAssistantBusinessFormCommands({ id: "business_dna", view: activeTab === "documents" ? "analysis" : activeTab, enabled: assistantActive, publish: !hideNavigation,
    snapshot: { signature, activeTab, resetDialogTab, profileDirty, activityDirty, locationDirty, loading, analyzing }, pendingChanges: hasWorkspaceChanges,
    busy: loading || !loaded || saving || workspaceSaving || analyzing || voiceBusy || documentUploadState !== "idle",
    isApplied: patch => patch.businessFormAction === "select_tab" ? activeTab === patch.businessFormTab
      : patch.businessFormAction === "open_persistent_reset" ? resetDialogTab === patch.businessFormTab
      : patch.businessFormAction === "discard" ? activeTab === "profile" ? !profileDirty : activeTab === "activity" ? !activityDirty : activeTab === "local" ? !locationDirty && !memoryDirty : !memoryDirty
      : patch.businessFormAction === "reset" && signature === workspaceSignature(normalizeAiMemory({ ...EMPTY_AI_MEMORY, recentNewsManualItems: [], referenceDocuments: memory.referenceDocuments }, { includePremium: strategyEnabled }), normalizeAiBusinessKnowledge(EMPTY_AI_BUSINESS_KNOWLEDGE)),
    apply: async (patch, scopeCurrent) => {
      if (patch.businessFormAction === "select_tab" && patch.businessFormTab && tabs.some(tab => tab.key === patch.businessFormTab)) { selectTab(patch.businessFormTab as AiMemoryWorkspaceTab); return true; }
      if (patch.businessFormAction === "open_persistent_reset" && patch.businessFormTab && (patch.businessFormTab === "all" || patch.businessFormTab === activeTab)) {
        if (!resetViewerRef.current.actorUserId || !resetViewerRef.current.activeAccountId || !scopeCurrent()) return false;
        void resetCurrentTab(patch.businessFormTab as AiMemoryWorkspaceTab | "all", scopeCurrent); return true;
      }
      if (patch.businessFormAction === "reset") return resetWorkspace(scopeCurrent);
      if (patch.businessFormAction !== "discard") return false;
      if (hasWorkspaceChanges && !await confirmInrcy({ title: t("cancelChanges"), message: t("discardDraftMessage"), variant: "warning" })) return false;
      if (!scopeCurrent()) return false;
      await cancelActiveTabChanges(); return true;
    } });

  useImperativeHandle(ref, () => ({
    savePendingChanges: async () => {
      const inFlight = workspaceSavePromiseRef.current;
      if (inFlight && !await inFlight) return false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!hasPendingWorkspaceChanges()) return true;
        if (!await saveWorkspace({ reason: "exit" })) return false;
      }
      return !hasPendingWorkspaceChanges();
    },
    discardPendingChanges: discardAllWorkspaceChanges,
    runAssistantAction: (patch, scopeCurrent) => runAssistantAction(patch, scopeCurrent),
    selectTab: (tab) => {
      if (voiceTargetRef.current || tab === activeTab) return;
      if (hasWorkspaceChanges) void saveWorkspace({ reason: "tab-change" });
      changeTab(tab);
    },
  }), [activeTab, changeTab, discardAllWorkspaceChanges, hasPendingWorkspaceChanges, hasWorkspaceChanges, runAssistantAction, saveWorkspace]);


  const visibleAnalysisChannels = analysisChannels.filter((channel) => channel.key !== "threads" || metaPilotEnabled);
  const selectedAnalysisChannels = new Set(visibleAnalysisChannels.filter((channel) => channel.status === "connected" && channel.analyzable && !excludedAnalysisChannels.has(channel.key)).map((channel) => channel.key));
  const selectiveAnalysis = visibleAnalysisChannels.some((channel) => channel.status === "connected" && channel.analyzable && excludedAnalysisChannels.has(channel.key));

  const analyzeChannels = async () => {
    if (analyzing || loading || !loaded || voiceTargetRef.current) return;
    setAnalyzing(true);
    setAnalysisError("");
    setAnalysisSummary(null);
    setSaved(false);
    let backgroundAccepted = false;
    try {
      if (!(await saveWorkspace({ reason: "analysis" }))) throw new Error(t("saveError"));
      const response = await fetch(selectiveAnalysis ? "/api/ai-memory/analyze-channels" : "/api/ai-memory/analyze-channels?background=1", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        ...(selectiveAnalysis ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedChannels: [...selectedAnalysisChannels] }) } : {}),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 202) {
        const job = parseBusinessDnaManualAnalysisJob(payload.job);
        if (!job) throw new Error(t("analysisError"));
        backgroundAccepted = true;
        setAnalysisJob(job);
        const quota = parseAnalysisQuota(payload.quota);
        if (quota) setAnalysisQuota(quota);
        return;
      }
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
        { includePremium: strategyEnabled },
      );
      updateMemory(merged.memory);
      updateBusinessKnowledge(merged.businessKnowledge);
      markWorkspaceDraftUpdated();
      const analysisSaved = await saveWorkspace({
        reason: "analysis",
        aiMemoryDraft: {
          memory: merged.memory,
          businessKnowledge: merged.businessKnowledge,
          profession: suggestion.profession,
        },
      });
      if (!analysisSaved) {
        throw new Error(t("saveError"));
      }
      setAnalysisSummary({
        analyzedAt: String(payload.analyzedAt || new Date().toISOString()),
        changedFields: merged.changedFields,
        addedItems: merged.addedItems,
        sources,
      });
      if (!profileDirty) setProfileContentRevision((current) => current + 1);
      if (!locationDirty) setLocationContentRevision((current) => current + 1);
      onAnalysisCompleted?.();
    } catch (analysisFailure) {
      setAnalysisError(
        getSafeClientErrorMessage(analysisFailure, t("analysisError")),
      );
    } finally {
      if (!backgroundAccepted) {
        setAnalyzing(false);
        setAnalysisProgress(0);
      }
      void fetch("/api/ai-memory/analyze-channels", {
        cache: "no-store",
        credentials: "include",
      })
        .then(async (response) => response.ok ? response.json() : null)
        .then((payload) => {
          if (payload?.accountId && payload.accountId !== analysisAccountIdRef.current) return;
          const refreshedQuota = parseAnalysisQuota(payload?.quota);
          if (refreshedQuota) setAnalysisQuota(refreshedQuota);
          const refreshedChannels = parseAnalysisChannels(payload?.channels);
          if (refreshedChannels.length) setAnalysisChannels(refreshedChannels);
          const job = parseBusinessDnaManualAnalysisJob(payload?.job);
          if (isBusinessDnaManualAnalysisPending(job)) {
            // La réponse du lancement peut être perdue alors que le serveur
            // l'a déjà accepté. Retrouver la tâche évite un faux échec local.
            setAnalysisJob(job);
            setAnalyzing(true);
            setAnalysisError("");
          }
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
      disabled={voiceBusy}
      addLabel={addLabel}
      placeholder={placeholder}
      emptyText={t("tagsEmpty")}
      maxItems={16}
      inlineAdd={inlineAdd}
      compact={hideNavigation}
    />
  );

  const recentNewsSourceLabels = memory.recentNewsSourceKeys
    .map((key) => RECENT_NEWS_SOURCE_LABELS[key])
    .filter((label, index, labels): label is string => Boolean(label) && labels.indexOf(label) === index);
  const recentNewsUpdatedLabel = memory.recentNewsUpdatedAt
    ? new Date(memory.recentNewsUpdatedAt).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "";

  // The unified page places these same controlled fields between instructions
  // and examples. Keep a single draft and persistence queue for the ADN data.
  const vocabularySection = (
    <div data-identity-vocabulary data-personalization-vocabulary style={identityVocabularySectionStyle}>
      {!hideNavigation ? <div data-identity-vocabulary-heading style={identityVocabularyHeadingStyle}>
        <strong style={identityVocabularyTitleStyle}>{t("languageTitle")}</strong>
        <span style={hintStyle}>{t("languageDescription")}</span>
      </div> : null}
      <div data-identity-tag-grid style={identityTagRowsStyle}>
        <div data-identity-tag-card style={identityTagRowStyle}>
          <span style={identityTagLabelStyle}>{t("preferredVocabularyLabel")}</span>
          <div style={identityTagContentStyle}>
            {memoryTags("preferredVocabulary", t("preferredVocabularyAdd"), t("preferredVocabularyPlaceholder"), true)}
          </div>
        </div>
        <div data-identity-tag-card style={identityTagRowStyle}>
          <span style={identityTagLabelStyle}>{t("forbiddenVocabularyLabel")}</span>
          <div style={identityTagContentStyle}>
            {memoryTags("forbiddenVocabulary", t("forbiddenVocabularyAdd"), t("forbiddenVocabularyPlaceholder"), true)}
          </div>
        </div>
      </div>
      {vocabularyPortalTarget ? (
        workspaceError || error ? <div role="alert" style={errorStyle}>{workspaceError || error}</div>
          : autoSaveState === "saving" ? <small role="status" style={autoSaveStatusStyle}>{t("saving")}</small>
          : saved ? <small role="status" style={autoSaveStatusStyle}>{t("saved")}</small> : null
      ) : null}
    </div>
  );

  const referenceDocumentsSection = (
<section
                data-ai-memory-tab="documents"
                data-has-documents={memory.referenceDocuments.length > 0 ? "true" : "false"}
                onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (documentUploadState === "idle") void uploadReferenceDocuments(Array.from(event.dataTransfer.files));
                }}
                style={{ ...cardStyle, ...documentsCardStyle }}
              >
                <SectionHeader
                  icon="📎"
                  title={t("tabDocuments")}
                  description=""
                  onIconClick={() => documentInputRef.current?.click()}
                  iconLabel={t("documentsUploadButton")}
                  iconDisabled={documentUploadState !== "idle" || documentStorage.status === "reached" || memory.referenceDocuments.length >= AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS}
                  trailing={(
                    <span data-reference-document-count style={documentsCountStyle}>
                      {t("documentsCount", {
                        count: memory.referenceDocuments.length,
                        limit: AI_MEMORY_REFERENCE_DOCUMENT_MAX_ITEMS,
                      })}
                    </span>
                  )}
                />

                <div
                  data-document-storage
                  style={{
                    ...documentsStorageStyle,
                    ...(documentStorage.status === "reached"
                      ? documentsStorageReachedStyle
                      : documentStorage.status === "near"
                        ? documentsStorageNearStyle
                        : null),
                  }}
                >
                  <span style={documentsStorageHeadingStyle}>
                    <span style={documentsStorageCopyStyle}>
                      <strong>{t("documentsStorageTitle")}</strong>
                      <small>{documentStorageStatusLabel}</small>
                    </span>
                    <strong style={documentsStorageValueStyle}>{documentStorageLabel}</strong>
                  </span>
                  <span
                    role="progressbar"
                    aria-label={t("documentsStorageTitle")}
                    aria-valuemin={0}
                    aria-valuemax={documentStorage.limitBytes}
                    aria-valuenow={Math.min(documentStorage.usedBytes, documentStorage.limitBytes)}
                    aria-valuetext={`${documentStorageLabel} · ${documentStorageStatusLabel}`}
                    style={documentsStorageTrackStyle}
                  >
                    <span
                      aria-hidden
                      style={{
                        ...documentsStorageFillStyle,
                        width: `${documentStorage.percent}%`,
                        background:
                          documentStorage.status === "reached"
                            ? "linear-gradient(90deg, #f97316, #ef4444)"
                            : documentStorage.status === "near"
                              ? "linear-gradient(90deg, #facc15, #f97316)"
                              : documentsStorageFillStyle.background,
                      }}
                    />
                  </span>
                </div>

                  <input
                    ref={documentInputRef}
                    type="file"
                    multiple
                    hidden
                    accept=".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.png,.jpg,.jpeg,.webp,.gif,image/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      event.target.value = "";
                      void uploadReferenceDocuments(files);
                    }}
                  />

                {documentUploadState !== "idle" ? <div role="status" data-document-upload-status>{t(documentUploadState === "uploading" ? "documentsUploading" : "documentsAnalysing")}</div> : null}
                {!memory.referenceDocuments.length ? <div data-document-empty>{t("documentsDropHint")}</div> : null}

                {memory.referenceDocuments.length ? (
                  <div data-reference-document-list role="region" aria-label={t("tabDocuments")} tabIndex={0} style={documentsListStyle}>
                    {memory.referenceDocuments.map((document) => (
                      <article key={document.id} data-reference-document={document.id} style={documentItemStyle}>
                        <span style={documentFileIconStyle} aria-hidden>
                          {document.mimeType.startsWith("image/") ? "🖼️" : "📄"}
                        </span>
                        <span style={documentItemCopyStyle}>
                          <strong>{document.name}</strong>
                          <small>
                            {document.size
                              ? `${new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", unitDisplay: "short" }).format(Math.max(1, Math.round(document.size / 1024)))} · `
                              : ""}
                            {document.status === "analysed"
                              ? t("documentsStatusAnalysed")
                              : document.status === "error"
                                ? t("documentsStatusError")
                                : t("documentsStatusMetadata")}
                          </small>
                          {document.note ? <small>{document.note}</small> : null}
                        </span>
                        <button
                          type="button"
                          disabled={documentUploadState !== "idle"}
                          aria-label={t("documentsDeleteAria", { name: document.name })}
                          onClick={() => void deleteReferenceDocument(document)}
                          style={documentDeleteButtonStyle}
                        >
                          ×
                        </button>
                      </article>
                    ))}
                  </div>
                ) : (
                  null
                )}

                {documentUploadError ? (
                  <div style={errorStyle}>{documentUploadError}</div>
                ) : null}
              </section>
  );

  const analysisAnimation = (
<div data-business-dna-analysis-orb style={analysisOrbStageStyle}>
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
  );

  const tabs: Array<{ key: AiMemoryWorkspaceTab; icon: string; label: string }> = [
    { key: "analysis", icon: "✦", label: t("tabAnalysis") },
    { key: "profile", icon: "👤", label: profileLabel },
    { key: "activity", icon: "🏢", label: t("tabActivity") },
    { key: "audience", icon: "🎯", label: t("tabAudience") },
    { key: "local", icon: "📍", label: t("tabLocal") },
    { key: "identity", icon: "🧭", label: t("tabIdentity") },
    { key: "news", icon: "⚡", label: t("tabNews") },
    { key: "strategy", icon: "🧠", label: t("tabStrategy") },
  ].filter((tab) => !visibleTabs || visibleTabs.includes(tab.key as AiMemoryWorkspaceTab)) as Array<{ key: AiMemoryWorkspaceTab; icon: string; label: string }>;
  const activeTabIndex = Math.max(0, tabs.findIndex((tab) => tab.key === activeTab));
  const activeTabDefinition = tabs[activeTabIndex] ?? tabs[0];
  const activeTabRequiresAiMemory = activeTab !== "profile" && activeTab !== "activity";
  const selectTab = (tab: AiMemoryWorkspaceTab) => {
    if (voiceTargetRef.current || tab === activeTab) return;
    // Le changement d'onglet reste instantané : les modifications partent en
    // arrière-plan et ne bloquent jamais la navigation du professionnel.
    if (hasWorkspaceChanges) void saveWorkspace({ reason: "tab-change" });
    changeTab(tab);
  };
  const selectTabAt = (index: number) => {
    const next = tabs[index];
    if (next) selectTab(next.key);
  };

  return (
    <div data-ai-memory-workspace style={pageStyle}>
      {!hideNavigation && tabs.length > 1 ? <DrawerHeaderTabs>
      <nav data-ai-memory-desktop-tabs aria-label={t("title")} role="tablist" style={{ ...tabListStyle, gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              disabled={voiceBusy}
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(tab.key)}
              style={{ ...tabButtonStyle, ...(active ? activeTabButtonStyle : {}) }}
            >
              <span aria-hidden>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <DashboardMobileSelect
        value={activeTab}
        options={tabs.map((tab) => ({ value: tab.key, label: tab.label, icon: tab.icon }))}
        onChange={selectTab}
        ariaLabel={t("title")}
        disabled={voiceBusy}
      />
      </DrawerHeaderTabs> : null}

      <div
        role="tabpanel"
        data-ai-memory-active-tab={activeTab}
        aria-busy={workspaceSaving}
        style={tabPanelStyle}
        onTouchStart={(event) => {
            const touch = event.touches[0];
            const target = event.target as HTMLElement | null;
            tabSwipeStartRef.current = touch
              ? {
                  x: touch.clientX,
                  y: touch.clientY,
                  enabled: !voiceBusy && !target?.closest("input, textarea, select, button, [contenteditable='true']"),
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
            {mountedEmbeddedTabs.has("profile") ? (
              <section
                data-ai-memory-tab="profile"
                hidden={activeTab !== "profile"}
                style={activeTab === "profile" ? sectionStackStyle : hiddenWorkspaceTabStyle}
              >
                <ProfilContent
                  key={`profile-${profileContentRevision}`}
                  ref={profileContentRef}
                  mode="page"
                  showIntro={false}
                  showActions={false}
                  workspaceCompact
                  onProfileSaved={onProfileSaved}
                  onProfileReset={onProfileReset}
                  onUnsavedChange={handleProfileUnsavedChange}
                />
              </section>
            ) : null}

            {mountedEmbeddedTabs.has("activity") ? (
              <section
                data-ai-memory-tab="activity-foundation"
                hidden={activeTab !== "activity"}
                style={activeTab === "activity" ? sectionStackStyle : hiddenWorkspaceTabStyle}
              >
                <ActivityContent
                  key={`activity-${activityContentRevision}`}
                  ref={activityContentRef}
                  mode="page"
                  contentScope="profile-core"
                  showIntro={false}
                  showActions={false}
                  assistantActive={assistantActive && activeTab === "activity"}
                  onActivitySaved={onActivitySaved}
                  onActivityReset={onActivityReset}
                  onUnsavedChange={handleActivityUnsavedChange}
                />
              </section>
            ) : null}

            {activeTabRequiresAiMemory && loading ? (
              <section style={cardStyle}>{t("loading")}</section>
            ) : null}

            {activeTabRequiresAiMemory && !loading && !loaded ? (
              <section style={cardStyle}>
                <span style={hintStyle}>{t("loadError")}</span>
                <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} style={secondaryButtonStyle}>
                  {t("retry")}
                </button>
              </section>
            ) : null}

            {!loading && loaded ? (
              <>
            {activeTab === "analysis" ? (
              <BusinessDnaAnalysisWorkspace
                channels={visibleAnalysisChannels}
                selectedChannels={selectedAnalysisChannels}
                onToggleChannel={(key) => setExcludedAnalysisChannels((current) => {
                  const next = new Set(current);
                  if (next.has(key)) next.delete(key); else next.add(key);
                  return next;
                })}
                documents={referenceDocumentsSection}
                animation={analysisAnimation}
                completionScore={completionScore}
                analyzing={analyzing}
                progress={analysisProgress}
                quota={analysisQuota}
                summary={analysisSummary}
                error={analysisError}
                busy={voiceBusy || saving || workspaceSaving || documentUploadState !== "idle"}
                hasSources={selectedAnalysisChannels.size > 0 || memory.referenceDocuments.length > 0}
                selective={selectiveAnalysis}
                onAnalyze={() => void analyzeChannels()}
                onSchedule={() => setAnalysisScheduleOpen(true)}
                onReset={() => void resetCurrentTab("all")}
              />
            ) : null}

            {activeTab === "activity" ? (
              <div data-ai-memory-tab="activity" style={sectionStackStyle}>
                <section data-memory-field="description" style={cardStyle}>
                    <BusinessDnaRichTextEditor
                      assistantField="detailedDescription"
                      label={t("presentationTitle")}
                      value={businessKnowledge.description}
                      html={memory.richText.detailedDescription}
                      maxLength={5000}
                      disabled={voiceDisabledFor("detailedDescription")}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("detailedDescription", busy)}
                      onChange={setRichDescription}
                      placeholder={t("detailedDescriptionPlaceholder")}
                      minHeight={165}
                    />
                </section>
                <div data-activity-services style={sectionStackStyle}>
                  <section data-memory-field="services" style={cardStyle}>
                    <span style={labelStyle}>{t("baseServicesLabel")}</span>
                    <EditableTags
                      compact={hideNavigation}
                      values={businessKnowledge.services}
                      onChange={(values) => setBusinessField("services", values)}
                      disabled={voiceBusy}
                      addLabel={settingsT("ajouter_une_prestation_f819082b")}
                      placeholder={settingsT("ex_intervention_week_end_931e57fb")}
                      emptyText={t("baseServicesEmpty")}
                      maxItems={20}
                      inlineAdd
                    />
                    {!hideNavigation ? <span style={hintStyle}>{settingsT("inrcy_propose_automatiquement_les_prestations_li_7e2f1891")}</span> : null}
                  </section>
                  <section data-memory-field="specialties" style={cardStyle}>
                    <span style={labelStyle}>{t("specialtiesLabel")}</span>
                    {memoryTags("specialties", t("specialtiesAdd"), t("specialtiesPlaceholder"), true)}
                  </section>
                </div>
              </div>
            ) : null}

            {activeTab === "audience" ? (
              <div data-ai-memory-tab="audience" style={sectionStackStyle}>
                <section style={cardStyle}>
                  <SectionHeader
                    icon="🤝"
                    title={t("audienceTitle")}
                    description={hideNavigation ? "" : t("audienceDescription")}
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
                    {!hideNavigation ? <span style={hintStyle}>{settingsT("aide_l_ia_a_adapter_les_35ed6a9c")}</span> : null}
                  </div>
                  <div data-memory-two-columns style={twoColumnsStyle}>
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

            {mountedEmbeddedTabs.has("local") ? (
              <section data-ai-memory-tab="local" hidden={activeTab !== "local"}
                style={activeTab === "local" ? localTabStyle : hiddenWorkspaceTabStyle}>
                <BusinessLocationFields
                  key={`location-${locationContentRevision}`}
                  ref={businessLocationRef}
                  value={memory.contentLocation ?? { useHeadquarters: true, primaryArea: "" }}
                  onChange={(value) => setField("contentLocation", value)}
                  disabled={voiceBusy || saving || workspaceSaving || analyzing}
                  onUnsavedChange={handleLocationUnsavedChange}
                  assistantActive={assistantActive && activeTab === "local"}
                />
                <div data-local-presence-grid style={localPresenceGridStyle}>
                  <div data-local-zones style={localZonesCardStyle}>
                    <span style={labelStyle}>{settingsT("zones_d_intervention_a4999f61")}</span>
                    <EditableTags
                      compact={hideNavigation}
                      values={businessKnowledge.interventionZones}
                      onChange={(values) => setBusinessField("interventionZones", values)}
                      disabled={voiceBusy}
                      addLabel={settingsT("ajouter_une_zone_85f56481")}
                      placeholder={settingsT("ex_arras_c3287f39")}
                      emptyText={settingsT("ajoutez_les_villes_secteurs_ou_rayons_dc934f3a")}
                      maxItems={30}
                    />
                    {!hideNavigation ? <span style={hintStyle}>{settingsT("une_zone_par_tag_aide_l_7516e004")}</span> : null}
                  </div>
                  <div data-local-schedule style={localScheduleCardStyle}>
                    <div style={{ display: "grid", gap: 3 }}>
                      <span style={labelStyle}>{t("openingScheduleLabel")}</span>
                      {!hideNavigation ? <span style={hintStyle}>{t("openingScheduleHint")}</span> : null}
                    </div>
                    <BusinessScheduleEditor
                      value={businessKnowledge.weeklySchedule}
                      disabled={voiceDisabledFor("scheduleNotes")}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("scheduleNotes", busy)}
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
                    description={hideNavigation ? "" : t("expertiseDescription")}
                    trailing={<CompletionPill label={t("completion")} score={completionScore} />}
                  />
                  <div data-identity-core style={identityCoreGridStyle}>
                    <div data-identity-mission style={identityMissionCardStyle}>
                      <BusinessDnaRichTextEditor
                        assistantField="mission"
                        id="business-dna-mission"
                        label={t("missionLabel")}
                        value={memory.mission}
                        html={memory.richText.mission}
                        disabled={voiceDisabledFor("mission")}
                        onVoiceBusyChange={(busy) => handleVoiceBusyChange("mission", busy)}
                        onChange={setMissionRichField}
                        maxLength={800}
                        minHeight={120}
                        placeholder={t("missionPlaceholder")}
                      />
                    </div>
                    <div data-identity-tag-grid style={identityTagRowsStyle}>
                      <div data-identity-tag-card style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{settingsT("vos_forces_29964107")}</span>
                        <div style={identityTagContentStyle}>
                        <EditableTags
                      compact={hideNavigation}
                          values={businessKnowledge.strengths}
                          onChange={(values) => setBusinessField("strengths", values)}
                          disabled={voiceBusy}
                          addLabel={settingsT("ajouter_une_force_58699841")}
                          placeholder={settingsT("ex_intervention_rapide_e8d23c44")}
                          emptyText={settingsT("ajoutez_3_a_6_forces_qui_c9dbc997")}
                          maxItems={16}
                          inlineAdd
                        />
                        </div>
                      </div>
                      <div data-identity-tag-card style={identityTagRowStyle}>
                        <span style={identityTagLabelStyle}>{t("valuesLabel")}</span>
                        <div style={identityTagContentStyle}>
                          {memoryTags("values", t("valuesAdd"), t("valuesPlaceholder"), true)}
                        </div>
                      </div>
                      <div data-identity-tag-card style={identityTagRowStyle}>
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
                      <div data-identity-tag-card style={identityTagRowStyle}>
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

                  {!hideNavigation ? vocabularySection : null}
                </section>
              </div>
            ) : null}

            {activeTab === "news" ? (
              <section data-ai-memory-tab="news" style={{ ...cardStyle, ...newsCardStyle }}>
                <SectionHeader
                  icon="⚡"
                  title={t("newsTitle")}
                  description={hideNavigation ? "" : t("newsDescription")}
                  trailing={<span style={newsWindowBadgeStyle}>{t("newsWindowBadge")}</span>}
                />
                <div data-ai-memory-news-status style={newsStatusStyle}>
                  <span style={newsStatusCopyStyle}>
                    <strong>{t("newsAutomaticTitle")}</strong>
                    {!hideNavigation ? <span>{t("newsAutomaticHint")}</span> : null}
                  </span>
                  <span style={newsSourceRailStyle}>
                    {recentNewsSourceLabels.length ? recentNewsSourceLabels.map((label) => (
                      <span key={label} style={newsSourcePillStyle}>{label}</span>
                    )) : <span style={newsEmptySourceStyle}>{t("newsNoSources")}</span>}
                  </span>
                  {recentNewsUpdatedLabel ? (
                    <span style={newsUpdatedStyle}>
                      {t("newsLastUpdated", { date: recentNewsUpdatedLabel })}
                    </span>
                  ) : null}
                </div>
                <div data-ai-memory-news-rows style={newsGridStyle}>
                  {([0, 1, 2, 3] as const).map((index) => {
                    const target = `recentNewsItem${index}` as const;
                    return (
                      <div key={target} data-ai-memory-news-row style={newsItemCardStyle}>
                        <span aria-hidden style={newsItemNumberStyle}>{index + 1}</span>
                        <MemoryVoiceTextarea
                          label={t("newsItemLabel", { number: index + 1 })}
                          placeholder={t("newsItemPlaceholder")}
                          value={memory.recentNewsItems[index] || ""}
                          disabled={voiceDisabledFor(target)}
                          maxLength={2000}
                          onVoiceBusyChange={(busy) => handleVoiceBusyChange(target, busy)}
                          onChange={(next) => setRecentNewsItem(index, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {activeTab === "strategy" ? (
              <section data-ai-memory-tab="strategy" style={{ ...cardStyle, ...premiumCardStyle }}>
                <div data-ai-memory-strategy-heading style={sectionHeadingRowStyle}>
                  <SectionHeader
                    icon="🧠"
                    title={t("premiumTitle")}
                    description={hideNavigation ? "" : t("premiumDescription")}
                    trailing={<CompletionPill label={t("completion")} score={completionScore} />}
                  />
                </div>
                <div data-ai-memory-premium-rows style={premiumGridStyle}>
                  <div data-ai-memory-premium-row style={premiumFieldCardStyle}>
                    <span aria-hidden style={premiumFieldNumberStyle}>1</span>
                    <PremiumTextarea
                      assistantField="offersAndArguments"
                      label={t("offersLabel")}
                      placeholder={t("offersPlaceholder")}
                      value={memory.offersAndArguments}
                      html={memory.richText.offersAndArguments}
                      disabled={voiceDisabledFor("offersAndArguments")}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("offersAndArguments", busy)}
                      onChange={(next) => setPremiumRichField("offersAndArguments", next)}
                    />
                  </div>
                  <div data-ai-memory-premium-row style={premiumFieldCardStyle}>
                    <span aria-hidden style={premiumFieldNumberStyle}>2</span>
                    <PremiumTextarea
                      assistantField="keyArguments"
                      label={t("argumentsLabel")}
                      placeholder={t("argumentsPlaceholder")}
                      value={memory.keyArguments}
                      html={memory.richText.keyArguments}
                      disabled={voiceDisabledFor("keyArguments")}
                      maxLength={3000}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("keyArguments", busy)}
                      onChange={(next) => setPremiumRichField("keyArguments", next)}
                    />
                  </div>
                  <div data-ai-memory-premium-row style={premiumFieldCardStyle}>
                    <span aria-hidden style={premiumFieldNumberStyle}>3</span>
                    <PremiumTextarea
                      assistantField="proofsAndObjections"
                      label={t("proofsLabel")}
                      placeholder={t("proofsPlaceholder")}
                      value={memory.proofsAndObjections}
                      html={memory.richText.proofsAndObjections}
                      disabled={voiceDisabledFor("proofsAndObjections")}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("proofsAndObjections", busy)}
                      onChange={(next) => setPremiumRichField("proofsAndObjections", next)}
                    />
                  </div>
                  <div data-ai-memory-premium-row style={premiumFieldCardStyle}>
                    <span aria-hidden style={premiumFieldNumberStyle}>4</span>
                    <PremiumTextarea
                      assistantField="objectionResponses"
                      label={t("objectionsLabel")}
                      placeholder={t("objectionsPlaceholder")}
                      value={memory.objectionResponses}
                      html={memory.richText.objectionResponses}
                      disabled={voiceDisabledFor("objectionResponses")}
                      maxLength={3000}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("objectionResponses", busy)}
                      onChange={(next) => setPremiumRichField("objectionResponses", next)}
                    />
                  </div>
                  <div data-ai-memory-premium-row style={premiumFieldCardStyle}>
                    <span aria-hidden style={premiumFieldNumberStyle}>5</span>
                    <PremiumTextarea
                      assistantField="editorialStrategy"
                      label={t("editorialLabel")}
                      placeholder={t("editorialPlaceholder")}
                      value={memory.editorialStrategy}
                      html={memory.richText.editorialStrategy}
                      disabled={voiceDisabledFor("editorialStrategy")}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("editorialStrategy", busy)}
                      onChange={(next) => setPremiumRichField("editorialStrategy", next)}
                    />
                  </div>
                  <div data-ai-memory-premium-row style={premiumFieldCardStyle}>
                    <span aria-hidden style={premiumFieldNumberStyle}>6</span>
                    <PremiumTextarea
                      assistantField="campaignCalendar"
                      label={t("campaignCalendarLabel")}
                      placeholder={t("campaignCalendarPlaceholder")}
                      value={memory.campaignCalendar}
                      html={memory.richText.campaignCalendar}
                      disabled={voiceDisabledFor("campaignCalendar")}
                      maxLength={3000}
                      onVoiceBusyChange={(busy) => handleVoiceBusyChange("campaignCalendar", busy)}
                      onChange={(next) => setPremiumRichField("campaignCalendar", next)}
                    />
                  </div>
                </div>
              </section>
            ) : null}
              </>
            ) : null}
      </div>

      {!loading && loaded && activeTab !== "analysis" ? (
        <div data-ai-memory-tab-reset style={tabResetActionStyle}>
          <button
            type="button"
            disabled={voiceBusy || saving || workspaceSaving || documentUploadState !== "idle"}
            onClick={() => void resetCurrentTab()}
            style={{
              ...dangerButtonStyle,
              opacity: voiceBusy || saving || workspaceSaving || documentUploadState !== "idle" ? 0.58 : 1,
            }}
          >
            {t("reset")}
          </button>
        </div>
      ) : null}

      {workspaceError ? <div style={errorStyle}>{workspaceError}</div> : null}
      {vocabularyPortalTarget ? createPortal(
        loading ? <p role="status">{t("loading")}</p> : loaded ? vocabularySection : <div role="alert" style={errorStyle}>
          {t("loadError")} <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} style={secondaryButtonStyle}>{t("retry")}</button>
        </div>,
        vocabularyPortalTarget,
      ) : null}
      {activeTabRequiresAiMemory && error ? <div style={errorStyle}>{error}</div> : null}
      {saved ? <div style={successStyle}>{t("saved")}</div> : null}
      {autoSaveState === "saving" ? (
        <div aria-live="polite" style={autoSaveStatusStyle}>{t("saving")}</div>
      ) : null}

      <BusinessDnaAnalysisScheduleModal
        open={analysisScheduleOpen}
        onOpen={() => setAnalysisScheduleOpen(true)}
        assistantActive={assistantActive && activeTab === "analysis" && !loading && loaded && !voiceBusy && !saving && !workspaceSaving && !analyzing}
        onClose={() => setAnalysisScheduleOpen(false)}
      />

      {!loading && loaded && hasWorkspaceChanges ? (
        <div
          data-ai-memory-actions
          style={{
            ...actionsStyle,
            gridTemplateColumns:
              activeTabRequiresAiMemory && !profileDirty && !activityDirty && !locationDirty
                ? actionsStyle.gridTemplateColumns
                : "minmax(135px, 175px) minmax(220px, 310px)",
          }}
        >
          {activeTabRequiresAiMemory && !profileDirty && !activityDirty && !locationDirty ? (
            <button
              type="button"
              disabled={saving || voiceBusy || workspaceSaving}
              onClick={() => void resetWorkspace()}
              style={dangerButtonStyle}
            >
              {t("reset")}
            </button>
          ) : null}
          <button
            type="button"
              disabled={saving || voiceBusy || workspaceSaving}
            onClick={() => void cancelActiveTabChanges()}
            style={secondaryButtonStyle}
          >
            {t("cancelChanges")}
          </button>
          <button
            type="button"
              disabled={saving || voiceBusy || workspaceSaving}
            aria-busy={workspaceSaving}
            onClick={() => void saveWorkspace()}
            style={{ ...primaryButtonStyle, opacity: workspaceSaving || saving || voiceBusy ? 0.7 : 1 }}
          >
            {workspaceSaving || saving ? t("saving") : t("save")}
          </button>
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
        @media (min-width: 1101px) and (max-width: 1180px) {
          nav[data-ai-memory-desktop-tabs] {
            grid-template-columns: repeat(7, minmax(0, 1fr)) !important;
            gap: 3px !important;
            overflow: hidden !important;
          }
          nav[data-ai-memory-desktop-tabs] button {
            gap: 4px !important;
            padding-inline: 3px !important;
            font-size: 10px !important;
          }
        }
        nav[data-ai-memory-desktop-tabs] button > span:nth-child(2) {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        @media (max-width: 1100px) {
          nav[data-ai-memory-desktop-tabs] { display: none !important; }
        }
        @media (max-width: 720px) {
          section[data-business-dna-channel-analysis] { height: auto !important; min-height: 590px !important; padding: 24px 14px !important; }
          [data-business-dna-analysis-orb] {
            width: 100% !important;
            height: 270px !important;
            box-sizing: border-box;
            padding-top: 52px;
          }
          [data-dna-score-summary] { top: 6px !important; }
          [data-dna-assembly] { margin-top: 16px; }
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
          section[data-ai-memory-tab="news"],
          section[data-ai-memory-tab="strategy"] {
            gap: 14px !important;
            padding: 14px 11px !important;
          }
          section[data-ai-memory-tab="news"] > header {
            align-items: flex-start !important;
          }
          div[data-ai-memory-news-status] {
            align-items: flex-start !important;
          }
          div[data-ai-memory-news-status] > span:nth-child(2) {
            flex: 1 1 100% !important;
            justify-content: flex-start !important;
          }
          div[data-ai-memory-strategy-heading] {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          div[data-ai-memory-strategy-heading] > span:last-child {
            justify-self: start;
          }
          div[data-ai-memory-news-row],
          div[data-ai-memory-premium-row] {
            grid-template-columns: 34px minmax(0, 1fr) !important;
            gap: 10px !important;
            padding: 11px !important;
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
});

export default AiMemoryContent;

function SectionHeader({ icon, title, description, trailing, onIconClick, iconLabel, iconDisabled }: { icon: string; title: string; description: string; trailing?: ReactNode; onIconClick?: () => void; iconLabel?: string; iconDisabled?: boolean }) {
  return (
    <header data-memory-section-heading style={sectionHeaderStyle}>
      {onIconClick ? <button type="button" onClick={onIconClick} disabled={iconDisabled} aria-label={iconLabel} title={iconLabel} style={{ ...sectionIconStyle, color: "inherit", cursor: iconDisabled ? "default" : "pointer", padding: 0, font: "inherit", opacity: iconDisabled ? .5 : 1 }}>{icon}</button> : <span aria-hidden style={sectionIconStyle}>{icon}</span>}
      <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
        <strong style={{ color: "white", fontSize: 15 }}>{title}</strong>
        {description ? <span style={hintStyle}>{description}</span> : null}
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

function MemoryVoiceTextarea({
  label,
  placeholder,
  value,
  disabled,
  maxLength,
  onVoiceBusyChange,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  maxLength: number;
  onVoiceBusyChange: (busy: boolean) => void;
  onChange: (next: string) => void;
}) {
  return (
    <div style={{ ...voiceTextareaFieldStyle, opacity: disabled ? 0.56 : 1 }}>
      <span style={voiceTextareaHeadingStyle}>
        <span style={labelStyle}>{label}</span>
        <span style={identityMissionActionsStyle}>
          <MediaSubjectVoiceButton
            disabled={disabled}
            value={value}
            contextLabel={label}
            onChange={onChange}
            onBusyChange={onVoiceBusyChange}
            purpose="content"
            placement="inline"
            mergeMode="paragraph"
            maxLength={maxLength}
          />
          <span style={identityCounterStyle}>{value.length}/{maxLength}</span>
        </span>
      </span>
      <textarea
        value={value}
        readOnly={disabled}
        onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
        maxLength={maxLength}
        rows={5}
        placeholder={placeholder}
        style={voiceTextareaInputStyle}
      />
    </div>
  );
}

function PremiumTextarea({
  assistantField,
  label,
  placeholder,
  value,
  html,
  maxLength = 5000,
  disabled,
  onVoiceBusyChange,
  onChange,
}: {
  assistantField: InrAssistantBusinessRichTextField;
  label: string;
  placeholder: string;
  value: string;
  html: string;
  maxLength?: number;
  disabled: boolean;
  onVoiceBusyChange: (busy: boolean) => void;
  onChange: (next: { text: string; html: string }) => void;
}) {
  return (
    <div style={{ ...fieldStyle, opacity: disabled ? 0.56 : 1 }}>
      <BusinessDnaRichTextEditor
        assistantField={assistantField}
        label={label}
        value={value}
        html={html}
        disabled={disabled}
        maxLength={maxLength}
        minHeight={112}
        onVoiceBusyChange={onVoiceBusyChange}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  );
}

const pageStyle: CSSProperties = { display: "grid", gap: 11, width: "100%", maxWidth: "none", margin: 0, paddingBottom: "max(14px, var(--inrcy-safe-area-bottom))" };
const cardStyle: CSSProperties = { display: "grid", gap: 18, padding: "clamp(14px, 2.2vw, 22px)", borderRadius: 20, border: "1px solid rgba(125,211,252,0.17)", background: "linear-gradient(145deg, rgba(11,27,52,0.82), rgba(31,23,58,0.70))", boxShadow: "0 16px 44px rgba(0,0,0,0.18)", minWidth: 0 };
const analysisOrbStageStyle: CSSProperties = { position: "relative", width: "min(530px, 92vw)", height: 300, boxSizing: "border-box", paddingTop: 42, display: "grid", placeItems: "center", perspective: 760 };
const analysisOrbAuraStyle: CSSProperties = { position: "absolute", inset: "4% 12%", borderRadius: "46%", background: "radial-gradient(ellipse, rgba(124,58,237,0.40), rgba(6,182,212,0.14) 43%, rgba(236,72,153,.08) 58%, transparent 74%)", filter: "blur(23px)", opacity: 0.72 };
const analysisDnaAssemblyStyle: CSSProperties = { position: "relative", zIndex: 4, width: 210, height: 220, display: "grid", placeItems: "center", transformStyle: "preserve-3d" };
const analysisDnaModelStyle: CSSProperties = { position: "relative", width: 184, height: 188, transform: "translateY(-13px) rotate(-2deg)", transformStyle: "preserve-3d", filter: "drop-shadow(0 0 22px rgba(139,92,246,.24))" };
const analysisStreamLeftStyle: CSSProperties = { position: "absolute", zIndex: 2, left: 0, top: "16%", width: "calc(50% - 110px)", height: "68%", overflow: "hidden", maskImage: "linear-gradient(90deg, transparent, black 20%, black)" };
const analysisStreamRightStyle: CSSProperties = { position: "absolute", zIndex: 2, right: 0, top: "16%", width: "calc(50% - 110px)", height: "68%", overflow: "hidden", maskImage: "linear-gradient(270deg, transparent, black 20%, black)" };
const analysisStreamParticleStyle: CSSProperties = { position: "absolute", width: 5, height: 5, borderRadius: "50%", background: "#fdf2f8", boxShadow: "0 0 8px #f472b6, 0 0 20px rgba(56,189,248,.72)", opacity: 0.24 };
const tabListStyle: CSSProperties = { position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "repeat(9, minmax(0, 1fr))", gap: 5, padding: 6, overflow: "hidden", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(5,13,28,0.94)", boxShadow: "0 12px 34px rgba(0,0,0,0.20)", backdropFilter: "blur(18px)" };
const tabButtonStyle: CSSProperties = { minWidth: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 6, borderRadius: 11, border: "1px solid transparent", background: "transparent", color: "rgba(255,255,255,0.66)", padding: "9px 5px", cursor: "pointer", fontSize: 11.5, fontWeight: 850, whiteSpace: "nowrap", overflow: "hidden" };
const activeTabButtonStyle: CSSProperties = { border: "1px solid rgba(125,211,252,0.28)", background: "linear-gradient(135deg, rgba(14,165,233,0.18), rgba(124,58,237,0.18))", color: "white", boxShadow: "0 7px 22px rgba(14,165,233,0.10)" };
const tabPanelStyle: CSSProperties = { minWidth: 0 };
const tabResetActionStyle: CSSProperties = { display: "flex", justifyContent: "flex-end", paddingTop: 12 };
const sectionStackStyle: CSSProperties = { display: "grid", gap: 15, minWidth: 0 };
const hiddenWorkspaceTabStyle: CSSProperties = { display: "none" };
const sectionHeadingRowStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "start", gap: 12 };
const sectionHeaderStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 11, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,0.09)" };
const sectionIconStyle: CSSProperties = { width: 36, height: 36, flex: "0 0 auto", display: "grid", placeItems: "center", borderRadius: 11, border: "1px solid rgba(125,211,252,0.22)", background: "rgba(56,189,248,0.10)" };
const completionPillStyle: CSSProperties = { minWidth: 61, height: 31, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 9px", borderRadius: 999, border: "1px solid rgba(196,181,253,0.25)", background: "linear-gradient(135deg, rgba(14,165,233,0.12), rgba(124,58,237,0.18))", color: "#ddd6fe", fontSize: 11.5, boxShadow: "0 7px 22px rgba(76,29,149,0.13)" };
const completionPillSparkStyle: CSSProperties = { color: "#67e8f9", fontSize: 10, textShadow: "0 0 10px rgba(103,232,249,.72)" };
const fieldStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0 };
const labelStyle: CSSProperties = { color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: 850, lineHeight: 1.35 };
const hintStyle: CSSProperties = { color: "rgba(255,255,255,0.60)", fontSize: 11.5, lineHeight: 1.4 };
const twoColumnsStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))", gap: 18, minWidth: 0 };
const identityCoreGridStyle: CSSProperties = { display: "grid", gap: 12, minWidth: 0 };
const identityMissionCardStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0, padding: 13, borderRadius: 16, border: "1px solid rgba(56,189,248,0.18)", background: "linear-gradient(145deg, rgba(8,47,73,.28), rgba(20,20,54,.38))" };
const identityMissionActionsStyle: CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 8 };
const identityTagRowsStyle: CSSProperties = { display: "grid", gap: 8, minWidth: 0 };
const identityTagRowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: "8px 18px", minWidth: 0, padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(167,139,250,0.14)", background: "linear-gradient(145deg, rgba(30,41,79,.34), rgba(41,23,70,.25))" };
const identityTagLabelStyle: CSSProperties = { flex: "1 1 180px", maxWidth: 235, paddingTop: 9, color: "rgba(255,255,255,0.88)", fontSize: 12.5, fontWeight: 850, lineHeight: 1.35 };
const identityTagContentStyle: CSSProperties = { flex: "5 1 560px", minWidth: 0 };
const identityTextareaStyle: CSSProperties = { width: "100%", minHeight: 104, resize: "vertical", borderRadius: 13, border: "1px solid rgba(255,255,255,0.13)", background: "rgba(3,10,30,0.52)", color: "white", padding: "11px 12px", font: "inherit", fontSize: 12.5, lineHeight: 1.5, outline: "none" };
const identityCounterStyle: CSSProperties = { flex: "0 0 auto", color: "rgba(255,255,255,0.42)", fontSize: 10.5 };
const voiceTextareaFieldStyle: CSSProperties = { display: "grid", alignContent: "start", gap: 9, minWidth: 0, width: "100%", height: "100%" };
const voiceTextareaHeadingStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 12px", minWidth: 0 };
const voiceTextareaInputStyle: CSSProperties = { ...identityTextareaStyle, minHeight: 104, height: "100%" };
const identityVocabularySectionStyle: CSSProperties = { display: "grid", gap: 14, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.09)" };
const identityVocabularyHeadingStyle: CSSProperties = { display: "grid", gap: 3 };
const identityVocabularyTitleStyle: CSSProperties = { color: "white", fontSize: 14.5, lineHeight: 1.3 };
const localTabStyle: CSSProperties = { minHeight: "clamp(500px, calc(100svh - 305px), 650px)", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 12, alignItems: "stretch" };
const localPresenceGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(240px, .30fr) minmax(0, .70fr)", alignItems: "stretch", gap: 12 };
const localZonesCardStyle: CSSProperties = { display: "grid", alignContent: "start", gap: 12, padding: 16, borderRadius: 18, border: "1px solid rgba(56,189,248,0.18)", background: "linear-gradient(145deg, rgba(10,39,68,.72), rgba(20,21,56,.62))", boxShadow: "0 16px 44px rgba(0,0,0,.16)" };
const localScheduleCardStyle: CSSProperties = { display: "grid", alignContent: "start", gap: 9, padding: 14, borderRadius: 18, border: "1px solid rgba(167,139,250,0.18)", background: "linear-gradient(145deg, rgba(18,27,62,.72), rgba(42,22,72,.62))", boxShadow: "0 16px 44px rgba(0,0,0,.16)" };
const checkboxGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 9 };
const choiceStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.88)" };
const selectedChoiceStyle: CSSProperties = { border: "1px solid rgba(56,189,248,0.34)", background: "rgba(56,189,248,0.10)" };
const newsCardStyle: CSSProperties = { border: "1px solid rgba(56,189,248,0.26)", background: "radial-gradient(circle at 100% 0, rgba(236,72,153,.12), transparent 34%), linear-gradient(145deg, rgba(8,47,73,.38), rgba(37,21,69,.72))" };
const newsWindowBadgeStyle: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 28, padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(103,232,249,.30)", background: "rgba(8,145,178,.13)", color: "#a5f3fc", fontSize: 10.5, fontWeight: 900, whiteSpace: "nowrap" };
const newsStatusStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px", padding: "11px 13px", borderRadius: 15, border: "1px solid rgba(167,139,250,.16)", background: "rgba(5,13,35,.48)" };
const newsStatusCopyStyle: CSSProperties = { flex: "1 1 330px", display: "grid", gap: 3, minWidth: 0, color: "white", fontSize: 12, lineHeight: 1.4 };
const newsSourceRailStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 5 };
const newsSourcePillStyle: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 24, padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(103,232,249,.22)", background: "rgba(14,165,233,.09)", color: "rgba(224,242,254,.86)", fontSize: 9.5, fontWeight: 850 };
const newsEmptySourceStyle: CSSProperties = { color: "rgba(203,213,225,.58)", fontSize: 10.5, fontWeight: 750 };
const newsUpdatedStyle: CSSProperties = { flex: "0 0 100%", color: "rgba(196,181,253,.66)", fontSize: 10, fontWeight: 750 };
const newsGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "stretch", gap: 11 };
const newsItemCardStyle: CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "40px minmax(0, 1fr)", alignItems: "start", gap: 13, padding: 14, borderRadius: 17, border: "1px solid rgba(103,232,249,.18)", background: "linear-gradient(115deg, rgba(8,47,73,.34), rgba(23,26,66,.48) 56%, rgba(60,24,75,.34))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025), 0 10px 28px rgba(0,0,0,.10)" };
const newsItemNumberStyle: CSSProperties = { width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 12, border: "1px solid rgba(103,232,249,.28)", background: "linear-gradient(145deg, rgba(14,165,233,.20), rgba(124,58,237,.18))", color: "#a5f3fc", fontSize: 12, fontWeight: 950, boxShadow: "0 8px 20px rgba(14,165,233,.10)" };
const documentsCardStyle: CSSProperties = { border: "1px solid rgba(167,139,250,.28)", background: "radial-gradient(circle at 100% 0, rgba(56,189,248,.11), transparent 34%), linear-gradient(145deg, rgba(17,24,58,.76), rgba(45,23,72,.68))" };
const documentsCountStyle: CSSProperties = { display: "inline-flex", alignItems: "center", minHeight: 28, padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(167,139,250,.30)", background: "rgba(124,58,237,.13)", color: "#ddd6fe", fontSize: 10.5, fontWeight: 900, whiteSpace: "nowrap" };
const documentsStorageStyle: CSSProperties = { display: "grid", gap: 9, padding: "12px 13px", borderRadius: 15, border: "1px solid rgba(56,189,248,.24)", background: "linear-gradient(115deg, rgba(8,47,73,.34), rgba(30,41,90,.36))", color: "white", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025)" };
const documentsStorageNearStyle: CSSProperties = { borderColor: "rgba(250,204,21,.42)", background: "linear-gradient(115deg, rgba(113,63,18,.25), rgba(49,46,129,.30))" };
const documentsStorageReachedStyle: CSSProperties = { borderColor: "rgba(248,113,113,.48)", background: "linear-gradient(115deg, rgba(127,29,29,.27), rgba(76,29,149,.25))" };
const documentsStorageHeadingStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 14px" };
const documentsStorageCopyStyle: CSSProperties = { display: "grid", gap: 2, minWidth: 0, fontSize: 12, lineHeight: 1.35 };
const documentsStorageValueStyle: CSSProperties = { color: "#e0f2fe", fontSize: 12, fontWeight: 950, whiteSpace: "nowrap" };
const documentsStorageTrackStyle: CSSProperties = { display: "block", width: "100%", height: 7, overflow: "hidden", borderRadius: 999, background: "rgba(2,6,23,.56)", boxShadow: "inset 0 1px 3px rgba(0,0,0,.36)" };
const documentsStorageFillStyle: CSSProperties = { display: "block", minWidth: 0, height: "100%", borderRadius: "inherit", background: "linear-gradient(90deg, #22d3ee, #8b5cf6)", transition: "width 240ms ease" };
const documentsListStyle: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 10 };
const documentItemStyle: CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "42px minmax(0, 1fr) 34px", alignItems: "center", gap: 10, padding: 12, borderRadius: 15, border: "1px solid rgba(255,255,255,.10)", background: "rgba(4,11,31,.45)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025)" };
const documentFileIconStyle: CSSProperties = { width: 40, height: 40, display: "grid", placeItems: "center", borderRadius: 12, background: "rgba(124,58,237,.16)", fontSize: 18 };
const documentItemCopyStyle: CSSProperties = { minWidth: 0, display: "grid", gap: 3, color: "white", fontSize: 11.5, lineHeight: 1.35, overflowWrap: "anywhere" };
const documentDeleteButtonStyle: CSSProperties = { width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 10, border: "1px solid rgba(248,113,113,.22)", background: "rgba(127,29,29,.15)", color: "#fecaca", cursor: "pointer", fontSize: 19, lineHeight: 1 };
const premiumCardStyle: CSSProperties = { border: "1px solid rgba(251,191,36,0.28)", background: "linear-gradient(145deg, rgba(92,55,7,0.20), rgba(49,24,71,0.66))" };
const premiumGridStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "stretch", gap: 11 };
const premiumFieldCardStyle: CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "40px minmax(0, 1fr)", alignItems: "start", gap: 13, padding: 14, borderRadius: 17, border: "1px solid rgba(251,191,36,.17)", background: "linear-gradient(115deg, rgba(92,55,7,.17), rgba(42,23,67,.48) 58%, rgba(76,29,70,.28))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.025), 0 10px 28px rgba(0,0,0,.10)" };
const premiumFieldNumberStyle: CSSProperties = { width: 38, height: 38, display: "grid", placeItems: "center", borderRadius: 12, border: "1px solid rgba(251,191,36,.28)", background: "linear-gradient(145deg, rgba(245,158,11,.18), rgba(168,85,247,.18))", color: "#fde68a", fontSize: 12, fontWeight: 950, boxShadow: "0 8px 20px rgba(146,64,14,.10)" };
const actionsStyle: CSSProperties = { position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "minmax(105px, 130px) minmax(135px, 175px) minmax(220px, 310px)", justifyContent: "end", gap: 8, padding: "2px 0 0", background: "transparent" };
const secondaryButtonStyle: CSSProperties = { minHeight: 38, borderRadius: 11, border: "1px solid rgba(255,255,255,0.13)", background: "rgba(255,255,255,0.05)", color: "white", padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 800 };
const dangerButtonStyle: CSSProperties = { minHeight: 38, borderRadius: 11, border: "1px solid rgba(248,113,113,0.22)", background: "rgba(127,29,29,0.13)", color: "#fecaca", padding: "8px 10px", cursor: "pointer", fontSize: 12, fontWeight: 850 };
const primaryButtonStyle: CSSProperties = { minHeight: 38, borderRadius: 11, border: "1px solid rgba(196,181,253,0.38)", background: "linear-gradient(100deg, #0ea5e9, #7c3aed 55%, #ec4899)", color: "white", padding: "8px 11px", cursor: "pointer", fontSize: 12.5, fontWeight: 950, boxShadow: "0 10px 24px rgba(124,58,237,0.18)" };
const errorStyle: CSSProperties = { padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(248,113,113,0.30)", background: "rgba(127,29,29,0.18)", color: "#fecaca", fontSize: 13, fontWeight: 800 };
const successStyle: CSSProperties = { padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(103,232,249,0.28)", background: "rgba(8,145,178,0.14)", color: "#a5f3fc", fontSize: 13, fontWeight: 850 };
const autoSaveStatusStyle: CSSProperties = { padding: "8px 11px", borderRadius: 10, border: "1px solid rgba(103,232,249,0.20)", background: "rgba(8,145,178,0.08)", color: "rgba(165,243,252,.88)", fontSize: 11, fontWeight: 800, justifySelf: "end" };
