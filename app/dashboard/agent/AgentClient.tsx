"use client";

import { useLocale, useTranslations } from "next-intl";


import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  useRouter,
} from "next/navigation";
import {
  createClient,
} from "@/lib/supabaseClient";
import {
  resolveActiveBrowserUserId,
} from "@/lib/browserAccountCache";
import {
  ChannelImageAdapterModal,
} from "@/app/dashboard/_components/ChannelImageAdapterTool";
import EmojiPickerButton from "../_components/EmojiPickerButton";
import {
  requestBoosterVideoTransforms,
} from "@/lib/boosterVideoTransformClient";
import type {
  BoosterVideoTransformedVariant,
} from "@/lib/boosterVideoTransforms";
import {
  INR_MEDIA_IMAGE_FORMATS_LABEL,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
  INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
  INR_MEDIA_VIDEO_FORMATS_LABEL,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
  isInrMediaImageFile,
} from "@/lib/mediaRules";
import {
  makeAttachmentPath,
} from "@/app/dashboard/mails/_lib/mailboxPhase25";
import HelpButton from "../_components/HelpButton";
import {
  useUnsavedExitGuard,
} from "../_hooks/useUnsavedExitGuard";
import {
  confirmInrcy,
} from "@/lib/inrcyDialog";
import CampaignScheduleModal from "../_components/CampaignScheduleModal";
import PublishScheduleModal, {
  type PublishScheduleItem,
  type PublishScheduleSelection,
} from "../_components/PublishScheduleModal";
import PublishAiConfigurationDrawer from "../booster/publier/components/PublishAiConfigurationDrawer";
import BoosterVideoFormatManager, {
  type BoosterVideoPreparationState,
} from "../booster/publier/components/BoosterVideoFormatManager";
import RichSiteContentEditor from "../booster/publier/components/RichSiteContentEditor";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "../_components/MediaLibraryPickerModal";
import MediaOptimizerModal, {
  type MediaOptimizerItem,
} from "../_components/MediaOptimizerModal";
import {
  MEDIA_LIBRARY_EMAIL_TARGET_BYTES,
  getMediaLibraryOptimizationRequirements,
} from "@/lib/mediaLibraryOptimizationPolicy";
import {
  UNIVERSAL_MEDIA_VIDEO_EXTENSIONS,
  UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  detectUniversalUploadMediaType,
} from "@/lib/mediaUploadPolicy";
import {
  BOOSTER_PREFERRED_CTA_OPTIONS,
  CHANNEL_PRESETS,
  buildPreferredCtaPatch,
  computePreviewLayout,
  getBackgroundFill,
  getBackgroundMode,
  getLocalizedCtaModeHelp,
  getLocalizedPreferredCtaLabel,
  getLocalizedVideoAdaptationModeLabel,
  getLocalizedVideoFormatLabel,
  getLocalizedWebsiteSourceLabelForChannel,
  getDefaultTransform,
  getEffectiveTransformZoom,
  getChannelSafetyBackgroundMode,
  getOptimizedTransform,
  getPreferredCtaChoiceFromPost,
  getWebsiteUrlForChannel,
  normalizeBoosterAiLanguage,
  normalizeBoosterPreferredCta,
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  readImageMeta,
  renderChannelImage,
  type BoosterCtaDefaults,
  type BoosterCtaMode,
  type BoosterPreferredCta,
  type BoosterVideoSourceMetadata,
  type ChannelKey as BoosterChannelKey,
  type ChannelPost as BoosterChannelPost,
  type ImageMeta,
  type ImageTransform,
  type VideoAdaptationMode,
  type VideoFormat,
} from "../booster/publier/publishModal.shared";
import {
  sanitizeInrAgentSettings,
  type InrAgentSettings,
} from "@/lib/inrAgentSettings";
import {
  inrAgentMonthlyDateCount,
  normalizeInrAgentMonthDays,
} from "@/lib/inrAgentMonthSchedule";
import { isStandardAgentAutomationKey } from "@/lib/standardAgentPolicy";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import styles from "./agent.module.css";
import dashboardStyles from "../dashboard.module.css";
import { useAgentResponsiveUi } from "./_hooks/useAgentResponsiveUi";
import {
  useAgentRuntimeData,
  writeCachedAgentViewSnapshot,
} from "./_hooks/useAgentRuntimeData";
import { useAgentRichTextEditors } from "./_hooks/useAgentRichTextEditors";
import { useAgentAutomationController } from "./_hooks/useAgentAutomationController";
import { useAgentActionExecution } from "./_hooks/useAgentActionExecution";
import AgentFeedbackModals from "./_components/AgentFeedbackModals";
import {
  AgentScheduleModal,
  AttachmentModal,
  CampaignDraftConfirmModal,
  CampaignEditChoiceModal,
  MailAccountEditModal,
  PublishEditChoiceModal,
  RecipientsPreviewModal,
  ValidationChoiceModal,
} from "./_components/AgentActionModals";
import {
  CampaignMailTextModal,
  RecipientsPickerModal,
} from "./_components/AgentCampaignEditors";
import {
  AutomationIcon,
  AutomationSettingsIcon,
  CalendarMetaIcon,
  DownloadActionIcon,
  ImageMetaIcon,
  PencilActionIcon,
  RefuseActionIcon,
  SendPlaneIcon,
  ShieldLineIcon,
  SparkSettingsIcon,
  ValidateActionIcon,
  renderRichInlineText,
} from "./_components/AgentVisuals";
import type {
  AutomationKey,
  ChannelKey,
  PublishMediaMutation,
  AutomationConfig,
  AgentPreparedAction,
  AgentMediaLibraryItem,
  CampaignAttachmentRef,
  CampaignRecipientPreview,
  CrmContactForAgent,
  AgentMailAccount,
  CampaignMailPreview,
  AgentScheduledAction,
  ScheduledActionEditSession,
  ScheduleOnlyEditState,
  AutomationScheduleEditState,
  AgentConfirmDialogState,
  ScheduleListItem,
} from "./_lib/agent.types";

type AgentMediaOptimizerRequest = {
  source:
    | { kind: "file"; file: File }
    | { kind: "library"; item: MediaOptimizerItem };
  destination: "publish" | "campaign";
};
import {
  AGENT_MEDIA_MAX_IMAGE_BYTES,
  AGENT_MEDIA_MAX_VIDEO_BYTES,
  ROBOT_SRC,
  channelOptions,
  statsRubriqueOptions,
  pendingActionStatuses,
  weekDays,
  hourOptions,
  settingsOptions,
  automations,
  robotStepsByAutomation,
  apiToDay,
  AGENT_RICH_TEXT_EDITOR_STYLE,
} from "./_lib/agent.config";

import {
  clampNumber,
  toggleItem,
  firstSafeString,
  asRecord,
} from "./_lib/agent.utils";
import {
  dataUrlToFile,
  offsetFromDrawPosition,
  urlToFile,
} from "./_lib/agent.media-adapter";
import {
  mediaPatchFromLibraryItem,
  readAgentApiJson,
  readAgentMediaFileInfo,
} from "./_lib/agent.publish-media-foundations";
import {
  orderChannels,
  toggleChannelItem,
  boosterDisplayKeyFromAgentChannel,
  boosterChannelKeyFromAgentChannel,
  normalizeAgentCtaMode,
  inferPreferredCtaChoiceFromLabel,
  connectedChannelsForAutomation,
  normalizeConfigsForConnectedChannels,
  dayOffsetLabel,
  normalizeConfigScheduleSlots,
  settingsToConfigs,
  configsToSettings,
  inrSendFolderForAutomation,
  headerToolLinkForAutomation,
} from "./_lib/agent.settings";
import {
  extractImageAsset,
  imageAssetUrl,
  imageAssetAlt,
  extractChannelPreview,
  isPublishPreparedAction,
  publishPostParagraphs,
  channelSupportsHashtags,
  extractPublishMediaPreview,
  getPublishMediaRecord,
  getMediaVideoSettingsRecord,
  extractPublishMediaAdaptationPreview,
  publishStatusLabel,
  extractPublishCtaLine,
} from "./_lib/agent.publish-preview";
import {
  previewParagraphs,
  isCampaignAutomationKey,
  normalizeCampaignAttachmentRefs,
  recipientsForAction,
  contactDisplayName,
  contactToCampaignRecipient,
  parseRecipientEmails,
  sanitizeDepartmentFilter,
  contactDepartment,
  manualRecipientFromEmail,
  extractCampaignMailPreview,
  channelsForAction,
  targetThemesLabel,
  recipientsCountForAction,
} from "./_lib/agent.campaign-preview";
import {
  formatActionDate,
  statsReportsFromActions,
  formatDateTimeLabel,
  formatMiniDateLabel,
  formatReportDateLabel,
} from "./_lib/agent.reports";
import {
  scheduleDateParts,
  scheduleTypeLabelFromAutomation,
  scheduleChannelLabelFromAutomation,
  scheduledActionTypeLabel,
  isScheduledSimpleMailAction,
  isScheduledStatsAction,
  scheduledActionChannelLabels,
  scheduledActionChannelLabel,
  preparedActionDirtySignature,
  scheduledAutomationKey,
  scheduledActionToPreparedAction,
  updateScheduledEditPublishText,
  updateScheduledEditPublishMedia,
  updateScheduledEditCampaign,
  scheduledEditUpdateFromAction,
  computeNextOccurrence,
} from "./_lib/agent.schedule";
import {
  agentActionStatusLabel,
  agentActionTypeLabel,
  agentAutomationSettingsTitle,
  agentAutomationStep,
  agentAutomationTitle,
  agentChannelLabel,
  agentConnectedChannelMessage,
  agentContentKindLabel,
  agentFrequencyLabel,
  agentMediaStatusLabel,
  agentProgressLabel,
  agentScheduleChannelLabel,
  agentScheduledStatusLabel,
  agentScheduleTypeLabel,
  agentSourceLabel,
  agentThemeLabel,
  agentThemeListLabel,
  agentToolLabel,
  agentValidationLabel,
  agentWeekdayLabel,
  type AgentTranslator,
} from "./_lib/agent.i18n";

const AGENT_VIDEO_OPTIMIZER_ACCEPT = [
  ...UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  ...UNIVERSAL_MEDIA_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export default function AgentClient() {
  const i18nT = useTranslations("agent");
  const boosterT = useTranslations("booster");
  const boosterRuntimeT = boosterT as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const locale = useLocale();
  const runtimeT = i18nT as unknown as AgentTranslator;
  const router = useRouter();
  const standardMode = useDashboardEdition() === "standard";
  const visibleAutomations = useMemo(
    () =>
      standardMode
        ? automations.filter((automation) =>
            isStandardAgentAutomationKey(automation.key),
          )
        : automations,
    [standardMode],
  );
  const {
    agentSettings,
    setAgentSettings,
    configs,
    setConfigs,
    agentConnectedChannels,
    connectedChannelsLoadState,
    loadState,
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
    setScheduledActionsTableMissing,
    actionsLoadState,
    refreshActions,
    refreshScheduledActions,
    showNotice,
  } = useAgentRuntimeData({ standardMode });
  const { robotPanelOpen, setRobotPanelOpen, isMobileHeader } =
    useAgentResponsiveUi();
  const [selectedKey, setSelectedKey] = useState<AutomationKey>("publish");
  const [settingsKey, setSettingsKey] = useState<AutomationKey | null>(null);
  const [agentConfirmDialog, setAgentConfirmDialog] =
    useState<AgentConfirmDialogState>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiConfigurationOpen, setAiConfigurationOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledEditSession, setScheduledEditSession] =
    useState<ScheduledActionEditSession | null>(null);
  const [scheduleOnlyEdit, setScheduleOnlyEdit] =
    useState<ScheduleOnlyEditState | null>(null);
  const [scheduleOnlyEditError, setScheduleOnlyEditError] = useState<string | null>(null);
  const [automationScheduleEdit, setAutomationScheduleEdit] =
    useState<AutomationScheduleEditState | null>(null);
  const [automationScheduleEditError, setAutomationScheduleEditError] =
    useState<string | null>(null);
  const [scheduleMutationState, setScheduleMutationState] = useState<
    "idle" | "saving"
  >("idle");
  const [validationChoiceOpen, setValidationChoiceOpen] = useState(false);
  const [validationScheduleOpen, setValidationScheduleOpen] = useState(false);
  const [validationScheduleState, setValidationScheduleState] = useState<
    "idle" | "saving"
  >("idle");
  const [pendingImmediateAgentPublishAfterSchedule, setPendingImmediateAgentPublishAfterSchedule] =
    useState<{
      action: AgentPreparedAction;
      actionId: string;
      channels: BoosterChannelKey[];
    } | null>(null);
  const [selectedChannelByAction, setSelectedChannelByAction] = useState<
    Record<string, ChannelKey>
  >({});
  const [selectedChannelByAutomation, setSelectedChannelByAutomation] =
    useState<Partial<Record<AutomationKey, ChannelKey>>>({});
  const [campaignEditOpen, setCampaignEditOpen] = useState(false);
  const [publishEditChoiceOpen, setPublishEditChoiceOpen] = useState(false);
  const [mailTextEditOpen, setMailTextEditOpen] = useState(false);
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = useState(false);
  const [campaignDraftConfirmOpen, setCampaignDraftConfirmOpen] =
    useState(false);
  const [campaignTextDraft, setCampaignTextDraft] = useState({
    subject: "",
    body: "",
  });
  const [campaignSaveState, setCampaignSaveState] = useState<"idle" | "saving">(
    "idle",
  );
  const [campaignDraftSaveState, setCampaignDraftSaveState] = useState<
    "idle" | "saving"
  >("idle");
  const [recipientsPreviewOpen, setRecipientsPreviewOpen] = useState(false);
  const [recipientsEditOpen, setRecipientsEditOpen] = useState(false);
  const [crmContacts, setCrmContacts] = useState<CrmContactForAgent[]>([]);
  const [crmContactsLoading, setCrmContactsLoading] = useState(false);
  const [crmRecipientSearch, setCrmRecipientSearch] = useState("");
  const [crmRecipientFiltersOpen, setCrmRecipientFiltersOpen] = useState(false);
  const [crmRecipientCategory, setCrmRecipientCategory] = useState("all");
  const [crmRecipientType, setCrmRecipientType] = useState("all");
  const [crmRecipientDepartment, setCrmRecipientDepartment] = useState("");
  const [crmRecipientImportantOnly, setCrmRecipientImportantOnly] =
    useState(false);
  const [manualRecipientsInput, setManualRecipientsInput] = useState("");
  const [selectedRecipientEmails, setSelectedRecipientEmails] = useState<
    string[]
  >([]);
  const [newRecipientOpen, setNewRecipientOpen] = useState(false);
  const [newRecipientDraft, setNewRecipientDraft] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [newRecipientState, setNewRecipientState] = useState<"idle" | "saving">(
    "idle",
  );
  const [mailAccountEditOpen, setMailAccountEditOpen] = useState(false);
  const [mailAccounts, setMailAccounts] = useState<AgentMailAccount[]>([]);
  const [mailAccountsLoading, setMailAccountsLoading] = useState(false);
  const [selectedMailAccountId, setSelectedMailAccountId] = useState("");
  const [attachmentUploadState, setAttachmentUploadState] = useState<
    "idle" | "saving"
  >("idle");
  const [campaignMediaLibraryPickerOpen, setCampaignMediaLibraryPickerOpen] =
    useState(false);
  const [publishMediaPreviewOpen, setPublishMediaPreviewOpen] = useState(false);
  const [publishMediaActiveIndex, setPublishMediaActiveIndex] = useState(0);
  const [publishMediaLibraryPickerOpen, setPublishMediaLibraryPickerOpen] =
    useState(false);
  const [publishMediaUploadState, setPublishMediaUploadState] = useState<
    "idle" | "saving"
  >("idle");
  const [mediaOptimizerRequest, setMediaOptimizerRequest] =
    useState<AgentMediaOptimizerRequest | null>(null);
  const [mediaOptimizerQueue, setMediaOptimizerQueue] = useState<
    AgentMediaOptimizerRequest[]
  >([]);
  const [mediaOptimizerCompleted, setMediaOptimizerCompleted] = useState(false);
  const [publishImageAdapterOpen, setPublishImageAdapterOpen] = useState(false);
  const [publishImageAdapterFile, setPublishImageAdapterFile] =
    useState<File | null>(null);
  const [publishImageAdapterPreviewUrl, setPublishImageAdapterPreviewUrl] =
    useState("");
  const [publishImageAdapterMeta, setPublishImageAdapterMeta] =
    useState<ImageMeta | null>(null);
  const [publishImageAdapterTransform, setPublishImageAdapterTransform] =
    useState<ImageTransform | null>(null);
  const [publishImageAdapterSaving, setPublishImageAdapterSaving] =
    useState(false);
  const [publishImageAdapterDragging, setPublishImageAdapterDragging] =
    useState(false);
  const publishImageAdapterStageRef = useRef<HTMLDivElement | null>(null);
  const [publishImageAdapterStageSize, setPublishImageAdapterStageSize] =
    useState({ width: 0, height: 0 });
  const publishImageAdapterDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const [publishVideoAdapterOpen, setPublishVideoAdapterOpen] = useState(false);
  const [publishVideoFormat, setPublishVideoFormat] =
    useState<VideoFormat>("original");
  const [publishVideoAdaptationMode, setPublishVideoAdaptationMode] =
    useState<VideoAdaptationMode>("safe_frame");
  const [publishVideoPreparationState, setPublishVideoPreparationState] =
    useState<BoosterVideoPreparationState | null>(null);
  const [publishVideoAdapterSaving, setPublishVideoAdapterSaving] =
    useState(false);
  const [publishEditOpen, setPublishEditOpen] = useState(false);
  const [publishTextDraft, setPublishTextDraft] = useState({
    channel: "" as ChannelKey | "",
    title: "",
    body: "",
    cta: "",
    ctaMode: "none" as BoosterCtaMode,
    ctaUrl: "",
    ctaPhone: "",
    hashtags: "",
  });
  const [publishCtaDefaults, setPublishCtaDefaults] =
    useState<BoosterCtaDefaults | null>(null);
  const [publishSaveState, setPublishSaveState] = useState<"idle" | "saving">(
    "idle",
  );

  const {
    publishBodyEditorRef,
    campaignBodyEditorRef,
    publishEmojiSelectionRef,
    campaignEmojiSelectionRef,
    saveRichEditorSelection,
    applyCampaignTextFormat,
    applyPublishTextFormat,
    insertPublishEmoji,
    insertCampaignEmoji,
  } = useAgentRichTextEditors({
    setCampaignTextDraft,
    setPublishTextDraft,
  });

  useEffect(() => {
    if (!publishImageAdapterOpen || !publishImageAdapterStageRef.current)
      return;
    const node = publishImageAdapterStageRef.current;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setPublishImageAdapterStageSize({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [publishImageAdapterOpen]);

  useEffect(() => {
    return () => {
      if (publishImageAdapterPreviewUrl) {
        URL.revokeObjectURL(publishImageAdapterPreviewUrl);
      }
    };
  }, [publishImageAdapterPreviewUrl]);

  useEffect(() => {
    let alive = true;

    async function loadPublishCtaDefaults() {
      try {
        const response = await fetch("/api/booster/cta-defaults", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => ({}));
        if (!alive) return;
        setPublishCtaDefaults({
          preferredWebsiteUrl: String(
            payload?.preferredWebsiteUrl || "",
          ).trim(),
          preferredWebsiteLabel: String(
            payload?.preferredWebsiteLabel || "",
          ).trim(),
          siteWebUrl: String(payload?.siteWebUrl || "").trim(),
          inrcySiteUrl: String(payload?.inrcySiteUrl || "").trim(),
          phone: String(payload?.phone || "").trim(),
          preferredCta: normalizeBoosterPreferredCta(payload?.preferredCta),
          aiLanguage: normalizeBoosterAiLanguage(payload?.aiLanguage),
        });
      } catch {
        // La modale reste utilisable sans valeurs par défaut.
      }
    }

    loadPublishCtaDefaults();
    const handleAiConfigurationUpdated = () => loadPublishCtaDefaults();
    window.addEventListener(
      "inrcy:ai-configuration-updated",
      handleAiConfigurationUpdated,
    );
    return () => {
      alive = false;
      window.removeEventListener(
        "inrcy:ai-configuration-updated",
        handleAiConfigurationUpdated,
      );
    };
  }, []);

  const pendingActionsByAutomation = useMemo(() => {
    return actions.reduce<Record<AutomationKey, number>>(
      (acc, action) => {
        if (action.automationKey && pendingActionStatuses.has(action.status)) {
          acc[action.automationKey] += 1;
        }
        return acc;
      },
      { publish: 0, grow: 0, loyalty: 0, stats: 0 },
    );
  }, [actions]);

  const {
    prepareActionState,
    prepareProgress,
    testNowKey,
    prepareNowConfirm,
    setPrepareNowConfirm,
    updateConfig,
    updateConfigFrequency,
    updateConfigScheduleSlot,
    updateConfigMonthDay,
    saveSettings,
    testAutomationNow,
    confirmPrepareNowReplacement,
  } = useAgentAutomationController({
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
  });

  const selectedPreparedActionFromActions = useMemo(() => {
    return (
      actions.find(
        (action) =>
          action.automationKey === selectedKey &&
          pendingActionStatuses.has(action.status),
      ) ?? null
    );
  }, [actions, selectedKey]);

  const selectedPreparedAction =
    scheduledEditSession?.action ?? selectedPreparedActionFromActions;
  const scheduledEditDirty = Boolean(scheduledEditSession?.dirty);

  const selected = useMemo(
    () =>
      visibleAutomations.find((automation) => automation.key === selectedKey) ??
      visibleAutomations[0],
    [selectedKey, visibleAutomations],
  );

  const settingsAutomation = useMemo(
    () =>
      visibleAutomations.find((automation) => automation.key === settingsKey) ?? null,
    [settingsKey, visibleAutomations],
  );
  const settingsAvailableThemes = useMemo(
    () =>
      settingsAutomation?.availableThemes.filter(
        (theme) =>
          !(standardMode && settingsAutomation.key === "stats" && theme === "Mails"),
      ) ?? [],
    [settingsAutomation, standardMode],
  );

  const selectedHeaderTool = useMemo(
    () => headerToolLinkForAutomation(selected.key),
    [selected.key],
  );

  const upcomingScheduleItems = useMemo<ScheduleListItem[]>(() => {
    const rows: ScheduleListItem[] = [];

    for (const automation of visibleAutomations) {
      const config = configs[automation.key];
      if (!config?.enabled) continue;
      const nextOccurrence = computeNextOccurrence(config);
      const dateParts = scheduleDateParts(
        nextOccurrence,
        agentWeekdayLabel(config.day, runtimeT) || "—",
        config.time || "—",
        locale,
      );
      const channels =
        automation.key === "stats"
          ? (["mails"] as ChannelKey[])
          : orderChannels(
              config.channels,
              connectedChannelsForAutomation(
                automation,
                agentConnectedChannels,
              ),
            );

      if (automation.key !== "stats" && channels.length === 0) continue;

      for (const channel of channels) {
        rows.push({
          id: `automatic-${automation.key}-${channel}`,
          action: agentAutomationTitle(automation.key, runtimeT),
          date: dateParts.date,
          time: dateParts.time,
          typeLabel: agentScheduleTypeLabel(scheduleTypeLabelFromAutomation(automation.key), runtimeT),
          channelLabel: agentScheduleChannelLabel(scheduleChannelLabelFromAutomation(automation.key, channel), runtimeT),
          channelLabels: [
            agentScheduleChannelLabel(scheduleChannelLabelFromAutomation(automation.key, channel), runtimeT),
          ],
          originLabel: i18nT("automatique_f8a3c37b"),
          status: i18nT("automatique_f8a3c37b"),
          statusKey: "scheduled",
          automationKey: automation.key,
          scheduledAtIso: nextOccurrence,
          editable: true,
          removable: true,
          source: "automatic",
        });
      }
    }

    for (const action of scheduledActions) {
      if (
        action.source !== "manual" ||
        !["scheduled", "running", "failed"].includes(action.status)
      )
        continue;
      const dateParts = scheduleDateParts(
        action.scheduledAt || action.createdAt,
        "—",
        "—",
        locale,
      );
      rows.push({
        id: `manual-${action.id}`,
        action: action.title || i18nT("action_programmee_ea2709b8"),
        date: dateParts.date,
        time: dateParts.time,
        typeLabel: agentScheduleTypeLabel(scheduledActionTypeLabel(action), runtimeT),
        channelLabel: agentScheduleChannelLabel(scheduledActionChannelLabel(action), runtimeT),
        channelLabels: scheduledActionChannelLabels(action).map((label) => agentScheduleChannelLabel(label, runtimeT)),
        originLabel: i18nT("programme_bab7d71e"),
        status: agentScheduledStatusLabel(action.status, runtimeT),
        statusKey: action.status,
        automationKey: action.automationKey,
        scheduledActionId: action.id,
        scheduledAtIso: action.scheduledAt || action.createdAt,
        editable: action.status !== "running",
        removable: true,
        source: "manual",
      });
    }

    return rows.sort((a, b) => {
      if (a.statusKey === "failed" && b.statusKey !== "failed") return -1;
      if (b.statusKey === "failed" && a.statusKey !== "failed") return 1;
      return (
        new Date(a.scheduledAtIso || 0).getTime() -
        new Date(b.scheduledAtIso || 0).getTime()
      );
    });
  }, [agentConnectedChannels, configs, i18nT, locale, scheduledActions, visibleAutomations]);

  const selectedConfig = configs[selected.key];
  const selectedAvailableChannels = useMemo(
    () => connectedChannelsForAutomation(selected, agentConnectedChannels),
    [agentConnectedChannels, selected],
  );
  const selectedRobotSteps = robotStepsByAutomation[selected.key];
  const settingsConfig = settingsKey ? configs[settingsKey] : null;
  const settingsMonthlyDateCount = settingsConfig
    ? inrAgentMonthlyDateCount(settingsConfig.frequency)
    : 0;
  const settingsMonthDays = settingsConfig
    ? normalizeInrAgentMonthDays(
        settingsConfig.monthDays,
        settingsConfig.frequency,
      )
    : [];
  const settingsAvailableChannels = useMemo(
    () =>
      settingsAutomation
        ? connectedChannelsForAutomation(
            settingsAutomation,
            agentConnectedChannels,
          )
        : [],
    [agentConnectedChannels, settingsAutomation],
  );
  const settingsNoConnectedChannelBlock = Boolean(
    settingsAutomation &&
    settingsAutomation.key !== "stats" &&
    settingsAutomation.availableChannels.length > 0 &&
    connectedChannelsLoadState === "ready" &&
    settingsAvailableChannels.length === 0,
  );
  const settingsConnectedChannelMessage = settingsNoConnectedChannelBlock
    ? settingsAutomation
      ? agentConnectedChannelMessage(settingsAutomation.key, runtimeT)
      : ""
    : "";
  const hasPreparedAction = Boolean(selectedPreparedAction);
  const preparedImage = selectedPreparedAction
    ? extractImageAsset(selectedPreparedAction)
    : null;
  const preparedImageUrl = imageAssetUrl(preparedImage);
  const selectedConfigChannels = useMemo(
    () => orderChannels(selectedConfig.channels, selectedAvailableChannels),
    [selectedAvailableChannels, selectedConfig.channels],
  );
  const isPublishView = selected.key === "publish";
  const preparedChannels = useMemo(
    () =>
      selectedPreparedAction
        ? orderChannels(
            channelsForAction(selectedPreparedAction, selectedConfigChannels),
            selectedAvailableChannels,
          )
        : [],
    [selectedAvailableChannels, selectedPreparedAction, selectedConfigChannels],
  );
  const preparedChannelsKey = preparedChannels.join("|");
  const selectablePreviewChannels = hasPreparedAction
    ? preparedChannels
    : selectedConfigChannels;
  const displayChannels = isPublishView
    ? loadState === "loading"
      ? []
      : selectedAvailableChannels
    : hasPreparedAction
      ? preparedChannels
      : loadState === "loading"
        ? []
        : selectedConfigChannels;
  const previewNavigationChannels = isPublishView
    ? selectablePreviewChannels
    : displayChannels.length > 0
      ? displayChannels
      : selectedConfigChannels;
  const selectedStatsRubriques =
    selected.key === "stats" && loadState !== "loading"
      ? selectedConfig.themes.filter(
          (theme) =>
            Boolean(statsRubriqueOptions[theme]) &&
            !(standardMode && theme === "Mails"),
        )
      : [];
  const placeholderPreviewChannels = !selectedPreparedAction
    ? previewNavigationChannels
    : [];
  const selectedAutomationChannel = selectedChannelByAutomation[selected.key];
  const activePreviewChannel = selectedPreparedAction
    ? preparedChannels.includes(
        selectedChannelByAction[selectedPreparedAction.id] as ChannelKey,
      )
      ? selectedChannelByAction[selectedPreparedAction.id]
      : (preparedChannels[0] ?? null)
    : placeholderPreviewChannels.includes(
          selectedAutomationChannel as ChannelKey,
        )
      ? (selectedAutomationChannel as ChannelKey)
      : (placeholderPreviewChannels[0] ?? null);
  const activePreviewChannelLabel = activePreviewChannel
    ? agentChannelLabel(activePreviewChannel, runtimeT)
    : i18nT("preview_label");
  const preparedChannelPreview = selectedPreparedAction
    ? extractChannelPreview(selectedPreparedAction, activePreviewChannel)
    : null;
  const preparedParagraphs = previewParagraphs(
    preparedChannelPreview?.body || selectedPreparedAction?.summary || "",
  );
  const publishMediaPreview = isPublishView
    ? extractPublishMediaPreview(
        selectedPreparedAction,
        activePreviewChannel,
        publishMediaActiveIndex,
      )
    : null;
  const publishImageCount =
    publishMediaPreview?.kind === "image" ? publishMediaPreview.count : 0;
  const publishImageLimitReached =
    publishImageCount >= INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT;
  const publishMediaAdaptationPreview = isPublishView
    ? extractPublishMediaAdaptationPreview(
        selectedPreparedAction,
        activePreviewChannel,
      )
    : null;
  const publishMediaRetouchLabel = i18nT(
    publishMediaPreview?.kind === "video"
      ? "adapt_video"
      : publishMediaPreview?.kind === "image"
        ? "adapt_image"
        : "adapt_media",
  );
  const publishMediaRetouchIcon =
    publishMediaPreview?.kind === "video"
      ? "🎞️"
      : publishMediaPreview?.kind === "image"
        ? "🪄"
        : "✨";
  const publishBoosterChannel =
    boosterChannelKeyFromAgentChannel(activePreviewChannel);
  const publishImageAdapterPreset = CHANNEL_PRESETS[publishBoosterChannel];
  const publishImageAdapterTransformSafe =
    publishImageAdapterTransform || getDefaultTransform(publishBoosterChannel);
  const publishImageAdapterEffectiveZoom = getEffectiveTransformZoom(
    publishImageAdapterTransformSafe,
  );
  const publishImageAdapterBackgroundMode = getBackgroundMode(
    publishImageAdapterTransformSafe,
  );
  const publishImageAdapterBackgroundColor = getBackgroundFill(
    publishImageAdapterTransformSafe.backgroundMode ||
      publishImageAdapterBackgroundMode,
    publishImageAdapterTransformSafe.backgroundColor,
  );
  const publishImageAdapterAspectRatio = `${publishImageAdapterPreset.width} / ${publishImageAdapterPreset.height}`;
  const publishImageAdapterPreviewLayout = computePreviewLayout({
    containerWidth:
      publishImageAdapterStageSize.width || publishImageAdapterPreset.width,
    containerHeight:
      publishImageAdapterStageSize.height || publishImageAdapterPreset.height,
    imageWidth: publishImageAdapterMeta?.width || 0,
    imageHeight: publishImageAdapterMeta?.height || 0,
    transform: publishImageAdapterTransformSafe,
  });
  const currentPublishMediaRecord = getPublishMediaRecord(
    selectedPreparedAction,
    activePreviewChannel,
    publishMediaActiveIndex,
  );


  const publishParagraphs = isPublishView
    ? publishPostParagraphs(
        preparedChannelPreview?.body || selectedPreparedAction?.summary || "",
      )
    : [];
  const publishHasText = Boolean(
    isPublishView &&
    (preparedChannelPreview?.title ||
      preparedChannelPreview?.body ||
      preparedChannelPreview?.cta ||
      preparedChannelPreview?.hashtags.length ||
      selectedPreparedAction?.summary),
  );
  const publishContentKind = isPublishView
    ? agentContentKindLabel(publishMediaPreview?.kind || "none", publishHasText, runtimeT)
    : "—";
  const publishStatus = isPublishView
    ? publishStatusLabel({
        action: selectedPreparedAction,
        media: publishMediaPreview,
        hasText: publishHasText,
      })
    : { label: "—", tone: "neutral" as const };
  const publishStatusClass =
    publishStatus.tone === "blocked"
      ? styles.publishStatusBlocked
      : publishStatus.tone === "warning"
        ? styles.publishStatusWarning
        : publishStatus.tone === "ready"
          ? styles.publishStatusReady
          : styles.publishStatusNeutral;
  const agentPublishScheduleItems = useMemo<PublishScheduleItem[]>(() => {
    if (!selectedPreparedAction || !isPublishView) return [];
    const seen = new Set<BoosterChannelKey>();
    return preparedChannels
      .map((channel) => {
        const boosterChannel = boosterChannelKeyFromAgentChannel(channel);
        if (seen.has(boosterChannel)) return null;
        seen.add(boosterChannel);
        const preview = extractChannelPreview(selectedPreparedAction, channel);
        const media = extractPublishMediaPreview(
          selectedPreparedAction,
          channel,
        );
        const hasText = Boolean(
          preview?.title ||
          preview?.body ||
          preview?.cta ||
          preview?.hashtags.length ||
          selectedPreparedAction.summary,
        );
        const blockers: string[] = [];
        if (media.statusTone === "blocked" && media.statusLabel) {
          blockers.push(agentMediaStatusLabel(media.statusLabel, runtimeT));
        }
        if (!hasText && media.kind === "none") {
          blockers.push(i18nT("publish_requires_content"));
        }
        if (channel === "youtube" && media.kind !== "video") {
          blockers.push(i18nT("youtube_requires_video"));
        }
        if (
          channel === "instagram" &&
          media.kind !== "image" &&
          media.kind !== "video"
        ) {
          blockers.push(i18nT("instagram_requires_media"));
        }
        if (
          channel === "tiktok" &&
          media.kind !== "image" &&
          media.kind !== "video"
        ) {
          blockers.push(i18nT("tiktok_requires_media"));
        }
        return {
          channel: boosterChannel,
          label: agentChannelLabel(channel, runtimeT),
          mediaLabel: agentContentKindLabel(media.kind, hasText, runtimeT),
          blockers: Array.from(new Set(blockers)),
        } satisfies PublishScheduleItem;
      })
      .filter((item): item is PublishScheduleItem => Boolean(item));
  }, [i18nT, isPublishView, preparedChannels, selectedPreparedAction]);
  const publishCtaLine = isPublishView
    ? extractPublishCtaLine(
        selectedPreparedAction,
        activePreviewChannel,
        preparedChannelPreview,
      )
    : "—";
  const preparedRecipientsCount = recipientsCountForAction(
    selectedPreparedAction,
  );
  const isCampaignView = isCampaignAutomationKey(selected.key);
  const campaignMailPreview = isCampaignView
    ? extractCampaignMailPreview(selectedPreparedAction)
    : null;
  const hasCampaignPreview = Boolean(
    isCampaignView && selectedPreparedAction && campaignMailPreview,
  );
  const campaignPlaceholderPreview: CampaignMailPreview | null = isCampaignView
    ? {
        subject: "—",
        body: "—",
        paragraphs: ["—"],
        mission: "—",
        recipientsCount: 0,
        mailAccountLabel: "—",
        mailAccountProvider: "Mails",
        attachment: null,
      }
    : null;
  const campaignDisplayPreview =
    campaignMailPreview ?? campaignPlaceholderPreview;
  const campaignRecipients = recipientsForAction(selectedPreparedAction);
  const campaignAttachments = normalizeCampaignAttachmentRefs(
    selectedPreparedAction?.payload?.attachments ||
      asRecord(selectedPreparedAction?.payload?.campaign)?.attachments,
  );
  const filteredCrmContacts = useMemo(() => {
    const q = crmRecipientSearch.trim().toLowerCase();
    const department = sanitizeDepartmentFilter(crmRecipientDepartment);
    return crmContacts.filter((contact) => {
      if (!firstSafeString(contact.email)) return false;
      if (crmRecipientImportantOnly && !contact.important) return false;
      if (
        crmRecipientCategory !== "all" &&
        firstSafeString(contact.category).toLowerCase() !== crmRecipientCategory
      )
        return false;
      if (
        crmRecipientType !== "all" &&
        firstSafeString(contact.contact_type).toLowerCase() !== crmRecipientType
      )
        return false;
      if (
        department &&
        !contactDepartment(contact.postal_code).startsWith(department)
      )
        return false;
      if (!q) return true;
      return [
        contactDisplayName(contact),
        contact.email,
        contact.phone,
        contact.company_name,
        contact.city,
        contact.postal_code,
        contact.contact_type,
        contact.category,
      ]
        .map((value) => firstSafeString(value).toLowerCase())
        .some((value) => value.includes(q));
    });
  }, [
    crmContacts,
    crmRecipientCategory,
    crmRecipientDepartment,
    crmRecipientImportantOnly,
    crmRecipientSearch,
    crmRecipientType,
  ]);
  const crmRecipientsByEmail = useMemo(() => {
    return new Map(
      crmContacts
        .map((contact) => contactToCampaignRecipient(contact))
        .filter((recipient): recipient is CampaignRecipientPreview =>
          Boolean(recipient),
        )
        .map((recipient) => [recipient.email.toLowerCase(), recipient]),
    );
  }, [crmContacts]);
  const manualSelectedRecipientEmails = useMemo(() => {
    return selectedRecipientEmails.filter(
      (email) => !crmRecipientsByEmail.has(email.toLowerCase()),
    );
  }, [crmRecipientsByEmail, selectedRecipientEmails]);
  const filteredCrmRecipientEmails = useMemo(() => {
    return filteredCrmContacts
      .map((contact) =>
        contactToCampaignRecipient(contact)?.email.toLowerCase(),
      )
      .filter((email): email is string => Boolean(email));
  }, [filteredCrmContacts]);
  const filteredCrmSelectedCount = useMemo(() => {
    const selected = new Set(
      selectedRecipientEmails.map((email) => email.toLowerCase()),
    );
    return filteredCrmRecipientEmails.filter((email) => selected.has(email))
      .length;
  }, [filteredCrmRecipientEmails, selectedRecipientEmails]);
  const filteredCrmAllSelected =
    filteredCrmRecipientEmails.length > 0 &&
    filteredCrmSelectedCount === filteredCrmRecipientEmails.length;
  const activeCrmRecipientFiltersCount =
    (crmRecipientCategory !== "all" ? 1 : 0) +
    (crmRecipientType !== "all" ? 1 : 0) +
    (crmRecipientDepartment.trim() ? 1 : 0) +
    (crmRecipientImportantOnly ? 1 : 0);
  const selectedAutomationSettings = agentSettings.automations[selected.key];
  const statsReports = useMemo(
    () => statsReportsFromActions(actions, { automaticOnly: true, limit: 5 }),
    [actions],
  );
  const latestStatsReport = useMemo(
    () => statsReportsFromActions(actions, { limit: 1 })[0] ?? null,
    [actions],
  );
  const latestAutomaticStatsReport = statsReports[0] ?? null;
  const latestStatsRecommendations =
    latestAutomaticStatsReport?.recommendations ?? [];
  const statsLastReportLabel = latestStatsReport
    ? formatDateTimeLabel(
        latestStatsReport.document.createdAt ||
          latestStatsReport.completedAt ||
          latestStatsReport.createdAt,
        "—",
        locale,
      )
    : i18nT("aucun_b2ed82f1");
  const statsNextRunLabel = formatDateTimeLabel(
    selectedAutomationSettings?.nextRunAt ||
      (selected.key === "stats" ? computeNextOccurrence(selectedConfig) : null),
    i18nT("schedule_inactive"),
    locale,
  );
  const statsAutomationLabel = selectedConfig.enabled
    ? i18nT("automation_enabled")
    : i18nT("automation_disabled");
  const statsFrequencyLabel = agentFrequencyLabel(selectedConfig.frequency || "Chaque semaine", runtimeT);
  const statsStoredCountLabel = `${statsReports.length}/5`;
  const footerDateLabel =
    selected.key === "stats"
      ? statsNextRunLabel
      : hasPreparedAction && selectedPreparedAction
        ? formatActionDate(selectedPreparedAction.scheduledFor, selectedConfig, locale)
        : "—";

  useEffect(() => {
    if (!selectedPreparedAction || preparedChannels.length === 0) return;

    setSelectedChannelByAction((current) => {
      const currentChannel = current[selectedPreparedAction.id];
      if (currentChannel && preparedChannels.includes(currentChannel)) {
        return current;
      }
      return { ...current, [selectedPreparedAction.id]: preparedChannels[0] };
    });
  }, [selectedPreparedAction, preparedChannels, preparedChannelsKey]);

  function selectPreviewChannel(channelKey: ChannelKey) {
    setPublishMediaActiveIndex(0);
    if (selectedPreparedAction) {
      setSelectedChannelByAction((current) => ({
        ...current,
        [selectedPreparedAction.id]: channelKey,
      }));
      return;
    }

    setSelectedChannelByAutomation((current) => ({
      ...current,
      [selected.key]: channelKey,
    }));
  }

  function movePreviewChannel(direction: -1 | 1) {
    const channels = previewNavigationChannels;
    if (channels.length < 2) return;

    const currentIndex = activePreviewChannel
      ? channels.indexOf(activePreviewChannel)
      : -1;
    const fallbackIndex = direction > 0 ? 0 : channels.length - 1;
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + direction + channels.length) % channels.length
        : fallbackIndex;

    const nextChannel = channels[nextIndex];
    if (nextChannel) selectPreviewChannel(nextChannel);
  }

  function openMailTextEditor() {
    const preview = extractCampaignMailPreview(selectedPreparedAction);
    if (!preview) return;
    setCampaignTextDraft({ subject: preview.subject, body: preview.body });
    setCampaignEditOpen(false);
    setMailTextEditOpen(true);
  }

  async function saveCampaignText() {
    if (!selectedPreparedAction || campaignSaveState === "saving") return;
    const subject = campaignTextDraft.subject.trim();
    const body = campaignTextDraft.body.trim();
    if (!subject || !body) {
      showNotice(i18nT("l_objet_et_le_corps_du_99f7bad3"));
      return;
    }

    setCampaignSaveState("saving");
    setNotice(null);

    try {
      await patchCampaignAction(
        {
          editType: "campaign_text",
          subject,
          bodyText: body,
        },
        i18nT("modification_du_mail_impossible_79c8df8a"),
      );
      setMailTextEditOpen(false);
      showNotice(
        scheduledEditSession
          ? i18nT("texte_modifie_temporairement_valider_l_enregistr_97bc9fa5")
          : i18nT("texte_de_la_campagne_mis_a_2147ff62"),
      );
    } catch (error) {
      showNotice(i18nT("modification_du_mail_impossible_79c8df8a"));
    } finally {
      setCampaignSaveState("idle");
    }
  }

  function openPublishTextEditor() {
    if (
      !selectedPreparedAction ||
      !isPublishPreparedAction(selectedPreparedAction) ||
      !activePreviewChannel
    ) {
      showNotice(i18nT("prepare_d_abord_une_publication_f42a456a"));
      return;
    }
    const preview = extractChannelPreview(
      selectedPreparedAction,
      activePreviewChannel,
    );
    const displayKey = boosterDisplayKeyFromAgentChannel(activePreviewChannel);
    const fallbackChoice = normalizeBoosterPreferredCta(
      publishCtaDefaults?.preferredCta,
    );
    const inferredChoice =
      preview.ctaMode === "none" && preview.cta
        ? inferPreferredCtaChoiceFromLabel(preview.cta, fallbackChoice)
        : fallbackChoice;
    const shouldPrefillCta =
      !preview.cta &&
      !preview.ctaUrl &&
      !preview.ctaPhone &&
      publishCtaDefaults;
    const basePost: BoosterChannelPost = {
      title: preview.title || "",
      content: preview.body || "",
      cta: preview.cta || "",
      ctaMode: preview.ctaMode,
      ctaUrl: preview.ctaUrl || "",
      ctaPhone: preview.ctaPhone || "",
      hashtags: preview.hashtags,
    };
    const ctaPatch = shouldPrefillCta
      ? buildPreferredCtaPatch(
          displayKey,
          fallbackChoice,
          basePost,
          publishCtaDefaults,
          publishCtaDefaults?.aiLanguage,
        )
      : preview.ctaMode === "none" && preview.cta
        ? buildPreferredCtaPatch(
            displayKey,
            inferredChoice,
            basePost,
            publishCtaDefaults,
            publishCtaDefaults?.aiLanguage,
          )
        : {};
    const hydratedPost = { ...basePost, ...ctaPatch };
    setPublishTextDraft({
      channel: activePreviewChannel,
      title: preview.title || "",
      body: preview.body || "",
      cta: String(hydratedPost.cta || ""),
      ctaMode: normalizeAgentCtaMode(hydratedPost.ctaMode),
      ctaUrl: String(hydratedPost.ctaUrl || ""),
      ctaPhone: String(hydratedPost.ctaPhone || ""),
      hashtags: preview.hashtags.join(" "),
    });
    setPublishEditChoiceOpen(false);
    setPublishEditOpen(true);
  }

  function validateAgentPublishMediaFile(file: File) {
    const detectedType = detectUniversalUploadMediaType({
      name: file.name,
      mimeType: file.type,
    });
    const isImage = detectedType === "image" && isInrMediaImageFile(file);
    const isVideo = detectedType === "video";
    if (!isImage && !isVideo) {
      throw new Error(i18nT("invalid_media"));
    }
    if (activePreviewChannel === "youtube" && !isVideo) {
      throw new Error(i18nT("youtube_requires_video"));
    }
    return isVideo ? "video" : "image";
  }

  function openMediaOptimizerForFiles(
    files: File[],
    destination: AgentMediaOptimizerRequest["destination"],
  ) {
    const requests = files
      .filter((file) => {
        const mediaType = detectUniversalUploadMediaType({
          name: file.name,
          mimeType: file.type,
        });
        return mediaType === "image" || mediaType === "video";
      })
      .map<AgentMediaOptimizerRequest>((file) => ({
        source: { kind: "file", file },
        destination,
      }));
    const [first, ...rest] = requests;
    if (!first) return false;
    setMediaOptimizerRequest(first);
    setMediaOptimizerQueue(rest);
    setMediaOptimizerCompleted(false);
    return true;
  }

  function openMediaOptimizerForLibraryItem(
    item: MediaLibraryPickerItem,
    destination: AgentMediaOptimizerRequest["destination"],
  ) {
    setMediaOptimizerRequest({
      source: { kind: "library", item: item as MediaOptimizerItem },
      destination,
    });
    setMediaOptimizerQueue([]);
    setMediaOptimizerCompleted(false);
  }

  function closeMediaOptimizer() {
    if (mediaOptimizerCompleted && mediaOptimizerQueue.length > 0) {
      const [next, ...rest] = mediaOptimizerQueue;
      setMediaOptimizerRequest(next);
      setMediaOptimizerQueue(rest);
      setMediaOptimizerCompleted(false);
      return;
    }
    setMediaOptimizerRequest(null);
    setMediaOptimizerQueue([]);
    setMediaOptimizerCompleted(false);
  }

  async function selectPublishMediaFromLibrary(
    item: AgentMediaLibraryItem | MediaLibraryPickerItem,
  ) {
    if (!item) return false;
    if (activePreviewChannel === "youtube" && item.media_type !== "video") {
      showNotice(i18nT("youtube_requires_video"));
      return false;
    }
    if (item.media_type === "image" && publishImageLimitReached) {
      showNotice(
        i18nT("max_images_channel", { count: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT }),
      );
      return false;
    }
    setPublishMediaUploadState("saving");
    try {
      const mutation: PublishMediaMutation =
        item.media_type === "image" ? "append" : "replace";
      await savePublishMediaPatch(mediaPatchFromLibraryItem(item), mutation);
      if (item.media_type === "image") {
        setPublishMediaActiveIndex(
          Math.min(
            publishImageCount,
            INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT - 1,
          ),
        );
        showNotice(i18nT("publish_image_added"));
      } else {
        setPublishMediaActiveIndex(0);
        showNotice(i18nT("publish_video_updated"));
      }
      return true;
    } catch (error) {
      showNotice(i18nT("publish_media_update_failed"));
      return false;
    } finally {
      setPublishMediaUploadState("idle");
    }
  }

  function openPublishMediaEditor() {
    if (
      !selectedPreparedAction ||
      !isPublishPreparedAction(selectedPreparedAction) ||
      !activePreviewChannel
    ) {
      showNotice(i18nT("prepare_d_abord_une_publication_f42a456a"));
      return;
    }
    setPublishEditChoiceOpen(false);
    setPublishMediaActiveIndex(0);
    setPublishMediaPreviewOpen(true);
  }

  function updatePublishImageAdapterTransform(patch: Partial<ImageTransform>) {
    setPublishImageAdapterTransform((current) => ({
      ...(current || getDefaultTransform(publishBoosterChannel)),
      ...patch,
    }));
  }

  function closePublishImageAdapter() {
    setPublishImageAdapterOpen(false);
    setPublishImageAdapterFile(null);
    setPublishImageAdapterMeta(null);
    setPublishImageAdapterTransform(null);
    setPublishImageAdapterStageSize({ width: 0, height: 0 });
    setPublishImageAdapterDragging(false);
    publishImageAdapterDragRef.current = null;
    if (publishImageAdapterPreviewUrl) {
      URL.revokeObjectURL(publishImageAdapterPreviewUrl);
      setPublishImageAdapterPreviewUrl("");
    }
  }

  async function openPublishImageAdapterTool() {
    if (!publishMediaPreview?.url) {
      showNotice(i18nT("add_image_first"));
      return;
    }
    try {
      setPublishImageAdapterSaving(true);
      const fileName =
        publishMediaPreview.name?.replace(/\.[^.]+$/, "") || "image-inragent";
      const sourceFile = await urlToFile(
        publishMediaPreview.url,
        `${fileName}.jpg`,
        "image/jpeg",
      );
      const meta = await readImageMeta(sourceFile);
      const transform = getOptimizedTransform(publishBoosterChannel, meta);
      const previewUrl = URL.createObjectURL(sourceFile);
      if (publishImageAdapterPreviewUrl) {
        URL.revokeObjectURL(publishImageAdapterPreviewUrl);
      }
      setPublishImageAdapterFile(sourceFile);
      setPublishImageAdapterMeta(meta);
      setPublishImageAdapterTransform(transform);
      setPublishImageAdapterPreviewUrl(previewUrl);
      setPublishImageAdapterOpen(true);
    } catch (error) {
      showNotice(i18nT("image_adaptation_failed"));
    } finally {
      setPublishImageAdapterSaving(false);
    }
  }

  function getCurrentVideoSettings() {
    const rawSettings = getMediaVideoSettingsRecord(
      currentPublishMediaRecord,
      publishBoosterChannel,
    );
    return {
      format: normalizeVideoFormat(
        publishBoosterChannel,
        rawSettings?.format || currentPublishMediaRecord?.videoFormat,
      ),
      adaptationMode: normalizeVideoAdaptationMode(
        rawSettings?.adaptationMode ||
          currentPublishMediaRecord?.videoAdaptationMode,
      ),
    };
  }

  function openPublishVideoAdapterTool() {
    if (!publishMediaPreview?.url) {
      showNotice(i18nT("add_video_first"));
      return;
    }
    const settings = getCurrentVideoSettings();
    setPublishVideoFormat(settings.format);
    setPublishVideoAdaptationMode(settings.adaptationMode);
    setPublishVideoPreparationState(null);
    setPublishVideoAdapterOpen(true);
  }

  function openPublishMediaAdapterPreview() {
    if (!publishMediaPreview?.url) {
      showNotice(i18nT("add_media_first"));
      return;
    }
    if (publishMediaPreview.kind === "video") {
      openPublishVideoAdapterTool();
      return;
    }
    if (publishMediaPreview.kind === "image") {
      void openPublishImageAdapterTool();
      return;
    }
    showNotice(i18nT("media_not_adaptable"));
  }

  function handlePublishImageAdapterWheel(
    event: ReactWheelEvent<HTMLDivElement>,
  ) {
    if (event.cancelable) event.preventDefault();
    const meta = publishImageAdapterMeta;
    const node = publishImageAdapterStageRef.current;
    if (!meta?.width || !meta?.height || !node) return;
    const rect = node.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const maxZoom = publishImageAdapterTransformSafe.fit === "cover" ? 3 : 1;
    const currentZoom = getEffectiveTransformZoom(
      publishImageAdapterTransformSafe,
    );
    const nextZoom = clampNumber(
      currentZoom + (event.deltaY < 0 ? 0.08 : -0.08),
      0.4,
      maxZoom,
    );
    const nextLayout = computePreviewLayout({
      containerWidth: rect.width,
      containerHeight: rect.height,
      imageWidth: meta.width,
      imageHeight: meta.height,
      transform: { ...publishImageAdapterTransformSafe, zoom: nextZoom },
    });
    const currentDrawW =
      publishImageAdapterPreviewLayout.drawW || nextLayout.drawW;
    const currentDrawH =
      publishImageAdapterPreviewLayout.drawH || nextLayout.drawH;
    const ux = currentDrawW
      ? (pointerX - publishImageAdapterPreviewLayout.dx) / currentDrawW
      : 0.5;
    const uy = currentDrawH
      ? (pointerY - publishImageAdapterPreviewLayout.dy) / currentDrawH
      : 0.5;
    const nextDx = pointerX - ux * nextLayout.drawW;
    const nextDy = pointerY - uy * nextLayout.drawH;
    updatePublishImageAdapterTransform({
      zoom: nextZoom,
      ...offsetFromDrawPosition({
        containerWidth: rect.width,
        containerHeight: rect.height,
        drawW: nextLayout.drawW,
        drawH: nextLayout.drawH,
        dx: nextDx,
        dy: nextDy,
      }),
    });
  }

  function handlePublishImageAdapterPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    publishImageAdapterDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: publishImageAdapterTransformSafe.offsetX || 0,
      startOffsetY: publishImageAdapterTransformSafe.offsetY || 0,
    };
    setPublishImageAdapterDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePublishImageAdapterPointerMove(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    const drag = publishImageAdapterDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextOffsetX = publishImageAdapterPreviewLayout.maxX
      ? clampNumber(
          drag.startOffsetX -
            ((event.clientX - drag.startX) /
              publishImageAdapterPreviewLayout.maxX) *
              100,
          -100,
          100,
        )
      : 0;
    const nextOffsetY = publishImageAdapterPreviewLayout.maxY
      ? clampNumber(
          drag.startOffsetY -
            ((event.clientY - drag.startY) /
              publishImageAdapterPreviewLayout.maxY) *
              100,
          -100,
          100,
        )
      : 0;
    updatePublishImageAdapterTransform({
      offsetX: nextOffsetX,
      offsetY: nextOffsetY,
    });
  }

  function endPublishImageAdapterDrag(
    event?: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (
      event &&
      publishImageAdapterDragRef.current?.pointerId === event.pointerId
    ) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    publishImageAdapterDragRef.current = null;
    setPublishImageAdapterDragging(false);
  }

  async function savePublishImageAdapter() {
    if (!publishImageAdapterFile || !publishImageAdapterTransform) return;
    setPublishImageAdapterSaving(true);
    try {
      const rendered = await renderChannelImage({
        file: publishImageAdapterFile,
        transform: publishImageAdapterTransform,
        preset: publishImageAdapterPreset,
        channel: publishBoosterChannel,
      });
      const safeName =
        rendered.name ||
        `${publishMediaPreview?.name?.replace(/\.[^.]+$/, "") || "image-inragent"}-adaptee.jpg`;
      if (!rendered.dataUrl) {
        throw new Error(i18nT("image_adaptation_failed"));
      }
      const renderedFile = dataUrlToFile(rendered.dataUrl, safeName);
      await uploadPublishMedia(renderedFile, "replace");
      closePublishImageAdapter();
      showNotice(i18nT("image_adapted_saved"));
    } catch (error) {
      showNotice(i18nT("image_adapted_save_failed"));
    } finally {
      setPublishImageAdapterSaving(false);
    }
  }

  async function savePublishVideoAdapter() {
    if (!publishMediaPreview?.url || !currentPublishMediaRecord) return;
    setPublishVideoAdapterSaving(true);
    setPublishVideoPreparationState({
      status: "preparing",
      label: i18nT("preparation_video_en_cours_4903333d"),
    });
    try {
      const nextSettings = {
        format: publishVideoFormat,
        adaptationMode: publishVideoAdaptationMode,
      };
      const existingVariants = Array.isArray(
        currentPublishMediaRecord.transformedVariants,
      )
        ? (currentPublishMediaRecord.transformedVariants as BoosterVideoTransformedVariant[])
        : [];
      const response = await requestBoosterVideoTransforms({
        source: {
          storagePath: String(
            currentPublishMediaRecord.storagePath ||
              currentPublishMediaRecord.storage_path ||
              currentPublishMediaRecord.path ||
              "",
          ),
          publicUrl: publishMediaPreview.url,
          url: publishMediaPreview.url,
          name: publishMediaPreview.name,
          type: String(
            currentPublishMediaRecord.mimeType ||
              currentPublishMediaRecord.mime_type ||
              currentPublishMediaRecord.type ||
              "video/mp4",
          ),
          size: Number(currentPublishMediaRecord.size || 0) || null,
          duration:
            Number(
              currentPublishMediaRecord.duration ||
                currentPublishMediaRecord.duration_seconds ||
                0,
            ) || null,
        },
        variants: [
          {
            channel: publishBoosterChannel,
            format: publishVideoFormat,
            adaptationMode: publishVideoAdaptationMode,
          },
        ],
      });

      const generatedVariants = Array.isArray(response.variants)
        ? response.variants
        : [];
      const transformedVariants = [
        ...existingVariants.filter(
          (variant) =>
            !generatedVariants.some(
              (generated) => generated.signature === variant.signature,
            ),
        ),
        ...generatedVariants,
      ];
      const videoSettingsByChannel = {
        ...(asRecord(currentPublishMediaRecord.videoSettingsByChannel) || {}),
        [publishBoosterChannel]: nextSettings,
      };

      await savePublishMediaPatch(
        {
          ...currentPublishMediaRecord,
          videoSettings: nextSettings,
          videoSettingsByChannel,
          videoFormat: publishVideoFormat,
          videoAdaptationMode: publishVideoAdaptationMode,
          transformedVariants,
        },
        "replace",
      );

      setPublishVideoPreparationState({
        status: generatedVariants.length ? "ready" : "ready",
        label: generatedVariants.length
          ? i18nT("video_format_applied")
          : i18nT("video_original_kept"),
        detail: `${getLocalizedVideoFormatLabel(
          publishBoosterChannel,
          publishVideoFormat,
          (asRecord(currentPublishMediaRecord?.sourceMetadata) ||
            null) as BoosterVideoSourceMetadata | null,
          boosterRuntimeT,
        )} · ${getLocalizedVideoAdaptationModeLabel(
          publishVideoAdaptationMode,
          boosterRuntimeT,
        )}`,
      });
      if (response.errors?.length && !generatedVariants.length) {
        showNotice(i18nT("video_auto_adaptation_unavailable"));
      } else {
        showNotice(i18nT("video_setting_saved"));
      }
    } catch {
      setPublishVideoPreparationState({
        status: "error",
        label: i18nT("adaptation_video_impossible_79ebe884"),
        detail: i18nT("video_adaptation_retry"),
      });
      showNotice(i18nT("video_adaptation_failed"));
    } finally {
      setPublishVideoAdapterSaving(false);
    }
  }

  async function savePublishMediaPatch(
    media: Record<string, unknown> | null,
    mutation: PublishMediaMutation = media ? "replace" : "remove",
  ) {
    if (!selectedPreparedAction || !activePreviewChannel) return;

    if (scheduledEditSession) {
      updateScheduledEditAction((action) =>
        updateScheduledEditPublishMedia(
          action,
          activePreviewChannel,
          media,
          publishMediaActiveIndex,
          mutation,
        ),
      );
      return;
    }

    const response = await fetch("/api/agent/actions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: selectedPreparedAction.id,
        editType: "publish_channel_media",
        channel: activePreviewChannel,
        media,
        removeMedia: media === null,
        mediaOperation: mutation,
        mediaIndex: publishMediaActiveIndex,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      action?: AgentPreparedAction;
      error?: string;
    } | null;

    if (!response.ok || !payload?.action) {
      throw new Error(payload?.error || i18nT("publish_media_update_failed"));
    }

    const updatedAction = payload.action;
    setActions((current) =>
      current.map((action) =>
        action.id === updatedAction.id ? updatedAction : action,
      ),
    );
  }

  async function uploadPublishMedia(
    file: File | null | undefined,
    mutation: Extract<PublishMediaMutation, "append" | "replace"> = "append",
  ) {
    if (
      !file ||
      !selectedPreparedAction ||
      !activePreviewChannel ||
      publishMediaUploadState === "saving"
    )
      return;

    let mediaKind: "image" | "video";
    try {
      mediaKind = validateAgentPublishMediaFile(file);
    } catch (error) {
      showNotice(i18nT("invalid_media"));
      return;
    }

    const optimizationRequirements = getMediaLibraryOptimizationRequirements({
      mediaType: mediaKind,
      sizeBytes: file.size,
      targetBytes:
        mediaKind === "image"
          ? AGENT_MEDIA_MAX_IMAGE_BYTES
          : AGENT_MEDIA_MAX_VIDEO_BYTES,
      name: file.name,
      mimeType: file.type,
    });
    if (optimizationRequirements.needsOptimization) {
      openMediaOptimizerForFiles([file], "publish");
      return;
    }

    if (
      mediaKind === "image" &&
      mutation === "append" &&
      publishImageLimitReached
    ) {
      showNotice(
        i18nT("max_images_channel", { count: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT }),
      );
      return;
    }

    setPublishMediaUploadState("saving");
    setNotice(null);

    try {
      const clientId = `agent-${Date.now()}-${file.name}-${file.size}`;
      const prepareResponse = await fetch("/api/media-library/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "prepare",
          files: [
            {
              client_id: clientId,
              name: file.name,
              type: file.type,
              size: file.size,
              last_modified: file.lastModified,
            },
          ],
        }),
      });
      const preparePayload = await readAgentApiJson(
        prepareResponse,
        i18nT("publish_media_update_failed"),
      );
      if (!prepareResponse.ok)
        throw new Error(
          preparePayload?.error || i18nT("publish_media_update_failed"),
        );
      const prepared = Array.isArray(preparePayload?.items)
        ? preparePayload.items[0]
        : null;
      if (!prepared?.token || !prepared?.storage_path)
        throw new Error(i18nT("publish_media_update_failed"));

      const mediaInfo = await readAgentMediaFileInfo(file, mediaKind);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket || "inrcy-pro-media")
        .uploadToSignedUrl(prepared.storage_path, prepared.token, file, {
          contentType:
            prepared.content_type || file.type || "application/octet-stream",
        });
      if (uploadError) throw uploadError;

      const finalizeResponse = await fetch("/api/media-library/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "finalize",
          source: "inr_agent",
          uploads: [
            {
              client_id: clientId,
              original_name: prepared.original_name || file.name,
              storage_path: prepared.storage_path,
              mime_type:
                prepared.content_type ||
                file.type ||
                "application/octet-stream",
              size_bytes: file.size,
              width: mediaInfo.width,
              height: mediaInfo.height,
              duration_seconds: mediaInfo.duration_seconds,
            },
          ],
        }),
      });
      const finalizePayload = await readAgentApiJson(
        finalizeResponse,
        i18nT("publish_media_update_failed"),
      );
      if (!finalizeResponse.ok || !finalizePayload?.ok) {
        throw new Error(
          finalizePayload?.error || i18nT("publish_media_update_failed"),
        );
      }
      const result = Array.isArray(finalizePayload?.results)
        ? finalizePayload.results.find((item: any) => item?.ok)
        : null;
      if (!result?.storage_path)
        throw new Error(i18nT("publish_media_update_failed"));

      await savePublishMediaPatch(
        {
          id: result.id || null,
          bucket: result.bucket_name || prepared.bucket || "inrcy-pro-media",
          bucketName:
            result.bucket_name || prepared.bucket || "inrcy-pro-media",
          path: result.storage_path,
          storagePath: result.storage_path,
          publicUrl: result.signed_url || "",
          url: result.signed_url || "",
          name:
            result.title ||
            prepared.original_name ||
            file.name ||
            (mediaKind === "video"
              ? i18nT("media_video")
              : i18nT("media_image")),
          title: result.title || prepared.original_name || file.name || "",
          type:
            result.mime_type ||
            prepared.content_type ||
            file.type ||
            "application/octet-stream",
          mimeType:
            result.mime_type ||
            prepared.content_type ||
            file.type ||
            "application/octet-stream",
          size: result.size_bytes || file.size || 0,
          width: result.width || mediaInfo.width || null,
          height: result.height || mediaInfo.height || null,
          duration:
            result.duration_seconds || mediaInfo.duration_seconds || null,
          duration_seconds:
            result.duration_seconds || mediaInfo.duration_seconds || null,
          kind: result.media_type || mediaKind,
          mediaType: result.media_type || mediaKind,
          source: "pro_media_library",
        },
        mediaKind === "video" ? "replace" : mutation,
      );
      if (mediaKind === "image" && mutation === "append") {
        setPublishMediaActiveIndex(
          Math.min(
            publishImageCount,
            INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT - 1,
          ),
        );
      } else if (mediaKind === "video") {
        setPublishMediaActiveIndex(0);
      }
      showNotice(
        mediaKind === "video"
          ? i18nT("publish_video_updated")
          : mutation === "append"
            ? i18nT("publish_image_added")
            : i18nT("publish_image_updated"),
      );
    } catch (error) {
      showNotice(i18nT("publish_media_update_failed"));
    } finally {
      setPublishMediaUploadState("idle");
    }
  }

  const selectPublishMediaFromPicker = async (
    items: MediaLibraryPickerItem[],
  ) => {
    const item = items[0];
    if (!item) return;
    await selectPublishMediaFromLibrary(item);
  };

  async function removePublishMedia() {
    if (!selectedPreparedAction || publishMediaUploadState === "saving") return;
    setPublishMediaUploadState("saving");
    setNotice(null);

    try {
      await savePublishMediaPatch(null, "remove");
      if (publishMediaPreview?.kind === "image") {
        setPublishMediaActiveIndex((current) =>
          Math.max(
            0,
            Math.min(current, Math.max(0, publishImageCount - 2)),
          ),
        );
      } else {
        setPublishMediaActiveIndex(0);
      }
      showNotice(i18nT("publish_media_removed"));
    } catch (error) {
      showNotice(i18nT("publish_media_remove_failed"));
    } finally {
      setPublishMediaUploadState("idle");
    }
  }

  function updatePublishCtaDraft(patch: Partial<typeof publishTextDraft>) {
    setPublishTextDraft((current) => ({ ...current, ...patch }));
  }

  function applyPublishPreferredCta(choice: BoosterPreferredCta) {
    const displayKey = boosterDisplayKeyFromAgentChannel(
      publishTextDraft.channel,
    );
    const currentPost: BoosterChannelPost = {
      title: publishTextDraft.title,
      content: publishTextDraft.body,
      cta: publishTextDraft.cta,
      ctaMode: publishTextDraft.ctaMode,
      ctaUrl: publishTextDraft.ctaUrl,
      ctaPhone: publishTextDraft.ctaPhone,
      hashtags: publishTextDraft.hashtags.split(/[\s,;]+/).filter(Boolean),
    };
    const patch = buildPreferredCtaPatch(
      displayKey,
      choice,
      currentPost,
      publishCtaDefaults,
      publishCtaDefaults?.aiLanguage,
    );
    setPublishTextDraft((current) => ({
      ...current,
      cta: String(patch.cta ?? current.cta ?? ""),
      ctaMode: normalizeAgentCtaMode(patch.ctaMode ?? current.ctaMode),
      ctaUrl: String(patch.ctaUrl ?? current.ctaUrl ?? ""),
      ctaPhone: String(patch.ctaPhone ?? current.ctaPhone ?? ""),
    }));
  }

  async function savePublishText() {
    if (!selectedPreparedAction || publishSaveState === "saving") return;
    const channel = publishTextDraft.channel;
    const body = publishTextDraft.body.trim();
    if (!channel || !body) {
      showNotice(i18nT("le_contenu_de_la_publication_est_d18cf916"));
      return;
    }

    if (scheduledEditSession) {
      updateScheduledEditAction((action) =>
        updateScheduledEditPublishText(action, channel, {
          title: publishTextDraft.title.trim(),
          body,
          cta: publishTextDraft.cta.trim(),
          ctaMode: publishTextDraft.ctaMode,
          ctaUrl: publishTextDraft.ctaUrl.trim(),
          ctaPhone: publishTextDraft.ctaPhone.trim(),
          hashtags: publishTextDraft.hashtags,
        }),
      );
      setPublishEditOpen(false);
      showNotice(
        i18nT("texte_modifie_temporairement_valider_l_enregistr_97bc9fa5"),
      );
      return;
    }

    setPublishSaveState("saving");
    setNotice(null);

    try {
      const response = await fetch("/api/agent/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: selectedPreparedAction.id,
          editType: "publish_channel_text",
          channel,
          title: publishTextDraft.title.trim(),
          content: body,
          cta: publishTextDraft.cta.trim(),
          ctaMode: publishTextDraft.ctaMode,
          ctaUrl: publishTextDraft.ctaUrl.trim(),
          ctaPhone: publishTextDraft.ctaPhone.trim(),
          hashtags: publishTextDraft.hashtags,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        action?: AgentPreparedAction;
        error?: string;
      } | null;

      if (!response.ok || !payload?.action) {
        throw new Error(
          payload?.error || i18nT("modification_de_la_publication_impossible_e4568d66"),
        );
      }

      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
      setPublishEditOpen(false);
      showNotice(i18nT("publication_mise_a_jour_de5f8c83"));
    } catch (error) {
      showNotice(i18nT("modification_de_la_publication_impossible_e4568d66"));
    } finally {
      setPublishSaveState("idle");
    }
  }

  async function patchCampaignAction(
    body: Record<string, unknown>,
    fallbackError: string,
  ) {
    if (!selectedPreparedAction)
      throw new Error(i18nT("scheduled_action_not_found"));

    if (scheduledEditSession) {
      const nextAction = updateScheduledEditCampaign(
        scheduledEditSession.action,
        body,
      );
      updateScheduledEditAction(() => nextAction);
      return nextAction;
    }

    const response = await fetch("/api/agent/actions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: selectedPreparedAction.id,
        ...body,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      action?: AgentPreparedAction;
      error?: string;
      detail?: string;
    } | null;

    if (!response.ok || !payload?.action) {
      throw new Error(payload?.error || payload?.detail || fallbackError);
    }

    const updatedAction = payload.action;
    setActions((current) =>
      current.map((action) =>
        action.id === updatedAction.id ? updatedAction : action,
      ),
    );
    return updatedAction;
  }

  async function loadCrmContactsForAgent() {
    setCrmContactsLoading(true);
    try {
      const response = await fetch("/api/crm/contacts?all=1&pageSize=500", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        contacts?: CrmContactForAgent[];
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || "Contacts CRM indisponibles.");
      setCrmContacts(Array.isArray(payload?.contacts) ? payload.contacts : []);
    } catch (error) {
      showNotice(i18nT("crm_contacts_unavailable"));
    } finally {
      setCrmContactsLoading(false);
    }
  }

  async function openRecipientsEditor() {
    const currentRecipients = recipientsForAction(selectedPreparedAction);
    setSelectedRecipientEmails(
      currentRecipients.map((recipient) => recipient.email.toLowerCase()),
    );
    setRecipientsPreviewOpen(false);
    setCampaignEditOpen(false);
    setRecipientsEditOpen(true);
    setCrmRecipientSearch("");
    setManualRecipientsInput("");
    setCrmRecipientFiltersOpen(false);
    await loadCrmContactsForAgent();
  }

  function toggleRecipientSelection(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    if (!email) return;
    setSelectedRecipientEmails((current) =>
      current.includes(email)
        ? current.filter((item) => item !== email)
        : [...current, email],
    );
  }

  function addManualRecipientsFromInput() {
    const emails = parseRecipientEmails(manualRecipientsInput);
    if (!emails.length) {
      showNotice(i18nT("valid_email_required"));
      return;
    }
    setSelectedRecipientEmails((current) => {
      const next = new Set(current.map((email) => email.toLowerCase()));
      for (const email of emails) next.add(email);
      return Array.from(next);
    });
    setManualRecipientsInput("");
    showNotice(i18nT("recipients_added", { count: emails.length }));
  }

  function selectAllFilteredCrmRecipients() {
    const emails = filteredCrmContacts
      .map((contact) =>
        contactToCampaignRecipient(contact)?.email.toLowerCase(),
      )
      .filter((email): email is string => Boolean(email));
    setSelectedRecipientEmails((current) => {
      const next = new Set(current.map((email) => email.toLowerCase()));
      for (const email of emails) next.add(email);
      return Array.from(next);
    });
  }

  function clearFilteredCrmRecipients() {
    const emailsToRemove = new Set(
      filteredCrmContacts
        .map((contact) =>
          contactToCampaignRecipient(contact)?.email.toLowerCase(),
        )
        .filter((email): email is string => Boolean(email)),
    );
    setSelectedRecipientEmails((current) =>
      current.filter((email) => !emailsToRemove.has(email.toLowerCase())),
    );
  }

  function toggleFilteredCrmRecipients() {
    if (filteredCrmAllSelected) {
      clearFilteredCrmRecipients();
      return;
    }
    selectAllFilteredCrmRecipients();
  }

  function removeSelectedRecipient(emailValue: string) {
    const email = emailValue.trim().toLowerCase();
    setSelectedRecipientEmails((current) =>
      current.filter((item) => item.toLowerCase() !== email),
    );
  }

  async function saveCampaignRecipients() {
    if (!selectedPreparedAction || campaignSaveState === "saving") return;
    const previousByEmail = new Map(
      campaignRecipients.map((recipient) => [
        recipient.email.toLowerCase(),
        recipient,
      ]),
    );
    const pendingManualEmails = parseRecipientEmails(manualRecipientsInput);
    const emails = Array.from(
      new Set([
        ...selectedRecipientEmails.map((email) => email.toLowerCase()),
        ...pendingManualEmails,
      ]),
    );
    const recipients = emails
      .map(
        (email) =>
          crmRecipientsByEmail.get(email) ||
          previousByEmail.get(email) ||
          manualRecipientFromEmail(email),
      )
      .filter((recipient): recipient is CampaignRecipientPreview =>
        Boolean(recipient),
      );

    if (!recipients.length) {
      showNotice(i18nT("recipient_required"));
      return;
    }

    setCampaignSaveState("saving");
    try {
      await patchCampaignAction(
        { editType: "campaign_recipients", recipients },
        i18nT("campaign_recipients_update_failed"),
      );
      setRecipientsEditOpen(false);
      setManualRecipientsInput("");
      showNotice(i18nT("campaign_recipients_updated"));
    } catch (error) {
      showNotice(i18nT("campaign_recipients_update_failed"));
    } finally {
      setCampaignSaveState("idle");
    }
  }

  async function addNewRecipientToCrm() {
    if (newRecipientState === "saving") return;
    const email = newRecipientDraft.email.trim().toLowerCase();
    const name = newRecipientDraft.name.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
      showNotice(i18nT("email_required"));
      return;
    }

    setNewRecipientState("saving");
    try {
      const response = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: name || email,
          email,
          phone: newRecipientDraft.phone.trim(),
          category: "professionnel",
          contact_type: selectedKey === "loyalty" ? "client" : "prospect",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || i18nT("crm_contact_add_failed"));
      await loadCrmContactsForAgent();
      setSelectedRecipientEmails((current) =>
        current.includes(email) ? current : [...current, email],
      );
      setNewRecipientDraft({ name: "", email: "", phone: "" });
      setNewRecipientOpen(false);
      showNotice(i18nT("crm_contact_added"));
    } catch (error) {
      showNotice(i18nT("crm_contact_add_failed"));
    } finally {
      setNewRecipientState("idle");
    }
  }

  async function loadMailAccountsForAgent() {
    setMailAccountsLoading(true);
    try {
      const response = await fetch("/api/integrations/status", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as {
        mailAccounts?: AgentMailAccount[];
        accounts?: AgentMailAccount[];
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || i18nT("mailboxes_unavailable"));
      const accounts = Array.isArray(payload?.mailAccounts)
        ? payload.mailAccounts
        : Array.isArray(payload?.accounts)
          ? payload.accounts.filter(
              (account) => (account as any)?.category === "mail",
            )
          : [];
      setMailAccounts(accounts);
    } catch (error) {
      showNotice(i18nT("mailboxes_unavailable"));
    } finally {
      setMailAccountsLoading(false);
    }
  }

  async function openMailAccountEditor() {
    const current = asRecord(selectedPreparedAction?.payload?.mailAccount);
    setSelectedMailAccountId(
      firstSafeString(selectedPreparedAction?.payload?.accountId, current?.id),
    );
    setCampaignEditOpen(false);
    setMailAccountEditOpen(true);
    await loadMailAccountsForAgent();
  }

  async function saveCampaignMailAccount() {
    if (!selectedPreparedAction || campaignSaveState === "saving") return;
    if (!selectedMailAccountId) {
      showNotice(i18nT("mailbox_required"));
      return;
    }

    setCampaignSaveState("saving");
    try {
      await patchCampaignAction(
        { editType: "campaign_mail_account", accountId: selectedMailAccountId },
        i18nT("mailbox_update_failed"),
      );
      setMailAccountEditOpen(false);
      showNotice(i18nT("mailbox_updated"));
    } catch (error) {
      showNotice(i18nT("mailbox_update_failed"));
    } finally {
      setCampaignSaveState("idle");
    }
  }

  async function saveCampaignAttachments(attachments: CampaignAttachmentRef[]) {
    await patchCampaignAction(
      { editType: "campaign_attachments", attachments },
      i18nT("attachment_add_failed"),
    );
  }

  async function uploadCampaignAttachment(filesInput: FileList | null) {
    if (!selectedPreparedAction || attachmentUploadState === "saving") return;
    const files = Array.from(filesInput || []).slice(0, 10);
    if (!files.length) return;

    const directFiles: File[] = [];
    const oversizedMedia: File[] = [];
    const oversizedUnsupported: File[] = [];
    for (const file of files) {
      const mediaType = detectUniversalUploadMediaType({
        name: file.name,
        mimeType: file.type,
      });
      if (mediaType === "image" || mediaType === "video") {
        const requirements = getMediaLibraryOptimizationRequirements({
          mediaType,
          sizeBytes: file.size,
          targetBytes: MEDIA_LIBRARY_EMAIL_TARGET_BYTES,
          name: file.name,
          mimeType: file.type,
        });
        if (requirements.needsOptimization) oversizedMedia.push(file);
        else directFiles.push(file);
      } else if (file.size <= MEDIA_LIBRARY_EMAIL_TARGET_BYTES) {
        directFiles.push(file);
      } else {
        oversizedUnsupported.push(file);
      }
    }

    if (!directFiles.length) {
      if (oversizedUnsupported.length > 0) {
        showNotice(
          i18nT("attachment_too_large_unoptimizable", { file: oversizedUnsupported[0].name }),
        );
      }
      if (oversizedMedia.length > 0) {
        openMediaOptimizerForFiles(oversizedMedia, "campaign");
      }
      return;
    }

    setAttachmentUploadState("saving");
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id ? resolveActiveBrowserUserId(auth.user.id) : null;
      const uploaded: CampaignAttachmentRef[] = [];

      for (const file of directFiles) {
        const path = makeAttachmentPath(file.name || "piece-jointe", userId);
        const { error } = await supabase.storage
          .from("inrbox_attachments")
          .upload(path, file, {
            cacheControl: "3600",
            upsert: false,
            contentType: file.type || "application/octet-stream",
          });
        if (error) throw error;
        uploaded.push({
          bucket: "inrbox_attachments",
          path,
          name: file.name || "piece-jointe",
          type: file.type || "application/octet-stream",
          size: file.size || 0,
        });
      }

      const current = normalizeCampaignAttachmentRefs(
        selectedPreparedAction.payload?.attachments,
      );
      await saveCampaignAttachments([...current, ...uploaded].slice(0, 10));
      showNotice(
        oversizedUnsupported.length > 0
          ? i18nT("attachments_added_with_warning", { count: uploaded.length, file: oversizedUnsupported[0].name })
          : i18nT("attachments_added", { count: uploaded.length }),
      );
    } catch (error) {
      showNotice(i18nT("attachment_add_failed"));
    } finally {
      setAttachmentUploadState("idle");
    }

    if (oversizedMedia.length > 0) {
      openMediaOptimizerForFiles(oversizedMedia, "campaign");
    }
  }

  async function addCampaignAttachmentsFromMediaLibrary(
    items: MediaLibraryPickerItem[],
  ) {
    if (!selectedPreparedAction || attachmentUploadState === "saving") return false;
    const picked = items.slice(0, 10).map((item) => ({
      bucket: item.bucket_name || "inrcy-pro-media",
      path: item.storage_path,
      name:
        item.title ||
        item.storage_path.split("/").pop() ||
        (item.media_type === "video"
          ? i18nT("media_video_inrcy")
          : i18nT("media_image_inrcy")),
      type:
        item.mime_type ||
        (item.media_type === "video" ? "video/mp4" : "image/jpeg"),
      size: item.size_bytes || 0,
    })) as CampaignAttachmentRef[];
    if (!picked.length) return false;

    setAttachmentUploadState("saving");
    try {
      const current = normalizeCampaignAttachmentRefs(
        selectedPreparedAction.payload?.attachments,
      );
      await saveCampaignAttachments([...current, ...picked].slice(0, 10));
      showNotice(
        i18nT("attachments_library_added", { count: picked.length }),
      );
      return true;
    } catch (error) {
      showNotice(i18nT("attachment_add_failed"));
      return false;
    } finally {
      setAttachmentUploadState("idle");
    }
  }

  async function handleOptimizedAgentMedia(item: MediaOptimizerItem) {
    const request = mediaOptimizerRequest;
    if (!request) {
      throw new Error(i18nT("optimized_media_destination_unavailable"));
    }

    if (
      request.destination === "campaign" &&
      Number(item.size_bytes || 0) > MEDIA_LIBRARY_EMAIL_TARGET_BYTES
    ) {
      throw new Error(i18nT("optimized_media_still_too_large"));
    }

    const inserted =
      request.destination === "campaign"
        ? await addCampaignAttachmentsFromMediaLibrary([item])
        : await selectPublishMediaFromLibrary(item);
    if (!inserted) {
      throw new Error(i18nT("optimized_media_insert_failed"));
    }
    setMediaOptimizerCompleted(true);
  }

  async function removeCampaignAttachment(path: string) {
    if (!selectedPreparedAction || attachmentUploadState === "saving") return;
    setAttachmentUploadState("saving");
    try {
      const current = normalizeCampaignAttachmentRefs(
        selectedPreparedAction.payload?.attachments,
      );
      await saveCampaignAttachments(
        current.filter((attachment) => attachment.path !== path),
      );
      showNotice(i18nT("attachment_removed"));
    } catch (error) {
      showNotice(i18nT("attachment_remove_failed"));
    } finally {
      setAttachmentUploadState("idle");
    }
  }

  async function saveCampaignAsDraft() {
    if (!selectedPreparedAction || campaignDraftSaveState === "saving") return;
    if (scheduledEditSession) {
      showNotice(i18nT("scheduled_edit_save_first"));
      setCampaignDraftConfirmOpen(false);
      return;
    }

    setCampaignDraftSaveState("saving");
    setNotice(null);

    try {
      const response = await fetch("/api/agent/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: selectedPreparedAction.id,
          editType: "save_campaign_draft",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        action?: AgentPreparedAction;
        draftId?: string | null;
        error?: string;
      } | null;

      if (!response.ok || !payload?.action) {
        throw new Error(
          payload?.error || i18nT("draft_save_failed"),
        );
      }

      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
      setCampaignDraftConfirmOpen(false);
      showNotice(i18nT("campaign_draft_saved"));
    } catch (error) {
      showNotice(i18nT("draft_save_failed"));
    } finally {
      setCampaignDraftSaveState("idle");
    }
  }

  async function savePublishAsDraft() {
    if (!selectedPreparedAction || campaignDraftSaveState === "saving") return;
    if (scheduledEditSession) {
      showNotice(i18nT("scheduled_edit_save_first"));
      setCampaignDraftConfirmOpen(false);
      return;
    }

    setCampaignDraftSaveState("saving");
    setNotice(null);

    try {
      const response = await fetch("/api/agent/actions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId: selectedPreparedAction.id,
          editType: "save_publish_draft",
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        action?: AgentPreparedAction;
        draftId?: string | null;
        error?: string;
      } | null;

      if (!response.ok || !payload?.action) {
        throw new Error(
          payload?.error || i18nT("draft_save_failed"),
        );
      }

      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
      setCampaignDraftConfirmOpen(false);
      showNotice(i18nT("publication_draft_saved"));
    } catch (error) {
      showNotice(i18nT("draft_save_failed"));
    } finally {
      setCampaignDraftSaveState("idle");
    }
  }

  function updateScheduledEditAction(
    updater: (action: AgentPreparedAction) => AgentPreparedAction,
  ) {
    setScheduledEditSession((current) => {
      if (!current) return current;
      const nextAction = updater(current.action);
      return {
        ...current,
        action: nextAction,
        dirty:
          preparedActionDirtySignature(nextAction) !==
          current.baselineSignature,
      };
    });
  }

  function openAgentConfirmDialog(config: NonNullable<AgentConfirmDialogState>) {
    setAgentConfirmDialog(config);
  }

  async function confirmAgentDialog() {
    const dialog = agentConfirmDialog;
    if (!dialog) return;
    setAgentConfirmDialog(null);
    await dialog.onConfirm();
  }

  function exitScheduledEditSession(
    options: { silent?: boolean; force?: boolean; onAfterExit?: () => void } = {},
  ) {
    const session = scheduledEditSession;
    if (!session) {
      options.onAfterExit?.();
      return true;
    }

    const restorePreviousState = () => {
      setScheduledEditSession(null);
      setValidationChoiceOpen(false);
      setValidationScheduleOpen(false);
      setPublishEditChoiceOpen(false);
      setPublishEditOpen(false);
      setPublishMediaPreviewOpen(false);
      setCampaignEditOpen(false);
      setMailTextEditOpen(false);
      setRecipientsPreviewOpen(false);
      setRecipientsEditOpen(false);
      setAttachmentPreviewOpen(false);
      setMailAccountEditOpen(false);
      setSelectedKey(session.previousSelectedKey);
      if (!options.silent) {
        showNotice(i18nT("scheduled_edit_cancelled"));
      }
      options.onAfterExit?.();
    };

    if (!options.force) {
      const hasChanges = session.dirty;
      if (!hasChanges) {
        restorePreviousState();
        return true;
      }
      void confirmInrcy({
        eyebrow: i18nT("edition_inragent_f58f5494"),
        title: i18nT("continuer_sans_sauvegarder_c43811c9"),
        message: i18nT("les_modifications_en_cours_seront_perdues_09635085"),
        confirmLabel: i18nT("continuer_129ffff9"),
        cancelLabel: i18nT("annuler_49ba3292"),
        variant: "danger",
      }).then((confirmed) => {
        if (confirmed) restorePreviousState();
      });
      return false;
    }

    restorePreviousState();
    return true;
  }

  useUnsavedExitGuard({
    active: Boolean(scheduledEditSession),
    shouldBlock: scheduledEditDirty,
    onConfirmExit: () => {
      exitScheduledEditSession({ silent: true, force: true });
    },
    eyebrow: i18nT("edition_inragent_f58f5494"),
    title: i18nT("continuer_sans_sauvegarder_c43811c9"),
    message: i18nT("les_modifications_en_cours_seront_perdues_09635085"),
    confirmLabel: i18nT("continuer_129ffff9"),
    cancelLabel: i18nT("annuler_49ba3292"),
    variant: "danger",
  });

  function openScheduledActionEditor(actionId: string | null | undefined) {
    if (!actionId) return;
    if (scheduledEditSession) {
      if (scheduledEditSession.scheduledAction.id === actionId) return;
      if (
        !exitScheduledEditSession({
          silent: true,
          onAfterExit: () => openScheduledActionEditor(actionId),
        })
      ) {
        return;
      }
    }
    const scheduledAction = scheduledActions.find((item) => item.id === actionId);
    if (!scheduledAction) {
      showNotice(i18nT("scheduled_action_not_found"));
      return;
    }
    if (isScheduledSimpleMailAction(scheduledAction)) {
      const params = new URLSearchParams({
        folder: "mails",
        scheduled_edit_id: scheduledAction.id,
      });
      router.push(`/dashboard/mails?${params.toString()}`);
      return;
    }

    if (isScheduledStatsAction(scheduledAction)) {
      setScheduleOpen(false);
      setValidationChoiceOpen(false);
      setValidationScheduleOpen(false);
      setSelectedKey("stats");
      return;
    }

    const action = scheduledActionToPreparedAction(scheduledAction);
    if (!action) {
      showNotice(i18nT("scheduled_action_not_openable"));
      return;
    }
    const nextKey = (action.automationKey || scheduledAutomationKey(scheduledAction)) as AutomationKey;
    setScheduleOpen(false);
    setValidationChoiceOpen(false);
    setValidationScheduleOpen(false);
    setSelectedKey(nextKey);
    setScheduledEditSession({
      scheduledAction,
      action,
      previousSelectedKey: selectedKey,
      baselineSignature: preparedActionDirtySignature(action),
      dirty: false,
    });
    showNotice(i18nT("scheduled_action_edit_opened"));
  }

  async function patchScheduledAction(
    actionId: string,
    body: Record<string, unknown>,
  ) {
    const response = await fetch(`/api/agent/scheduled-actions/${actionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      scheduledAction?: AgentScheduledAction;
      error?: string;
      tableMissing?: boolean;
    } | null;
    if (!response.ok || !payload?.scheduledAction) {
      if (payload?.tableMissing) setScheduledActionsTableMissing(true);
      throw new Error(
        payload?.error || i18nT("schedule_update_failed"),
      );
    }
    return payload.scheduledAction;
  }

  async function createExtraScheduledAction(body: Record<string, unknown>) {
    const response = await fetch("/api/agent/scheduled-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "manual",
        timezone: agentSettings.timezone || "Europe/Paris",
        ...body,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      scheduledAction?: AgentScheduledAction;
      error?: string;
      tableMissing?: boolean;
    } | null;
    if (!response.ok || !payload?.scheduledAction) {
      if (payload?.tableMissing) setScheduledActionsTableMissing(true);
      throw new Error(
        payload?.error || i18nT("schedule_update_failed"),
      );
    }
    return payload.scheduledAction;
  }

  function applySavedScheduledEdit(
    savedActions: AgentScheduledAction[],
    options: { closeEdit?: boolean } = {},
  ) {
    if (savedActions.length) {
      const savedIds = new Set(savedActions.map((action) => action.id));
      setScheduledActions((current) => [
        ...savedActions,
        ...current.filter((action) => !savedIds.has(action.id)),
      ]);
    }
    if (options.closeEdit !== false) {
      exitScheduledEditSession({ silent: true, force: true });
    } else if (savedActions[0]) {
      setScheduledEditSession((current) =>
        current
          ? {
              ...current,
              scheduledAction: savedActions[0],
              baselineSignature: preparedActionDirtySignature(current.action),
              dirty: false,
            }
          : current,
      );
    }
  }

  async function saveScheduledEditPublication(
    selections: PublishScheduleSelection[],
  ) {
    const session = scheduledEditSession;
    if (!session) return;
    if (!selections.length) {
      throw new Error(i18nT("schedule_channels_required"));
    }

    const grouped = Array.from(
      selections.reduce<Map<string, BoosterChannelKey[]>>((groups, selection) => {
        const channels = groups.get(selection.scheduledAt) || [];
        if (!channels.includes(selection.channel)) channels.push(selection.channel);
        groups.set(selection.scheduledAt, channels);
        return groups;
      }, new Map<string, BoosterChannelKey[]>()),
    );
    if (!grouped.length) {
      throw new Error(i18nT("schedule_channels_required"));
    }

    const savedActions: AgentScheduledAction[] = [];
    const [firstScheduledAt, firstChannels] = grouped[0] as [string, BoosterChannelKey[]];
    savedActions.push(
      await patchScheduledAction(
        session.scheduledAction.id,
        scheduledEditUpdateFromAction(session.action, {
          scheduledAt: firstScheduledAt,
          channels: firstChannels,
        }),
      ),
    );

    for (const [scheduledAt, channels] of grouped.slice(1)) {
      savedActions.push(
        await createExtraScheduledAction(
          scheduledEditUpdateFromAction(session.action, { scheduledAt, channels }),
        ),
      );
    }

    applySavedScheduledEdit(savedActions, { closeEdit: false });
    await refreshScheduledActions(true);
  }

  async function saveScheduledEditCampaign(scheduledAt: string) {
    const session = scheduledEditSession;
    if (!session) return;
    const saved = await patchScheduledAction(
      session.scheduledAction.id,
      scheduledEditUpdateFromAction(session.action, { scheduledAt }),
    );
    applySavedScheduledEdit([saved], { closeEdit: false });
    await refreshScheduledActions(true);
  }

  async function performDeleteScheduledEditAction(session: ScheduledActionEditSession) {
    setScheduleMutationState("saving");
    setNotice(null);
    try {
      const response = await fetch(
        `/api/agent/scheduled-actions/${session.scheduledAction.id}`,
        { method: "DELETE" },
      );
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(
          payload?.error || i18nT("scheduled_action_delete_failed"),
        );
      }
      exitScheduledEditSession({ silent: true, force: true });
      await refreshScheduledActions(true);
      showNotice(i18nT("scheduled_action_deleted"));
    } catch (error) {
      showNotice(i18nT("scheduled_action_delete_failed"));
    } finally {
      setScheduleMutationState("idle");
    }
  }

  async function deleteScheduledEditAction() {
    const session = scheduledEditSession;
    if (!session || scheduleMutationState === "saving") return;
    openAgentConfirmDialog({
      title: i18nT("supprimer_ce_contenu_programme_69dec33b"),
      message: i18nT("ce_contenu_programme_sera_supprime_definitivemen_c71f5bb9"),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      cancelLabel: i18nT("annuler_49ba3292"),
      tone: "danger",
      onConfirm: () => performDeleteScheduledEditAction(session),
    });
  }

  function configPatchFromScheduledAt(
    config: AutomationConfig,
    scheduledAt: string,
  ): Pick<AutomationConfig, "day" | "time" | "scheduleSlots"> {
    const date = new Date(scheduledAt);
    if (Number.isNaN(date.getTime())) {
      throw new Error(i18nT("future_date_required"));
    }

    const day = apiToDay[date.getDay()] || config.day || "Lundi";
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes(),
    ).padStart(2, "0")}`;
    const normalizedSlots = normalizeConfigScheduleSlots(config);
    const scheduleSlots = [
      { ...normalizedSlots[0], day, time },
      normalizedSlots[1] || { day: dayOffsetLabel(day, 3), time },
    ];

    return { day, time, scheduleSlots };
  }

  async function saveAutomationScheduleEdit(scheduledAt: string) {
    if (!automationScheduleEdit) return;
    setAutomationScheduleEditError(null);

    try {
      const currentConfig = configs[automationScheduleEdit.key];
      const patch = configPatchFromScheduledAt(currentConfig, scheduledAt);
      const nextConfigs: Record<AutomationKey, AutomationConfig> = {
        ...configs,
        [automationScheduleEdit.key]: {
          ...currentConfig,
          ...patch,
        },
      };
      const safeConfigs = agentConnectedChannels
        ? normalizeConfigsForConnectedChannels(nextConfigs, agentConnectedChannels)
        : nextConfigs;
      const nextSettings = configsToSettings(agentSettings, safeConfigs);

      const response = await fetch("/api/agent/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextSettings }),
      });
      const payload = (await response.json().catch(() => null)) as {
        settings?: Partial<InrAgentSettings>;
        error?: string;
        tableMissing?: boolean;
      } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error || i18nT("schedule_update_failed"),
        );
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
      setAutomationScheduleEdit(null);
      await refreshScheduledActions(true);
      showNotice(i18nT("programmation_mise_a_jour_ea5f575f"));
    } catch (error) {
      const message = i18nT("schedule_update_failed");
      setAutomationScheduleEditError(message);
      throw new Error(message);
    }
  }

  async function saveScheduleOnlyEdit(scheduledAt: string) {
    if (!scheduleOnlyEdit) return;
    setScheduleOnlyEditError(null);
    try {
      const saved = await patchScheduledAction(scheduleOnlyEdit.action.id, {
        scheduledAt,
      });
      setScheduledActions((current) =>
        current.map((action) => (action.id === saved.id ? saved : action)),
      );
      setScheduleOnlyEdit(null);
      await refreshScheduledActions(true);
      showNotice(i18nT("programmation_mise_a_jour_ea5f575f"));
    } catch (error) {
      const message = i18nT("schedule_update_failed");
      setScheduleOnlyEditError(message);
      throw new Error(message);
    }
  }

  async function performCancelScheduledAction(actionId: string) {
    setScheduleMutationState("saving");
    try {
      const response = await fetch(`/api/agent/scheduled-actions/${actionId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          payload?.error || i18nT("scheduled_action_delete_failed"),
        );
      showNotice(i18nT("scheduled_action_deleted"));
      await refreshScheduledActions(true);
    } catch (error) {
      showNotice(i18nT("scheduled_action_delete_failed"));
    } finally {
      setScheduleMutationState("idle");
    }
  }

  async function cancelScheduledAction(actionId: string | null | undefined) {
    if (!actionId || scheduleMutationState === "saving") return;
    openAgentConfirmDialog({
      title: i18nT("supprimer_cette_action_programmee_01310ea3"),
      message: i18nT("cette_action_sera_retiree_du_planning_31e5e378"),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      cancelLabel: i18nT("annuler_49ba3292"),
      tone: "danger",
      onConfirm: () => performCancelScheduledAction(actionId),
    });
  }

  async function performDisableAutomationFromSchedule(key: AutomationKey) {
    const nextConfigs = {
      ...configs,
      [key]: { ...configs[key], enabled: false },
    };
    const nextSettings = configsToSettings(agentSettings, nextConfigs);
    setScheduleMutationState("saving");
    try {
      const response = await fetch("/api/agent/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextSettings }),
      });
      const payload = (await response.json().catch(() => null)) as {
        settings?: Partial<InrAgentSettings>;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || i18nT("automation_disable_failed"));
      const savedSettings = sanitizeInrAgentSettings(
        payload?.settings ?? nextSettings,
      );
      setAgentSettings(savedSettings);
      setConfigs(settingsToConfigs(savedSettings));
      writeCachedAgentViewSnapshot({ settings: savedSettings });
      showNotice(i18nT("automation_disabled_notice"));
    } catch (error) {
      showNotice(i18nT("automation_disable_failed"));
    } finally {
      setScheduleMutationState("idle");
    }
  }

  async function disableAutomationFromSchedule(
    key: AutomationKey | null | undefined,
  ) {
    if (!key || scheduleMutationState === "saving") return;
    const automation = visibleAutomations.find((item) => item.key === key);
    openAgentConfirmDialog({
      title: i18nT("desactiver_l_automatisation_value_16e4507f", { value0: automation?.title || "iNrAgent" }),
      message: i18nT("les_prochaines_actions_automatiques_de_cette_10b200ec"),
      confirmLabel: i18nT("desactiver_d2839748"),
      cancelLabel: i18nT("annuler_49ba3292"),
      tone: "danger",
      onConfirm: () => performDisableAutomationFromSchedule(key),
    });
  }

  function handleScheduleRowOpenContent(item: ScheduleListItem) {
    if (item.source === "manual") {
      openScheduledActionEditor(item.scheduledActionId);
      return;
    }
    if (item.automationKey) {
      const openContent = () => {
        setScheduleOpen(false);
        setValidationChoiceOpen(false);
        setValidationScheduleOpen(false);
        setSelectedKey(item.automationKey as AutomationKey);
      };
      if (
        !exitScheduledEditSession({
          silent: true,
          onAfterExit: openContent,
        })
      )
        return;
      openContent();
    }
  }

  function handleScheduleRowReschedule(item: ScheduleListItem) {
    if (item.source === "manual") {
      const scheduledAction = scheduledActions.find(
        (action) => action.id === item.scheduledActionId,
      );
      if (!scheduledAction) {
        showNotice(i18nT("scheduled_action_not_found"));
        return;
      }
      const openScheduleEdit = () => {
        setScheduleOnlyEditError(null);
        setScheduleOnlyEdit({
          action: scheduledAction,
          label: item.action,
        });
      };
      if (
        !exitScheduledEditSession({
          silent: true,
          onAfterExit: openScheduleEdit,
        })
      )
        return;
      openScheduleEdit();
      return;
    }
    if (item.automationKey) {
      const openScheduleEdit = () => {
        setAutomationScheduleEditError(null);
        setAutomationScheduleEdit({
          key: item.automationKey as AutomationKey,
          label: item.action,
          scheduledAtIso: item.scheduledAtIso || null,
        });
      };
      if (!exitScheduledEditSession({ silent: true, onAfterExit: openScheduleEdit })) return;
      openScheduleEdit();
    }
  }

  async function handleScheduleRowDelete(item: ScheduleListItem) {
    if (item.source === "manual") {
      await cancelScheduledAction(item.scheduledActionId);
      return;
    }
    await disableAutomationFromSchedule(item.automationKey);
  }

  function canSchedulePreparedAction(
    action: AgentPreparedAction | null | undefined,
  ) {
    if (!action) return false;
    if (
      action.automationKey === "publish" &&
      action.targetTool === "booster" &&
      action.actionType === "publication"
    )
      return true;
    if (
      (action.automationKey === "grow" || action.automationKey === "loyalty") &&
      ["propulser", "fideliser", "mails"].includes(action.targetTool)
    )
      return true;
    return false;
  }

  function openValidationScheduleModal() {
    setValidationChoiceOpen(false);
    setValidationScheduleOpen(true);
  }

  async function persistScheduledPreparedAction(
    body: Record<string, unknown>,
    successMessage = i18nT("scheduled_action_success"),
    options: { closeSchedule?: boolean; showSuccessNotice?: boolean } = {},
  ) {
    const response = await fetch("/api/agent/actions/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      action?: AgentPreparedAction;
      scheduledAction?: AgentScheduledAction | null;
      scheduledActions?: AgentScheduledAction[];
      error?: string;
      tableMissing?: boolean;
    } | null;

    if (!response.ok) {
      if (payload?.tableMissing) setScheduledActionsTableMissing(true);
      throw new Error(
        payload?.error || i18nT("schedule_update_failed"),
      );
    }

    if (payload?.action) {
      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
    }
    const newScheduledActions = Array.isArray(payload?.scheduledActions)
      ? payload.scheduledActions
      : payload?.scheduledAction
        ? [payload.scheduledAction]
        : [];
    if (newScheduledActions.length) {
      const newIds = new Set(newScheduledActions.map((item) => item.id));
      setScheduledActions((current) => [
        ...newScheduledActions,
        ...current.filter((item) => !newIds.has(item.id)),
      ]);
    }

    if (options.closeSchedule !== false) {
      setValidationScheduleOpen(false);
    }
    if (options.showSuccessNotice !== false) {
      showNotice(successMessage);
    }
    await refreshActions(true);
    await refreshScheduledActions(true);
  }

  async function scheduleValidatedCampaign(scheduledAt: string) {
    if (!selectedPreparedAction || validationScheduleState === "saving") return;
    if (
      !scheduledAt ||
      new Date(scheduledAt).getTime() <= Date.now() + 30_000
    ) {
      showNotice(i18nT("future_date_required"));
      return;
    }

    if (scheduledEditSession) {
      setValidationScheduleState("saving");
      setNotice(null);
      try {
        await saveScheduledEditCampaign(scheduledAt);
      } catch (error) {
        const message = i18nT("scheduled_campaign_update_failed");
        showNotice(message);
        throw new Error(message);
      } finally {
        setValidationScheduleState("idle");
      }
      return;
    }

    setValidationScheduleState("saving");
    setNotice(null);
    try {
      await persistScheduledPreparedAction(
        {
          actionId: selectedPreparedAction.id,
          scheduledAt,
          timezone: agentSettings.timezone || "Europe/Paris",
        },
        i18nT("scheduled_campaign_success"),
        { closeSchedule: false, showSuccessNotice: false },
      );
    } catch (error) {
      const message = i18nT("campaign_schedule_failed");
      showNotice(message);
      throw new Error(message);
    } finally {
      setValidationScheduleState("idle");
    }
  }

  async function scheduleValidatedPublication(
    selections: PublishScheduleSelection[],
    immediateChannels: BoosterChannelKey[] = [],
  ) {
    if (!selectedPreparedAction || validationScheduleState === "saving") return;
    if (!selections.length) {
      showNotice(i18nT("schedule_channels_required"));
      return;
    }

    if (scheduledEditSession) {
      setValidationScheduleState("saving");
      setNotice(null);
      try {
        await saveScheduledEditPublication(selections);
        setPendingImmediateAgentPublishAfterSchedule(null);
      } catch (error) {
        const message = i18nT("scheduled_publication_update_failed");
        showNotice(message);
        throw new Error(message);
      } finally {
        setValidationScheduleState("idle");
      }
      return;
    }

    setValidationScheduleState("saving");
    setNotice(null);
    try {
      await persistScheduledPreparedAction(
        {
          actionId: selectedPreparedAction.id,
          scheduleSelections: selections,
          timezone: agentSettings.timezone || "Europe/Paris",
        },
        i18nT("scheduled_publication_success", { count: selections.length }),
        { closeSchedule: false, showSuccessNotice: false },
      );

      const immediateChannelsToPublish = Array.from(new Set(immediateChannels))
        .filter((channel): channel is BoosterChannelKey => Boolean(channel))
        .filter(
          (channel) =>
            !selections.some((selection) => selection.channel === channel),
        );

      setPendingImmediateAgentPublishAfterSchedule(
        immediateChannelsToPublish.length
          ? {
              action: selectedPreparedAction,
              actionId: selectedPreparedAction.id,
              channels: immediateChannelsToPublish,
            }
          : null,
      );
    } catch (error) {
      const message = i18nT("publication_schedule_failed");
      showNotice(message);
      throw new Error(message);
    } finally {
      setValidationScheduleState("idle");
    }
  }

  const {
    actionMutationState,
    actionMutationIntent,
    agentPublishExecutionProgress,
    agentPublishSuccessSummary,
    setAgentPublishSuccessSummary,
    agentCampaignLaunchNotice,
    setAgentCampaignLaunchNotice,
    executeImmediateAgentPublicationAfterSchedule,
    runScheduledEditNow,
    updateActionStatus,
  } = useAgentActionExecution({
    selectedPreparedAction,
    scheduledEditSession,
    setActions,
    setScheduledActions,
    setTableMissing,
    setNotice,
    setValidationChoiceOpen,
    setValidationScheduleOpen,
    refreshActions,
    refreshScheduledActions,
    patchScheduledAction,
    exitScheduledEditSession,
    deleteScheduledEditAction,
    showNotice,
  });

  return (
    <main className={styles.agentPage}>
      <AgentFeedbackModals
        publishExecutionProgress={agentPublishExecutionProgress}
        publishSuccessSummary={agentPublishSuccessSummary}
        campaignLaunchNotice={agentCampaignLaunchNotice}
        confirmDialog={agentConfirmDialog}
        onClosePublishSuccess={() => setAgentPublishSuccessSummary(null)}
        onOpenPublishedInrSend={() => {
          setAgentPublishSuccessSummary(null);
          router.push("/dashboard/mails?folder=publications");
        }}
        onCloseCampaignLaunch={() => setAgentCampaignLaunchNotice(null)}
        onOpenCampaignFolder={(folder) => {
          setAgentCampaignLaunchNotice(null);
          router.push(`/dashboard/mails?folder=${folder}`);
        }}
        onCloseConfirm={() => setAgentConfirmDialog(null)}
        onConfirm={() => void confirmAgentDialog()}
      />

      <PublishAiConfigurationDrawer
        open={aiConfigurationOpen}
        isMobile={isMobileHeader}
        drawerHeight="100dvh"
        onClose={() => setAiConfigurationOpen(false)}
      />
      <section
        className={styles.agentCanvas}
        aria-label={i18nT("inr_agent_automatisations_e832d99d")}
      >
        <header className={styles.moduleHeader}>
          <div className={styles.moduleTitleBlock}>
            <img
              className={styles.moduleLogo}
              src="/icons/inr-agent-header.png"
              alt={i18nT("inr_agent_88080b90")}
              width={68}
              height={68}
              loading="eager"
              decoding="sync"
            />
            <div className={styles.moduleTitleText}>
              <h1>{i18nT("inr_agent_88080b90")}</h1>
              <p className={styles.moduleSubtitleDesktop}>
                {i18nT("programmateur_d_automatisations_connecte_a_vos_ee58d0a3")}{" "}</p>
            </div>
          </div>

          <p className={styles.moduleSubtitleMobile}>
            {i18nT("programmateur_d_automatisations_connecte_a_vos_ee58d0a3")}{" "}</p>

          <div className={styles.moduleHeaderActions}>
            {loadState === "loading" && (
              <span className={styles.headerSyncPill}>{i18nT("synchronisation_60a2d2da")}</span>
            )}
            {tableMissing && (
              <span className={styles.headerWarningPill}>
                {i18nT("tables_supabase_a_creer_61f5bd7b")}{" "}</span>
            )}
            <HelpButton
              onClick={() => {
                const openHelp = () => setHelpOpen(true);
                if (!exitScheduledEditSession({ silent: true, onAfterExit: openHelp })) return;
                openHelp();
              }}
              title={i18nT("aide_inr_agent_ec5c0488")}
              size={isMobileHeader ? 26 : 34}
            />
            <button
              type="button"
              className={styles.headerAiButton}
              onClick={() => {
                const openAiConfiguration = () => setAiConfigurationOpen(true);
                if (!exitScheduledEditSession({ silent: true, onAfterExit: openAiConfiguration })) return;
                openAiConfiguration();
              }}
              aria-label={i18nT("configuration_ia_f620c8d8")}
              title={i18nT("configurer_le_style_des_contenus_generes_c780a7a6")}
            >
              {i18nT("ia_d41daf59")}{" "}</button>
            <button
              type="button"
              className={styles.headerScheduleButton}
              onClick={() => {
                const openPlanning = () => {
                  setScheduleOpen(true);
                  void refreshScheduledActions(true);
                };
                if (!exitScheduledEditSession({ silent: true, onAfterExit: openPlanning })) return;
                openPlanning();
              }}
              aria-label={i18nT("voir_les_actions_programmees_b3d2dc94")}
              title={i18nT("programmation_6255df3b")}
            >
              <span className={styles.headerScheduleIcon} aria-hidden>
                <CalendarMetaIcon />
              </span>
              <span className={styles.headerScheduleLabel}>{i18nT("planning_0005027d")}</span>
            </button>
            <button
              type="button"
              className={styles.headerToolButton}
              data-automation={selected.key}
              onClick={() => {
                const openTool = () => router.push(selectedHeaderTool.href);
                if (!exitScheduledEditSession({ silent: true, onAfterExit: openTool })) return;
                openTool();
              }}
              aria-label={i18nT("ouvrir_value_b62c18f4", { value0: selectedHeaderTool.label })}
              title={i18nT("ouvrir_value_b62c18f4", { value0: selectedHeaderTool.label })}
            >
              {selectedHeaderTool.logoSrc ? (
                <img
                  className={styles.headerToolLogo}
                  src={selectedHeaderTool.logoSrc}
                  alt=""
                  aria-hidden
                  width={34}
                  height={34}
                  loading="eager"
                  decoding="sync"
                  onError={(event) => {
                    event.currentTarget.src = "/inrstats-logo.png";
                  }}
                />
              ) : (
                <span className={styles.headerToolLetter} aria-hidden>
                  {selectedHeaderTool.compactLabel}
                </span>
              )}
              <span className={styles.headerToolLabel}>
                {selectedHeaderTool.label}
              </span>
            </button>
            <button
              type="button"
              className={styles.headerInrSendButton}
              onClick={() => {
                const openInrSend = () =>
                  router.push(
                    `/dashboard/mails?folder=${
                      standardMode
                        ? "publications"
                        : inrSendFolderForAutomation(selected.key)
                    }`,
                  );
                if (!exitScheduledEditSession({ silent: true, onAfterExit: openInrSend })) return;
                openInrSend();
              }}
              aria-label={i18nT("ouvrir_inr_send_d4b453c9")}
              title={i18nT("voir_l_historique_des_actions_realisees_98b66273")}
            >
              <span className={styles.headerInrSendLabel}>{i18nT("inr_send_5c2a3e92")}</span>
              <img
                className={styles.headerInrSendLogo}
                src="/inrsend-logo-seul.png"
                alt=""
                aria-hidden
                width={34}
                height={34}
                loading="eager"
                decoding="sync"
              />
            </button>
            <button
              type="button"
              className={styles.headerCloseButton}
              onClick={() => {
                const closeAgent = () => router.push("/dashboard");
                if (!exitScheduledEditSession({ silent: true, onAfterExit: closeAgent })) return;
                closeAgent();
              }}
              aria-label={i18nT("retour_au_tableau_de_bord_72006dd2")}
              title={i18nT("retour_au_tableau_de_bord_72006dd2")}
            >
              <span className={styles.headerCloseLabel}>{i18nT("fermer_5ab4ec64")}</span>
            </button>
          </div>
        </header>


        <nav
          className={`${styles.automationGrid} ${
            standardMode ? styles.automationGridStandard : ""
          }`}
          aria-label={i18nT("automatisations_inr_agent_66ca506e")}
        >
          {visibleAutomations.map((automation) => {
            const selectedCard = automation.key === selectedKey;
            const active = configs[automation.key].enabled;

            return (
              <article
                key={automation.key}
                data-automation={automation.key}
                className={`${styles.automationCard} ${selectedCard ? styles.automationCardActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.automationSelect}
                  onClick={() => {
                    const selectAutomation = () => setSelectedKey(automation.key);
                    if (!exitScheduledEditSession({ silent: true, onAfterExit: selectAutomation })) return;
                    selectAutomation();
                  }}
                  aria-pressed={selectedCard}
                >
                  <span className={styles.cardIcon} aria-hidden>
                    <AutomationIcon type={automation.key} />
                  </span>
                  <span className={styles.cardTitle}>
                    <span className={styles.cardTitleFull}>
                      {agentAutomationTitle(automation.key, runtimeT)}
                    </span>
                    <span className={styles.cardTitleShort}>
                      {agentAutomationTitle(automation.key, runtimeT, true)}
                    </span>
                  </span>
                  {pendingActionsByAutomation[automation.key] > 0 && (
                    <span
                      className={styles.cardPendingCount}
                      data-count={pendingActionsByAutomation[automation.key]}
                      aria-label={i18nT("value_action_a_valider_c1bfb13c", { value0: pendingActionsByAutomation[automation.key] })}
                    >
                      {i18nT("value_a_valider_24b7d9fb", { value0: pendingActionsByAutomation[automation.key] })}</span>
                  )}
                  {active && (
                    <span
                      className={styles.cardStatus}
                      aria-label={i18nT("automatisation_activee_4636ff37")}
                    />
                  )}
                </button>
                <button
                  type="button"
                  className={styles.settingsButton}
                  onClick={() => {
                    const openSettings = () => setSettingsKey(automation.key);
                    if (!exitScheduledEditSession({ silent: true, onAfterExit: openSettings })) return;
                    openSettings();
                  }}
                  aria-label={i18nT("programmer_value_1cfdf29d", { value0: agentAutomationTitle(automation.key, runtimeT) })}
                  title={i18nT("programmer_cette_automatisation_2c756652")}
                >
                  <span className={styles.settingsButtonLabel}>{i18nT("programmer_f704a30b")}</span>
                  <AutomationSettingsIcon />
                </button>
              </article>
            );
          })}
        </nav>

        <div className={styles.mainGrid}>
          {robotPanelOpen && (
            <button
              type="button"
              className={styles.robotPanelBackdrop}
              onClick={() => setRobotPanelOpen(false)}
              aria-label={i18nT("fermer_le_panneau_des_missions_c4ea1e1c")}
            />
          )}
          <aside
            id="inr-agent-robot-panel"
            className={`${styles.robotCard} ${robotPanelOpen ? styles.robotCardCompactOpen : styles.robotCardCompactClosed} ${scheduledEditSession ? styles.scheduledEditCard : ""}`}
            aria-label={i18nT(scheduledEditSession ? "scheduled_edit_aria" : "agent_operation_aria")}
          >
            <button
              type="button"
              className={styles.robotPanelToggle}
              onClick={() => setRobotPanelOpen((open) => !open)}
              aria-expanded={robotPanelOpen}
              aria-controls="inr-agent-robot-panel"
              title={i18nT(robotPanelOpen ? "collapse_missions" : "show_missions")}
            >
              <img
                src="/icons/inr-agent-header.png"
                alt=""
                aria-hidden
                width={30}
                height={30}
              />
              <span>{robotPanelOpen ? i18nT("missions_inr_agent_f8a40199") : i18nT("missions_323ea30c")}</span>
              <b aria-hidden>{robotPanelOpen ? "×" : "›"}</b>
            </button>
            {scheduledEditSession ? (
              <div className={styles.scheduledEditPanel}>
                <div className={styles.scheduledEditPanelIcon} aria-hidden>
                  <PencilActionIcon />
                </div>
                <span className={styles.scheduledEditEyebrow}>{i18nT("edition_temporaire_11a384a6")}</span>
                <h3>{i18nT("action_programmee_ea2709b8")}</h3>
                <p>
                  {i18nT("vous_modifiez_une_action_deja_confiee_810807e2")}{" "}</p>
                <div
                  className={`${styles.scheduledEditState} ${scheduledEditDirty ? styles.scheduledEditStateDirty : ""}`}
                >
                  {scheduledEditDirty
                    ? i18nT("modifications_non_sauvegardees_ffc636a4")
                    : i18nT("aucune_modification_pour_le_moment_909aff44")}
                </div>
                <small className={styles.scheduledEditHint}>
                  <span>{i18nT("valider_enregistrer_693dd897")}</span>
                  <span>{i18nT("refuser_supprimer_3811be52")}</span>
                </small>
                <button
                  type="button"
                  className={styles.scheduledEditQuitButton}
                  onClick={() => exitScheduledEditSession()}
                >
                  {i18nT("quitter_l_edition_08b3f0cb")}{" "}</button>
              </div>
            ) : (
              <>
                <div className={styles.robotHalo} aria-hidden>
                  <span className={styles.starOne} />
                  <span className={styles.starTwo} />
                  <span className={styles.starThree} />
                  <span className={styles.starFour} />
                  <span className={styles.starFive} />
                  <span className={styles.starSix} />
                  <span className={styles.starSeven} />
                  <span className={styles.starEight} />
                  <span className={styles.starNine} />
                  <img
                    src={ROBOT_SRC}
                    alt=""
                    width={824}
                    height={900}
                    loading="eager"
                    decoding="sync"
                    fetchPriority="high"
                  />
                </div>

                <ol className={styles.robotSteps}>
                  {selectedRobotSteps.map((_step, index) => (
                    <li key={`${selected.key}-step-${index + 1}`}>
                      <span>{index + 1}</span>
                      <strong>{agentAutomationStep(selected.key, index, runtimeT)}</strong>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </aside>

          <div className={styles.workColumn}>
            <section
              className={`${styles.previewCard} ${selected.key === "stats" || isCampaignView || isPublishView ? styles.previewCardNoFrame : ""}`}
              aria-label={i18nT("apercu_de_l_action_preparee_460ac719")}
            >
              <div className={styles.previewBody}>
                {selected.key === "stats" ? (
                  <div className={styles.statsPreview}>
                    <div className={styles.statsHeadCard}>
                      <span className={styles.statsHeadIcon} aria-hidden>
                        <AutomationIcon type="stats" />
                      </span>
                      <div className={styles.statsHeadCopy}>
                        <h3>{i18nT("votre_bilan_inr_stats_54abf82e")}</h3>
                        <p className={styles.statsLead}>
                          {i18nT("inr_agent_analyse_vos_donnees_et_9f6ccde7")}{" "}</p>
                      </div>
                    </div>

                    <div className={styles.statsTopGrid}>
                      <article
                        className={`${styles.statsMiniCard} ${styles.statsMiniCardGreen}`}
                      >
                        <div className={styles.statsMiniHead}>
                          <span className={styles.statsMiniIcon} aria-hidden>
                            <SparkSettingsIcon />
                          </span>
                          <small>{i18nT("automatisation_598357a3")}</small>
                        </div>
                        <strong>{statsAutomationLabel}</strong>
                      </article>
                      <article
                        className={`${styles.statsMiniCard} ${styles.statsMiniCardBlue}`}
                      >
                        <div className={styles.statsMiniHead}>
                          <span className={styles.statsMiniIcon} aria-hidden>
                            <CalendarMetaIcon />
                          </span>
                          <small>{i18nT("frequence_bafbfba7")}</small>
                        </div>
                        <strong>{statsFrequencyLabel}</strong>
                      </article>
                      <article
                        className={`${styles.statsMiniCard} ${styles.statsMiniCardViolet}`}
                      >
                        <div className={styles.statsMiniHead}>
                          <span className={styles.statsMiniIcon} aria-hidden>
                            <CalendarMetaIcon />
                          </span>
                          <small>{i18nT("prochain_bilan_e0efe16b")}</small>
                        </div>
                        <strong>{statsNextRunLabel}</strong>
                      </article>
                      <article
                        className={`${styles.statsMiniCard} ${styles.statsMiniCardSky}`}
                      >
                        <div className={styles.statsMiniHead}>
                          <span className={styles.statsMiniIcon} aria-hidden>
                            <SendPlaneIcon />
                          </span>
                          <small>{i18nT("dernier_bilan_93cd87ee")}</small>
                        </div>
                        <strong>{statsLastReportLabel}</strong>
                      </article>
                      <article
                        className={`${styles.statsMiniCard} ${styles.statsMiniCardPink}`}
                      >
                        <div className={styles.statsMiniHead}>
                          <span className={styles.statsMiniIcon} aria-hidden>
                            <ShieldLineIcon />
                          </span>
                          <small>{i18nT("bilans_conserves_c7633c3f")}</small>
                        </div>
                        <strong>{statsStoredCountLabel}</strong>
                      </article>
                    </div>

                    <section
                      className={styles.statsInsightCard}
                      aria-label={i18nT("dernieres_recommandations_inragent_b873f1c0")}
                    >
                      <div className={styles.statsInsightHeader}>
                        <span className={styles.statsInsightIcon} aria-hidden>
                          <SparkSettingsIcon />
                        </span>
                        <div className={styles.statsInsightCopy}>
                          <strong>{i18nT("dernieres_recommandations_inr_agent_2b60c8f9")}</strong>
                        </div>
                      </div>
                      {latestStatsRecommendations.length > 0 ? (
                        <ol className={styles.statsRecommendationList}>
                          {latestStatsRecommendations.map(
                            (recommendation, index) => (
                              <li key={`stats-recommendation-${index}`}>
                                <span>{index + 1}</span>
                                <p>{recommendation}</p>
                              </li>
                            ),
                          )}
                        </ol>
                      ) : (
                        <p className={styles.statsRecommendationEmpty}>
                          {i18nT("le_prochain_bilan_automatique_affichera_ici_ccda89e0")}{" "}</p>
                      )}
                    </section>

                    <div className={styles.statsHistorySection}>
                      <div className={styles.statsHistoryHeader}>
                        <h4>{i18nT("5_derniers_bilans_auto_e3296ab3")}</h4>
                      </div>
                      <div className={styles.statsHistoryRow}>
                        {Array.from({ length: 5 }).map((_, index) => {
                          const report = statsReports[index];
                          return report ? (
                            <a
                              key={report.id}
                              href={report.document.downloadUrl || "#"}
                              target="_blank"
                              rel="noreferrer"
                              className={styles.statsHistoryItem}
                              aria-label={i18nT("telecharger_le_bilan_du_value_954ac90e", { value0: formatMiniDateLabel(report.document.createdAt || report.completedAt || report.createdAt, locale) })}
                            >
                              <span
                                className={styles.statsHistoryIcon}
                                aria-hidden
                              >
                                <DownloadActionIcon />
                              </span>
                              <span className={styles.statsHistoryDate}>
                                <strong>
                                  {
                                    formatReportDateLabel(
                                      report.document.createdAt ||
                                        report.completedAt ||
                                        report.createdAt,
                                      locale,
                                    ).date
                                  }
                                </strong>
                                <small>
                                  {
                                    formatReportDateLabel(
                                      report.document.createdAt ||
                                        report.completedAt ||
                                        report.createdAt,
                                      locale,
                                    ).time
                                  }
                                </small>
                              </span>
                            </a>
                          ) : (
                            <div
                              key={`stats-empty-${index}`}
                              className={`${styles.statsHistoryItem} ${styles.statsHistoryItemEmpty}`}
                            >
                              <span
                                className={styles.statsHistoryIcon}
                                aria-hidden
                              >
                                <DownloadActionIcon />
                              </span>
                              <span className={styles.statsHistoryDate}>—</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : isCampaignView && campaignDisplayPreview ? (
                  <div
                    key={`${selectedPreparedAction?.id || selected.key}-campaign`}
                    className={`${styles.campaignPreview} ${!hasCampaignPreview ? styles.campaignPreviewEmpty : ""}`}
                  >
                    <div className={styles.campaignInfoGrid}>
                      <article
                        className={`${styles.campaignInfoCard} ${styles.campaignInfoTheme}`}
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <AutomationIcon type={selected.key} />
                        </span>
                        <span>
                          <small>{i18nT("rubrique_ef1b579b")}</small>
                          <strong>{campaignDisplayPreview.mission}</strong>
                        </span>
                      </article>
                      <button
                        type="button"
                        className={`${styles.campaignInfoCard} ${styles.campaignInfoRecipients}`}
                        onClick={() => setRecipientsPreviewOpen(true)}
                        disabled={
                          !hasCampaignPreview ||
                          campaignDisplayPreview.recipientsCount <= 0
                        }
                        title={
                          hasCampaignPreview
                            ? i18nT("view_recipients")
                            : i18nT("no_campaign_prepared")
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <SparkSettingsIcon />
                        </span>
                        <span>
                          <small>{i18nT("destinataires_51610ad7")}</small>
                          <strong>
                            {hasCampaignPreview
                              ? i18nT("value_contact_value_638ef1ed", { value0: campaignDisplayPreview.recipientsCount, value1: campaignDisplayPreview.recipientsCount > 1 ? "s" : "" })
                              : "—"}
                          </strong>
                        </span>
                        <span className={styles.campaignInfoEye} aria-hidden>
                          👁
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.campaignInfoCard} ${styles.campaignInfoMail}`}
                        onClick={openMailAccountEditor}
                        disabled={!hasCampaignPreview}
                        title={
                          hasCampaignPreview
                            ? i18nT("modifier_la_boite_d_envoi_a79d173b")
                            : i18nT("no_campaign_prepared")
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <SendPlaneIcon />
                        </span>
                        <span className={styles.campaignInfoText}>
                          <small>{i18nT("boite_d_envoi_8af123c1")}</small>
                          <strong className={styles.campaignInfoMailLabel}>
                            {campaignDisplayPreview.mailAccountLabel}
                          </strong>
                        </span>
                        <span className={styles.campaignInfoEye} aria-hidden>
                          👁
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.campaignInfoCard} ${styles.campaignInfoAttachment}`}
                        onClick={() => setAttachmentPreviewOpen(true)}
                        disabled={!hasCampaignPreview}
                        title={
                          hasCampaignPreview
                            ? i18nT("view_attachment")
                            : i18nT("no_campaign_prepared")
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <ImageMetaIcon />
                        </span>
                        <span>
                          <small>{i18nT("piece_jointe_2ecefd2c")}</small>
                          <strong>
                            {hasCampaignPreview
                              ? campaignAttachments.length > 0
                                ? campaignAttachments.length === 1
                                  ? campaignAttachments[0].name
                                  : i18nT("value_fichiers_0af8254f", { value0: campaignAttachments.length })
                                : i18nT("aucune_e8f88273")
                              : "—"}
                          </strong>
                        </span>
                        <span className={styles.campaignInfoEye} aria-hidden>
                          👁
                        </span>
                      </button>
                    </div>

                    <article className={styles.campaignMailCard}>
                      <div className={styles.campaignMailSubject}>
                        <span>{i18nT("objet_89673541")}</span>
                        <strong>{campaignDisplayPreview.subject}</strong>
                      </div>
                      <div className={styles.campaignMailContent}>
                        {campaignDisplayPreview.paragraphs.map(
                          (paragraph, index) => (
                            <p
                              key={`${selectedPreparedAction?.id || selected.key}-mail-paragraph-${index}`}
                            >
                              {renderRichInlineText(
                                paragraph,
                                `${selectedPreparedAction?.id || selected.key}-mail-paragraph-${index}`,
                              )}
                            </p>
                          ),
                        )}
                        {!hasCampaignPreview && (
                          <div className={styles.campaignEmptyHint}>
                            <span>
                              {actionsLoadState === "loading"
                                ? i18nT("recherche_des_actions_preparees_eb05a9af")
                                : i18nT("aucune_campagne_automatique_preparee_pour_le_27977b8d")}
                            </span>
                          </div>
                        )}
                      </div>
                    </article>
                  </div>
                ) : isPublishView ? (
                  <div
                    key={`${selectedPreparedAction?.id || selected.key}-${activePreviewChannel || "global"}-publish`}
                    className={`${styles.publishPreview} ${!selectedPreparedAction ? styles.publishPreviewEmpty : ""}`}
                  >
                    <div className={styles.publishInfoGrid}>
                      <article
                        className={`${styles.campaignInfoCard} ${styles.publishInfoChannel}`}
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <AutomationIcon type="publish" />
                        </span>
                        <span>
                          <small>{i18nT("canal_61f21e6f")}</small>
                          <strong>{activePreviewChannelLabel}</strong>
                        </span>
                      </article>
                      <button
                        type="button"
                        className={`${styles.campaignInfoCard} ${styles.publishInfoFormat}`}
                        onClick={openPublishTextEditor}
                        disabled={
                          !selectedPreparedAction ||
                          actionMutationState === "saving"
                        }
                        title={
                          selectedPreparedAction
                            ? i18nT("edit_content")
                            : i18nT("no_publication_prepared")
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <ImageMetaIcon />
                        </span>
                        <span>
                          <small>{i18nT("contenu_f3cb82af")}</small>
                          <strong>{publishContentKind}</strong>
                        </span>
                        <span className={styles.campaignInfoEye} aria-hidden>
                          👁
                        </span>
                      </button>
                      <button
                        type="button"
                        className={`${styles.campaignInfoCard} ${styles.publishInfoAttachment}`}
                        onClick={openPublishMediaEditor}
                        disabled={
                          !selectedPreparedAction ||
                          actionMutationState === "saving"
                        }
                        title={
                          selectedPreparedAction
                            ? i18nT("manage_media")
                            : i18nT("no_publication_prepared")
                        }
                      >
                        {publishMediaPreview?.items.length ? (
                          <span
                            className={styles.publishMediaInfoThumbs}
                            aria-hidden="true"
                          >
                            {publishMediaPreview.items
                              .slice(0, 3)
                              .map((media, index) => (
                                <span
                                  key={`${media.url}-${index}`}
                                  className={styles.publishMediaInfoThumb}
                                >
                                  {media.kind === "video" ? (
                                    <video
                                      src={media.url}
                                      muted
                                      playsInline
                                      preload="metadata"
                                    />
                                  ) : (
                                    <img src={media.url} alt="" />
                                  )}
                                </span>
                              ))}
                            {publishMediaPreview.items.length > 3 ? (
                              <em>+{publishMediaPreview.items.length - 3}</em>
                            ) : null}
                          </span>
                        ) : (
                          <span className={styles.campaignInfoIcon} aria-hidden>
                            <ImageMetaIcon />
                          </span>
                        )}
                        <span className={styles.publishMediaInfoText}>
                          <small>{i18nT("media_d8a313d3")}</small>
                          <strong>
                            {publishMediaPreview?.count
                              ? publishMediaPreview.typeLabel
                              : i18nT("aucun_b2ed82f1")}
                          </strong>
                        </span>
                        <span className={styles.campaignInfoEye} aria-hidden>
                          👁
                        </span>
                      </button>
                      <article
                        className={`${styles.campaignInfoCard} ${styles.publishInfoStatus}`}
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <ShieldLineIcon />
                        </span>
                        <span>
                          <small>{i18nT("statut_659499f3")}</small>
                          <strong className={publishStatusClass}>
                            {agentMediaStatusLabel(publishStatus.label, runtimeT)}
                          </strong>
                        </span>
                      </article>
                    </div>

                    <article className={styles.publishPostCard}>
                      <div className={styles.publishPostText}>
                        <div className={styles.publishTitleLine}>
                          <span>{i18nT("titre_d03e0c7c")}</span>
                          <strong>
                            {preparedChannelPreview?.title ||
                              selectedPreparedAction?.title ||
                              "—"}
                          </strong>
                        </div>
                        <div className={styles.publishPostContent}>
                          {publishParagraphs.length > 0 ? (
                            publishParagraphs.map((paragraph, index) => (
                              <p
                                key={`${selectedPreparedAction?.id || selected.key}-${activePreviewChannel || "global"}-publish-paragraph-${index}`}
                              >
                                {renderRichInlineText(
                                  paragraph,
                                  `${selectedPreparedAction?.id || selected.key}-${activePreviewChannel || "global"}-publish-paragraph-${index}`,
                                )}
                              </p>
                            ))
                          ) : selectedPreparedAction ? (
                            <p>
                              {renderRichInlineText(
                                selectedPreparedAction.summary,
                                `${selectedPreparedAction.id}-publish-summary`,
                              )}
                            </p>
                          ) : (
                            <div className={styles.publishEmptyHint}>
                              <strong>
                                {i18nT("aucune_publication_automatique_preparee_pour_le_a48148f5")}{" "}</strong>
                              <span>
                                {i18nT("le_futur_contenu_du_canal_selectionne_1b1512d5")}{" "}</span>
                            </div>
                          )}
                          {preparedChannelPreview?.hashtags.length ? (
                            <small className={styles.previewHashtags}>
                              {preparedChannelPreview.hashtags
                                .map(
                                  (hashtag) => `#${hashtag.replace(/^#+/, "")}`,
                                )
                                .join(" ")}
                            </small>
                          ) : null}
                        </div>
                        <div className={styles.publishCtaLine}>
                          <span>{i18nT("cta_4f4f1f7e")}</span>
                          <strong>{publishCtaLine}</strong>
                        </div>
                      </div>
                    </article>
                  </div>
                ) : hasPreparedAction && selectedPreparedAction ? (
                  <div
                    key={`${selectedPreparedAction.id}-${activePreviewChannel || "global"}`}
                    className={styles.preparedPreview}
                  >
                    {preparedImageUrl ? (
                      <div className={styles.previewImageWrap}>
                        <img
                          src={preparedImageUrl}
                          alt={imageAssetAlt(preparedImage)}
                          loading="eager"
                          decoding="sync"
                        />
                      </div>
                    ) : (
                      <div className={styles.previewImageFallback}>
                        <ImageMetaIcon />
                        <span>{i18nT("aucune_image_obligatoire_pour_cette_action_775a4d75")}</span>
                      </div>
                    )}
                    <div className={styles.previewText}>
                      <div className={styles.previewBadgeRow}>
                        <span>{i18nT("apercu_value_a6963b7d", { value0: activePreviewChannelLabel })}</span>
                        <span>
                          {
                            agentActionTypeLabel(selectedPreparedAction.actionType, runtimeT)
                          }
                        </span>
                        <span>
                          {
                            agentToolLabel(selectedPreparedAction.targetTool, runtimeT)
                          }
                        </span>
                        <span>
                          {
                            agentActionStatusLabel(selectedPreparedAction.status, runtimeT)
                          }
                        </span>
                      </div>
                      <h3>
                        {preparedChannelPreview?.title ||
                          selectedPreparedAction.title}
                      </h3>
                      {preparedParagraphs.length > 0 ? (
                        preparedParagraphs.map((paragraph, index) => (
                          <p
                            key={`${selectedPreparedAction.id}-${activePreviewChannel || "global"}-paragraph-${index}`}
                          >
                            {renderRichInlineText(
                              paragraph,
                              `${selectedPreparedAction.id}-${activePreviewChannel || "global"}-paragraph-${index}`,
                            )}
                          </p>
                        ))
                      ) : (
                        <p>
                          {renderRichInlineText(
                            selectedPreparedAction.summary,
                            `${selectedPreparedAction.id}-summary`,
                          )}
                        </p>
                      )}
                      {preparedChannelPreview?.cta && (
                        <small className={styles.previewCta}>
                          {i18nT("appel_a_l_action_value_fae849c7", { value0: preparedChannelPreview.cta })}</small>
                      )}
                      {preparedChannelPreview?.hashtags.length ? (
                        <small className={styles.previewHashtags}>
                          {preparedChannelPreview.hashtags
                            .map((hashtag) => `#${hashtag.replace(/^#+/, "")}`)
                            .join(" ")}
                        </small>
                      ) : null}
                      {targetThemesLabel(selectedPreparedAction) && (
                        <small className={styles.previewTheme}>
                          {i18nT("theme_value_d32c52da", { value0: agentThemeListLabel(targetThemesLabel(selectedPreparedAction).split(/\s*·\s*/), runtimeT, locale) })}</small>
                      )}
                      {preparedRecipientsCount > 0 && (
                        <small className={styles.previewRecipients}>
                          {i18nT("destinataires_proposes_234d5404")}{" "}{preparedRecipientsCount}{" "}
                          {i18nT("contact_1a73af9e")}{preparedRecipientsCount > 1 ? "s" : ""} {" "}{i18nT("crm_2a13d05e")}{" "}</small>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyPreview}>
                    <span className={styles.emptyOrb} aria-hidden>
                      <AutomationIcon type={selected.key} />
                    </span>
                    <h3>{i18nT("aucune_action_preparee_a9b0fde0")}</h3>
                    <p>
                      {i18nT("quand_inr_agent_aura_prepare_la_3fc7b740")}{" "}</p>
                    <small>
                      {actionsLoadState === "loading"
                        ? i18nT("recherche_des_actions_preparees_eb05a9af")
                        : i18nT("automatisation_selectionnee_value_f18fd4cc", { value0: selected.title })}
                    </small>
                  </div>
                )}
              </div>

              <div
                className={`${styles.previewMeta} ${selected.key === "stats" ? styles.previewMetaStats : ""} ${isCampaignView ? styles.previewMetaCampaign : ""} ${isPublishView ? styles.previewMetaPublish : ""}`}
              >
                <div className={`${styles.metaItem} ${styles.channelsItem}`}>
                  <small>
                    {selected.key === "stats"
                      ? i18nT("sources_57811207")
                      : isCampaignView
                        ? i18nT("canal_61f21e6f")
                        : isPublishView
                          ? i18nT("canaux_27cb4473")
                          : i18nT("canaux_b38e5b69")}
                  </small>
                  <div
                    className={`${styles.channelScrollerWrap} ${isPublishView ? styles.channelScrollerWrapPublish : ""}`}
                  >
                    {isPublishView && displayChannels.length > 1 && (
                      <button
                        type="button"
                        className={styles.channelNavArrow}
                        onClick={() => movePreviewChannel(-1)}
                        disabled={previewNavigationChannels.length < 2}
                        aria-label={i18nT("afficher_le_canal_precedent_777ef8f0")}
                        title={i18nT("canal_precedent_e644dfdf")}
                      >
                        ‹
                      </button>
                    )}
                    <div className={styles.channelScroller}>
                      {selected.key === "stats" &&
                      selectedStatsRubriques.length > 0 ? (
                        selectedStatsRubriques.map((theme) => {
                          const rubrique = statsRubriqueOptions[theme];
                          return (
                            <button
                              type="button"
                              key={theme}
                              data-channel={
                                rubrique.channelKey ||
                                (theme === "Vue globale"
                                  ? "stats-global"
                                  : theme === "iNrBadge"
                                    ? "inrbadge"
                                    : "stats")
                              }
                              disabled
                              aria-label={rubrique.channelKey ? agentChannelLabel(rubrique.channelKey, runtimeT) : agentThemeLabel(theme, runtimeT)}
                              title={rubrique.channelKey ? agentChannelLabel(rubrique.channelKey, runtimeT) : agentThemeLabel(theme, runtimeT)}
                            >
                              <img
                                src={rubrique.src}
                                alt=""
                                loading="eager"
                                decoding="sync"
                                aria-hidden
                              />
                            </button>
                          );
                        })
                      ) : isCampaignView ? (
                        <span
                          className={styles.campaignMailPill}
                          title={i18nT("mails_8d79d3a8")}
                          aria-label={i18nT("canal_mails_0ad3f96c")}
                        >
                          <img
                            src={channelOptions.mails.src}
                            alt=""
                            loading="eager"
                            decoding="sync"
                            aria-hidden
                          />
                        </span>
                      ) : displayChannels.length > 0 ? (
                        displayChannels.map((channelKey) => {
                          const channel = channelOptions[channelKey];
                          const selectableChannel =
                            !isPublishView ||
                            selectablePreviewChannels.includes(channelKey);
                          const activeChannel =
                            selectableChannel &&
                            channelKey === activePreviewChannel;
                          const channelClassName = [
                            activeChannel ? styles.channelPillActive : "",
                            isPublishView && !selectableChannel
                              ? styles.channelPillMuted
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ");
                          return (
                            <button
                              type="button"
                              key={channelKey}
                              data-channel={channelKey}
                              className={channelClassName || undefined}
                              disabled={!selectableChannel}
                              onClick={() => {
                                if (selectableChannel)
                                  selectPreviewChannel(channelKey);
                              }}
                              aria-label={i18nT(selectableChannel ? "show_channel_preview" : "channel_deselected", { channel: agentChannelLabel(channelKey, runtimeT) })}
                              title={selectableChannel ? agentChannelLabel(channelKey, runtimeT) : i18nT("channel_deselected", { channel: agentChannelLabel(channelKey, runtimeT) })}
                            >
                              <img
                                src={channel.src}
                                alt=""
                                loading="eager"
                                decoding="sync"
                                aria-hidden
                              />
                            </button>
                          );
                        })
                      ) : (
                        <strong>—</strong>
                      )}
                    </div>
                    {isPublishView && displayChannels.length > 1 && (
                      <button
                        type="button"
                        className={styles.channelNavArrow}
                        onClick={() => movePreviewChannel(1)}
                        disabled={previewNavigationChannels.length < 2}
                        aria-label={i18nT("afficher_le_canal_suivant_4802e0ec")}
                        title={i18nT("canal_suivant_d20db274")}
                      >
                        ›
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`${styles.metaItem} ${styles.dateItem}`}
                  title={i18nT(selected.key === "stats" ? "next_automatic_report" : "scheduled_date")}
                >
                  <span className={styles.metaIcon} aria-hidden>
                    <CalendarMetaIcon />
                  </span>
                  <span>
                    <strong>{footerDateLabel}</strong>
                  </span>
                </div>
                {selected.key === "stats" ? (
                  <div className={styles.statsFooterNote}>
                    <small>{i18nT("validation_non_requise_72a87029")}</small>
                  </div>
                ) : (
                  <>
                    {(isCampaignView || isPublishView) && (
                      <button
                        type="button"
                        className={styles.saveCampaignDraftButton}
                        aria-label={
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                            ? i18nT("saving_in_progress")
                            : isPublishView
                              ? i18nT("draft_save_publication_aria")
                              : i18nT("draft_save_campaign_aria")
                        }
                        title={
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                            ? i18nT("saving_in_progress")
                            : isPublishView
                              ? i18nT("enregistrer_f7c8bcd8")
                              : i18nT("save_campaign")
                        }
                        data-tooltip={
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                            ? i18nT("saving_in_progress")
                            : isPublishView
                              ? i18nT("enregistrer_f7c8bcd8")
                              : i18nT("save_campaign")
                        }
                        aria-busy={
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                        }
                        disabled={
                          !hasPreparedAction ||
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                        }
                        onClick={() => {
                          setCampaignDraftConfirmOpen(true);
                        }}
                      >
                        <span aria-hidden>
                          {actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                            ? "…"
                            : "💾"}
                        </span>
                        {actionMutationState === "saving" ||
                        campaignDraftSaveState === "saving"
                          ? i18nT("enregistrement_e7d5f232")
                          : i18nT("enregistrer_f7c8bcd8")}
                      </button>
                    )}
                    {(isCampaignView || isPublishView) && (
                      <button
                        type="button"
                        className={styles.modifyCampaignButton}
                        aria-label={
                          isPublishView
                            ? i18nT("modifier_la_publication_295870a4")
                            : i18nT("modifier_la_campagne_cb246f76")
                        }
                        title={
                          isPublishView
                            ? i18nT("modifier_f260e757")
                            : i18nT("modifier_la_campagne_cb246f76")
                        }
                        data-tooltip={
                          isPublishView
                            ? i18nT("modifier_f260e757")
                            : i18nT("modifier_la_campagne_cb246f76")
                        }
                        disabled={
                          !hasPreparedAction || actionMutationState === "saving"
                        }
                        onClick={() => {
                          if (isCampaignView) {
                            setCampaignEditOpen(true);
                            return;
                          }
                          setPublishEditChoiceOpen(true);
                        }}
                      >
                        <span aria-hidden>✎</span>
                        {i18nT("modifier_f260e757")}{" "}</button>
                    )}
                    <div className={styles.previewActions}>
                      {actionMutationState === "saving" ? (
                        <button
                          type="button"
                          className={`${styles.actionProcessingButton} ${
                            actionMutationIntent === "refused"
                              ? styles.actionProcessingButtonRefused
                              : styles.actionProcessingButtonValidated
                          }`}
                          disabled
                          aria-live="polite"
                          aria-busy="true"
                        >
                          <span
                            className={styles.actionProcessingSpinner}
                            aria-hidden
                          />
                          {actionMutationIntent === "refused"
                            ? i18nT("refus_en_cours_6be9a897")
                            : i18nT("validation_en_cours_25be85c2")}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={styles.validateButton}
                            disabled={!hasPreparedAction}
                            onClick={() => {
                              if (scheduledEditSession) {
                                void updateActionStatus("validated");
                                return;
                              }
                              if (
                                canSchedulePreparedAction(selectedPreparedAction)
                              ) {
                                setValidationChoiceOpen(true);
                              } else {
                                void updateActionStatus("validated");
                              }
                            }}
                          >
                            <span aria-hidden>
                              <ValidateActionIcon />
                            </span>
                            {i18nT("valider_be4220f7")}{" "}</button>
                          <button
                            type="button"
                            className={styles.refuseButton}
                            disabled={!hasPreparedAction}
                            onClick={() => updateActionStatus("refused")}
                          >
                            <span aria-hidden>
                              <RefuseActionIcon />
                            </span>
                            {i18nT("refuser_62897154")}{" "}</button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>
          </div>
        </div>
      </section>

      <PublishEditChoiceModal
        open={publishEditChoiceOpen}
        isPublishView={isPublishView}
        hasPreparedAction={Boolean(selectedPreparedAction)}
        mediaName={
          publishMediaPreview?.count ? publishMediaPreview.typeLabel : undefined
        }
        onClose={() => setPublishEditChoiceOpen(false)}
        onOpenText={openPublishTextEditor}
        onOpenMedia={openPublishMediaEditor}
      />

      {publishEditOpen && selectedPreparedAction && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => {
            if (publishSaveState !== "saving") setPublishEditOpen(false);
          }}
        >
          <section
            className={`${styles.settingsModal} ${styles.publishTextModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("modifier_la_publication_295870a4")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPublishEditOpen(false)}
              aria-label={i18nT("fermer_5ab4ec64")}
              disabled={publishSaveState === "saving"}
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>{i18nT("publication_inr_agent_62b957d7")}</p>
            <h2>
              {i18nT("modifier_f260e757")}{" "}
              {publishTextDraft.channel
                ? channelOptions[publishTextDraft.channel]?.name
                : i18nT("le_canal_50b13add")}
            </h2>
            <label className={styles.mailTextField}>
              <span>{i18nT("titre_eb97899a")}</span>
              <input
                value={publishTextDraft.title}
                onChange={(event) =>
                  setPublishTextDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                maxLength={180}
                placeholder={i18nT("titre_de_la_publication_ee8fb585")}
              />
            </label>
            <label className={styles.mailTextField}>
              <span>{i18nT("contenu_f3cb82af")}</span>
              <div
                className={styles.richTextToolbar}
                aria-label={i18nT("mise_en_forme_du_contenu_78829a8e")}
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPublishTextFormat("bold")}
                  title={i18nT("gras_bd63d1e9")}
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPublishTextFormat("italic")}
                  title={i18nT("italique_023eb97e")}
                >
                  <em>I</em>
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPublishTextFormat("underline")}
                  title={i18nT("souligne_591b8563")}
                >
                  <span className={styles.underlineToolbarLabel}>U</span>
                </button>
                <EmojiPickerButton
                  onBeforeOpen={() =>
                    saveRichEditorSelection(
                      publishBodyEditorRef.current,
                      publishEmojiSelectionRef,
                    )
                  }
                  onSelect={insertPublishEmoji}
                />
              </div>
              <RichSiteContentEditor
                value={publishTextDraft.body}
                onChange={(value) =>
                  setPublishTextDraft((current) => ({
                    ...current,
                    body: value.slice(0, 6000),
                  }))
                }
                minHeight={260}
                editorRef={publishBodyEditorRef}
                className={styles.richTextEditorSurface}
                style={AGENT_RICH_TEXT_EDITOR_STYLE}
              />
            </label>
            <div
              className={`${styles.mailTextField} ${styles.publishCtaEditor}`}
            >
              <span>{i18nT("cta_11441d32")}</span>
              {(() => {
                const displayKey = boosterDisplayKeyFromAgentChannel(
                  publishTextDraft.channel,
                );
                const currentPost: BoosterChannelPost = {
                  title: publishTextDraft.title,
                  content: publishTextDraft.body,
                  cta: publishTextDraft.cta,
                  ctaMode: publishTextDraft.ctaMode,
                  ctaUrl: publishTextDraft.ctaUrl,
                  ctaPhone: publishTextDraft.ctaPhone,
                  hashtags: publishTextDraft.hashtags
                    .split(/[\s,;]+/)
                    .filter(Boolean),
                };
                const ctaChoice = getPreferredCtaChoiceFromPost(
                  displayKey,
                  currentPost,
                );
                const activeWebsiteUrl = getWebsiteUrlForChannel(
                  displayKey,
                  publishCtaDefaults,
                );
                const activeWebsiteSourceLabel =
                  getLocalizedWebsiteSourceLabelForChannel(
                    displayKey,
                    publishCtaDefaults,
                    boosterRuntimeT,
                  );
                const websiteChoices = [
                  publishCtaDefaults?.inrcySiteUrl
                    ? {
                        label: i18nT("site_inrcy_57016d6f"),
                        url: publishCtaDefaults.inrcySiteUrl,
                      }
                    : null,
                  publishCtaDefaults?.siteWebUrl
                    ? { label: i18nT("site_web_7e78af33"), url: publishCtaDefaults.siteWebUrl }
                    : null,
                ].filter(Boolean) as Array<{ label: string; url: string }>;
                const ctaMode = publishTextDraft.ctaMode || "none";
                return (
                  <>
                    <div className={styles.publishCtaGrid} data-mode={ctaMode}>
                      <label>
                        <span>{i18nT("bouton_fd5aea71")}</span>
                        <select
                          value={ctaChoice}
                          onChange={(event) =>
                            applyPublishPreferredCta(
                              event.target.value as BoosterPreferredCta,
                            )
                          }
                        >
                          {BOOSTER_PREFERRED_CTA_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {getLocalizedPreferredCtaLabel(
                                option.value,
                                boosterRuntimeT,
                              )}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(ctaMode === "website" || ctaMode === "custom") && (
                        <label>
                          <span>{i18nT("url_de_destination_f11980ae")}</span>
                          <input
                            value={publishTextDraft.ctaUrl}
                            onChange={(event) =>
                              updatePublishCtaDraft({
                                ctaUrl: event.target.value,
                              })
                            }
                            maxLength={320}
                            placeholder={
                              activeWebsiteUrl
                                ? i18nT("website_prefilled_placeholder", {
                                    source: activeWebsiteSourceLabel,
                                  })
                                : websiteChoices.length > 1
                                  ? i18nT("website_choice_placeholder")
                                  : i18nT("website_optional_placeholder")
                            }
                          />
                          {ctaMode === "website" &&
                            websiteChoices.length > 0 && (
                              <div className={styles.publishCtaQuickChoices}>
                                {websiteChoices.map((choice) => (
                                  <button
                                    key={choice.label}
                                    type="button"
                                    onClick={() =>
                                      updatePublishCtaDraft({
                                        ctaUrl: choice.url,
                                      })
                                    }
                                    className={
                                      publishTextDraft.ctaUrl === choice.url
                                        ? styles.publishCtaQuickChoiceActive
                                        : ""
                                    }
                                  >
                                    {choice.label}
                                  </button>
                                ))}
                              </div>
                            )}
                        </label>
                      )}

                      {(ctaMode === "website" || ctaMode === "custom") && (
                        <label>
                          <span>{i18nT("texte_du_bouton_5bc213b4")}</span>
                          <input
                            value={publishTextDraft.cta}
                            onChange={(event) =>
                              updatePublishCtaDraft({ cta: event.target.value })
                            }
                            maxLength={180}
                            placeholder={
                              ctaMode === "custom"
                                ? i18nT("cta_custom_placeholder")
                                : i18nT("cta_quote_placeholder")
                            }
                          />
                        </label>
                      )}

                      {ctaMode === "call" && (
                        <label>
                          <span>{i18nT("telephone_d3b023ea")}</span>
                          <input
                            value={publishTextDraft.ctaPhone}
                            onChange={(event) =>
                              updatePublishCtaDraft({
                                ctaPhone: event.target.value,
                              })
                            }
                            maxLength={40}
                            placeholder={
                              publishCtaDefaults?.phone
                                ? i18nT("phone_prefilled_placeholder")
                                : i18nT("telephone_d3b023ea")
                            }
                          />
                        </label>
                      )}
                    </div>
                    <small className={styles.publishCtaHelp}>
                      {getLocalizedCtaModeHelp(
                        displayKey,
                        ctaMode,
                        boosterRuntimeT,
                      )}
                    </small>
                    {ctaMode === "website" && activeWebsiteUrl && (
                      <small className={styles.publishCtaHelp}>
                        {i18nT("valeur_par_defaut_disponible_depuis_26881dec")}{" "}
                        {activeWebsiteSourceLabel.toLowerCase()} :{" "}
                        {activeWebsiteUrl}
                      </small>
                    )}
                    {ctaMode === "call" && publishCtaDefaults?.phone && (
                      <small className={styles.publishCtaHelp}>
                        {i18nT("valeur_par_defaut_disponible_depuis_mon_841d60a8")}{" "}
                        {publishCtaDefaults.phone}
                      </small>
                    )}
                  </>
                );
              })()}
            </div>
            {channelSupportsHashtags(publishTextDraft.channel || null) && (
              <label className={styles.mailTextField}>
                <span>{i18nT("hashtags_338da6e1")}</span>
                <input
                  value={publishTextDraft.hashtags}
                  onChange={(event) =>
                    setPublishTextDraft((current) => ({
                      ...current,
                      hashtags: event.target.value,
                    }))
                  }
                  maxLength={280}
                  placeholder={i18nT("communication_local_0f75c043")}
                />
              </label>
            )}
            <p className={styles.campaignEditHint}>
              {i18nT("la_modification_s_applique_uniquement_au_ad6a3c95")}{" "}</p>
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPublishEditOpen(false)}
                disabled={publishSaveState === "saving"}
              >
                {i18nT("annuler_49ba3292")}{" "}</button>
              <button
                type="button"
                onClick={savePublishText}
                disabled={publishSaveState === "saving"}
              >
                {publishSaveState === "saving"
                  ? i18nT("enregistrement_9bf1058a")
                  : i18nT("enregistrer_f7c8bcd8")}
              </button>
            </div>
          </section>
        </div>
      )}

      <CampaignDraftConfirmModal
        open={campaignDraftConfirmOpen}
        isPublishView={isPublishView}
        campaignMailPreview={campaignMailPreview}
        selectedAutomationKey={selected.key}
        previewNavigationChannels={previewNavigationChannels}
        selectedConfigChannels={selectedConfigChannels}
        publishContentKind={publishContentKind}
        saveState={campaignDraftSaveState}
        onClose={() => setCampaignDraftConfirmOpen(false)}
        onSavePublish={savePublishAsDraft}
        onSaveCampaign={saveCampaignAsDraft}
      />

      <CampaignEditChoiceModal
        open={campaignEditOpen}
        preview={campaignMailPreview}
        attachmentCount={campaignAttachments.length}
        onClose={() => setCampaignEditOpen(false)}
        onOpenText={openMailTextEditor}
        onOpenAttachments={() => {
          setCampaignEditOpen(false);
          setAttachmentPreviewOpen(true);
        }}
        onOpenRecipients={() => {
          setCampaignEditOpen(false);
          setRecipientsPreviewOpen(true);
        }}
        onOpenMailAccount={openMailAccountEditor}
      />

      <CampaignMailTextModal
        open={mailTextEditOpen}
        preview={campaignMailPreview}
        draft={campaignTextDraft}
        editorRef={campaignBodyEditorRef}
        saveState={campaignSaveState}
        onClose={() => setMailTextEditOpen(false)}
        onSubjectChange={(subject) =>
          setCampaignTextDraft((current) => ({ ...current, subject }))
        }
        onBodyChange={(body) =>
          setCampaignTextDraft((current) => ({ ...current, body }))
        }
        onFormat={applyCampaignTextFormat}
        onBeforeEmojiOpen={() =>
          saveRichEditorSelection(
            campaignBodyEditorRef.current,
            campaignEmojiSelectionRef,
          )
        }
        onEmojiSelect={insertCampaignEmoji}
        onSave={saveCampaignText}
      />

      <RecipientsPreviewModal
        open={recipientsPreviewOpen}
        preview={campaignMailPreview}
        recipients={campaignRecipients}
        onClose={() => setRecipientsPreviewOpen(false)}
        onEdit={openRecipientsEditor}
      />

      <RecipientsPickerModal
        open={recipientsEditOpen}
        preview={campaignMailPreview}
        manualRecipientsInput={manualRecipientsInput}
        manualSelectedRecipientEmails={manualSelectedRecipientEmails}
        crmSearch={crmRecipientSearch}
        filtersOpen={crmRecipientFiltersOpen}
        activeFiltersCount={activeCrmRecipientFiltersCount}
        category={crmRecipientCategory}
        contactType={crmRecipientType}
        department={crmRecipientDepartment}
        importantOnly={crmRecipientImportantOnly}
        filteredContacts={filteredCrmContacts}
        filteredAllSelected={filteredCrmAllSelected}
        contactsLoading={crmContactsLoading}
        selectedRecipientEmails={selectedRecipientEmails}
        newRecipientOpen={newRecipientOpen}
        newRecipientDraft={newRecipientDraft}
        newRecipientState={newRecipientState}
        saveState={campaignSaveState}
        onClose={() => setRecipientsEditOpen(false)}
        onManualRecipientsChange={setManualRecipientsInput}
        onAddManualRecipients={addManualRecipientsFromInput}
        onRemoveSelectedRecipient={removeSelectedRecipient}
        onSearchChange={setCrmRecipientSearch}
        onToggleFilters={() =>
          setCrmRecipientFiltersOpen((current) => !current)
        }
        onToggleFiltered={toggleFilteredCrmRecipients}
        onToggleNewRecipient={() =>
          setNewRecipientOpen((current) => !current)
        }
        onCategoryChange={setCrmRecipientCategory}
        onContactTypeChange={setCrmRecipientType}
        onDepartmentChange={(value) =>
          setCrmRecipientDepartment(sanitizeDepartmentFilter(value))
        }
        onToggleImportantOnly={() =>
          setCrmRecipientImportantOnly((current) => !current)
        }
        onNewRecipientNameChange={(name) =>
          setNewRecipientDraft((current) => ({ ...current, name }))
        }
        onNewRecipientEmailChange={(email) =>
          setNewRecipientDraft((current) => ({ ...current, email }))
        }
        onAddNewRecipient={addNewRecipientToCrm}
        onToggleRecipient={toggleRecipientSelection}
        onSave={saveCampaignRecipients}
      />

      <MailAccountEditModal
        open={mailAccountEditOpen}
        preview={campaignMailPreview}
        accounts={mailAccounts}
        loading={mailAccountsLoading}
        selectedAccountId={selectedMailAccountId}
        saveState={campaignSaveState}
        onSelect={setSelectedMailAccountId}
        onClose={() => setMailAccountEditOpen(false)}
        onSave={saveCampaignMailAccount}
      />

      <MediaOptimizerModal
        open={Boolean(mediaOptimizerRequest)}
        sourceFile={
          mediaOptimizerRequest?.source.kind === "file"
            ? mediaOptimizerRequest.source.file
            : null
        }
        sourceItem={
          mediaOptimizerRequest?.source.kind === "library"
            ? mediaOptimizerRequest.source.item
            : null
        }
        origin={
          mediaOptimizerRequest?.destination === "campaign"
            ? "email"
            : "booster"
        }
        onClose={closeMediaOptimizer}
        onOptimized={handleOptimizedAgentMedia}
      />

      <AttachmentModal
        open={attachmentPreviewOpen}
        preview={campaignMailPreview}
        attachments={campaignAttachments}
        uploadState={attachmentUploadState}
        libraryPickerOpen={campaignMediaLibraryPickerOpen}
        onClose={() => setAttachmentPreviewOpen(false)}
        onFilesSelected={(files) => void uploadCampaignAttachment(files)}
        onOpenLibrary={() => setCampaignMediaLibraryPickerOpen(true)}
        onCloseLibrary={() => setCampaignMediaLibraryPickerOpen(false)}
        onConfirmLibrary={async (items) => {
          await addCampaignAttachmentsFromMediaLibrary(items);
        }}
        maxAttachmentBytes={MEDIA_LIBRARY_EMAIL_TARGET_BYTES}
        onOpenOptimizer={(item) =>
          openMediaOptimizerForLibraryItem(item, "campaign")
        }
        onOversizedMedia={(item) =>
          openMediaOptimizerForLibraryItem(item, "campaign")
        }
        onRemove={removeCampaignAttachment}
      />

      {publishMediaPreviewOpen && isPublishView && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => {
            if (publishMediaUploadState !== "saving")
              setPublishMediaPreviewOpen(false);
          }}
        >
          <section
            className={`${styles.settingsModal} ${styles.publishMediaModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("media_de_la_publication_82477994")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPublishMediaPreviewOpen(false)}
              aria-label={i18nT("fermer_5ab4ec64")}
              disabled={publishMediaUploadState === "saving"}
            >
              ×
            </button>
            <div className={styles.publishMediaModalHeader}>
              <div>
                <p className={styles.modalEyebrow}>{i18nT("media_inr_agent_75389c98")}</p>
                <h2>{i18nT("gerer_le_media_value_be737c89", { value0: activePreviewChannelLabel })}</h2>
                <span>
                  {i18nT("choisissez_ajoutez_remplacez_ou_preparez_le_ff06dd03")}{" "}</span>
              </div>
              <div
                className={`${styles.publishMediaStatusPill} ${
                  publishMediaPreview?.statusTone === "blocked"
                    ? styles.publishMediaStatusBlocked
                    : publishMediaPreview?.statusTone === "warning"
                      ? styles.publishMediaStatusWarning
                      : publishMediaPreview?.statusTone === "ready"
                        ? styles.publishMediaStatusReady
                        : ""
                }`}
              >
                {publishMediaPreview?.statusLabel || "—"}
              </div>
            </div>

            <div className={styles.publishMediaHero}>
              <div className={styles.publishMediaVisual}>
                {publishMediaPreview?.url ? (
                  publishMediaPreview.kind === "video" ? (
                    <video
                      src={publishMediaPreview.url}
                      controls
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={publishMediaPreview.url}
                      alt={
                        publishMediaPreview.name ||
                        i18nT("publication_media_alt")
                      }
                    />
                  )
                ) : (
                  <div className={styles.publishMediaEmpty}>
                    <span aria-hidden>🖼️</span>
                    <strong>{i18nT("aucun_media_selectionne_cbc78904")}</strong>
                  </div>
                )}
              </div>
              <div className={styles.publishMediaCurrentText}>
                <span className={styles.publishMediaTypeChip}>
                  {publishMediaPreview?.typeLabel || i18nT("media_d8a313d3")}
                </span>
                <strong>{publishMediaPreview?.name || i18nT("aucun_media_c1858e25")}</strong>
                <small>
                  {publishMediaPreview?.note ||
                    i18nT("ajoutez_une_image_ou_une_video_d7497a12")}
                </small>
                {publishMediaAdaptationPreview?.userEditable &&
                publishMediaPreview?.url ? (
                  <button
                    type="button"
                    className={styles.publishMediaRetouchButton}
                    onClick={openPublishMediaAdapterPreview}
                    disabled={publishMediaUploadState === "saving"}
                  >
                    <span aria-hidden>{publishMediaRetouchIcon}</span>
                    {publishMediaRetouchLabel}
                  </button>
                ) : (
                  <div className={styles.publishMediaRetouchHint}>
                    <span aria-hidden>✨</span>
                    {i18nT("ajoutez_un_media_pour_pouvoir_l_f137cd89")}{" "}</div>
                )}
              </div>
            </div>

            {publishMediaPreview && publishMediaPreview.items.length > 1 ? (
              <div
                className={styles.publishMediaGallery}
                role="list"
                aria-label={i18nT("medias_value_508589dd", { value0: activePreviewChannelLabel })}
              >
                {publishMediaPreview.items.map((item, index) => (
                  <button
                    key={`${item.url}-${index}`}
                    type="button"
                    role="listitem"
                    className={`${styles.publishMediaGalleryItem} ${
                      index === publishMediaPreview.activeIndex
                        ? styles.publishMediaGalleryItemActive
                        : ""
                    }`}
                    onClick={() => setPublishMediaActiveIndex(index)}
                    disabled={publishMediaUploadState === "saving"}
                    aria-label={i18nT("afficher_l_image_value_sur_value_516cb86d", { value0: index + 1, value1: publishMediaPreview.items.length })}
                  >
                    {item.kind === "video" ? (
                      <video src={item.url} muted preload="metadata" />
                    ) : (
                      <img
                        src={item.url}
                        alt={
                          item.name ||
                          i18nT("image_number_alt", { number: index + 1 })
                        }
                      />
                    )}
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className={styles.publishMediaAdaptationBox}>
              <div>
                <strong>{i18nT("adaptation_du_canal_1af8dcef")}</strong>
                <span>
                  {publishMediaAdaptationPreview?.note ||
                    i18nT("inragent_preparera_le_media_selon_les_c6452f9f")}
                </span>
              </div>
              <small>
                {i18nT("utilisez_l_outil_d_adaptation_inrcy_e92f2a66")}{" "}</small>
            </div>

            <div className={styles.publishMediaSourcePanel}>
              <div className={styles.publishMediaSourceHeader}>
                <strong>{i18nT("ajouter_ou_remplacer_9e1561b3")}</strong>
                <span>
                  {publishMediaPreview?.kind === "image"
                    ? publishImageLimitReached
                      ? i18nT("media_images_saved_max", {
                          count: publishImageCount,
                          max: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
                        })
                      : publishImageCount === 1
                        ? i18nT("media_image_saved_channel", {
                            count: publishImageCount,
                            max: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
                          })
                        : i18nT("media_images_saved_channel", {
                            count: publishImageCount,
                            max: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
                          })
                    : publishMediaPreview?.kind === "video"
                      ? i18nT("video_preparee_pour_ce_canal_4350728f")
                      : i18nT("media_enregistre_pour_ce_canal_a6dcb15c")}
                </span>
              </div>
              <input
                id="agent-publish-media-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  void uploadPublishMedia(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                disabled={
                  publishMediaUploadState === "saving" ||
                  publishImageLimitReached
                }
              />
              <input
                id="agent-publish-media-video"
                type="file"
                accept={AGENT_VIDEO_OPTIMIZER_ACCEPT}
                onChange={(event) => {
                  void uploadPublishMedia(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                disabled={publishMediaUploadState === "saving"}
              />
              <input
                id="agent-publish-media-camera"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  void uploadPublishMedia(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
                disabled={
                  !isMobileHeader ||
                  publishMediaUploadState === "saving" ||
                  publishImageLimitReached
                }
              />
              <div className={styles.publishMediaActionButtons}>
                <label
                  htmlFor={
                    publishImageLimitReached
                      ? undefined
                      : "agent-publish-media-image"
                  }
                  aria-disabled={
                    publishMediaUploadState === "saving" ||
                    publishImageLimitReached
                  }
                  title={
                    publishImageLimitReached
                      ? i18nT("maximum_de_value_images_atteint_af483c3f", {
                          value0: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
                        })
                      : i18nT("add_image_to_publication")
                  }
                  onClick={(event) => {
                    if (publishImageLimitReached) event.preventDefault();
                  }}
                >
                  <span aria-hidden>🖼️</span>
                  <strong>{i18nT("ajouter_une_image_762947a7")}</strong>
                  <small>
                    {publishImageLimitReached
                      ? i18nT("maximum_de_value_images_atteint_af483c3f", { value0: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT })
                      : INR_MEDIA_IMAGE_FORMATS_LABEL}
                  </small>
                </label>
                <label htmlFor="agent-publish-media-video">
                  <span aria-hidden>🎬</span>
                  <strong>{i18nT("ajouter_une_video_741020e4")}</strong>
                  <small>{INR_MEDIA_VIDEO_FORMATS_LABEL}</small>
                </label>
                <button
                  type="button"
                  onClick={() => setPublishMediaLibraryPickerOpen(true)}
                  disabled={publishMediaUploadState === "saving"}
                >
                  <span aria-hidden>🗂️</span>
                  <strong>{i18nT("mediatheque_e4fa8e31")}</strong>
                  <small>{i18nT("choisir_un_media_existant_6606a11d")}</small>
                </button>
                <label
                  htmlFor={
                    isMobileHeader ? "agent-publish-media-camera" : undefined
                  }
                  aria-disabled={
                    !isMobileHeader ||
                    publishMediaUploadState === "saving" ||
                    publishImageLimitReached
                  }
                  title={
                    publishImageLimitReached
                      ? i18nT("maximum_de_value_images_atteint_af483c3f", {
                          value0: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
                        })
                      : isMobileHeader
                      ? i18nT("take_photo_in_inrcy")
                      : i18nT("disponible_sur_mobile_386aeb66")
                  }
                  onClick={(event) => {
                    if (!isMobileHeader || publishImageLimitReached) {
                      event.preventDefault();
                    }
                  }}
                >
                  <span aria-hidden>📷</span>
                  <strong>{i18nT("prendre_une_photo_49b3ea58")}</strong>
                  <small>
                    {isMobileHeader ? i18nT("depuis_mobile_f39b9223") : i18nT("disponible_sur_mobile_386aeb66")}
                  </small>
                </label>
              </div>
              <small className={styles.publishMediaSourceNote}>
                {i18nT("media_source_jusqu_a_300_mo_04468d50")}{" "}
                {INR_MEDIA_IMAGE_MAX_MB_LABEL} {" "}{i18nT("pour_une_image_ou_5647eac3")}{" "}
                {INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL} {" "}{i18nT("pour_une_video_021e8484")}{" "}</small>
            </div>

            <MediaLibraryPickerModal
              open={publishMediaLibraryPickerOpen}
              title={i18nT("ajouter_depuis_la_mediatheque_d0f700b2")}
              subtitle={i18nT("add_media")}
              accept={activePreviewChannel === "youtube" ? "video" : "all"}
              multiple={false}
              maxSelection={1}
              maxImageBytes={AGENT_MEDIA_MAX_IMAGE_BYTES}
              maxVideoBytes={AGENT_MEDIA_MAX_VIDEO_BYTES}
              confirmLabel={i18nT("utiliser_ce_media_5cc61021")}
              selectedHint={
                publishImageLimitReached
                  ? i18nT("media_picker_image_limit", {
                      max: INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT,
                    })
                  : i18nT("media_picker_hint")
              }
              onOpenOptimizer={(item) =>
                openMediaOptimizerForLibraryItem(item, "publish")
              }
              onOversizedMedia={(item) =>
                openMediaOptimizerForLibraryItem(item, "publish")
              }
              onClose={() => setPublishMediaLibraryPickerOpen(false)}
              onConfirm={(items) => selectPublishMediaFromPicker(items)}
            />

            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPublishMediaPreviewOpen(false)}
                disabled={publishMediaUploadState === "saving"}
              >
                {i18nT("fermer_5ab4ec64")}{" "}</button>
              <button
                type="button"
                onClick={removePublishMedia}
                disabled={
                  publishMediaUploadState === "saving" ||
                  !publishMediaPreview?.url
                }
              >
                {publishMediaPreview?.count && publishMediaPreview.count > 1
                  ? i18nT("supprimer_cette_image_785aa49a")
                  : i18nT("supprimer_le_media_eb76b6ba")}
              </button>
            </div>
          </section>
        </div>
      )}

      {publishImageAdapterOpen && (
        <ChannelImageAdapterModal
          open={publishImageAdapterOpen}
          title={i18nT("adapter_le_media_value_34c6f353", { value0: activePreviewChannelLabel })}
          subtitle={`${activePreviewChannelLabel} • ${publishImageAdapterPreset.width}×${publishImageAdapterPreset.height}`}
          aspectRatio={publishImageAdapterAspectRatio}
          backgroundMode={publishImageAdapterBackgroundMode}
          backgroundColor={publishImageAdapterBackgroundColor}
          fitLabel={
            publishImageAdapterTransformSafe.fit === "cover"
              ? "Remplir"
              : "Adapter"
          }
          zoomLabel={i18nT("zoom_value_1d90c01c", { value0: publishImageAdapterEffectiveZoom.toFixed(2) })}
          previewSrc={publishImageAdapterPreviewUrl}
          previewLayout={publishImageAdapterPreviewLayout}
          isDragging={publishImageAdapterDragging}
          onClose={closePublishImageAdapter}
          onWheel={handlePublishImageAdapterWheel}
          onPointerDown={handlePublishImageAdapterPointerDown}
          onPointerMove={handlePublishImageAdapterPointerMove}
          onPointerUp={endPublishImageAdapterDrag}
          onPointerCancel={endPublishImageAdapterDrag}
          onDoubleClick={() =>
            updatePublishImageAdapterTransform({ offsetX: 0, offsetY: 0 })
          }
          previewRef={publishImageAdapterStageRef}
          buttonClassName=""
          primaryButtonClassName=""
          onZoomOut={() =>
            updatePublishImageAdapterTransform({
              zoom: clampNumber(
                publishImageAdapterEffectiveZoom - 0.08,
                0.4,
                publishImageAdapterTransformSafe.fit === "cover" ? 3 : 1,
              ),
            })
          }
          onZoomIn={() =>
            updatePublishImageAdapterTransform({
              zoom: clampNumber(
                publishImageAdapterEffectiveZoom + 0.08,
                0.4,
                publishImageAdapterTransformSafe.fit === "cover" ? 3 : 1,
              ),
            })
          }
          onContain={() =>
            updatePublishImageAdapterTransform({
              fit: "contain",
              zoom: 1,
              offsetX: 0,
              offsetY: 0,
              backgroundMode: getChannelSafetyBackgroundMode(publishBoosterChannel),
              backgroundColor: undefined,
              blurBackground: false,
            })
          }
          onCover={() =>
            updatePublishImageAdapterTransform({
              fit: "cover",
              backgroundMode: "black",
              blurBackground: false,
            })
          }
          onReset={() => {
            const nextTransform = getOptimizedTransform(
              publishBoosterChannel,
              publishImageAdapterMeta || undefined,
            );
            setPublishImageAdapterTransform(nextTransform);
          }}
          onSave={savePublishImageAdapter}
          saving={publishImageAdapterSaving}
          isolationNote={i18nT("image_adapter_isolation_note")}
          onBackgroundModeChange={(mode) =>
            updatePublishImageAdapterTransform(
              mode === "transparent"
                ? {
                    backgroundMode: "transparent",
                    backgroundColor: undefined,
                    blurBackground: false,
                    fit: "contain",
                    zoom: 1,
                    offsetX: 0,
                    offsetY: 0,
                  }
                : {
                    backgroundMode: mode,
                    backgroundColor:
                      mode === "black"
                        ? "#0d1320"
                        : mode === "white"
                          ? "#ffffff"
                          : publishImageAdapterTransformSafe.backgroundColor ||
                            (getChannelSafetyBackgroundMode(publishBoosterChannel) === "black"
                              ? "#0d1320"
                              : "#ffffff"),
                    blurBackground: false,
                    fit: "contain",
                    zoom: 1,
                    offsetX: 0,
                    offsetY: 0,
                  },
            )
          }
          onBackgroundColorChange={(color) =>
            updatePublishImageAdapterTransform({
              backgroundMode: "color",
              backgroundColor: color,
              blurBackground: false,
              fit: "contain",
              zoom: 1,
              offsetX: 0,
              offsetY: 0,
            })
          }
          pillButtonStyle={{}}
          pillButtonActiveStyle={{}}
        />
      )}

      {publishVideoAdapterOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => {
            if (!publishVideoAdapterSaving) setPublishVideoAdapterOpen(false);
          }}
        >
          <section
            className={`${styles.settingsModal} ${styles.publishVideoAdapterModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("adapter_la_video_inragent_8eaacc97")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPublishVideoAdapterOpen(false)}
              aria-label={i18nT("fermer_5ab4ec64")}
              disabled={publishVideoAdapterSaving}
            >
              ×
            </button>
            <div className={styles.publishMediaModalHeader}>
              <div>
                <p className={styles.modalEyebrow}>{i18nT("adapter_video_2d90a304")}</p>
                <h2>{activePreviewChannelLabel}</h2>
                <span>
                  {i18nT("outil_booster_existant_choisissez_le_format_20c55e2f")}{" "}</span>
              </div>
            </div>
            <BoosterVideoFormatManager
              isMobile={isMobileHeader}
              channel={publishBoosterChannel}
              videoName={publishMediaPreview?.name || i18nT("video_inr_agent")}
              videoDisplayUrl={publishMediaPreview?.url || ""}
              videoSize={Number(currentPublishMediaRecord?.size || 0) || null}
              videoDurationSeconds={
                Number(
                  currentPublishMediaRecord?.duration ||
                    currentPublishMediaRecord?.duration_seconds ||
                    0,
                ) || null
              }
              videoSourceMetadata={
                (asRecord(currentPublishMediaRecord?.sourceMetadata) ||
                  null) as BoosterVideoSourceMetadata | null
              }
              currentFormat={publishVideoFormat}
              adaptationMode={publishVideoAdaptationMode}
              videoTransformedVariants={
                Array.isArray(currentPublishMediaRecord?.transformedVariants)
                  ? (currentPublishMediaRecord?.transformedVariants as BoosterVideoTransformedVariant[])
                  : []
              }
              preparationState={publishVideoPreparationState}
              preparing={publishVideoAdapterSaving}
              onFormatChange={(format) => setPublishVideoFormat(format)}
              onAdaptationModeChange={(mode) =>
                setPublishVideoAdaptationMode(mode)
              }
              onApplyFormat={savePublishVideoAdapter}
              showApplyAll={false}
              buttonClassName={styles.agentToolbarButton}
              compact
            />
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPublishVideoAdapterOpen(false)}
                disabled={publishVideoAdapterSaving}
              >
                {i18nT("fermer_5ab4ec64")}{" "}</button>
              <button
                type="button"
                onClick={savePublishVideoAdapter}
                disabled={
                  publishVideoAdapterSaving || !publishMediaPreview?.url
                }
                aria-busy={publishVideoAdapterSaving}
              >
                {publishVideoAdapterSaving
                  ? i18nT("enregistrement_e7d5f232")
                  : i18nT("enregistrer_l_adaptation_83a36e4d")}
              </button>
            </div>
          </section>
        </div>
      )}

      <AgentScheduleModal
        open={scheduleOpen}
        items={upcomingScheduleItems}
        mutationState={scheduleMutationState}
        onClose={() => setScheduleOpen(false)}
        onOpenContent={handleScheduleRowOpenContent}
        onReschedule={handleScheduleRowReschedule}
        onDelete={(item) => void handleScheduleRowDelete(item)}
      />

      <ValidationChoiceModal
        open={validationChoiceOpen}
        selectedPreparedAction={selectedPreparedAction}
        scheduledEditSession={scheduledEditSession}
        mutationState={actionMutationState}
        onClose={() => setValidationChoiceOpen(false)}
        onRunNow={() =>
          scheduledEditSession
            ? void runScheduledEditNow()
            : void updateActionStatus("validated")
        }
        onSchedule={openValidationScheduleModal}
      />

      {validationScheduleOpen &&
        selectedPreparedAction?.automationKey === "publish" && (
          <PublishScheduleModal
            open={validationScheduleOpen}
            styles={dashboardStyles}
            items={agentPublishScheduleItems}
            isMobile={isMobileHeader}
            saving={validationScheduleState === "saving"}
            error=""
            successMessage={i18nT("programmation_reussie_1307249b")}
            savingLabel={i18nT("envoi_en_cours_2de80069")}
            enableImmediateUnselectedWarning={!scheduledEditSession}
            initialSelections={
              scheduledEditSession
                ? preparedChannels.map((channel) => ({
                    channel: boosterChannelKeyFromAgentChannel(channel),
                    scheduledAt:
                      scheduledEditSession.scheduledAction.scheduledAt ||
                      selectedPreparedAction.scheduledFor ||
                      new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                  }))
                : undefined
            }
            onClose={() => {
              if (validationScheduleState === "saving") return;
              setValidationScheduleOpen(false);
            }}
            onConfirm={(selections, immediateChannels) =>
              scheduleValidatedPublication(selections, immediateChannels)
            }
            onSuccess={() => {
              const immediatePublishRequest =
                pendingImmediateAgentPublishAfterSchedule;
              setValidationScheduleOpen(false);
              setValidationChoiceOpen(false);
              setPendingImmediateAgentPublishAfterSchedule(null);
              if (scheduledEditSession) {
                exitScheduledEditSession({ silent: true, force: true });
                showNotice(i18nT("scheduled_action_updated"));
                return;
              }
              if (immediatePublishRequest?.channels.length) {
                void executeImmediateAgentPublicationAfterSchedule(
                  immediatePublishRequest,
                );
              }
            }}
          />
        )}

      {validationScheduleOpen &&
        selectedPreparedAction &&
        selectedPreparedAction.automationKey !== "publish" && (
          <CampaignScheduleModal
            open={validationScheduleOpen}
            description={i18nT("campaign_schedule_description", {
              automation: agentAutomationTitle(
                selectedPreparedAction.automationKey === "loyalty"
                  ? "loyalty"
                  : "grow",
                runtimeT,
              ),
            })}
            recipientCount={preparedRecipientsCount}
            subject={
              campaignDisplayPreview?.subject || i18nT("no_subject")
            }
            saving={validationScheduleState === "saving"}
            error={null}
            successMessage={i18nT("programmation_reussie_1307249b")}
            savingLabel={i18nT("programmation_en_cours_13ae187c")}
            initialScheduledAt={
              scheduledEditSession?.scheduledAction.scheduledAt ||
              selectedPreparedAction.scheduledFor
            }
            onClose={() => {
              if (validationScheduleState === "saving") return;
              setValidationScheduleOpen(false);
            }}
            onConfirm={(scheduledAt) => scheduleValidatedCampaign(scheduledAt)}
            onSuccess={() => {
              setValidationScheduleOpen(false);
              setValidationChoiceOpen(false);
              if (scheduledEditSession) {
                exitScheduledEditSession({ silent: true, force: true });
                showNotice(i18nT("scheduled_campaign_updated"));
              }
            }}
          />
        )}

      {automationScheduleEdit && (
        <CampaignScheduleModal
          open={Boolean(automationScheduleEdit)}
          title={i18nT("modifier_la_programmation_2bdd7cdc")}
          kicker={i18nT("programmation_6255df3b")}
          description={i18nT("automation_schedule_edit_description")}
          recipientCount={0}
          subject={automationScheduleEdit.label}
          showSummary={!["publish", "stats"].includes(automationScheduleEdit.key)}
          saving={scheduleMutationState === "saving"}
          error={automationScheduleEditError}
          confirmLabel={i18nT("enregistrer_f7c8bcd8")}
          savingLabel={i18nT("enregistrement_e7d5f232")}
          successMessage={i18nT("programmation_mise_a_jour_ea5f575f")}
          initialScheduledAt={automationScheduleEdit.scheduledAtIso}
          onClose={() => {
            if (scheduleMutationState === "saving") return;
            setAutomationScheduleEdit(null);
            setAutomationScheduleEditError(null);
          }}
          onConfirm={async (scheduledAt) => {
            setScheduleMutationState("saving");
            try {
              await saveAutomationScheduleEdit(scheduledAt);
            } finally {
              setScheduleMutationState("idle");
            }
          }}
          onSuccess={() => {
            setAutomationScheduleEdit(null);
            setAutomationScheduleEditError(null);
          }}
        />
      )}

      {scheduleOnlyEdit && (
        <CampaignScheduleModal
          open={Boolean(scheduleOnlyEdit)}
          title={i18nT("modifier_la_programmation_2bdd7cdc")}
          kicker={i18nT("programmation_6255df3b")}
          description={i18nT("scheduled_action_edit_description")}
          recipientCount={0}
          subject={scheduleOnlyEdit.label}
          showSummary={false}
          saving={scheduleMutationState === "saving"}
          error={scheduleOnlyEditError}
          confirmLabel={i18nT("enregistrer_f7c8bcd8")}
          savingLabel={i18nT("enregistrement_e7d5f232")}
          successMessage={i18nT("programmation_mise_a_jour_ea5f575f")}
          initialScheduledAt={scheduleOnlyEdit.action.scheduledAt}
          onClose={() => {
            if (scheduleMutationState === "saving") return;
            setScheduleOnlyEdit(null);
            setScheduleOnlyEditError(null);
          }}
          onConfirm={async (scheduledAt) => {
            setScheduleMutationState("saving");
            try {
              await saveScheduleOnlyEdit(scheduledAt);
            } finally {
              setScheduleMutationState("idle");
            }
          }}
          onSuccess={() => {
            setScheduleOnlyEdit(null);
            setScheduleOnlyEditError(null);
          }}
        />
      )}

      {helpOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => setHelpOpen(false)}
        >
          <section
            className={`${styles.settingsModal} ${styles.helpModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("aide_inr_agent_ec5c0488")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setHelpOpen(false)}
              aria-label={i18nT("fermer_5ab4ec64")}
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>{i18nT("helper_1e7eebdb")}</p>
            <h2>{i18nT("qu_est_ce_qu_inr_agent_0290f6c1")}</h2>
            <div className={styles.helpContent}>
              <p>
                {i18nT("inr_agent_est_votre_programmateur_d_d3776182")}{" "}</p>
              <ul>
                <li>
                  <strong>{i18nT("publier_34e6b19e")}</strong> {" "}{i18nT("prepare_des_publications_avec_booster_publier_fed8f201")}{" "}</li>
                {!standardMode ? (
                  <>
                    <li>
                      <strong>{i18nT("propulser_2de43942")}</strong> {" "}{i18nT("prepare_des_campagnes_propulser_par_mail_4904e994")}{" "}</li>
                    <li>
                      <strong>{i18nT("fideliser_8fa9e4f1")}</strong> {" "}{i18nT("prepare_des_campagnes_fideliser_par_mail_e7a28bd4")}{" "}</li>
                  </>
                ) : null}
                <li>
                  <strong>{i18nT("statistiques_fdce305a")}</strong> {" "}{i18nT("genere_un_bilan_inr_stats_pdf_0ed72e8c")}{" "}</li>
              </ul>
              <p>
                {i18nT("les_roues_de_reglages_permettent_de_c517f1c9")}{" "}</p>
            </div>
          </section>
        </div>
      )}

      {settingsAutomation && settingsConfig && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => setSettingsKey(null)}
        >
          <section
            className={styles.settingsModal}
            role="dialog"
            aria-modal="true"
            aria-label={agentAutomationSettingsTitle(settingsAutomation.key, runtimeT)}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setSettingsKey(null)}
              aria-label={i18nT("fermer_5ab4ec64")}
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>{i18nT("automatisation_598357a3")}</p>
            <h2>{agentAutomationSettingsTitle(settingsAutomation.key, runtimeT)}</h2>

            <label className={styles.switchLine}>
              <span>
                <strong>{i18nT("statut_659499f3")}</strong>
                <small>
                  {settingsConnectedChannelMessage ||
                    (settingsConfig.enabled
                      ? i18nT("le_robot_peut_preparer_cette_action_e4d59f66")
                      : i18nT("cette_automatisation_est_en_pause_90aa064a"))}
                </small>
              </span>
              <input
                type="checkbox"
                checked={settingsConfig.enabled}
                disabled={settingsNoConnectedChannelBlock}
                onChange={(event) =>
                  updateConfig(settingsAutomation.key, {
                    enabled: event.target.checked,
                  })
                }
              />
            </label>

            <div className={styles.modalGrid}>
              <label>
                <span>{i18nT("frequence_bafbfba7")}</span>
                <select
                  value={settingsConfig.frequency}
                  onChange={(event) =>
                    updateConfigFrequency(
                      settingsAutomation.key,
                      event.target.value,
                    )
                  }
                >
                  {settingsOptions[settingsAutomation.key].frequency.map(
                    (frequency) => (
                      <option key={frequency.value} value={frequency.label}>
                        {agentFrequencyLabel(frequency.label, runtimeT)}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {settingsMonthlyDateCount > 0 ? (
                <>
                  <div
                    className={styles.scheduleMonthDayGrid}
                    data-count={settingsMonthlyDateCount}
                  >
                    {settingsMonthDays.map((day, index) => (
                      <label
                        key={`${settingsAutomation.key}-month-day-${index}`}
                      >
                        <span>
                          {i18nT("date_eb9a4bc1")}
                          {settingsMonthlyDateCount > 1 ? ` ${index + 1}` : ""}
                        </span>
                        <select
                          value={day}
                          onChange={(event) =>
                            updateConfigMonthDay(
                              settingsAutomation.key,
                              index,
                              Number(event.target.value),
                            )
                          }
                        >
                          {Array.from({ length: 31 }, (_, optionIndex) => {
                            const optionDay = optionIndex + 1;
                            const alreadySelected = settingsMonthDays.some(
                              (selectedDay, selectedIndex) =>
                                selectedIndex !== index &&
                                selectedDay === optionDay,
                            );
                            return (
                              <option
                                key={optionDay}
                                value={optionDay}
                                disabled={alreadySelected}
                              >
                                {optionDay}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                    ))}
                  </div>
                  <label>
                    <span>{i18nT("horaire_db0addb3")}</span>
                    <select
                      value={settingsConfig.time}
                      onChange={(event) =>
                        updateConfig(settingsAutomation.key, {
                          time: event.target.value,
                        })
                      }
                    >
                      {hourOptions.map((hour) => (
                        <option key={hour}>{hour}</option>
                      ))}
                    </select>
                  </label>
                </>
              ) : settingsConfig.frequency === "2 fois par semaine" ||
              settingsConfig.frequency === "3 fois par semaine" ? (
                normalizeConfigScheduleSlots(settingsConfig)
                  .slice(
                    0,
                    settingsConfig.frequency === "3 fois par semaine" ? 3 : 2,
                  )
                  .map((slot, index) => (
                    <div
                      className={styles.scheduleSlotPair}
                      key={`${settingsAutomation.key}-slot-${index}`}
                    >
                      <label>
                        <span>{i18nT("jour_240ce85d")}{" "}{index + 1}</span>
                        <select
                          value={slot.day}
                          onChange={(event) =>
                            updateConfigScheduleSlot(
                              settingsAutomation.key,
                              index,
                              {
                                day: event.target.value,
                              },
                            )
                          }
                        >
                          {weekDays.map((day) => (
                            <option key={day} value={day}>{agentWeekdayLabel(day, runtimeT)}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>{i18nT("horaire_db0addb3")}{" "}{index + 1}</span>
                        <select
                          value={slot.time}
                          onChange={(event) =>
                            updateConfigScheduleSlot(
                              settingsAutomation.key,
                              index,
                              {
                                time: event.target.value,
                              },
                            )
                          }
                        >
                          {hourOptions.map((hour) => (
                            <option key={hour}>{hour}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))
              ) : (
                <>
                  <label>
                    <span>{i18nT("jour_240ce85d")}</span>
                    <select
                      value={settingsConfig.day}
                      onChange={(event) =>
                        updateConfig(settingsAutomation.key, {
                          day: event.target.value,
                          scheduleSlots: [
                            {
                              day: event.target.value,
                              time: settingsConfig.time,
                            },
                            {
                              day: dayOffsetLabel(event.target.value, 3),
                              time: settingsConfig.time,
                            },
                          ],
                        })
                      }
                    >
                      {weekDays.map((day) => (
                        <option key={day} value={day}>{agentWeekdayLabel(day, runtimeT)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>{i18nT("horaire_db0addb3")}</span>
                    <select
                      value={settingsConfig.time}
                      onChange={(event) =>
                        updateConfig(settingsAutomation.key, {
                          time: event.target.value,
                          scheduleSlots: [
                            {
                              day: settingsConfig.day,
                              time: event.target.value,
                            },
                            {
                              day: dayOffsetLabel(settingsConfig.day, 3),
                              time: event.target.value,
                            },
                          ],
                        })
                      }
                    >
                      {hourOptions.map((hour) => (
                        <option key={hour}>{hour}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <label>
                <span>{i18nT("validation_dd74d182")}</span>
                <select
                  value={settingsConfig.validation}
                  onChange={(event) =>
                    updateConfig(settingsAutomation.key, {
                      validation: event.target.value,
                    })
                  }
                >
                  {settingsOptions[settingsAutomation.key].validation.map(
                    (validation) => (
                      <option key={validation.value} value={validation.label}>
                        {agentValidationLabel(validation.label, runtimeT)}
                      </option>
                    ),
                  )}
                </select>
              </label>
            </div>

            {isCampaignAutomationKey(settingsAutomation.key) ? (
              <>
                <div className={styles.campaignSettingsPair}>
                  <div className={styles.modalSection}>
                    <span>{i18nT("canal_61f21e6f")}</span>
                    {settingsAvailableChannels.length > 0 ? (
                      <div className={styles.choiceGrid}>
                        {settingsAvailableChannels.map((channelKey) => {
                          const channel = channelOptions[channelKey];
                          const checked =
                            settingsConfig.channels.includes(channelKey);
                          return (
                            <button
                              type="button"
                              key={channelKey}
                              data-channel={channelKey}
                              className={checked ? styles.choiceActive : ""}
                              onClick={() =>
                                updateConfig(settingsAutomation.key, {
                                  channels: toggleChannelItem(
                                    settingsConfig.channels,
                                    channelKey,
                                    settingsAvailableChannels,
                                  ),
                                })
                              }
                            >
                              <img
                                src={channel.src}
                                alt=""
                                loading="eager"
                                decoding="async"
                              />
                              {agentChannelLabel(channelKey, runtimeT)}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={styles.campaignEditHint}>
                        {connectedChannelsLoadState === "loading"
                          ? i18nT("chargement_des_canaux_connectes_3a145d06")
                          : agentConnectedChannelMessage(settingsAutomation.key, runtimeT)}
                      </p>
                    )}
                  </div>

                  <div className={styles.modalSection}>
                    <span>
                      {settingsAutomation.key === "grow"
                        ? i18nT("rubriques_propulser_1c6a7e39")
                        : i18nT("rubriques_fideliser_2ddba9ba")}
                    </span>
                    <div className={styles.choiceGrid}>
                      {settingsAutomation.availableThemes.map((theme) => {
                        const checked = settingsConfig.themes.includes(theme);
                        return (
                          <button
                            type="button"
                            key={theme}
                            className={checked ? styles.choiceActive : ""}
                            onClick={() =>
                              updateConfig(settingsAutomation.key, {
                                themes: toggleItem(
                                  settingsConfig.themes,
                                  theme,
                                ),
                              })
                            }
                          >
                            {agentThemeLabel(theme, runtimeT)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <label className={styles.signatureSwitchLine}>
                  <span>
                    <strong>{i18nT("signature_automatique_77745712")}</strong>
                    <small>
                      {i18nT("activee_par_defaut_pour_ajouter_la_85a5ac4b")}{" "}</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={settingsConfig.signatureAutomatic}
                    onChange={(event) =>
                      updateConfig(settingsAutomation.key, {
                        signatureAutomatic: event.target.checked,
                      })
                    }
                  />
                </label>
              </>
            ) : (
              <>
                {settingsAutomation.availableChannels.length > 0 && (
                  <div className={styles.modalSection}>
                    <span>
                      {settingsAutomation.key === "publish"
                        ? i18nT("canaux_booster_publier_1ac0f46f")
                        : i18nT("canal_61f21e6f")}
                    </span>
                    {settingsAvailableChannels.length > 0 ? (
                      <div className={styles.choiceGrid}>
                        {settingsAvailableChannels.map((channelKey) => {
                          const channel = channelOptions[channelKey];
                          const checked =
                            settingsConfig.channels.includes(channelKey);
                          return (
                            <button
                              type="button"
                              key={channelKey}
                              data-channel={channelKey}
                              className={checked ? styles.choiceActive : ""}
                              onClick={() =>
                                updateConfig(settingsAutomation.key, {
                                  channels: toggleChannelItem(
                                    settingsConfig.channels,
                                    channelKey,
                                    settingsAvailableChannels,
                                  ),
                                })
                              }
                            >
                              <img
                                src={channel.src}
                                alt=""
                                loading="eager"
                                decoding="async"
                              />
                              {agentChannelLabel(channelKey, runtimeT)}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={styles.campaignEditHint}>
                        {connectedChannelsLoadState === "loading"
                          ? i18nT("chargement_des_canaux_connectes_3a145d06")
                          : agentConnectedChannelMessage(settingsAutomation.key, runtimeT)}
                      </p>
                    )}
                  </div>
                )}

                <div className={styles.modalSection}>
                  <span>
                    {settingsAutomation.key === "stats"
                      ? i18nT("rubriques_inr_stats_130152a9")
                      : i18nT("themes_5dfcd420")}
                  </span>
                  <div className={styles.choiceGrid}>
                    {settingsAvailableThemes.map((theme) => {
                      const checked = settingsConfig.themes.includes(theme);
                      return (
                        <button
                          type="button"
                          key={theme}
                          className={checked ? styles.choiceActive : ""}
                          onClick={() =>
                            updateConfig(settingsAutomation.key, {
                              themes: toggleItem(settingsConfig.themes, theme),
                            })
                          }
                        >
                          {agentThemeLabel(theme, runtimeT)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {settingsAutomation.key === "publish" && (
                  <div className={styles.modalSection}>
                    <span>{i18nT("preferred_media_title")}</span>
                    <p className={styles.modalHint}>
                      {i18nT("preferred_media_hint")}
                    </p>
                    <div className={styles.choiceGrid}>
                      {([
                        ["media_library", "preferred_media_library"],
                        ["image_bank", "preferred_media_bank"],
                        ["ai_generation", "preferred_media_ai"],
                      ] as const).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className={
                            settingsConfig.preferredMediaSource === value
                              ? styles.choiceActive
                              : ""
                          }
                          onClick={() =>
                            updateConfig(settingsAutomation.key, {
                              preferredMediaSource: value,
                            })
                          }
                        >
                          {i18nT(label)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <p className={styles.modalNote}>
              {i18nT("source_des_idees_value_75f522cb", { value0: agentSourceLabel(settingsConfig.source, runtimeT) })}</p>
            {prepareProgress?.key === settingsAutomation.key && (
              <div
                className={styles.prepareProgressCard}
                role="status"
                aria-live="polite"
              >
                <div>
                  <strong>{i18nT("preparation_en_cours_28379fdb")}</strong>
                  <span>{agentProgressLabel(prepareProgress.label, runtimeT)}</span>
                </div>
                <b>{prepareProgress.percent}%</b>
              </div>
            )}
            <div className={styles.modalActionRow}>
              <button
                type="button"
                className={styles.modalAction}
                onClick={saveSettings}
                disabled={
                  saveState === "saving" ||
                  loadState === "loading" ||
                  Boolean(testNowKey) ||
                  (settingsNoConnectedChannelBlock && settingsConfig.enabled)
                }
              >
                {saveState === "saving"
                  ? i18nT("enregistrement_9bf1058a")
                  : i18nT("enregistrer_les_reglages_a47974c5")}
              </button>
              <button
                type="button"
                className={`${styles.modalAction} ${styles.modalSecondaryAction}`}
                onClick={() => testAutomationNow(settingsAutomation.key)}
                disabled={
                  saveState === "saving" ||
                  loadState === "loading" ||
                  prepareActionState === "saving" ||
                  Boolean(testNowKey) ||
                  settingsNoConnectedChannelBlock
                }
              >
                {testNowKey === settingsAutomation.key ||
                prepareActionState === "saving"
                  ? settingsAutomation.key === "stats"
                    ? i18nT("envoi_du_bilan_27b6de4a")
                    : prepareProgress?.key === settingsAutomation.key
                      ? i18nT("preparation_2c6b897e")
                      : i18nT("preparation_2c6b897e")
                  : settingsAutomation.key === "stats"
                    ? i18nT("envoyer_un_bilan_6dff1c99")
                    : i18nT("preparer_maintenant_e3f186ee")}
              </button>
            </div>
          </section>
        </div>
      )}

      {prepareNowConfirm && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onClick={() => {
            if (!testNowKey && prepareActionState !== "saving")
              setPrepareNowConfirm(null);
          }}
        >
          <section
            className={`${styles.settingsModal} ${styles.campaignDraftModal}`}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("preparer_une_nouvelle_campagne_9a083283")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPrepareNowConfirm(null)}
              aria-label={i18nT("fermer_5ab4ec64")}
              disabled={Boolean(testNowKey) || prepareActionState === "saving"}
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>{i18nT("campagne_inr_agent_fa7db334")}</p>
            <h2>{i18nT("preparer_une_nouvelle_campagne_170bfb63")}</h2>
            <div className={styles.campaignDraftNotice}>
              <span aria-hidden>⚠️</span>
              <div>
                <strong>
                  {i18nT("une_campagne_value_est_deja_en_22243601", { value0: prepareNowConfirm.label })}</strong>
                <p>
                  {i18nT("si_vous_continuez_la_campagne_actuelle_b57b70a9")}{" "}</p>
              </div>
            </div>
            <div className={styles.campaignDraftSummary}>
              <small>{i18nT("action_97c89a4d")}</small>
              <strong>{prepareNowConfirm.label}</strong>
              <small>{i18nT("campagne_en_cours_e6239411")}</small>
              <strong>
                {prepareNowConfirm.pendingCount} {" "}{i18nT("campagne_21daf4ed")}{" "}{prepareNowConfirm.pendingCount > 1 ? "s" : ""} {" "}{i18nT("a_enregistrer_en_brouillon_90f6d43b")}{" "}</strong>
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPrepareNowConfirm(null)}
                disabled={
                  Boolean(testNowKey) || prepareActionState === "saving"
                }
              >
                {i18nT("annuler_49ba3292")}{" "}</button>
              <button
                type="button"
                onClick={confirmPrepareNowReplacement}
                disabled={
                  Boolean(testNowKey) || prepareActionState === "saving"
                }
              >
                {testNowKey === prepareNowConfirm.key ||
                prepareActionState === "saving"
                  ? prepareProgress?.key === prepareNowConfirm.key
                    ? i18nT("preparation_2c6b897e")
                    : i18nT("preparation_2c6b897e")
                  : i18nT("preparer_maintenant_e3f186ee")}
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && <div className={styles.notice}>{notice}</div>}
    </main>
  );
}
