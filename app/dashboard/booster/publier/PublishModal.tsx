import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resolveActiveBrowserUserId } from "@/lib/browserAccountCache";
import { createClient } from "@/lib/supabaseClient";
import { prewarmBoosterGenerationContextClient } from "@/lib/boosterGenerationContextClient";
import { buildBoosterGenerationRequest } from "@/lib/boosterGenerationTransportClient";
import {
  createBoosterGenerationRequestId,
  isBoosterGenerationTransportLoss,
  recoverBoosterGenerationResult,
  reportBoosterGenerationResponseLoss,
} from "@/lib/boosterGenerationRecoveryClient";
import { postBoosterScheduledAction } from "@/lib/boosterScheduleClient";
import {
  getBoosterGenerationSpecialErrorMessage,
  isAutomaticBoosterGenerationRetryEligible,
} from "@/lib/boosterGenerationErrorPolicy";
import { getClientUserFacingErrorMessage as getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";
import {
  GENERATION_PROGRESS_PHASES,
  PUBLICATION_PROGRESS_PHASES,
  PUBLICATION_PROGRESS_STAGES,
  getProgressPhase,
  getProgressPhaseIndex,
  getPublicationProgressStage,
  getPublicationProgressStageForValue,
  mapProgressRange,
  resolvePublicationBilanProgress,
  type GenerationProgressPhaseKey,
  type PublicationProgressPhaseKey,
} from "@/lib/boosterProgressPhases";
import type { BoosterPublishProgressUpdate } from "@/lib/boosterPublishClient";
import { isBoosterPublicationPendingStatus } from "@/lib/boosterPublicationStatus";
import {
  DEFAULT_AI_PREFERRED_ENGINE,
  getAiEngineOption,
  getAutomaticAiRetryEngine,
  normalizeAiPreferredEngine,
  type AiPreferredEngine,
} from "@/lib/aiEnginePreference";
import {
  readPinterestBoardUiCache,
  writePinterestBoardUiCache,
} from "@/lib/pinterestUiSessionCache";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import { readSanitizedElementHtml } from "@/lib/sanitizeHtml";
import {
  normalizeVideoAiContextReference,
  videoAiContextReferenceAliases,
  type VideoAiContextReference,
} from "@/lib/videoAiContextReference";
import { confirmInrcy } from "@/lib/inrcyDialog";
import { INR_SEARCH_CONTENT_MAX_LENGTH } from "@/lib/boosterChannelRules";
import {
  buildCtaTextForChannel,
  sanitizeBoosterPostForStructuredCta,
} from "@/lib/boosterCta";
import {
  editableHtmlToSiteText,
  stripSiteTextFormatting,
  stripSiteTextFormattingPreserveLayout,
} from "@/lib/boosterFormatting";
import stylesDash from "../../dashboard.module.css";
import { ChannelImageAdapterModal } from "@/app/dashboard/_components/ChannelImageAdapterTool";
import {
  BOOSTER_IMAGE_ACCEPT,
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_MAX_IMAGE_BYTES,
  BOOSTER_MAX_VIDEO_BYTES,
  BOOSTER_VIDEO_ACCEPT,
  BOOSTER_VIDEO_FORMATS_LABEL,
  CHANNEL_LABELS,
  CHANNEL_PRESETS,
  buildAutoPrefillPatch,
  buildPreferredCtaPatch,
  buildBoosterVideoGenerationContext,
  buildVideoSettingsByChannel,
  channelSupportsImages,
  channelSupportsTextOnly,
  clampPercent,
  getChannelDefaultCtaLabel,
  getChannelPublicationRequirements,
  getAutomaticVideoSettingsForPublication,
  getDefaultCtaModeForChannel,
  normalizeBoosterPreferredCta,
  getPublicationMediaLabel,
  getWebsiteUrlForChannel,
  getImageFitLabel,
  getChannelSafetyBackgroundMode,
  getOptimizedTransform,
  getVideoFormatLabel,
  VIDEO_ADAPTATION_MODE_LABELS,
  VIDEO_FORMAT_ASPECT_RATIOS,
  extractVideoFramesForAI,
  fileToBoosterAiImagePayload,
  makeImageKey,
  isBoosterVideoFile,
  isSiteDisplayKey,
  normalizeBoosterAiLanguage,
  normalizePost,
  normalizePublicationMediaType,
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  parseInstagramHashtagsInput,
  uploadPreparedImages,
  type BoosterAiImagePayload,
  type BoosterCtaDefaults,
  type BoosterPreferredCta,
  type ChannelImageEditorState,
  type ChannelImagePayload,
  type ChannelImageSettingsPayload,
  type ChannelKey,
  type ChannelMediaMode,
  type ChannelPost,
  type VideoAdaptationMode,
  type VideoFormat,
  type DisplayKey,
  type ImageMeta,
  type ImagePayload,
  type PublicationMediaType,
  type StyleKey,
  type ThemeKey,
  type BoosterVideoSourceMetadata,
  type VideoPayload,
} from "./publishModal.shared";
import {
  AI_CONFIGURATION_STORAGE_KEY,
  CHANNEL_KEYS,
  EMPTY_CHANNEL_DETAILS,
  buildVideoFileName,
  buildVideoOrientation,
  buildVideoRatioLabel,
  getVideoOrientationLabel,
  isChannelKey,
  isStyleKey,
  isThemeKey,
  makeVideoTranscriptCacheKey,
  normalizeExternalHref,
  sanitizePatchForEditor,
  sanitizePostForEditor,
  sanitizePostsForEditor,
  simplifyChannelDetail,
  truncateText,
  type ChannelConnectionDetail,
  type PendingImmediatePublishAfterSchedule,
  type PinterestBoardOption,
  type VideoFramesForAI,
  type VideoFramesPreparationCache,
} from "./publishModal.foundations";
import {
  preloadPreparedImagePreview,
  readVideoSourceMetadata,
} from "./publishModal.videoAiRuntime";
import {
  scrollIntoViewWhenAvailable,
  settleOptionalMediaEnrichment,
} from "./publishModal.clientResilience";
import { pillBtn, pillBtnActive } from "./publishModal.styles";

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
import PublishImagesPanel from "./components/PublishImagesPanel";
import PublishPreviewPanel from "./components/PublishPreviewPanel";
import PublishHelpModal from "./components/PublishHelpModal";
import PublishWarningModals from "./components/PublishWarningModals";
import usePublishImageController from "./usePublishImageController";
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
import {
  getBoosterCreationWorkflow,
  getBoosterPublicationWorkflowSteps,
  inferBoosterCreationMode,
  shouldPrepareBoosterMediaForAi,
  type BoosterCreationMode,
} from "@/lib/boosterCreationMode";
import {
  normalizeYoutubeLongUploadsStatus,
  type YoutubeLongUploadsStatus,
} from "@/lib/videoPublicationPolicy";
import {
  canContinueWithIsolatedVideoPreparationFailures,
  isVideoPreparationReady,
  shouldRetryVideoVariantGeneration,
} from "@/lib/boosterVideoPreparationRecovery";
import {
  loadMediaPublicationWorkspace,
  type MediaWorkspaceMediaSummary,
} from "@/lib/mediaWorkspaceClient";
import {
  MEDIA_WORKSPACE_READINESS_TIMEOUT_MS,
  withMediaWorkspaceDeadline,
} from "@/lib/mediaWorkspaceTimeout";
import usePublishVideoController, {
  normalizeRestoredVideoVariants,
  type VideoVariantPreparationState,
} from "./usePublishVideoController";
import { assignVideoSourceToChannel } from "./videoChannelAssignment";
import {
  getGenerationMediaSelectionError,
  getGenerationMediaSelectionPolicy,
} from "./generationMediaSelection";

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

// 30 s reste la cible UX. La marge couvre un basculement fournisseur sans
// transformer une première tentative lente en faux échec nécessitant 2 clics.
const BOOSTER_GENERATION_TARGET_MS = 30_000;
const BOOSTER_GENERATION_SAFETY_BUDGET_MS = 105_000;
// Le préchauffage démarre dès l'insertion. Au clic, cette courte fenêtre absorbe
// la fin éventuelle des captures sans rogner le budget de l'IA.
const BOOSTER_VIDEO_AI_PREPARATION_GRACE_MS = 12_000;
// Le fallback navigateur reste un bonus court : aucun FileReader, canvas ou
// décodeur vidéo ne peut retenir la rédaction IA au-delà.
const BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS = 2_500;
const BOOSTER_PUBLISH_VISIBLE_CAP_MS = 60_000;
const BOOSTER_PUBLISH_WITH_MEDIA_FINALIZATION_VISIBLE_CAP_MS = 90_000;

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

export default function PublishModal({
  styles,
  onClose,
  trackEvent,
  onPublishSuccess,
  onOverlayOpenChange,
  onUnsavedChange,
  saveDraftActionRef,
  openHelpActionRef,
  onDraftHeaderStateChange,
  initialConnectedChannels,
}: {
  styles: typeof stylesDash;
  onClose: () => void;
  trackEvent: (type: "publish", payload: Record<string, any>) => Promise<any>;
  onPublishSuccess?: (result?: any) => void;
  onOverlayOpenChange?: (open: boolean) => void;
  onUnsavedChange?: (hasUnsavedChanges: boolean) => void;
  saveDraftActionRef?: MutableRefObject<(() => void) | null>;
  openHelpActionRef?: MutableRefObject<(() => void) | null>;
  onDraftHeaderStateChange?: (state: {
    saving: boolean;
    draftSaving: boolean;
    draftMessage: string;
  }) => void;
  initialConnectedChannels?: Partial<Record<ChannelKey, boolean>>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const publicationDraftIdParam = String(
    searchParams?.get("draftId") || "",
  ).trim();
  const [loadedPublicationDraftId, setLoadedPublicationDraftId] = useState<
    string | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [idea, setIdea] = useState("");
  const [publicationInstruction, setPublicationInstruction] = useState("");
  const [theme, setTheme] = useState<ThemeKey>("");
  const [contentStyle, setContentStyle] = useState<StyleKey>("equilibre");
  const [creationMode, setCreationMode] =
    useState<BoosterCreationMode | null>(null);
  const [creationModeError, setCreationModeError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationPhaseIndex, setGenerationPhaseIndex] = useState(0);
  const [generationPhaseLabel, setGenerationPhaseLabel] = useState("");
  const [generationStage, setGenerationStage] = useState("");
  const generationProgressTargetRef = useRef(0);
  const generationPhaseIndexRef = useRef(0);
  const generationRequestPhaseTimerRef = useRef<number | null>(null);
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

  const [genError, setGenError] = useState("");
  const [generationNotice, setGenerationNotice] = useState("");
  const [generationMediaWarning, setGenerationMediaWarning] = useState("");
  const [publishError, setPublishError] = useState("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [lastPublicationDraftSnapshot, setLastPublicationDraftSnapshot] =
    useState<string | null>(null);
  const [videoAiContextRef, setVideoAiContextRef] =
    useState<VideoAiContextReference | null>(null);

  useEffect(() => {
    onDraftHeaderStateChange?.({ saving, draftSaving, draftMessage });
  }, [saving, draftSaving, draftMessage, onDraftHeaderStateChange]);
  const [publishProgress, setPublishProgress] = useState(0);
  const [publishProgressLabel, setPublishProgressLabel] = useState("");
  const [publishProgressPhaseIndex, setPublishProgressPhaseIndex] = useState(0);
  const [publishProgressPhaseLabel, setPublishProgressPhaseLabel] = useState("");
  const publishProgressTargetRef = useRef(0);
  const publishProgressPhaseIndexRef = useRef(0);
  const phasedPublicationProgressRef = useRef(false);
  const publishStartGuardRef = useRef(false);
  const scheduleStartGuardRef = useRef(false);
  const [postsByChannel, setPostsByChannel] = useState<
    Partial<Record<ChannelKey, ChannelPost>>
  >({});
  const [contentWorkspaceOpen, setContentWorkspaceOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<DisplayKey>("inrcy_site");
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
  const [instagramHashtagsInput, setInstagramHashtagsInput] = useState("");
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
    "publish" | "schedule" | null
  >(null);
  const [tiktokPublicationSettings, setTiktokPublicationSettings] =
    useState<TiktokPublicationSettings | null>(null);

  const applyDefaultAiPreferredEngine = useCallback((value: unknown) => {
    const next = normalizeAiPreferredEngine(value);
    setDefaultAiPreferredEngine((previousDefault) => {
      setSelectedAiPreferredEngine((current) =>
        current === previousDefault ? next : current,
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
  const [pinterestBoardsError, setPinterestBoardsError] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const videoPickerTargetChannelRef = useRef<ChannelKey | null>(null);
  const [cameraCaptureOpen, setCameraCaptureOpen] = useState(false);
  const [cameraCaptureScope, setCameraCaptureScope] = useState<
    "generation" | "publication"
  >("generation");
  const [cameraCaptureTargetChannel, setCameraCaptureTargetChannel] =
    useState<ChannelKey | null>(null);
  const [mediaLibraryPickerOpen, setMediaLibraryPickerOpen] = useState(false);
  const [mediaLibraryPickerScope, setMediaLibraryPickerScope] = useState<
    "generation" | "publication"
  >("generation");
  const [preparedWorkspaceMedia, setPreparedWorkspaceMedia] = useState<
    readonly MediaWorkspaceMediaSummary[]
  >([]);
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
  const [activeImageChannel, setActiveImageChannel] =
    useState<ChannelKey>("inrcy_site");
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
    return () => {
      aiImagePayloadCacheRef.current.clear();
    };
  }, []);

  const [showPublicationPreview, setShowPublicationPreview] = useState(false);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const publishAreaRef = useRef<HTMLDivElement | null>(null);
  const contentTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const siteContentEditorRef = useRef<HTMLDivElement | null>(null);
  const creationPathRef = useRef<HTMLDivElement | null>(null);
  const contentWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const contentWorkspaceScrollCleanupRef = useRef<(() => void) | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);
  const publishRootRef = useRef<HTMLDivElement | null>(null);
  const publishScrollSnapshotRef = useRef<{
    element: HTMLElement | null;
    scrollTop: number;
    windowY: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      contentWorkspaceScrollCleanupRef.current?.();
      contentWorkspaceScrollCleanupRef.current = null;
    };
  }, []);

  const getInitialConnectedChannels = (): Record<ChannelKey, boolean> => ({
    inrcy_site: !!initialConnectedChannels?.inrcy_site,
    site_web: !!initialConnectedChannels?.site_web,
    gmb: !!initialConnectedChannels?.gmb,
    inr_search: !!initialConnectedChannels?.inr_search,
    facebook: !!initialConnectedChannels?.facebook,
    instagram: !!initialConnectedChannels?.instagram,
    linkedin: !!initialConnectedChannels?.linkedin,
    tiktok: !!initialConnectedChannels?.tiktok,
    youtube_shorts: !!initialConnectedChannels?.youtube_shorts,
    pinterest: !!initialConnectedChannels?.pinterest,
  });

  const [channels, setChannels] = useState<Record<ChannelKey, boolean>>(() =>
    getInitialConnectedChannels(),
  );

  const [connected, setConnected] = useState<Record<ChannelKey, boolean>>(() =>
    getInitialConnectedChannels(),
  );
  const [channelDetails, setChannelDetails] = useState<
    Record<ChannelKey, ChannelConnectionDetail>
  >(EMPTY_CHANNEL_DETAILS);
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
  const preferredCtaDefaultsAppliedRef = useRef(false);

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
    [],
  );

  const clearGenerationTimers = () => {
    if (generationRequestPhaseTimerRef.current) {
      window.clearInterval(generationRequestPhaseTimerRef.current);
      generationRequestPhaseTimerRef.current = null;
    }
  };

  const resetGenerationProgress = useCallback(() => {
    clearGenerationTimers();
    generationProgressTargetRef.current = 0;
    generationPhaseIndexRef.current = 0;
    setGenerationProgress(0);
    setGenerationPhaseIndex(0);
    setGenerationPhaseLabel("");
    setGenerationStage("");
  }, []);

  const setGenerationProgressPhase = useCallback(
    (
      key: GenerationProgressPhaseKey,
      detail: string,
      target?: number,
    ) => {
      const phase = getProgressPhase(GENERATION_PROGRESS_PHASES, key);
      const phaseIndex = getProgressPhaseIndex(
        GENERATION_PROGRESS_PHASES,
        key,
      );
      if (phaseIndex < generationPhaseIndexRef.current) return;

      if (phaseIndex > generationPhaseIndexRef.current) {
        generationPhaseIndexRef.current = phaseIndex;
        setGenerationPhaseIndex(phaseIndex);
        setGenerationPhaseLabel(phase.label);
        setGenerationProgress((current) => Math.max(current, phase.start));
      }

      const nextTarget = Math.min(
        phase.cap,
        Math.max(phase.start, target ?? Math.max(phase.start, phase.cap - 1)),
      );
      generationProgressTargetRef.current = Math.max(
        generationProgressTargetRef.current,
        nextTarget,
      );
      setGenerationStage(detail || phase.label);
    },
    [],
  );

  const completeGenerationProgress = useCallback((detail: string) => {
    const phase = getProgressPhase(GENERATION_PROGRESS_PHASES, "complete");
    const phaseIndex = getProgressPhaseIndex(
      GENERATION_PROGRESS_PHASES,
      "complete",
    );
    generationPhaseIndexRef.current = phaseIndex;
    generationProgressTargetRef.current = 100;
    setGenerationPhaseIndex(phaseIndex);
    setGenerationPhaseLabel(phase.label);
    setGenerationStage(detail || phase.label);
    setGenerationProgress(100);
  }, []);

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
          setPublishProgressPhaseLabel(visibleStage.label);
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
      setPublishProgressLabel(detail || phase.label);
    },
    [],
  );

  const completePublicationProgress = useCallback((detail: string) => {
    const phase = getProgressPhase(PUBLICATION_PROGRESS_PHASES, "complete");
    const phaseIndex = getProgressPhaseIndex(
      PUBLICATION_PROGRESS_PHASES,
      "complete",
    );
    publishProgressPhaseIndexRef.current = phaseIndex;
    publishProgressTargetRef.current = 100;
    const visibleStage = getPublicationProgressStage("complete");
    setPublishProgressPhaseIndex(visibleStage.index);
    setPublishProgressPhaseLabel(visibleStage.label);
    setPublishProgressLabel(detail || phase.label);
    setPublishProgress(100);
  }, []);

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
    const timerId = window.setInterval(() => {
      setGenerationProgress((current) => {
        const target = generationProgressTargetRef.current;
        if (current >= target) return current;
        const distance = target - current;
        const step = distance > 18 ? 2 : 1;
        return Math.min(target, current + step);
      });
    }, 180);
    return () => window.clearInterval(timerId);
  }, [generating]);

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
    setPublishProgressPhaseLabel(visibleStage.label);
  }, [publishProgress, saving]);

  useEffect(() => {
    return () => {
      clearGenerationTimers();
    };
  }, []);

  useEffect(() => {
    void prewarmBoosterGenerationContextClient();
  }, []);

  useEffect(() => {
    const nextValue = (
      normalizePost(postsByChannel.instagram).hashtags || []
    ).join(" ");
    setInstagramHashtagsInput((prev) =>
      prev === nextValue ? prev : nextValue,
    );
  }, [postsByChannel.instagram?.hashtags?.join("|") ?? ""]);

  useEffect(() => {
    onOverlayOpenChange?.(isImageEditorOpen || aiConfigurationOpen);
    return () => {
      onOverlayOpenChange?.(false);
    };
  }, [isImageEditorOpen, aiConfigurationOpen, onOverlayOpenChange]);

  useEffect(() => {
    let alive = true;
    const failClosedConnectedChannels = () => {
      if (!alive) return;
      const unavailable = CHANNEL_KEYS.reduce(
        (result, key) => {
          result[key] = false;
          return result;
        },
        {} as Record<ChannelKey, boolean>,
      );
      applyConnectedChannels(unavailable);
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
      try {
        const res = await fetch("/api/booster/connected-channels", {
          cache: "no-store" as any,
        });
        if (!res.ok) {
          failClosedConnectedChannels();
          return;
        }
        const json = await res.json();
        if (!alive) return;
        if (json?.channels && typeof json.channels === "object") {
          const nextConnected = CHANNEL_KEYS.reduce(
            (result, key) => {
              result[key] = Boolean(json.channels[key]);
              return result;
            },
            {} as Record<ChannelKey, boolean>,
          );
          applyConnectedChannels(nextConnected);
          if (json?.channelDetails) {
            setChannelDetails((prev) => {
              const next = { ...prev, ...json.channelDetails };
              CHANNEL_KEYS.forEach((key) => {
                next[key] = { ...next[key], availabilityError: false };
              });
              return next;
            });
          }
          if (json.channels.pinterest) {
            void fetch("/api/integrations/pinterest/status?live=1", {
              cache: "no-store" as any,
            })
              .then(async (pinterestResponse) => {
                if (!pinterestResponse.ok) return null;
                return pinterestResponse.json().catch(() => null);
              })
              .then((pinterestStatus) => {
                if (!alive || !pinterestStatus?.ok || !pinterestStatus?.connected)
                  return;
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
                setChannelDetails((current) => ({
                  ...current,
                  pinterest: {
                    ...(current.pinterest || EMPTY_CHANNEL_DETAILS.pinterest),
                    type: "account",
                    label: accountLabel || "Compte Pinterest connecté",
                    href: profileHref || null,
                  },
                }));
              })
              .catch(() => null);
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
                if (!alive || !tiktokStatus?.ok || !tiktokStatus?.tiktok?.connected)
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
                setChannelDetails((current) => ({
                  ...current,
                  tiktok: {
                    ...(current.tiktok || EMPTY_CHANNEL_DETAILS.tiktok),
                    type: "account",
                    label: username ? `@${username}` : "Compte TikTok connecté",
                    href: profileHref || null,
                  },
                }));
              })
              .catch(() => null);
          }
        } else {
          failClosedConnectedChannels();
        }
      } catch {
        failClosedConnectedChannels();
      }
    };
    void refreshConnectedChannels();
    const intervalId = window.setInterval(refreshConnectedChannels, 60_000);
    const onFocus = () => void refreshConnectedChannels();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, [applyConnectedChannels]);

  useEffect(() => {
    if (!initialConnectedChannels) return;
    const nextConnected = getInitialConnectedChannels();
    const previousConnected = lastInitialConnectedChannelsRef.current;
    lastInitialConnectedChannelsRef.current = nextConnected;

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
  }, [initialConnectedChannels]);

  const loadPinterestBoardsForPublish = useCallback(async () => {
    if (!connected.pinterest) {
      setPinterestBoards([]);
      setPinterestBoardsError("");
      return;
    }

    setPinterestBoardsLoading(true);
    setPinterestBoardsError("");
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
      setPinterestBoardsError(
        getSimpleFrenchErrorMessage(
          error,
          "Impossible de charger les tableaux Pinterest.",
        ),
      );
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
      setPinterestBoardsError("");
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
    const handleAiConfigurationUpdated = (event: Event) => {
      const detail =
        (event as CustomEvent<{ aiLanguage?: unknown; preferredCta?: unknown }>)
          .detail || {};
      setCtaDefaults((current) => {
        if (!current) return current;
        return {
          ...current,
          preferredCta: normalizeBoosterPreferredCta(
            detail.preferredCta || current.preferredCta,
          ),
          aiLanguage: normalizeBoosterAiLanguage(
            detail.aiLanguage || current.aiLanguage,
          ),
        };
      });
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
    (async () => {
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
          inrcySiteUrl: String(json?.inrcySiteUrl || "").trim(),
          phone: String(json?.phone || "").trim(),
          preferredCta: normalizeBoosterPreferredCta(json?.preferredCta),
          aiLanguage: normalizeBoosterAiLanguage(json?.aiLanguage),
        });
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ctaDefaults) return;
    const shouldApplyPreferredDefaults =
      !preferredCtaDefaultsAppliedRef.current;
    if (shouldApplyPreferredDefaults)
      preferredCtaDefaultsAppliedRef.current = true;

    setPostsByChannel((prev) => {
      let changed = false;
      const next: Partial<Record<ChannelKey, ChannelPost>> = { ...prev };
      const keys: ChannelKey[] = [
        "site_web",
        "inrcy_site",
        "gmb",
        "facebook",
        "instagram",
        "linkedin",
        "tiktok",
        "youtube_shorts",
        "pinterest",
      ];
      for (const key of keys) {
        const current = sanitizePostForEditor(key, prev[key]);
        const hasExistingCta = Boolean(
          String(current.cta || "").trim() ||
          String(current.ctaUrl || "").trim() ||
          String(current.ctaPhone || "").trim(),
        );
        let mode = current.ctaMode || "none";
        const shouldSetPreferredMode =
          shouldApplyPreferredDefaults && mode === "none" && !hasExistingCta;
        const preferredChoice = normalizeBoosterPreferredCta(
          ctaDefaults.preferredCta,
        );
        if (shouldSetPreferredMode)
          mode = getDefaultCtaModeForChannel(key, ctaDefaults);
        if (
          mode !== "website" &&
          mode !== "call" &&
          mode !== "message" &&
          mode !== "custom" &&
          mode !== "none"
        )
          continue;

        const patch = shouldSetPreferredMode
          ? buildPreferredCtaPatch(
              key,
              preferredChoice,
              current,
              ctaDefaults,
              ctaDefaults.aiLanguage,
            )
          : buildAutoPrefillPatch(
              key,
              mode,
              current,
              ctaDefaults,
              ctaDefaults.aiLanguage,
            );
        const hasMeaningfulPatch = Object.entries(patch).some(
          ([patchKey, patchValue]) => {
            if (patchKey === "ctaMode")
              return shouldSetPreferredMode && patchValue !== current.ctaMode;
            return String(patchValue || "").trim();
          },
        );
        const merged = sanitizePostForEditor(
          key,
          sanitizeBoosterPostForStructuredCta(
            hasMeaningfulPatch ? { ...current, ...patch } : current,
            {
              websiteUrl: getWebsiteUrlForChannel(key, ctaDefaults),
              phone: ctaDefaults.phone,
            },
          ),
        );
        const before = JSON.stringify(current);
        const after = JSON.stringify(merged);
        if (before === after) continue;
        next[key] = merged;
        changed = true;
      }
      return changed ? next : prev;
    });
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
  }, [channels, connected]);

  useEffect(() => {
    if (!displayCards.length) {
      setActiveCard("inrcy_site");
      setActiveImageChannel("inrcy_site");
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
    [channels, connected],
  );

  const handlePreparedWorkspaceMedia = useCallback(
    (preparedMedia: readonly MediaWorkspaceMediaSummary[]) => {
      setPreparedWorkspaceMedia([...preparedMedia]);
      const preparedVideos = preparedMedia.filter(
        (item) => item.mediaType === "video",
      );

      if (
        generating &&
        preparedVideos.length > 0
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          "Préparation des médias",
          37,
        );
      }

      const preparedImages = preparedMedia.filter(
        (item) =>
          item.mediaType === "image" &&
          item.processingStatus === "ready" &&
          Boolean(item.previewUrl),
      );
      if (!preparedImages.length) return;

      for (const item of preparedImages) {
        if (item.position < 0 || item.position >= images.length) continue;
        const previewUrl = String(item.previewUrl || "");
        const expectedImageKey = makeImageKey(images[item.position]);
        if (!previewUrl) continue;

        void preloadPreparedImagePreview(previewUrl).then((loaded) => {
          const currentFile = imagesRef.current[item.position];
          if (
            !loaded ||
            !currentFile ||
            makeImageKey(currentFile) !== expectedImageKey
          ) {
            return;
          }
          setImagePreviews((current) => {
            const previous = current[item.position];
            // Un aperçu blob local décodable reste le plus rapide et le plus
            // fiable pendant la session. Le serveur remplace uniquement les
            // placeholders des formats que le navigateur ne sait pas lire.
            if (previous?.startsWith("blob:") || previous === previewUrl) {
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
            width,
            height,
            ratio: width / height,
          };
        }
        return next;
      });
    },
    [generating, images, setGenerationProgressPhase],
  );

  const {
    enabled: persistentMediaWorkspaceEnabled,
    workspaceId: mediaWorkspaceId,
    clientWorkspaceKey: mediaWorkspaceClientKey,
    mediaStates: persistentMediaStates,
    synchronizing: persistentMediaSynchronizing,
    adoptWorkspace: adoptMediaWorkspace,
    syncImages: syncPersistentWorkspaceImages,
    syncVideo: syncPersistentWorkspaceVideo,
    prepareAiMedia: startPersistentAiMediaPreparation,
    preparePublicationVariants: prewarmPersistentMediaWorkspace,
    clearWorkspaceMedia: clearPersistentWorkspaceMedia,
    linkDraft: linkPersistentWorkspaceDraft,
    ensureWorkspace: ensurePersistentMediaWorkspace,
    waitForIdle: waitForPersistentWorkspaceIdle,
    verifyReadySources: verifyPersistentWorkspaceSources,
    archiveWorkspace: archivePersistentMediaWorkspace,
  } = usePersistentMediaWorkspace({
    draftId: publicationDraftIdParam,
    creationMode,
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
  const unifiedMediaConsumptionEnabled =
    unifiedMediaConsumptionClientAvailable && Boolean(mediaWorkspaceId);
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
    videoPreviewVariantsPreparing,
    videoSettingsByChannel,
    clearVideoVariantPreparationForChannel,
    clearPreparedVideoVariantsForChannel,
    setVideoFormatForChannel,
    setVideoAdaptationModeForChannel,
    uploadPublicationVideoForPublish,
    buildPublicationDraftVideoPayload,
    buildVideoPreparationStateFromVariants,
    preparePublicationVideoVariants,
    applyVideoFormatsForChannels,
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
            "Supabase est temporairement saturé pendant la sécurisation des médias. Réessayez dans quelques secondes.",
        },
      );
    },
    [
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

  const resolveChannelMediaMode = (channel: ChannelKey): ChannelMediaMode => {
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

  function getCutoverVideoPreparationError(result: any) {
    const firstInvalidChannel = Array.isArray(result?.invalidChannels)
      ? result.invalidChannels[0]
      : null;
    const firstError = Array.isArray(result?.errors) ? result.errors[0] : null;
    const message = String(
      firstInvalidChannel?.message ||
        (typeof firstError === "string" ? firstError : firstError?.message) ||
        result?.error ||
        "",
    ).trim();
    return (
      message ||
      "La vidéo n’est pas encore prête pour tous les réseaux. Réessayez dans quelques instants."
    );
  }

  async function ensureCutoverVideoVariantsReady(
    channels: ChannelKey[],
    settingsByChannel: Partial<
      Record<
        ChannelKey,
        { format: VideoFormat; adaptationMode: VideoAdaptationMode }
      >
    >,
    options?: {
      generateMissingVideoVariants?: boolean;
      allowPartialChannelFailures?: boolean;
    },
  ) {
    if (!mediaPipelineCutoverEnabled || !channels.length) return null;

    await waitForPersistentWorkspaceIdle(undefined, {
      mediaTypes: ["video"],
    });
    const workspace = await ensurePersistentMediaWorkspace();
    if (!workspace) {
      throw new Error("L’espace média de cette publication est indisponible.");
    }

    let result = await prewarmPersistentMediaWorkspace({
      selectedChannels: channels,
      requestedMediaType: "video",
      videoSettingsByChannel: settingsByChannel as Record<string, unknown>,
      generateMissingVideoVariants:
        options?.generateMissingVideoVariants !== false,
      mediaPipelineCutoverV1: true,
      allowOriginalVideoFallback: false,
    });
    // Fast path first: reuse an existing explicit channel adaptation. If its
    // cache was invalidated, regenerate that adaptation once from the original
    // server-validated workspace source.
    if (
      !isVideoPreparationReady(result) &&
      options?.generateMissingVideoVariants === false &&
      shouldRetryVideoVariantGeneration(
        Array.isArray(result?.invalidChannels) ? result.invalidChannels : [],
      )
    ) {
      setContextualPublishProgress((current) => Math.max(current, 46));
      setContextualPublishProgressLabel(
        "Préparation de la variante vidéo nécessaire...",
      );
      result = await prewarmPersistentMediaWorkspace({
        selectedChannels: channels,
        videoSettingsByChannel: settingsByChannel as Record<string, unknown>,
        generateMissingVideoVariants: true,
        mediaPipelineCutoverV1: true,
        allowOriginalVideoFallback: false,
      });
    }

    if (!isVideoPreparationReady(result)) {
      if (
        options?.allowPartialChannelFailures === true &&
        canContinueWithIsolatedVideoPreparationFailures(result)
      ) {
        return result;
      }
      throw new Error(getCutoverVideoPreparationError(result));
    }
    return result;
  }

  async function applyVideoFormatForChannel(channel: ChannelKey) {
    if (mediaPipelineCutoverEnabled) {
      // Le format est déjà enregistré par setVideoFormatForChannel. Le
      // pipeline serveur réalisera l'éventuelle dérivée après Publier.
      clearVideoVariantPreparationForChannel(channel);
      setImgError("");
      return;
    }
    const mediaModeByChannel = {
      [channel]: resolveChannelMediaMode(channel),
    } as Partial<Record<ChannelKey, ChannelMediaMode>>;

    await applyVideoFormatsForChannels({
      channels: [channel],
      mediaModeByChannel,
    });
  }

  async function applyVideoFormatToAllChannels(sourceChannel: ChannelKey) {
    const publishMediaModeByChannel = Object.fromEntries(
      selectedChannels.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const videoChannels = selectedChannels.filter(
      (channel) => publishMediaModeByChannel[channel] === "video",
    );
    if (!videoChannels.length) {
      setImgError("Sélectionnez au moins un canal en mode vidéo.");
      return;
    }

    const sourceSettings = videoSettingsByChannel[sourceChannel];
    if (!sourceSettings) {
      setImgError("Choisissez d’abord le format vidéo à appliquer.");
      return;
    }

    const sharedSettingsByChannel = videoChannels.reduce(
      (acc, channel) => {
        acc[channel] = {
          format: normalizeVideoFormat(channel, sourceSettings.format),
          adaptationMode: normalizeVideoAdaptationMode(
            sourceSettings.adaptationMode,
          ),
        };
        return acc;
      },
      {} as Partial<
        Record<
          ChannelKey,
          { format: VideoFormat; adaptationMode: VideoAdaptationMode }
        >
      >,
    );

    setVideoFormatByChannel((prev) => {
      const next = { ...prev };
      videoChannels.forEach((channel) => {
        const settings = sharedSettingsByChannel[channel];
        if (settings) next[channel] = settings.format;
      });
      return next;
    });
    setVideoAdaptationModeByChannel((prev) => {
      const next = { ...prev };
      videoChannels.forEach((channel) => {
        const settings = sharedSettingsByChannel[channel];
        if (settings) next[channel] = settings.adaptationMode;
      });
      return next;
    });

    if (mediaPipelineCutoverEnabled) {
      videoChannels.forEach(clearVideoVariantPreparationForChannel);
      setImgError("");
      return;
    }

    await applyVideoFormatsForChannels({
      channels: videoChannels,
      mediaModeByChannel: publishMediaModeByChannel,
      settingsByChannel: sharedSettingsByChannel,
    });
  }

  const syncActiveImagesToPersistentWorkspace = useCallback(
    async (
      nextImages: readonly File[],
      metadataByIndex?: readonly Record<string, unknown>[],
    ) => {
      if (!persistentMediaWorkspaceEnabled) return;
      await syncPersistentWorkspaceImages(nextImages, metadataByIndex);
    },
    [
      persistentMediaWorkspaceEnabled,
      syncPersistentWorkspaceImages,
    ],
  );

  const {
    imageAdapterChannels,
    getImageAdapterLabel,
    imageKeys,
    previewByKey,
    activeEditorImageKey,
    activeEditorTransform,
    activeEditorDecisionLabel,
    activeEditorMeta,
    activeEffectiveZoom,
    activeBackgroundMode,
    activeBackgroundColor,
    previewAspectRatio,
    previewLayout,
    clearImagesMedia,
    onPickImagesClick,
    onPickImagesForChannel,
    addImageFiles,
    onImagesChange,
    assignExistingImagesToChannel,
    removeImagesFromChannel,
    removeImage,
    getDraftImageSettingsByChannel,
    uploadPublicationDraftImages,
    restorePublicationDraftImages,
    updateChannelTransform,
    setContainMode,
    setCoverMode,
    nudgeZoom,
    handlePreviewWheel,
    handlePreviewPointerDown,
    handlePreviewPointerMove,
    endPreviewDrag,
    toggleChannelImage,
    resetChannelImage,
    resetActiveChannelImages,
    applyCurrentCadrageToActiveChannelImages,
    moveChannelImage,
    applyCurrentImageToSelectedChannels,
    openImageEditor,
    closeImageEditor,
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
    isImageEditorOpen,
    setIsImageEditorOpen,
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

  const selectedForGeneration = useMemo(() => {
    return CHANNEL_KEYS.filter((channel) => channels[channel] && connected[channel]);
  }, [channels, connected]);

  const setSynchronizedActiveChannel = (channel: ChannelKey) => {
    setActiveCard(channel);
    setActiveImageChannel(channel);
  };

  useEffect(() => {
    setChannelMediaModes((prev) => {
      const next: Partial<Record<ChannelKey, ChannelMediaMode>> = { ...prev };
      let changed = false;
      for (const channel of selectedChannels) {
        const current = next[channel];
        const hasVideo = Boolean(videoFile || videoPreviewUrl);
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
    selectedChannels.join("|"),
    Boolean(videoFile || videoPreviewUrl),
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
          theme ||
          contentStyle !== "equilibre" ||
          hasWrittenChannelContent,
      ),
    [
      idea,
      publicationInstruction,
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
    const hasGeneratedContent = Object.values(postsByChannel).some((post) => {
      const normalized = normalizePost(post);
      return !!(
        normalized.title?.trim() ||
        normalized.content?.trim() ||
        normalized.cta?.trim() ||
        normalized.ctaUrl?.trim() ||
        normalized.ctaPhone?.trim() ||
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
    publicationMediaType,
    channelMediaModes,
    videoFormatByChannel,
    videoAdaptationModeByChannel,
    videoSettingsByChannel,
    idea,
    publicationInstruction,
    theme,
    contentStyle,
    postsByChannel,
    images.length,
    imagePreviews.length,
    videoFile,
    videoPreviewUrl,
    videoSourceMetadata,
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
      instagramHashtagsInput,
      pinterestBoardId,
      pinterestBoardName,
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
    instagramHashtagsInput,
    pinterestBoardId,
    pinterestBoardName,
    images,
    videoFile,
    videoDurationSeconds,
    videoSourceMetadata,
    videoTransformedVariants,
    videoAiContextRef,
    useImagesForAI,
    channelImageEditors,
  ]);

  async function restorePublicationDraftVideo(videoDraft: any): Promise<{
    file: File | null;
    previewUrl: string;
    duration: number | null;
    sourceMetadata: BoosterVideoSourceMetadata | null;
    storage: Pick<VideoPayload, "storagePath" | "publicUrl" | "url"> | null;
    transformedVariants: NonNullable<VideoPayload["transformedVariants"]>;
  }> {
    const source = String(
      videoDraft?.publicUrl || videoDraft?.url || "",
    ).trim();
    if (!source)
      return {
        file: null as File | null,
        previewUrl: "",
        duration: null as number | null,
        sourceMetadata: null as BoosterVideoSourceMetadata | null,
        storage: null as Pick<
          VideoPayload,
          "storagePath" | "publicUrl" | "url"
        > | null,
        transformedVariants: [],
      };

    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error("Vidéo indisponible.");
      const blob = await response.blob();
      const name = String(videoDraft?.name || "video-inrcy.mp4");
      const type = String(videoDraft?.type || blob.type || "video/mp4");
      const lastModified = Number(videoDraft?.lastModified || Date.now());
      const file = new File([blob], name, { type, lastModified });
      const rawDuration = Number(videoDraft?.duration || 0);
      const duration =
        Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
      const sourceMetadata =
        videoDraft?.sourceMetadata &&
        typeof videoDraft.sourceMetadata === "object"
          ? (videoDraft.sourceMetadata as BoosterVideoSourceMetadata)
          : await readVideoSourceMetadata(file);
      const transformedVariants = normalizeRestoredVideoVariants(
        (videoDraft as any)?.transformedVariants,
      );
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        duration: sourceMetadata?.duration ?? duration,
        sourceMetadata,
        storage: {
          storagePath: String(
            videoDraft?.storagePath || videoDraft?.path || "",
          ),
          publicUrl: source,
          url: source,
        },
        transformedVariants,
      };
    } catch {
      return {
        file: null as File | null,
        previewUrl: "",
        duration: null as number | null,
        sourceMetadata: null as BoosterVideoSourceMetadata | null,
        storage: null as Pick<
          VideoPayload,
          "storagePath" | "publicUrl" | "url"
        > | null,
        transformedVariants: normalizeRestoredVideoVariants(
          (videoDraft as any)?.transformedVariants,
        ),
      };
    }
  }

  useEffect(() => {
    if (
      !publicationDraftIdParam ||
      loadedPublicationDraftId === publicationDraftIdParam
    )
      return;
    let cancelled = false;

    const loadPublicationDraft = async () => {
      setDraftMessage("Chargement du brouillon…");
      setPublishError("");
      try {
        const response = await fetch(
          `/api/booster/events?draftId=${encodeURIComponent(publicationDraftIdParam)}`,
          {
            cache: "no-store" as any,
          },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok)
          throw new Error(
            String(result?.error || "Brouillon publication introuvable."),
          );
        const payload = (result?.payload || {}) as any;
        adoptMediaWorkspace(
          payload.mediaWorkspaceId,
          payload.mediaWorkspaceClientKey,
        );

        const rawChannels = Array.isArray(payload.channels)
          ? payload.channels
          : [];
        const savedChannels = rawChannels
          .map((value: unknown) => String(value || ""))
          .filter(isChannelKey);
        const nextChannels = CHANNEL_KEYS.reduce(
          (acc, key) => {
            acc[key] = savedChannels.length
              ? savedChannels.includes(key)
              : Boolean(channels[key]);
            return acc;
          },
          {} as Record<ChannelKey, boolean>,
        );

        const nextTheme = isThemeKey(payload.theme) ? payload.theme : "";
        const nextContentStyle = isStyleKey(payload.contentStyle)
          ? payload.contentStyle
          : "equilibre";
        const nextPostsByChannel = sanitizePostsForEditor(
          payload.postByChannel && typeof payload.postByChannel === "object"
            ? payload.postByChannel
            : {},
        );
        const nextEditors =
          payload.imageSettingsByChannel &&
          typeof payload.imageSettingsByChannel === "object"
            ? payload.imageSettingsByChannel
            : {};
        const nextUseImagesForAI =
          typeof payload.useImagesForAI === "boolean"
            ? payload.useImagesForAI
            : true;
        let imageDrafts = Array.isArray(payload.imageDrafts)
          ? payload.imageDrafts
          : [];
        let videoDraft =
          payload.videoDraft && typeof payload.videoDraft === "object"
            ? payload.videoDraft
            : null;

        const linkedWorkspaceId = String(payload.mediaWorkspaceId || "").trim();
        if (
          legacyMediaCutoverClientAvailable &&
          linkedWorkspaceId &&
          !imageDrafts.length &&
          !videoDraft
        ) {
          const snapshot = await loadMediaPublicationWorkspace({
            workspaceId: linkedWorkspaceId,
          });
          const workspaceImages = snapshot.media.filter(
            (media) => media.mediaType === "image" && Boolean(media.publicUrl),
          );
          const workspaceVideo = snapshot.media.find(
            (media) => media.mediaType === "video" && Boolean(media.publicUrl),
          );
          imageDrafts = workspaceImages.map((media) => {
            const keyParts = String(media.clientMediaKey || "").split(":");
            const lastModified = Number(keyParts[keyParts.length - 1] || 0);
            return {
              name: media.fileName,
              type: media.mimeType,
              size: media.sizeBytes,
              lastModified:
                Number.isFinite(lastModified) && lastModified > 0
                  ? lastModified
                  : Date.now(),
              storagePath: media.storagePath,
              publicUrl: media.publicUrl,
            };
          });
          if (workspaceVideo) {
            const keyParts = String(workspaceVideo.clientMediaKey || "").split(":");
            const lastModified = Number(keyParts[keyParts.length - 1] || 0);
            videoDraft = {
              name: workspaceVideo.fileName,
              type: workspaceVideo.mimeType,
              size: workspaceVideo.sizeBytes,
              lastModified:
                Number.isFinite(lastModified) && lastModified > 0
                  ? lastModified
                  : Date.now(),
              duration: workspaceVideo.durationSeconds,
              storagePath: workspaceVideo.storagePath,
              publicUrl: workspaceVideo.publicUrl,
              url: workspaceVideo.publicUrl,
              sourceMetadata: {
                width: workspaceVideo.width,
                height: workspaceVideo.height,
                duration: workspaceVideo.durationSeconds,
              },
            };
          }
        }
        const nextVideoAiContextRef =
          normalizeVideoAiContextReference(payload.videoAiContextRef) ||
          normalizeVideoAiContextReference(videoDraft?.videoAiContextRef);
        const nextMediaType = normalizePublicationMediaType(payload.mediaType);
        const nextChannelMediaModes =
          payload.channelMediaModes &&
          typeof payload.channelMediaModes === "object"
            ? (payload.channelMediaModes as Partial<
                Record<ChannelKey, ChannelMediaMode>
              >)
            : {};
        const nextVideoFormatByChannel =
          payload.videoFormatByChannel &&
          typeof payload.videoFormatByChannel === "object"
            ? (Object.fromEntries(
                Object.entries(
                  payload.videoFormatByChannel as Record<string, unknown>,
                )
                  .filter(([channel]) => isChannelKey(channel))
                  .map(([channel, value]) => [
                    channel,
                    normalizeVideoFormat(channel as ChannelKey, value),
                  ]),
              ) as Partial<Record<ChannelKey, VideoFormat>>)
            : {};
        const rawVideoSettingsByChannel =
          payload.videoSettingsByChannel &&
          typeof payload.videoSettingsByChannel === "object"
            ? payload.videoSettingsByChannel
            : null;
        const nextVideoAdaptationModeByChannel =
          payload.videoAdaptationModeByChannel &&
          typeof payload.videoAdaptationModeByChannel === "object"
            ? (Object.fromEntries(
                Object.entries(
                  payload.videoAdaptationModeByChannel as Record<
                    string,
                    unknown
                  >,
                )
                  .filter(([channel]) => isChannelKey(channel))
                  .map(([channel, value]) => [
                    channel,
                    normalizeVideoAdaptationMode(value),
                  ]),
              ) as Partial<Record<ChannelKey, VideoAdaptationMode>>)
            : {};
        const nextCanonicalVideoSettingsByChannel = buildVideoSettingsByChannel(
          {
            channels: CHANNEL_KEYS,
            videoSettingsByChannel: rawVideoSettingsByChannel,
            videoFormatByChannel: nextVideoFormatByChannel,
            videoAdaptationModeByChannel: nextVideoAdaptationModeByChannel,
          },
        );
        const nextCanonicalVideoFormatByChannel = Object.fromEntries(
          Object.entries(nextCanonicalVideoSettingsByChannel).map(
            ([channel, settings]) => [channel, settings?.format],
          ),
        ) as Partial<Record<ChannelKey, VideoFormat>>;
        const nextCanonicalVideoAdaptationModeByChannel = Object.fromEntries(
          Object.entries(nextCanonicalVideoSettingsByChannel).map(
            ([channel, settings]) => [channel, settings?.adaptationMode],
          ),
        ) as Partial<Record<ChannelKey, VideoAdaptationMode>>;
        const { restoredFiles, restoredPreviews, restoredMeta } =
          await restorePublicationDraftImages(imageDrafts);
        const restoredVideo = videoDraft
          ? await restorePublicationDraftVideo(videoDraft)
          : {
              file: null as File | null,
              previewUrl: "",
              duration: null as number | null,
              sourceMetadata: null as BoosterVideoSourceMetadata | null,
              storage: null as Pick<
                VideoPayload,
                "storagePath" | "publicUrl" | "url"
              > | null,
              transformedVariants: [] as NonNullable<
                VideoPayload["transformedVariants"]
              >,
            };

        if (cancelled) return;

        const nextIdea = String(payload.idea || "");
        const nextPublicationInstruction = String(
          payload.publicationInstruction || "",
        );
        const nextInstagramHashtags =
          String(payload.instagramHashtagsInput || "") ||
          (Array.isArray((nextPostsByChannel as any)?.instagram?.hashtags)
            ? (nextPostsByChannel as any).instagram.hashtags.join(" ")
            : "");
        const nextPinterestBoardId = String(
          payload.pinterestBoardId || "",
        ).trim();
        const nextPinterestBoardName = String(
          payload.pinterestBoardName || "",
        ).trim();
        const nextCreationMode = inferBoosterCreationMode({
          explicitMode: payload.creationMode,
          idea: nextIdea,
          publicationInstruction: nextPublicationInstruction,
          theme: nextTheme,
          contentStyle: nextContentStyle,
          postsByChannel: nextPostsByChannel,
        });

        setIdea(nextIdea);
        setPublicationInstruction(nextPublicationInstruction);
        setTheme(nextTheme);
        setContentStyle(nextContentStyle);
        setCreationMode(nextCreationMode);
        setCreationModeError("");
        setContentWorkspaceOpen(
          nextCreationMode === "manual" ||
            Object.values(nextPostsByChannel).some((post) => {
              const normalized = normalizePost(post);
              return Boolean(
                normalized.title.trim() || normalized.content.trim(),
              );
            }),
        );
        draftChannelsRestoredRef.current = true;
        setChannels(nextChannels);
        setPostsByChannel(nextPostsByChannel);
        setInstagramHashtagsInput(nextInstagramHashtags);
        setPinterestBoardId(nextPinterestBoardId);
        setPinterestBoardName(nextPinterestBoardName);
        const effectiveMediaType = restoredVideo.file ? "video" : nextMediaType;
        setPublicationMediaType(effectiveMediaType);
        setChannelMediaModes(nextChannelMediaModes);
        setVideoFormatByChannel(nextCanonicalVideoFormatByChannel);
        setVideoAdaptationModeByChannel(
          nextCanonicalVideoAdaptationModeByChannel,
        );
        setImages(restoredFiles);
        setImagePreviews(restoredPreviews);
        setVideoFile(restoredVideo.file);
        setVideoAiContextRef(restoredVideo.file ? nextVideoAiContextRef : null);
        setVideoPreviewUrl(restoredVideo.previewUrl);
        setVideoDurationSeconds(restoredVideo.duration);
        setVideoSourceMetadata(restoredVideo.sourceMetadata || null);
        setVideoStorageContext(restoredVideo.storage);
        setVideoTransformedVariants(restoredVideo.transformedVariants);
        const selectedDraftChannels = Object.entries(nextChannels)
          .filter(([, enabled]) => enabled)
          .map(([key]) => key as ChannelKey);
        setVideoVariantPreparationByChannel(
          buildVideoPreparationStateFromVariants({
            channels: selectedDraftChannels,
            mediaModeByChannel: nextChannelMediaModes,
            variants: restoredVideo.transformedVariants,
            settingsByChannel: nextCanonicalVideoSettingsByChannel,
          }),
        );
        setUseImagesForAI(nextUseImagesForAI);
        setImageMetaByKey(restoredMeta);
        setChannelImageEditors(nextEditors);
        setLoadedPublicationDraftId(publicationDraftIdParam);
        setDraftMessage("Brouillon chargé");

        const imageNames = restoredFiles.map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
        }));
        const videoName = restoredVideo.file
          ? {
              name: restoredVideo.file.name,
              type: restoredVideo.file.type,
              size: restoredVideo.file.size,
              duration: restoredVideo.duration,
              sourceMetadata: restoredVideo.sourceMetadata || null,
            }
          : null;
        setLastPublicationDraftSnapshot(
          JSON.stringify({
            creationMode: nextCreationMode,
            mediaType: effectiveMediaType,
            channelMediaModes: nextChannelMediaModes,
            videoFormatByChannel: nextCanonicalVideoFormatByChannel,
            videoAdaptationModeByChannel:
              nextCanonicalVideoAdaptationModeByChannel,
            videoSettingsByChannel: nextCanonicalVideoSettingsByChannel,
            idea: nextIdea.trim(),
            publicationInstruction: nextPublicationInstruction.trim(),
            theme: nextTheme,
            contentStyle: nextContentStyle,
            channels: selectedDraftChannels,
            postsByChannel: nextPostsByChannel,
            instagramHashtagsInput: nextInstagramHashtags,
            pinterestBoardId: nextPinterestBoardId,
            pinterestBoardName: nextPinterestBoardName,
            imageNames,
            videoName,
            videoTransformedVariants: restoredVideo.transformedVariants,
            videoAiContextRef: nextVideoAiContextRef,
            useImagesForAI: nextUseImagesForAI,
            imageSettingsByChannel: nextEditors,
          }),
        );
        onUnsavedChange?.(false);
      } catch (error) {
        if (cancelled) return;
        setPublishError(
          getSimpleFrenchErrorMessage(
            error,
            "Impossible de charger ce brouillon publication.",
          ),
        );
        setDraftMessage("");
      }
    };

    void loadPublicationDraft();
    return () => {
      cancelled = true;
    };
  }, [
    publicationDraftIdParam,
    loadedPublicationDraftId,
    onUnsavedChange,
    legacyMediaCutoverClientAvailable,
  ]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  const hasUnsavedChanges = useMemo(
    () =>
      hasDraftablePublicationContent &&
      currentPublicationDraftSnapshot !== lastPublicationDraftSnapshot,
    [
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
      eyebrow: "Publication en cours",
      title: actionLabel,
      message:
        "Du contenu a déjà été saisi, généré ou retouché. Cette action peut supprimer votre travail en cours.",
      cancelLabel: "Continuer l’édition",
      confirmLabel: "Supprimer",
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
      ? "Vérification temporairement indisponible"
      : channelDisabled
      ? "Canal désactivé"
      : requiresReconnect
        ? "À reconnecter dans Canaux"
        : detail?.connectionStatus === "disconnected"
          ? "À connecter dans Canaux"
          : "";
    const fullLabel = statusLabel || simplifiedLabel;
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

  const onThemeChange = (next: ThemeKey) => {
    setTheme(next);
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
    setPostsByChannel({});
    setInstagramHashtagsInput("");
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
    setTheme("");
    setContentStyle("equilibre");
    setGenError("");
    setGenerationNotice("");
    setGenerationMediaWarning("");
    resetGenerationProgress();
  };

  const clearPublicationWork = () => {
    clearAiCreationWork();
    clearChannelCreationWork();
    setCreationMode(null);
    setCreationModeError("");
    setDraftMessage("");
    setLastPublicationDraftSnapshot(null);
    setContentWorkspaceOpen(false);
    setIsImageEditorOpen(false);
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
    if (typeof window === "undefined") return;
    contentWorkspaceScrollCleanupRef.current?.();
    contentWorkspaceScrollCleanupRef.current = scrollIntoViewWhenAvailable({
      getTarget: () => contentWorkspaceRef.current,
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (handle) => window.cancelAnimationFrame(handle),
      maxAttempts: 24,
      options: {
        behavior: "smooth",
        block: "start",
      },
    });
  };

  const scrollToCreationPath = () => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      creationPathRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
  };

  const onSelectCreationMode = async (nextMode: BoosterCreationMode) => {
    if (generating || saving || draftSaving || scheduleSaving) return;
    if (nextMode === creationMode) return;

    if (!selectedChannels.length) {
      setCreationModeError(
        "Sélectionnez au moins 1 canal avant de choisir votre mode de création.",
      );
      return;
    }

    if (creationMode && hasCurrentCreationModeWork) {
      const switchingFromAi = creationMode === "ai";
      const confirmed = await confirmInrcy({
        eyebrow: "Changement de mode",
        title: switchingFromAi
          ? "Passer à la création manuelle ?"
          : "Passer à la création avec iNrCy ?",
        message: switchingFromAi
          ? "Votre intention, vos consignes et les contenus générés ou modifiés seront supprimés. Vos canaux et vos médias seront conservés."
          : "Les textes saisis manuellement seront supprimés. Vos canaux et vos médias seront conservés.",
        cancelLabel: "Conserver mon travail",
        confirmLabel: "Changer de mode",
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
    setSynchronizedActiveChannel(selectedChannels[0]);

    if (nextMode === "manual") {
      scrollToContentWorkspace();
    } else {
      scrollToCreationPath();
    }
  };

  const onGenerate = async () => {
    if (generating) return;
    setGenError("");
    setImgError("");
    setGenerationNotice("");
    setGenerationMediaWarning("");

    if (creationMode !== "ai") {
      setGenError(
        "Sélectionnez « Créer avec iNrCy » avant de lancer une génération.",
      );
      return;
    }

    const trimmed = idea.trim();
    const selectedAiEngineOption = getAiEngineOption(selectedAiPreferredEngine);
    if (!selectedChannels.length) {
      setGenError("Veuillez sélectionner au moins 1 canal avant de générer.");
      return;
    }
    if (!trimmed) {
      setGenError("Écrivez une phrase (ex : chantier terminé...).");
      return;
    }

    if (hasWrittenChannelContent) {
      const confirmed = await confirmInrcy({
        eyebrow: "Contenus déjà présents",
        title: "Générer de nouveaux contenus ?",
        message:
          "Les textes déjà saisis ou générés seront remplacés par les nouveaux contenus créés par iNrCy.",
        cancelLabel: "Conserver mes textes",
        confirmLabel: "Générer et remplacer",
        variant: "warning",
      });
      if (!confirmed) return;
    }

    const videoGenerationContext = buildBoosterVideoGenerationContext({
      mediaType: videoFile || videoPreviewUrl ? "video" : "images",
      videoFile,
      duration: videoDurationSeconds,
      storage: videoStorageContext,
    });
    const hasVideoForGeneration = !!videoGenerationContext?.enabled;
    const shouldUseImagesForAI =
      !hasVideoForGeneration && images.length > 0 && useImagesForAI;
    const shouldPrepareMediaForAi = shouldPrepareBoosterMediaForAi({
      mode: creationMode,
      mediaType: hasVideoForGeneration ? "video" : "images",
      hasImages: images.length > 0,
      hasVideo: hasVideoForGeneration,
      useImagesForAI,
    });
    const shouldUsePersistentMediaWorkspaceForAi =
      shouldPrepareMediaForAi && unifiedMediaConsumptionClientAvailable;
    resetGenerationProgress();
    setGenerating(true);
    setGenerationProgressPhase(
      "initialization",
      `Préparation de la génération avec ${selectedAiEngineOption.shortLabel}`,
      6,
    );
    setDuplicateFeedback(null);

    try {
      // L'upload et l'analyse enrichissent la rédaction mais ne sont jamais un
      // verrou global. Une seule enveloppe de 12 s couvre la dernière course
      // upload + captures ; ensuite la phrase, le profil et la configuration IA
      // partent immédiatement, pendant que le média continue en arrière-plan.
      const mediaPreparationDeadlineAt =
        Date.now() + BOOSTER_VIDEO_AI_PREPARATION_GRACE_MS;
      let mediaFallbackNotice = "";
      let readyMediaWorkspaceId = shouldUsePersistentMediaWorkspaceForAi
        ? null
        : mediaWorkspaceId;

      if (shouldUsePersistentMediaWorkspaceForAi) {
        try {
          readyMediaWorkspaceId = await waitForPersistentWorkspaceReadiness(
            "generate",
            (progress) => {
              if (progress <= 24) {
                setGenerationProgressPhase(
                  "media_security",
                  progress < 12
                    ? "Ouverture de l’espace média sécurisé"
                    : "Envoi sécurisé des médias en cours",
                  mapProgressRange(progress, 6, 24, 8, 21),
                );
                return;
              }
              setGenerationProgressPhase(
                "media_analysis",
                "Préparation des médias",
                mapProgressRange(progress, 25, 42, 23, 39),
              );
            },
            hasVideoForGeneration ? ["video"] : ["image"],
            Math.max(1_000, mediaPreparationDeadlineAt - Date.now()),
          );
        } catch (workspaceError) {
          console.warn(
            "[booster-generate] media workspace unavailable, text fallback",
            workspaceError,
          );
          mediaFallbackNotice =
            "Analyse du média indisponible : contenus générés à partir de votre phrase et de votre profil.";
          setImgError("");
          setGenerationMediaWarning(mediaFallbackNotice);
          readyMediaWorkspaceId = null;
        }
        if (!readyMediaWorkspaceId && !mediaFallbackNotice) {
          mediaFallbackNotice =
            "Analyse du média indisponible : contenus générés à partir de votre phrase et de votre profil.";
          setImgError("");
          setGenerationMediaWarning(mediaFallbackNotice);
        }
      }

      let videoAiPreparationReady = false;
      if (
        hasVideoForGeneration &&
        readyMediaWorkspaceId &&
        persistentMediaWorkspaceEnabled
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          "Préparation des médias",
          34,
        );
        // La mission est dédupliquée par le hook et travaille directement
        // depuis la source Supabase : aucun second upload ni transcodage. On lui
        // laisse une courte avance, puis on continue
        // avec les captures déjà prêtes ou le contexte métadonnées/phrase.
        let graceTimeoutId: number | null = null;
        const preparation = startPersistentAiMediaPreparation()
          .then(async (result) => {
            if (result.status === "ready") return true;
            if (result.status === "failed") return false;
            // Si l'ACK indique qu'un worker possède déjà le job, on ne le
            // ré-enfile pas en boucle. On lui laisse simplement le reste de la
            // fenêtre ; le resolver relira ensuite les variantes une seule fois.
            const remainingMs = mediaPreparationDeadlineAt - Date.now();
            if (remainingMs > 0) {
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, remainingMs),
              );
            }
            return false;
          })
          .catch((error) => {
            console.warn(
              "[booster-generate] video AI preparation deferred",
              error,
            );
            return false;
          });
        videoAiPreparationReady = await Promise.race([
          preparation,
          new Promise<boolean>((resolve) => {
            graceTimeoutId = window.setTimeout(
              () => resolve(false),
              Math.max(0, mediaPreparationDeadlineAt - Date.now()),
            );
          }),
        ]);
        if (graceTimeoutId !== null) window.clearTimeout(graceTimeoutId);
      }

      if (shouldPrepareMediaForAi) {
        setGenerationProgressPhase(
          "media_analysis",
          hasVideoForGeneration
            ? videoAiPreparationReady
              ? "Vidéo et captures prêtes pour l’analyse IA"
              : "Vidéo prête · captures finalisées en arrière-plan"
            : shouldUseImagesForAI
              ? "Visuels prêts pour l’analyse IA"
              : "Média prêt pour l’analyse IA",
          39,
        );
      }

      if (shouldUseImagesForAI && !mediaPipelineCutoverEnabled) {
        setGenerationProgressPhase(
          "media_analysis",
          images.length > 1
            ? "Préparation des images pour l’analyse visuelle"
            : "Préparation de l’image pour l’analyse visuelle",
          39,
        );
      }
      const imagePreparationResults =
        shouldUseImagesForAI && !mediaPipelineCutoverEnabled
          ? await Promise.all(
              images.map((file) =>
                settleOptionalMediaEnrichment(
                  () => getOrPrepareAiImagePayload(file),
                  BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS,
                ),
              ),
            )
          : [];
      const imagesForAI = imagePreparationResults.flatMap((result) =>
        result.ok ? [result.value] : [],
      );
      if (
        shouldUseImagesForAI &&
        !mediaPipelineCutoverEnabled &&
        imagesForAI.length < images.length
      ) {
        const imagePreparationTimedOut = imagePreparationResults.some(
          (result) => !result.ok && result.reason === "timeout",
        );
        mediaFallbackNotice =
          imagePreparationTimedOut
            ? "Analyse visuelle non terminée à temps : contenus générés à partir de votre phrase, de votre profil et des visuels déjà exploitables."
            : "Analyse visuelle partiellement indisponible : contenus générés à partir de votre phrase, de votre profil et des visuels exploitables.";
      }
      let videoFramesForAI: VideoFramesForAI = [];
      const videoAudioTranscript = "";
      const videoRawAudioTranscript = "";
      let videoAudioTranscriptStatus: "pending" | "ready" | "unavailable" =
        "pending";
      if (
        hasVideoForGeneration &&
        videoFile &&
        !videoAiContextRef
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          "Analyse audio et visuelle de la vidéo",
          39,
        );

        // La transcription audio est un bonus et ne doit jamais retenir le clic
        // Générer. Les trois captures locales partent immédiatement ; le serveur
        // peut encore exploiter une piste audio déjà prête dans le workspace,
        // avec son propre budget court et partagé.
        const framesResult = await settleOptionalMediaEnrichment(
          () => getOrPrepareVideoFramesForAI(videoFile),
          BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS,
        );
        videoFramesForAI = framesResult.ok ? framesResult.value : [];
        videoAudioTranscriptStatus = "unavailable";
        if (!videoFramesForAI.length) {
          mediaFallbackNotice =
            !framesResult.ok && framesResult.reason === "timeout"
              ? "Captures vidéo non terminées à temps : contenus générés à partir de votre phrase et de votre profil."
              : "Analyse visuelle indisponible : contenus générés à partir de votre phrase et de votre profil.";
        }

        setGenerationProgressPhase(
          "media_analysis",
          videoFramesForAI.length > 0 && videoAudioTranscript
            ? "Analyse audio + images de la vidéo"
            : videoFramesForAI.length > 0
              ? "Analyse des images de la vidéo"
              : videoAudioTranscript
                ? "Analyse audio de la vidéo"
                : "Analyse vidéo limitée, génération maintenue",
          39,
        );
      } else if (
        hasVideoForGeneration &&
        videoAiContextRef
      ) {
        setGenerationProgressPhase(
          "media_analysis",
          "Réutilisation de l’analyse vidéo iNrAgent",
          39,
        );
      }

      setGenerationProgressPhase(
        "request_understanding",
        publicationInstruction.trim()
          ? "Analyse de votre intention et de vos consignes"
          : "Analyse de votre intention de publication",
        47,
      );

      // Un workspace vide sert aussi de reçu durable pour une génération sans
      // média. Sa création reste un filet de sécurité best effort : si elle
      // échoue, le moteur IA normal continue exactement comme auparavant.
      let generationWorkspaceId = unifiedMediaConsumptionClientAvailable
        ? readyMediaWorkspaceId || mediaWorkspaceId || undefined
        : undefined;
      if (unifiedMediaConsumptionClientAvailable && !generationWorkspaceId) {
        try {
          const recoveryWorkspace = await ensurePersistentMediaWorkspace();
          generationWorkspaceId = recoveryWorkspace?.workspaceId || undefined;
        } catch (workspaceError) {
          console.warn(
            "[booster-generate] recovery receipt workspace unavailable",
            workspaceError,
          );
        }
      }

      // Uploading and verifying the workspace is media preparation, not AI
      // generation. Start the generation safety window only once the request is
      // ready to leave; otherwise a slow batch of images can consume the whole
      // deadline before the AI is even called.
      const generationDeadlineAt =
        Date.now() + BOOSTER_GENERATION_SAFETY_BUDGET_MS;
      const generationRequestId = createBoosterGenerationRequestId();
      const generationPayload = {
        creationMode: "ai" as const,
        generationRequestId,
        generationDeadlineAt,
        mediaWorkspaceId: generationWorkspaceId,
        mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
        useWorkspaceMediaForAI:
          unifiedMediaConsumptionClientAvailable &&
          Boolean(readyMediaWorkspaceId) &&
          shouldUsePersistentMediaWorkspaceForAi,
        mediaWorkspaceExpected:
          shouldUsePersistentMediaWorkspaceForAi &&
          Boolean(readyMediaWorkspaceId),
        idea: trimmed,
        publicationInstruction: publicationInstruction.trim(),
        theme,
        style: contentStyle,
        aiPreferredEngine: selectedAiPreferredEngine,
        channels: selectedForGeneration,
        mediaType: hasVideoForGeneration ? "video" : "images",
        useImagesForAI: shouldUseImagesForAI,
        imageCount: mediaPipelineCutoverEnabled ? 0 : imagesForAI.length,
        imagesForAI: mediaPipelineCutoverEnabled ? [] : imagesForAI,
        videoForAI:
          hasVideoForGeneration &&
          videoGenerationContext
            ? {
                ...videoGenerationContext,
                contextRef: videoAiContextRef,
                visualFrames: videoFramesForAI,
                audioTranscript: videoAudioTranscript,
                rawAudioTranscript: videoRawAudioTranscript,
                analysisPlan: {
                  ...videoGenerationContext.analysisPlan,
                  visualFrames:
                    videoFramesForAI.length > 0 ? "ready" : "pending",
                  audioTranscript: videoAudioTranscriptStatus,
                },
              }
            : null,
      };
      const executeGenerationRequest = async (engine: AiPreferredEngine) => {
        const request = buildBoosterGenerationRequest({
          ...generationPayload,
          aiPreferredEngine: engine,
        });
        const remainingMs = generationDeadlineAt - Date.now();
        if (remainingMs <= 1_000) {
          throw new Error(
            "La génération a dépassé le délai de sécurité. Merci de relancer.",
          );
        }
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          remainingMs,
        );
        try {
          const response = await fetch("/api/booster/generate", {
            method: "POST",
            ...(request.headers ? { headers: request.headers } : {}),
            body: request.body,
            signal: controller.signal,
          });
          const responseJson = await response.json().catch(() => ({}));
          return { response, responseJson };
        } catch (error) {
          if (controller.signal.aborted) {
            throw new Error(
              "La génération a dépassé le délai de sécurité. Merci de relancer.",
            );
          }
          throw error;
        } finally {
          window.clearTimeout(timeoutId);
        }
      };
      let generationRecoveredAfterTransportLoss = false;
      const executeGenerationRequestWithRecovery = async (
        engine: AiPreferredEngine,
      ) => {
        try {
          return await executeGenerationRequest(engine);
        } catch (requestError) {
          if (
            !generationWorkspaceId ||
            !isBoosterGenerationTransportLoss(requestError)
          ) {
            throw requestError;
          }

          clearGenerationTimers();
          setGenerationProgressPhase(
            "final_wait",
            "Connexion interrompue · récupération du résultat enregistré",
            99,
          );
          const recovery = await recoverBoosterGenerationResult({
            workspaceId: generationWorkspaceId,
            requestId: generationRequestId,
            maxWaitMs: Math.max(
              20_000,
              Math.min(70_000, generationDeadlineAt - Date.now() + 8_000),
            ),
          });
          const recovered = recovery.status === "ready";
          reportBoosterGenerationResponseLoss({
            error: requestError,
            recovered,
            attempts: recovery.attempts,
            elapsedMs: recovery.elapsedMs,
            channelCount: selectedForGeneration.length,
            mediaType: hasVideoForGeneration ? "video" : "images",
            engine,
          });

          if (!recovered) {
            throw new Error(
              "La connexion a été interrompue avant la réception du résultat. Aucun nouvel appel IA n’a été lancé. Vérifiez votre connexion puis réessayez.",
            );
          }

          generationRecoveredAfterTransportLoss = true;
          return {
            response: null,
            responseJson: recovery.payload,
          };
        }
      };

      setGenerationProgressPhase(
        "ai_writing",
        hasVideoForGeneration
          ? `Rédaction avec ${selectedAiEngineOption.shortLabel} à partir de votre vidéo`
          : `Rédaction avec ${selectedAiEngineOption.shortLabel}`,
        67,
      );
      let generationRequestVisualPhase:
        | "ai_writing"
        | "channel_adaptation"
        | "quality_control"
        | "final_wait" = "ai_writing";
      let lastGenerationRequestVisualChangeAt = Date.now();
      clearGenerationTimers();
      generationRequestPhaseTimerRef.current = window.setInterval(() => {
        if (Date.now() - lastGenerationRequestVisualChangeAt < 2_800) return;
        lastGenerationRequestVisualChangeAt = Date.now();
        if (generationRequestVisualPhase === "ai_writing") {
          generationRequestVisualPhase = "channel_adaptation";
          setGenerationProgressPhase(
            "channel_adaptation",
            `Adaptation des contenus pour ${selectedForGeneration.length} ${selectedForGeneration.length > 1 ? "canaux" : "canal"}`,
            81,
          );
          return;
        }
        if (generationRequestVisualPhase === "channel_adaptation") {
          generationRequestVisualPhase = "quality_control";
          setGenerationProgressPhase(
            "quality_control",
            "Vérification de la cohérence et de la mise en forme",
            91,
          );
          return;
        }
        if (generationRequestVisualPhase === "quality_control") {
          generationRequestVisualPhase = "final_wait";
          setGenerationProgressPhase(
            "final_wait",
            "Encore quelques secondes… Finalisation de votre contenu",
            99,
          );
          clearGenerationTimers();
        }
      }, 500);

      let { response: res, responseJson: json } =
        await executeGenerationRequestWithRecovery(selectedAiPreferredEngine);
      clearGenerationTimers();
      let automaticRetry:
        | { primaryEngine: AiPreferredEngine; finalEngine: AiPreferredEngine }
        | null = null;

      if (
        res &&
        !res.ok &&
        isAutomaticBoosterGenerationRetryEligible(res.status, json)
      ) {
        const retryEngine = getAutomaticAiRetryEngine(
          selectedAiPreferredEngine,
        );
        const primaryLabel = getAiEngineOption(
          selectedAiPreferredEngine,
        ).shortLabel;
        const retryLabel = getAiEngineOption(retryEngine).shortLabel;

        automaticRetry = {
          primaryEngine: selectedAiPreferredEngine,
          finalEngine: retryEngine,
        };
        setGenerationProgressPhase(
          "quality_control",
          `${primaryLabel} n'a pas répondu, secours automatique avec ${retryLabel}`,
          91,
        );

        ({ response: res, responseJson: json } =
          await executeGenerationRequestWithRecovery(retryEngine));
      }

      if (res && !res.ok) {
        const specialMessage = getBoosterGenerationSpecialErrorMessage({
          status: res.status,
          payload: json,
          retryAfterHeader: res.headers.get("Retry-After"),
        });
        setGenError(
          specialMessage ||
            getSimpleFrenchErrorMessage(
              json?.user_message || json?.error,
              "La génération n'a pas pu aboutir. Merci de réessayer.",
            ),
        );
        return;
      }

      if (generationPhaseIndexRef.current < 9) {
        setGenerationProgressPhase(
          "editor_preparation",
          "Installation des contenus dans l’éditeur",
          95,
        );
      }
      const versions = json?.versions || {};
      setPostsByChannel(sanitizePostsForEditor(versions));
      setContentWorkspaceOpen(true);
      if (selectedForGeneration.length) {
        setSynchronizedActiveChannel(selectedForGeneration[0]);
      }
      scrollToContentWorkspace();
      const mediaAnalysisFallback = json?.mediaAnalysisFallback;
      const serverMediaFallbackNotice = String(
        mediaAnalysisFallback?.message || "",
      )
        .trim()
        .slice(0, 320);
      setGenerationMediaWarning(
        serverMediaFallbackNotice || mediaFallbackNotice,
      );
      const aiFallback = json?.aiFallback;
      if (generationRecoveredAfterTransportLoss) {
        setGenerationNotice(
          "La connexion a été interrompue, mais iNrCy a récupéré automatiquement les contenus déjà générés, sans second appel IA.",
        );
      } else if (aiFallback?.used) {
        const primaryLabel = String(
          aiFallback.primaryEngineLabel || "Le moteur sélectionné",
        ).trim();
        const finalLabel = String(
          aiFallback.finalEngineLabel || "ChatGPT",
        ).trim();
        const transportLabel =
          aiFallback.transport === "openai_direct"
            ? "via la connexion OpenAI de secours"
            : "via le moteur de secours";
        setGenerationNotice(
          `${primaryLabel} était temporairement indisponible. Le contenu a été généré avec ${finalLabel} ${transportLabel}.`,
        );
      } else if (automaticRetry) {
        const primaryLabel = getAiEngineOption(
          automaticRetry.primaryEngine,
        ).shortLabel;
        const finalLabel = getAiEngineOption(
          automaticRetry.finalEngine,
        ).shortLabel;
        setGenerationNotice(
          `${primaryLabel} n'a pas répondu au premier essai. iNrCy a automatiquement terminé la génération avec ${finalLabel}, sans modifier votre moteur par défaut.`,
        );
      }
      setGenerationProgressPhase(
        "final_wait",
        "Encore quelques secondes… Finalisation de votre contenu",
        99,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 540));
      completeGenerationProgress("Les contenus sont prêts à être relus");
      await new Promise((resolve) => window.setTimeout(resolve, 320));
    } catch (error) {
      // Toute analyse média optionnelle a déjà été isolée ci-dessus. Une
      // erreur rouge correspond donc uniquement à l'échec de la génération.
      const fallback =
        "La génération n'a pas pu aboutir pour le moment. Merci de réessayer.";
      setGenError(
        getSimpleFrenchErrorMessage(
          error instanceof Error ? error.message : error,
          fallback,
        ),
      );
    } finally {
      clearGenerationTimers();
      setGenerating(false);
      resetGenerationProgress();
    }
  };

  const onDuplicateContentToAllChannels = async () => {
    const source = getDisplayPost(activeCard);
    const hasSourceContent = Boolean(
      String(source.title || "").trim() || String(source.content || "").trim(),
    );

    if (!hasSourceContent) {
      setDuplicateFeedback({
        kind: "error",
        message: "Ajoutez au moins un titre ou un contenu avant de dupliquer.",
      });
      return;
    }

    if (displayCards.length < 2) {
      setDuplicateFeedback({
        kind: "error",
        message: "Sélectionnez au moins 2 canaux pour utiliser la duplication.",
      });
      return;
    }

    const confirmed = await confirmInrcy({
      title: "Dupliquer le contenu ?",
      message: "Le titre et le contenu des autres canaux seront remplacés.",
      confirmLabel: "Dupliquer",
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
      message: "Titre et contenu dupliqués sur tous les canaux affichés.",
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

  const onPickVideoForChannel = (channel: ChannelKey) => {
    pendingDirectMediaDestinationRef.current = { kind: "channel", channel };
    videoPickerTargetChannelRef.current = channel;
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
      setImgError(`Ajoutez une vidéo valide : ${BOOSTER_VIDEO_FORMATS_LABEL}.`);
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
      setImgError(`Ajoutez une vidéo valide : ${BOOSTER_VIDEO_FORMATS_LABEL}.`);
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Impossible de lire ${item.title || item.storage_path}.`);
    }
    const blob = await response.blob();
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
        `${selectedImages.length} image(s) ajoutée(s). Maximum ${BOOSTER_MAX_IMAGE_COUNT} images par publication.`,
      );
    }
    return true;
  };

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
      setImgError(`Maximum ${BOOSTER_MAX_IMAGE_COUNT} images.`);
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
      const structuredSafePost = sanitizeBoosterPostForStructuredCta(
        prepared[key],
        {
          websiteUrl: getWebsiteUrlForChannel(key, ctaDefaults),
          phone: ctaDefaults?.phone || "",
        },
      );
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
        if (post) acc[channel] = post;
        return acc;
      },
      {} as Partial<Record<ChannelKey, ChannelPost>>,
    );
  };

  const getPreparedDisplayPost = (
    key: DisplayKey,
    preparedPosts: Partial<Record<ChannelKey, ChannelPost>>,
  ): ChannelPost => {
    return normalizePost(preparedPosts[key]);
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
      channelLabel: getImageAdapterLabel(channel),
      mediaType: "video" as const,
      title: post.title,
      content: post.content,
      cta: getPreviewCtaForDisplayKey(displayKey, post),
      hashtags:
        displayKey === "instagram"
          ? getLiveInstagramHashtags()
          : post.hashtags || [],
      imageCount: 0,
      formatLabel: `Vidéo ${getVideoFormatLabel(channel, selectedVideoFormat, videoSourceMetadata)} · ${VIDEO_ADAPTATION_MODE_LABELS[selectedVideoAdaptation]}${preparedPreviewUrl ? " · Aperçu final" : ""}`,
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
      channelLabel: getImageAdapterLabel(channel),
      title: post.title,
      content: post.content,
      cta: getPreviewCtaForDisplayKey(displayKey, post),
      hashtags:
        displayKey === "instagram"
          ? getLiveInstagramHashtags()
          : post.hashtags || [],
      imageCount: selectedKeys.length,
      formatLabel:
        channel === "inrcy_site" || channel === "site_web" || channel === "inr_search"
          ? "Rendu site / iframe"
          : channel === "tiktok"
            ? `Image verticale TikTok : ${CHANNEL_PRESETS[channel].width}×${CHANNEL_PRESETS[channel].height}`
            : `Image finale : ${CHANNEL_PRESETS[channel].width}×${CHANNEL_PRESETS[channel].height}`,
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
    : selectedChannels[0] || "inrcy_site";

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
        channelLabel: getImageAdapterLabel(activePreviewChannel),
        mediaType: "images" as const,
        title: post.title,
        content: post.content,
        cta: getPreviewCtaForDisplayKey(displayKey, post),
        hashtags:
          displayKey === "instagram"
            ? getLiveInstagramHashtags()
            : post.hashtags || [],
        imageCount: 0,
        formatLabel: "Texte seul",
        image: null,
        images: [],
        video: null,
      };
    }
    return null;
  })();

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

  const runPublish = async (options?: {
    skipEmptyContentWarnings?: boolean;
    preparedPostsByChannel?: Partial<Record<ChannelKey, ChannelPost>>;
    tiktokPublicationSettings?: TiktokPublicationSettings | null;
    channels?: ChannelKey[];
    closeOnSuccess?: boolean;
    suppressPublishSuccess?: boolean;
    throwOnError?: boolean;
  }) => {
    if (saving || draftSaving || publishStartGuardRef.current) return;
    const publishStartedAt = Date.now();
    const preparedPostsByChannel =
      options?.preparedPostsByChannel || buildPreparedPostsByChannel();
    const publishTargetChannels = Array.from(
      new Set(
        options?.channels !== undefined ? options.channels : selectedChannels,
      ),
    ).filter((channel): channel is ChannelKey => Boolean(channel));

    setPublishError("");
    setDraftMessage("");
    setImgError("");
    setPublishProgress(0);
    setPublishProgressLabel("");
    resetPublicationProgressPhases();
    scrollToPublishArea("smooth");

    if (!publishTargetChannels.length) {
      setPublishError("Sélectionnez au moins 1 canal.");
      return;
    }

    publishStartGuardRef.current = true;
    phasedPublicationProgressRef.current = true;
    setSaving(true);
    setPublicationProgressPhase(
      "verification",
      "Demande prise en charge",
      5,
    );
    let publishDispatchStarted = false;
    let publicationFinalWaitTimeoutId: number | null = null;

    try {
      setPublicationProgressPhase(
        "channel_verification",
        "Vérification des canaux sélectionnés",
        11,
      );
      const requestedWorkspaceMediaTypes = [
        ...(publishTargetChannels.some(
          (channel) => resolveChannelMediaMode(channel) === "images",
        )
          ? (["image"] as const)
          : []),
        ...(publishTargetChannels.some(
          (channel) => resolveChannelMediaMode(channel) === "video",
        )
          ? (["video"] as const)
          : []),
      ];
      const settledWorkspaceStates = persistentMediaWorkspaceEnabled
        ? await waitForPersistentWorkspaceIdle(
            (progress, label) => {
              setPublicationProgressPhase(
                "media_verification",
                label || "Vérification des médias",
                mapProgressRange(progress, 0, 100, 13, 21),
              );
            },
            {
              mediaTypes: requestedWorkspaceMediaTypes,
              tolerateFailures: true,
            },
          )
        : undefined;
      const reviewItems = buildFinalReviewItems(
        preparedPostsByChannel,
        publishTargetChannels,
        settledWorkspaceStates,
      );
      setPublicationProgressPhase(
        "media_verification",
        "Canaux et médias vérifiés",
        21,
      );
    const preflightFailedChannels = reviewItems
      .filter((item) => item.blockers.length > 0)
      .map((item) => ({
        channel: item.channel,
        label: item.label,
        blockers: item.blockers,
        code: item.blockerCodes?.[0] || "prepublish_validation_failed",
      }));

    const publishableChannels = reviewItems
      .filter((item) => item.blockers.length === 0)
      .map((item) => item.channel);

    if (!publishableChannels.length) {
      setPublishError(
        "Aucun canal n’est prêt. Corrigez au moins un canal rouge dans le bloc Médias avant de publier.",
      );
      return;
    }

    const clientPreflightFailuresByChannel = Object.fromEntries(
      preflightFailedChannels.map((failure) => [
        failure.channel,
        {
          code: String(failure.code || "prepublish_validation_failed").slice(
            0,
            100,
          ),
          error: String(
            failure.blockers?.[0] || "Ce canal n'est pas prêt à publier.",
          ).slice(0, 600),
          retryable: false,
        },
      ]),
    );
    const publishTargetMediaModeByChannel = Object.fromEntries(
      publishTargetChannels.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const publishMediaModeByChannel = Object.fromEntries(
      publishableChannels.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const hasAnyVideoPublish = publishableChannels.some(
      (channel) => publishMediaModeByChannel[channel] === "video",
    );
    const hasAnyImagePublish = publishableChannels.some(
      (channel) => publishMediaModeByChannel[channel] === "images",
    );
    const pendingMediaPreparationLabel = "Préparation des médias";
    const requiredPublishMediaTypes = [
      ...(hasAnyImagePublish ? (["image"] as const) : []),
      ...(hasAnyVideoPublish ? (["video"] as const) : []),
    ];
    const publishWorkspaceReadinessTimeoutMs =
      MEDIA_WORKSPACE_READINESS_TIMEOUT_MS;
    // Les deux familles coexistent dans le workspace. Leur présence réelle,
    // et non le dernier onglet média activé, décide si un fallback est requis.
    const workspaceCarriesImagesForPublish =
      mediaPipelineCutoverEnabled && images.length > 0;
    const workspaceCarriesVideoForPublish =
      mediaPipelineCutoverEnabled && Boolean(videoFile);
    const shouldBuildImageFallbackPayload =
      hasAnyImagePublish && !workspaceCarriesImagesForPublish;
    const shouldBuildVideoFallbackPayload =
      hasAnyVideoPublish && !workspaceCarriesVideoForPublish;
    const publishTargetVideoSettingsByChannel = Object.fromEntries(
      publishTargetChannels.map((channel) => [
        channel,
        getAutomaticVideoSettingsForPublication({
          channel,
          settings: videoSettingsByChannel[channel],
          durationSeconds:
            videoDurationSeconds ?? videoSourceMetadata?.duration ?? null,
        }),
      ]),
    ) as Partial<
      Record<
        ChannelKey,
        { format: VideoFormat; adaptationMode: VideoAdaptationMode }
      >
    >;
    const publishVideoSettingsByChannel = buildChannelRecord(
      publishTargetVideoSettingsByChannel,
      publishableChannels,
    );
    const mediaFinalizationExpected =
      persistentMediaSynchronizing ||
      shouldBuildImageFallbackPayload ||
      shouldBuildVideoFallbackPayload ||
      Object.values(persistentMediaStates).some(
        (media) =>
          media.status === "queued" || media.status === "uploading",
      ) ||
      publishableChannels.some(
        (channel) =>
          publishMediaModeByChannel[channel] === "video" &&
          publishVideoSettingsByChannel[channel]?.format !== "original" &&
          videoVariantPreparationByChannel[channel]?.status !== "ready",
      );
    const visiblePublicationCapMs = mediaFinalizationExpected
      ? BOOSTER_PUBLISH_WITH_MEDIA_FINALIZATION_VISIBLE_CAP_MS
      : BOOSTER_PUBLISH_VISIBLE_CAP_MS;

    if (hasAnyVideoPublish && !videoFile) {
      setImgError(
        "Ajoutez une vidéo avant de publier ou choisissez Photos / Aucun média par canal.",
      );
      return;
    }

    const missingContentChannels = publishableChannels.filter(
      (ch) => !String(preparedPostsByChannel[ch]?.content || "").trim(),
    );
    if (missingContentChannels.length && !options?.skipEmptyContentWarnings) {
      setPostsByChannel(preparedPostsByChannel);
      setPendingPublishPosts(preparedPostsByChannel);
      setEmptyContentWarningChannels(missingContentChannels);
      setEmptyContentWarningIndex(0);
      return;
    }

    closeEmptyContentWarnings();
    setPendingPublishPosts(null);
    setPostsByChannel(preparedPostsByChannel);

    if (publishableChannels.includes("instagram")) {
      const instagramMode = publishMediaModeByChannel.instagram || "none";
      const instagramImages = channelImageEditors.instagram?.imageKeys || [];
      if (instagramMode === "none") {
        setImgError("Instagram nécessite une vidéo ou au moins 1 image.");
        return;
      }
      if (instagramMode === "images" && !instagramImages.length) {
        setImgError(
          "Veuillez ajouter au moins 1 image pour publier sur Instagram.",
        );
        return;
      }
      if (instagramMode === "video" && !videoFile) {
        setImgError("Veuillez ajouter une vidéo pour publier sur Instagram.");
        return;
      }
    }

    if (publishableChannels.includes("pinterest")) {
      if (!pinterestBoardId) {
        setPublishError("Choisissez un tableau Pinterest avant de publier.");
        return;
      }
      const pinterestMode = publishMediaModeByChannel.pinterest || "none";
      const pinterestImages = channelImageEditors.pinterest?.imageKeys || [];
      if (pinterestMode === "none") {
        setImgError("Pinterest nécessite une image ou une vidéo.");
        return;
      }
      if (pinterestMode === "images" && !pinterestImages.length) {
        setImgError(
          "Veuillez ajouter au moins 1 image pour publier sur Pinterest.",
        );
        return;
      }
      if (pinterestMode === "video" && !videoFile) {
        setImgError("Veuillez ajouter une vidéo pour publier sur Pinterest.");
        return;
      }
    }

    const preflightFailureChannels = new Set(
      preflightFailedChannels.map((failure) => failure.channel),
    );
    let dispatchPreparationShown = false;
    let publicationDispatchShown = false;
    let mediaPreparationProgressUpdates = 0;
    const videoChannelsUseOriginal = publishableChannels
      .filter((channel) => publishMediaModeByChannel[channel] === "video")
      .every(
        (channel) =>
          (publishVideoSettingsByChannel[channel]?.format || "original") ===
          "original",
      );
    const armPublicationFinalWait = () => {
      if (publicationFinalWaitTimeoutId !== null) return;
      publicationFinalWaitTimeoutId = window.setTimeout(() => {
        publicationFinalWaitTimeoutId = null;
        setPublicationProgressPhase(
          "final_wait",
          "Encore quelques secondes… Finalisation de la publication",
          99,
        );
      }, 8_000);
    };

    const onPublicationProgress = (update: BoosterPublishProgressUpdate) => {
      const payload =
        update.payload && typeof update.payload === "object"
          ? update.payload
          : {};
      const summary =
        payload.summary && typeof payload.summary === "object"
          ? (payload.summary as Record<string, any>)
          : {};
      const mediaPreparation =
        payload.mediaPreparation && typeof payload.mediaPreparation === "object"
          ? (payload.mediaPreparation as Record<string, any>)
          : null;
      const mediaPreparationProgress = mediaPreparation
        ? Math.min(
            100,
            Math.max(0, Number(mediaPreparation.progress || 0)),
          )
        : null;
      const mediaPreparationLabelProgress = mediaPreparationProgress;
      const entries = Array.isArray(summary.entries)
        ? (summary.entries.filter(
            (entry): entry is Record<string, any> =>
              Boolean(entry && typeof entry === "object"),
          ) as Record<string, any>[])
        : [];
      const terminalChannels = new Set<string>(preflightFailureChannels);
      let preparingCount = 0;
      entries.forEach((entry) => {
        const channel = String(entry.channel || "");
        const status = String(
          entry.technicalStatus || entry.status || "",
        ).toLowerCase();
        const terminal =
          typeof entry.ok === "boolean" ||
          [
            "failed",
            "error",
            "published",
            "published_with_warning",
            "completed",
            "success",
            "succeeded",
          ].includes(status);
        if (terminal) terminalChannels.add(channel);
        if (status === "preparing") preparingCount += 1;
      });

      const totalCount = Math.max(1, publishTargetChannels.length);
      const terminalCount = Math.min(totalCount, terminalChannels.size);
      const mediaPreparationInProgress =
        preparingCount > 0 ||
        String(payload.status || "").toLowerCase() === "preparing" ||
        (mediaPreparationProgress !== null && mediaPreparationProgress < 100);
      if (mediaPreparationInProgress) {
        mediaPreparationProgressUpdates += 1;
        const progress = mediaPreparationProgress ?? 0;
        const preparationLabel =
          hasAnyVideoPublish &&
          videoChannelsUseOriginal &&
          mediaPreparationProgressUpdates === 1
            ? "Vérification de la vidéo"
            : "Préparation des médias";
        const label = `${preparationLabel}${
          mediaPreparationLabelProgress === null
            ? ""
            : ` · ${Math.round(mediaPreparationLabelProgress)} %`
        }`;
        setPublicationProgressPhase(
          "media_preparation",
          label,
          mapProgressRange(progress, 0, 100, 23, 39),
        );
        return;
      }
      if (update.stage === "request_accepted") {
        setPublicationProgressPhase(
          "file_preparation",
          "Préparation des envois",
          49,
        );
        dispatchPreparationShown = true;
        return;
      }
      if (update.stage === "released_to_background") {
        setPublicationProgressPhase(
          "status_collection",
          `${Math.max(0, totalCount - terminalCount)} ${totalCount - terminalCount > 1 ? "canaux finalisent" : "canal finalise"} · Confirmation des plateformes`,
          93,
        );
        return;
      }
      if (update.stage === "completed") {
        setPublicationProgressPhase(
          "inrsend_recording",
          "Enregistrement dans iNr’Send",
          96,
        );
        return;
      }
      if (terminalCount >= totalCount) {
        setPublicationProgressPhase(
          "status_collection",
          `Confirmation des plateformes · ${totalCount}/${totalCount}`,
          93,
        );
      } else if (terminalCount > 0) {
        if (!dispatchPreparationShown) {
          setPublicationProgressPhase(
            "file_preparation",
            "Préparation des envois",
            49,
          );
          dispatchPreparationShown = true;
          return;
        }
        armPublicationFinalWait();
        const nextChannel = publishTargetChannels.find(
          (channel) => !terminalChannels.has(channel),
        );
        const nextChannelLabel = nextChannel
          ? CHANNEL_LABELS[nextChannel] || nextChannel
          : "le prochain canal";
        setPublicationProgressPhase(
          "publication_finalization",
          `${Math.min(totalCount, terminalCount + 1)}/${totalCount} · Publication sur ${nextChannelLabel}`,
          mapProgressRange(terminalCount, 0, totalCount, 67, 81),
        );
        publicationDispatchShown = true;
      } else {
        if (!dispatchPreparationShown) {
          setPublicationProgressPhase(
            "file_preparation",
            "Préparation des envois",
            49,
          );
          dispatchPreparationShown = true;
          return;
        }
        armPublicationFinalWait();
        const firstChannel = publishTargetChannels[0];
        const firstChannelLabel = firstChannel
          ? CHANNEL_LABELS[firstChannel] || firstChannel
          : "le canal sélectionné";
        setPublicationProgressPhase(
          "channel_dispatch",
          `1/${totalCount} · Publication sur ${firstChannelLabel}`,
          mapProgressRange(update.pollAttempt, 0, 12, 51, 65),
        );
        publicationDispatchShown = true;
      }
    };

      const readyMediaWorkspaceId =
        await waitForPersistentWorkspaceReadiness(
          "publish",
          (progress) => {
            setPublicationProgressPhase(
              "media_preparation",
              progress > 24
                ? pendingMediaPreparationLabel
                : "Vérification et préparation des médias",
              progress <= 24
                ? mapProgressRange(progress, 6, 24, 23, 34)
                : 35,
            );
          },
          requiredPublishMediaTypes,
          publishWorkspaceReadinessTimeoutMs,
        );

      setPublicationProgressPhase(
        "media_preparation",
        pendingMediaPreparationLabel,
        37,
      );

      // Les formats originaux sont déjà validés dans le bloc Médias. Une
      // adaptation explicite doit, elle, être prête avant d'arriver ici.
      setPublicationProgressPhase(
        "media_preparation",
        pendingMediaPreparationLabel,
        38,
      );

      const emptyChannelImages = {} as ChannelImagePayload;
      const emptyChannelSettings = {} as ChannelImageSettingsPayload;
      const { channelImages, channelSettings } = !hasAnyImagePublish
        ? {
            channelImages: emptyChannelImages,
            channelSettings: emptyChannelSettings,
          }
        : workspaceCarriesImagesForPublish
          ? {
              channelImages: emptyChannelImages,
              channelSettings: buildChannelImageSettingsPayload(),
            }
          : await buildChannelImagesPayload((current, total) => {
            if (!total) {
              setPublicationProgressPhase(
                "media_preparation",
                "Préparation des médias",
                38,
              );
              return;
            }
            const ratio = current / total;
            setPublicationProgressPhase(
              "media_preparation",
              `Préparation des médias · ${clampPercent(ratio * 100)} %`,
              mapProgressRange(ratio, 0, 1, 35, 38),
            );
          });

      const originalImageByKey: Record<string, ImagePayload> =
        !shouldBuildImageFallbackPayload
          ? {}
          : await (async () => {
              setPublicationProgressPhase(
                "media_preparation",
                "Préparation des médias",
                38,
              );
              return await uploadOriginalImagesForPublication(
                (current, total) => {
                  if (!total) return;
                  const ratio = current / total;
                  setPublicationProgressPhase(
                    "media_preparation",
                    `Préparation des médias · ${clampPercent(ratio * 100)} %`,
                    mapProgressRange(ratio, 0, 1, 36, 39),
                  );
                },
              );
            })();

      if (hasAnyImagePublish) {
        setPublicationProgressPhase(
          "media_preparation",
          "Préparation des médias",
          39,
        );
      }

      const uploadedChannelImages = {} as ChannelImagePayload;
      const uploadTargets = !hasAnyImagePublish
        ? 0
        : publishableChannels.reduce(
            (sum, channel) =>
              sum +
              (channelImages[channel] || []).filter((image) => !!image?.dataUrl)
                .length,
            0,
          );
      let uploadedCount = 0;
      if (shouldBuildImageFallbackPayload) {
        await Promise.all(
          publishableChannels.map(async (channel) => {
            if (publishMediaModeByChannel[channel] !== "images") return;
            const uploadedImages = await uploadPreparedImages(
              channelImages[channel] || [],
              (current, total) => {
                if (!total) return;
                uploadedCount += 1;
                const ratio = uploadTargets ? uploadedCount / uploadTargets : 1;
                setPublicationProgressPhase(
                  "media_preparation",
                  `Préparation des médias · ${clampPercent(ratio * 100)} %`,
                  mapProgressRange(ratio, 0, 1, 37, 39),
                );
              },
            );
            const imageKeysForChannel =
              channelSettings[channel]?.imageKeys || [];
            uploadedChannelImages[channel] = uploadedImages.map(
              (image, index) => {
                const imageKey = imageKeysForChannel[index] || "";
                const original = imageKey
                  ? originalImageByKey[imageKey]
                  : undefined;
                const originalUrl = String(
                  original?.publicUrl ||
                    original?.originalPublicUrl ||
                    original?.originalUrl ||
                    "",
                ).trim();
                return {
                  ...image,
                  renderedUrl: image.publicUrl || image.renderedUrl || "",
                  imageKey,
                  originalUrl,
                  originalPublicUrl: originalUrl,
                  originalStoragePath:
                    original?.storagePath || original?.originalStoragePath || "",
                  originalName: original?.name || image.name,
                  originalType: original?.type || image.type,
                  transform: imageKey
                    ? channelSettings[channel]?.transforms?.[imageKey]
                    : undefined,
                  imageMeta: imageKey ? imageMetaByKey[imageKey] : undefined,
                };
              },
            );
          }),
        );
      }

      let publicationVideo: any = null;
      if (shouldBuildVideoFallbackPayload) {
        setPublicationProgressPhase(
          "media_preparation",
          "Préparation des médias",
          39,
        );
        publicationVideo = await uploadPublicationVideoForPublish();
        if (!publicationVideo?.publicUrl && !publicationVideo?.url) {
          throw new Error(
            "La vidéo n’a pas pu être préparée pour la publication.",
          );
        }
        publicationVideo = await preparePublicationVideoVariants(
          publicationVideo,
          publishableChannels,
          publishMediaModeByChannel,
          { settingsByChannel: publishVideoSettingsByChannel },
        );
      }

      publishDispatchStarted = true;
      const result = await trackEvent("publish", {
        _onPublicationProgress: onPublicationProgress,
        _clientVisibleWaitMs: Math.max(
          0,
          visiblePublicationCapMs - (Date.now() - publishStartedAt),
        ),
        creationMode,
        mediaWorkspaceId:
          unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
            ? readyMediaWorkspaceId
            : undefined,
        mediaWorkspaceClientKey:
          unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
            ? mediaWorkspaceClientKey
            : undefined,
        mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
        mediaType: hasAnyVideoPublish ? "video" : "images",
        mediaModeByChannel: buildChannelRecord(
          publishTargetMediaModeByChannel,
          publishTargetChannels,
        ),
        videoFormatByChannel: buildChannelRecord(
          videoFormatByChannel,
          publishTargetChannels,
        ),
        videoAdaptationModeByChannel: buildChannelRecord(
          videoAdaptationModeByChannel,
          publishTargetChannels,
        ),
        videoSettingsByChannel: buildChannelRecord(
          publishTargetVideoSettingsByChannel,
          publishTargetChannels,
        ),
        video: publicationVideo,
        idea: idea.trim(),
        theme,
        channels: publishTargetChannels,
        clientPreflightFailuresByChannel,
        postByChannel: filterPostsForSelectedChannels(
          preparedPostsByChannel,
          publishTargetChannels,
        ),
        // Avoid sending the same images twice (base images + channel images),
        // which can make the JSON body too large and trigger HTTP 413.
        // The API now rebuilds the fallback/base image set from channel images.
        images: [],
        imagesByChannel: buildChannelRecord(
          uploadedChannelImages,
          publishableChannels,
        ),
        imageSettingsByChannel: buildChannelRecord(
          channelSettings,
          publishTargetChannels,
        ),
        tiktokPublicationSettings: publishTargetChannels.includes("tiktok")
          ? options?.tiktokPublicationSettings || tiktokPublicationSettings
          : null,
        pinterestPublicationSettings: publishTargetChannels.includes("pinterest")
          ? { boardId: pinterestBoardId, boardName: pinterestBoardName }
          : null,
      });

      if (!dispatchPreparationShown) {
        setPublicationProgressPhase(
          "file_preparation",
          "Préparation des envois",
          49,
        );
        dispatchPreparationShown = true;
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      if (!publicationDispatchShown) {
        setPublicationProgressPhase(
          "publication_finalization",
          "Publication sur les canaux",
          81,
        );
        publicationDispatchShown = true;
        armPublicationFinalWait();
        await new Promise((resolve) => window.setTimeout(resolve, 240));
      }

      // trackEvent attend jusqu’au premier des deux événements : tous les
      // canaux sont terminés, ou la fenêtre visible est écoulée. Dans ce
      // second cas, le bilan s’ouvre avec les canaux encore en traitement et
      // les workers durables poursuivent l’envoi sans dépendre du navigateur.
      const resultEntries = Array.isArray(result?.summary?.entries)
        ? result.summary.entries
        : [];
      const retryFailedChannels = resultEntries
        .filter(
          (entry: any) =>
            entry?.ok === false &&
            entry?.retryable !== false &&
            publishableChannels.includes(entry?.channel as ChannelKey),
        )
        .map((entry: any) => entry.channel as ChannelKey);
      const failureCount = Math.max(
        0,
        Number(result?.summary?.failureCount || retryFailedChannels.length),
      );
      const pendingCount = Math.max(
        0,
        Number(
          result?.summary?.pendingCount ||
            resultEntries.filter((entry: any) => {
              const status = String(entry?.status || "").trim().toLowerCase();
              const technicalStatus = String(entry?.technicalStatus || "")
                .trim()
                .toLowerCase();
              return (
                isBoosterPublicationPendingStatus(status) ||
                isBoosterPublicationPendingStatus(technicalStatus)
              );
            }).length,
        ),
      );
      const warningCount = Math.max(
        0,
        Number(
          result?.summary?.warningCount ||
            resultEntries.filter(
              (entry: any) => entry?.status === "published_with_warning",
            ).length,
        ),
      );
      const publicationAccepted =
        result?.summary?.allFailed !== true &&
        (Number(result?.summary?.successCount || 0) > 0 || pendingCount > 0);
      const publicationComplete = publicationAccepted && pendingCount === 0;
      const bilanProgress = resolvePublicationBilanProgress(pendingCount);

      setPublicationProgressPhase(
        "status_collection",
        pendingCount > 0
          ? pendingCount > 1
            ? `Confirmation des plateformes · ${pendingCount} canaux poursuivent le traitement`
            : "Confirmation des plateformes · 1 canal poursuit le traitement"
          : `Confirmation des plateformes · ${publishableChannels.length}/${publishableChannels.length}`,
        93,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      setPublicationProgressPhase(
        "inrsend_recording",
        "Enregistrement dans iNr’Send",
        96,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 220));

      if (publicationFinalWaitTimeoutId !== null) {
        window.clearTimeout(publicationFinalWaitTimeoutId);
        publicationFinalWaitTimeoutId = null;
      }
      setPublicationProgressPhase(
        "final_wait",
        "Encore quelques secondes… Finalisation du bilan",
        99,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 540));

      completePublicationProgress(
        bilanProgress.backgroundFinalization
          ? bilanProgress.pendingCount > 1
            ? `Bilan prêt — ${bilanProgress.pendingCount} canaux poursuivent leur finalisation`
            : "Bilan prêt — 1 canal poursuit sa finalisation"
          : result?.summary?.allFailed
            ? "Bilan prêt — aucun canal n’a pu être publié"
            : failureCount > 0
              ? `Bilan prêt avec ${failureCount} échec${failureCount > 1 ? "s" : ""}`
              : warningCount > 0
                ? "Bilan prêt avec avertissement"
                : "Bilan prêt — publication finalisée sur tous les canaux",
      );
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      if (publicationAccepted) {
        onUnsavedChange?.(false);
      }
      let recoveredPinterestHref = "";
      if (
        publishableChannels.includes("pinterest") &&
        !normalizeExternalHref(channelDetails.pinterest?.href)
      ) {
        try {
          const pinterestResponse = await fetch(
            "/api/integrations/pinterest/status?live=1",
            { cache: "no-store" as any },
          );
          const pinterestStatus = pinterestResponse.ok
            ? await pinterestResponse.json().catch(() => null)
            : null;
          const username = String(pinterestStatus?.username || "")
            .replace(/^@+/, "")
            .trim();
          recoveredPinterestHref = normalizeExternalHref(
            pinterestStatus?.profileUrl ||
              pinterestStatus?.publicProfileUrl ||
              (username
                ? `https://www.pinterest.fr/${encodeURIComponent(username)}/`
                : ""),
          );
          if (recoveredPinterestHref) {
            const accountLabel = String(
              pinterestStatus?.accountName || username || recoveredPinterestHref,
            ).trim();
            setChannelDetails((current) => ({
              ...current,
              pinterest: {
                ...(current.pinterest || EMPTY_CHANNEL_DETAILS.pinterest),
                type: "account",
                label: accountLabel || "Compte Pinterest connecté",
                href: recoveredPinterestHref,
              },
            }));
          }
        } catch {
          recoveredPinterestHref = "";
        }
      }
      const channelLinks = Object.fromEntries(
        publishableChannels.map((channel) => [
          channel,
          channel === "pinterest"
            ? normalizeExternalHref(channelDetails[channel]?.href) ||
              recoveredPinterestHref
            : normalizeExternalHref(channelDetails[channel]?.href),
        ]),
      );
      if (publicationComplete) {
        void archivePersistentMediaWorkspace().catch((error) => {
          console.warn("[media-pipeline] workspace archive skipped", error);
        });
      }

      const retryFailed = retryFailedChannels.length
        ? async () => {
            await runPublish({
              channels: retryFailedChannels,
              preparedPostsByChannel,
              tiktokPublicationSettings:
                options?.tiktokPublicationSettings ||
                tiktokPublicationSettings,
              closeOnSuccess: true,
              suppressPublishSuccess: false,
              throwOnError: true,
            });
          }
        : undefined;

      if (!options?.suppressPublishSuccess) {
        onPublishSuccess?.({
          ...result,
          channelLinks,
          preflightFailedChannels,
          retryFailedChannels,
          retryFailed,
        });
      }
      if (options?.closeOnSuccess !== false && publicationAccepted) {
        onClose();
      }
    } catch (e) {
      if (publicationFinalWaitTimeoutId !== null) {
        window.clearTimeout(publicationFinalWaitTimeoutId);
        publicationFinalWaitTimeoutId = null;
      }
      setPublishProgress(0);
      setPublishProgressLabel("");
      resetPublicationProgressPhases();
      const baseMessage = getSimpleFrenchErrorMessage(
        e,
        "La publication n'a pas pu être envoyée. Merci de réessayer.",
      );
      const networkLike = /connexion au serveur impossible|connexion interrompue|failed to fetch|networkerror|network request failed/i.test(
        `${e instanceof Error ? e.message : String(e || "")} ${baseMessage}`,
      );
      const message = networkLike
        ? publishDispatchStarted
          ? "Connexion interrompue pendant la publication. L’envoi peut encore être en cours : vérifiez iNr’Send avant de relancer."
          : "Connexion interrompue pendant la préparation des médias. Aucun envoi n’a été confirmé : réessayez dans quelques instants."
        : baseMessage;
      setPublishError(message);
      if (options?.throwOnError) {
        throw new Error(message);
      }
    } finally {
      if (publicationFinalWaitTimeoutId !== null) {
        window.clearTimeout(publicationFinalWaitTimeoutId);
        publicationFinalWaitTimeoutId = null;
      }
      publishStartGuardRef.current = false;
      phasedPublicationProgressRef.current = false;
      setSaving(false);
    }
  };

  const onSavePublicationDraft = async () => {
    if (saving || draftSaving) return;

    setPublishError("");
    setDraftMessage("");

    if (!hasDraftablePublicationContent) {
      setPublishError(
        "Ajoutez un contenu ou un média avant d’enregistrer le brouillon.",
      );
      scrollToPublishArea("smooth");
      return;
    }

    if (!selectedChannels.length) {
      setPublishError(
        "Sélectionnez au moins 1 canal avant d’enregistrer le brouillon.",
      );
      scrollToPublishArea("smooth");
      return;
    }

    const preparedPostsByChannel = filterPostsForSelectedChannels(
      buildPreparedPostsByChannel(),
      selectedChannels,
    );
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
        }
      : null;
    const channelLabels = selectedChannels
      .map((channel) => CHANNEL_LABELS[channel] || channel)
      .join(" / ");
    const firstTitle = selectedChannels
      .map((channel) =>
        String(preparedPostsByChannel[channel]?.title || "").trim(),
      )
      .find(Boolean);
    const firstContent = selectedChannels
      .map((channel) =>
        String(preparedPostsByChannel[channel]?.content || "").trim(),
      )
      .find(Boolean);

    setDraftSaving(true);
    try {
      setDraftMessage(videoFile ? "Sauvegarde vidéo…" : "Enregistrement…");
      const imageDrafts =
        images.length && !(mediaPipelineCutoverEnabled && mediaWorkspaceId)
          ? await uploadPublicationDraftImages()
          : [];
      const rawVideoDraft = mediaPipelineCutoverEnabled && mediaWorkspaceId
        ? null
        : await buildPublicationDraftVideoPayload();
      const videoDraft = rawVideoDraft
        ? {
            ...rawVideoDraft,
            ...videoAiContextReferenceAliases(videoAiContextRef),
          }
        : null;
      const response = await fetch("/api/booster/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "publish_draft",
          draftId:
            loadedPublicationDraftId || publicationDraftIdParam || undefined,
          payload: {
            status: "draft",
            creationMode,
            mediaWorkspaceId,
            mediaWorkspaceClientKey,
            mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
            title: firstTitle || "Brouillon publication",
            preview: firstContent || idea.trim() || channelLabels,
            content: firstContent || "",
            idea: idea.trim(),
            publicationInstruction: publicationInstruction.trim(),
            theme,
            contentStyle,
            channel: channelLabels,
            channels: selectedChannels,
            postByChannel: preparedPostsByChannel,
            mediaType: videoFile ? "video" : "images",
            channelMediaModes,
            videoFormatByChannel,
            videoAdaptationModeByChannel,
            videoSettingsByChannel,
            imageNames: imageNames,
            videoName: videoName,
            videoSourceMetadata,
            imageDrafts,
            videoDraft,
            ...videoAiContextReferenceAliases(videoAiContextRef),
            useImagesForAI,
            imageSettingsByChannel: getDraftImageSettingsByChannel(),
            instagramHashtagsInput,
            pinterestBoardId,
            pinterestBoardName,
            saved_at: new Date().toISOString(),
          },
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          String(
            result?.error ||
              "Impossible d’enregistrer le brouillon publication.",
          ),
        );
      }
      const savedDraftId = String(
        result?.id || loadedPublicationDraftId || publicationDraftIdParam || "",
      ).trim();
      if (videoDraft) {
        const draftVariants = normalizeRestoredVideoVariants(
          (videoDraft as any).transformedVariants,
        );
        setVideoStorageContext({
          storagePath: videoDraft.storagePath || "",
          publicUrl: videoDraft.publicUrl || videoDraft.url || "",
          url: videoDraft.url || videoDraft.publicUrl || "",
        });
        if (draftVariants.length) {
          setVideoTransformedVariants(draftVariants);
          setVideoVariantPreparationByChannel((prev) => ({
            ...prev,
            ...buildVideoPreparationStateFromVariants({
              channels: selectedChannels,
              mediaModeByChannel: channelMediaModes,
              variants: draftVariants,
            }),
          }));
        }
      }
      if (savedDraftId) {
        await linkPersistentWorkspaceDraft(savedDraftId).catch((error) => {
          console.warn("[media-pipeline] workspace draft link skipped", error);
        });
        setLoadedPublicationDraftId(savedDraftId);
        router.replace(
          `/dashboard?action=publish&draftId=${encodeURIComponent(savedDraftId)}`,
          { scroll: false },
        );
      }
      setLastPublicationDraftSnapshot(currentPublicationDraftSnapshot);
      onUnsavedChange?.(false);
      setDraftMessage("Brouillon enregistré");
    } catch (e) {
      setPublishError(
        getSimpleFrenchErrorMessage(
          e,
          "Impossible d’enregistrer le brouillon publication.",
        ),
      );
    } finally {
      setDraftSaving(false);
    }
  };

  useEffect(() => {
    if (!saveDraftActionRef) return;
    saveDraftActionRef.current = onSavePublicationDraft;
    return () => {
      if (saveDraftActionRef.current === onSavePublicationDraft) {
        saveDraftActionRef.current = null;
      }
    };
  }, [saveDraftActionRef, onSavePublicationDraft]);

  const openSchedulePublicationModal = () => {
    if (saving || draftSaving || scheduleSaving) return;
    const preparedPostsByChannel = buildPreparedPostsByChannel();
    setPublishError("");
    setScheduleError("");
    setDraftMessage("");
    setImgError("");
    setTiktokPublicationSettings(null);

    if (!selectedChannels.length) {
      setPublishError("Sélectionnez au moins 1 canal à programmer.");
      scrollToPublishArea("smooth");
      return;
    }

    setPostsByChannel(preparedPostsByChannel);
    setScheduleReviewPosts(preparedPostsByChannel);
    setScheduleModalOpen(true);
  };

  const buildChannelRecord = <T,>(
    source: Partial<Record<ChannelKey, T>>,
    channels: ChannelKey[],
  ): Partial<Record<ChannelKey, T>> =>
    Object.fromEntries(
      channels
        .map((channel) => [channel, source[channel]] as const)
        .filter(
          (entry): entry is readonly [ChannelKey, T] => entry[1] !== undefined,
        ),
    ) as Partial<Record<ChannelKey, T>>;

  const buildChannelUnknownRecord = (
    source: Partial<Record<ChannelKey, unknown>>,
    channels: ChannelKey[],
  ): Partial<Record<ChannelKey, unknown>> =>
    Object.fromEntries(
      channels
        .map((channel) => [channel, source[channel]] as const)
        .filter((entry) => entry[1] !== undefined),
    ) as Partial<Record<ChannelKey, unknown>>;

  const performSchedulePublication = async (
    selections: PublishScheduleSelection[],
    preparedPostsByChannel: Partial<Record<ChannelKey, ChannelPost>>,
    tiktokSettingsForSchedule: TiktokPublicationSettings | null,
    immediateChannels: ChannelKey[] = [],
  ): Promise<PendingImmediatePublishAfterSchedule | null | undefined> => {
    if (
      saving ||
      draftSaving ||
      scheduleSaving ||
      scheduleStartGuardRef.current
    ) {
      return;
    }

    const requestedChannelsToSchedule = Array.from(
      new Set(selections.map((selection) => selection.channel)),
    ).filter((channel): channel is ChannelKey =>
      selectedChannels.includes(channel),
    );

    if (!requestedChannelsToSchedule.length) {
      setScheduleError("Sélectionnez au moins un canal à programmer.");
      return;
    }

    const immediateChannelsToPublish = Array.from(new Set(immediateChannels))
      .filter((channel): channel is ChannelKey =>
        selectedChannels.includes(channel),
      )
      .filter((channel) => !requestedChannelsToSchedule.includes(channel));

    scheduleStartGuardRef.current = true;
    setScheduleSaving(true);
    setPublishError("");
    setScheduleError("");
    setDraftMessage("");
    setImgError("");
    setPublishProgress(5);
    setPublishProgressLabel("Préparation de la programmation...");
    scrollToPublishArea("smooth");

    try {
      const requestedWorkspaceMediaTypes = [
        ...(requestedChannelsToSchedule.some(
          (channel) => resolveChannelMediaMode(channel) === "images",
        )
          ? (["image"] as const)
          : []),
        ...(requestedChannelsToSchedule.some(
          (channel) => resolveChannelMediaMode(channel) === "video",
        )
          ? (["video"] as const)
          : []),
      ];
      const settledWorkspaceStates = persistentMediaWorkspaceEnabled
        ? await waitForPersistentWorkspaceIdle(
            (progress, label) => {
              setPublishProgress((current) => Math.max(current, progress));
              setPublishProgressLabel(
                label || "Vérification des médias...",
              );
            },
            {
              mediaTypes: requestedWorkspaceMediaTypes,
              tolerateFailures: true,
            },
          )
        : undefined;
      const reviewItems = buildFinalReviewItems(
        preparedPostsByChannel,
        requestedChannelsToSchedule,
        settledWorkspaceStates,
      );
    const blocked = reviewItems.filter((item) => item.blockers.length > 0);
    const channelsToSchedule = reviewItems
      .filter((item) => item.blockers.length === 0)
      .map((item) => item.channel);
    if (!channelsToSchedule.length) {
      setScheduleError(
        `Aucun canal ne peut être programmé : ${blocked
          .map(
            (item) =>
              `${item.label} — ${item.blockers[0] || "canal non prêt"}`,
          )
          .join(" / ")}.`,
      );
      return;
    }

    const publishMediaModeByChannel = Object.fromEntries(
      channelsToSchedule.map((channel) => [
        channel,
        resolveChannelMediaMode(channel),
      ]),
    ) as Partial<Record<ChannelKey, ChannelMediaMode>>;
    const hasAnyVideoPublish = channelsToSchedule.some(
      (channel) => publishMediaModeByChannel[channel] === "video",
    );
    const hasAnyImagePublish = channelsToSchedule.some(
      (channel) => publishMediaModeByChannel[channel] === "images",
    );
    const requiredScheduleMediaTypes = [
      ...(hasAnyImagePublish ? (["image"] as const) : []),
      ...(hasAnyVideoPublish ? (["video"] as const) : []),
    ];
    const scheduleWorkspaceReadinessTimeoutMs =
      MEDIA_WORKSPACE_READINESS_TIMEOUT_MS;
    const workspaceCarriesImagesForSchedule =
      mediaPipelineCutoverEnabled && images.length > 0;
    const workspaceCarriesVideoForSchedule =
      mediaPipelineCutoverEnabled && Boolean(videoFile);
    const shouldBuildScheduleImageFallback =
      hasAnyImagePublish && !workspaceCarriesImagesForSchedule;
    const shouldBuildScheduleVideoFallback =
      hasAnyVideoPublish && !workspaceCarriesVideoForSchedule;
    const scheduleVideoSettingsByChannel = Object.fromEntries(
      channelsToSchedule.map((channel) => [
        channel,
        getAutomaticVideoSettingsForPublication({
          channel,
          settings: videoSettingsByChannel[channel],
          durationSeconds:
            videoDurationSeconds ?? videoSourceMetadata?.duration ?? null,
        }),
      ]),
    ) as Partial<
      Record<
        ChannelKey,
        { format: VideoFormat; adaptationMode: VideoAdaptationMode }
      >
    >;

    if (hasAnyVideoPublish && !videoFile) {
      setScheduleError("Ajoutez une vidéo avant de programmer ces canaux.");
      return;
    }

      const readyMediaWorkspaceId =
        await waitForPersistentWorkspaceReadiness(
          "schedule",
          (progress, label) => {
            setPublishProgress((current) => Math.max(current, progress));
            setPublishProgressLabel(label || "Vérification des médias...");
          },
          requiredScheduleMediaTypes,
          scheduleWorkspaceReadinessTimeoutMs,
        );

      if (hasAnyVideoPublish && workspaceCarriesVideoForSchedule) {
        const videoChannels = channelsToSchedule.filter(
          (channel) => publishMediaModeByChannel[channel] === "video",
        );
        setPublishProgress((current) => Math.max(current, 43));
        setPublishProgressLabel("Préparation des médias");
        const videoPreparation = await ensureCutoverVideoVariantsReady(
          videoChannels,
          scheduleVideoSettingsByChannel,
          {
            generateMissingVideoVariants: false,
            allowPartialChannelFailures: true,
          },
        );
        setPublishProgress((current) => Math.max(current, 57));
        setPublishProgressLabel("Préparation des médias");
      }

      const emptyChannelImages = {} as ChannelImagePayload;
      const emptyChannelSettings = {} as ChannelImageSettingsPayload;
      const { channelImages, channelSettings } = !hasAnyImagePublish
        ? {
            channelImages: emptyChannelImages,
            channelSettings: emptyChannelSettings,
          }
        : workspaceCarriesImagesForSchedule
          ? {
              channelImages: emptyChannelImages,
              channelSettings: buildChannelImageSettingsPayload(),
            }
          : await buildChannelImagesPayload((current, total) => {
            if (!total) {
              setPublishProgress((current) => Math.max(current, 20));
              setPublishProgressLabel("Préparation des contenus...");
              return;
            }
            const ratio = current / total;
            setPublishProgress((current) =>
              Math.max(current, clampPercent(8 + ratio * 22)),
            );
            setPublishProgressLabel(
              `Préparation des images ${clampPercent(ratio * 100)}%`,
            );
          });

      const originalImageByKey: Record<string, ImagePayload> =
        !shouldBuildScheduleImageFallback
          ? {}
          : await (async () => {
              setPublishProgress((current) => Math.max(current, 32));
              setPublishProgressLabel("Upload des images originales...");
              return await uploadOriginalImagesForPublication(
                (current, total) => {
                  if (!total) return;
                  const ratio = current / total;
                  setPublishProgress((current) =>
                    Math.max(current, clampPercent(32 + ratio * 12)),
                  );
                  setPublishProgressLabel(
                    `Upload des images originales ${clampPercent(ratio * 100)}%`,
                  );
                },
              );
            })();

      const uploadedChannelImages = {} as ChannelImagePayload;
      if (shouldBuildScheduleImageFallback) {
        setPublishProgress((current) => Math.max(current, 48));
        setPublishProgressLabel("Upload des images adaptées...");
        let uploadedCount = 0;
        const uploadTargets = channelsToSchedule.reduce(
          (sum, channel) =>
            sum +
            (channelImages[channel] || []).filter((image) => !!image?.dataUrl)
              .length,
          0,
        );
        for (const channel of channelsToSchedule) {
          if (publishMediaModeByChannel[channel] !== "images") continue;
          const uploadedImages = await uploadPreparedImages(
            channelImages[channel] || [],
            () => {
              uploadedCount += 1;
              const ratio = uploadTargets ? uploadedCount / uploadTargets : 1;
              setPublishProgress((current) =>
                Math.max(current, clampPercent(48 + ratio * 22)),
              );
              setPublishProgressLabel(
                `Upload des images adaptées ${clampPercent(ratio * 100)}%`,
              );
            },
          );
          const imageKeysForChannel = channelSettings[channel]?.imageKeys || [];
          uploadedChannelImages[channel] = uploadedImages.map(
            (image, index) => {
              const imageKey = imageKeysForChannel[index] || "";
              const original = imageKey
                ? originalImageByKey[imageKey]
                : undefined;
              const originalUrl = String(
                original?.publicUrl ||
                  original?.originalPublicUrl ||
                  original?.originalUrl ||
                  "",
              ).trim();
              return {
                ...image,
                renderedUrl: image.publicUrl || image.renderedUrl || "",
                imageKey,
                originalUrl,
                originalPublicUrl: originalUrl,
                originalStoragePath:
                  original?.storagePath || original?.originalStoragePath || "",
                originalName: original?.name || image.name,
                originalType: original?.type || image.type,
                transform: imageKey
                  ? channelSettings[channel]?.transforms?.[imageKey]
                  : undefined,
                imageMeta: imageKey ? imageMetaByKey[imageKey] : undefined,
              };
            },
          );
        }
      }

      let publicationVideo: any = null;
      if (shouldBuildScheduleVideoFallback) {
        setPublishProgress(48);
        setPublishProgressLabel("Upload de la vidéo...");
        publicationVideo = await uploadPublicationVideoForPublish();
        if (!publicationVideo?.publicUrl && !publicationVideo?.url) {
          throw new Error(
            "La vidéo n’a pas pu être préparée pour la programmation.",
          );
        }
        publicationVideo = await preparePublicationVideoVariants(
          publicationVideo,
          channelsToSchedule,
          publishMediaModeByChannel,
          { settingsByChannel: scheduleVideoSettingsByChannel },
        );
      }

      setPublishProgress(76);
      setPublishProgressLabel("Enregistrement dans iNr’Agent...");

      const selectionByChannel = new Map(
        selections.map((selection) => [
          selection.channel,
          selection.scheduledAt,
        ]),
      );

      const scheduleGroups = Array.from(
        channelsToSchedule.reduce((groups, channel) => {
          const scheduledAt = selectionByChannel.get(channel);
          if (!scheduledAt) return groups;
          const existing = groups.get(scheduledAt) || [];
          existing.push(channel);
          groups.set(scheduledAt, existing);
          return groups;
        }, new Map<string, ChannelKey[]>()),
      );

      for (let index = 0; index < scheduleGroups.length; index += 1) {
        const [scheduledAt, groupChannels] = scheduleGroups[index];
        const labels = groupChannels
          .map((channel) => CHANNEL_LABELS[channel] || channel)
          .join(", ");
        const isMultichannel = groupChannels.length > 1;
        await postBoosterScheduledAction({
          automationKey: "publish",
          actionType: "publication",
          targetTool: "booster",
          source: "manual",
          title: isMultichannel
            ? `Publication multicanale (${groupChannels.length} canaux)`
            : `Publication ${labels}`,
          summary: isMultichannel
            ? `Publication programmée sur ${labels}`
            : `Publication programmée sur ${labels}`,
          scheduledAt,
          timezone: "Europe/Paris",
          channels: groupChannels,
          payload: {
              creationMode,
              origin: {
                source: "booster_scheduled",
                label: "Booster programmé",
                workflowTool: "booster",
                workflowAction: "publier",
              },
              kind: "manual_publish_schedule",
              scheduleGrouping: {
                mode: "multichannel_single_action",
                channelCount: groupChannels.length,
                createdFrom: "booster_publish_schedule",
              },
              publishPayload: {
                creationMode,
                mediaWorkspaceId:
                  unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
                    ? readyMediaWorkspaceId
                    : undefined,
                mediaWorkspaceClientKey:
                  unifiedMediaConsumptionClientAvailable && readyMediaWorkspaceId
                    ? mediaWorkspaceClientKey
                    : undefined,
                mediaPipelineCutoverV1: mediaPipelineCutoverEnabled,
                source: "booster_scheduled",
                origin: {
                  source: "booster_scheduled",
                  label: "Booster programmé",
                  workflowTool: "booster",
                  workflowAction: "publier",
                },
                mediaType: hasAnyVideoPublish ? "video" : "images",
                mediaModeByChannel: buildChannelUnknownRecord(
                  publishMediaModeByChannel,
                  groupChannels,
                ),
                videoFormatByChannel: buildChannelUnknownRecord(
                  videoFormatByChannel,
                  groupChannels,
                ),
                videoAdaptationModeByChannel: buildChannelUnknownRecord(
                  videoAdaptationModeByChannel,
                  groupChannels,
                ),
                videoSettingsByChannel: buildChannelUnknownRecord(
                  scheduleVideoSettingsByChannel as Partial<
                    Record<ChannelKey, unknown>
                  >,
                  groupChannels,
                ),
                video: publicationVideo,
                idea: idea.trim(),
                theme,
                channels: groupChannels,
                postByChannel: filterPostsForSelectedChannels(
                  preparedPostsByChannel,
                  groupChannels,
                ),
                images: [],
                imagesByChannel: buildChannelRecord(
                  uploadedChannelImages,
                  groupChannels,
                ),
                imageSettingsByChannel: buildChannelRecord(
                  channelSettings,
                  groupChannels,
                ),
                tiktokPublicationSettings: groupChannels.includes("tiktok")
                  ? tiktokSettingsForSchedule
                  : null,
                pinterestPublicationSettings: groupChannels.includes(
                  "pinterest",
                )
                  ? { boardId: pinterestBoardId, boardName: pinterestBoardName }
                  : null,
              },
          },
        });
        setPublishProgress(
          clampPercent(76 + ((index + 1) / scheduleGroups.length) * 20),
        );
      }

      setChannels((prev) => {
        const next = { ...prev };
        for (const channel of [
          ...channelsToSchedule,
          ...immediateChannelsToPublish,
        ]) {
          next[channel] = false;
        }
        return next;
      });
      setPublishProgress(100);
      setPublishProgressLabel(
        immediateChannelsToPublish.length
          ? "Programmation enregistrée, envoi des autres canaux..."
          : "Publication confiée à iNr’Agent.",
      );
      const scheduledMessage =
        channelsToSchedule.length > 1
          ? `Publication multicanale programmée dans iNr’Agent (${channelsToSchedule.length} canaux).`
          : "Publication programmée dans iNr’Agent.";
      const blockedMessage = blocked.length
        ? `${blocked.length > 1 ? " Canaux non programmés" : " Canal non programmé"} : ${blocked
            .map(
              (item) =>
                `${item.label} — ${item.blockers[0] || "canal non prêt"}`,
            )
            .join(" / ")}.`
        : "";
      setDraftMessage(`${scheduledMessage}${blockedMessage}`);

      const immediatePublishRequest = immediateChannelsToPublish.length
        ? {
            immediateChannels: immediateChannelsToPublish,
            preparedPostsByChannel,
            tiktokSettingsForSchedule: immediateChannelsToPublish.includes(
              "tiktok",
            )
              ? tiktokSettingsForSchedule
              : null,
          }
        : null;
      setPendingImmediatePublishAfterSchedule(immediatePublishRequest);

      setScheduleReviewPosts(null);
      setTiktokPublicationSettings(null);
      setTiktokSettingsFlow(null);
      setPendingScheduleRequest(null);
      onUnsavedChange?.(blocked.length > 0);
      return immediatePublishRequest;
    } catch (e) {
      const message = getSimpleFrenchErrorMessage(
        e,
        "Programmation de la publication impossible.",
      );
      setScheduleError(message);
      setPublishError(message);
      throw new Error(message);
    } finally {
      scheduleStartGuardRef.current = false;
      setScheduleSaving(false);
    }
  };

  function publishImmediateChannelsAfterSchedule(
    request: PendingImmediatePublishAfterSchedule,
  ) {
    if (!request.immediateChannels.length) return;
    void runPublish({
      skipEmptyContentWarnings: true,
      preparedPostsByChannel: request.preparedPostsByChannel,
      tiktokPublicationSettings: request.tiktokSettingsForSchedule,
      channels: request.immediateChannels,
      closeOnSuccess: false,
      throwOnError: false,
    });
  }

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
      !tiktokPublicationSettings
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

    await performSchedulePublication(
      selections,
      preparedPostsByChannel,
      tiktokWillSchedule || tiktokWillPublishNow
        ? tiktokPublicationSettings
        : null,
      immediateChannels,
    );
  };

  const onPublish = async () => {
    if (saving || draftSaving || scheduleSaving) return;
    const preparedPostsByChannel = buildPreparedPostsByChannel();
    setPublishError("");
    setDraftMessage("");
    setImgError("");
    setPublishProgress(0);
    setPublishProgressLabel("");

    if (!selectedChannels.length) {
      setPublishError("Sélectionnez au moins 1 canal.");
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
    setTiktokPublicationSettings(null);
    if (tiktokReviewItem && tiktokReviewItem.blockers.length === 0) {
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
      const post = getReviewPostForChannel(channel, preparedPostsByChannel);
      const imageKeysToPublish = getPublishImageKeysForChannel(channel);
      const hasTitle = !!String(post?.title || "").trim();
      const hasContent = !!String(post?.content || "").trim();
      const hasText = hasTitle || hasContent;
      const hasImage = imageKeysToPublish.length > 0;
      const mode = resolveChannelMediaMode(channel);
      const hasVideo = mode === "video" && !!videoFile;
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
      });
      const videoPreparationState = videoVariantPreparationByChannel[channel];
      const requestedVideoFormat =
        videoSettingsByChannel[channel]?.format ||
        videoFormatByChannel[channel] ||
        "original";
      const videoNeedsExplicitAdaptation =
        mode === "video" && requestedVideoFormat !== "original";
      const videoPreparationBlocker =
        !mediaPipelineCutoverEnabled &&
        videoNeedsExplicitAdaptation &&
        videoPreparationState?.status === "error"
          ? String(
              videoPreparationState.detail ||
                "La conversion technique de la vidéo a échoué pour ce canal.",
            ).trim()
          : "";

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
      const mediaUploadBlocker = !workspaceSourceExpected
        ? ""
        : failedWorkspaceState
          ? failedWorkspaceState.error ||
            "L’envoi du média a échoué. Retirez-le puis ajoutez-le à nouveau."
          : "";

      const blockers = [
        ...requirements.blockers,
        ...(videoPreparationBlocker ? [videoPreparationBlocker] : []),
        ...(mediaUploadBlocker ? [mediaUploadBlocker] : []),
        ...(channel === "pinterest" && !pinterestBoardId
          ? ["Choisissez un tableau Pinterest."]
          : []),
      ];
      const blockerCodes = [
        ...requirements.blockerCodes,
        ...(videoPreparationBlocker ? ["video_conversion_failed"] : []),
        ...(mediaUploadBlocker ? ["media_upload_pending"] : []),
        ...(channel === "pinterest" && !pinterestBoardId
          ? ["pinterest_board_required"]
          : []),
      ];

      return {
        channel,
        label: CHANNEL_LABELS[channel],
        mediaType: mode === "video" ? ("video" as const) : ("images" as const),
        mediaLabel:
          mode === "video"
            ? "1 vidéo"
            : mode === "images"
              ? getPublicationMediaLabel("images", imageKeysToPublish.length)
              : "Texte seul",
        imageCount: imageKeysToPublish.length,
        warnings: requirements.warnings,
        blockers,
        blockerCodes,
        mediaBlockers: [
          ...requirements.mediaBlockers,
          ...(videoPreparationBlocker ? [videoPreparationBlocker] : []),
          ...(mediaUploadBlocker ? [mediaUploadBlocker] : []),
        ],
        mediaBlockerCodes: [
          ...requirements.mediaBlockerCodes,
          ...(videoPreparationBlocker ? ["video_conversion_failed"] : []),
          ...(mediaUploadBlocker ? ["media_upload_pending"] : []),
        ],
        publishable: blockers.length === 0,
        tiktokParametersValidated:
          channel === "tiktok" && Boolean(tiktokPublicationSettings),
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
  const finalReviewSiteNotice =
    resolveChannelMediaMode("inrcy_site") === "images" &&
    resolveChannelMediaMode("site_web") === "images" &&
    selectedChannels.includes("inrcy_site") &&
    selectedChannels.includes("site_web")
      ? getPublishImageKeysForChannel("inrcy_site").join("|") !==
        getPublishImageKeysForChannel("site_web").join("|")
      : false;

  const publishReadinessItems = buildFinalReviewItems(
    buildPreparedPostsByChannel(),
  );
  const channelReadiness = publishReadinessItems.reduce(
    (acc, item) => {
      const selectorBlockers = item.blockers.filter(
        (blocker) => blocker !== "Ajoutez au moins du texte ou un média.",
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
  const imageAdapterTabs = imageAdapterChannels.map((channel) => {
    const reviewItem = publishReadinessItems.find(
      (item) => item.channel === channel,
    );
    const count =
      reviewItem?.imageCount ?? getPublishImageKeysForChannel(channel).length;
    return {
      key: channel,
      label: getImageAdapterLabel(channel),
      count,
      tone: reviewItem?.mediaBlockers?.length
        ? ("blocked" as const)
        : count
          ? ("ready" as const)
          : ("warning" as const),
      message: reviewItem?.mediaBlockers?.[0] || "",
      blockers: reviewItem?.mediaBlockers || [],
    };
  });

  const previewReadinessTabs = imageAdapterChannels.map((channel) => {
    const reviewItem = publishReadinessItems.find(
      (item) => item.channel === channel,
    );
    const hasText = !!reviewItem?.hasText;
    const mode = resolveChannelMediaMode(channel);
    const hasMedia =
      mode === "video"
        ? !!videoPreviewUrl
        : mode === "images"
          ? !!reviewItem?.hasImage
          : false;
    return {
      key: channel,
      label: getImageAdapterLabel(channel),
      tone: reviewItem?.blockers?.length
        ? ("blocked" as const)
        : hasText && hasMedia
          ? ("ready" as const)
          : hasText || hasMedia
            ? ("warning" as const)
            : ("blocked" as const),
      message: reviewItem?.blockers?.[0] || "",
    };
  });

  const closeFinalReview = () => {
    setFinalReviewOpen(false);
    setTiktokPublicationSettings(null);
  };

  const closeTiktokSettingsModal = () => {
    setTiktokSettingsOpen(false);
    setTiktokSettingsFlow(null);
    setPendingScheduleRequest(null);
    setTiktokPublicationSettings(null);
  };

  const validateTiktokSettingsModal = async (
    settings: TiktokPublicationSettings,
  ) => {
    setTiktokPublicationSettings(settings);
    setTiktokSettingsOpen(false);

    if (tiktokSettingsFlow === "schedule" && pendingScheduleRequest) {
      const request = pendingScheduleRequest;
      setPendingScheduleRequest(null);
      setTiktokSettingsFlow(null);
      setScheduleModalOpen(true);
      const immediatePublishRequest = await performSchedulePublication(
        request.selections,
        request.preparedPostsByChannel,
        settings,
        request.immediateChannels,
      );
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
  const publicationImagesPanelVisible = true;

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
    if (tiktokWillPublish && !tiktokPublicationSettings) {
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

  return (
    <div ref={publishRootRef} style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <PublishHelpModal
        open={publishHelpOpen}
        onClose={() => setPublishHelpOpen(false)}
      />

      <PublishAiConfigurationDrawer
        open={aiConfigurationOpen}
        isMobile={isMobile}
        drawerHeight={aiDrawerHeight}
        onClose={() => setAiConfigurationOpen(false)}
      />

      <TiktokPublicationSettingsModal
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
        onCancel={closeTiktokSettingsModal}
        onValidate={validateTiktokSettingsModal}
        onExcludeAndContinue={excludeTiktokAndContinue}
      />

      <PublishFinalReviewModal
        open={finalReviewOpen}
        styles={styles}
        items={finalReviewItems}
        showSiteNotice={finalReviewSiteNotice}
        hasBlockers={hasFinalReviewBlockers}
        publishableCount={finalReviewPublishableCount}
        isMobile={isMobile}
        saving={saving}
        onClose={closeFinalReview}
        onConfirm={confirmFinalReview}
      />

      <PublishScheduleModal
        open={scheduleModalOpen}
        styles={styles}
        items={scheduleModalItems}
        isMobile={isMobile}
        saving={scheduleSaving}
        error={scheduleError}
        progress={publishProgress}
        progressLabel={publishProgressLabel}
        onClose={() => {
          if (scheduleSaving) return;
          setScheduleModalOpen(false);
        }}
        successMessage="Programmation réussie."
        savingLabel="Envoi en cours…"
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
        title="Appareil iNrCy"
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
        title="Ajouter depuis la Médiathèque"
        subtitle={
          mediaLibraryPickerScope === "generation"
            ? "Pour la génération, choisissez jusqu’à 5 images OU une vidéo. Le mixage reste disponible dans les Médias de la publication."
            : "Choisissez jusqu’à 5 images et une vidéo déjà stockées dans iNrCy."
        }
        accept={
          mediaLibraryPickerScope === "generation"
            ? generationMediaSelectionPolicy.libraryAccept
            : "all"
        }
        multiple={
          mediaLibraryPickerScope === "generation"
            ? generationMediaSelectionPolicy.libraryMultiple
            : true
        }
        maxSelection={
          mediaLibraryPickerScope === "generation"
            ? generationMediaSelectionPolicy.libraryMaxSelection
            : BOOSTER_MAX_IMAGE_COUNT + 1
        }
        maxImageBytes={BOOSTER_MAX_IMAGE_BYTES}
        maxVideoBytes={BOOSTER_MAX_VIDEO_BYTES}
        onOpenOptimizer={openMediaOptimizer}
        onOversizedMedia={registerOversizedLibraryMedia}
        confirmLabel={
          mediaLibraryPickerScope === "generation"
            ? "Ajouter à la génération"
            : "Ajouter à la publication"
        }
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

      <PublishChannelSelector
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

      <PublishCreationModePanel
        styles={styles}
        isMobile={isMobile}
        mode={creationMode}
        disabled={generating || saving || draftSaving || scheduleSaving}
        selectedChannelCount={selectedChannels.length}
        error={creationModeError}
        showReset={hasDraftablePublicationContent}
        onSelectMode={(mode) => {
          void onSelectCreationMode(mode);
        }}
        onReset={() => {
          void onReset();
        }}
      />

      {creationMode === "ai" && workflowSteps?.intention && creationWorkflow?.showsIntent ? (
        <div ref={creationPathRef} style={{ minWidth: 0 }}>
          <PublishIntentPanel
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
            onImagesChange={onImagesChange}
            onVideoChange={onVideoChange}
            onPickImagesClick={() => {
              pendingDirectMediaDestinationRef.current = { kind: "generation" };
              onPickImagesClick();
            }}
            onPickVideoClick={() => onPickVideoClick({ kind: "generation" })}
            onTakePhotoClick={() => onTakePhotoClick(undefined, "generation")}
            onOpenMediaLibrary={() => {
              setMediaLibraryPickerScope("generation");
              setMediaLibraryPickerOpen(true);
            }}
            images={images}
            imagePreviews={imagePreviews}
            videoFile={videoFile}
            videoPreviewUrl={videoPreviewUrl}
            videoDurationSeconds={videoDurationSeconds}
            removeVideo={removeVideo}
            removeImage={removeImage}
            useImagesForAI={useImagesForAI}
            setUseImagesForAI={setUseImagesForAI}
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
            aiPreferredEngine={selectedAiPreferredEngine}
            defaultAiPreferredEngine={defaultAiPreferredEngine}
            onAiPreferredEngineChange={(engine) =>
              setSelectedAiPreferredEngine(normalizeAiPreferredEngine(engine))
            }
            onGenerate={onGenerate}
            onOpenAiConfiguration={() => setAiConfigurationOpen(true)}
          />
        </div>
      ) : null}

      {showContentWorkspace && workflowSteps ? (
        <>
          <div
            ref={contentWorkspaceRef}
            style={{ display: "grid", gap: 12, minWidth: 0 }}
          >
            <PublishContentEditorPanel
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
              duplicateFeedback={duplicateFeedback}
              onDuplicateContentToAllChannels={onDuplicateContentToAllChannels}
              pinterestBoards={pinterestBoards}
              pinterestBoardId={pinterestBoardId}
              pinterestBoardsLoading={pinterestBoardsLoading}
              pinterestBoardsError={pinterestBoardsError}
              onPinterestBoardChange={onPinterestBoardChange}
            />

            <PublishImagesPanel
              styles={styles}
              isMobile={isMobile}
              stepNumber={workflowSteps.media}
              channelMediaModes={channelMediaModes}
              setChannelMediaMode={setChannelMediaMode}
              onRemoveMediaFromChannel={removeMediaFromChannel}
              videoFormatByChannel={videoFormatByChannel}
              setVideoFormatForChannel={setVideoFormatForChannel}
              videoAdaptationModeByChannel={videoAdaptationModeByChannel}
              setVideoAdaptationModeForChannel={setVideoAdaptationModeForChannel}
              images={images}
              videoFile={videoFile}
              videoPreviewUrl={videoPreviewUrl}
              videoDurationSeconds={videoDurationSeconds}
              videoSourceMetadata={videoSourceMetadata}
              videoVariantPreparationByChannel={
                mediaPipelineCutoverEnabled
                  ? {}
                  : videoVariantPreparationByChannel
              }
              videoTransformedVariants={videoTransformedVariants}
              videoPreviewVariantsPreparing={
                mediaPipelineCutoverEnabled
                  ? false
                  : videoPreviewVariantsPreparing
              }
              deferTechnicalPreparationUntilPublish={
                mediaPipelineCutoverEnabled
              }
              onApplyVideoFormatForChannel={
                mediaPipelineCutoverEnabled
                  ? undefined
                  : applyVideoFormatForChannel
              }
              onApplyVideoFormatToAllChannels={
                mediaPipelineCutoverEnabled
                  ? undefined
                  : applyVideoFormatToAllChannels
              }
              removeVideo={removeVideo}
              imgError={imgError}
              showMediaOptimizerAction={false}
              onOpenMediaOptimizer={openMediaOptimizer}
              selectedChannels={selectedChannels}
              activeImageChannel={activeImageChannel}
              imageAdapterTabs={imageAdapterTabs}
              imageKeys={imageKeys}
              channelImageEditors={channelImageEditors}
              imageMetaByKey={imageMetaByKey}
              previewByKey={previewByKey}
              previewAspectRatio={previewAspectRatio}
              getImageAdapterLabel={getImageAdapterLabel}
              setSynchronizedActiveChannel={setSynchronizedActiveChannel}
              onPickImagesClick={() => {
                pendingDirectMediaDestinationRef.current = { kind: "publication" };
                onPickImagesClick();
              }}
              onPickImagesForChannel={(channel) => {
                pendingDirectMediaDestinationRef.current = {
                  kind: "channel",
                  channel,
                };
                onPickImagesForChannel(channel);
              }}
              onUseExistingImagesForChannel={
                assignExistingImagesToChannel
              }
              onRemoveImagesFromChannel={removeImagesFromChannel}
              onPickVideoClick={() => onPickVideoClick({ kind: "publication" })}
              onPickVideoForChannel={onPickVideoForChannel}
              onTakePhotoClick={(channel) =>
                onTakePhotoClick(channel, "publication")
              }
              toggleChannelImage={toggleChannelImage}
              openImageEditor={openImageEditor}
              resetChannelImage={resetChannelImage}
              removeImage={removeImage}
              moveChannelImage={moveChannelImage}
            />

            <PublishPreviewPanel
              styles={styles}
              isMobile={isMobile}
              stepNumber={workflowSteps.preview}
              activePublicationPreview={activePublicationPreview}
              previewReadinessTabs={previewReadinessTabs}
              activeImageChannel={activeImageChannel}
              showPublicationPreview={showPublicationPreview}
              setShowPublicationPreview={setShowPublicationPreview}
              setSynchronizedActiveChannel={setSynchronizedActiveChannel}
            />
          </div>

          <ChannelImageAdapterModal
        open={!!(isImageEditorOpen && activeEditorImageKey)}
        title={`Adapter Image ${(imageKeys.indexOf(activeEditorImageKey || "") || 0) + 1}`}
        subtitle={`${getImageAdapterLabel(activeImageChannel)} • ${activeEditorDecisionLabel}`}
        aspectRatio={previewAspectRatio}
        backgroundMode={activeBackgroundMode}
        backgroundColor={activeBackgroundColor}
        fitLabel={getImageFitLabel(activeEditorTransform)}
        zoomLabel={`zoom ${activeEffectiveZoom.toFixed(2)}×`}
        previewSrc={
          activeEditorImageKey ? previewByKey[activeEditorImageKey] : ""
        }
        previewLayout={previewLayout}
        isDragging={isDraggingImage}
        onClose={closeImageEditor}
        onWheel={handlePreviewWheel}
        onPointerDown={handlePreviewPointerDown}
        onPointerMove={handlePreviewPointerMove}
        onPointerUp={endPreviewDrag}
        onPointerCancel={endPreviewDrag}
        previewRef={previewStageRef}
        buttonClassName={styles.secondaryBtn}
        primaryButtonClassName={styles.primaryBtn}
        onZoomOut={() => nudgeZoom(-0.08)}
        onZoomIn={() => nudgeZoom(0.08)}
        onContain={() =>
          activeEditorImageKey &&
          setContainMode(activeImageChannel, activeEditorImageKey)
        }
        onCover={() =>
          activeEditorImageKey &&
          setCoverMode(activeImageChannel, activeEditorImageKey)
        }
        onReset={() =>
          activeEditorImageKey &&
          resetChannelImage(activeImageChannel, activeEditorImageKey)
        }
        onDoubleClick={() =>
          activeEditorImageKey &&
          updateChannelTransform(activeImageChannel, activeEditorImageKey, {
            offsetX: 0,
            offsetY: 0,
          })
        }
        onSave={closeImageEditor}
        onApplyToChannelImages={
          (channelImageEditors[activeImageChannel]?.imageKeys || []).length > 1
            ? applyCurrentCadrageToActiveChannelImages
            : undefined
        }
        onResetChannel={
          (channelImageEditors[activeImageChannel]?.imageKeys || []).length
            ? resetActiveChannelImages
            : undefined
        }
        isolationNote={`Ce réglage concerne uniquement ${getImageAdapterLabel(activeImageChannel)}. Les autres canaux restent indépendants.${activeImageChannel === "gmb" ? " Fond transparent = export sur fond blanc pour un rendu propre sur Google Business." : ""}`}
        onApplyToSelectedChannels={
          activeImageChannel === "inrcy_site" ||
          activeImageChannel === "site_web"
            ? undefined
            : applyCurrentImageToSelectedChannels
        }
        onBackgroundModeChange={(mode) =>
          activeEditorImageKey &&
          updateChannelTransform(
            activeImageChannel,
            activeEditorImageKey,
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
                        : activeEditorTransform.backgroundColor ||
                          (getChannelSafetyBackgroundMode(activeImageChannel) === "black"
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
          activeEditorImageKey &&
          updateChannelTransform(activeImageChannel, activeEditorImageKey, {
            backgroundMode: "color",
            backgroundColor: color,
            blurBackground: false,
            fit: "contain",
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
          })
        }
        pillButtonStyle={pillBtn}
        pillButtonActiveStyle={pillBtnActive}
        sidebarItems={imageKeys.map((key, index) => {
          const included = (
            channelImageEditors[activeImageChannel]?.imageKeys || []
          ).includes(key);
          const transform =
            channelImageEditors[activeImageChannel]?.transforms?.[key] ||
            getOptimizedTransform(activeImageChannel, imageMetaByKey[key]);
          return {
            key,
            previewUrl: previewByKey[key],
            title: `Image ${index + 1}`,
            subtitle: included
              ? "Publiée sur ce canal"
              : "Non envoyée sur ce canal",
            fitLabel: getImageFitLabel(transform),
            active: key === activeEditorImageKey,
            onClick: () =>
              setActiveImageKeyByChannel((prev) => ({
                ...prev,
                [activeImageChannel]: key,
              })),
          };
        })}
          />

          <PublishFooterActions
            styles={styles}
            publishAreaRef={publishAreaRef}
            saving={saving}
            scheduling={scheduleSaving}
            draftSaving={draftSaving}
            publishProgress={publishProgress}
            publishProgressLabel={publishProgressLabel}
            publishProgressPhaseIndex={publishProgressPhaseIndex}
            publishProgressPhaseTotal={PUBLICATION_PROGRESS_STAGES.length}
            publishProgressPhaseLabel={publishProgressPhaseLabel}
            publishError={publishError}
            onPublish={onPublish}
            onSchedule={openSchedulePublicationModal}
          />
        </>
      ) : null}
    </div>
  );
}
