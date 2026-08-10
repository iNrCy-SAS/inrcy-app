"use client";

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
  getClientUserFacingErrorMessage,
} from "@/lib/userFacingErrors";
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
  getCtaModeHelp,
  getDefaultTransform,
  getEffectiveTransformZoom,
  getChannelSafetyBackgroundMode,
  getOptimizedTransform,
  getPreferredCtaChoiceFromPost,
  getVideoFormatLabel,
  getWebsiteSourceLabelForChannel,
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
import { isStandardAgentAutomationKey } from "@/lib/standardAgentPolicy";
import { useDashboardEdition } from "../_components/DashboardEditionProvider";
import {
  INR_AGENT_ACTION_LABELS,
  INR_AGENT_STATUS_LABELS,
  INR_AGENT_TOOL_LABELS,
} from "@/lib/inrAgentActions";
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
  connectedChannelMessage,
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
  publishContentKindLabel,
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
  scheduledActionStatusLabel,
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

const AGENT_VIDEO_OPTIMIZER_ACCEPT = [
  ...UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  ...UNIVERSAL_MEDIA_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export default function AgentClient() {
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
        config.day || "—",
        config.time || "—",
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
          action: automation.title,
          date: dateParts.date,
          time: dateParts.time,
          typeLabel: scheduleTypeLabelFromAutomation(automation.key),
          channelLabel: scheduleChannelLabelFromAutomation(
            automation.key,
            channel,
          ),
          channelLabels: [
            scheduleChannelLabelFromAutomation(automation.key, channel),
          ],
          originLabel: "Automatique",
          status: "Automatique",
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
      );
      rows.push({
        id: `manual-${action.id}`,
        action: action.title || "Action programmée",
        date: dateParts.date,
        time: dateParts.time,
        typeLabel: scheduledActionTypeLabel(action),
        channelLabel: scheduledActionChannelLabel(action),
        channelLabels: scheduledActionChannelLabels(action),
        originLabel: "Programmé",
        status: scheduledActionStatusLabel(action.status),
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
  }, [agentConnectedChannels, configs, scheduledActions, visibleAutomations]);

  const selectedConfig = configs[selected.key];
  const selectedAvailableChannels = useMemo(
    () => connectedChannelsForAutomation(selected, agentConnectedChannels),
    [agentConnectedChannels, selected],
  );
  const selectedRobotSteps = robotStepsByAutomation[selected.key];
  const settingsConfig = settingsKey ? configs[settingsKey] : null;
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
    ? connectedChannelMessage(settingsAutomation)
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
    ? channelOptions[activePreviewChannel]?.name
    : "Aperçu";
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
  const publishMediaRetouchLabel =
    publishMediaPreview?.kind === "video"
      ? "Adapter la vidéo"
      : publishMediaPreview?.kind === "image"
        ? "Adapter l’image"
        : "Adapter le média";
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
    ? publishContentKindLabel({
        media: publishMediaPreview,
        hasText: publishHasText,
      })
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
          blockers.push(media.statusLabel);
        }
        if (!hasText && media.kind === "none") {
          blockers.push("Ajoutez au moins du texte ou un média.");
        }
        if (channel === "youtube" && media.kind !== "video") {
          blockers.push("YouTube nécessite une vidéo.");
        }
        if (
          channel === "instagram" &&
          media.kind !== "image" &&
          media.kind !== "video"
        ) {
          blockers.push("Instagram nécessite une vidéo ou au moins 1 image.");
        }
        if (
          channel === "tiktok" &&
          media.kind !== "image" &&
          media.kind !== "video"
        ) {
          blockers.push("TikTok nécessite une vidéo ou au moins 1 photo.");
        }
        return {
          channel: boosterChannel,
          label: channelOptions[channel]?.name || channel,
          mediaLabel: publishContentKindLabel({ media, hasText }),
          blockers: Array.from(new Set(blockers)),
        } satisfies PublishScheduleItem;
      })
      .filter((item): item is PublishScheduleItem => Boolean(item));
  }, [isPublishView, preparedChannels, selectedPreparedAction]);
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
  const filteredCrmSelectionLabel = filteredCrmAllSelected ? "Aucun" : "Tout";
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
      )
    : "Aucun";
  const statsNextRunLabel = formatDateTimeLabel(
    selectedAutomationSettings?.nextRunAt ||
      (selected.key === "stats" ? computeNextOccurrence(selectedConfig) : null),
    "Programmation inactive",
  );
  const statsAutomationLabel = selectedConfig.enabled
    ? "Activée"
    : "Désactivée";
  const statsFrequencyLabel = selectedConfig.frequency || "Chaque semaine";
  const statsStoredCountLabel = `${statsReports.length}/5`;
  const footerDateLabel =
    selected.key === "stats"
      ? statsNextRunLabel
      : hasPreparedAction && selectedPreparedAction
        ? formatActionDate(selectedPreparedAction.scheduledFor, selectedConfig)
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
      showNotice("L’objet et le corps du mail sont obligatoires.");
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
        "Modification du mail impossible.",
      );
      setMailTextEditOpen(false);
      showNotice(
        scheduledEditSession
          ? "Texte modifié temporairement. Valider l’enregistrera sur l’action programmée."
          : "Texte de la campagne mis à jour.",
      );
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Modification du mail impossible.",
      );
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
      showNotice("Prépare d’abord une publication.");
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
      throw new Error(
        `Format non autorisé. Images : ${INR_MEDIA_IMAGE_FORMATS_LABEL}. Vidéos : ${INR_MEDIA_VIDEO_FORMATS_LABEL}.`,
      );
    }
    if (activePreviewChannel === "youtube" && !isVideo) {
      throw new Error(
        "YouTube nécessite une vidéo. Choisis une vidéo depuis la Médiathèque ou importe une vidéo.",
      );
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
      showNotice("YouTube nécessite une vidéo.");
      return false;
    }
    if (item.media_type === "image" && publishImageLimitReached) {
      showNotice(
        `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint pour ce canal.`,
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
        showNotice("Image ajoutée à la publication.");
      } else {
        setPublishMediaActiveIndex(0);
        showNotice("Vidéo iNrAgent mise à jour.");
      }
      return true;
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Modification du média impossible.",
      );
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
      showNotice("Prépare d’abord une publication.");
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
      showNotice("Ajoute d’abord une image à adapter.");
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
      showNotice(
        error instanceof Error
          ? error.message
          : "Adaptation de l’image impossible.",
      );
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
      showNotice("Ajoute d’abord une vidéo à adapter.");
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
      showNotice("Ajoute d’abord une image ou une vidéo à adapter.");
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
    showNotice("Ce média ne peut pas être adapté avec les outils Booster.");
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
        throw new Error("Image adaptée introuvable.");
      }
      const renderedFile = dataUrlToFile(rendered.dataUrl, safeName);
      await uploadPublishMedia(renderedFile, "replace");
      closePublishImageAdapter();
      showNotice("Image adaptée et enregistrée pour iNrAgent.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Enregistrement de l’image adaptée impossible.",
      );
    } finally {
      setPublishImageAdapterSaving(false);
    }
  }

  async function savePublishVideoAdapter() {
    if (!publishMediaPreview?.url || !currentPublishMediaRecord) return;
    setPublishVideoAdapterSaving(true);
    setPublishVideoPreparationState({
      status: "preparing",
      label: "Préparation vidéo en cours...",
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
          ? "Format vidéo appliqué"
          : "Vidéo originale conservée",
        detail: `${getVideoFormatLabel(
          publishBoosterChannel,
          publishVideoFormat,
        )} · ${publishVideoAdaptationMode === "cover_crop" ? "Recadrer plein écran" : "Vidéo entière sur fond sobre"}`,
      });
      if (response.errors?.length && !generatedVariants.length) {
        showNotice(
          response.errors[0]?.message ||
            "Adaptation automatique indisponible : la vidéo originale sera conservée.",
        );
      } else {
        showNotice("Réglage vidéo enregistré pour iNrAgent.");
      }
    } catch (error) {
      setPublishVideoPreparationState({
        status: "error",
        label: "Adaptation vidéo impossible",
        detail:
          error instanceof Error
            ? error.message
            : "Réessaie ou conserve la vidéo originale.",
      });
      showNotice(
        error instanceof Error ? error.message : "Adaptation vidéo impossible.",
      );
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
      throw new Error(payload?.error || "Modification du média impossible.");
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
      showNotice(error instanceof Error ? error.message : "Média invalide.");
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
        `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint pour ce canal.`,
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
        "Préparation du média impossible.",
      );
      if (!prepareResponse.ok)
        throw new Error(
          preparePayload?.error || "Préparation du média impossible.",
        );
      const prepared = Array.isArray(preparePayload?.items)
        ? preparePayload.items[0]
        : null;
      if (!prepared?.token || !prepared?.storage_path)
        throw new Error("Préparation du média impossible.");

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
        "Finalisation du média impossible.",
      );
      if (!finalizeResponse.ok || !finalizePayload?.ok) {
        throw new Error(
          finalizePayload?.error || "Finalisation du média impossible.",
        );
      }
      const result = Array.isArray(finalizePayload?.results)
        ? finalizePayload.results.find((item: any) => item?.ok)
        : null;
      if (!result?.storage_path) throw new Error("Média finalisé introuvable.");

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
            (mediaKind === "video" ? "Vidéo" : "Image"),
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
          ? "Vidéo iNrAgent mise à jour."
          : mutation === "append"
            ? "Image ajoutée à la publication."
            : "Image iNrAgent mise à jour.",
      );
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Modification du média impossible.",
      );
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
      showNotice("Média retiré de la publication.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Suppression du média impossible.",
      );
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
      showNotice("Le contenu de la publication est obligatoire.");
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
        "Texte modifié temporairement. Valider l’enregistrera sur l’action programmée.",
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
          payload?.error || "Modification de la publication impossible.",
        );
      }

      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
      setPublishEditOpen(false);
      showNotice("Publication mise à jour.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Modification de la publication impossible.",
      );
    } finally {
      setPublishSaveState("idle");
    }
  }

  async function patchCampaignAction(
    body: Record<string, unknown>,
    fallbackError: string,
  ) {
    if (!selectedPreparedAction)
      throw new Error("Action iNr’Agent introuvable.");

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
      showNotice(
        error instanceof Error ? error.message : "Contacts CRM indisponibles.",
      );
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
      showNotice("Ajoute au moins une adresse mail valide.");
      return;
    }
    setSelectedRecipientEmails((current) => {
      const next = new Set(current.map((email) => email.toLowerCase()));
      for (const email of emails) next.add(email);
      return Array.from(next);
    });
    setManualRecipientsInput("");
    showNotice(
      `${emails.length} destinataire${emails.length > 1 ? "s" : ""} ajouté${emails.length > 1 ? "s" : ""}.`,
    );
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
      showNotice("Sélectionne au moins un destinataire.");
      return;
    }

    setCampaignSaveState("saving");
    try {
      await patchCampaignAction(
        { editType: "campaign_recipients", recipients },
        "Modification des destinataires impossible.",
      );
      setRecipientsEditOpen(false);
      setManualRecipientsInput("");
      showNotice("Destinataires de la campagne mis à jour.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Modification des destinataires impossible.",
      );
    } finally {
      setCampaignSaveState("idle");
    }
  }

  async function addNewRecipientToCrm() {
    if (newRecipientState === "saving") return;
    const email = newRecipientDraft.email.trim().toLowerCase();
    const name = newRecipientDraft.name.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)) {
      showNotice("Renseigne un email valide.");
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
        throw new Error(payload?.error || "Ajout du contact impossible.");
      await loadCrmContactsForAgent();
      setSelectedRecipientEmails((current) =>
        current.includes(email) ? current : [...current, email],
      );
      setNewRecipientDraft({ name: "", email: "", phone: "" });
      setNewRecipientOpen(false);
      showNotice("Contact ajouté au CRM et sélectionné.");
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Ajout du contact impossible.",
      );
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
        throw new Error(payload?.error || "Boîtes mail indisponibles.");
      const accounts = Array.isArray(payload?.mailAccounts)
        ? payload.mailAccounts
        : Array.isArray(payload?.accounts)
          ? payload.accounts.filter(
              (account) => (account as any)?.category === "mail",
            )
          : [];
      setMailAccounts(accounts);
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Boîtes mail indisponibles.",
      );
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
      showNotice("Sélectionne une boîte d’envoi.");
      return;
    }

    setCampaignSaveState("saving");
    try {
      await patchCampaignAction(
        { editType: "campaign_mail_account", accountId: selectedMailAccountId },
        "Modification de la boîte d’envoi impossible.",
      );
      setMailAccountEditOpen(false);
      showNotice("Boîte d’envoi mise à jour.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Modification de la boîte d’envoi impossible.",
      );
    } finally {
      setCampaignSaveState("idle");
    }
  }

  async function saveCampaignAttachments(attachments: CampaignAttachmentRef[]) {
    await patchCampaignAction(
      { editType: "campaign_attachments", attachments },
      "Modification de la pièce jointe impossible.",
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
          `Les pièces jointes sont limitées à 20 Mo. ${oversizedUnsupported[0].name} ne peut pas être optimisé automatiquement par iNrCy.`,
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
        `${
          uploaded.length > 1
            ? "Pièces jointes ajoutées."
            : "Pièce jointe ajoutée."
        }${
          oversizedUnsupported.length > 0
            ? ` ${oversizedUnsupported[0].name} dépasse 20 Mo et ne peut pas être optimisé automatiquement.`
            : ""
        }`,
      );
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Pièce jointe impossible à ajouter.",
      );
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
        (item.media_type === "video" ? "Vidéo iNrCy" : "Image iNrCy"),
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
        picked.length > 1
          ? "Pièces jointes ajoutées depuis la Médiathèque."
          : "Pièce jointe ajoutée depuis la Médiathèque.",
      );
      return true;
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Pièce jointe impossible à ajouter.",
      );
      return false;
    } finally {
      setAttachmentUploadState("idle");
    }
  }

  async function handleOptimizedAgentMedia(item: MediaOptimizerItem) {
    const request = mediaOptimizerRequest;
    if (!request) {
      throw new Error(
        "La destination du média optimisé n’est plus disponible dans iNrAgent.",
      );
    }

    if (
      request.destination === "campaign" &&
      Number(item.size_bytes || 0) > MEDIA_LIBRARY_EMAIL_TARGET_BYTES
    ) {
      throw new Error(
        "Le média optimisé dépasse encore 20 Mo.",
      );
    }

    const inserted =
      request.destination === "campaign"
        ? await addCampaignAttachmentsFromMediaLibrary([item])
        : await selectPublishMediaFromLibrary(item);
    if (!inserted) {
      throw new Error(
        "Le média optimisé a été créé, mais son insertion dans iNrAgent a échoué.",
      );
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
      showNotice("Pièce jointe retirée.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Suppression de la pièce jointe impossible.",
      );
    } finally {
      setAttachmentUploadState("idle");
    }
  }

  async function saveCampaignAsDraft() {
    if (!selectedPreparedAction || campaignDraftSaveState === "saving") return;
    if (scheduledEditSession) {
      showNotice("Action programmée en édition : validez d’abord les modifications de l’action programmée.");
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
          payload?.error || "Enregistrement du brouillon impossible.",
        );
      }

      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
      setCampaignDraftConfirmOpen(false);
      showNotice("Campagne enregistrée en brouillon dans iNrSend.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Enregistrement du brouillon impossible.",
      );
    } finally {
      setCampaignDraftSaveState("idle");
    }
  }

  async function savePublishAsDraft() {
    if (!selectedPreparedAction || campaignDraftSaveState === "saving") return;
    if (scheduledEditSession) {
      showNotice("Action programmée en édition : validez d’abord les modifications de l’action programmée.");
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
          payload?.error || "Enregistrement du brouillon impossible.",
        );
      }

      const updatedAction = payload.action;
      setActions((current) =>
        current.map((action) =>
          action.id === updatedAction.id ? updatedAction : action,
        ),
      );
      setCampaignDraftConfirmOpen(false);
      showNotice("Publication enregistrée en brouillon dans iNrSend.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Enregistrement du brouillon impossible.",
      );
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
        showNotice("Édition annulée. L’action programmée n’a pas été modifiée.");
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
        eyebrow: "Édition iNrAgent",
        title: "Continuer sans sauvegarder ?",
        message: "Les modifications en cours seront perdues. L’action programmée restera inchangée.",
        confirmLabel: "Continuer",
        cancelLabel: "Annuler",
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
    eyebrow: "Édition iNrAgent",
    title: "Continuer sans sauvegarder ?",
    message: "Les modifications en cours seront perdues. L’action programmée restera inchangée.",
    confirmLabel: "Continuer",
    cancelLabel: "Annuler",
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
      showNotice("Action programmée introuvable.");
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
      setValidationChoiceOpen(false);
      setValidationScheduleOpen(false);
      setScheduleOnlyEditError(null);
      setScheduleOnlyEdit({ action: scheduledAction, label: "Bilan iNr’Stats" });
      return;
    }

    const action = scheduledActionToPreparedAction(scheduledAction);
    if (!action) {
      showNotice("Cette action programmée ne peut pas encore être ouverte.");
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
    showNotice("Action programmée ouverte en édition temporaire.");
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
        payload?.error || "Modification de l’action programmée impossible.",
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
        payload?.error || "Création de l’action programmée impossible.",
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
      throw new Error("Sélectionnez au moins un canal à programmer.");
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
      throw new Error("Sélectionnez au moins un canal à programmer.");
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
          payload?.error || "Suppression de l’action programmée impossible.",
        );
      }
      exitScheduledEditSession({ silent: true, force: true });
      await refreshScheduledActions(true);
      showNotice("Action programmée supprimée.");
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Suppression de l’action programmée impossible.",
      );
    } finally {
      setScheduleMutationState("idle");
    }
  }

  async function deleteScheduledEditAction() {
    const session = scheduledEditSession;
    if (!session || scheduleMutationState === "saving") return;
    openAgentConfirmDialog({
      title: "Supprimer ce contenu programmé ?",
      message: "Ce contenu programmé sera supprimé définitivement. Continuer ?",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
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
      throw new Error("Date de programmation invalide.");
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
          payload?.error || "Modification de la programmation impossible.",
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
      showNotice("Programmation mise à jour.");
    } catch (error) {
      const message =
          getClientUserFacingErrorMessage(error, "Modification de la programmation impossible.");
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
      showNotice("Programmation mise à jour.");
    } catch (error) {
      const message =
          getClientUserFacingErrorMessage(error, "Modification de la programmation impossible.");
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
          payload?.error || "Suppression de l’action programmée impossible.",
        );
      showNotice("Action programmée supprimée.");
      await refreshScheduledActions(true);
    } catch (error) {
      showNotice(
        error instanceof Error
          ? error.message
          : "Suppression de l’action programmée impossible.",
      );
    } finally {
      setScheduleMutationState("idle");
    }
  }

  async function cancelScheduledAction(actionId: string | null | undefined) {
    if (!actionId || scheduleMutationState === "saving") return;
    openAgentConfirmDialog({
      title: "Supprimer cette action programmée ?",
      message: "Cette action sera retirée du planning iNr’Agent.",
      confirmLabel: "Supprimer",
      cancelLabel: "Annuler",
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
        throw new Error(payload?.error || "Désactivation impossible.");
      const savedSettings = sanitizeInrAgentSettings(
        payload?.settings ?? nextSettings,
      );
      setAgentSettings(savedSettings);
      setConfigs(settingsToConfigs(savedSettings));
      writeCachedAgentViewSnapshot({ settings: savedSettings });
      showNotice("Automatisation désactivée.");
    } catch (error) {
      showNotice(
        error instanceof Error ? error.message : "Désactivation impossible.",
      );
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
      title: `Désactiver l’automatisation ${automation?.title || "iNrAgent"} ?`,
      message: "Les prochaines actions automatiques de cette rubrique seront retirées du planning.",
      confirmLabel: "Désactiver",
      cancelLabel: "Annuler",
      tone: "danger",
      onConfirm: () => performDisableAutomationFromSchedule(key),
    });
  }

  async function handleScheduleRowModify(item: ScheduleListItem) {
    if (item.source === "manual") {
      openScheduledActionEditor(item.scheduledActionId);
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
    successMessage = "Action validée et programmée dans iNr’Agent.",
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
        payload?.error || "Programmation de l’action impossible.",
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
      showNotice("Choisissez une date et une heure dans le futur.");
      return;
    }

    if (scheduledEditSession) {
      setValidationScheduleState("saving");
      setNotice(null);
      try {
        await saveScheduledEditCampaign(scheduledAt);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Modification de la campagne programmée impossible.";
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
        "Campagne validée et programmée dans iNr’Agent.",
        { closeSchedule: false, showSuccessNotice: false },
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Programmation de la campagne impossible.";
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
      showNotice("Sélectionnez au moins un canal à programmer.");
      return;
    }

    if (scheduledEditSession) {
      setValidationScheduleState("saving");
      setNotice(null);
      try {
        await saveScheduledEditPublication(selections);
        setPendingImmediateAgentPublishAfterSchedule(null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Modification de la publication programmée impossible.";
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
        selections.length > 1
          ? `Publication validée et programmée dans iNr’Agent (${selections.length} canaux).`
          : "Publication validée et programmée dans iNr’Agent.",
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
      const message =
        error instanceof Error
          ? error.message
          : "Programmation de la publication impossible.";
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
        aria-label="iNr’Agent - automatisations"
      >
        <header className={styles.moduleHeader}>
          <div className={styles.moduleTitleBlock}>
            <img
              className={styles.moduleLogo}
              src="/icons/inr-agent-header.png"
              alt="iNr’Agent"
              width={68}
              height={68}
              loading="eager"
              decoding="sync"
            />
            <div className={styles.moduleTitleText}>
              <h1>iNr’Agent</h1>
              <p className={styles.moduleSubtitleDesktop}>
                Programmateur d’automatisations connecté à vos outils.
              </p>
            </div>
          </div>

          <p className={styles.moduleSubtitleMobile}>
            Programmateur d’automatisations connecté à vos outils.
          </p>

          <div className={styles.moduleHeaderActions}>
            {loadState === "loading" && (
              <span className={styles.headerSyncPill}>Synchronisation...</span>
            )}
            {tableMissing && (
              <span className={styles.headerWarningPill}>
                Tables Supabase à créer
              </span>
            )}
            <HelpButton
              onClick={() => {
                const openHelp = () => setHelpOpen(true);
                if (!exitScheduledEditSession({ silent: true, onAfterExit: openHelp })) return;
                openHelp();
              }}
              title="Aide iNr’Agent"
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
              aria-label="Configuration IA"
              title="Configurer le style des contenus générés"
            >
              IA
            </button>
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
              aria-label="Voir les actions programmées"
              title="Programmation"
            >
              <span className={styles.headerScheduleIcon} aria-hidden>
                <CalendarMetaIcon />
              </span>
              <span className={styles.headerScheduleLabel}>Planning</span>
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
              aria-label={`Ouvrir ${selectedHeaderTool.label}`}
              title={`Ouvrir ${selectedHeaderTool.label}`}
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
              aria-label="Ouvrir iNr'Send"
              title="Voir l’historique des actions réalisées"
            >
              <span className={styles.headerInrSendLabel}>iNr'Send</span>
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
              aria-label="Retour au tableau de bord"
              title="Retour au tableau de bord"
            >
              <span className={styles.headerCloseLabel}>Fermer</span>
            </button>
          </div>
        </header>


        <nav
          className={`${styles.automationGrid} ${
            standardMode ? styles.automationGridStandard : ""
          }`}
          aria-label="Automatisations iNr’Agent"
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
                      {automation.title}
                    </span>
                    <span className={styles.cardTitleShort}>
                      {automation.shortTitle}
                    </span>
                  </span>
                  {pendingActionsByAutomation[automation.key] > 0 && (
                    <span
                      className={styles.cardPendingCount}
                      data-count={pendingActionsByAutomation[automation.key]}
                      aria-label={`${pendingActionsByAutomation[automation.key]} action à valider`}
                    >
                      {pendingActionsByAutomation[automation.key]} à valider
                    </span>
                  )}
                  {active && (
                    <span
                      className={styles.cardStatus}
                      aria-label="Automatisation activée"
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
                  aria-label={`Programmer — ${automation.title}`}
                  title="Programmer cette automatisation"
                >
                  <span className={styles.settingsButtonLabel}>Programmer</span>
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
              aria-label="Fermer le panneau des missions"
            />
          )}
          <aside
            id="inr-agent-robot-panel"
            className={`${styles.robotCard} ${robotPanelOpen ? styles.robotCardCompactOpen : styles.robotCardCompactClosed} ${scheduledEditSession ? styles.scheduledEditCard : ""}`}
            aria-label={scheduledEditSession ? "Édition temporaire d’une action programmée" : "Fonctionnement iNr’Agent"}
          >
            <button
              type="button"
              className={styles.robotPanelToggle}
              onClick={() => setRobotPanelOpen((open) => !open)}
              aria-expanded={robotPanelOpen}
              aria-controls="inr-agent-robot-panel"
              title={robotPanelOpen ? "Replier les missions" : "Afficher les missions"}
            >
              <img
                src="/icons/inr-agent-header.png"
                alt=""
                aria-hidden
                width={30}
                height={30}
              />
              <span>{robotPanelOpen ? "Missions iNr’Agent" : "Missions"}</span>
              <b aria-hidden>{robotPanelOpen ? "×" : "›"}</b>
            </button>
            {scheduledEditSession ? (
              <div className={styles.scheduledEditPanel}>
                <div className={styles.scheduledEditPanelIcon} aria-hidden>
                  <PencilActionIcon />
                </div>
                <span className={styles.scheduledEditEyebrow}>Édition temporaire</span>
                <h3>Action programmée</h3>
                <p>
                  Vous modifiez une action déjà confiée à iNr’Agent. Rien n’est
                  enregistré tant que vous ne validez pas.
                </p>
                <div
                  className={`${styles.scheduledEditState} ${scheduledEditDirty ? styles.scheduledEditStateDirty : ""}`}
                >
                  {scheduledEditDirty
                    ? "Modifications non sauvegardées"
                    : "Aucune modification pour le moment"}
                </div>
                <small className={styles.scheduledEditHint}>
                  <span>Valider = enregistrer</span>
                  <span>Refuser = supprimer</span>
                </small>
                <button
                  type="button"
                  className={styles.scheduledEditQuitButton}
                  onClick={() => exitScheduledEditSession()}
                >
                  Quitter l’édition
                </button>
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
                  {selectedRobotSteps.map((step, index) => (
                    <li key={`${selected.key}-step-${index + 1}`}>
                      <span>{index + 1}</span>
                      <strong>{step}</strong>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </aside>

          <div className={styles.workColumn}>
            <section
              className={`${styles.previewCard} ${selected.key === "stats" || isCampaignView || isPublishView ? styles.previewCardNoFrame : ""}`}
              aria-label="Aperçu de l’action préparée"
            >
              <div className={styles.previewBody}>
                {selected.key === "stats" ? (
                  <div className={styles.statsPreview}>
                    <div className={styles.statsHeadCard}>
                      <span className={styles.statsHeadIcon} aria-hidden>
                        <AutomationIcon type="stats" />
                      </span>
                      <div className={styles.statsHeadCopy}>
                        <h3>Votre bilan iNr’Stats</h3>
                        <p className={styles.statsLead}>
                          iNr’Agent analyse vos données et vous envoie un bilan
                          PDF automatiquement.
                        </p>
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
                          <small>Automatisation</small>
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
                          <small>Fréquence</small>
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
                          <small>Prochain bilan</small>
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
                          <small>Dernier bilan</small>
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
                          <small>Bilans conservés</small>
                        </div>
                        <strong>{statsStoredCountLabel}</strong>
                      </article>
                    </div>

                    <section
                      className={styles.statsInsightCard}
                      aria-label="Dernières recommandations iNrAgent"
                    >
                      <div className={styles.statsInsightHeader}>
                        <span className={styles.statsInsightIcon} aria-hidden>
                          <SparkSettingsIcon />
                        </span>
                        <div className={styles.statsInsightCopy}>
                          <strong>Dernières recommandations iNr’Agent</strong>
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
                          Le prochain bilan automatique affichera ici les
                          recommandations de la dernière page du PDF.
                        </p>
                      )}
                    </section>

                    <div className={styles.statsHistorySection}>
                      <div className={styles.statsHistoryHeader}>
                        <h4>5 derniers bilans auto</h4>
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
                              aria-label={`Télécharger le bilan du ${formatMiniDateLabel(report.document.createdAt || report.completedAt || report.createdAt)}`}
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
                                    ).date
                                  }
                                </strong>
                                <small>
                                  {
                                    formatReportDateLabel(
                                      report.document.createdAt ||
                                        report.completedAt ||
                                        report.createdAt,
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
                          <small>Rubrique</small>
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
                            ? "Voir les destinataires"
                            : "Aucune campagne préparée"
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <SparkSettingsIcon />
                        </span>
                        <span>
                          <small>Destinataires</small>
                          <strong>
                            {hasCampaignPreview
                              ? `${campaignDisplayPreview.recipientsCount} contact${campaignDisplayPreview.recipientsCount > 1 ? "s" : ""}`
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
                            ? "Modifier la boîte d’envoi"
                            : "Aucune campagne préparée"
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <SendPlaneIcon />
                        </span>
                        <span className={styles.campaignInfoText}>
                          <small>Boîte d’envoi</small>
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
                            ? "Voir la pièce jointe"
                            : "Aucune campagne préparée"
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <ImageMetaIcon />
                        </span>
                        <span>
                          <small>Pièce jointe</small>
                          <strong>
                            {hasCampaignPreview
                              ? campaignAttachments.length > 0
                                ? campaignAttachments.length === 1
                                  ? campaignAttachments[0].name
                                  : `${campaignAttachments.length} fichiers`
                                : "Aucune"
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
                        <span>Objet :</span>
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
                                ? "Recherche des actions préparées..."
                                : "Aucune campagne automatique préparée pour le moment."}
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
                          <small>Canal</small>
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
                            ? "Modifier le contenu"
                            : "Aucune publication préparée"
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <ImageMetaIcon />
                        </span>
                        <span>
                          <small>Contenu</small>
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
                            ? "Gérer le média"
                            : "Aucune publication préparée"
                        }
                      >
                        <span className={styles.campaignInfoIcon} aria-hidden>
                          <ImageMetaIcon />
                        </span>
                        <span>
                          <small>Média</small>
                          <strong>
                            {publishMediaPreview?.name || "Aucun"}
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
                          <small>Statut</small>
                          <strong className={publishStatusClass}>
                            {publishStatus.label}
                          </strong>
                        </span>
                      </article>
                    </div>

                    <article className={styles.publishPostCard}>
                      <div className={styles.publishPostText}>
                        <div className={styles.publishTitleLine}>
                          <span>Titre :</span>
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
                                Aucune publication automatique préparée pour le
                                moment.
                              </strong>
                              <span>
                                Le futur contenu du canal sélectionné
                                s’affichera ici dès qu’iNr’Agent aura préparé
                                une publication.
                              </span>
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
                          <span>CTA :</span>
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
                        <span>Aucune image obligatoire pour cette action</span>
                      </div>
                    )}
                    <div className={styles.previewText}>
                      <div className={styles.previewBadgeRow}>
                        <span>Aperçu {activePreviewChannelLabel}</span>
                        <span>
                          {
                            INR_AGENT_ACTION_LABELS[
                              selectedPreparedAction.actionType
                            ]
                          }
                        </span>
                        <span>
                          {
                            INR_AGENT_TOOL_LABELS[
                              selectedPreparedAction.targetTool
                            ]
                          }
                        </span>
                        <span>
                          {
                            INR_AGENT_STATUS_LABELS[
                              selectedPreparedAction.status
                            ]
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
                          Appel à l’action : {preparedChannelPreview.cta}
                        </small>
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
                          Thème : {targetThemesLabel(selectedPreparedAction)}
                        </small>
                      )}
                      {preparedRecipientsCount > 0 && (
                        <small className={styles.previewRecipients}>
                          Destinataires proposés : {preparedRecipientsCount}{" "}
                          contact{preparedRecipientsCount > 1 ? "s" : ""} CRM
                        </small>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyPreview}>
                    <span className={styles.emptyOrb} aria-hidden>
                      <AutomationIcon type={selected.key} />
                    </span>
                    <h3>Aucune action préparée</h3>
                    <p>
                      Quand iNr’Agent aura préparé la prochaine action, l’aperçu
                      s’affichera ici. Sélectionnez ensuite un canal en dessous
                      pour contrôler le contenu prévu canal par canal.
                    </p>
                    <small>
                      {actionsLoadState === "loading"
                        ? "Recherche des actions préparées..."
                        : `Automatisation sélectionnée : ${selected.title}`}
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
                      ? "Sources :"
                      : isCampaignView
                        ? "Canal"
                        : isPublishView
                          ? "Canaux"
                          : "Canaux :"}
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
                        aria-label="Afficher le canal précédent"
                        title="Canal précédent"
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
                              aria-label={rubrique.name}
                              title={rubrique.name}
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
                          title="Mails"
                          aria-label="Canal Mails"
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
                              aria-label={
                                selectableChannel
                                  ? `Afficher l’aperçu ${channel.name}`
                                  : `${channel.name} désélectionné`
                              }
                              title={
                                selectableChannel
                                  ? channel.name
                                  : `${channel.name} désélectionné`
                              }
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
                        aria-label="Afficher le canal suivant"
                        title="Canal suivant"
                      >
                        ›
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={`${styles.metaItem} ${styles.dateItem}`}
                  title={
                    selected.key === "stats"
                      ? "Prochain bilan automatique"
                      : "Date programmée"
                  }
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
                    <small>Validation non requise</small>
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
                            ? "Enregistrement en cours"
                            : isPublishView
                              ? "Enregistrer la publication en brouillon"
                              : "Enregistrer la campagne en brouillon"
                        }
                        title={
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                            ? "Enregistrement en cours"
                            : isPublishView
                              ? "Enregistrer"
                              : "Enregistrer la campagne"
                        }
                        data-tooltip={
                          actionMutationState === "saving" ||
                          campaignDraftSaveState === "saving"
                            ? "Enregistrement en cours"
                            : isPublishView
                              ? "Enregistrer"
                              : "Enregistrer la campagne"
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
                          ? "Enregistrement…"
                          : "Enregistrer"}
                      </button>
                    )}
                    {(isCampaignView || isPublishView) && (
                      <button
                        type="button"
                        className={styles.modifyCampaignButton}
                        aria-label={
                          isPublishView
                            ? "Modifier la publication"
                            : "Modifier la campagne"
                        }
                        title={
                          isPublishView ? "Modifier" : "Modifier la campagne"
                        }
                        data-tooltip={
                          isPublishView ? "Modifier" : "Modifier la campagne"
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
                        Modifier
                      </button>
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
                            ? "Refus en cours…"
                            : "Validation en cours…"}
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
                            Valider
                          </button>
                          <button
                            type="button"
                            className={styles.refuseButton}
                            disabled={!hasPreparedAction}
                            onClick={() => updateActionStatus("refused")}
                          >
                            <span aria-hidden>
                              <RefuseActionIcon />
                            </span>
                            Refuser
                          </button>
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
        mediaName={publishMediaPreview?.name}
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
            aria-label="Modifier la publication"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPublishEditOpen(false)}
              aria-label="Fermer"
              disabled={publishSaveState === "saving"}
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>Publication iNr’Agent</p>
            <h2>
              Modifier{" "}
              {publishTextDraft.channel
                ? channelOptions[publishTextDraft.channel]?.name
                : "le canal"}
            </h2>
            <label className={styles.mailTextField}>
              <span>Titre</span>
              <input
                value={publishTextDraft.title}
                onChange={(event) =>
                  setPublishTextDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                maxLength={180}
                placeholder="Titre de la publication"
              />
            </label>
            <label className={styles.mailTextField}>
              <span>Contenu</span>
              <div
                className={styles.richTextToolbar}
                aria-label="Mise en forme du contenu"
              >
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPublishTextFormat("bold")}
                  title="Gras"
                >
                  <strong>B</strong>
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPublishTextFormat("italic")}
                  title="Italique"
                >
                  <em>I</em>
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyPublishTextFormat("underline")}
                  title="Souligné"
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
              <span>CTA</span>
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
                  getWebsiteSourceLabelForChannel(
                    displayKey,
                    publishCtaDefaults,
                  );
                const websiteChoices = [
                  publishCtaDefaults?.inrcySiteUrl
                    ? {
                        label: "Site iNrCy",
                        url: publishCtaDefaults.inrcySiteUrl,
                      }
                    : null,
                  publishCtaDefaults?.siteWebUrl
                    ? { label: "Site web", url: publishCtaDefaults.siteWebUrl }
                    : null,
                ].filter(Boolean) as Array<{ label: string; url: string }>;
                const ctaMode = publishTextDraft.ctaMode || "none";
                return (
                  <>
                    <div className={styles.publishCtaGrid} data-mode={ctaMode}>
                      <label>
                        <span>Bouton</span>
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
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      {(ctaMode === "website" || ctaMode === "custom") && (
                        <label>
                          <span>URL de destination</span>
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
                                ? `URL du site préremplie (${activeWebsiteSourceLabel})`
                                : websiteChoices.length > 1
                                  ? "Choisissez Site iNrCy ou Site web"
                                  : "URL du site (optionnel)"
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
                          <span>Texte du bouton</span>
                          <input
                            value={publishTextDraft.cta}
                            onChange={(event) =>
                              updatePublishCtaDraft({ cta: event.target.value })
                            }
                            maxLength={180}
                            placeholder={
                              ctaMode === "custom"
                                ? "Ex : En savoir plus"
                                : "Ex : Demander un devis"
                            }
                          />
                        </label>
                      )}

                      {ctaMode === "call" && (
                        <label>
                          <span>Téléphone</span>
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
                                ? "Téléphone prérempli depuis Mon profil"
                                : "Téléphone"
                            }
                          />
                        </label>
                      )}
                    </div>
                    <small className={styles.publishCtaHelp}>
                      {getCtaModeHelp(displayKey, ctaMode)}
                    </small>
                    {ctaMode === "website" && activeWebsiteUrl && (
                      <small className={styles.publishCtaHelp}>
                        Valeur par défaut disponible depuis{" "}
                        {activeWebsiteSourceLabel.toLowerCase()} :{" "}
                        {activeWebsiteUrl}
                      </small>
                    )}
                    {ctaMode === "call" && publishCtaDefaults?.phone && (
                      <small className={styles.publishCtaHelp}>
                        Valeur par défaut disponible depuis Mon profil :{" "}
                        {publishCtaDefaults.phone}
                      </small>
                    )}
                  </>
                );
              })()}
            </div>
            {channelSupportsHashtags(publishTextDraft.channel || null) && (
              <label className={styles.mailTextField}>
                <span>Hashtags</span>
                <input
                  value={publishTextDraft.hashtags}
                  onChange={(event) =>
                    setPublishTextDraft((current) => ({
                      ...current,
                      hashtags: event.target.value,
                    }))
                  }
                  maxLength={280}
                  placeholder="#communication #local"
                />
              </label>
            )}
            <p className={styles.campaignEditHint}>
              La modification s’applique uniquement au canal sélectionné dans
              iNr’Agent.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPublishEditOpen(false)}
                disabled={publishSaveState === "saving"}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={savePublishText}
                disabled={publishSaveState === "saving"}
              >
                {publishSaveState === "saving"
                  ? "Enregistrement..."
                  : "Enregistrer"}
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
        filteredSelectionLabel={filteredCrmSelectionLabel}
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
            aria-label="Média de la publication"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPublishMediaPreviewOpen(false)}
              aria-label="Fermer"
              disabled={publishMediaUploadState === "saving"}
            >
              ×
            </button>
            <div className={styles.publishMediaModalHeader}>
              <div>
                <p className={styles.modalEyebrow}>Média iNr’Agent</p>
                <h2>Gérer le média {activePreviewChannelLabel}</h2>
                <span>
                  Choisissez, ajoutez, remplacez ou préparez le média avant
                  validation.
                </span>
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
                      alt={publishMediaPreview.name || "Média de publication"}
                    />
                  )
                ) : (
                  <div className={styles.publishMediaEmpty}>
                    <span aria-hidden>🖼️</span>
                    <strong>Aucun média sélectionné</strong>
                  </div>
                )}
              </div>
              <div className={styles.publishMediaCurrentText}>
                <span className={styles.publishMediaTypeChip}>
                  {publishMediaPreview?.typeLabel || "Média"}
                </span>
                <strong>{publishMediaPreview?.name || "Aucun média"}</strong>
                <small>
                  {publishMediaPreview?.note ||
                    "Ajoutez une image ou une vidéo depuis la Médiathèque."}
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
                    Ajoutez un média pour pouvoir l’adapter.
                  </div>
                )}
              </div>
            </div>

            {publishMediaPreview && publishMediaPreview.items.length > 1 ? (
              <div
                className={styles.publishMediaGallery}
                role="list"
                aria-label={`Médias ${activePreviewChannelLabel}`}
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
                    aria-label={`Afficher l’image ${index + 1} sur ${publishMediaPreview.items.length}`}
                  >
                    {item.kind === "video" ? (
                      <video src={item.url} muted preload="metadata" />
                    ) : (
                      <img src={item.url} alt={item.name || `Image ${index + 1}`} />
                    )}
                    <span>{index + 1}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className={styles.publishMediaAdaptationBox}>
              <div>
                <strong>Adaptation du canal</strong>
                <span>
                  {publishMediaAdaptationPreview?.note ||
                    "iNrAgent préparera le média selon les règles du canal."}
                </span>
              </div>
              <small>
                Utilisez l’outil d’adaptation iNrCy pour ajuster ce média au
                canal sélectionné, sans recréer de nouveau système.
              </small>
            </div>

            <div className={styles.publishMediaSourcePanel}>
              <div className={styles.publishMediaSourceHeader}>
                <strong>Ajouter ou remplacer</strong>
                <span>
                  {publishMediaPreview?.kind === "image"
                    ? publishImageLimitReached
                      ? `${publishImageCount}/${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images enregistrées. Maximum atteint.`
                      : `${publishImageCount}/${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} image${publishImageCount > 1 ? "s" : ""} enregistrée${publishImageCount > 1 ? "s" : ""} pour ce canal.`
                    : publishMediaPreview?.kind === "video"
                      ? "Vidéo préparée pour ce canal."
                      : "Média enregistré pour ce canal."}
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
                      ? `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint`
                      : "Ajouter une image à la publication"
                  }
                  onClick={(event) => {
                    if (publishImageLimitReached) event.preventDefault();
                  }}
                >
                  <span aria-hidden>🖼️</span>
                  <strong>Ajouter une image</strong>
                  <small>
                    {publishImageLimitReached
                      ? `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint`
                      : INR_MEDIA_IMAGE_FORMATS_LABEL}
                  </small>
                </label>
                <label htmlFor="agent-publish-media-video">
                  <span aria-hidden>🎬</span>
                  <strong>Ajouter une vidéo</strong>
                  <small>{INR_MEDIA_VIDEO_FORMATS_LABEL}</small>
                </label>
                <button
                  type="button"
                  onClick={() => setPublishMediaLibraryPickerOpen(true)}
                  disabled={publishMediaUploadState === "saving"}
                >
                  <span aria-hidden>🗂️</span>
                  <strong>Médiathèque</strong>
                  <small>Choisir un média existant</small>
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
                      ? `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint`
                      : isMobileHeader
                      ? "Prendre une photo dans iNrCy"
                      : "Disponible sur mobile"
                  }
                  onClick={(event) => {
                    if (!isMobileHeader || publishImageLimitReached) {
                      event.preventDefault();
                    }
                  }}
                >
                  <span aria-hidden>📷</span>
                  <strong>Prendre une photo</strong>
                  <small>
                    {isMobileHeader ? "Depuis mobile" : "Disponible sur mobile"}
                  </small>
                </label>
              </div>
              <small className={styles.publishMediaSourceNote}>
                Média source jusqu’à 300 Mo · optimisation proposée au-delà de{" "}
                {INR_MEDIA_IMAGE_MAX_MB_LABEL} pour une image ou{" "}
                {INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL} pour une vidéo.
              </small>
            </div>

            <MediaLibraryPickerModal
              open={publishMediaLibraryPickerOpen}
              title="Ajouter depuis la Médiathèque"
              subtitle="Ajouter un média"
              accept={activePreviewChannel === "youtube" ? "video" : "all"}
              multiple={false}
              maxSelection={1}
              maxImageBytes={AGENT_MEDIA_MAX_IMAGE_BYTES}
              maxVideoBytes={AGENT_MEDIA_MAX_VIDEO_BYTES}
              confirmLabel="Utiliser ce média"
              selectedHint={
                publishImageLimitReached
                  ? `Maximum de ${INR_MEDIA_PUBLICATION_MAX_IMAGE_COUNT} images atteint : choisissez une vidéo ou supprimez d’abord une image.`
                  : "Choisissez un média pour iNrAgent."
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
                Fermer
              </button>
              <button
                type="button"
                onClick={removePublishMedia}
                disabled={
                  publishMediaUploadState === "saving" ||
                  !publishMediaPreview?.url
                }
              >
                {publishMediaPreview?.count && publishMediaPreview.count > 1
                  ? "Supprimer cette image"
                  : "Supprimer le média"}
              </button>
            </div>
          </section>
        </div>
      )}

      {publishImageAdapterOpen && (
        <ChannelImageAdapterModal
          open={publishImageAdapterOpen}
          title={`Adapter le média ${activePreviewChannelLabel}`}
          subtitle={`${activePreviewChannelLabel} • ${publishImageAdapterPreset.width}×${publishImageAdapterPreset.height}`}
          aspectRatio={publishImageAdapterAspectRatio}
          backgroundMode={publishImageAdapterBackgroundMode}
          backgroundColor={publishImageAdapterBackgroundColor}
          fitLabel={
            publishImageAdapterTransformSafe.fit === "cover"
              ? "Remplir"
              : "Adapter"
          }
          zoomLabel={`zoom ${publishImageAdapterEffectiveZoom.toFixed(2)}×`}
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
          isolationNote="Ce réglage utilise l’outil Adapter image existant de Booster et remplacera le média iNrAgent par la version adaptée."
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
            aria-label="Adapter la vidéo iNrAgent"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPublishVideoAdapterOpen(false)}
              aria-label="Fermer"
              disabled={publishVideoAdapterSaving}
            >
              ×
            </button>
            <div className={styles.publishMediaModalHeader}>
              <div>
                <p className={styles.modalEyebrow}>Adapter vidéo</p>
                <h2>{activePreviewChannelLabel}</h2>
                <span>
                  Outil Booster existant : choisissez le format puis
                  appliquez-le au média iNrAgent.
                </span>
              </div>
            </div>
            <BoosterVideoFormatManager
              isMobile={isMobileHeader}
              channel={publishBoosterChannel}
              videoName={publishMediaPreview?.name || "Vidéo iNrAgent"}
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
                Fermer
              </button>
              <button
                type="button"
                onClick={savePublishVideoAdapter}
                disabled={
                  publishVideoAdapterSaving || !publishMediaPreview?.url
                }
                aria-busy={publishVideoAdapterSaving}
              >
                {publishVideoAdapterSaving
                  ? "Enregistrement…"
                  : "Enregistrer l’adaptation"}
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
        onModify={(item) => void handleScheduleRowModify(item)}
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
            successMessage="Programmation réussie."
            savingLabel="Envoi en cours…"
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
                showNotice("Action programmée mise à jour.");
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
            description={`iNr’Agent enverra cette campagne ${
              selectedPreparedAction.automationKey === "loyalty"
                ? "Fidéliser"
                : "Propulser"
            } automatiquement au moment choisi.`}
            recipientCount={preparedRecipientsCount}
            subject={campaignDisplayPreview?.subject || "(sans objet)"}
            saving={validationScheduleState === "saving"}
            error={null}
            successMessage="Programmation réussie."
            savingLabel="Programmation en cours…"
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
                showNotice("Campagne programmée mise à jour.");
              }
            }}
          />
        )}

      {automationScheduleEdit && (
        <CampaignScheduleModal
          open={Boolean(automationScheduleEdit)}
          title="Modifier la programmation"
          kicker="Programmation"
          description="Modifiez uniquement la date et l’heure de cette action automatique."
          recipientCount={0}
          subject={automationScheduleEdit.label}
          showSummary={!["publish", "stats"].includes(automationScheduleEdit.key)}
          saving={scheduleMutationState === "saving"}
          error={automationScheduleEditError}
          confirmLabel="Enregistrer"
          savingLabel="Enregistrement…"
          successMessage="Programmation mise à jour."
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
          title="Modifier la programmation"
          kicker="Programmation"
          description="Modifiez uniquement la date et l’heure de cette action programmée."
          recipientCount={0}
          subject={scheduleOnlyEdit.label}
          showSummary={false}
          saving={scheduleMutationState === "saving"}
          error={scheduleOnlyEditError}
          confirmLabel="Enregistrer"
          savingLabel="Enregistrement…"
          successMessage="Programmation mise à jour."
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
            aria-label="Aide iNr’Agent"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setHelpOpen(false)}
              aria-label="Fermer"
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>Helper</p>
            <h2>Qu’est-ce qu’iNr’Agent&nbsp;?</h2>
            <div className={styles.helpContent}>
              <p>
                iNr’Agent est votre programmateur d’automatisations. Il prépare
                des actions avec vos outils iNrCy, affiche un aperçu clair, puis
                vous gardez la main avec Valider ou Refuser quand une validation
                est nécessaire.
              </p>
              <ul>
                <li>
                  <strong>Publier</strong> prépare des publications avec Booster
                  / Publier sur vos canaux connectés. L’aperçu se consulte canal
                  par canal grâce au sélecteur situé sous la zone de
                  prévisualisation.
                </li>
                {!standardMode ? (
                  <>
                    <li>
                      <strong>Propulser</strong> prépare des campagnes Propulser
                      par mail, basées sur vos contenus et templates.
                    </li>
                    <li>
                      <strong>Fidéliser</strong> prépare des campagnes Fidéliser
                      par mail pour garder le lien avec le CRM.
                    </li>
                  </>
                ) : null}
                <li>
                  <strong>Statistiques</strong> génère un bilan iNr’Stats PDF
                  multi-pages et l’envoie automatiquement au pro selon les
                  réglages.
                </li>
              </ul>
              <p>
                Les roues de réglages permettent de choisir la fréquence, le
                jour, l’horaire, les rubriques et le mode de validation de
                chaque automatisation. Les publications réalisées restent dans
                l’historique iNr’Send, avec la pastille iNr’Agent quand elles
                viennent de l’automatisation.
              </p>
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
            aria-label={settingsAutomation.settingsTitle}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setSettingsKey(null)}
              aria-label="Fermer"
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>Automatisation</p>
            <h2>{settingsAutomation.settingsTitle}</h2>

            <label className={styles.switchLine}>
              <span>
                <strong>Statut</strong>
                <small>
                  {settingsConnectedChannelMessage ||
                    (settingsConfig.enabled
                      ? "Le robot peut préparer cette action."
                      : "Cette automatisation est en pause.")}
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
                <span>Fréquence</span>
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
                        {frequency.label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {settingsConfig.frequency === "2 fois par semaine" ? (
                normalizeConfigScheduleSlots(settingsConfig)
                  .slice(0, 2)
                  .map((slot, index) => (
                    <div
                      className={styles.scheduleSlotPair}
                      key={`${settingsAutomation.key}-slot-${index}`}
                    >
                      <label>
                        <span>Jour {index + 1}</span>
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
                            <option key={day}>{day}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Horaire {index + 1}</span>
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
                    <span>Jour</span>
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
                        <option key={day}>{day}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Horaire</span>
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
                <span>Validation</span>
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
                        {validation.label}
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
                    <span>Canal</span>
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
                              {channel.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={styles.campaignEditHint}>
                        {connectedChannelsLoadState === "loading"
                          ? "Chargement des canaux connectés..."
                          : connectedChannelMessage(settingsAutomation)}
                      </p>
                    )}
                  </div>

                  <div className={styles.modalSection}>
                    <span>
                      {settingsAutomation.key === "grow"
                        ? "Rubriques Propulser"
                        : "Rubriques Fidéliser"}
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
                            {theme}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <label className={styles.signatureSwitchLine}>
                  <span>
                    <strong>Signature automatique</strong>
                    <small>
                      Activée par défaut pour ajouter la signature configurée au
                      moment de l’envoi.
                    </small>
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
                        ? "Canaux Booster / Publier"
                        : "Canal"}
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
                              {channel.name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className={styles.campaignEditHint}>
                        {connectedChannelsLoadState === "loading"
                          ? "Chargement des canaux connectés..."
                          : connectedChannelMessage(settingsAutomation)}
                      </p>
                    )}
                  </div>
                )}

                <div className={styles.modalSection}>
                  <span>
                    {settingsAutomation.key === "stats"
                      ? "Rubriques iNr’Stats"
                      : "Thèmes"}
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
                          {theme}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <p className={styles.modalNote}>
              Source des idées : {settingsConfig.source}
            </p>
            {prepareProgress?.key === settingsAutomation.key && (
              <div
                className={styles.prepareProgressCard}
                role="status"
                aria-live="polite"
              >
                <div>
                  <strong>Préparation en cours</strong>
                  <span>{prepareProgress.label}</span>
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
                  ? "Enregistrement..."
                  : "Enregistrer les réglages"}
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
                    ? "Envoi du bilan..."
                    : prepareProgress?.key === settingsAutomation.key
                      ? "Préparation..."
                      : "Préparation..."
                  : settingsAutomation.key === "stats"
                    ? "Envoyer un bilan"
                    : "Préparer maintenant"}
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
            aria-label="Préparer une nouvelle campagne"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.modalClose}
              onClick={() => setPrepareNowConfirm(null)}
              aria-label="Fermer"
              disabled={Boolean(testNowKey) || prepareActionState === "saving"}
            >
              ×
            </button>
            <p className={styles.modalEyebrow}>Campagne iNr’Agent</p>
            <h2>Préparer une nouvelle campagne ?</h2>
            <div className={styles.campaignDraftNotice}>
              <span aria-hidden>⚠️</span>
              <div>
                <strong>
                  Une campagne {prepareNowConfirm.label} est déjà en attente de
                  validation.
                </strong>
                <p>
                  Si vous continuez, la campagne actuelle sera automatiquement
                  enregistrée en brouillon dans iNrSend, puis une nouvelle
                  campagne sera préparée à sa place dans iNrAgent.
                </p>
              </div>
            </div>
            <div className={styles.campaignDraftSummary}>
              <small>Action</small>
              <strong>{prepareNowConfirm.label}</strong>
              <small>Campagne en cours</small>
              <strong>
                {prepareNowConfirm.pendingCount} campagne
                {prepareNowConfirm.pendingCount > 1 ? "s" : ""} à enregistrer en
                brouillon
              </strong>
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                onClick={() => setPrepareNowConfirm(null)}
                disabled={
                  Boolean(testNowKey) || prepareActionState === "saving"
                }
              >
                Annuler
              </button>
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
                    ? "Préparation..."
                    : "Préparation..."
                  : "Préparer maintenant"}
              </button>
            </div>
          </section>
        </div>
      )}

      {notice && <div className={styles.notice}>{notice}</div>}
    </main>
  );
}
