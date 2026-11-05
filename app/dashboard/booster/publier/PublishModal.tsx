import { createPublicationSubmission } from "./publicationSubmission";
import { loadPublicationDraft, savePublicationDraft } from "./publicationDraftSession";
import { useBoosterGeneration } from "./useBoosterGeneration";
import { useDashboardViewerAccess } from "../../_components/DashboardViewerAccessProvider";
import { useInrAssistantScreen } from "../../_components/DashboardAssistantScreenContext";
import { useTranslations } from "next-intl";
import PublishWizardFrame, { PublishWizardScreen } from "./components/PublishWizardFrame";
import { canOpenPublishWizardStep, getPublishWizardSteps, type PublishWizardStep } from "./components/publishWizard";
import wizardStyles from "./components/publishWizard.module.css";
import intentStyles from "./components/PublishIntentPanel.module.css";
import PublishContentAdjustmentModal from "./components/PublishContentAdjustmentModal";

import { getActionablePublicationWarningCodes, getPublicationMediaPoolDefaults } from "./publicationMediaPool";
import { setImageKeysForChannel } from "./imageChannelAssignment";
import TiktokReviewCheckbox from "./components/TiktokReviewCheckbox";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { mergeBoosterChannelDetails, readBoosterChannelIdentitySeed, readBoosterConnectionSnapshot, writeBoosterConnectionSnapshot, type BoosterChannelIdentitySeed } from "./publishConnectionSnapshot";
import { getActiveBrowserUserId, resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { ACTIVE_INRCY_ACCOUNT_EVENT } from "@/lib/multicompte/constants";
import PublishExecutionResultModal, { PublishExecutionResultActions, type PublishExecutionSummary } from "../../_components/PublishExecutionResultModal";
import { type PublicationProgressDestination } from "../../_components/PublishExecutionProgress";

import { publicationStorySequenceResumeRef } from "@/lib/publicationStorySequenceRetry";
import { type MediaSoundtrackByChannel } from "@/lib/mediaSoundtrackSelection";
import MediaSoundtrackSelector from "@/app/dashboard/_components/MediaSoundtrackSelector";
import { subscribeToChannelConnectionUpdates } from "@/lib/channelConnectionUpdates";
import { createClient } from "@/lib/supabaseClient";
import { prewarmBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";

import { validateBoosterDocumentSelection } from "@/lib/boosterDocumentAttachmentPolicy";


import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import { GENERATION_PROGRESS_PHASES, PUBLICATION_PROGRESS_PHASES, PUBLICATION_PROGRESS_STAGES, getProgressPhase, getProgressPhaseIndex, getPublicationProgressStage, getPublicationProgressStageForValue, type PublicationProgressPhaseKey } from "@/lib/boosterProgressPhases";


import { DEFAULT_AI_PREFERRED_ENGINE, normalizeAiPreferredEngine, type AiPreferredEngine } from "@/lib/aiEnginePreference";
import {
  readPinterestBoardUiCache,
  writePinterestBoardUiCache,
} from "@/lib/pinterestUiSessionCache";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import { readSanitizedElementHtml } from "@/lib/sanitizeHtml";
import { type VideoAiContextReference } from "@/lib/videoAiContextReference";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { INR_SEARCH_CONTENT_MAX_LENGTH } from "@/lib/boosterChannelRules";
import {
  buildCtaTextForChannel,
  sanitizeBoosterPostForStructuredCta,
} from "@/lib/boosterCta";
import { getBoosterPublicationTextPreview } from "@/lib/boosterPublicationTextPreview";
import { normalizeAiChannelCtaMap } from "@/lib/aiChannelCtaPreferences";
import {
  X_POST_WEIGHTED_LENGTH_MAX,
  getXPostTextMetrics,
} from "@/lib/xChannel";
import {
  getBoosterXForbiddenUrlFields,
  getBoosterXUrlBlockerMessage,
} from "@/lib/boosterXUrlPolicy";
import {
  editableHtmlToSiteText,
  stripSiteTextFormatting,
  stripSiteTextFormattingPreserveLayout,
} from "@/lib/boosterFormatting";
import stylesDash from "../../dashboard.module.css";
import { BOOSTER_IMAGE_ACCEPT, BOOSTER_MAX_IMAGE_COUNT, BOOSTER_MAX_IMAGE_BYTES, BOOSTER_MAX_VIDEO_BYTES, BOOSTER_VIDEO_ACCEPT, BOOSTER_VIDEO_FORMATS_LABEL, CHANNEL_LABELS, CHANNEL_PRESETS, buildPreferredCtaPatch, channelSupportsImages, channelSupportsTextOnly, getChannelPublicationRequirements, getLocalizedChannelPublicationRequirement, getLocalizedChannelLabel, normalizeBoosterPreferredCta, getWebsiteUrlForChannel, getOptimizedTransform, getBoosterMaxImageCountForChannel, getLocalizedVideoAdaptationModeLabel, getLocalizedVideoFormatLabel, VIDEO_FORMAT_ASPECT_RATIOS, extractVideoFramesForAI, fileToBoosterAiImagePayload, makeImageKey, isBoosterVideoFile, isSiteDisplayKey, normalizeBoosterAiLanguage, normalizePost, normalizeVideoAdaptationMode, normalizeVideoFormat, parseInstagramHashtagsInput, type BoosterAiImagePayload, type BoosterCtaDefaults, type BoosterPreferredCta, type ChannelImageEditorState, type ChannelKey, type ChannelMediaMode, type ChannelPost, type VideoAdaptationMode, type VideoFormat, type DisplayKey, type ImageMeta, type PublicationMediaType, type StyleKey, type ThemeKey, type BoosterVideoSourceMetadata, type VideoPayload } from "./publishModal.shared";
import { AI_CONFIGURATION_STORAGE_KEY, CHANNEL_KEYS as ALL_CHANNEL_KEYS, EMPTY_CHANNEL_DETAILS, buildVideoFileName, buildVideoOrientation, buildVideoRatioLabel, getVideoOrientationLabel, isChannelKey, makeVideoTranscriptCacheKey, normalizeExternalHref, prefillConfiguredChannelCtas, sanitizePatchForEditor, sanitizePostForEditor, simplifyChannelDetail, truncateText, type ChannelConnectionDetail, type PendingImmediatePublishAfterSchedule, type PinterestBoardOption, type VideoFramesPreparationCache } from "./publishModal.foundations";
import {
  preloadPreparedImagePreview,
  readVideoSourceMetadata,
} from "./publishModal.videoAiRuntime";

import PublishAiConfigurationDrawer from "./components/PublishAiConfigurationDrawer";
import PublishChannelSelector from "./components/PublishChannelSelector";
import PublishFinalReviewModal from "./components/PublishFinalReviewModal";
import TiktokPublicationSettingsModal, {
  type TiktokPublicationSettings,
} from "./components/TiktokPublicationSettingsModal";
import PublishFooterActions from "./components/PublishFooterActions";
import PublishScheduleModal, {
  type PublishScheduleSelection,
} from "./components/PublishScheduleModal";
import PublishIntentPanel from "./components/PublishIntentPanel";
import PublishCreationModePanel from "./components/PublishCreationModePanel";
import PublishContentEditorPanel from "./components/PublishContentEditorPanel";
import PublishMediaPoolPanel from "./components/PublishMediaPoolPanel";
import PublishValidationBoard from "./components/PublishValidationBoard";
import PublishValidationChannelOptions from "./components/PublishValidationChannelOptions";
import PublishHelpModal from "./components/PublishHelpModal";
import PublishWarningModals from "./components/PublishWarningModals";
import {
  clearInrStudioHandoff,
  consumeInrStudioReturn,
  createInrStudioHandoff,
  type InrStudioReturnedMedia,
} from "@/lib/inrStudioNavigation";
import usePublishImageController from "./usePublishImageController";
import { useInrStudioSession } from "@/app/dashboard/_hooks/useInrStudioSession";
import usePersistentMediaWorkspace, {
  type PersistentWorkspaceMediaState,
} from "./usePersistentMediaWorkspace";
import { isUnifiedMediaConsumptionClientEnabled } from "@/lib/mediaPipelineUnifiedConsumptionPolicy";
import { buildMediaLibraryDownloadFileName } from "@/lib/mediaLibraryFileName";
import { isLegacyMediaTransportCutoverClientEnabled } from "@/lib/mediaPipelineLegacyCutoverPolicy";
import {
  hasCompleteVideoMetadata,
  mergeTransferredMediaMetadata,
  normalizeTransferredMediaMetadata,
  type TransferableMediaMetadata,
} from "@/lib/mediaMetadataTransfer";
import { getBoosterCreationWorkflow, getBoosterPublicationWorkflowSteps, type BoosterCreationMode } from "@/lib/boosterCreationMode";
import {
  normalizeYoutubeLongUploadsStatus,
  type YoutubeLongUploadsStatus,
} from "@/lib/videoPublicationPolicy";
import { CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES, normalizeThreadsPublicationPreferences, type ThreadsPublicationMode, type ThreadsPublicationPreferences } from "@/lib/threadsPublicationPreferences";
import { getEffectiveThreadsMediaMode, getThreadsPublicationModeIssue } from "./threadsPublicationUi";
import {
  CLASSIC_ONLY_INSTAGRAM_PUBLICATION_PREFERENCES,
  normalizeInstagramPublicationPreferences,
  type InstagramPublicationPreferences,
} from "@/lib/instagramPublicationPreferences";
import {
  CLASSIC_ONLY_FACEBOOK_PUBLICATION_PREFERENCES,
  normalizeFacebookPublicationPreferences,
  type FacebookPublicationPreferences,
} from "@/lib/facebookPublicationPreferences";
import {
  buildMetaPublicationSelection,
  normalizeMetaPublicationSelection,
  stripMetaStoryOnlyPostContent,
  type MetaPrimaryPublicationPlacement,
} from "@/lib/metaPublicationTargets";
import { buildWorkspaceMediaClientKey, type MediaWorkspaceMediaSummary } from "@/lib/mediaWorkspaceClient";
import {
  MEDIA_WORKSPACE_READINESS_TIMEOUT_MS,
  withMediaWorkspaceDeadline,
} from "@/lib/mediaWorkspaceTimeout";
import usePublishVideoController, { normalizeRestoredVideoVariants } from "./usePublishVideoController";
import { assignVideoSourceToChannel } from "./videoChannelAssignment";
import {
  getGenerationMediaSelectionError,
  getGenerationMediaSelectionPolicy,
} from "./generationMediaSelection";
import { isCompleteMediaLibraryDownload, resolvePublishImagePreparation } from "./publishImageRecovery";

import InrcyCameraCaptureModal from "@/app/dashboard/_components/InrcyCameraCaptureModal";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import MediaOptimizerModal, {
  type MediaOptimizerItem,
} from "@/app/dashboard/_components/MediaOptimizerModal";
import { detectUniversalUploadMediaType } from "@/lib/mediaUploadPolicy";
import {
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
  getMediaLibraryOptimizationRequirements,
} from "@/lib/mediaLibraryOptimizationPolicy";


type BoosterMediaInsertionDestination =
  | { kind: "generation" }
  | { kind: "publication" }
  | { kind: "channel"; channel: ChannelKey };

type BoosterMediaOptimizerRequest = {
  source:
    | { kind: "file"; file: File }
    | { kind: "library"; item: MediaOptimizerItem };
  mediaType: "image" | "video";
  destination: BoosterMediaInsertionDestination;
};

function buildTransferredBoosterVideoMetadata(
  file: Pick<File, "size" | "type">,
  preferred: TransferableMediaMetadata | null | undefined,
  fallback?: TransferableMediaMetadata | null,
): BoosterVideoSourceMetadata | null {
  const metadata = mergeTransferredMediaMetadata(preferred, fallback);
  if (!metadata.width && !metadata.height && !metadata.durationSeconds) {
    return null;
  }
  const existing =
    preferred &&
    typeof preferred === "object" &&
    "orientationLabel" in preferred
      ? (preferred as Partial<BoosterVideoSourceMetadata>)
      : null;
  const orientation = buildVideoOrientation(metadata.width, metadata.height);
  return {
    ...(existing || {}),
    width: metadata.width,
    height: metadata.height,
    duration: metadata.durationSeconds,
    size: Number(file.size || 0),
    type: file.type || "video/mp4",
    ratio:
      metadata.width && metadata.height
        ? metadata.width / metadata.height
        : null,
    ratioLabel: buildVideoRatioLabel(metadata.width, metadata.height),
    orientation,
    orientationLabel: getVideoOrientationLabel(orientation),
  };
}

function getBoosterMediaOptimizerRequirements(
  request: BoosterMediaOptimizerRequest,
) {
  const sourceFile = request.source.kind === "file" ? request.source.file : null;
  const sourceItem = request.source.kind === "library" ? request.source.item : null;
  return getMediaLibraryOptimizationRequirements({
    mediaType: request.mediaType,
    sizeBytes: sourceFile?.size || sourceItem?.size_bytes || 0,
    targetBytes:
      request.mediaType === "video"
        ? BOOSTER_MAX_VIDEO_BYTES
        : BOOSTER_MAX_IMAGE_BYTES,
    name:
      sourceFile?.name ||
      sourceItem?.original_file_name ||
      sourceItem?.storage_path ||
      sourceItem?.title,
    mimeType: sourceFile?.type || sourceItem?.mime_type,
  });
}

const PUBLICATION_PHASE_MESSAGE_KEYS: Record<PublicationProgressPhaseKey, string> = {
  verification: "publication_request_received",
  channel_verification: "publication_checking_channels",
  media_verification: "publication_checking_media",
  media_preparation: "progress_media_preparation",
  file_preparation: "publication_preparing_sends",
  channel_dispatch: "publication_publishing_channels",
  publication_finalization: "publication_publishing_channels",
  status_collection: "publication_platform_confirmation",
  inrsend_recording: "publication_recording_inrsend",
  final_wait: "publication_phase_final_wait",
  complete: "publication_phase_complete",
};

const PUBLICATION_STAGE_MESSAGE_KEYS = [
  "publication_request_received",
  "publication_checking_channels",
  "publication_checking_media",
  "progress_media_preparation",
  "publication_preparing_sends",
  "publication_publishing_channels",
  "publication_platform_confirmation",
  "publication_recording_inrsend",
  "publication_phase_final_wait",
  "publication_phase_complete",
] as const;

export default function PublishModal({
  styles,
  onClose,
  trackEvent,
  onPublishSuccess,
  publicationResult,
  onOverlayOpenChange,
  onUnsavedChange,
  saveDraftActionRef,
  openHelpActionRef,
  onDraftHeaderStateChange,
  onWizardModeChange,
  initialConnectedChannels,
  initialChannelIdentity,
  companyName,
}: {
  styles: typeof stylesDash;
  onClose: () => void;
  trackEvent: (type: "publish", payload: Record<string, any>) => Promise<any>;
  onPublishSuccess?: (result?: any) => void;
  publicationResult?: {
    summary: PublishExecutionSummary | null;
    retrying: boolean;
    error?: string;
    onRetryFailed?: () => void | Promise<void>;
    onOpenInrSend: () => void;
  };
  onOverlayOpenChange?: (open: boolean) => void;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  onWizardModeChange?: (mode: BoosterCreationMode | null) => void;
  saveDraftActionRef?: MutableRefObject<(() => void) | null>;
  openHelpActionRef?: MutableRefObject<(() => void) | null>;
  onDraftHeaderStateChange?: (state: {
    saving: boolean;
    draftSaving: boolean;
    generating: boolean;
    draftMessage: string;
  }) => void;
  initialConnectedChannels?: Partial<Record<ChannelKey, boolean>>;
  initialChannelIdentity?: BoosterChannelIdentitySeed;
  companyName?: string;
}) {
  const { metaPilotEnabled, activeAccountId, actorUserId } = useDashboardViewerAccess();
  const CHANNEL_KEYS = useMemo(() => ALL_CHANNEL_KEYS.filter((key) => key !== "threads" || metaPilotEnabled), [metaPilotEnabled]);
  const i18nT = useTranslations("booster");
  const mediaT = useTranslations("media");
  const runtimeT = i18nT as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const publicationDraftIdParam = String(
    searchParams?.get("draftId") || "",
  ).trim();
  const [loadedPublicationDraftId, setLoadedPublicationDraftId] = useState<
    string | null
  >(null);
  const [pendingStudioReturn, setPendingStudioReturn] =
    useState<InrStudioReturnedMedia | null>(null);
  const studioReturnApplyingKeyRef = useRef("");
  const inlineStudioReturnKeyRef = useRef("");
  const studioOpeningRef = useRef(false);
  const { openStudio, studio, completeReturn } = useInrStudioSession({
    onReturned: (result) => {
      inlineStudioReturnKeyRef.current = result.returnKey;
      setPendingStudioReturn(result);
    },
    onClosed: () => { studioOpeningRef.current = false; },
  });
  const lastSavedStudioVideoDraftRef = useRef<VideoPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [idea, setIdea] = useState("");
  const [publicationInstruction, setPublicationInstruction] = useState("");
  const [contentAdjustmentSession, setContentAdjustmentSession] = useState<{ idea: string; instruction: string; channels: ChannelKey[] } | null>(null);
  const { onGenerate, generating, generationInFlightRef, generationProgress,
    generationPhaseIndex, generationPhaseLabel, generationStage, genError,
    generationNotice, generationMediaWarning, setGenError, setGenerationNotice,
    setGenerationMediaWarning, resetGenerationProgress, setGenerationProgressPhase } = useBoosterGeneration({
    i18nT, runtimeT,
    readContext: () => ({
      intent: { creationMode, idea, publicationInstruction, selectedForGeneration, selectedChannels, selectedAiPreferredEngine, hasWrittenChannelContent, theme, contentStyle },
      media: { videoFile, videoPreviewUrl, videoDurationSeconds, videoStorageContext, images, useImagesForAI, documentFiles, videoAiContextRef, getOrPrepareAiImagePayload, getOrPrepareVideoFramesForAI },
      workspace: { unifiedMediaConsumptionClientAvailable, mediaWorkspaceId, waitForPersistentWorkspaceReadiness, persistentMediaWorkspaceEnabled, startPersistentAiMediaPreparation, mediaPipelineCutoverEnabled, ensurePersistentMediaWorkspace },
      editor: { publicationActorScopeRef, currentPostsRef, getDisplayPost, getLiveInstagramHashtags, xHashtagsInput, ctaDefaults, setImgError, setDuplicateFeedback, setPostsByChannel, setIdea, setPublicationInstruction, setXHashtagsInput, setContentAdjustmentSession, setDocumentFiles, setPdfAttachmentError, pdfInputRef, setContentWorkspaceOpen, setSynchronizedActiveChannel, scrollToContentWorkspace },
    }),
  });
  const [documentFiles, setDocumentFiles] = useState<File[]>([]);
  const pdfFile = documentFiles[0] || null;
  const [pdfAttachmentError, setPdfAttachmentError] = useState("");
  const [theme, setTheme] = useState<ThemeKey>("");
  const [contentStyle, setContentStyle] = useState<StyleKey>("equilibre");
  const [creationMode, setCreationMode] =
    useState<BoosterCreationMode | null>(null);
  const [creationModeError, setCreationModeError] = useState("");

  const videoFramesForAiCacheRef = useRef<VideoFramesPreparationCache | null>(
    null,
  );
  const aiImagePayloadCacheRef = useRef<
    Map<string, Promise<BoosterAiImagePayload>>
  >(new Map());

  const getOrPrepareVideoFramesForAI = useCallback((file: File) => {
    const key = makeVideoTranscriptCacheKey(file);
    const cached = videoFramesForAiCacheRef.current;
    if (cached?.key === key) return cached.promise;

    const preparationPromise = extractVideoFramesForAI(file).catch((error) => {
      if (videoFramesForAiCacheRef.current?.promise === preparationPromise) {
        videoFramesForAiCacheRef.current = null;
      }
      throw error;
    });

    videoFramesForAiCacheRef.current = {
      key,
      promise: preparationPromise,
    };
    return preparationPromise;
  }, []);

  const [publishError, setPublishError] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [contentVoiceBusy, setContentVoiceBusy] = useState(false);
  const [intentVoiceBusy, setIntentVoiceBusy] = useState(false);
  const voiceInputBusy = contentVoiceBusy || intentVoiceBusy;
  const [draftMessage, setDraftMessage] = useState("");
  const [lastPublicationDraftSnapshot, setLastPublicationDraftSnapshot] =
    useState<string | null>(null);
  const [videoAiContextRef, setVideoAiContextRef] =
    useState<VideoAiContextReference | null>(null);

  useEffect(() => {
    onDraftHeaderStateChange?.({ saving, draftSaving, generating, draftMessage });
  }, [saving, draftSaving, generating, draftMessage, onDraftHeaderStateChange]);
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishProgressLabel, setPublishProgressLabel] = useState("");
  const [publishProgressPhaseIndex, setPublishProgressPhaseIndex] = useState(0);
  const [publishProgressPhaseLabel, setPublishProgressPhaseLabel] = useState("");
  const [publicationDestinations, setPublicationDestinations] = useState<PublicationProgressDestination[]>([]);
  const latestPublicationSummaryRef = useRef<PublishExecutionSummary | null>(null);
  const [soundtrackByChannel, setSoundtrackByChannel] = useState<MediaSoundtrackByChannel>({});
  const publicationActorScopeRef = useRef({ actorUserId, accountId: activeAccountId });
  const [livePublicationResult, setLivePublicationResult] = useState<{
    source: PublishExecutionSummary | null | undefined;
    summary: PublishExecutionSummary;
  } | null>(null);
  useEffect(() => {
    publicationActorScopeRef.current = { actorUserId, accountId: activeAccountId };
    latestPublicationSummaryRef.current = null;
    setLivePublicationResult(null);
    setSoundtrackByChannel({});
    setContentAdjustmentSession(null);
  }, [actorUserId, activeAccountId]);
  const handlePublicationSummaryChange = useCallback((summary: PublishExecutionSummary) => {
    latestPublicationSummaryRef.current = summary;
    setLivePublicationResult((current) => current?.summary === summary
      ? current
      : { source: publicationResult?.summary, summary });
  }, [publicationResult?.summary]);
  const publicationSummaryForActions = livePublicationResult?.source === publicationResult?.summary
    ? livePublicationResult?.summary || publicationResult?.summary
    : publicationResult?.summary;
  const publishProgressTargetRef = useRef(0);
  const publishProgressPhaseIndexRef = useRef(0);
  const phasedPublicationProgressRef = useRef(false);
  const publishStartGuardRef = useRef(false);
  const scheduleStartGuardRef = useRef(false);
  const [postsByChannel, setPostsByChannel] = useState<
    Partial<Record<ChannelKey, ChannelPost>>
  >({});
  const [contentWorkspaceOpen, setContentWorkspaceOpen] = useState(false);
  const currentPostsRef = useRef(postsByChannel);
  useEffect(() => { currentPostsRef.current = postsByChannel; }, [postsByChannel]);
  const [wizardStep, setWizardStep] = useState<PublishWizardStep>("mode");
  const [intentActionsContainer, setIntentActionsContainer] = useState<HTMLDivElement | null>(null);
  const [contentActionsContainer, setContentActionsContainer] = useState<HTMLDivElement | null>(null);
  const [channelActionsContainer, setChannelActionsContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => { onWizardModeChange?.(creationMode); }, [creationMode, onWizardModeChange]);
  const [selectedActiveCard, setActiveCard] = useState<DisplayKey>("site_web");
  const activeCard = selectedActiveCard === "threads" && !metaPilotEnabled ? "site_web" : selectedActiveCard;
  const [isMobile, setIsMobile] = useState(false);
  const [drawerViewportHeight, setDrawerViewportHeight] = useState<
    number | null
  >(null);
  const [duplicateFeedback, setDuplicateFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [publishHelpOpen, setPublishHelpOpen] = useState(false);

  useEffect(() => {
    if (!openHelpActionRef) return;
    openHelpActionRef.current = () => setPublishHelpOpen(true);
    return () => {
      openHelpActionRef.current = null;
    };
  }, [openHelpActionRef]);
  const [aiConfigurationOpen, setAiConfigurationOpen] = useState(false);
  const [defaultAiPreferredEngine, setDefaultAiPreferredEngine] =
    useState<AiPreferredEngine>(DEFAULT_AI_PREFERRED_ENGINE);
  const [selectedAiPreferredEngine, setSelectedAiPreferredEngine] =
    useState<AiPreferredEngine>(DEFAULT_AI_PREFERRED_ENGINE);
  const aiEngineRestoredFromDraftRef = useRef(false);
  const [instagramHashtagsInput, setInstagramHashtagsInput] = useState("");
  const [xHashtagsInput, setXHashtagsInput] = useState("");
  const [threadsPublicationMode, setThreadsPublicationMode] = useState<ThreadsPublicationMode>("classic");
  const [threadsPublicationPreferences, setThreadsPublicationPreferences] = useState<ThreadsPublicationPreferences>(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
  const threadsPublicationPreferencesRef = useRef<ThreadsPublicationPreferences>(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
  const threadsModeTouchedRef = useRef(Boolean(publicationDraftIdParam));
  const [threadsPreferencesRequestLoading, setThreadsPreferencesLoading] = useState(true);
  const [threadsPreferencesAccountId, setThreadsPreferencesAccountId] = useState<string | null | undefined>(undefined);
  const threadsPreferencesLoading = threadsPreferencesRequestLoading || threadsPreferencesAccountId !== activeAccountId;
  const [threadsPreferencesFailed, setThreadsPreferencesFailed] = useState(false);
  const onThreadsPublicationModeChange = (mode: ThreadsPublicationMode) => {
    if (!metaPilotEnabled || (mode === "ghost" && (threadsPreferencesLoading || threadsPreferencesFailed || !threadsPublicationPreferences.ghostEnabled))) return;
    threadsModeTouchedRef.current = true;
    setThreadsPublicationMode(mode);
  };
  const [instagramPublicationPlacement, setInstagramPublicationPlacement] =
    useState<MetaPrimaryPublicationPlacement>("classic");
  const [instagramStoryEnabled, setInstagramStoryEnabled] = useState(false);
  const [instagramPublicationPreferences, setInstagramPublicationPreferences] =
    useState<InstagramPublicationPreferences>(
      CLASSIC_ONLY_INSTAGRAM_PUBLICATION_PREFERENCES,
    );
  const instagramPublicationPreferencesRef =
    useRef<InstagramPublicationPreferences>(
      CLASSIC_ONLY_INSTAGRAM_PUBLICATION_PREFERENCES,
    );
  const instagramPlacementTouchedRef = useRef(
    Boolean(publicationDraftIdParam),
  );
  const [facebookPublicationPlacement, setFacebookPublicationPlacement] =
    useState<MetaPrimaryPublicationPlacement>("classic");
  const [facebookStoryEnabled, setFacebookStoryEnabled] = useState(false);
  const [facebookPublicationPreferences, setFacebookPublicationPreferences] =
    useState<FacebookPublicationPreferences>(
      CLASSIC_ONLY_FACEBOOK_PUBLICATION_PREFERENCES,
    );
  const facebookPublicationPreferencesRef =
    useRef<FacebookPublicationPreferences>(
      CLASSIC_ONLY_FACEBOOK_PUBLICATION_PREFERENCES,
    );
  const facebookPlacementTouchedRef = useRef(Boolean(publicationDraftIdParam));
  const [emptyContentWarningChannels, setEmptyContentWarningChannels] =
    useState<ChannelKey[]>([]);
  const [emptyContentWarningIndex, setEmptyContentWarningIndex] = useState(0);
  const [finalReviewOpen, setFinalReviewOpen] = useState(false);
  const [finalReviewPosts, setFinalReviewPosts] = useState<Partial<
    Record<ChannelKey, ChannelPost>
  > | null>(null);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleReviewPosts, setScheduleReviewPosts] = useState<Partial<
    Record<ChannelKey, ChannelPost>
  > | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [pendingScheduleRequest, setPendingScheduleRequest] = useState<{
    selections: PublishScheduleSelection[];
    immediateChannels: ChannelKey[];
    preparedPostsByChannel: Partial<Record<ChannelKey, ChannelPost>>;
  } | null>(null);
  const [
    pendingImmediatePublishAfterSchedule,
    setPendingImmediatePublishAfterSchedule,
  ] = useState<PendingImmediatePublishAfterSchedule | null>(null);
  const [tiktokSettingsOpen, setTiktokSettingsOpen] = useState(false);
  const [tiktokSettingsFlow, setTiktokSettingsFlow] = useState<
    "publish" | "schedule" | "review" | null
  >(null);
  const [tiktokPublicationSettings, setTiktokPublicationSettings] =
    useState<TiktokPublicationSettings | null>(null);
  const [tiktokReviewSignature, setTiktokReviewSignature] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadInstagramPreferences = async () => {
      try {
        const response = await fetch(
          "/api/integrations/instagram/publication-preferences",
          { cache: "no-store", credentials: "include" },
        );
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        const preferences = normalizeInstagramPublicationPreferences(
          payload?.preferences,
        );
        instagramPublicationPreferencesRef.current = preferences;
        setInstagramPublicationPreferences(preferences);
        if (
          !publicationDraftIdParam &&
          !instagramPlacementTouchedRef.current
        ) {
          const selection = normalizeMetaPublicationSelection({
            placement: preferences.defaultMode,
          });
          setInstagramPublicationPlacement(
            selection.primaryPlacement === "reel" &&
              preferences.reelsEnabled
              ? "reel"
              : selection.primaryPlacement === "story" &&
                  preferences.storiesEnabled
                ? "story"
              : "classic",
          );
          setInstagramStoryEnabled(
            selection.primaryPlacement !== "story" &&
              selection.includeStory &&
              preferences.storiesEnabled,
          );
        } else {
          setInstagramPublicationPlacement((current) =>
            current === "reel" && preferences.reelsEnabled
              ? "reel"
              : current === "story" && preferences.storiesEnabled
                ? "story"
                : "classic",
          );
          setInstagramStoryEnabled((current) =>
            current && preferences.storiesEnabled,
          );
        }
      } catch {
        // Fail closed: Classique reste le seul format disponible tant que les
        // préférences du compte ne peuvent pas être confirmées.
      }
    };
    void loadInstagramPreferences();
    return () => {
      cancelled = true;
    };
  }, [publicationDraftIdParam]);

  useEffect(() => {
    let cancelled = false;
    const loadFacebookPreferences = async () => {
      try {
        const response = await fetch(
          "/api/integrations/facebook/publication-preferences",
          { cache: "no-store", credentials: "include" },
        );
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        const preferences = normalizeFacebookPublicationPreferences(
          payload?.preferences,
        );
        facebookPublicationPreferencesRef.current = preferences;
        setFacebookPublicationPreferences(preferences);
        if (!publicationDraftIdParam && !facebookPlacementTouchedRef.current) {
          const selection = normalizeMetaPublicationSelection({
            placement: preferences.defaultMode,
          });
          setFacebookPublicationPlacement(
            selection.primaryPlacement === "reel" &&
              preferences.reelsEnabled
              ? "reel"
              : selection.primaryPlacement === "story" &&
                  preferences.storiesEnabled
                ? "story"
              : "classic",
          );
          setFacebookStoryEnabled(
            selection.primaryPlacement !== "story" &&
              selection.includeStory &&
              preferences.storiesEnabled,
          );
        } else {
          setFacebookPublicationPlacement((current) =>
            current === "reel" && preferences.reelsEnabled
              ? "reel"
              : current === "story" && preferences.storiesEnabled
                ? "story"
                : "classic",
          );
          setFacebookStoryEnabled((current) =>
            current && preferences.storiesEnabled,
          );
        }
      } catch {
        // Fail closed: le flux classique reste disponible si la préférence
        // liée au compte ne peut pas être confirmée.
      }
    };
    void loadFacebookPreferences();
    return () => {
      cancelled = true;
    };
  }, [publicationDraftIdParam]);

  const applyDefaultAiPreferredEngine = useCallback((value: unknown) => {
    const next = normalizeAiPreferredEngine(value);
    setDefaultAiPreferredEngine((previousDefault) => {
      setSelectedAiPreferredEngine((current) =>
        !aiEngineRestoredFromDraftRef.current && current === previousDefault
          ? next
          : current,
      );
      return next;
    });
  }, []);
  const [pendingPublishPosts, setPendingPublishPosts] = useState<Partial<
    Record<ChannelKey, ChannelPost>
  > | null>(null);
  const initialPinterestBoardCache = useMemo(
    () => readPinterestBoardUiCache(),
    [],
  );
  const [pinterestBoards, setPinterestBoards] = useState<
    PinterestBoardOption[]
  >(() => initialPinterestBoardCache?.boards || []);
  const [pinterestBoardId, setPinterestBoardId] = useState(
    () => initialPinterestBoardCache?.defaultBoardId || "",
  );
  const [pinterestBoardName, setPinterestBoardName] = useState(() => {
    const defaultId = initialPinterestBoardCache?.defaultBoardId || "";
    return (
      initialPinterestBoardCache?.boards.find((board) => board.id === defaultId)
        ?.name || ""
    );
  });
  const [pinterestBoardsLoading, setPinterestBoardsLoading] = useState(false);
  const [pinterestBoardsFailure, setPinterestBoardsFailure] = useState<unknown>(null);
  const pinterestBoardsError = pinterestBoardsFailure === null
    ? ""
    : getSimpleFrenchErrorMessage(pinterestBoardsFailure, i18nT("pinterest_boards_load_failed"));

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const videoPickerTargetChannelRef = useRef<ChannelKey | null>(null);
  const [cameraCaptureOpen, setCameraCaptureOpen] = useState(false);
  const [cameraCaptureScope, setCameraCaptureScope] = useState<
    "generation" | "publication"
  >("generation");
  const [cameraCaptureTargetChannel, setCameraCaptureTargetChannel] =
    useState<ChannelKey | null>(null);
  const [mediaLibraryPickerOpen, setMediaLibraryPickerOpen] = useState(false);
  const [mediaLibraryPickerKind, setMediaLibraryPickerKind] = useState<"image" | "video" | "all">("all");
  const [mediaLibraryPickerScope, setMediaLibraryPickerScope] = useState<
    "generation" | "publication"
  >("generation");
  const [preparedWorkspaceMedia, setPreparedWorkspaceMedia] = useState<
    readonly MediaWorkspaceMediaSummary[]
  >([]);
  const [recoveredPreviewErrors, setRecoveredPreviewErrors] = useState<
    Record<string, boolean>
  >({});
  const [restoredClientMediaKeysByImageKey, setRestoredClientMediaKeysByImageKey] =
    useState<Record<string, string>>({});
  const [publicationMediaType, setPublicationMediaType] =
    useState<PublicationMediaType>("images");
  const [channelMediaModes, setChannelMediaModes] = useState<
    Partial<Record<ChannelKey, ChannelMediaMode>>
  >({});
  const [images, setImages] = useState<File[]>([]);
  const imagesRef = useRef<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imgError, setImgError] = useState("");
  const [mediaOptimizerOpen, setMediaOptimizerOpen] = useState(false);
  const [mediaOptimizerPromptOpen, setMediaOptimizerPromptOpen] =
    useState(false);
  const [mediaOptimizerRequest, setMediaOptimizerRequest] =
    useState<BoosterMediaOptimizerRequest | null>(null);
  const [mediaOptimizerQueue, setMediaOptimizerQueue] = useState<
    BoosterMediaOptimizerRequest[]
  >([]);
  const [mediaOptimizerCompleted, setMediaOptimizerCompleted] = useState(false);
  const pendingDirectMediaDestinationRef =
    useRef<BoosterMediaInsertionDestination | null>(null);

  const getMediaLibraryPickerDestination = useCallback(
    (): BoosterMediaInsertionDestination =>
      mediaLibraryPickerScope === "generation"
        ? { kind: "generation" }
        : { kind: "publication" },
    [mediaLibraryPickerScope],
  );

  const openMediaOptimizer = useCallback((item?: MediaLibraryPickerItem) => {
    const isLibraryItem =
      Boolean(item) &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      (item.media_type === "image" || item.media_type === "video");

    if (isLibraryItem) {
      setMediaOptimizerRequest({
        source: { kind: "library", item: item as MediaOptimizerItem },
        mediaType: item!.media_type,
        destination: getMediaLibraryPickerDestination(),
      });
      setMediaOptimizerQueue([]);
      setMediaOptimizerCompleted(false);
    }
    setMediaOptimizerPromptOpen(false);
    setMediaOptimizerOpen(true);
  }, [getMediaLibraryPickerDestination]);

  const registerOversizedMedia = useCallback(
    (file: File, targetChannel?: ChannelKey, queuedFiles: File[] = []) => {
      const destination: BoosterMediaInsertionDestination = targetChannel
        ? { kind: "channel", channel: targetChannel }
        : pendingDirectMediaDestinationRef.current || { kind: "publication" };
      const requests = [file, ...queuedFiles].map<BoosterMediaOptimizerRequest>(
        (candidate) => {
          const detectedType = detectUniversalUploadMediaType({
            name: candidate.name,
            mimeType: candidate.type,
          });
          return {
            source: { kind: "file", file: candidate },
            mediaType: detectedType === "video" ? "video" : "image",
            destination,
          };
        },
      );
      const [first, ...rest] = requests;
      if (!first) return false;
      setMediaOptimizerRequest(first);
      setMediaOptimizerQueue(rest);
      setMediaOptimizerCompleted(false);
      setImgError("");
      setMediaOptimizerOpen(false);
      setMediaOptimizerPromptOpen(true);
      return true;
    },
    [],
  );

  const registerOversizedLibraryMedia = useCallback(
    (item: MediaLibraryPickerItem) => {
      setMediaOptimizerRequest({
        source: { kind: "library", item: item as MediaOptimizerItem },
        mediaType: item.media_type,
        destination: getMediaLibraryPickerDestination(),
      });
      setMediaOptimizerQueue([]);
      setMediaOptimizerCompleted(false);
      setImgError("");
      setMediaOptimizerOpen(false);
      setMediaOptimizerPromptOpen(true);
    },
    [getMediaLibraryPickerDestination],
  );

  const openOversizedMediaOptimizer = useCallback(() => {
    if (!mediaOptimizerRequest) return;
    setMediaOptimizerPromptOpen(false);
    setMediaOptimizerOpen(true);
  }, [mediaOptimizerRequest]);

  const closeOversizedMediaPrompt = useCallback(() => {
    setMediaOptimizerPromptOpen(false);
    setMediaOptimizerRequest(null);
    setMediaOptimizerQueue([]);
    setMediaOptimizerCompleted(false);
  }, []);

  const closeMediaOptimizer = useCallback(() => {
    setMediaOptimizerOpen(false);
    setMediaOptimizerPromptOpen(false);
    if (mediaOptimizerCompleted && mediaOptimizerQueue.length > 0) {
      const [next, ...rest] = mediaOptimizerQueue;
      setMediaOptimizerRequest(next);
      setMediaOptimizerQueue(rest);
      setMediaOptimizerCompleted(false);
      setMediaOptimizerPromptOpen(true);
      return;
    }
    setMediaOptimizerRequest(null);
    setMediaOptimizerQueue([]);
    setMediaOptimizerCompleted(false);
  }, [mediaOptimizerCompleted, mediaOptimizerQueue]);
  const [useImagesForAI, setUseImagesForAI] = useState(true);
  const [imageMetaByKey, setImageMetaByKey] = useState<
    Record<string, ImageMeta>
  >({});
  const [channelImageEditors, setChannelImageEditors] = useState<
    Partial<Record<ChannelKey, ChannelImageEditorState>>
  >({});
  const [selectedActiveImageChannel, setActiveImageChannel] =
    useState<ChannelKey>("site_web");
  const activeImageChannel = selectedActiveImageChannel === "threads" && !metaPilotEnabled ? "site_web" : selectedActiveImageChannel;
  const [activeImageKeyByChannel, setActiveImageKeyByChannel] = useState<
    Partial<Record<ChannelKey, string>>
  >({});

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  const getOrPrepareAiImagePayload = useCallback((file: File) => {
    const key = makeImageKey(file);
    const cached = aiImagePayloadCacheRef.current.get(key);
    if (cached) return cached;

    const preparationPromise = fileToBoosterAiImagePayload(file).catch(
      (error) => {
        if (aiImagePayloadCacheRef.current.get(key) === preparationPromise) {
          aiImagePayloadCacheRef.current.delete(key);
        }
        throw error;
      },
    );
    aiImagePayloadCacheRef.current.set(key, preparationPromise);
    return preparationPromise;
  }, []);

  useEffect(() => {
    const activeKeys = new Set(images.map((file) => makeImageKey(file)));
    for (const key of aiImagePayloadCacheRef.current.keys()) {
      if (!activeKeys.has(key)) aiImagePayloadCacheRef.current.delete(key);
    }

    if (!useImagesForAI) return;
    images.forEach((file) => {
      void getOrPrepareAiImagePayload(file).catch(() => {
        // La génération réessaiera avec le même fallback qu'avant si le
        // préchauffage local échoue sur un navigateur ou un format donné.
      });
    });
  }, [getOrPrepareAiImagePayload, images, useImagesForAI]);

  useEffect(() => {
    const cache = aiImagePayloadCacheRef.current;
    return () => cache.clear();
  }, []);

  const [showPublicationPreview, setShowPublicationPreview] = useState(false);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const publishAreaRef = useRef<HTMLDivElement | null>(null);
  const generationProgressRef = useRef<HTMLDivElement | null>(null);
  const contentTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const siteContentEditorRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const publishRootRef = useRef<HTMLDivElement | null>(null);
  const publishScrollSnapshotRef = useRef<{
    element: HTMLElement | null;
    scrollTop: number;
    windowY: number;
  } | null>(null);

  const [initialConnectionBootstrap] = useState(() => {
    const accountId = getActiveBrowserUserId() || activeAccountId || null;
    return { accountId, snapshot: readBoosterConnectionSnapshot(actorUserId, accountId, CHANNEL_KEYS) };
  });
  const getInitialConnectedChannels = useCallback((): Record<ChannelKey, boolean> => initialConnectionBootstrap.snapshot?.channels ?? ({

    site_web: !!initialConnectedChannels?.site_web,
    gmb: !!initialConnectedChannels?.gmb,
    inr_search: !!initialConnectedChannels?.inr_search,
    facebook: !!initialConnectedChannels?.facebook,
    instagram: !!initialConnectedChannels?.instagram,
    threads: metaPilotEnabled && !!initialConnectedChannels?.threads,
    linkedin: !!initialConnectedChannels?.linkedin,
    x: !!initialConnectedChannels?.x,
    tiktok: !!initialConnectedChannels?.tiktok,
    youtube_shorts: !!initialConnectedChannels?.youtube_shorts,
    // A cached dashboard boolean cannot prove that the destination board
    // still exists. Pinterest is enabled by the authoritative
    // /api/booster/connected-channels refresh immediately after opening.
    pinterest: false,
  }), [initialConnectionBootstrap.snapshot, initialConnectedChannels, metaPilotEnabled]);

  const [channels, setChannels] = useState<Record<ChannelKey, boolean>>(() =>
    getInitialConnectedChannels(),
  );

  const [connected, setConnected] = useState<Record<ChannelKey, boolean>>(() =>
    getInitialConnectedChannels(),
  );
  const [channelDetails, setChannelDetails] = useState<
    Record<ChannelKey, ChannelConnectionDetail>
  >(() => {
    const cached = initialConnectionBootstrap.snapshot?.channelDetails ?? EMPTY_CHANNEL_DETAILS;
    const seed = readBoosterChannelIdentitySeed(actorUserId, initialConnectionBootstrap.accountId, CHANNEL_KEYS, initialChannelIdentity);
    const incoming = { ...EMPTY_CHANNEL_DETAILS, ...cached };
    for (const key of CHANNEL_KEYS) {
      if (seed[key]) incoming[key] = { ...incoming[key], ...seed[key] };
    }
    return mergeBoosterChannelDetails(CHANNEL_KEYS, incoming, cached, getInitialConnectedChannels());
  });
  const [hasKnownChannelConnections, setHasKnownChannelConnections] = useState(Boolean(initialConnectionBootstrap.snapshot));
  const [connectedChannelsLoadState, setConnectedChannelsLoadState] = useState<"loading" | "ready" | "error">("loading");
  const connectedChannelsScopeRef = useRef<string | null | undefined>(initialConnectionBootstrap.accountId);
  const connectedChannelsActorRef = useRef(actorUserId);
  const authoritativeChannelsRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    threadsPublicationPreferencesRef.current = CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES;
    setThreadsPublicationPreferences(CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES);
    setThreadsPreferencesLoading(true);
    setThreadsPreferencesFailed(false);
    if (!metaPilotEnabled || (connectedChannelsLoadState === "ready" && !connected.threads)) {
      if (!metaPilotEnabled) setThreadsPublicationMode("classic");
      setThreadsPreferencesAccountId(activeAccountId);
      setThreadsPreferencesLoading(false);
      return;
    }
    if (connectedChannelsLoadState !== "ready" || !authoritativeChannelsRef.current || connectedChannelsScopeRef.current !== (getActiveBrowserUserId() || activeAccountId || null)) {
      if (connectedChannelsLoadState === "error") { setThreadsPreferencesFailed(true); setThreadsPreferencesAccountId(activeAccountId); setThreadsPreferencesLoading(false); }
      return;
    }
    const loadThreadsPreferences = async () => {
      try {
        const response = await fetch("/api/integrations/threads/publication-preferences", { cache: "no-store", credentials: "include" });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !payload?.preferences) throw new Error("preferences_unavailable");
        const preferences = normalizeThreadsPublicationPreferences(payload.preferences);
        threadsPublicationPreferencesRef.current = preferences;
        setThreadsPublicationPreferences(preferences);
        setThreadsPreferencesAccountId(activeAccountId);
        if (!publicationDraftIdParam && !threadsModeTouchedRef.current) setThreadsPublicationMode(preferences.defaultMode);
      } catch { if (!cancelled) { setThreadsPreferencesFailed(true); setThreadsPreferencesAccountId(activeAccountId); } }
      finally { if (!cancelled) setThreadsPreferencesLoading(false); }
    };
    void loadThreadsPreferences();
    return () => { cancelled = true; };
  }, [activeAccountId, metaPilotEnabled, publicationDraftIdParam, connected.threads, connectedChannelsLoadState]);
  const [channelInfoOpen, setChannelInfoOpen] = useState<ChannelKey | null>(
    null,
  );
  const lastInitialConnectedChannelsRef = useRef<Record<ChannelKey, boolean> | null>(
    null,
  );
  const manuallyControlledChannelsRef = useRef<Set<ChannelKey>>(new Set());
  const draftChannelsRestoredRef = useRef(false);
  const [ctaDefaults, setCtaDefaults] = useState<BoosterCtaDefaults | null>(
    null,
  );
  const manuallyEditedCtaChannelsRef = useRef<Set<ChannelKey>>(new Set());

  const applyConnectedChannels = useCallback(
    (nextConnected: Record<ChannelKey, boolean>) => {
      setConnected(nextConnected);
      setChannels((previousSelection) =>
        CHANNEL_KEYS.reduce(
          (nextSelection, key) => {
            if (!nextConnected[key]) {
              nextSelection[key] = false;
            } else if (
              !draftChannelsRestoredRef.current &&
              !manuallyControlledChannelsRef.current.has(key)
            ) {
              // À l'ouverture, tout canal connecté est sélectionné par défaut.
              // Une action explicite du pro ou un brouillon restauré reste prioritaire.
              nextSelection[key] = true;
            } else {
              nextSelection[key] = Boolean(previousSelection[key]);
            }
            return nextSelection;
          },
          {} as Record<ChannelKey, boolean>,
        ),
      );
    },
    [CHANNEL_KEYS],
  );

  const resetPublicationProgressPhases = useCallback(() => {
    phasedPublicationProgressRef.current = false;
    publishProgressTargetRef.current = 0;
    publishProgressPhaseIndexRef.current = 0;
    setPublishProgressPhaseIndex(0);
    setPublishProgressPhaseLabel("");
  }, []);

  const setPublicationProgressPhase = useCallback(
    (
      key: PublicationProgressPhaseKey,
      detail: string,
      target?: number,
    ) => {
      const phase = getProgressPhase(PUBLICATION_PROGRESS_PHASES, key);
      const phaseLabel = runtimeT(PUBLICATION_PHASE_MESSAGE_KEYS[key]);
      const phaseIndex = getProgressPhaseIndex(
        PUBLICATION_PROGRESS_PHASES,
        key,
      );
      if (phaseIndex < publishProgressPhaseIndexRef.current) return;

      if (phaseIndex > publishProgressPhaseIndexRef.current) {
        const publicationWasIdle = publishProgressPhaseIndexRef.current === 0;
        publishProgressPhaseIndexRef.current = phaseIndex;
        if (publicationWasIdle) {
          const visibleStage = getPublicationProgressStageForValue(0);
          setPublishProgressPhaseIndex(visibleStage.index);
          setPublishProgressPhaseLabel(
            runtimeT(PUBLICATION_STAGE_MESSAGE_KEYS[visibleStage.index - 1]),
          );
        }
      }

      const nextTarget = Math.min(
        phase.cap,
        Math.max(phase.start, target ?? Math.max(phase.start, phase.cap - 1)),
      );
      publishProgressTargetRef.current = Math.max(
        publishProgressTargetRef.current,
        nextTarget,
      );
      setPublishProgressLabel(detail || phaseLabel);
    },
    [runtimeT],
  );

  const completePublicationProgress = useCallback((detail: string) => {
    const phaseLabel = runtimeT(PUBLICATION_PHASE_MESSAGE_KEYS.complete);
    const phaseIndex = getProgressPhaseIndex(
      PUBLICATION_PROGRESS_PHASES,
      "complete",
    );
    publishProgressPhaseIndexRef.current = phaseIndex;
    publishProgressTargetRef.current = 100;
    const visibleStage = getPublicationProgressStage("complete");
    setPublishProgressPhaseIndex(visibleStage.index);
    setPublishProgressPhaseLabel(
      runtimeT(PUBLICATION_STAGE_MESSAGE_KEYS[visibleStage.index - 1]),
    );
    setPublishProgressLabel(detail || phaseLabel);
    setPublishProgress(100);
  }, [runtimeT]);

  const setContextualPublishProgress = useCallback(
    (value: number | ((previous: number) => number)) => {
      if (!phasedPublicationProgressRef.current) {
        setPublishProgress(value);
        return;
      }
      setPublishProgress((current) => {
        const requested =
          typeof value === "function" ? value(current) : Number(value);
        const activePhase =
          PUBLICATION_PROGRESS_PHASES[
            Math.max(0, publishProgressPhaseIndexRef.current - 1)
          ] || getProgressPhase(PUBLICATION_PROGRESS_PHASES, "file_preparation");
        publishProgressTargetRef.current = Math.max(
          publishProgressTargetRef.current,
          Math.min(
            activePhase.cap,
            Math.max(activePhase.start, Math.round(requested || 0)),
          ),
        );
        return current;
      });
    },
    [],
  );

  const setContextualPublishProgressLabel = useCallback(
    (value: string | ((previous: string) => string)) => {
      setPublishProgressLabel((current) =>
        typeof value === "function" ? value(current) : value,
      );
    },
    [],
  );

  useEffect(() => {
    if (!generating) return;
    const timerId = window.setTimeout(() => {
      if (contentAdjustmentSession || wizardStep !== "intention") return;
      generationProgressRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }, 80);
    return () => window.clearTimeout(timerId);
  }, [generating, contentAdjustmentSession, wizardStep]);

  useEffect(() => {
    if (!saving || !phasedPublicationProgressRef.current) return;
    const timerId = window.setInterval(() => {
      setPublishProgress((current) => {
        const target = publishProgressTargetRef.current;
        if (current >= target) return current;
        const distance = target - current;
        const step = distance > 18 ? 2 : 1;
        return Math.min(target, current + step);
      });
    }, 180);
    return () => window.clearInterval(timerId);
  }, [saving]);

  useEffect(() => {
    if (!saving || !phasedPublicationProgressRef.current) return;
    const visibleStage = getPublicationProgressStageForValue(publishProgress);
    setPublishProgressPhaseIndex(visibleStage.index);
    setPublishProgressPhaseLabel(
      runtimeT(PUBLICATION_STAGE_MESSAGE_KEYS[visibleStage.index - 1]),
    );
  }, [publishProgress, runtimeT, saving]);

  useEffect(() => {
    void prewarmBoosterGenerationContextClient();
  }, []);

  const instagramPostHashtags = (normalizePost(postsByChannel.instagram).hashtags || []).join(" ");
  useEffect(() => {
    setInstagramHashtagsInput((prev) => prev === instagramPostHashtags ? prev : instagramPostHashtags);
  }, [instagramPostHashtags]);

  useEffect(() => {
    onOverlayOpenChange?.(aiConfigurationOpen || Boolean(contentAdjustmentSession));
    return () => {
      onOverlayOpenChange?.(false);
    };
  }, [
    aiConfigurationOpen,
    contentAdjustmentSession,
    onOverlayOpenChange,
  ]);

  useEffect(() => {
    let alive = true;
    let connectedChannelsRequestSeq = 0;
    const failClosedConnectedChannels = () => {
      if (!alive) return;
      setConnectedChannelsLoadState("error");
      // A transport failure does not prove disconnection. Preserve the last
      // display and selection, but revoke permission to continue or publish.
      authoritativeChannelsRef.current = false;
      setChannelDetails((current) =>
        CHANNEL_KEYS.reduce(
          (next, key) => {
            next[key] = {
              ...(current[key] || EMPTY_CHANNEL_DETAILS[key]),
              connectionStatus: "unavailable",
              requiresReconnect: false,
              availabilityError: true,
            };
            return next;
          },
          {} as Record<ChannelKey, ChannelConnectionDetail>,
        ),
      );
    };
    const refreshConnectedChannels = async () => {
      const requestSeq = ++connectedChannelsRequestSeq;
      const accountScope = getActiveBrowserUserId() || activeAccountId || null;
      const isCurrent = () => alive && requestSeq === connectedChannelsRequestSeq && accountScope === (getActiveBrowserUserId() || activeAccountId || null);
      if (connectedChannelsScopeRef.current !== accountScope || connectedChannelsActorRef.current !== actorUserId) {
        connectedChannelsActorRef.current = actorUserId;
        connectedChannelsScopeRef.current = accountScope;
        authoritativeChannelsRef.current = false;
        const cached = readBoosterConnectionSnapshot(actorUserId, accountScope, CHANNEL_KEYS);
        setHasKnownChannelConnections(Boolean(cached));
        setChannelDetails(cached?.channelDetails ?? EMPTY_CHANNEL_DETAILS);
        setConnected(cached?.channels ?? CHANNEL_KEYS.reduce((next, key) => ({ ...next, [key]: false }), {} as Record<ChannelKey, boolean>));
      }
      if (!authoritativeChannelsRef.current) setConnectedChannelsLoadState("loading");
      try {
        const res = await fetch("/api/booster/connected-channels", {
          cache: "no-store" as any,
          signal: AbortSignal.timeout(15_000),
        });
        if (!isCurrent()) return;
        if (!res.ok) {
          failClosedConnectedChannels();
          return;
        }
        const json = await res.json();
        if (!isCurrent()) return;
        if (json?.channels && typeof json.channels === "object") {
          const nextConnected = CHANNEL_KEYS.reduce(
            (result, key) => {
              result[key] = Boolean(json.channels[key]);
              return result;
            },
            {} as Record<ChannelKey, boolean>,
          );
          authoritativeChannelsRef.current = true;
          setHasKnownChannelConnections(true);
          applyConnectedChannels(nextConnected);
          const nextChannelDetails: Partial<Record<ChannelKey, ChannelConnectionDetail>> = {
            ...json?.channelDetails,
          };
          // Commit the server snapshot immediately. A slow social profile must
          // never hide the other accounts or hold up channel selection.
          setChannelDetails((prev) => {
            if (!isCurrent()) return prev;
            const next = mergeBoosterChannelDetails(CHANNEL_KEYS, { ...EMPTY_CHANNEL_DETAILS, ...nextChannelDetails }, prev, nextConnected);
            CHANNEL_KEYS.forEach((key) => {
              next[key] = { ...next[key], availabilityError: false };
            });
            return next;
          });
          setConnectedChannelsLoadState("ready");
          if (json.channels.pinterest) {
            void (async () => {
              try {
                const pinterestResponse = await fetch("/api/integrations/pinterest/status?live=1", {
                  cache: "no-store" as any,
                  signal: AbortSignal.timeout(8_000),
                });
                if (!isCurrent()) return;
                const pinterestStatus = pinterestResponse.ok
                  ? await pinterestResponse.json().catch(() => null)
                  : null;
                if (!isCurrent()) return;
                if (pinterestStatus?.ok && pinterestStatus?.connected) {
                  const username = String(pinterestStatus.username || "")
                    .replace(/^@+/, "")
                    .trim();
                  const profileHref = normalizeExternalHref(
                    pinterestStatus.profileUrl ||
                      pinterestStatus.publicProfileUrl ||
                      (username
                        ? `https://www.pinterest.fr/${encodeURIComponent(username)}/`
                        : ""),
                  );
                  const accountLabel = String(
                    pinterestStatus.accountName || username || profileHref,
                  ).trim();
                  if (!accountLabel) return;
                  setChannelDetails((current) => {
                    if (!isCurrent()) return current;
                    return {
                      ...current,
                      pinterest: {
                        ...(current.pinterest || EMPTY_CHANNEL_DETAILS.pinterest),
                        type: "account",
                        label: accountLabel,
                        href: profileHref || null,
                      },
                    };
                  });
                }
              } catch {
                // The connected-channels snapshot remains authoritative when live identity is unavailable.
              }
            })();
          }
          if (json.channels.tiktok) {
            void fetch("/api/integrations/tiktok/status", {
              cache: "no-store" as any,
              credentials: "include",
            })
              .then(async (tiktokResponse) => {
                if (!tiktokResponse.ok) return null;
                return tiktokResponse.json().catch(() => null);
              })
              .then((tiktokStatus) => {
                if (!isCurrent() || !tiktokStatus?.ok || !tiktokStatus?.tiktok?.connected)
                  return;
                const username = String(tiktokStatus.tiktok.username || "")
                  .replace(/^@+/, "")
                  .trim();
                const profileHref = normalizeExternalHref(
                  tiktokStatus.tiktok.profileUrl ||
                    (username
                      ? `https://www.tiktok.com/@${encodeURIComponent(username)}`
                      : ""),
                );
                if (!username && !profileHref) return;
                setChannelDetails((current) => !isCurrent() ? current : mergeBoosterChannelDetails(CHANNEL_KEYS, {
                  ...current,
                  tiktok: {
                    ...(current.tiktok || EMPTY_CHANNEL_DETAILS.tiktok),
                    type: "account",
                    label: username ? `@${username}` : "Compte TikTok connecté",
                    href: profileHref || null,
                  },
                }, current, nextConnected));
              })
              .catch(() => null);
          }
        } else {
          failClosedConnectedChannels();
        }
      } catch {
        if (!isCurrent()) return;
        failClosedConnectedChannels();
      }
    };
    void refreshConnectedChannels();
    const intervalId = window.setInterval(refreshConnectedChannels, 60_000);
    const onFocus = () => void refreshConnectedChannels();
    const unsubscribeConnectionUpdates = subscribeToChannelConnectionUpdates(() => {
      // A confirmed connection mutation invalidates publication permission
      // immediately, while its replacement snapshot is fetched.
      authoritativeChannelsRef.current = false;
      void refreshConnectedChannels();
    });
    window.addEventListener("focus", onFocus);
    window.addEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, onFocus);
    return () => {
      alive = false;
      connectedChannelsRequestSeq += 1;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ACTIVE_INRCY_ACCOUNT_EVENT, onFocus);
      unsubscribeConnectionUpdates();
    };
  }, [applyConnectedChannels, activeAccountId, actorUserId, CHANNEL_KEYS]);

  useEffect(() => {
    const scope = connectedChannelsScopeRef.current;
    if (connectedChannelsLoadState !== "ready" || !authoritativeChannelsRef.current || scope !== (getActiveBrowserUserId() || activeAccountId || null)) return;
    writeBoosterConnectionSnapshot(actorUserId, scope ?? null, CHANNEL_KEYS, connected, channelDetails);
  }, [actorUserId, activeAccountId, connected, channelDetails, connectedChannelsLoadState, CHANNEL_KEYS]);

  useEffect(() => {
    if (!initialConnectedChannels) return;
    const nextConnected = getInitialConnectedChannels();
    const previousConnected = lastInitialConnectedChannelsRef.current;
    lastInitialConnectedChannelsRef.current = nextConnected;
    // Dashboard hydration can finish after the authoritative Booster request.
    // Its older booleans must not overwrite the snapshot already displayed.
    if (authoritativeChannelsRef.current || hasKnownChannelConnections) return;

    // Les valeurs initiales sont déjà utilisées par les state initializers.
    // On ne resynchronise ensuite que les clés qui changent réellement, afin
    // de ne pas écraser une réponse plus fraîche de /connected-channels.
    if (!previousConnected) return;
    const changedKeys = CHANNEL_KEYS.filter(
      (key) => nextConnected[key] !== previousConnected[key],
    );
    if (!changedKeys.length) return;

    setConnected((current) => {
      const next = { ...current };
      changedKeys.forEach((key) => {
        next[key] = nextConnected[key];
      });
      return next;
    });
    setChannels((previousSelection) => {
      const nextSelection = { ...previousSelection };
      changedKeys.forEach((key) => {
        if (!nextConnected[key]) {
          nextSelection[key] = false;
        } else if (
          !draftChannelsRestoredRef.current &&
          !manuallyControlledChannelsRef.current.has(key)
        ) {
          nextSelection[key] = true;
        }
      });
      return nextSelection;
    });
  }, [initialConnectedChannels, getInitialConnectedChannels, hasKnownChannelConnections, CHANNEL_KEYS]);

  const loadPinterestBoardsForPublish = useCallback(async () => {
    if (!connected.pinterest) {
      setPinterestBoards([]);
      setPinterestBoardsFailure(null);
      return;
    }

    setPinterestBoardsLoading(true);
    setPinterestBoardsFailure(null);
    try {
      const response = await fetch("/api/integrations/pinterest/boards", {
        cache: "no-store" as any,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(
          String(
            result?.error || "Impossible de charger les tableaux Pinterest.",
          ),
        );
      }

      const rawBoards: unknown[] = Array.isArray(result.boards)
        ? result.boards
        : [];
      const boards: PinterestBoardOption[] = rawBoards
        .map((value: unknown): PinterestBoardOption | null => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return null;
          const record = value as Record<string, unknown>;
          const id = String(record.id || "").trim();
          if (!id) return null;
          return {
            id,
            name:
              String(record.name || "Tableau Pinterest").trim() ||
              "Tableau Pinterest",
          };
        })
        .filter(
          (value: PinterestBoardOption | null): value is PinterestBoardOption =>
            Boolean(value),
        );

      setPinterestBoards(boards);
      writePinterestBoardUiCache(boards, result.defaultBoardId);
      setPinterestBoardId((currentId) => {
        const current = String(currentId || "").trim();
        const defaultId = String(result.defaultBoardId || "").trim();
        const nextId = boards.some((board) => board.id === current)
          ? current
          : boards.some((board) => board.id === defaultId)
            ? defaultId
            : "";
        const nextBoard = boards.find((board) => board.id === nextId);
        setPinterestBoardName(nextBoard?.name || "");
        return nextId;
      });
    } catch (error) {
      setPinterestBoardsFailure(error);
    } finally {
      setPinterestBoardsLoading(false);
    }
  }, [connected.pinterest]);

  useEffect(() => {
    if (!connected.pinterest || !channels.pinterest) return;
    void loadPinterestBoardsForPublish();
  }, [connected.pinterest, channels.pinterest, loadPinterestBoardsForPublish]);

  const onPinterestBoardChange = useCallback(
    (boardId: string) => {
      const cleanId = String(boardId || "").trim();
      const selectedBoard = pinterestBoards.find(
        (board) => board.id === cleanId,
      );
      setPinterestBoardId(cleanId);
      setPinterestBoardName(selectedBoard?.name || "");
      setPinterestBoardsFailure(null);
    },
    [pinterestBoards],
  );

  useEffect(() => {
    if (!channelInfoOpen) return;
    const onGlobalPointer = () => setChannelInfoOpen(null);
    window.addEventListener("pointerdown", onGlobalPointer);
    window.addEventListener("scroll", onGlobalPointer, true);
    return () => {
      window.removeEventListener("pointerdown", onGlobalPointer);
      window.removeEventListener("scroll", onGlobalPointer, true);
    };
  }, [channelInfoOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleAiConfigurationUpdated = () => {
      void prewarmBoosterGenerationContextClient();
    };
    window.addEventListener(
      "inrcy:ai-configuration-updated",
      handleAiConfigurationUpdated,
    );
    return () =>
      window.removeEventListener(
        "inrcy:ai-configuration-updated",
        handleAiConfigurationUpdated,
      );
  }, []);

  useEffect(() => {
    let alive = true;
    const loadDefaults = async () => {
      try {
        const res = await fetch("/api/booster/cta-defaults", {
          cache: "no-store" as any,
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        setCtaDefaults({
          preferredWebsiteUrl: String(json?.preferredWebsiteUrl || "").trim(),
          preferredWebsiteLabel: String(
            json?.preferredWebsiteLabel || "",
          ).trim(),
          siteWebUrl: String(json?.siteWebUrl || "").trim(),
          phone: String(json?.phone || "").trim(),
          preferredCta: normalizeBoosterPreferredCta(json?.preferredCta),
          aiLanguage: normalizeBoosterAiLanguage(json?.aiLanguage),
          channelCtas: normalizeAiChannelCtaMap(json?.channelCtas),
          youtubeAutoHashtags: json?.youtubeAutoHashtags !== false,
        });
      } catch {
        // ignore
      }
    };
    void loadDefaults();
    window.addEventListener("inrcy:ai-configuration-updated", loadDefaults);
    return () => {
      alive = false;
      window.removeEventListener("inrcy:ai-configuration-updated", loadDefaults);
    };
  }, []);

  useEffect(() => {
    if (!ctaDefaults) return;
    setPostsByChannel((prev) =>
      prefillConfiguredChannelCtas(
        prev,
        ctaDefaults,
        manuallyEditedCtaChannelsRef.current,
      ),
    );
  }, [ctaDefaults]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewport = () => {
      setIsMobile(window.innerWidth <= 768);
      setDrawerViewportHeight(
        Math.round(window.visualViewport?.height || window.innerHeight),
      );
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.visualViewport?.removeEventListener("scroll", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const applyIfActive = (value: unknown) => {
      if (!cancelled) applyDefaultAiPreferredEngine(value);
    };

    try {
      const local = JSON.parse(
        window.localStorage.getItem(AI_CONFIGURATION_STORAGE_KEY) || "{}",
      ) as { preferredEngine?: unknown };
      applyIfActive(local.preferredEngine || DEFAULT_AI_PREFERRED_ENGINE);
    } catch {
      applyIfActive(DEFAULT_AI_PREFERRED_ENGINE);
    }

    const loadPersistedEngine = async () => {
      try {
        const supabase = createClient();
        const { data: authData } = await supabase.auth.getUser();
        const userId = authData?.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from("business_profiles")
          .select("ai_preferred_engine")
          .eq("user_id", resolveActiveBrowserUserId(userId))
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.ai_preferred_engine) {
          applyIfActive(data.ai_preferred_engine);
        }
      } catch {
        // La génération reste utilisable avec la valeur locale ou le défaut.
      }
    };

    const onAiConfigurationUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ aiPreferredEngine?: unknown }>)
        .detail;
      if (detail?.aiPreferredEngine) {
        applyIfActive(detail.aiPreferredEngine);
      }
    };

    loadPersistedEngine();
    window.addEventListener(
      "inrcy:ai-configuration-updated",
      onAiConfigurationUpdated,
    );

    return () => {
      cancelled = true;
      window.removeEventListener(
        "inrcy:ai-configuration-updated",
        onAiConfigurationUpdated,
      );
    };
  }, [applyDefaultAiPreferredEngine]);

  const scrollToPublishArea = (behavior: ScrollBehavior = "smooth") => {
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
      publishAreaRef.current?.scrollIntoView({
        behavior,
        block: "end",
        inline: "nearest",
      });
    });
  };

  const getPublishScrollContainer = () => {
    if (typeof document === "undefined") return null;
    const root = publishRootRef.current;
    if (!root) return null;
    const scrollClass = styles.fullscreenModalScroll;
    if (!scrollClass) return null;
    return root.closest<HTMLElement>(`.${scrollClass}`);
  };

  const preservePublishScroll = () => {
    if (typeof window === "undefined") return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    const element = getPublishScrollContainer();
    publishScrollSnapshotRef.current = {
      element,
      scrollTop: element?.scrollTop ?? 0,
      windowY: window.scrollY,
    };
  };

  const restorePublishScroll = () => {
    if (typeof window === "undefined") return;
    const snapshot = publishScrollSnapshotRef.current;
    if (!snapshot) return;
    const restore = () => {
      const element = snapshot.element || getPublishScrollContainer();
      if (element) {
        element.scrollTop = snapshot.scrollTop;
      } else {
        window.scrollTo(window.scrollX, snapshot.windowY);
      }
    };
    window.requestAnimationFrame(() => {
      restore();
      window.setTimeout(restore, 80);
      window.setTimeout(restore, 220);
    });
  };

  useEffect(() => {
    if (!saving) return;
    scrollToPublishArea("smooth");
  }, [saving]);

  useEffect(() => {
    if (!publishError && !imgError) return;
    scrollToPublishArea("smooth");
  }, [publishError, imgError]);

  const displayCards = useMemo(() => {
    return CHANNEL_KEYS.filter((key) => channels[key] && connected[key]);
  }, [channels, connected, CHANNEL_KEYS]);

  useEffect(() => {
    if (!displayCards.length) {
      setActiveCard("site_web");
      setActiveImageChannel("site_web");
      return;
    }
    if (!displayCards.includes(activeCard)) {
      const fallback = displayCards[0];
      setActiveCard(fallback);
      setActiveImageChannel(fallback);
    }
  }, [displayCards, activeCard]);

  const selectedChannels = useMemo(
    () => CHANNEL_KEYS.filter((key) => channels[key] && connected[key]),
    [channels, connected, CHANNEL_KEYS],
  );

  const handlePreparedWorkspaceMedia = useCallback(
    (preparedMedia: readonly MediaWorkspaceMediaSummary[]) => {
      setPreparedWorkspaceMedia((current) =>
        preparedMedia.map((item) => {
          const previous = current.find((entry) => entry.mediaId === item.mediaId);
          return previous
            ? {
                ...previous,
                ...item,
                previewUrl: item.previewUrl === undefined
                  ? previous.previewUrl
                  : item.previewUrl,
                canonicalUrl: item.canonicalUrl === undefined
                  ? previous.canonicalUrl
                  : item.canonicalUrl,
                imageRecovery: item.imageRecovery === undefined
                  ? previous.imageRecovery
                  : item.imageRecovery,
                requiresCanonical: item.requiresCanonical === undefined
                  ? previous.requiresCanonical
                  : item.requiresCanonical,
              }
            : item;
        }),
      );
      const preparedVideos = preparedMedia.filter(
        (item) => item.mediaType === "video",
      );

      if (
        generating &&
        preparedVideos.length > 0
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          i18nT("progress_media_preparation"),
          37,
        );
      }

      const preparedImages = preparedMedia.filter(
        (item) =>
          item.mediaType === "image" &&
          item.processingStatus === "ready" &&
          Boolean(item.previewUrl || item.canonicalUrl),
      );
      if (!preparedImages.length) return;

      for (const item of preparedImages) {
        if (item.position < 0 || item.position >= images.length) continue;
        const recovered =
          item.imageRecovery?.kind === "truncated_jpeg" &&
          item.requiresCanonical === true;
        const previewUrl = String(item.previewUrl || item.canonicalUrl || "");
        const expectedImageKey = makeImageKey(images[item.position]);
        if (!previewUrl || (recovered && !item.canonicalUrl)) continue;

        void preloadPreparedImagePreview(previewUrl).then((loaded) => {
          const currentFile = imagesRef.current[item.position];
          if (
            !currentFile ||
            makeImageKey(currentFile) !== expectedImageKey
          ) {
            return;
          }
          if (!loaded) {
            if (recovered) {
              setRecoveredPreviewErrors((current) => ({
                ...current,
                [expectedImageKey]: true,
              }));
            }
            return;
          }
          if (recovered) {
            setRecoveredPreviewErrors((current) => {
              if (!current[expectedImageKey]) return current;
              const next = { ...current };
              delete next[expectedImageKey];
              return next;
            });
          }
          setImagePreviews((current) => {
            const previous = current[item.position];
            // Un aperçu blob local décodable reste le plus rapide et le plus
            // fiable pendant la session. Le serveur remplace uniquement les
            // placeholders des formats que le navigateur ne sait pas lire.
            if ((!recovered && previous?.startsWith("blob:")) || previous === previewUrl) {
              return current;
            }
            const next = current.slice();
            next[item.position] = previewUrl;
            return next;
          });
        });
      }
      setImageMetaByKey((current) => {
        const next = { ...current };
        for (const item of preparedImages) {
          const file = images[item.position];
          const width = Number(item.width || 0);
          const height = Number(item.height || 0);
          if (!file || width <= 0 || height <= 0) continue;
          next[makeImageKey(file)] = {
            ...next[makeImageKey(file)],
            width,
            height,
            ratio: width / height,
          };
        }
        return next;
      });
    },
    [generating, images, setGenerationProgressPhase, i18nT],
  );

  const {
    enabled: persistentMediaWorkspaceEnabled,
    workspaceId: mediaWorkspaceId,
    clientWorkspaceKey: mediaWorkspaceClientKey,
    mediaStates: persistentMediaStates,
    synchronizing: persistentMediaSynchronizing,
    imagePreparationError,
    adoptWorkspace: adoptMediaWorkspace,
    syncImages: syncPersistentWorkspaceImages,
    syncVideo: syncPersistentWorkspaceVideo,
    prepareAiMedia: startPersistentAiMediaPreparation,
    preparePublicationMedia: startPersistentPublicationMediaPreparation,
    clearWorkspaceMedia: clearPersistentWorkspaceMedia,
    linkDraft: linkPersistentWorkspaceDraft,
    ensureWorkspace: ensurePersistentMediaWorkspace,
    waitForIdle: waitForPersistentWorkspaceIdle,
    verifyReadySources: verifyPersistentWorkspaceSources,
    archiveWorkspace: archivePersistentMediaWorkspace,
  } = usePersistentMediaWorkspace({
    draftId: publicationDraftIdParam,
    creationMode,
    eagerImagePreparation:
      isUnifiedMediaConsumptionClientEnabled() &&
      isLegacyMediaTransportCutoverClientEnabled(),
    selectedChannels,
    imageSettingsByChannel: channelImageEditors as Record<string, unknown>,
    onError: setImgError,
    onPreparedMedia: handlePreparedWorkspaceMedia,
  });
  const legacyMediaCutoverClientAvailable =
    persistentMediaWorkspaceEnabled &&
    isUnifiedMediaConsumptionClientEnabled() &&
    isLegacyMediaTransportCutoverClientEnabled();
  const unifiedMediaConsumptionClientAvailable =
    persistentMediaWorkspaceEnabled && isUnifiedMediaConsumptionClientEnabled();

  const mediaPipelineCutoverEnabled = legacyMediaCutoverClientAvailable;

  const {
    videoFormatByChannel,
    setVideoFormatByChannel,
    videoAdaptationModeByChannel,
    setVideoAdaptationModeByChannel,
    videoFile,
    setVideoFile,
    videoPreviewUrl,
    setVideoPreviewUrl,
    videoDurationSeconds,
    setVideoDurationSeconds,
    videoSourceMetadata,
    setVideoSourceMetadata,
    videoStorageContext,
    setVideoStorageContext,
    videoVariantPreparationByChannel,
    setVideoVariantPreparationByChannel,
    videoTransformedVariants,
    setVideoTransformedVariants,
    videoSettingsByChannel,
    clearVideoVariantPreparationForChannel,
    clearPreparedVideoVariantsForChannel,
    uploadPublicationVideoForPublish,
    buildPublicationDraftVideoPayload,
    buildVideoPreparationStateFromVariants,
    preparePublicationVideoVariants,
    clearVideoMediaState,
  } = usePublishVideoController({
    allChannels: CHANNEL_KEYS,
    selectedChannels,
    setImgError,
    setPublishProgress: setContextualPublishProgress,
    setPublishProgressLabel: setContextualPublishProgressLabel,
  });

  useEffect(() => {
    const preparedVideo = preparedWorkspaceMedia.find(
      (item) => item.mediaType === "video",
    );
    if (!preparedVideo || !videoFile) return;

    const transferred = normalizeTransferredMediaMetadata(preparedVideo);
    if (
      !transferred.width &&
      !transferred.height &&
      !transferred.durationSeconds
    ) {
      return;
    }

    setVideoDurationSeconds((current) =>
      current && current > 0 ? current : transferred.durationSeconds,
    );
    setVideoSourceMetadata((current) =>
      hasCompleteVideoMetadata(current)
        ? current
        : buildTransferredBoosterVideoMetadata(videoFile, current, preparedVideo),
    );
  }, [
    preparedWorkspaceMedia,
    setVideoDurationSeconds,
    setVideoSourceMetadata,
    videoFile,
  ]);

  useEffect(() => {
    if (
      !videoFile ||
      !videoPreviewUrl ||
      hasCompleteVideoMetadata({
        width: videoSourceMetadata?.width,
        height: videoSourceMetadata?.height,
        duration: videoDurationSeconds ?? videoSourceMetadata?.duration,
      })
    ) {
      return;
    }

    // Le premier probe est volontairement court pour ne pas bloquer l'UX.
    // Cette seconde lecture reste attachée à l'aperçu et réinjecte les
    // informations si un appareil lent les expose quelques secondes plus tard.
    const video = document.createElement("video");
    let cancelled = false;
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      if (cancelled) return;
      const lateMetadata = {
        width: video.videoWidth,
        height: video.videoHeight,
        duration: video.duration,
      };
      const normalized = normalizeTransferredMediaMetadata(lateMetadata);
      setVideoDurationSeconds((current) =>
        current && current > 0 ? current : normalized.durationSeconds,
      );
      setVideoSourceMetadata((current) =>
        buildTransferredBoosterVideoMetadata(videoFile, current, lateMetadata),
      );
    };
    video.src = videoPreviewUrl;
    video.load();
    return () => {
      cancelled = true;
      video.onloadedmetadata = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [
    setVideoDurationSeconds,
    setVideoSourceMetadata,
    videoDurationSeconds,
    videoFile,
    videoPreviewUrl,
    videoSourceMetadata?.duration,
    videoSourceMetadata?.height,
    videoSourceMetadata?.width,
  ]);

  useEffect(() => {
    if (
      creationMode !== "ai" ||
      !videoFile ||
      videoAiContextRef
    ) {
      return;
    }

    // Les captures locales commencent dès l'insertion de toute vidéo acceptée.
    // Elles restent un bonus court : le worker serveur peut les compléter.
    void getOrPrepareVideoFramesForAI(videoFile).catch((error) => {
      console.warn(
        "[booster-generate] local video frame prewarm unavailable",
        error,
      );
    });
  }, [
    creationMode,
    getOrPrepareVideoFramesForAI,
    videoAiContextRef,
    videoFile,
  ]);

  const generationMediaSelectionPolicy = getGenerationMediaSelectionPolicy({
    imageCount: images.length,
    hasVideo: Boolean(videoFile || videoPreviewUrl),
    maxImageCount: BOOSTER_MAX_IMAGE_COUNT,
  });

  const [tiktokMaxVideoDurationSeconds, setTiktokMaxVideoDurationSeconds] =
    useState<number | null>(null);
  const [tiktokDurationLimitVerified, setTiktokDurationLimitVerified] =
    useState(false);
  const [youtubeLongUploadsStatus, setYoutubeLongUploadsStatus] =
    useState<YoutubeLongUploadsStatus>("unknown");

  useEffect(() => {
    if (!connected.tiktok) {
      setTiktokMaxVideoDurationSeconds(null);
      setTiktokDurationLimitVerified(false);
      return;
    }
    let active = true;
    setTiktokDurationLimitVerified(false);
    fetch("/api/integrations/tiktok/creator-info", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(String(json?.error || "Limite TikTok indisponible."));
        }
        return json;
      })
      .then((json) => {
        if (!active) return;
        const value = Number(json?.creatorInfo?.maxVideoDurationSeconds || 0);
        setTiktokMaxVideoDurationSeconds(
          Number.isFinite(value) && value > 0 ? value : null,
        );
        setTiktokDurationLimitVerified(Number.isFinite(value) && value > 0);
      })
      .catch(() => {
        if (active) {
          setTiktokMaxVideoDurationSeconds(null);
          setTiktokDurationLimitVerified(false);
        }
      });
    return () => {
      active = false;
    };
  }, [connected.tiktok]);

  useEffect(() => {
    if (!connected.youtube_shorts) {
      setYoutubeLongUploadsStatus("unknown");
      return;
    }
    let active = true;
    fetch("/api/integrations/youtube-shorts/creator-info", {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(String(json?.error || "Limites YouTube indisponibles."));
        }
        return json;
      })
      .then((json) => {
        if (!active) return;
        setYoutubeLongUploadsStatus(
          normalizeYoutubeLongUploadsStatus(
            json?.creatorInfo?.longUploadsStatus,
          ),
        );
      })
      .catch(() => {
        if (active) setYoutubeLongUploadsStatus("unknown");
      });
    return () => {
      active = false;
    };
  }, [connected.youtube_shorts]);

  const waitForPersistentWorkspaceReadiness = useCallback(
    async (
      purpose: "generate" | "publish" | "schedule",
      onProgress?: (progress: number, label: string) => void,
      requiredMediaTypes?: readonly ("image" | "video")[],
      timeoutMs = MEDIA_WORKSPACE_READINESS_TIMEOUT_MS,
    ): Promise<string | null> => {
      if (!persistentMediaWorkspaceEnabled) return null;

      const requiredMediaTypeSet = new Set(
        requiredMediaTypes || (["image", "video"] as const),
      );
      const sourceExpectations = [
        ...(images.length && requiredMediaTypeSet.has("image")
          ? [{ mediaType: "image" as const, count: images.length }]
          : []),
        ...(videoFile && requiredMediaTypeSet.has("video")
          ? [{ mediaType: "video" as const, count: 1 }]
          : []),
      ];
      const expectedCount = sourceExpectations.reduce(
        (total, expectation) => total + expectation.count,
        0,
      );
      if (!expectedCount) return null;

      return await withMediaWorkspaceDeadline(
        async (readinessSignal) => {
          await waitForPersistentWorkspaceIdle(
            (progress, label) => {
              onProgress?.(
                Math.max(6, Math.min(42, Math.round(progress * 0.36) + 6)),
                label || "Envoi sécurisé du média en cours...",
              );
            },
            {
              mediaTypes: sourceExpectations.map((item) => item.mediaType),
              signal: readinessSignal,
            },
          );

          const ensuredWorkspace = mediaWorkspaceId
            ? null
            : await ensurePersistentMediaWorkspace();
          const activeWorkspaceId =
            mediaWorkspaceId || ensuredWorkspace?.workspaceId || "";
          if (!activeWorkspaceId) {
            throw new Error("Impossible de préparer l'espace média.");
          }

          await verifyPersistentWorkspaceSources(sourceExpectations, {
            signal: readinessSignal,
          });

          const mediaLabel =
            expectedCount > 1 ? "Médias sécurisés" : "Média sécurisé";
          onProgress?.(
            42,
            purpose === "generate"
              ? `${mediaLabel} · prêt pour la génération`
              : `${mediaLabel} · prêt pour l’envoi`,
          );
          return activeWorkspaceId;
        },
        {
          timeoutMs,
          phase: `workspace_readiness_${purpose}`,
          timeoutMessage:
            i18nT("supabase_est_temporairement_sature_pendant_la_06103ceb"),
        },
      );
    },
    [
      i18nT,
      ensurePersistentMediaWorkspace,
      images.length,
      mediaWorkspaceId,
      persistentMediaWorkspaceEnabled,
      videoFile,
      verifyPersistentWorkspaceSources,
      waitForPersistentWorkspaceIdle,
    ],
  );

  // Les captures locales de l'original démarrent dès l'ajout. La mission
  // serveur durable les complète si le navigateur n'a pas fini avant le clic.

  useEffect(() => {
    return () => {
      videoFramesForAiCacheRef.current = null;
    };
  }, []);

  const resolveStoredChannelMediaMode = (channel: ChannelKey): ChannelMediaMode => {
    const explicit = channelMediaModes[channel];
    const hasVideo = Boolean(videoFile || videoPreviewUrl);
    const hasImages =
      images.length > 0 &&
      (channelImageEditors[channel]?.imageKeys?.length || 0) > 0;

    // A scoped removal must keep the channel selected while explicitly
    // leaving it without media. Readiness then explains what is missing.
    if (explicit === "none") return "none";

    if (channel === "youtube_shorts") return hasVideo ? "video" : "none";

    if (channel === "tiktok") {
      if (explicit === "video" && hasVideo) return "video";
      if (explicit === "images" && hasImages) return "images";
      if (hasImages) return "images";
      if (hasVideo) return "video";
      return "none";
    }

    if (explicit === "video" && hasVideo) return "video";
    if (explicit === "images" && hasImages && channelSupportsImages(channel))
      return "images";
    if (hasImages && channelSupportsImages(channel)) return "images";
    if (hasVideo) return "video";
    return "none";
  };

  const resolveChannelMediaMode = (channel: ChannelKey): ChannelMediaMode =>
    getEffectiveThreadsMediaMode(channel, threadsPublicationMode, resolveStoredChannelMediaMode(channel));

  const changeInstagramPublicationPlacement = (placement: MetaPrimaryPublicationPlacement) => {
    instagramPlacementTouchedRef.current = true;
    const preferences = instagramPublicationPreferencesRef.current;
    setInstagramPublicationPlacement(placement === "reel" && preferences.reelsEnabled ? "reel" : placement === "story" && preferences.storiesEnabled ? "story" : "classic");
    if (placement === "story") setInstagramStoryEnabled(false);
  };
  const changeInstagramStoryEnabled = (enabled: boolean) => {
    instagramPlacementTouchedRef.current = true;
    setInstagramStoryEnabled(enabled && instagramPublicationPreferencesRef.current.storiesEnabled);
  };
  const changeFacebookPublicationPlacement = (placement: MetaPrimaryPublicationPlacement) => {
    facebookPlacementTouchedRef.current = true;
    const preferences = facebookPublicationPreferencesRef.current;
    setFacebookPublicationPlacement(placement === "reel" && preferences.reelsEnabled ? "reel" : placement === "story" && preferences.storiesEnabled ? "story" : "classic");
    if (placement === "story") setFacebookStoryEnabled(false);
  };
  const changeFacebookStoryEnabled = (enabled: boolean) => {
    facebookPlacementTouchedRef.current = true;
    setFacebookStoryEnabled(enabled && facebookPublicationPreferencesRef.current.storiesEnabled);
  };

  const channelUsesGeneratedSoundtrack = (channel: ChannelKey) => resolveChannelMediaMode(channel) === "images" && (
    channel === "facebook" ? facebookPublicationPlacement === "reel" || facebookPublicationPlacement === "story" || facebookStoryEnabled :
    channel === "instagram" ? instagramPublicationPlacement === "reel" || instagramPublicationPlacement === "story" || instagramStoryEnabled : false
  );
  const canConfigureChannelSoundtrack = (channel: ChannelKey) => resolveChannelMediaMode(channel) !== "video" && (
    channel === "facebook" ? facebookPublicationPlacement === "reel" || facebookPublicationPlacement === "story" || facebookStoryEnabled :
    channel === "instagram" ? instagramPublicationPlacement === "reel" || instagramPublicationPlacement === "story" || instagramStoryEnabled : false
  );
  const getPublicationSoundtracks = (channels: readonly ChannelKey[]): MediaSoundtrackByChannel => {
    const selection: MediaSoundtrackByChannel = {};
    for (const channel of channels) {
      if ((channel === "facebook" || channel === "instagram") && channelUsesGeneratedSoundtrack(channel)) selection[channel] = soundtrackByChannel[channel] ?? null;
    }
    return selection;
  };

  const setChannelMediaMode = (channel: ChannelKey, mode: ChannelMediaMode) => {
    if (mode === "images" && !channelSupportsImages(channel)) return;
    if (mode === "none" && !channelSupportsTextOnly(channel)) return;
    setChannelMediaModes((prev) =>
      mode === "video"
        ? assignVideoSourceToChannel(prev, channel)
        : { ...prev, [channel]: mode },
    );
    clearVideoVariantPreparationForChannel(channel);
    clearPreparedVideoVariantsForChannel(channel);
  };

  const removeMediaFromChannel = (channel: ChannelKey) => {
    setChannelMediaModes((prev) => ({ ...prev, [channel]: "none" }));
    clearVideoVariantPreparationForChannel(channel);
    clearPreparedVideoVariantsForChannel(channel);
  };

  const syncActiveImagesToPersistentWorkspace = useCallback(
    async (
      nextImages: readonly File[],
      metadataByIndex?: readonly Record<string, unknown>[],
    ) => {
      if (!persistentMediaWorkspaceEnabled) return;
      setRestoredClientMediaKeysByImageKey({});
      setRecoveredPreviewErrors({});
      await syncPersistentWorkspaceImages(nextImages, metadataByIndex);
    },
    [
      persistentMediaWorkspaceEnabled,
      syncPersistentWorkspaceImages,
    ],
  );

  const {
    imageKeys,
    previewByKey,
    clearImagesMedia,
    onPickImagesClick,
    addImageFiles,
    replaceImageFile,
    onImagesChange,
    assignExistingImagesToChannel,
    removeImagesFromChannel,
    removeImage,
    movePoolImageTo,
    getDraftImageSettingsByChannel,
    uploadPublicationDraftImages,
    restorePublicationDraftImages,
    toggleChannelImage,
    moveChannelImageTo,
    uploadOriginalImagesForPublication,
    buildChannelImagesPayload,
    buildChannelImageSettingsPayload,
    getPublishImageKeysForChannel,
  } = usePublishImageController({
    fileInputRef,
    previewStageRef,
    selectedChannels,
    images,
    setImages,
    imagePreviews,
    setImagePreviews,
    useImagesForAI,
    setUseImagesForAI,
    imageMetaByKey,
    setImageMetaByKey,
    channelImageEditors,
    setChannelImageEditors,
    activeImageChannel,
    setActiveImageChannel,
    activeImageKeyByChannel,
    setActiveImageKeyByChannel,
    isDraggingImage,
    setIsDraggingImage,
    hasVideoMedia: Boolean(videoFile || videoPreviewUrl),
    setImgError,
    onOversizedMedia: registerOversizedMedia,
    setActiveCard,
    setPublicationMediaType,
    setChannelMediaModes,
    preservePublishScroll,
    restorePublishScroll,
    syncPersistentWorkspaceImages: syncActiveImagesToPersistentWorkspace,
  });

  useEffect(() => {
    if (!mediaPipelineCutoverEnabled ||
        !mediaWorkspaceId ||
        !loadedPublicationDraftId ||
        !images.length ||
        Object.values(persistentMediaStates).some(
          (state) => state.mediaType === "image",
        )) {
      return;
    }
    // Un brouillon rétablit ses fichiers sans refaire l'upload. Relire et
    // préparer ses sources permet d'afficher le même contrôle avant publication.
    void startPersistentPublicationMediaPreparation().catch((error) => {
      setImgError(
        error instanceof Error
          ? error.message
          : "Impossible de vérifier les images de ce brouillon.",
      );
    });
  }, [
    images.length,
    loadedPublicationDraftId,
    mediaPipelineCutoverEnabled,
    mediaWorkspaceId,
    persistentMediaStates,
    startPersistentPublicationMediaPreparation,
  ]);

  const imagePreparationItems = useMemo(() => {
    const clientMediaKeys = mediaWorkspaceClientKey
      ? images.map((file) =>
          restoredClientMediaKeysByImageKey[makeImageKey(file)] ||
          buildWorkspaceMediaClientKey(mediaWorkspaceClientKey, file),
        )
      : [];
    const resolved = resolvePublishImagePreparation({
      imageKeys,
      clientMediaKeys,
      mediaStates: persistentMediaStates,
      preparedMedia: preparedWorkspaceMedia,
    });
    return resolved.map((item) => {
      if (!item.recovered || item.status !== "ready") return item;
      if (recoveredPreviewErrors[item.imageKey]) {
        return { ...item, status: "failed" as const };
      }
      return previewByKey[item.imageKey] === item.previewUrl
        ? item
        : { ...item, status: "pending" as const };
    });
  }, [
    imageKeys,
    images,
    mediaWorkspaceClientKey,
    restoredClientMediaKeysByImageKey,
    persistentMediaStates,
    preparedWorkspaceMedia,
    previewByKey,
    recoveredPreviewErrors,
  ]);

  const getImagePreparationIssue = (
    channelsToReview: readonly ChannelKey[],
    purpose: "publish" | "schedule" = "publish",
  ) => {
    if (!mediaPipelineCutoverEnabled) return "";
    // Scheduling secures and verifies the originals before creating its
    // immutable snapshot. The durable worker owns pending adaptations.
    const allowBackgroundPreparation = purpose === "schedule" &&
      persistentMediaWorkspaceEnabled && unifiedMediaConsumptionClientAvailable;
    const requiredKeys = new Set(
      channelsToReview
        .filter((channel) => resolveChannelMediaMode(channel) === "images")
        .flatMap((channel) => channelImageEditors[channel]?.imageKeys || []),
    );
    const requiredItems = imagePreparationItems.filter((item) =>
      requiredKeys.has(item.imageKey),
    );
    if ([...requiredKeys].some((key) => !requiredItems.some((item) => item.imageKey === key))) {
      return "Une image sélectionnée n’est plus disponible. Réattribuez les images à ce canal avant de publier.";
    }
    if (!allowBackgroundPreparation && persistentMediaSynchronizing && requiredItems.length) {
      return "Envoi des images en cours. Leur contrôle commencera dès que l’upload sera terminé.";
    }
    if (requiredItems.some((item) => item.status === "failed")) {
      return "Une image n’a pas pu être préparée. Utilisez « Modifier Média » pour créer une nouvelle version ou remplacez-la.";
    }
    if (!allowBackgroundPreparation && requiredItems.some((item) => item.status === "pending")) {
      return imagePreparationError ||
        "Vérification des images en cours. La publication sera disponible après le contrôle de leur aperçu.";
    }
    return "";
  };

  const publishImagePreparationIssue = getImagePreparationIssue(selectedChannels);
  const scheduleImagePreparationIssue = getImagePreparationIssue(selectedChannels, "schedule");

  const selectedForGeneration = useMemo(() => {
    return CHANNEL_KEYS.filter((channel) => channels[channel] && connected[channel]);
  }, [channels, connected, CHANNEL_KEYS]);

  const setSynchronizedActiveChannel = (channel: ChannelKey) => {
    if (!CHANNEL_KEYS.includes(channel)) return;
    setActiveCard(channel);
    setActiveImageChannel(channel);
  };

  const hasVideoForChannelModes = Boolean(videoFile || videoPreviewUrl);
  useEffect(() => {
    setChannelMediaModes((prev) => {
      const next: Partial<Record<ChannelKey, ChannelMediaMode>> = { ...prev };
      let changed = false;
      for (const channel of selectedChannels) {
        const current = next[channel];
        const hasVideo = hasVideoForChannelModes;
        const hasImages = images.length > 0;
        const valid =
          current === "none" ||
          (current === "video" && hasVideo) ||
          (current === "images" && hasImages && channelSupportsImages(channel));
        if (!valid) {
          next[channel] =
            channel === "youtube_shorts"
              ? hasVideo
                ? "video"
                : "none"
              : channel === "tiktok"
                ? hasImages
                  ? "images"
                  : hasVideo
                    ? "video"
                    : "none"
                : hasImages && channelSupportsImages(channel)
                  ? "images"
                  : hasVideo
                    ? "video"
                    : "none";
          changed = true;
        }
      }
      for (const key of Object.keys(next) as ChannelKey[]) {
        if (!selectedChannels.includes(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [
    selectedChannels,
    hasVideoForChannelModes,
    images.length,
  ]);

  const hasWrittenChannelContent = useMemo(
    () =>
      (
        Object.values(postsByChannel) as Array<ChannelPost | undefined>
      ).some((post) => {
        const normalized = normalizePost(post);
        return Boolean(
          String(normalized.title || "").trim() ||
            String(normalized.content || "").trim(),
        );
      }),
    [postsByChannel],
  );

  useEffect(() => {
    if (!hasWrittenChannelContent) return;
    setContentWorkspaceOpen(true);
    setCreationMode((current) => current || "manual");
  }, [hasWrittenChannelContent]);

  const creationWorkflow = useMemo(
    () => (creationMode ? getBoosterCreationWorkflow(creationMode) : null),
    [creationMode],
  );

  const workflowSteps = useMemo(
    () =>
      creationMode ? getBoosterPublicationWorkflowSteps(creationMode) : null,
    [creationMode],
  );

  const hasAiCreationWork = useMemo(
    () =>
      Boolean(
        idea.trim() ||
          publicationInstruction.trim() ||
          pdfFile ||
          theme ||
          contentStyle !== "equilibre" ||
          hasWrittenChannelContent,
      ),
    [
      idea,
      publicationInstruction,
      pdfFile,
      theme,
      contentStyle,
      hasWrittenChannelContent,
    ],
  );

  const hasManualCreationWork = useMemo(
    () =>
      Boolean(hasWrittenChannelContent || instagramHashtagsInput.trim()),
    [hasWrittenChannelContent, instagramHashtagsInput],
  );

  const hasCurrentCreationModeWork =
    creationMode === "ai"
      ? hasAiCreationWork
      : creationMode === "manual"
        ? hasManualCreationWork
        : false;

  const showContentWorkspace =
    creationMode === "manual" ||
    (creationMode === "ai" && contentWorkspaceOpen);

  const hasDraftablePublicationContent = useMemo(() => {
    const hasText =
      !!idea.trim() ||
      !!publicationInstruction.trim() ||
      !!theme ||
      contentStyle !== "equilibre";
    // A configured CTA alone is a default, not unfinished editorial work.
    const hasGeneratedContent = Object.values(postsByChannel).some((post) => {
      const normalized = normalizePost(post);
      return !!(
        normalized.title?.trim() ||
        normalized.content?.trim() ||
        normalized.hashtags?.length
      );
    });
    const hasImages =
      images.length > 0 ||
      imagePreviews.length > 0 ||
      Object.keys(channelImageEditors).length > 0;
    const hasVideo = !!videoFile || !!videoPreviewUrl;
    const hasMedia = hasImages || hasVideo;
    const hasLiveHashtags = !!instagramHashtagsInput.trim();
    return hasText || hasGeneratedContent || hasMedia || hasLiveHashtags;
  }, [
    idea,
    publicationInstruction,
    theme,
    contentStyle,
    postsByChannel,
    images.length,
    imagePreviews.length,
    videoFile,
    videoPreviewUrl,
    channelImageEditors,
    instagramHashtagsInput,
  ]);

  const currentPublicationDraftSnapshot = useMemo(() => {
    const imageNames = images.map((file) => ({
      name: file.name,
      type: file.type,
      size: file.size,
    }));
    const videoName = videoFile
      ? {
          name: videoFile.name,
          type: videoFile.type,
          size: videoFile.size,
          duration: videoDurationSeconds,
          sourceMetadata: videoSourceMetadata,
        }
      : null;
    return JSON.stringify({
      creationMode,
      mediaType: publicationMediaType,
      channelMediaModes,
      videoFormatByChannel,
      videoAdaptationModeByChannel,
      videoSettingsByChannel,
      idea: idea.trim(),
      publicationInstruction: publicationInstruction.trim(),
      theme,
      contentStyle,
      channels: selectedChannels,
      postsByChannel,
      aiPreferredEngine: selectedAiPreferredEngine,
      activeCard,
      contentWorkspaceOpen,
      instagramHashtagsInput,
      xHashtagsInput,
      threadsPublicationSettings: { mode: threadsPublicationMode },
      instagramPublicationPlacement,
      instagramStoryEnabled,
      facebookPublicationPlacement,
      facebookStoryEnabled,
      soundtrackByChannel,
      pinterestBoardId,
      pinterestBoardName,
      tiktokPublicationSettings,
      showPublicationPreview,
      imageNames,
      videoName,
      videoTransformedVariants: normalizeRestoredVideoVariants(
        videoTransformedVariants,
      ),
      videoAiContextRef,
      useImagesForAI,
      imageSettingsByChannel: channelImageEditors,
    });
  }, [
    creationMode,
    publicationMediaType,
    channelMediaModes,
    videoFormatByChannel,
    videoAdaptationModeByChannel,
    videoSettingsByChannel,
    idea,
    publicationInstruction,
    theme,
    contentStyle,
    selectedChannels,
    postsByChannel,
    selectedAiPreferredEngine,
    activeCard,
    contentWorkspaceOpen,
    instagramHashtagsInput,
    xHashtagsInput,
    threadsPublicationMode,
    instagramPublicationPlacement,
    instagramStoryEnabled,
    facebookPublicationPlacement,
    facebookStoryEnabled,
    soundtrackByChannel,
    pinterestBoardId,
    pinterestBoardName,
    tiktokPublicationSettings,
    showPublicationPreview,
    images,
    videoFile,
    videoDurationSeconds,
    videoSourceMetadata,
    videoTransformedVariants,
    videoAiContextRef,
    useImagesForAI,
    channelImageEditors,
  ]);

  // A draft request captures the current editor context once. Editing or locale
  // changes must not cancel and reload the same draft over the user's work.
  const onPublicationDraftRequested = useEffectEvent((
    request: Pick<Parameters<typeof loadPublicationDraft>[0], "publicationDraftIdParam" | "ctaDefaults" | "legacyMediaCutoverClientAvailable" | "onUnsavedChange">,
    isCancelled: () => boolean,
  ) => {
    return loadPublicationDraft({
      setDraftMessage,
      i18nT,
      setPublishError,
      metaPilotEnabled,
      adoptMediaWorkspace,
      CHANNEL_KEYS,
      channels,
      restorePublicationDraftImages,
      defaultAiPreferredEngine,
      instagramPublicationPreferencesRef,
      facebookPublicationPreferencesRef,
      setDocumentFiles,
      setPdfAttachmentError,
      setIdea,
      setPublicationInstruction,
      setTheme,
      setContentStyle,
      setCreationMode,
      setWizardStep,
      aiEngineRestoredFromDraftRef,
      setSelectedAiPreferredEngine,
      setCreationModeError,
      setContentWorkspaceOpen,
      setActiveCard,
      draftChannelsRestoredRef,
      setChannels,
      manuallyEditedCtaChannelsRef,
      setPostsByChannel,
      setInstagramHashtagsInput,
      setXHashtagsInput,
      threadsModeTouchedRef,
      setThreadsPublicationMode,
      instagramPlacementTouchedRef,
      setInstagramPublicationPlacement,
      setInstagramStoryEnabled,
      facebookPlacementTouchedRef,
      setFacebookPublicationPlacement,
      setFacebookStoryEnabled,
      setSoundtrackByChannel,
      setPinterestBoardId,
      setPinterestBoardName,
      setTiktokPublicationSettings,
      setShowPublicationPreview,
      setPublicationMediaType,
      setChannelMediaModes,
      setVideoFormatByChannel,
      setVideoAdaptationModeByChannel,
      setImages,
      setImagePreviews,
      setRestoredClientMediaKeysByImageKey,
      setRecoveredPreviewErrors,
      setVideoFile,
      setVideoAiContextRef,
      setVideoPreviewUrl,
      setVideoDurationSeconds,
      setVideoSourceMetadata,
      setVideoStorageContext,
      setVideoTransformedVariants,
      setVideoVariantPreparationByChannel,
      buildVideoPreparationStateFromVariants,
      setUseImagesForAI,
      setImageMetaByKey,
      setChannelImageEditors,
      setLoadedPublicationDraftId,
      setLastPublicationDraftSnapshot,
      ...request,
    }, isCancelled);
  });

  useEffect(() => {
    if (
      !publicationDraftIdParam ||
      loadedPublicationDraftId === publicationDraftIdParam
    )
      return;
    let cancelled = false;

    void onPublicationDraftRequested({ publicationDraftIdParam, ctaDefaults, legacyMediaCutoverClientAvailable, onUnsavedChange }, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [
    publicationDraftIdParam,
    loadedPublicationDraftId,
    onUnsavedChange,
    legacyMediaCutoverClientAvailable,
    ctaDefaults,
  ]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  const hasUnsavedChanges = useMemo(
    () =>
      !publicationResult && (Boolean(pdfFile) ||
      (hasDraftablePublicationContent &&
        currentPublicationDraftSnapshot !== lastPublicationDraftSnapshot)),
    [
      publicationResult,
      pdfFile,
      hasDraftablePublicationContent,
      currentPublicationDraftSnapshot,
      lastPublicationDraftSnapshot,
    ],
  );

  useEffect(() => {
    onUnsavedChange?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChange]);

  useEffect(() => {
    if (!hasUnsavedChanges || saving || draftSaving) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges, saving, draftSaving]);

  const confirmDiscardPublicationWork = async (actionLabel: string) => {
    if (!hasUnsavedChanges) return true;
    return confirmInrcy({
      eyebrow: i18nT("publication_en_cours_58f34b8e"),
      title: actionLabel,
      message:
        i18nT("du_contenu_a_deja_ete_saisi_45466126"),
      cancelLabel: i18nT("continuer_l_edition_0f0075bb"),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      variant: "danger",
    });
  };

  const toggle = (key: ChannelKey) => {
    if (!connected[key]) return;
    manuallyControlledChannelsRef.current.add(key);
    setChannels((s) => ({ ...s, [key]: !s[key] }));
  };

  const deselectChannel = (key: ChannelKey) => {
    manuallyControlledChannelsRef.current.add(key);
    setChannels((current) => ({ ...current, [key]: false }));
    setChannelInfoOpen((current) => (current === key ? null : current));
    if (key === "tiktok") {
      setTiktokSettingsOpen(false);
      setTiktokSettingsFlow(null);
      setTiktokPublicationSettings(null);
    }
  };

  const setAllChannelsSelected = (selected: boolean) => {
    CHANNEL_KEYS.forEach((key) => manuallyControlledChannelsRef.current.add(key));
    setChannels((prev) =>
      CHANNEL_KEYS.reduce(
        (acc, key) => ({
          ...acc,
          [key]: connected[key] ? selected : false,
        }),
        { ...prev } as Record<ChannelKey, boolean>,
      ),
    );
    setChannelInfoOpen(null);
  };

  const getChannelDetailInfo = (key: ChannelKey) => {
    const detail = channelDetails[key] || EMPTY_CHANNEL_DETAILS[key];
    const requiresReconnect = Boolean(detail?.requiresReconnect);
    const channelDisabled = Boolean(detail?.disabled);
    const availabilityError = Boolean(detail?.availabilityError);
    const rawLabel = String(detail?.label || detail?.href || "").trim();
    const simplifiedLabel = simplifyChannelDetail(key, rawLabel);
    const statusLabel = availabilityError
      ? i18nT("channel_check_unavailable")
      : channelDisabled
        ? i18nT("channel_disabled_status")
        : requiresReconnect
          ? i18nT("reconnect_in_channels")
          : detail?.connectionStatus === "disconnected"
            ? i18nT("connect_in_channels")
            : "";
    const fullLabel = availabilityError && simplifiedLabel ? simplifiedLabel : statusLabel || simplifiedLabel;
    if (!fullLabel) return null;
    const desktopLabel = truncateText(fullLabel, 34);
    const mobileLabel = truncateText(fullLabel, 24);
    return {
      href: requiresReconnect || availabilityError ? null : detail?.href || null,
      desktopLabel,
      mobileLabel,
      fullLabel,
      requiresReconnect,
      connectionStatus: detail?.connectionStatus || null,
    };
  };


  const clearVideoMedia = (options?: {
    cleanupStorage?: boolean;
    reason?: string;
  }) => {
    clearVideoMediaState(options);
    videoFramesForAiCacheRef.current = null;
    setVideoAiContextRef(null);
  };

  const clearChannelCreationWork = () => {
    manuallyEditedCtaChannelsRef.current.clear();
    setPostsByChannel(prefillConfiguredChannelCtas({}, ctaDefaults));
    setInstagramHashtagsInput("");
    setXHashtagsInput("");
    threadsModeTouchedRef.current = false;
    setThreadsPublicationMode(threadsPublicationPreferencesRef.current.defaultMode);
    instagramPlacementTouchedRef.current = false;
    const instagramDefaultSelection = normalizeMetaPublicationSelection({
      placement: instagramPublicationPreferencesRef.current.defaultMode,
    });
    setInstagramPublicationPlacement(
      instagramDefaultSelection.primaryPlacement === "reel" &&
        instagramPublicationPreferencesRef.current.reelsEnabled
        ? "reel"
        : instagramDefaultSelection.primaryPlacement === "story" &&
            instagramPublicationPreferencesRef.current.storiesEnabled
          ? "story"
          : "classic",
    );
    setInstagramStoryEnabled(
      instagramDefaultSelection.primaryPlacement !== "story" &&
        instagramDefaultSelection.includeStory &&
        instagramPublicationPreferencesRef.current.storiesEnabled,
    );
    facebookPlacementTouchedRef.current = false;
    const facebookDefaultSelection = normalizeMetaPublicationSelection({
      placement: facebookPublicationPreferencesRef.current.defaultMode,
    });
    setFacebookPublicationPlacement(
      facebookDefaultSelection.primaryPlacement === "reel" &&
        facebookPublicationPreferencesRef.current.reelsEnabled
        ? "reel"
        : facebookDefaultSelection.primaryPlacement === "story" &&
            facebookPublicationPreferencesRef.current.storiesEnabled
          ? "story"
          : "classic",
    );
    setFacebookStoryEnabled(
      facebookDefaultSelection.primaryPlacement !== "story" &&
        facebookDefaultSelection.includeStory &&
        facebookPublicationPreferencesRef.current.storiesEnabled,
    );
    closeEmptyContentWarnings();
    setDuplicateFeedback(null);
    setFinalReviewOpen(false);
    setFinalReviewPosts(null);
    setScheduleReviewPosts(null);
    setPendingScheduleRequest(null);
    setPendingImmediatePublishAfterSchedule(null);
    setShowPublicationPreview(false);
  };

  const clearAiCreationWork = () => {
    setIdea("");
    setPublicationInstruction("");
    setDocumentFiles([]);
    setPdfAttachmentError("");
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    setTheme("");
    setContentStyle("equilibre");
    setGenError("");
    setGenerationNotice("");
    setGenerationMediaWarning("");
    resetGenerationProgress();
  };

  const clearPublicationWork = () => {
    latestPublicationSummaryRef.current = null;
    setLivePublicationResult(null);
    setSoundtrackByChannel({});
    clearAiCreationWork();
    clearChannelCreationWork();
    setCreationMode(null);
    setWizardStep("mode");
    setCreationModeError("");
    setDraftMessage("");
    setLastPublicationDraftSnapshot(null);
    setContentWorkspaceOpen(false);
    clearImagesMedia();
    clearVideoMedia({ cleanupStorage: true, reason: "reset-publication" });
    void clearPersistentWorkspaceMedia();
    setPublicationMediaType("images");
    setChannelMediaModes({});
    setImgError("");
    setUseImagesForAI(true);
  };

  const onReset = async () => {
    const ok = await confirmDiscardPublicationWork(
      "Réinitialiser la publication ?",
    );
    if (!ok) return;
    clearPublicationWork();
  };

  const scrollToContentWorkspace = () => {
    setWizardStep("content");
  };

  const onSelectCreationMode = async (nextMode: BoosterCreationMode) => {
    if (generating || saving || draftSaving || scheduleSaving) return;
    if (nextMode === creationMode) return true;

    if (creationMode && hasCurrentCreationModeWork) {
      const switchingFromAi = creationMode === "ai";
      const confirmed = await confirmInrcy({
        eyebrow: i18nT("changement_de_mode_bf3b0963"),
        title: switchingFromAi
          ? "Passer à la création manuelle ?"
          : "Passer à la création avec iNrCy ?",
        message: switchingFromAi
          ? "Votre intention, vos consignes et les contenus générés ou modifiés seront supprimés. Vos canaux et vos médias seront conservés."
          : "Les textes saisis manuellement seront supprimés. Vos canaux et vos médias seront conservés.",
        cancelLabel: i18nT("conserver_mon_travail_5510d9a7"),
        confirmLabel: i18nT("changer_de_mode_9f3792f4"),
        variant: "warning",
      });
      if (!confirmed) return;
    }

    if (creationMode === "ai") {
      clearAiCreationWork();
      clearChannelCreationWork();
    } else if (creationMode === "manual") {
      clearChannelCreationWork();
    }

    setCreationModeError("");
    setPublishError("");
    setImgError("");
    setMediaOptimizerOpen(false);
    setMediaOptimizerPromptOpen(false);
    setMediaOptimizerRequest(null);
    setCreationMode(nextMode);
    setContentWorkspaceOpen(nextMode === "manual");
    if (selectedChannels[0]) setSynchronizedActiveChannel(selectedChannels[0]);

    return true;
  };

  const onPdfChange = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...documentFiles];
    for (const file of Array.from(files)) {
      if (!next.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) next.push(file);
    }
    const error = validateBoosterDocumentSelection(next);
    if (error) { setPdfAttachmentError(error); return; }
    setDocumentFiles(next);
    setPdfAttachmentError("");
    setGenError("");
  };

  const removePdfAttachment = (index = 0) => {
    setDocumentFiles(current => current.filter((_, currentIndex) => currentIndex !== index));
    setPdfAttachmentError("");
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  const onDuplicateContentToAllChannels = async () => {
    const source = getDisplayPost(activeCard);
    const hasSourceContent = Boolean(
      String(source.title || "").trim() || String(source.content || "").trim(),
    );

    if (!hasSourceContent) {
      setDuplicateFeedback({
        kind: "error",
        message: i18nT("ajoutez_au_moins_un_titre_ou_c8f6c900"),
      });
      return;
    }

    if (displayCards.length < 2) {
      setDuplicateFeedback({
        kind: "error",
        message: i18nT("selectionnez_au_moins_2_canaux_pour_fb648ad3"),
      });
      return;
    }

    const confirmed = await confirmInrcy({
      title: i18nT("dupliquer_le_contenu_14027202"),
      message: i18nT("le_titre_et_le_contenu_des_bf6a88fe"),
      confirmLabel: i18nT("dupliquer_c5e1d3f1"),
      variant: "warning",
    });
    if (!confirmed) return;

    const patch: Pick<ChannelPost, "title" | "content"> = {
      title: source.title,
      content: source.content,
    };
    const plainPatch: Pick<ChannelPost, "title" | "content"> = {
      title: stripSiteTextFormatting(source.title),
      content: stripSiteTextFormattingPreserveLayout(source.content),
    };

    setPostsByChannel((prev) => {
      const next: Partial<Record<ChannelKey, ChannelPost>> = { ...prev };
      for (const key of displayCards) {
        next[key] = {
          ...normalizePost(prev[key]),
          ...(isSiteDisplayKey(key) ? patch : plainPatch),
        };
      }
      return next;
    });

    setDuplicateFeedback({
      kind: "success",
      message: i18nT("titre_et_contenu_dupliques_sur_tous_f153bba6"),
    });
  };

  const onPickVideoClick = (
    destination: BoosterMediaInsertionDestination = { kind: "publication" },
  ) => {
    pendingDirectMediaDestinationRef.current = destination;
    videoPickerTargetChannelRef.current = null;
    setImgError("");
    videoInputRef.current?.click();
  };


  const removeVideo = () => {
    setImgError("");
    clearVideoMedia({ cleanupStorage: true, reason: "remove-video" });
    void syncPersistentWorkspaceVideo(null);
    setPublicationMediaType("images");
    setChannelMediaModes((prev) => {
      const next: Partial<Record<ChannelKey, ChannelMediaMode>> = { ...prev };
      for (const key of Object.keys(next) as ChannelKey[]) {
        if (next[key] === "video")
          next[key] = images.length ? "images" : "none";
      }
      return next;
    });
  };

  const addVideoFile = async (
    file: File | null,
    options?: {
      hasImages?: boolean;
      targetChannel?: ChannelKey;
      transferredMetadata?: TransferableMediaMetadata | null;
    },
  ) => {
    if (!file) return false;
    const channelModesBeforeVideo = options?.targetChannel
      ? Array.from(
          new Set<ChannelKey>([
            ...selectedChannels,
            options.targetChannel,
          ]),
        ).reduce<Partial<Record<ChannelKey, ChannelMediaMode>>>(
          (modes, channel) => {
            modes[channel] = resolveChannelMediaMode(channel);
            return modes;
          },
          {},
        )
      : null;
    setImgError("");
    setVideoVariantPreparationByChannel({});
    setVideoTransformedVariants([]);

    const detectedMediaType = detectUniversalUploadMediaType({
      name: file.name,
      mimeType: file.type,
    });
    if (detectedMediaType !== "video") {
      setImgError(i18nT("ajoutez_une_video_valide_value_10fc4557", { value0: BOOSTER_VIDEO_FORMATS_LABEL }));
      return false;
    }

    const optimizationRequirements = getMediaLibraryOptimizationRequirements({
      mediaType: "video",
      sizeBytes: file.size,
      targetBytes: BOOSTER_MAX_VIDEO_BYTES,
      name: file.name,
      mimeType: file.type,
    });
    if (optimizationRequirements.needsOptimization) {
      registerOversizedMedia(file, options?.targetChannel);
      return false;
    }

    if (!isBoosterVideoFile(file)) {
      setImgError(i18nT("ajoutez_une_video_valide_value_10fc4557", { value0: BOOSTER_VIDEO_FORMATS_LABEL }));
      return false;
    }

    clearVideoMedia({ cleanupStorage: true, reason: "replace-video" });
    const normalizedFile = new File([file], buildVideoFileName(file), {
      type: file.type || "video/mp4",
      lastModified: file.lastModified || Date.now(),
    });
    let sourceMetadata = buildTransferredBoosterVideoMetadata(
      normalizedFile,
      options?.transferredMetadata,
    );
    if (!hasCompleteVideoMetadata(options?.transferredMetadata)) {
      try {
        const browserMetadata = await readVideoSourceMetadata(normalizedFile);
        sourceMetadata = buildTransferredBoosterVideoMetadata(
          normalizedFile,
          browserMetadata,
          sourceMetadata,
        );
      } catch {
        // Les informations transmises par la Médiathèque restent utilisables
        // même si le navigateur du client ne sait pas lire le conteneur.
      }
    }
    const duration = sourceMetadata?.duration ?? null;

    setPublicationMediaType("video");
    setVideoFile(normalizedFile);
    setVideoPreviewUrl(URL.createObjectURL(normalizedFile));
    setVideoDurationSeconds(duration);
    setVideoSourceMetadata(sourceMetadata);
    setVideoStorageContext(null);
    void syncPersistentWorkspaceVideo(normalizedFile, {
      duration,
      source_metadata: sourceMetadata,
    });
    setVideoFormatByChannel((prev) => {
      const next: Partial<Record<ChannelKey, VideoFormat>> = { ...prev };
      for (const channel of selectedChannels.length
        ? selectedChannels
        : CHANNEL_KEYS) {
        next[channel] = "original";
      }
      return next;
    });
    setVideoAdaptationModeByChannel((prev) => {
      const next: Partial<Record<ChannelKey, VideoAdaptationMode>> = {
        ...prev,
      };
      for (const channel of selectedChannels.length
        ? selectedChannels
        : CHANNEL_KEYS) {
        next[channel] = normalizeVideoAdaptationMode(
          next[channel] || "safe_frame",
        );
      }
      return next;
    });
    setUseImagesForAI(true);
    setChannelMediaModes((prev) => {
      const next: Partial<Record<ChannelKey, ChannelMediaMode>> = { ...prev };
      if (options?.targetChannel) {
        for (const channel of selectedChannels) {
          if (channel === options.targetChannel) continue;
          next[channel] = channelModesBeforeVideo?.[channel] || "none";
        }
        return assignVideoSourceToChannel(next, options.targetChannel);
      }
      const hadImagesBeforeVideo = options?.hasImages ?? images.length > 0;
      for (const channel of selectedChannels) {
        const current = next[channel];
        const channelHasImages =
          channelSupportsImages(channel) &&
          (channelImageEditors[channel]?.imageKeys?.length || 0) > 0;

        if (channel === "youtube_shorts") {
          next[channel] = "video";
          continue;
        }

        if (
          hadImagesBeforeVideo &&
          current === "images" &&
          channelSupportsImages(channel)
        ) {
          next[channel] = "images";
          continue;
        }

        if (hadImagesBeforeVideo && channelHasImages) {
          next[channel] = "images";
          continue;
        }

        if (
          hadImagesBeforeVideo &&
          current === "none" &&
          channelSupportsTextOnly(channel)
        ) {
          next[channel] = "none";
          continue;
        }

        next[channel] = "video";
      }
      return next;
    });
    return true;
  };

  const onVideoChange = async (files: FileList | null) => {
    const file = files?.[0] || null;
    const targetChannel = videoPickerTargetChannelRef.current;
    videoPickerTargetChannelRef.current = null;
    await addVideoFile(file, {
      targetChannel: targetChannel || undefined,
    });
  };

  async function mediaLibraryItemToFile(item: MediaLibraryPickerItem) {
    const url = String(item.signed_url || "").trim();
    if (!url) {
      throw new Error("Ce média n’a pas d’URL de lecture temporaire.");
    }

    const retryDelaysMs = [0, 400, 1_100, 2_400] as const;
    let blob: Blob | null = null;
    let incompleteDownload = false;

    // L'URL acceptée est stable et recrée une signature Storage à chaque
    // tentative. Sur mobile, une perte réseau après la génération ne doit donc
    // jamais imposer de payer/générer une seconde image.
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
      const delayMs = retryDelaysMs[attempt];
      if (delayMs > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
      }
      try {
        const response = await fetch(url, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok || response.status === 206 ||
            response.headers.has("Content-Range")) {
          if (response.status === 206 || response.headers.has("Content-Range")) {
            incompleteDownload = true;
          }
          continue;
        }
        const downloaded = await response.blob();
        if (!isCompleteMediaLibraryDownload({
          status: response.status,
          contentRange: response.headers.get("Content-Range"),
          downloadedBytes: downloaded.size,
          expectedBytes: item.size_bytes,
        })) {
          incompleteDownload = true;
          continue;
        }
        blob = downloaded;
        break;
      } catch {
        // Safari/Chrome mobile remontent ici "Load failed"/"Failed to fetch".
        // La prochaine tentative rejoue la lecture de la même ligne active.
      }
    }

    if (!blob) {
      throw new Error(
        incompleteDownload
          ? "Le fichier reçu depuis la Médiathèque est incomplet. Réessayez son insertion sans le régénérer."
          : "Le média est bien enregistré dans la Médiathèque, mais le réseau n’a pas permis de l’insérer. Réessayez sans le régénérer."
      );
    }
    const mimeType =
      item.mime_type ||
      blob.type ||
      (item.media_type === "video" ? "video/mp4" : "image/jpeg");
    return new File([blob], buildMediaLibraryDownloadFileName(item), {
      type:
        mimeType,
      lastModified: Date.now(),
    });
  }

  const addMediaLibrarySelection = async (
    items: MediaLibraryPickerItem[],
    destination: BoosterMediaInsertionDestination =
      getMediaLibraryPickerDestination(),
  ) => {
    if (!items.length) return false;
    setImgError("");
    const videos = items.filter((item) => item.media_type === "video");
    const imagesFromLibrary = items.filter(
      (item) => item.media_type === "image",
    );

    if (destination.kind === "generation") {
      const exclusiveSelectionError = getGenerationMediaSelectionError({
        existingImageCount: images.length,
        hasExistingVideo: Boolean(videoFile || videoPreviewUrl),
        selectedImageCount: imagesFromLibrary.length,
        selectedVideoCount: videos.length,
      });
      if (exclusiveSelectionError) throw new Error(exclusiveSelectionError);
    }

    if (videos.length > 1) {
      throw new Error("Une seule vidéo peut être ajoutée à une publication.");
    }

    const remaining = Math.max(0, BOOSTER_MAX_IMAGE_COUNT - images.length);
    const selectedImages = imagesFromLibrary.slice(0, remaining);
    if (!selectedImages.length && !videos.length) {
      throw new Error(`${BOOSTER_MAX_IMAGE_COUNT} images maximum.`);
    }

    const [files, selectedVideo] = await Promise.all([
      Promise.all(
        selectedImages.map((item) => mediaLibraryItemToFile(item)),
      ),
      videos[0] ? mediaLibraryItemToFile(videos[0]) : Promise.resolve(null),
    ]);

    if (files.length) {
      const inserted = await addImageFiles(
        files,
        destination.kind === "channel" ? destination.channel : undefined,
        selectedImages,
      );
      if (!inserted) {
        throw new Error(
          "Les images sélectionnées n’ont pas pu être insérées dans Booster.",
        );
      }
    }
    if (selectedVideo) {
      const inserted = await addVideoFile(selectedVideo, {
        hasImages: images.length + files.length > 0,
        targetChannel:
          destination.kind === "channel" ? destination.channel : undefined,
        transferredMetadata: videos[0] || null,
      });
      if (!inserted) {
        throw new Error(
          "La vidéo est prête, mais Booster ne peut pas l’insérer avec la sélection actuelle.",
        );
      }
    }
    if (imagesFromLibrary.length > selectedImages.length) {
      setImgError(
        i18nT("value_image_s_ajoutee_s_maximum_ccd2bcaf", { value0: selectedImages.length, value1: BOOSTER_MAX_IMAGE_COUNT }),
      );
    }
    return true;
  };

  const studioReturnKey = String(searchParams?.get("studio_return") || "").trim();

  useEffect(() => {
    if (!studioReturnKey) return;
    const result = consumeInrStudioReturn(studioReturnKey);
    if (!result?.item) return;

    const nextParams = new URLSearchParams(searchParams?.toString() || "");
    nextParams.delete("studio_return");
    router.replace(
      `${window.location.pathname}${nextParams.size ? `?${nextParams.toString()}` : ""}`,
      { scroll: false },
    );

    setPendingStudioReturn(result);
  }, [router, searchParams, studioReturnKey]);

  const onStudioReturnReady = useEffectEvent((pendingStudioReturn: InrStudioReturnedMedia | null, loadedPublicationDraftId: string | null, completeReturn: () => void) => {
    if (!pendingStudioReturn?.item) return;
    const expectedDraftId = String(
      pendingStudioReturn.context.draftId || "",
    ).trim();
    if (
      pendingStudioReturn.returnKey !== inlineStudioReturnKeyRef.current &&
      expectedDraftId &&
      loadedPublicationDraftId !== expectedDraftId
    ) {
      return;
    }
    if (
      studioReturnApplyingKeyRef.current === pendingStudioReturn.returnKey
    ) {
      return;
    }
    studioReturnApplyingKeyRef.current = pendingStudioReturn.returnKey;

    const returnedRecord = pendingStudioReturn.item;
    const returnedItem = returnedRecord as unknown as MediaLibraryPickerItem;
    const returnedMediaType = String(returnedRecord.media_type || "").trim();
    const isReturnedVideo =
      pendingStudioReturn.action === "retouch" &&
      (pendingStudioReturn.context.mediaType === "video" ||
        returnedMediaType === "video" ||
        returnedRecord.studio_video_retouch === true);

    if (isReturnedVideo) {
      const rawChannel = String(
        pendingStudioReturn.context.channel || "",
      ).trim();
      if (!isChannelKey(rawChannel)) {
        setImgError(mediaT("ai_generator_insert_error"));
        setPendingStudioReturn(null);
        studioReturnApplyingKeyRef.current = "";
        completeReturn();
        return;
      }

      const channel = rawChannel;
      const format = normalizeVideoFormat(
        channel,
        returnedRecord.video_format,
      );
      const adaptationMode = normalizeVideoAdaptationMode(
        returnedRecord.video_adaptation_mode,
      );
      const returnedVariants = normalizeRestoredVideoVariants(
        returnedRecord.transformed_variants,
      );
      // La variante fraîche d'iNrStudio gagne si une ancienne variante avait
      // déjà la même signature. Les variantes des autres canaux sont gardées.
      const mergedVariants = normalizeRestoredVideoVariants([
        ...returnedVariants,
        ...videoTransformedVariants,
      ]);
      const storagePath = String(
        returnedRecord.storage_path || "",
      ).trim();
      const publicUrl = String(
        returnedRecord.signed_url ||
          returnedRecord.public_url ||
          returnedRecord.publicUrl ||
          "",
      ).trim();
      const rawSourceMetadata = returnedRecord.source_metadata;
      const returnedSourceMetadata =
        rawSourceMetadata &&
        typeof rawSourceMetadata === "object" &&
        !Array.isArray(rawSourceMetadata)
          ? (rawSourceMetadata as BoosterVideoSourceMetadata)
          : null;
      const returnedDuration = Number(
        returnedRecord.duration_seconds || returnedSourceMetadata?.duration || 0,
      );

      const applyReturnedVideoSettings = () => {
        setVideoFormatByChannel((current) => ({
          ...current,
          [channel]: format,
        }));
        setVideoAdaptationModeByChannel((current) => ({
          ...current,
          [channel]: adaptationMode,
        }));
        setVideoTransformedVariants(mergedVariants);
        // Ne remplace pas le stockage durable du brouillon Booster par une URL
        // signée temporaire de la Médiathèque. Une nouvelle source reste un
        // File local et repassera par l'upload Booster au prochain save/publish.
        if (
          !sourceWasReplaced &&
          !videoStorageContext &&
          !mediaPipelineCutoverEnabled &&
          (storagePath || publicUrl)
        ) {
          setVideoStorageContext({
            storagePath,
            publicUrl,
            url: publicUrl,
          });
        }
        if (returnedSourceMetadata) {
          setVideoSourceMetadata(returnedSourceMetadata);
        }
        if (Number.isFinite(returnedDuration) && returnedDuration > 0) {
          setVideoDurationSeconds(returnedDuration);
        }
        setVideoVariantPreparationByChannel((current) => {
          const next = { ...current };
          delete next[channel];
          if (mediaPipelineCutoverEnabled) return next;
          return {
            ...next,
            ...buildVideoPreparationStateFromVariants({
              channels: [channel],
              mediaModeByChannel: { [channel]: "video" },
              variants: mergedVariants,
              settingsByChannel: {
                [channel]: { format, adaptationMode },
              },
            }),
          };
        });
        setImgError("");
      };

      const sourceNameBeforeStudio = String(
        pendingStudioReturn.context.videoSourceName || "",
      ).trim();
      const sourceSizeBeforeStudio = Number(
        pendingStudioReturn.context.videoSourceSize || 0,
      );
      const sourceStorageBeforeStudio = String(
        pendingStudioReturn.context.videoSourceStoragePath || "",
      ).trim();
      const returnedSourceName = String(
        returnedRecord.original_file_name || "",
      ).trim();
      const returnedSourceSize = Number(returnedRecord.size_bytes || 0);
      const sourceWasReplaced =
        !videoFile ||
        Boolean(
          sourceNameBeforeStudio &&
            returnedSourceName &&
            sourceNameBeforeStudio !== returnedSourceName,
        ) ||
        Boolean(
          sourceSizeBeforeStudio > 0 &&
            returnedSourceSize > 0 &&
            sourceSizeBeforeStudio !== returnedSourceSize,
        ) ||
        Boolean(
          sourceStorageBeforeStudio &&
            storagePath &&
            sourceStorageBeforeStudio !== storagePath,
        );

      const replacement =
        sourceWasReplaced && returnedItem.signed_url
          ? mediaLibraryItemToFile(returnedItem).then((file) =>
              addVideoFile(file, {
                hasImages: images.length > 0,
                targetChannel: channel,
                transferredMetadata: returnedItem,
              }),
            )
          : Promise.resolve(true);

      void replacement
        .then((replaced) => {
          if (!replaced) {
            throw new Error(mediaT("ai_generator_insert_error"));
          }
          applyReturnedVideoSettings();
        })
        .catch((error) =>
          setImgError(
            error instanceof Error
              ? error.message
              : mediaT("ai_generator_insert_error"),
          ),
        )
        .finally(() => {
          setPendingStudioReturn(null);
          studioReturnApplyingKeyRef.current = "";
          completeReturn();
        });
      return;
    }

    if (
      pendingStudioReturn.action === "retouch" ||
      pendingStudioReturn.action === "modify"
    ) {
      const imageKey = String(
        pendingStudioReturn.context.imageKey || "",
      ).trim();
      if (!imageKey || returnedItem.media_type !== "image") {
        setImgError(mediaT("ai_generator_insert_error"));
        setPendingStudioReturn(null);
        studioReturnApplyingKeyRef.current = "";
        completeReturn();
        return;
      }
      void mediaLibraryItemToFile(returnedItem)
        .then((file) => replaceImageFile(imageKey, file, returnedItem))
        .then((replaced) => {
          if (!replaced) setImgError(mediaT("ai_generator_insert_error"));
        })
        .catch((error) =>
          setImgError(
            error instanceof Error
              ? error.message
              : mediaT("ai_generator_insert_error"),
          ),
        )
        .finally(() => {
          setPendingStudioReturn(null);
          studioReturnApplyingKeyRef.current = "";
          completeReturn();
        });
      return;
    }

    void addMediaLibrarySelection([returnedItem], { kind: "publication" }).then(
      (inserted) => {
        if (!inserted) setImgError(mediaT("ai_generator_insert_error"));
      },
    ).catch((error) => {
      setImgError(error instanceof Error ? error.message : mediaT("ai_generator_insert_error"));
    }).finally(() => {
      setPendingStudioReturn(null);
      studioReturnApplyingKeyRef.current = "";
      completeReturn();
    });
  });
  useEffect(() => {
    onStudioReturnReady(pendingStudioReturn, loadedPublicationDraftId, completeReturn);
  }, [completeReturn, loadedPublicationDraftId, pendingStudioReturn]);

  const applyOptimizedMediaToBooster = async (item: MediaOptimizerItem) => {
    setImgError("");
    const request = mediaOptimizerRequest;
    if (!request) {
      throw new Error(
        "La destination du média compressé n’est plus disponible. Réessayez depuis Booster.",
      );
    }

    if (item.media_type !== request.mediaType) {
      throw new Error(
        "Le type du média compressé ne correspond pas au fichier sélectionné.",
      );
    }

    await addMediaLibrarySelection([item], request.destination);
    setImgError("");
    setMediaOptimizerCompleted(true);
  };

  const onTakePhotoClick = async (
    targetChannel?: ChannelKey,
    scope: "generation" | "publication" = "publication",
  ) => {
    setImgError("");
    if (images.length >= BOOSTER_MAX_IMAGE_COUNT) {
      setImgError(i18nT("maximum_value_images_f2da2faa", { value0: BOOSTER_MAX_IMAGE_COUNT }));
      return;
    }
    preservePublishScroll();
    setCameraCaptureScope(targetChannel ? "publication" : scope);
    setCameraCaptureTargetChannel(targetChannel ?? null);
    setCameraCaptureOpen(true);
  };

  const closeCameraCapture = () => {
    setCameraCaptureOpen(false);
    restorePublishScroll();
  };

  const onCameraCapture = async (file: File) => {
    if (cameraCaptureScope === "generation") {
      const isVideoCapture = isBoosterVideoFile(file);
      const exclusiveSelectionError = getGenerationMediaSelectionError({
        existingImageCount: images.length,
        hasExistingVideo: Boolean(videoFile || videoPreviewUrl),
        selectedImageCount: isVideoCapture ? 0 : 1,
        selectedVideoCount: isVideoCapture ? 1 : 0,
      });
      if (exclusiveSelectionError) {
        setImgError(exclusiveSelectionError);
        closeCameraCapture();
        return;
      }
    }
    pendingDirectMediaDestinationRef.current = cameraCaptureTargetChannel
      ? { kind: "channel", channel: cameraCaptureTargetChannel }
      : cameraCaptureScope === "generation"
        ? { kind: "generation" }
        : { kind: "publication" };
    if (isBoosterVideoFile(file) && cameraCaptureTargetChannel === null) {
      await addVideoFile(file);
    } else {
      await addImageFiles([file], cameraCaptureTargetChannel ?? undefined);
    }
    restorePublishScroll();
  };

  const updatePost = (
    channel: ChannelKey,
    patch: Partial<ChannelPost>,
    options?: { sanitize?: boolean },
  ) => {
    if (
      "cta" in patch ||
      "ctaMode" in patch ||
      "ctaUrl" in patch ||
      "ctaPhone" in patch
    ) {
      manuallyEditedCtaChannelsRef.current.add(channel);
    }
    setPostsByChannel((prev) => {
      const current = normalizePost(prev[channel]);
    const nextPatch =
      options?.sanitize === false
        ? patch
        : sanitizePatchForEditor(channel, patch);
    if (channel === "inr_search" && typeof nextPatch.content === "string") {
      nextPatch.content = nextPatch.content
        .slice(0, INR_SEARCH_CONTENT_MAX_LENGTH)
        .trim();
    }
    const merged = {
        ...current,
        ...nextPatch,
      };

      return {
        ...prev,
        [channel]:
          options?.sanitize === false
            ? normalizePost(merged)
            : sanitizePostForEditor(channel, merged),
      };
    });
  };

  const getDisplayPost = (key: DisplayKey): ChannelPost => {
    return normalizePost(postsByChannel[key]);
  };

  const getPreviewCtaForDisplayKey = (key: DisplayKey, post: ChannelPost) =>
    buildCtaTextForChannel(key, post, {
      websiteUrl: getWebsiteUrlForChannel(key, ctaDefaults),
      phone: ctaDefaults?.phone || "",
    });

  const getLiveInstagramHashtags = () =>
    parseInstagramHashtagsInput(instagramHashtagsInput);

  const buildPreparedPostsByChannel = (): Partial<
    Record<ChannelKey, ChannelPost>
  > => {
    const prepared: Partial<Record<ChannelKey, ChannelPost>> = {
      ...postsByChannel,
      instagram: normalizePost({
        ...postsByChannel.instagram,
        hashtags: getLiveInstagramHashtags(),
      }),
    };
    for (const key of CHANNEL_KEYS) {
      if (!prepared[key]) continue;
      // Une URL saisie pour X doit rester visible et bloquante jusqu'à sa
      // correction explicite. Ne jamais la retirer silencieusement ici.
      const structuredSafePost =
        key === "x"
          ? normalizePost(prepared[key])
          : sanitizeBoosterPostForStructuredCta(prepared[key], {
              websiteUrl: getWebsiteUrlForChannel(key, ctaDefaults),
              phone: ctaDefaults?.phone || "",
            });
      if (isSiteDisplayKey(key)) {
        prepared[key] = normalizePost(structuredSafePost);
        continue;
      }
      prepared[key] = normalizePost({
        ...structuredSafePost,
        title: stripSiteTextFormatting(structuredSafePost.title || ""),
        content: stripSiteTextFormattingPreserveLayout(
          structuredSafePost.content || "",
        ),
        cta: stripSiteTextFormatting(structuredSafePost.cta || ""),
        hashtags:
          key === "x"
            ? (structuredSafePost.hashtags || []).slice(0, 2)
            : structuredSafePost.hashtags,
      });
    }

    return prepared;
  };

  const filterPostsForSelectedChannels = (
    preparedPosts: Partial<Record<ChannelKey, ChannelPost>>,
    channelsToKeep: ChannelKey[],
  ): Partial<Record<ChannelKey, ChannelPost>> => {
    return channelsToKeep.reduce(
      (acc, channel) => {
        const post = preparedPosts[channel];
        if (!post) return acc;
        const metaSelection =
          channel === "instagram"
            ? buildMetaPublicationSelection(
                instagramPublicationPlacement,
                instagramStoryEnabled,
              )
            : channel === "facebook"
              ? buildMetaPublicationSelection(
                  facebookPublicationPlacement,
                  facebookStoryEnabled,
                )
              : null;
        acc[channel] = metaSelection
          ? stripMetaStoryOnlyPostContent(post, metaSelection)
          : post;
        return acc;
      },
      {} as Partial<Record<ChannelKey, ChannelPost>>,
    );
  };


  const displayKeyForImageChannel = (channel: ChannelKey): DisplayKey =>
    channel;

  const getPublicationVideoPreviewForChannel = (channel: ChannelKey) => {
    const displayKey = displayKeyForImageChannel(channel);
    const post = getDisplayPost(displayKey);
    const selectedVideoFormat = normalizeVideoFormat(
      channel,
      videoFormatByChannel[channel] || "original",
    );
    const selectedVideoAdaptation = normalizeVideoAdaptationMode(
      videoAdaptationModeByChannel[channel],
    );
    const signature = buildVideoTransformSignature(
      selectedVideoFormat,
      selectedVideoAdaptation,
      getVideoPublicationProfileForChannel(channel),
    );
    const preparedVariant = videoTransformedVariants.find(
      (variant) => variant.signature === signature,
    );
    const preparedPreviewUrl = String(preparedVariant?.publicUrl || "").trim();
    const finalPreviewUrl = preparedPreviewUrl || videoPreviewUrl;
    return {
      channelKey: channel,
      channelLabel: getLocalizedChannelLabel(channel, runtimeT),
      mediaType: "video" as const,
      accountName: getChannelDetailInfo(channel)?.fullLabel,
      title: post.title,
      content: post.content,
      cta: getPreviewCtaForDisplayKey(displayKey, post),
      hashtags:
        displayKey === "instagram"
          ? getLiveInstagramHashtags()
          : post.hashtags || [],
      imageCount: 0,
      formatLabel: i18nT("video_value_value_value_07f9ed6e", {
        value0: getLocalizedVideoFormatLabel(
          channel,
          selectedVideoFormat,
          videoSourceMetadata,
          runtimeT,
        ),
        value1: getLocalizedVideoAdaptationModeLabel(
          selectedVideoAdaptation,
          runtimeT,
        ),
        value2: preparedPreviewUrl
          ? i18nT("video_final_preview_suffix")
          : "",
      }),
      video: finalPreviewUrl
        ? {
            previewUrl: finalPreviewUrl,
            name: preparedVariant?.key || videoFile?.name || "video-inrcy.mp4",
            type:
              preparedVariant?.contentType || videoFile?.type || "video/mp4",
            size: preparedVariant?.size || videoFile?.size || 0,
            duration: preparedVariant?.duration ?? videoDurationSeconds,
            sourceMetadata: videoSourceMetadata,
            aspectRatio:
              selectedVideoFormat === "original" &&
              videoSourceMetadata?.width &&
              videoSourceMetadata?.height
                ? `${videoSourceMetadata.width} / ${videoSourceMetadata.height}`
                : VIDEO_FORMAT_ASPECT_RATIOS[selectedVideoFormat] || "16 / 9",
            fitMode: preparedPreviewUrl
              ? "contain"
              : selectedVideoAdaptation === "cover_crop"
                ? "cover"
                : "contain",
          }
        : null,
      image: null,
      images: [],
    };
  };

  const getPublicationPreviewForChannel = (channel: ChannelKey) => {
    const editor = channelImageEditors[channel] || {
      imageKeys: [],
      transforms: {},
    };
    const selectedKeys = editor.imageKeys || [];
    const firstImageKey = selectedKeys[0] || "";
    const transform = firstImageKey
      ? editor.transforms?.[firstImageKey] ||
        getOptimizedTransform(channel, imageMetaByKey[firstImageKey])
      : undefined;
    const displayKey = displayKeyForImageChannel(channel);
    const post = getDisplayPost(displayKey);
    return {
      channelKey: channel,
      channelLabel: getLocalizedChannelLabel(channel, runtimeT),
      title: post.title,
      accountName: getChannelDetailInfo(channel)?.fullLabel,
      content: post.content,
      cta: getPreviewCtaForDisplayKey(displayKey, post),
      hashtags:
        displayKey === "instagram"
          ? getLiveInstagramHashtags()
          : post.hashtags || [],
      imageCount: selectedKeys.length,
      formatLabel:
        channel === "site_web" || channel === "inr_search"
          ? i18nT("preview_format_site")
          : channel === "tiktok"
            ? i18nT("preview_format_tiktok", {
                width: CHANNEL_PRESETS[channel].width,
                height: CHANNEL_PRESETS[channel].height,
              })
            : i18nT("preview_format_final", {
                width: CHANNEL_PRESETS[channel].width,
                height: CHANNEL_PRESETS[channel].height,
              }),
      image: firstImageKey
        ? {
            previewUrl: previewByKey[firstImageKey],
            transform,
            preset: CHANNEL_PRESETS[channel],
            imageMeta: imageMetaByKey[firstImageKey],
          }
        : null,
      images: selectedKeys.map((imageKey) => ({
        previewUrl: previewByKey[imageKey],
        transform:
          editor.transforms?.[imageKey] ||
          getOptimizedTransform(channel, imageMetaByKey[imageKey]),
        preset: CHANNEL_PRESETS[channel],
        imageMeta: imageMetaByKey[imageKey],
      })),
    };
  };

  const activePreviewChannel = selectedChannels.includes(activeImageChannel)
    ? activeImageChannel
    : selectedChannels[0] || "site_web";

  const activePublicationPreview = (() => {
    if (!selectedChannels.length) return null;
    const mode = resolveChannelMediaMode(activePreviewChannel);
    if (mode === "video" && videoPreviewUrl)
      return getPublicationVideoPreviewForChannel(activePreviewChannel);
    if (mode === "images" && images.length)
      return getPublicationPreviewForChannel(activePreviewChannel);
    if (mode === "none") {
      const displayKey = displayKeyForImageChannel(activePreviewChannel);
      const post = getDisplayPost(displayKey);
      return {
        channelKey: activePreviewChannel,
        channelLabel: getLocalizedChannelLabel(activePreviewChannel, runtimeT),
        mediaType: "images" as const,
        accountName: getChannelDetailInfo(activePreviewChannel)?.fullLabel,
        title: post.title,
        content: post.content,
        cta: getPreviewCtaForDisplayKey(displayKey, post),
        hashtags:
          displayKey === "instagram"
            ? getLiveInstagramHashtags()
            : post.hashtags || [],
        imageCount: 0,
        formatLabel: activePreviewChannel === "threads" && threadsPublicationMode === "ghost" ? i18nT("threads_ghost_preview") : i18nT("texte_seul_24210789"),
        image: null,
        images: [],
        video: null,
      };
    }
    return null;
  })();

  const tiktokCurrentSignature = JSON.stringify({
    account: getChannelDetailInfo("tiktok")?.mobileLabel,
    connected: connected.tiktok,
    post: buildPreparedPostsByChannel().tiktok,
    mode: resolveChannelMediaMode("tiktok"),
    images: getPublishImageKeysForChannel("tiktok").map((key) => ({ key, transform: channelImageEditors.tiktok?.transforms?.[key] })),
    video: videoFile ? { name: videoFile.name, size: videoFile.size, lastModified: videoFile.lastModified, url: videoPreviewUrl } : { url: videoPreviewUrl },
    videoSettings: videoSettingsByChannel.tiktok,
  });
  const tiktokReviewCurrent = Boolean(tiktokPublicationSettings && tiktokReviewSignature === tiktokCurrentSignature);

  const closeEmptyContentWarnings = () => {
    setEmptyContentWarningChannels([]);
    setEmptyContentWarningIndex(0);
  };

  const applyPreferredCtaPrefill = (
    displayKey: DisplayKey,
    choice: BoosterPreferredCta,
  ) => {
    const current = getDisplayPost(displayKey);
    const patch = buildPreferredCtaPatch(
      displayKey,
      choice,
      current,
      ctaDefaults,
      ctaDefaults?.aiLanguage,
    );
    updatePost(displayKey, patch);
  };

  const applySiteContentFormat = (kind: "bold" | "italic" | "underline") => {
    if (!isSiteDisplayKey(activeCard) || typeof document === "undefined")
      return;
    const editor = siteContentEditorRef.current;
    if (!editor) return;

    try {
      editor.focus({ preventScroll: true });
    } catch {
      editor.focus();
    }
    const command =
      kind === "bold" ? "bold" : kind === "italic" ? "italic" : "underline";
    document.execCommand(command, false);
    updatePost(activeCard, {
      content: editableHtmlToSiteText(readSanitizedElementHtml(editor)),
    });
  };

  const { runPublish, performSchedulePublication, publishImmediateChannelsAfterSchedule } =
    createPublicationSubmission(() => ({
      state: {
        saving,
        draftSaving,
        voiceInputBusy,
        publishStartGuardRef,
        authoritativeChannelsRef,
        connectedChannelsScopeRef,
        activeAccountId,
        i18nT,
        publicationActorScopeRef,
        actorUserId,
        latestPublicationSummaryRef,
        selectedChannels,
        phasedPublicationProgressRef,
        facebookPublicationPlacement,
        facebookStoryEnabled,
        pinterestBoardId,
        creationMode,
        idea,
        theme,
        tiktokPublicationSettings,
        threadsPublicationMode,
        instagramPublicationPlacement,
        instagramStoryEnabled,
        pinterestBoardName,
        channelDetails,
        scheduleSaving,
        scheduleStartGuardRef,
      },
      media: {
        persistentMediaWorkspaceEnabled,
        mediaPipelineCutoverEnabled,
        images,
        videoFile,
        videoSettingsByChannel,
        videoDurationSeconds,
        videoSourceMetadata,
        persistentMediaSynchronizing,
        persistentMediaStates,
        videoVariantPreparationByChannel,
        channelImageEditors,
        imageMetaByKey,
        unifiedMediaConsumptionClientAvailable,
        mediaWorkspaceClientKey,
        videoFormatByChannel,
        videoAdaptationModeByChannel,
      },
      preparation: {
        buildPreparedPostsByChannel,
        getImagePreparationIssue,
        resolveChannelMediaMode,
        waitForPersistentWorkspaceIdle,
        buildFinalReviewItems,
        waitForPersistentWorkspaceReadiness,
        buildChannelImageSettingsPayload,
        buildChannelImagesPayload,
        uploadOriginalImagesForPublication,
        uploadPublicationVideoForPublish,
        preparePublicationVideoVariants,
        getPublicationSoundtracks,
        filterPostsForSelectedChannels,
      },
      actions: {
        setPublishError,
        setDraftMessage,
        setImgError,
        setPublishProgress,
        setPublishProgressLabel,
        resetPublicationProgressPhases,
        scrollToPublishArea,
        setPublicationDestinations,
        setSaving,
        setPublicationProgressPhase,
        setPostsByChannel,
        setPendingPublishPosts,
        setEmptyContentWarningChannels,
        setEmptyContentWarningIndex,
        closeEmptyContentWarnings,
        trackEvent,
        completePublicationProgress,
        onUnsavedChange,
        setChannelDetails,
        archivePersistentMediaWorkspace,
        onPublishSuccess,
        onClose,
        setScheduleError,
        setScheduleSaving,
        setChannels,
        setPendingImmediatePublishAfterSchedule,
        setScheduleReviewPosts,
        setTiktokPublicationSettings,
        setTiktokSettingsFlow,
        setPendingScheduleRequest,
      },
    }));

  const onSavePublicationDraft = (options?: { updateRoute?: boolean }) =>
    savePublicationDraft({
      saving,
      draftSaving,
      voiceInputBusy,
      setPublishError,
      setDraftMessage,
      hasDraftablePublicationContent,
      i18nT,
      scrollToPublishArea,
      selectedChannels,
      filterPostsForSelectedChannels,
      buildPreparedPostsByChannel,
      images,
      videoFile,
      videoDurationSeconds,
      setDraftSaving,
      mediaPipelineCutoverEnabled,
      mediaWorkspaceId,
      uploadPublicationDraftImages,
      buildPublicationDraftVideoPayload,
      lastSavedStudioVideoDraftRef,
      videoAiContextRef,
      loadedPublicationDraftId,
      publicationDraftIdParam,
      creationMode,
      soundtrackByChannel,
      mediaWorkspaceClientKey,
      idea,
      publicationInstruction,
      theme,
      contentStyle,
      selectedAiPreferredEngine,
      activeCard,
      contentWorkspaceOpen,
      channelMediaModes,
      videoFormatByChannel,
      videoAdaptationModeByChannel,
      videoSettingsByChannel,
      videoSourceMetadata,
      imageMetaByKey,
      useImagesForAI,
      getDraftImageSettingsByChannel,
      threadsPublicationMode,
      instagramHashtagsInput,
      xHashtagsInput,
      instagramPublicationPlacement,
      instagramStoryEnabled,
      facebookPublicationPlacement,
      facebookStoryEnabled,
      pinterestBoardId,
      pinterestBoardName,
      tiktokPublicationSettings,
      showPublicationPreview,
      setVideoStorageContext,
      setVideoTransformedVariants,
      setVideoVariantPreparationByChannel,
      buildVideoPreparationStateFromVariants,
      linkPersistentWorkspaceDraft,
      setLoadedPublicationDraftId,
      router,
      setLastPublicationDraftSnapshot,
      currentPublicationDraftSnapshot,
      onUnsavedChange,
      pdfFile,
    }, options);

  useEffect(() => {
    if (!saveDraftActionRef) return;
    saveDraftActionRef.current = onSavePublicationDraft;
    return () => {
      if (saveDraftActionRef.current === onSavePublicationDraft) {
        saveDraftActionRef.current = null;
      }
    };
  }); // Expose the save handler from every committed render, including current edits.

  const openSchedulePublicationModal = () => {
    if (saving || draftSaving || scheduleSaving || voiceInputBusy) return;
    const imagePreparationIssue = getImagePreparationIssue(selectedChannels, "schedule");
    if (imagePreparationIssue) {
      setPublishError(imagePreparationIssue);
      return;
    }
    const preparedPostsByChannel = buildPreparedPostsByChannel();
    setPublishError("");
    setScheduleError("");
    setDraftMessage("");
    setImgError("");
    setPendingScheduleRequest(null);
    if (!tiktokReviewCurrent) setTiktokPublicationSettings(null);

    if (!selectedChannels.length) {
      setPublishError(i18nT("selectionnez_au_moins_1_canal_a_54437af6"));
      scrollToPublishArea("smooth");
      return;
    }

    setPostsByChannel(preparedPostsByChannel);
    setScheduleReviewPosts(preparedPostsByChannel);
    setScheduleModalOpen(true);
  };

  const confirmSchedulePublication = async (
    selections: PublishScheduleSelection[],
    immediateChannels: ChannelKey[] = [],
  ) => {
    const preparedPostsByChannel =
      scheduleReviewPosts || buildPreparedPostsByChannel();
    const tiktokWillSchedule = selections.some(
      (selection) => selection.channel === "tiktok",
    );
    const tiktokWillPublishNow = immediateChannels.includes("tiktok");
    if (
      (tiktokWillSchedule || tiktokWillPublishNow) &&
      !tiktokReviewCurrent
    ) {
      setPendingScheduleRequest({
        selections,
        immediateChannels,
        preparedPostsByChannel,
      });
      setTiktokSettingsFlow("schedule");
      setScheduleModalOpen(false);
      setTiktokSettingsOpen(true);
      throw new Error("");
    }

    const result = await performSchedulePublication(
      selections,
      preparedPostsByChannel,
      tiktokWillSchedule || tiktokWillPublishNow
        ? tiktokPublicationSettings
        : null,
      immediateChannels,
    );
    // The schedule modal reports success only after a recorded submission.
    if (result === undefined) throw new Error("");
  };

  const onPublish = async () => {
    if (saving || draftSaving || scheduleSaving || voiceInputBusy) return;
    const imagePreparationIssue = getImagePreparationIssue(selectedChannels);
    if (imagePreparationIssue) {
      setPublishError(imagePreparationIssue);
      return;
    }
    const preparedPostsByChannel = buildPreparedPostsByChannel();
    setPublishError("");
    setDraftMessage("");
    setImgError("");
    setPublishProgress(0);
    setPublishProgressLabel("");

    if (!selectedChannels.length) {
      setPublishError(i18nT("selectionnez_au_moins_1_canal_ccf98c0c"));
      scrollToPublishArea("smooth");
      return;
    }

    closeEmptyContentWarnings();
    setPostsByChannel(preparedPostsByChannel);
    setPendingPublishPosts(preparedPostsByChannel);
    setFinalReviewPosts(preparedPostsByChannel);

    const reviewItems = buildFinalReviewItems(preparedPostsByChannel);
    const tiktokReviewItem = reviewItems.find(
      (item) => item.channel === "tiktok",
    );
    if (!tiktokReviewCurrent) setTiktokPublicationSettings(null);
    if (tiktokReviewItem && tiktokReviewItem.blockers.length === 0 && !tiktokReviewCurrent) {
      setTiktokSettingsFlow("publish");
      setTiktokSettingsOpen(true);
      return;
    }

    setFinalReviewOpen(true);
  };

  const currentEmptyContentWarningChannel =
    emptyContentWarningChannels[emptyContentWarningIndex] || null;

  const onValidateEmptyContentWarning = async () => {
    if (!currentEmptyContentWarningChannel) return;
    const nextIndex = emptyContentWarningIndex + 1;
    if (nextIndex < emptyContentWarningChannels.length) {
      setEmptyContentWarningIndex(nextIndex);
      return;
    }

    const preparedPostsByChannel =
      pendingPublishPosts || buildPreparedPostsByChannel();
    closeEmptyContentWarnings();
    await runPublish({
      skipEmptyContentWarnings: true,
      preparedPostsByChannel,
    });
  };

  const getReviewPostForChannel = (
    channel: ChannelKey,
    preparedPostsByChannel: Partial<Record<ChannelKey, ChannelPost>>,
  ) => {
    return normalizePost(preparedPostsByChannel[channel]);
  };

  const buildFinalReviewItems = (
    preparedPostsByChannel: Partial<Record<ChannelKey, ChannelPost>>,
    channelsToReview: ChannelKey[] = selectedChannels,
    workspaceStatesOverride?: readonly PersistentWorkspaceMediaState[],
  ) => {
    return channelsToReview.map((channel) => {
      const mode = resolveChannelMediaMode(channel);
      const threadsModeIssue = channel === "threads" ? getThreadsPublicationModeIssue(threadsPublicationMode, threadsPublicationPreferences, threadsPreferencesLoading, threadsPreferencesFailed) : null;
      const post = getReviewPostForChannel(channel, preparedPostsByChannel);
      const imageKeysToPublish = mode === "images" ? getPublishImageKeysForChannel(channel) : [];
      const hasTitle = !!String(post?.title || "").trim();
      const hasContent = !!String(post?.content || "").trim();
      const instagramStoryAlsoPublished =
        channel === "instagram" && instagramStoryEnabled;
      const instagramStoryOnlyPublished =
        channel === "instagram" && instagramPublicationPlacement === "story";
      const instagramStoryPublished =
        instagramStoryAlsoPublished || instagramStoryOnlyPublished;
      const facebookVerticalFormat =
        channel === "facebook" &&
        ((facebookPublicationPlacement === "reel" || facebookStoryEnabled) ||
          facebookPublicationPlacement === "story");
      const facebookStoryAlsoPublished =
        channel === "facebook" && facebookStoryEnabled;
      const facebookStoryOnlyPublished =
        channel === "facebook" && facebookPublicationPlacement === "story";
      const facebookStoryPublished =
        facebookStoryAlsoPublished || facebookStoryOnlyPublished;
      const hasText = hasTitle || hasContent;
      const hasImage = imageKeysToPublish.length > 0;
      const hasVideo = mode === "video" && !!videoFile;
      const imageKeySet = new Set(imageKeysToPublish);
      const xGifCount =
        channel === "x" && mode === "images"
          ? images.filter((image) => {
              if (!imageKeySet.has(makeImageKey(image))) return false;
              return (
                String(image.type || "").toLowerCase() === "image/gif" ||
                String(image.name || "").toLowerCase().endsWith(".gif")
              );
            }).length
          : 0;
      const xPostText =
        channel === "x"
          ? getBoosterPublicationTextPreview("x", post, {
              websiteUrl: getWebsiteUrlForChannel(channel, ctaDefaults),
              phone: ctaDefaults?.phone || "",
            }).text
          : "";
      const xTextMetrics =
        channel === "x" ? getXPostTextMetrics(xPostText) : null;
      const xForbiddenUrlFields =
        channel === "x"
          ? getBoosterXForbiddenUrlFields(post, {
              hashtagsInput: xHashtagsInput,
            })
          : [];
      const effectiveVideoDuration = Number(
        videoDurationSeconds ?? videoSourceMetadata?.duration ?? 0,
      );
      const facebookMaximumDuration =
        facebookStoryPublished ? 60 : 90;
      const facebookVerticalDurationInvalid =
        facebookVerticalFormat &&
        hasVideo &&
        Number.isFinite(effectiveVideoDuration) &&
        effectiveVideoDuration > 0 &&
        (effectiveVideoDuration < 3 ||
          effectiveVideoDuration > facebookMaximumDuration);
      const threadsTextTooLong = channel === "threads" && getBoosterPublicationTextPreview("threads", post, { websiteUrl: getWebsiteUrlForChannel(channel, ctaDefaults), phone: ctaDefaults?.phone || "" }).count > 500;
      const requirements = getChannelPublicationRequirements({
        channel,
        connected: connected[channel],
        mediaMode: mode,
        hasVideo,
        videoDurationSeconds:
          videoDurationSeconds ?? videoSourceMetadata?.duration ?? null,
        videoFileType: videoFile?.type || null,
        videoFileName: videoFile?.name || null,
        tiktokMaxVideoDurationSeconds,
        tiktokDurationLimitVerified,
        youtubeLongUploadsStatus,
        hasImage,
        imageCount: imageKeysToPublish.length,
        hasText,
        hasTitle,
        hasContent,
        xTextWeightedLength: xTextMetrics?.weightedLength ?? null,
        xGifCount,
      });
      const videoPreparationState = videoVariantPreparationByChannel[channel];
      const requestedVideoFormat =
        videoSettingsByChannel[channel]?.format ||
        videoFormatByChannel[channel] ||
        "original";
      const videoNeedsExplicitAdaptation =
        mode === "video" && requestedVideoFormat !== "original";
      const hasVideoPreparationBlocker =
        !mediaPipelineCutoverEnabled &&
        videoNeedsExplicitAdaptation &&
        videoPreparationState?.status === "error";

      const workspaceSourceExpected =
        persistentMediaWorkspaceEnabled &&
        ((mode === "video" && Boolean(videoFile)) ||
          (mode === "images" && images.length > 0));
      const relevantWorkspaceStates = Object.values(
        workspaceStatesOverride || persistentMediaStates,
      ).filter((state) => state.mediaType === (mode === "video" ? "video" : "image"));
      const failedWorkspaceState = relevantWorkspaceStates.find(
        (state) => state.status === "failed",
      );
      const hasMediaUploadBlocker = workspaceSourceExpected && !!failedWorkspaceState;
      const blockerCodes = [
        ...(threadsModeIssue ? [threadsModeIssue] : []),
        ...(threadsTextTooLong ? ["threads_text_too_long"] : []),
        ...requirements.blockerCodes,
        ...(hasVideoPreparationBlocker ? ["video_conversion_failed"] : []),
        ...(hasMediaUploadBlocker ? ["media_upload_pending"] : []),
        ...(channel === "pinterest" && !pinterestBoardId
          ? ["pinterest_board_required"]
          : []),
        ...(xForbiddenUrlFields.length ? ["x_url_forbidden"] : []),
        ...(facebookVerticalFormat && !hasImage && !hasVideo
          ? ["facebook_vertical_media_required"]
          : []),
        ...(facebookVerticalDurationInvalid
          ? ["facebook_vertical_duration_invalid"]
          : []),
      ];
      const mediaBlockerCodes = [
        ...requirements.mediaBlockerCodes,
        ...(hasVideoPreparationBlocker ? ["video_conversion_failed"] : []),
        ...(hasMediaUploadBlocker ? ["media_upload_pending"] : []),
        ...(facebookVerticalFormat && !hasImage && !hasVideo ? ["facebook_vertical_media_required"] : []),
        ...(facebookVerticalDurationInvalid ? ["facebook_vertical_duration_invalid"] : []),
      ];
      const localizeRequirement = (code: string) =>
        code === "threads_ghost_preferences_loading" || code === "threads_ghost_preferences_error" || code === "threads_ghost_disabled" || code === "threads_text_too_long"
          ? i18nT(code)
          : code === "x_url_forbidden"
          ? getBoosterXUrlBlockerMessage(xForbiddenUrlFields)
          : code === "facebook_vertical_media_required"
          ? "Facebook Reel/Story nécessite une image ou une vidéo."
          : code === "facebook_vertical_duration_invalid"
            ? facebookStoryPublished
              ? "Une Story Facebook doit durer entre 3 et 60 secondes."
              : "Un Reel Facebook doit durer entre 3 et 90 secondes."
          : getLocalizedChannelPublicationRequirement(
              { code, channel, imageCount: imageKeysToPublish.length },
              runtimeT,
            );
      const blockers = blockerCodes.map(localizeRequirement);
      const actionableWarningCodes = getActionablePublicationWarningCodes(requirements.warningCodes);

      return {
        channel,
        label: getLocalizedChannelLabel(channel, runtimeT),
        mediaType: mode === "video" ? ("video" as const) : ("images" as const),
        mediaLabel:
          mode === "video"
            ? i18nT("media_label_one_video")
            : mode === "images"
              ? i18nT("media_label_images", {
                  count: imageKeysToPublish.length,
                })
              : i18nT("media_label_text_only"),
        imageCount: imageKeysToPublish.length,
        warnings: [
          ...requirements.warningCodes.map(localizeRequirement),
          ...(channel === "threads" && threadsPublicationMode === "ghost" ? [i18nT("threads_ghost_help")] : []),
          ...(instagramStoryPublished
            ? [
                i18nT("instagram_review_media_only_warning", {
                  mode: i18nT("instagram_stories"),
                }),
              ]
            : []),
          ...(facebookStoryPublished
            ? [
                i18nT("instagram_review_media_only_warning", {
                  mode: i18nT("instagram_stories"),
                }),
              ]
            : []),
        ],
        details:
          channel === "pinterest" && pinterestBoardId
            ? [
                i18nT("pinterest_review_board", {
                  board:
                    pinterestBoardName ||
                    pinterestBoards.find(
                      (board) => board.id === pinterestBoardId,
                    )?.name ||
                    pinterestBoardId,
                }),
              ]
            : channel === "x" && xTextMetrics
              ? [
                  `Post X : ${xTextMetrics.weightedLength}/${X_POST_WEIGHTED_LENGTH_MAX} caractères pondérés.`,
                  ...(xGifCount > 0 ? ["GIF X : publié seul, conformément aux règles du canal."] : []),
                  ...(post.ctaMode && post.ctaMode !== "none"
                    ? ["X n’affiche pas de bouton natif : le CTA et son éventuel lien sont intégrés au texte du post."]
                    : []),
                ]
              : [],
        blockers,
        blockerCodes,
        contentBlockers: blockerCodes.filter((code) => !mediaBlockerCodes.includes(code)).map(localizeRequirement),
        contentWarnings: actionableWarningCodes.filter((code) => /content|title|text|url|board/.test(code)).map(localizeRequirement),
        mediaWarnings: [
          ...actionableWarningCodes.filter((code) => !/content|title|text|url|board/.test(code)).map(localizeRequirement),
          ...(instagramStoryPublished ? [i18nT("instagram_review_media_only_warning", { mode: i18nT("instagram_stories") })] : []),
          ...(facebookStoryPublished ? [i18nT("instagram_review_media_only_warning", { mode: i18nT("instagram_stories") })] : []),
        ],
        mediaBlockers: mediaBlockerCodes.map(localizeRequirement),
        mediaBlockerCodes,
        publishable: blockers.length === 0,
        tiktokParametersValidated:
          channel === "tiktok" && tiktokReviewCurrent,
        hasContent,
        hasTitle,
        hasText,
        hasImage,
      };
    });
  };

  const finalReviewItems = finalReviewOpen
    ? buildFinalReviewItems(finalReviewPosts || buildPreparedPostsByChannel())
    : [];
  const scheduleModalItems = scheduleModalOpen
    ? buildFinalReviewItems(
        scheduleReviewPosts || buildPreparedPostsByChannel(),
      )
    : [];
  const finalReviewBlockers = finalReviewItems.flatMap((item) => item.blockers);
  const hasFinalReviewBlockers = finalReviewBlockers.length > 0;
  const finalReviewPublishableCount = finalReviewItems.filter(
    (item) => item.blockers.length === 0,
  ).length;
  const publishReadinessItems = buildFinalReviewItems(
    buildPreparedPostsByChannel(),
  );
  const channelReadiness = publishReadinessItems.reduce(
    (acc, item) => {
      const selectorBlockers = item.blockers.filter(
        (_blocker, index) =>
          item.blockerCodes[index] !== "text_or_media_required",
      );
      acc[item.channel] = {
        tone: selectorBlockers.length
          ? ("blocked" as const)
          : ("ready" as const),
        message: selectorBlockers[0] || "Prêt à publier",
        blockers: selectorBlockers,
        warnings: item.warnings,
      };
      return acc;
    },
    {} as Partial<
      Record<
        ChannelKey,
        {
          tone: "ready" | "warning" | "blocked";
          message: string;
          blockers: string[];
          warnings: string[];
        }
      >
    >,
  );


  const closeFinalReview = () => {
    setFinalReviewOpen(false);
    if (!tiktokReviewCurrent) setTiktokPublicationSettings(null);
  };

  const closeTiktokSettingsModal = () => {
    setTiktokSettingsOpen(false);
    if (tiktokSettingsFlow !== "review") setTiktokPublicationSettings(null);
    setTiktokSettingsFlow(null);
    setPendingScheduleRequest(null);
  };

  const validateTiktokSettingsModal = async (
    settings: TiktokPublicationSettings,
  ) => {
    setTiktokPublicationSettings(settings);
    setTiktokReviewSignature(tiktokCurrentSignature);
    setTiktokSettingsOpen(false);
    if (tiktokSettingsFlow === "review") {
      setTiktokSettingsFlow(null);
      return;
    }

    if (tiktokSettingsFlow === "schedule" && pendingScheduleRequest) {
      const request = pendingScheduleRequest;
      setTiktokSettingsFlow(null);
      setScheduleModalOpen(true);
      let immediatePublishRequest: PendingImmediatePublishAfterSchedule | null | undefined;
      try {
        immediatePublishRequest = await performSchedulePublication(
          request.selections,
          request.preparedPostsByChannel,
          settings,
          request.immediateChannels,
        );
      } catch {
        // Submission already exposes its error and releases its busy lock.
        // Keep the form and its original dates available for a manual retry.
        return;
      }
      if (immediatePublishRequest === undefined) return;
      setScheduleModalOpen(false);
      if (immediatePublishRequest?.immediateChannels?.length) {
        setPendingImmediatePublishAfterSchedule(null);
        publishImmediateChannelsAfterSchedule(immediatePublishRequest);
        return;
      }
      onClose();
      return;
    }

    setTiktokSettingsFlow(null);
    setFinalReviewOpen(true);
  };

  const excludeTiktokAndContinue = () => {
    const flow = tiktokSettingsFlow;
    deselectChannel("tiktok");
    if (flow === "review") { setTiktokSettingsOpen(false); setTiktokSettingsFlow(null); return; }
    setPendingScheduleRequest(null);
    if (flow === "schedule") {
      setScheduleModalOpen(true);
      return;
    }
    setFinalReviewOpen(true);
  };

  const aiDrawerHeight = drawerViewportHeight
    ? `${drawerViewportHeight}px`
    : isMobile
      ? "100svh"
      : "100dvh";

  useEffect(() => {
    const openAiConfiguration = () => setAiConfigurationOpen(true);
    window.addEventListener("inrcy:open-ai-configuration", openAiConfiguration);
    return () =>
      window.removeEventListener(
        "inrcy:open-ai-configuration",
        openAiConfiguration,
      );
  }, []);

  const confirmFinalReview = async () => {
    const preparedPostsByChannel =
      finalReviewPosts || buildPreparedPostsByChannel();
    const items = buildFinalReviewItems(preparedPostsByChannel);
    const publishableItems = items.filter((item) => item.blockers.length === 0);
    if (!publishableItems.length) return;
    const tiktokWillPublish = publishableItems.some(
      (item) => item.channel === "tiktok",
    );
    if (tiktokWillPublish && !tiktokReviewCurrent) {
      setFinalReviewOpen(false);
      setTiktokSettingsFlow("publish");
      setTiktokSettingsOpen(true);
      return;
    }
    const validatedTiktokSettings = tiktokPublicationSettings;
    setFinalReviewOpen(false);
    setFinalReviewPosts(null);
    setTiktokPublicationSettings(null);
    await runPublish({
      skipEmptyContentWarnings: true,
      preparedPostsByChannel,
      tiktokPublicationSettings: validatedTiktokSettings,
    });
  };

  const tiktokSettingsMediaMode = resolveChannelMediaMode("tiktok");
  const tiktokSettingsPreview =
    tiktokSettingsMediaMode === "video"
      ? getPublicationVideoPreviewForChannel("tiktok")
      : tiktokSettingsMediaMode === "images"
        ? getPublicationPreviewForChannel("tiktok")
        : null;
  const tiktokSettingsPreviewPost =
    (
      finalReviewPosts ||
      scheduleReviewPosts ||
      pendingPublishPosts ||
      buildPreparedPostsByChannel()
    ).tiktok || null;
  const tiktokSettingsPreviewTitle = String(
    tiktokSettingsPreviewPost?.title || tiktokSettingsPreview?.title || "",
  ).trim();
  const tiktokSettingsPreviewContent = String(
    tiktokSettingsPreviewPost?.content || tiktokSettingsPreview?.content || "",
  ).trim();
  const tiktokSettingsPreviewHashtags =
    tiktokSettingsPreviewPost?.hashtags ||
    tiktokSettingsPreview?.hashtags ||
    [];
  const tiktokSettingsPreviewAny = tiktokSettingsPreview as any;
  const tiktokSettingsPreviewMediaUrl =
    tiktokSettingsMediaMode === "video"
      ? tiktokSettingsPreviewAny?.video?.previewUrl || null
      : tiktokSettingsPreviewAny?.image?.previewUrl || null;
  const tiktokSettingsPreviewMediaName =
    tiktokSettingsMediaMode === "video"
      ? tiktokSettingsPreviewAny?.video?.name || videoFile?.name || ""
      : "";
  const tiktokSettingsPreviewMediaCount =
    tiktokSettingsMediaMode === "video"
      ? 1
      : tiktokSettingsPreviewAny?.imageCount || images.length || 0;
  const preparePublicationDraftForStudio = async (): Promise<{
    draftId: string | null;
    returnHref: string | null;
    videoDraft: VideoPayload | null;
  } | null> => {
    const existingDraftId = String(
      loadedPublicationDraftId || publicationDraftIdParam || "",
    ).trim();
    if (!hasDraftablePublicationContent) {
      return {
        draftId: existingDraftId || null,
        returnHref: null,
        videoDraft: null,
      };
    }
    if (!hasUnsavedChanges && existingDraftId) {
      return {
        draftId: existingDraftId,
        returnHref: `/dashboard?action=publish&draftId=${encodeURIComponent(existingDraftId)}`,
        videoDraft: null,
      };
    }
    lastSavedStudioVideoDraftRef.current = null;
    const savedDraftId = await onSavePublicationDraft({ updateRoute: false });
    if (!savedDraftId) return null;
    return {
      draftId: savedDraftId,
      returnHref: `/dashboard?action=publish&draftId=${encodeURIComponent(savedDraftId)}`,
      videoDraft: lastSavedStudioVideoDraftRef.current,
    };
  };

  const openInrStudioGenerator = async (kind?: "image" | "video") => {
    if (studioOpeningRef.current) return;
    studioOpeningRef.current = true;
    let opened = false;
    let handoffKey: string | null = null;
    try {
      const draftState = await preparePublicationDraftForStudio();
      if (!draftState) return;
      const { href, handoff } = await createInrStudioHandoff({
        transport: "embedded",
        tab: "generate",
        origin: "booster-publish",
        returnHref: draftState.returnHref,
        publicationBrief: idea.trim(),
        context: {
          draftId: draftState.draftId,
          ...(kind ? { mediaType: kind } : {}),
        },
      });
      handoffKey = handoff.key;
      openStudio(href);
      opened = true;
    } catch {
      setImgError(i18nT("studio_open_unavailable"));
    } finally {
      if (!opened) {
        studioOpeningRef.current = false;
        if (handoffKey) await clearInrStudioHandoff(handoffKey);
      }
    }
  };

  const openInrStudioImageTool = async (
    tab: "modify" | "retouch",
    channel: ChannelKey,
    imageKey: string,
  ) => {
    if (studioOpeningRef.current) return;
    const sourceFile = images.find((file) => makeImageKey(file) === imageKey);
    const sourceUrl = previewByKey[imageKey] || null;
    const recoveredImage = imagePreparationItems.find(
      (item) =>
        item.imageKey === imageKey &&
        item.recovered &&
        Boolean(item.canonicalUrl),
    );
    if (!sourceFile && !sourceUrl && !recoveredImage?.canonicalUrl) {
      setImgError("Cette image n’est plus disponible pour cette action.");
      return;
    }
    studioOpeningRef.current = true;
    let opened = false;
    let handoffKey: string | null = null;
    try {
      let studioFile = sourceFile || null;
      if (recoveredImage) {
        const response = await fetch(recoveredImage.canonicalUrl, {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok || response.status === 206 ||
            response.headers.has("Content-Range")) {
          throw new Error("La version réparée de cette image n’est plus disponible. Réessayez après avoir actualisé la page.");
        }
        const repairedBlob = await response.blob();
        if (!repairedBlob.size) {
          throw new Error("La version réparée de cette image est incomplète. Réessayez après avoir actualisé la page.");
        }
        studioFile = new File(
          [repairedBlob],
          sourceFile?.name?.replace(/\.jpe?g$/i, "-reparee.jpg") || "image-reparee.jpg",
          { type: repairedBlob.type || "image/jpeg", lastModified: Date.now() },
        );
      }
      const draftState = await preparePublicationDraftForStudio();
      if (!draftState) return;
      const { href, handoff } = await createInrStudioHandoff({
        transport: "embedded",
        tab,
        origin: "booster-publish",
        returnHref: draftState.returnHref,
        source: {
          file: studioFile,
          url: recoveredImage?.canonicalUrl || sourceUrl,
          name: studioFile?.name || "image-booster",
          mimeType: studioFile?.type || "image/jpeg",
        },
        context: {
          channel,
          imageKey,
          draftId: draftState.draftId,
        },
      });
      handoffKey = handoff.key;
      openStudio(href);
      opened = true;
    } catch {
      setImgError(i18nT("studio_open_unavailable"));
    } finally {
      if (!opened) {
        studioOpeningRef.current = false;
        if (handoffKey) await clearInrStudioHandoff(handoffKey);
      }
    }
  };




  const openInrStudioVideoRetoucher = async (channel: ChannelKey) => {
    if (studioOpeningRef.current) return;
    const currentDurableSourceUrl = String(
      videoStorageContext?.publicUrl || videoStorageContext?.url || "",
    ).trim();
    if (!videoFile && !currentDurableSourceUrl && !videoPreviewUrl) {
      setImgError("Cette vidéo n’est plus disponible pour cette action.");
      return;
    }

    const format = normalizeVideoFormat(
      channel,
      videoSettingsByChannel[channel]?.format ||
        videoFormatByChannel[channel] ||
        "original",
    );
    const adaptationMode = normalizeVideoAdaptationMode(
      videoSettingsByChannel[channel]?.adaptationMode ||
        videoAdaptationModeByChannel[channel],
    );
    const sourceName = videoFile?.name || "video-booster.mp4";
    const sourceMimeType =
      videoFile?.type || videoSourceMetadata?.type || "video/mp4";
    const sourceSize = Number(
      videoFile?.size || videoSourceMetadata?.size || 0,
    );

    studioOpeningRef.current = true;
    let opened = false;
    let handoffKey: string | null = null;
    try {
      const draftState = await preparePublicationDraftForStudio();
      if (!draftState) return;
      const savedVideoDraft = draftState.videoDraft;
      const durableSourceUrl = String(
        savedVideoDraft?.publicUrl ||
          savedVideoDraft?.url ||
          currentDurableSourceUrl ||
          "",
      ).trim();
      const durableStoragePath = String(
        savedVideoDraft?.storagePath ||
          videoStorageContext?.storagePath ||
          "",
      ).trim();
      const sourceUrl =
        durableSourceUrl || (!videoFile ? String(videoPreviewUrl || "") : "");
      const videoMediaRecord: VideoPayload = savedVideoDraft || {
        name: sourceName,
        type: sourceMimeType,
        size: sourceSize,
        lastModified: videoFile?.lastModified || Date.now(),
        duration: videoDurationSeconds,
        sourceMetadata: videoSourceMetadata,
        storagePath: durableStoragePath,
        publicUrl: durableSourceUrl,
        url: durableSourceUrl,
        transformedVariants: videoTransformedVariants,
      };
      const { href, handoff } = await createInrStudioHandoff({
        transport: "embedded",
        tab: "retouch",
        origin: "booster-publish",
        returnHref: draftState.returnHref,
        source: {
          mediaType: "video",
          file: videoFile,
          // Quand la source n’existe que sous forme de File, le handoff crée
          // sa propre URL blob. Elle ne sera pas révoquée au démontage de
          // Booster pendant la navigation vers iNrStudio.
          url: sourceUrl || null,
          name: sourceName,
          mimeType: sourceMimeType,
        },
        context: {
          channel,
          mediaType: "video",
          draftId: draftState.draftId,
          videoSourceName: sourceName,
          videoSourceSize: sourceSize,
          videoSourceStoragePath: durableStoragePath || null,
        },
        payload: {
          videoChannel: channel,
          videoFormat: format,
          videoAdaptationMode: adaptationMode,
          videoStoragePath: durableStoragePath || null,
          videoPublicUrl: durableSourceUrl || null,
          videoDurationSeconds,
          videoSize: sourceSize,
          videoSourceMetadata,
          videoTransformedVariants,
          videoMediaRecord,
          deferVideoPreparation: mediaPipelineCutoverEnabled,
        },
      });
      handoffKey = handoff.key;
      openStudio(href);
      opened = true;
    } catch {
      setImgError(i18nT("studio_open_unavailable"));
    } finally {
      if (!opened) {
        studioOpeningRef.current = false;
        if (handoffKey) await clearInrStudioHandoff(handoffKey);
      }
    }
  };

  const wizardSteps = getPublishWizardSteps(creationMode);
  const wizardBusy = generating || saving || draftSaving || scheduleSaving || voiceInputBusy;
  const activeWizardStep: PublishWizardStep = saving || scheduleSaving
    ? "publication"
    : publicationResult ? "results" : wizardStep;
  useInrAssistantScreen({ action: "publish", step: activeWizardStep, pendingChanges: hasUnsavedChanges, ...(loadedPublicationDraftId ? { selection: { kind: "publication", id: loadedPublicationDraftId } } : {}) });
  const canOpenWizardStep = (step: PublishWizardStep) => !publicationResult && canOpenPublishWizardStep(step, {
    mode: creationMode,
    channelCount: connectedChannelsLoadState === "ready" ? selectedChannels.length : 0,
    contentReady: showContentWorkspace,
    busy: wizardBusy,
  });
  const openWizardStep = (step: PublishWizardStep) => {
    if (!canOpenWizardStep(step)) return;
    if (finalReviewOpen) closeFinalReview();
    if (step === "control") setShowPublicationPreview(true);
    setWizardStep(step);
  };
  const wizardIndex = wizardSteps.indexOf(activeWizardStep === "mode" ? "channels" : activeWizardStep === "validation" ? "control" : activeWizardStep);
  const previousWizardStep = !wizardBusy && !tiktokSettingsOpen && !scheduleModalOpen && wizardIndex > 0 && wizardIndex < wizardSteps.indexOf("publication")
    ? wizardSteps[wizardIndex - 1] : undefined;
  const nextWizardStep = activeWizardStep === "mode" || activeWizardStep === "channels" ? (creationMode === "manual" ? "content" : "intention")
    : activeWizardStep === "content" ? "media"
    : activeWizardStep === "media" ? "control" : undefined;

  const previousMediaPoolSignature = useRef("");
  const mediaPoolSignature = JSON.stringify([[...imageKeys].sort(), videoPreviewUrl]);
  useEffect(() => {
    if (previousMediaPoolSignature.current === mediaPoolSignature) return;
    previousMediaPoolSignature.current = mediaPoolSignature;
    if (activeWizardStep !== "media" || (publicationDraftIdParam && loadedPublicationDraftId !== publicationDraftIdParam)) return;
    const defaults = getPublicationMediaPoolDefaults(selectedChannels, imageKeys, Boolean(videoPreviewUrl), getBoosterMaxImageCountForChannel);
    setChannelMediaModes((current) => ({ ...current, ...defaults.modes }));
    setChannelImageEditors((current) => {
      let next = current;
      for (const channel of selectedChannels) {
        const keys = defaults.selections[channel];
        if (!keys) continue;
        next = setImageKeysForChannel(next, channel, keys, {
          fallback: { imageKeys: [], transforms: {} },
          patch: { synchronizedImageKeys: [...imageKeys] },
        });
      }
      return next;
    });
  }, [activeWizardStep, mediaPoolSignature, imageKeys, videoPreviewUrl, selectedChannels, publicationDraftIdParam, loadedPublicationDraftId]);

  const publicationVisualDestinations = publicationDestinations.length
    ? publicationDestinations
    : selectedChannels.map((key) => ({ key, label: CHANNEL_LABELS[key] }));
  const publicationActions = (
          <PublishFooterActions
            styles={styles}
            publishAreaRef={publishAreaRef}
            saving={saving}
            scheduling={scheduleSaving}
            draftSaving={draftSaving}
            voiceBusy={voiceInputBusy}
            publishProgress={publishProgress}
            publishProgressLabel={publishProgressLabel}
            publishProgressPhaseIndex={publishProgressPhaseIndex}
            publishProgressPhaseTotal={PUBLICATION_PROGRESS_STAGES.length}
            publishProgressPhaseLabel={publishProgressPhaseLabel}
            publicationDestinations={publicationVisualDestinations}
            publishError={publishError}
            mediaPreparationIssue={publishImagePreparationIssue}
            scheduleMediaPreparationIssue={scheduleImagePreparationIssue}
            mediaPreparationFailed={
              Boolean(imagePreparationError) ||
              imagePreparationItems.some((item) => item.status === "failed")
            }
            onPublish={onPublish}
            onSchedule={openSchedulePublicationModal}
            reviewControl={selectedChannels.includes("tiktok") ? <TiktokReviewCheckbox checked={tiktokReviewCurrent} disabled={wizardBusy} onReview={() => { setTiktokSettingsFlow("review"); setTiktokSettingsOpen(true); }} /> : null}
          />
  );

  return (
    <div ref={publishRootRef} style={{ display: "flex", flexDirection: "column", flex: 1, height: "100%", minHeight: 0, minWidth: 0 }}>
      {contentAdjustmentSession ? <PublishContentAdjustmentModal
        idea={contentAdjustmentSession.idea} instruction={contentAdjustmentSession.instruction}
        channels={contentAdjustmentSession.channels.map(key => ({ key, label: getLocalizedChannelLabel(key, runtimeT) }))}
        busy={generating} progress={generationProgress} progressLabel={generationPhaseLabel} error={genError}
        onClose={() => { if (!generationInFlightRef.current) { setContentAdjustmentSession(null); setGenError(""); } }}
        onApply={input => void onGenerate({ ...input, previousIdea: contentAdjustmentSession.idea, previousInstruction: contentAdjustmentSession.instruction })}
      /> : null}
      {studio}
      <TiktokPublicationSettingsModal
        showPreview={false}
        validateLabel={tiktokSettingsFlow === "review" ? i18nT("valider_be4220f7") : undefined}
        open={tiktokSettingsOpen}
        styles={styles}
        isMobile={isMobile}
        mediaType={tiktokSettingsMediaMode === "video" ? "video" : "images"}
        videoDurationSeconds={
          videoDurationSeconds ?? videoSourceMetadata?.duration ?? null
        }
        previewTitle={tiktokSettingsPreviewTitle}
        previewContent={tiktokSettingsPreviewContent}
        previewHashtags={tiktokSettingsPreviewHashtags}
        previewMediaUrl={tiktokSettingsPreviewMediaUrl}
        previewMediaName={tiktokSettingsPreviewMediaName}
        previewMediaCount={tiktokSettingsPreviewMediaCount}
        onRetouchVideo={() =>
          void openInrStudioVideoRetoucher("tiktok")
        }
        onCancel={closeTiktokSettingsModal}
        onValidate={validateTiktokSettingsModal}
        onExcludeAndContinue={excludeTiktokAndContinue}
      />

      <PublishHelpModal
        open={publishHelpOpen}
        onClose={() => setPublishHelpOpen(false)}
      />

      <PublishAiConfigurationDrawer
        open={aiConfigurationOpen}
        isMobile={isMobile}
        drawerHeight={aiDrawerHeight}
        presentation="workspace"
        onClose={() => setAiConfigurationOpen(false)}
      />

      <PublishWarningModals
        styles={styles}
        emptyContentChannel={currentEmptyContentWarningChannel}
        onCloseEmptyContentWarnings={closeEmptyContentWarnings}
        onValidateEmptyContentWarning={onValidateEmptyContentWarning}
        oversizedMedia={
          mediaOptimizerPromptOpen && mediaOptimizerRequest
            ? {
                name:
                  mediaOptimizerRequest.source.kind === "file"
                    ? mediaOptimizerRequest.source.file.name
                    : mediaOptimizerRequest.source.item.title ||
                      mediaOptimizerRequest.source.item.storage_path
                        .split("/")
                        .pop() ||
                      "Média iNrCy",
                mediaType: mediaOptimizerRequest.mediaType,
                sizeBytes:
                  mediaOptimizerRequest.source.kind === "file"
                    ? mediaOptimizerRequest.source.file.size
                    : Number(mediaOptimizerRequest.source.item.size_bytes || 0),
                maxBytes:
                  mediaOptimizerRequest.mediaType === "video"
                    ? BOOSTER_MAX_VIDEO_BYTES
                    : BOOSTER_MAX_IMAGE_BYTES,
                sourceMaxBytes:
                  mediaOptimizerRequest.mediaType === "video"
                    ? MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES
                    : MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
                operation:
                  getBoosterMediaOptimizerRequirements(mediaOptimizerRequest)
                    .operation,
              }
            : null
        }
        onCloseOversizedMedia={closeOversizedMediaPrompt}
        onOptimizeOversizedMedia={openOversizedMediaOptimizer}
      />

      <InrcyCameraCaptureModal
        open={cameraCaptureOpen}
        title={i18nT("appareil_inrcy_7b70f4b8")}
        onClose={closeCameraCapture}
        onCapture={onCameraCapture}
        allowVideo={
          cameraCaptureScope === "generation"
            ? generationMediaSelectionPolicy.allowCameraVideo
            : cameraCaptureTargetChannel === null &&
              !(videoFile || videoPreviewUrl)
        }
        maxVideoBytes={BOOSTER_MAX_VIDEO_BYTES}
      />

      <MediaLibraryPickerModal
        open={mediaLibraryPickerOpen}
        title={i18nT("ajouter_depuis_la_mediatheque_d0f700b2")}
        subtitle={i18nT(
          mediaLibraryPickerScope === "generation"
            ? "media_library_generation_subtitle"
            : "media_library_publication_subtitle",
        )}
        accept={
          mediaLibraryPickerScope === "generation"
            ? generationMediaSelectionPolicy.libraryAccept
            : mediaLibraryPickerKind
        }
        multiple={
          mediaLibraryPickerScope === "generation"
            ? generationMediaSelectionPolicy.libraryMultiple
            : mediaLibraryPickerKind !== "video"
        }
        maxSelection={
          mediaLibraryPickerScope === "generation"
            ? generationMediaSelectionPolicy.libraryMaxSelection
            : mediaLibraryPickerKind === "video" ? 1 : mediaLibraryPickerKind === "image" ? Math.max(0, BOOSTER_MAX_IMAGE_COUNT - images.length) : BOOSTER_MAX_IMAGE_COUNT + 1
        }
        maxImageBytes={BOOSTER_MAX_IMAGE_BYTES}
        maxVideoBytes={BOOSTER_MAX_VIDEO_BYTES}
        onOpenOptimizer={openMediaOptimizer}
        onOversizedMedia={registerOversizedLibraryMedia}
        confirmLabel={i18nT(
          mediaLibraryPickerScope === "generation"
            ? "media_library_add_to_generation"
            : "media_library_add_to_publication",
        )}
        onClose={() => setMediaLibraryPickerOpen(false)}
        onConfirm={async (items) => {
          await addMediaLibrarySelection(
            items,
            getMediaLibraryPickerDestination(),
          );
        }}
      />

      <MediaOptimizerModal
        open={mediaOptimizerOpen}
        sourceItem={
          mediaOptimizerRequest?.source.kind === "library"
            ? mediaOptimizerRequest.source.item
            : null
        }
        sourceFile={
          mediaOptimizerRequest?.source.kind === "file"
            ? mediaOptimizerRequest.source.file
            : null
        }
        origin="booster"
        onClose={closeMediaOptimizer}
        onOptimized={applyOptimizedMediaToBooster}
      />

      {creationMode !== "ai" ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept={BOOSTER_IMAGE_ACCEPT}
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              onImagesChange(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept={BOOSTER_VIDEO_ACCEPT}
            style={{ display: "none" }}
            onChange={(event) => {
              onVideoChange(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </>
      ) : null}

      <PublishWizardFrame
        step={activeWizardStep}
        steps={wizardSteps}
        canOpenStep={canOpenWizardStep}
        onOpenStep={openWizardStep}
        onPrevious={previousWizardStep ? () => openWizardStep(previousWizardStep) : undefined}
        onNext={nextWizardStep ? () => openWizardStep(nextWizardStep) : undefined}
        nextDisabled={nextWizardStep ? !canOpenWizardStep(nextWizardStep) : false}
        footer={activeWizardStep === "intention" ? (
          <div ref={setIntentActionsContainer} className={wizardStyles.intentActions} />
        ) : activeWizardStep === "content" ? <div ref={setContentActionsContainer} /> : activeWizardStep === "control" ? publicationActions : activeWizardStep === "results" && publicationResult ? <PublishExecutionResultActions {...publicationResult} summary={publicationSummaryForActions} publicationDestinations={publicationVisualDestinations} compact /> : undefined}
      >
        <PublishWizardScreen active={activeWizardStep === "mode" || activeWizardStep === "channels"} step="channels">
          <div className={wizardStyles.preparation}>
            {connectedChannelsLoadState === "error" ? <div role="status" aria-live="polite">{i18nT("connections_unavailable")}</div> : null}
            <div ref={setChannelActionsContainer} className={wizardStyles.selectionActions} />
      <PublishChannelSelector
        actionsContainer={channelActionsContainer}
        connectionsPending={!hasKnownChannelConnections}
        companyName={companyName}
        styles={styles}
        isMobile={isMobile}
        connected={connected}
        channels={channels}
        channelReadiness={channelReadiness}
        channelInfoOpen={channelInfoOpen}
        setChannelInfoOpen={setChannelInfoOpen}
        toggle={toggle}
        setAllChannelsSelected={setAllChannelsSelected}
        getChannelDetailInfo={getChannelDetailInfo}
      />
      <PublishCreationModePanel
        styles={styles}
        isMobile={isMobile}
        mode={creationMode}
        disabled={
          generating ||
          saving ||
          draftSaving ||
          scheduleSaving ||
          voiceInputBusy
        }
        error={creationModeError}
        showReset={Boolean(creationMode) && (hasDraftablePublicationContent || Boolean(pdfFile))}
        onSelectMode={async (mode) => {
          const scroller = document.activeElement?.closest("[data-publish-wizard]")?.querySelector<HTMLElement>("[data-publish-scroll]");
          const scrollTop = scroller?.scrollTop;
          if (await onSelectCreationMode(mode)) {
            setWizardStep("channels");
            // Both mode choices belong to the same visible preparation step.
            // Keep its position when the step count or reset action changes.
            if (scroller && scrollTop !== undefined) {
              window.requestAnimationFrame(() => scroller.scrollTo({ top: scrollTop }));
            }
          }
        }}
        onReset={() => {
          void onReset();
        }}
      />
          </div>
        </PublishWizardScreen>
        <PublishWizardScreen active={activeWizardStep === "intention"} step="intention">
      {creationMode === "ai" && workflowSteps?.intention && creationWorkflow?.showsIntent ? (
        <div style={{ minWidth: 0 }}>
          <PublishIntentPanel
            actionsContainer={intentActionsContainer}
            styles={styles}
            isMobile={isMobile}
            stepNumber={workflowSteps.intention ?? 3}
            theme={theme}
            idea={idea}
            setIdea={setIdea}
            publicationInstruction={publicationInstruction}
            setPublicationInstruction={setPublicationInstruction}
            fileInputRef={fileInputRef}
            videoInputRef={videoInputRef}
            pdfInputRef={pdfInputRef}
            onImagesChange={onImagesChange}
            onVideoChange={onVideoChange}
            onPdfChange={onPdfChange}
            onPickImagesClick={() => {
              pendingDirectMediaDestinationRef.current = { kind: "generation" };
              onPickImagesClick();
            }}
            onPickVideoClick={() => onPickVideoClick({ kind: "generation" })}
            onGenerateMedia={() => void openInrStudioGenerator()}
            onTakePhotoClick={() => onTakePhotoClick(undefined, "generation")}
            onOpenMediaLibrary={() => {
              setMediaLibraryPickerScope("generation");
              setMediaLibraryPickerKind("all");
              setMediaLibraryPickerOpen(true);
            }}
            images={images}
            imagePreviews={imagePreviews}
            videoFile={videoFile}
            videoPreviewUrl={videoPreviewUrl}
            videoDurationSeconds={videoDurationSeconds}
            pdfFile={pdfFile}
            documentFiles={documentFiles}
            pdfAttachmentError={pdfAttachmentError}
            onRemovePdf={removePdfAttachment}
            onRetouchVideo={() =>
              void openInrStudioVideoRetoucher(activeImageChannel)
            }
            removeVideo={removeVideo}
            removeImage={removeImage}
            imgError={generationMediaWarning ? "" : imgError}
            showMediaOptimizerAction={false}
            onOpenMediaOptimizer={openMediaOptimizer}
            genError={genError}
            generationNotice={generationNotice}
            generationMediaWarning={generationMediaWarning}
            generating={generating}
            generationPhaseIndex={generationPhaseIndex}
            generationPhaseTotal={GENERATION_PROGRESS_PHASES.length}
            generationPhaseLabel={generationPhaseLabel}
            generationStage={generationStage}
            generationProgress={generationProgress}
            generationProgressRef={generationProgressRef}
            aiPreferredEngine={selectedAiPreferredEngine}
            defaultAiPreferredEngine={defaultAiPreferredEngine}
            onAiPreferredEngineChange={(engine) => {
              aiEngineRestoredFromDraftRef.current = true;
              setSelectedAiPreferredEngine(normalizeAiPreferredEngine(engine));
            }}
            onGenerate={() => void onGenerate()}
            onOpenAiConfiguration={() => setAiConfigurationOpen(true)}
            onVoiceBusyChange={setIntentVoiceBusy}
          />
        </div>
      ) : null}
        </PublishWizardScreen>
        <PublishWizardScreen active={activeWizardStep === "validation"} step="validation">
      <PublishScheduleModal
        showReviewSummary={false}
        confirmLabel={i18nT("programmer_ad97007f")}
        open={scheduleModalOpen}
        styles={styles}
        items={scheduleModalItems}
        initialSelections={pendingScheduleRequest?.selections}
        isMobile={isMobile}
        saving={scheduleSaving}
        error={scheduleError}
        progress={publishProgress}
        progressLabel={publishProgressLabel}
        onClose={() => {
          if (scheduleSaving) return;
          setScheduleModalOpen(false);
        }}
        successMessage={i18nT("programmation_reussie_1307249b")}
        savingLabel={i18nT("envoi_en_cours_2de80069")}
        enableImmediateUnselectedWarning
        onConfirm={confirmSchedulePublication}
        onSuccess={() => {
          const immediatePublishRequest = pendingImmediatePublishAfterSchedule;
          setScheduleModalOpen(false);
          setPendingImmediatePublishAfterSchedule(null);
          if (immediatePublishRequest?.immediateChannels.length) {
            publishImmediateChannelsAfterSchedule(immediatePublishRequest);
            return;
          }
          onClose();
        }}
      />

      <PublishFinalReviewModal
        open={finalReviewOpen}
        styles={styles}
        items={finalReviewItems}
        hasBlockers={hasFinalReviewBlockers}
        publishableCount={finalReviewPublishableCount}
        saving={saving}
        onClose={closeFinalReview}
        onConfirm={confirmFinalReview}
      />
        </PublishWizardScreen>
        <PublishWizardScreen active={activeWizardStep === "publication"} step="publication">
          <div className={wizardStyles.execution}>{activeWizardStep === "publication" ? publicationActions : null}</div>
        </PublishWizardScreen>
        <PublishWizardScreen active={activeWizardStep === "results"} step="results">
          {publicationResult?.error ? <p role="alert" className={wizardStyles.resultError}>{publicationResult.error}</p> : null}
          {activeWizardStep === "results" && publicationResult ? <PublishExecutionResultModal embedded styles={styles} {...publicationResult} publicationDestinations={publicationVisualDestinations} onSummaryChange={handlePublicationSummaryChange} onClose={onClose} /> : null}
        </PublishWizardScreen>
      {showContentWorkspace && workflowSteps ? (
        <>
          <PublishWizardScreen active={activeWizardStep === "content"} step="content">
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: isMobile ? "auto" : "100%" }}>
            {activeWizardStep === "content" && (generationNotice || generationMediaWarning) ? (
              <div
                data-publish-generation-outcome
                className={intentStyles.messages}
                style={{ flexShrink: 0, marginBottom: 8, padding: "8px 12px", border: "1px solid #8fa9dc30", borderRadius: 12, background: "#17253e61" }}
              >
                {generationNotice ? <div role="status">{generationNotice}</div> : null}
                {generationMediaWarning ? <div role="status" className={intentStyles.warning}>⚠️ {generationMediaWarning}</div> : null}
              </div>
            ) : null}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <PublishContentEditorPanel
              actionsContainer={contentActionsContainer}
              renderChannelSoundtrack={(channel, disabled) => activeWizardStep === "content" ? <MediaSoundtrackSelector key={channel} inline
                channelLabel={getLocalizedChannelLabel(channel, runtimeT)}
                soundtrackId={soundtrackByChannel[channel] ?? null}
                onChange={(id) => setSoundtrackByChannel(current => ({ ...current, [channel]: id }))}
                scopeKey={`${actorUserId}:${activeAccountId}:${channel}`}
                disabled={disabled || wizardBusy}
                selectionLocked={Boolean(publicationSummaryForActions?.entries?.some(entry => entry.channel === channel && publicationStorySequenceResumeRef(entry.story_sequence_resume_ref)))}
                unavailableHint={canConfigureChannelSoundtrack(channel) ? undefined : i18nT("publication_music_reserved_hint")} /> : null}
              styles={styles}
              isMobile={isMobile}
              creationMode={creationMode}
              stepNumber={workflowSteps.content}
              displayCards={displayCards}
              activeCard={activeCard}
              setSynchronizedActiveChannel={setSynchronizedActiveChannel}
              getDisplayPost={getDisplayPost}
              updatePost={updatePost}
              applySiteContentFormat={applySiteContentFormat}
              siteContentEditorRef={siteContentEditorRef}
              contentTextAreaRef={contentTextAreaRef}
              ctaDefaults={ctaDefaults}
              applyPreferredCtaPrefill={applyPreferredCtaPrefill}
              instagramHashtagsInput={instagramHashtagsInput}
              setInstagramHashtagsInput={setInstagramHashtagsInput}
              getLiveInstagramHashtags={getLiveInstagramHashtags}
              xHashtagsInput={xHashtagsInput}
              setXHashtagsInput={setXHashtagsInput}
              duplicateFeedback={duplicateFeedback}
              onDuplicateContentToAllChannels={onDuplicateContentToAllChannels}
              adjustmentDisabled={wizardBusy || !selectedForGeneration.length}
              onAdjustGeneration={creationMode === "ai" ? () => {
                setGenError("");
                setContentAdjustmentSession({ idea, instruction: publicationInstruction, channels: selectedForGeneration.filter(channel => Boolean(getDisplayPost(channel).content.trim())) });
              } : undefined}
              pinterestBoards={pinterestBoards}
              pinterestBoardId={pinterestBoardId}
              pinterestBoardsLoading={pinterestBoardsLoading}
              pinterestBoardsError={pinterestBoardsError}
              onPinterestBoardChange={onPinterestBoardChange}
              threadsPublicationMode={threadsPublicationMode}
              threadsPublicationPreferences={threadsPublicationPreferences}
              threadsPreferencesLoading={threadsPreferencesLoading}
              threadsPreferencesFailed={threadsPreferencesFailed}
              onThreadsPublicationModeChange={onThreadsPublicationModeChange}
              instagramPublicationPlacement={instagramPublicationPlacement}
              instagramStoryEnabled={instagramStoryEnabled}
              instagramPublicationPreferences={instagramPublicationPreferences}
              instagramMediaMode={resolveChannelMediaMode("instagram")}
              instagramImageCount={getPublishImageKeysForChannel("instagram").length}
              onInstagramPublicationPlacementChange={changeInstagramPublicationPlacement}
              onInstagramStoryEnabledChange={changeInstagramStoryEnabled}
              facebookPublicationPlacement={facebookPublicationPlacement}
              facebookStoryEnabled={facebookStoryEnabled}
              facebookPublicationPreferences={facebookPublicationPreferences}
              facebookMediaMode={resolveChannelMediaMode("facebook")}
              facebookImageCount={getPublishImageKeysForChannel("facebook").length}
              onFacebookPublicationPlacementChange={changeFacebookPublicationPlacement}
              onFacebookStoryEnabledChange={changeFacebookStoryEnabled}
              onVoiceBusyChange={setContentVoiceBusy}
            />
            </div>

          </div>
          </PublishWizardScreen>
          <PublishWizardScreen active={activeWizardStep === "media"} step="media">
            <PublishMediaPoolPanel images={images} imagePreviews={imagePreviews} videoFile={videoFile} videoPreviewUrl={videoPreviewUrl} isMobile={isMobile} error={imgError}
              onPickImages={() => { pendingDirectMediaDestinationRef.current = { kind: "publication" }; onPickImagesClick(); }}
              onPickVideo={() => onPickVideoClick({ kind: "publication" })}
              onGenerate={(kind) => void openInrStudioGenerator(kind)}
              onLibrary={(kind) => { setMediaLibraryPickerScope("publication"); setMediaLibraryPickerKind(kind); setMediaLibraryPickerOpen(true); }}
              onCamera={() => onTakePhotoClick(undefined, "publication")}
              onRemoveImage={removeImage} onRemoveVideo={removeVideo}
              onReorderImage={movePoolImageTo}
              onModifyImage={(index) => void openInrStudioImageTool("modify", activeImageChannel, imageKeys[index])}
              onRetouchImage={(index) => void openInrStudioImageTool("retouch", activeImageChannel, imageKeys[index])}
              onRetouchVideo={() => void openInrStudioVideoRetoucher(activeImageChannel)} />
          </PublishWizardScreen>
          <PublishWizardScreen active={activeWizardStep === "control"} step="control">
            <PublishValidationBoard items={publishReadinessItems} imageKeys={imageKeys} previewByKey={previewByKey} videoPreviewUrl={videoPreviewUrl}
              renderChannelOptions={(channel) => <PublishValidationChannelOptions channel={channel} disabled={wizardBusy}
                instagramMediaMode={resolveChannelMediaMode("instagram")} instagramImageCount={getPublishImageKeysForChannel("instagram").length}
                facebookMediaMode={resolveChannelMediaMode("facebook")} facebookImageCount={getPublishImageKeysForChannel("facebook").length}
                pinterestBoards={pinterestBoards} pinterestBoardId={pinterestBoardId} pinterestBoardsLoading={pinterestBoardsLoading}
                pinterestBoardsError={pinterestBoardsError} onPinterestBoardChange={onPinterestBoardChange}
                threadsPublicationMode={threadsPublicationMode} threadsPublicationPreferences={threadsPublicationPreferences}
                threadsPreferencesLoading={threadsPreferencesLoading} threadsPreferencesFailed={threadsPreferencesFailed}
                onThreadsPublicationModeChange={onThreadsPublicationModeChange}
                facebookPublicationPlacement={facebookPublicationPlacement} facebookStoryEnabled={facebookStoryEnabled}
                facebookPublicationPreferences={facebookPublicationPreferences}
                onFacebookPublicationPlacementChange={changeFacebookPublicationPlacement} onFacebookStoryEnabledChange={changeFacebookStoryEnabled}
                instagramPublicationPlacement={instagramPublicationPlacement} instagramStoryEnabled={instagramStoryEnabled}
                instagramPublicationPreferences={instagramPublicationPreferences}
                onInstagramPublicationPlacementChange={changeInstagramPublicationPlacement} onInstagramStoryEnabledChange={changeInstagramStoryEnabled} />}
              soundtrackByChannel={soundtrackByChannel} soundtrackScopeKey={`${actorUserId}:${activeAccountId}`}
              canSelectSoundtrack={canConfigureChannelSoundtrack}
              onSoundtrackChange={(channel, id) => setSoundtrackByChannel(current => ({ ...current, [channel]: id }))}
              isSoundtrackLocked={(channel) => Boolean(publicationSummaryForActions?.entries?.some(entry => entry.channel === channel && publicationStorySequenceResumeRef(entry.story_sequence_resume_ref)))}
              getMode={resolveChannelMediaMode}
              getSelectedImageKeys={(channel) => channelImageEditors[channel]?.imageKeys || imageKeys}
              onModeChange={(channel, mode) => {
                if (mode === "none") removeMediaFromChannel(channel);
                else if (mode === "images" && !(channelImageEditors[channel]?.imageKeys.length)) assignExistingImagesToChannel(channel);
                else setChannelMediaMode(channel, mode);
              }}
              onToggleImage={(channel, key) => {
                if ((channelImageEditors[channel]?.imageKeys || imageKeys).length <= 1) removeImagesFromChannel(channel);
                else toggleChannelImage(channel, key);
              }}
              onAddImage={(channel, key) => {
                if (resolveChannelMediaMode(channel) !== "images") removeImagesFromChannel(channel);
                setChannelMediaMode(channel, "images");
                toggleChannelImage(channel, key);
              }}
              onReorderImage={moveChannelImageTo} onSelectChannel={setSynchronizedActiveChannel}
              onOpenMediaPool={() => openWizardStep("media")}
              activePreview={activePublicationPreview}
              disabled={wizardBusy || activeWizardStep !== "control"} />
          </PublishWizardScreen>
        </>
      ) : null}
      </PublishWizardFrame>
    </div>
  );
}
