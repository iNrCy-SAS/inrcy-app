import { useTranslations } from "next-intl";
import {
  getBoosterImageDisplayPlan,
  getBoosterImageRenderDimensions,
  getBoosterImageSequenceTargetRatio,
} from "@/lib/boosterImageDecision";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import { ChannelImageAdapterCardsPanel } from "@/app/dashboard/_components/ChannelImageAdapterTool";
import PublishVideoAdapterPanel, {
  type PublishVideoVariantPreparationState,
} from "./PublishVideoAdapterPanel";
import {
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_IMAGE_ACCEPT,
  getLocalizedBoosterImageFormats,
  getLocalizedBoosterImageLimits,
  getLocalizedBoosterMediaOptimization,
  getLocalizedBoosterRecommendedVideoDuration,
  getLocalizedBoosterSelectedMediaSummary,
  getLocalizedBoosterVideoFormats,
  getLocalizedBoosterVideoLimits,
  getLocalizedChannelLabel,
  getLocalizedUnavailableMediaModeMessage,
  CHANNEL_PRESETS,
  channelSupportsImages,
  channelSupportsTextOnly,
  getBackgroundMode,
  getChannelSafetyBackgroundMode,
  getOptimizedTransform,
  type ChannelImageEditorState,
  type ChannelKey,
  type ImageMeta,
  type ChannelMediaMode,
  type VideoAdaptationMode,
  type BoosterVideoSourceMetadata,
  type VideoFormat,
} from "../publishModal.shared";
import { pillBtn, pillBtnActive } from "../publishModal.styles";
import { getImageChannelAction } from "../imageChannelAssignment";
import { getVideoChannelAction } from "../videoChannelAssignment";
import PublishStepTitle from "./PublishStepTitle";

type PublishModalStyles = Readonly<Record<string, string>>;

function MediaModeGlyph({ mode, size = 14 }: { mode: ChannelMediaMode; size?: number }) {
  if (mode === "video") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flex: "0 0 auto" }}>
        <rect x="4" y="7" width="11" height="10" rx="2.2" />
        <path d="M15 10.2 20 7.8v8.4l-5-2.4z" />
      </svg>
    );
  }
  if (mode === "images") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flex: "0 0 auto" }}>
        <rect x="4" y="6" width="16" height="12" rx="2.2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="m7 17 4.2-4.2 2.7 2.7 1.6-1.6L20 18" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flex: "0 0 auto" }}>
      <circle cx="12" cy="12" r="8" />
      <path d="m8 8 8 8" />
    </svg>
  );
}

function getCompactChannelLabel(channel: ChannelKey, label: string) {
  if (channel === "gmb") return "Google";
  return label;
}

type ImageAdapterTab = {
  key: ChannelKey;
  label: string;
  count: number;
  tone: "ready" | "warning" | "blocked";
  message?: string;
  blockers?: string[];
};

type PublishImagesPanelProps = {
  styles: PublishModalStyles;
  isMobile: boolean;
  stepNumber: number;
  channelMediaModes: Partial<Record<ChannelKey, ChannelMediaMode>>;
  setChannelMediaMode: (channel: ChannelKey, mode: ChannelMediaMode) => void;
  onRemoveMediaFromChannel: (channel: ChannelKey) => void;
  videoFormatByChannel: Partial<Record<ChannelKey, VideoFormat>>;
  setVideoFormatForChannel: (channel: ChannelKey, format: VideoFormat) => void;
  videoAdaptationModeByChannel: Partial<Record<ChannelKey, VideoAdaptationMode>>;
  setVideoAdaptationModeForChannel: (channel: ChannelKey, mode: VideoAdaptationMode) => void;
  images: File[];
  videoFile: File | null;
  videoPreviewUrl: string;
  videoDurationSeconds: number | null;
  videoSourceMetadata: BoosterVideoSourceMetadata | null;
  videoVariantPreparationByChannel?: Partial<Record<ChannelKey, PublishVideoVariantPreparationState>>;
  videoTransformedVariants?: BoosterVideoTransformedVariant[];
  videoPreviewVariantsPreparing?: boolean;
  deferTechnicalPreparationUntilPublish?: boolean;
  onApplyVideoFormatForChannel?: (channel: ChannelKey) => void;
  onApplyVideoFormatToAllChannels?: (channel: ChannelKey) => void;
  removeVideo: () => void;
  imgError: string;
  showMediaOptimizerAction?: boolean;
  onOpenMediaOptimizer?: () => void;
  selectedChannels: ChannelKey[];
  activeImageChannel: ChannelKey;
  imageAdapterTabs: ImageAdapterTab[];
  imageKeys: string[];
  channelImageEditors: Partial<Record<ChannelKey, ChannelImageEditorState>>;
  imageMetaByKey: Record<string, ImageMeta>;
  previewByKey: Record<string, string>;
  previewAspectRatio: string;
  setSynchronizedActiveChannel: (channel: ChannelKey) => void;
  onPickImagesClick: () => void;
  onPickImagesForChannel: (channel: ChannelKey) => void;
  onUseExistingImagesForChannel: (channel: ChannelKey) => void;
  onRemoveImagesFromChannel: (channel: ChannelKey) => void;
  onPickVideoClick: () => void;
  onPickVideoForChannel: (channel: ChannelKey) => void;
  onTakePhotoClick: (preferredChannel?: ChannelKey) => void;
  toggleChannelImage: (channel: ChannelKey, imageKey: string) => void;
  openImageEditor: (channel: ChannelKey, imageKey: string) => void;
  resetChannelImage: (channel: ChannelKey, imageKey: string) => void;
  removeImage: (index: number) => void;
  moveChannelImage: (
    channel: ChannelKey,
    imageKey: string,
    direction: -1 | 1,
  ) => void;
};

export default function PublishImagesPanel({
  styles,
  isMobile,
  stepNumber,
  channelMediaModes,
  setChannelMediaMode,
  onRemoveMediaFromChannel,
  videoFormatByChannel,
  setVideoFormatForChannel,
  videoAdaptationModeByChannel,
  setVideoAdaptationModeForChannel,
  images,
  videoFile,
  videoPreviewUrl,
  videoDurationSeconds,
  videoSourceMetadata,
  videoVariantPreparationByChannel = {},
  videoTransformedVariants = [],
  videoPreviewVariantsPreparing = false,
  deferTechnicalPreparationUntilPublish = false,
  onApplyVideoFormatForChannel,
  onApplyVideoFormatToAllChannels,
  removeVideo,
  imgError,
  showMediaOptimizerAction = false,
  onOpenMediaOptimizer,
  selectedChannels,
  activeImageChannel,
  imageAdapterTabs,
  imageKeys,
  channelImageEditors,
  imageMetaByKey,
  previewByKey,
  previewAspectRatio,
  setSynchronizedActiveChannel,
  onPickImagesClick,
  onPickImagesForChannel,
  onUseExistingImagesForChannel,
  onRemoveImagesFromChannel,
  onPickVideoClick,
  onPickVideoForChannel,
  onTakePhotoClick,
  toggleChannelImage,
  openImageEditor,
  resetChannelImage,
  removeImage,
  moveChannelImage,
}: PublishImagesPanelProps) {
  const i18nT = useTranslations("booster");
  const runtimeT = i18nT as unknown as (
    key: string,
    values?: Record<string, string | number>,
  ) => string;
  const hasImages = images.length > 0;
  const hasVideoMedia = Boolean(videoFile || videoPreviewUrl);
  const imagesLimitReached = images.length >= BOOSTER_MAX_IMAGE_COUNT;
  const pickImagesDisabled = imagesLimitReached;
  const pickVideoDisabled = hasVideoMedia;
  const cameraDisabled = !isMobile || imagesLimitReached;
  const getModeForChannel = (channel: ChannelKey): ChannelMediaMode => {
    const explicit = channelMediaModes[channel];
    const channelHasImages =
      hasImages &&
      (channelImageEditors[channel]?.imageKeys?.length || 0) > 0;

    // A deliberate per-channel removal must always win, including TikTok and
    // YouTube. The channel remains selected and its readiness explains whether
    // a replacement media is required.
    if (explicit === "none") return "none";

    if (channel === "youtube_shorts") return hasVideoMedia ? "video" : "none";

    if (channel === "tiktok") {
      if (explicit === "video" && hasVideoMedia) return "video";
      if (explicit === "images" && channelHasImages) return "images";
      if (channelHasImages) return "images";
      if (hasVideoMedia) return "video";
      return "none";
    }

    if (explicit === "video" && hasVideoMedia) return "video";
    if (explicit === "images" && channelHasImages && channelSupportsImages(channel)) return "images";
    // Keep a selected channel visible after its media is removed. Required
    // media channels stay active and are blocked only until a replacement is
    // chosen.
    if (channelHasImages && channelSupportsImages(channel)) return "images";
    if (hasVideoMedia) return "video";
    return "none";
  };

  const mediaAllocation = selectedChannels.reduce(
    (summary, channel) => {
      summary[getModeForChannel(channel)] += 1;
      return summary;
    },
    { images: 0, video: 0, none: 0 } as Record<ChannelMediaMode, number>,
  );
  const allocationParts = [
    mediaAllocation.images
      ? i18nT("media_allocation_images", { count: mediaAllocation.images })
      : "",
    mediaAllocation.video
      ? i18nT("media_allocation_videos", { count: mediaAllocation.video })
      : "",
    mediaAllocation.none
      ? i18nT("media_allocation_none", { count: mediaAllocation.none })
      : "",
  ].filter(Boolean);

  const activeMode: ChannelMediaMode = getModeForChannel(activeImageChannel);
  const videoChannelAction = getVideoChannelAction({
    hasVideoSource: hasVideoMedia,
    mode: activeMode,
  });
  const imageChannelAction = getImageChannelAction({
    hasImagePool: hasImages,
    assignedImageCount:
      channelImageEditors[activeImageChannel]?.imageKeys?.length || 0,
    mode: activeMode,
  });
  const videoChannelActionLabel =
    videoChannelAction.kind === "selected"
      ? i18nT("video_304f6ca4")
      : videoChannelAction.kind === "reuse"
        ? i18nT("utiliser_la_meme_video_ici_7d817d29")
        : i18nT("ajouter_une_video_c0be31cb");
  const imageChannelActionLabel =
    imageChannelAction.kind === "selected"
      ? i18nT("photos_c8b2e864")
      : imageChannelAction.kind === "pick"
        ? i18nT("ajouter_des_images_79088d11")
        : i18nT("utiliser_les_images_existantes_ici_f482c30c");
  const activeMediaTab = imageAdapterTabs.find(
    (tab) => tab.key === activeImageChannel,
  );
  const activeMediaBlockers = activeMediaTab?.blockers || [];
  const activeImageEditor = channelImageEditors[activeImageChannel];
  const activeImageFirstKey = activeImageEditor?.imageKeys?.[0] || "";
  const activeImageSequenceTargetRatio = getBoosterImageSequenceTargetRatio({
    channel: activeImageChannel,
    metas: (activeImageEditor?.imageKeys || []).map(
      (key) => imageMetaByKey[key],
    ),
    firstImageCustomizedTargetRatio:
      activeImageChannel === "instagram" &&
      activeImageFirstKey &&
      (activeImageEditor?.customizedImageKeys || []).includes(activeImageFirstKey)
        ? CHANNEL_PRESETS.instagram.width / CHANNEL_PRESETS.instagram.height
        : null,
  });
  const getPreparationTone = (state?: PublishVideoVariantPreparationState) => {
    if (state?.status === "ready") return { icon: "✅", color: "#bbf7d0", border: "rgba(34,197,94,0.28)", background: "rgba(34,197,94,0.10)" };
    if (state?.status === "preparing") return { icon: "⏳", color: "#bfdbfe", border: "rgba(96,165,250,0.30)", background: "rgba(59,130,246,0.12)" };
    if (state?.status === "error") return { icon: "⚠️", color: "#fecaca", border: "rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.10)" };
    return { icon: "⚙️", color: "rgba(226,232,240,0.76)", border: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.055)" };
  };

  const getMediaCountForChannel = (channel: ChannelKey) => {
    const mode = getModeForChannel(channel);
    if (mode === "video") return hasVideoMedia ? 1 : 0;
    if (mode === "images" && channelSupportsImages(channel)) {
      return channelImageEditors[channel]?.imageKeys?.length || 0;
    }
    return 0;
  };

  const getMediaToneForChannel = (channel: ChannelKey): "ready" | "warning" | "blocked" => {
    const readinessTone = imageAdapterTabs.find(
      (tab) => tab.key === channel,
    )?.tone;
    if (readinessTone === "blocked") return "blocked";
    const mode = getModeForChannel(channel);
    const count = getMediaCountForChannel(channel);
    if (channel === "youtube_shorts") return hasVideoMedia ? "ready" : "blocked";
    if (channel === "tiktok") return count > 0 ? "ready" : "blocked";
    return count > 0 ? "ready" : "warning";
  };

  const getMediaIconForChannel = (channel: ChannelKey) => {
    const mode = getModeForChannel(channel);
    return mode;
  };

  const mediaModeButton = (
    mode: ChannelMediaMode,
    label: string,
    disabled = false,
    onActivate?: () => void,
  ) => {
    const active = activeMode === mode;
    const unsupportedMessage = getLocalizedUnavailableMediaModeMessage(
      activeImageChannel,
      mode,
      runtimeT,
    );
    const unavailable = Boolean(unsupportedMessage);
    const effectiveDisabled = disabled || unavailable;
    const translatedLabel = label;
    const accessibleLabel = i18nT("media_mode_for_channel", {
      mode: translatedLabel,
      channel: getLocalizedChannelLabel(activeImageChannel, runtimeT),
    });
    return (
      <button
        type="button"
        disabled={effectiveDisabled}
        aria-label={accessibleLabel}
        aria-pressed={active}
        title={unsupportedMessage || accessibleLabel}
        onClick={() => {
          if (effectiveDisabled) return;
          if (onActivate) {
            onActivate();
            return;
          }
          setChannelMediaMode(activeImageChannel, mode);
        }}
        style={{
          border: active
            ? "2px solid rgba(76,195,255,0.88)"
            : "1px solid rgba(255,255,255,0.13)",
          background: active
            ? "linear-gradient(135deg, rgba(36,145,190,0.34), rgba(124,92,255,0.22))"
            : "rgba(255,255,255,0.055)",
          color: active ? "#e6f8ff" : "rgba(255,255,255,0.76)",
          boxShadow: active ? "0 0 0 1px rgba(76,195,255,0.28) inset, 0 0 0 1px rgba(76,195,255,0.18), 0 0 14px rgba(76,195,255,0.16)" : undefined,
          borderRadius: 999,
          minHeight: isMobile ? 34 : 36,
          padding: isMobile ? "0 8px" : "0 14px",
          fontSize: isMobile ? 11 : 12,
          fontWeight: 900,
          cursor: effectiveDisabled ? "not-allowed" : "pointer",
          opacity: effectiveDisabled ? 0.45 : 1,
          whiteSpace: isMobile ? "normal" : "nowrap",
          flex: isMobile ? "1 1 0" : "0 0 auto",
          minWidth: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <MediaModeGlyph mode={mode} size={isMobile ? 13 : 14} />
        <span>{translatedLabel}</span>
      </button>
    );
  };

  return (
    <div
      className={styles.blockCard}
      style={{ minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <PublishStepTitle styles={styles} step={stepNumber}>
          {i18nT("medias_de_la_publication_12d110a4")}{" "}</PublishStepTitle>
      </div>
      <div
        className={styles.subtitle}
        style={{ marginBottom: 12, maxWidth: "none", whiteSpace: "normal" }}
      >
        {getLocalizedBoosterMediaOptimization("publication", runtimeT)}
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onPickImagesClick}
          disabled={pickImagesDisabled}
          aria-label={i18nT("ajouter_une_image_a_la_publication_c382ed8d")}
          title={
            imagesLimitReached
              ? i18nT("media_max_images", { count: BOOSTER_MAX_IMAGE_COUNT })
              : i18nT("media_add_image_details", {
                  limits: getLocalizedBoosterImageLimits(runtimeT),
                  formats: getLocalizedBoosterImageFormats(runtimeT),
                })
          }
          style={{
            opacity: pickImagesDisabled ? 0.48 : 1,
            filter: pickImagesDisabled ? "grayscale(1)" : undefined,
            cursor: pickImagesDisabled ? "not-allowed" : "pointer",
          }}
        >
          {i18nT("ajouter_une_image_c297ad3e")}{" "}</button>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={onPickVideoClick}
          disabled={pickVideoDisabled}
          title={
            pickVideoDisabled
              ? i18nT("media_max_one_video")
              : i18nT("media_video_details", {
                  limits: getLocalizedBoosterVideoLimits(runtimeT),
                  formats: getLocalizedBoosterVideoFormats(runtimeT),
                  duration: getLocalizedBoosterRecommendedVideoDuration(runtimeT),
                })
          }
          style={{
            opacity: pickVideoDisabled ? 0.48 : 1,
            filter: pickVideoDisabled ? "grayscale(1)" : undefined,
            cursor: pickVideoDisabled ? "not-allowed" : "pointer",
          }}
        >
          {i18nT("ajouter_une_video_c0be31cb")}{" "}</button>
        <span
          title={
            !isMobile
              ? i18nT("camera_mobile_only")
              : imagesLimitReached
                ? i18nT("media_max_images", { count: BOOSTER_MAX_IMAGE_COUNT })
                : i18nT("camera_open_to_take_photo")
          }
          style={{ display: "inline-flex" }}
        >
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={!cameraDisabled ? () => onTakePhotoClick() : undefined}
            disabled={cameraDisabled}
            aria-disabled={cameraDisabled}
            style={{
              opacity: cameraDisabled ? 0.48 : 1,
              filter: cameraDisabled ? "grayscale(1)" : undefined,
              cursor: cameraDisabled ? "not-allowed" : "pointer",
            }}
          >
            {i18nT("appareil_inrcy_89d04cc9")}{" "}</button>
        </span>
        <div
          style={{
            fontSize: 12,
            opacity: hasImages || hasVideoMedia ? 0.85 : 0.7,
            lineHeight: 1.45,
            minWidth: 0,
            overflowWrap: "anywhere",
          }}
        >
          {getLocalizedBoosterSelectedMediaSummary({
            imageCount: images.length,
            hasVideo: hasVideoMedia,
            context: "publication",
          }, runtimeT)}
          <span style={{ opacity: 0.74 }}>
            {hasImages ? ` · ${getLocalizedBoosterImageFormats(runtimeT)}` : ""}
            {hasVideoMedia
              ? ` · ${getLocalizedBoosterVideoFormats(runtimeT)} · ${getLocalizedBoosterRecommendedVideoDuration(runtimeT)}`
              : ""}
          </span>
        </div>
      </div>
      {imgError ? (
        <div
          style={{
            marginBottom: 10,
            display: "grid",
            justifyItems: "start",
            gap: 8,
            fontSize: 13,
            color: "#ffb4b4",
          }}
        >
          <span>{imgError}</span>
          {showMediaOptimizerAction && onOpenMediaOptimizer ? (
            <button
              type="button"
              onClick={() => onOpenMediaOptimizer()}
              style={{
                border: "1px solid rgba(105,239,255,0.42)",
                borderRadius: 999,
                background:
                  "linear-gradient(135deg, rgba(47,209,255,0.24), rgba(155,81,255,0.28))",
                color: "#effcff",
                padding: "9px 14px",
                fontSize: 12,
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              {i18nT("optimiser_le_media_1bc4fc40")}{" "}</button>
          ) : null}
        </div>
      ) : null}

      {selectedChannels.length ? (
        <div style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile
                ? "repeat(2, minmax(0, 1fr))"
                : "repeat(10, minmax(0, 1fr))",
              gap: isMobile ? 8 : 6,
              width: "100%",
              minWidth: 0,
              overflowX: "hidden",
              alignItems: "center",
              paddingBottom: 2,
            }}
          >
            {selectedChannels.map((channel) => {
              const count = getMediaCountForChannel(channel);
              const mediaIcon = getMediaIconForChannel(channel);
              const tone = getMediaToneForChannel(channel);
              const toneReady = tone === "ready";
              const toneBlocked = tone === "blocked";
              const mediaMessage = imageAdapterTabs.find(
                (tab) => tab.key === channel,
              )?.message;
              const isActive = activeImageChannel === channel;
              return (
                <button
                  key={channel}
                  type="button"
                  onClick={() => setSynchronizedActiveChannel(channel)}
                  title={mediaMessage || undefined}
                  aria-pressed={isActive}
                  aria-label={
                    toneBlocked && mediaMessage
                      ? `${getLocalizedChannelLabel(channel, runtimeT)} : ${mediaMessage}`
                      : undefined
                  }
                  style={{
                    minWidth: 0,
                    width: "100%",
                    boxSizing: "border-box",
                    minHeight: isMobile ? 43 : 38,
                    borderRadius: 999,
                    padding: isMobile ? "4px 6px" : "0 5px",
                    border: isActive
                      ? toneReady
                        ? "2px solid rgba(74,222,128,0.90)"
                        : toneBlocked
                          ? "2px solid rgba(248,113,113,0.92)"
                          : "2px solid rgba(250,204,21,0.92)"
                      : toneReady
                        ? "1px solid rgba(34,197,94,0.34)"
                        : toneBlocked
                          ? "1px solid rgba(248,113,113,0.42)"
                          : "1px solid rgba(251,191,36,0.36)",
                    background: toneReady
                      ? "rgba(34,197,94,0.10)"
                      : toneBlocked
                        ? "rgba(248,113,113,0.10)"
                        : "rgba(251,191,36,0.10)",
                    color: toneReady ? "#bbf7d0" : toneBlocked ? "#fecaca" : "#fde68a",
                    boxShadow: isActive
                      ? toneReady
                        ? "0 0 0 1px rgba(74,222,128,0.28) inset, 0 0 0 1px rgba(74,222,128,0.22), 0 0 18px rgba(74,222,128,0.22)"
                        : toneBlocked
                          ? "0 0 0 1px rgba(248,113,113,0.28) inset, 0 0 0 1px rgba(248,113,113,0.22), 0 0 18px rgba(248,113,113,0.18)"
                          : "0 0 0 1px rgba(250,204,21,0.28) inset, 0 0 0 1px rgba(250,204,21,0.22), 0 0 18px rgba(250,204,21,0.18)"
                      : undefined,
                    fontSize: isMobile ? "clamp(10px, 2.9vw, 12px)" : "clamp(8px, 0.72vw, 11.5px)",
                    fontWeight: 850,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: isMobile ? 4 : 5,
                    overflow: isMobile ? "visible" : "hidden",
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: isMobile ? "visible" : "hidden",
                      textOverflow: isMobile ? "clip" : "ellipsis",
                      whiteSpace: isMobile ? "normal" : "nowrap",
                      overflowWrap: isMobile ? "anywhere" : undefined,
                      textAlign: isMobile ? "center" : undefined,
                    }}
                  >
                    {getCompactChannelLabel(channel, getLocalizedChannelLabel(channel, runtimeT))}
                  </span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      minWidth: isMobile ? 14 : 20,
                      height: isMobile ? 16 : 20,
                      padding: isMobile ? "0 3px" : "0 6px",
                      borderRadius: 999,
                      display: "inline-grid",
                      placeItems: "center",
                      fontSize: "clamp(7px, 0.7vw, 11px)",
                      fontWeight: 900,
                      background: "rgba(255,255,255,0.12)",
                    }}
                  >
                    {count}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{
                      flex: "0 0 auto",
                      width: isMobile ? 12 : 16,
                      height: isMobile ? 12 : 16,
                      display: "inline-grid",
                      placeItems: "center",
                      opacity: toneReady ? 0.96 : 0.72,
                    }}
                  >
                    <MediaModeGlyph mode={mediaIcon} size={isMobile ? 11 : 14} />
                  </span>
                  {getModeForChannel(channel) === "video" && hasVideoMedia && videoVariantPreparationByChannel[channel]?.status ? (
                    <span
                      aria-hidden="true"
                      title={videoVariantPreparationByChannel[channel]?.label || i18nT("video_format")}
                      style={{
                        flex: "0 0 auto",
                        fontSize: 12,
                        lineHeight: 1,
                      }}
                    >
                      {getPreparationTone(videoVariantPreparationByChannel[channel]).icon}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div
            role="status"
            aria-label={i18nT("repartition_actuelle_des_medias_par_canal_538dffe4")}
            style={{
              display: "flex",
              alignItems: isMobile ? "flex-start" : "center",
              justifyContent: "space-between",
              gap: 8,
              flexDirection: isMobile ? "column" : "row",
              minWidth: 0,
              borderRadius: 13,
              padding: "9px 11px",
              border: "1px solid rgba(76,195,255,0.2)",
              background: "rgba(76,195,255,0.07)",
              color: "rgba(226,245,255,0.9)",
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            <strong style={{ minWidth: 0 }}>
              {i18nT("repartition_actuelle_8ccf5af1")}{" "}{allocationParts.join(" · ") || i18nT("aucun_media_30513906")}
            </strong>
            <span style={{ opacity: 0.7 }}>
              {i18nT("cliquez_sur_un_canal_puis_choisissez_f2189aac")}{" "}</span>
          </div>

          <div
            style={{
              display: "flex",
              gap: isMobile ? 6 : 8,
              flexWrap: isMobile ? "nowrap" : "wrap",
              alignItems: "center",
              width: "100%",
              minWidth: 0,
            }}
          >
            {mediaModeButton(
              "video",
              videoChannelActionLabel,
              false,
              () => {
                if (videoChannelAction.kind === "pick") {
                  onPickVideoForChannel(activeImageChannel);
                  return;
                }
                setChannelMediaMode(activeImageChannel, "video");
              },
            )}
            {mediaModeButton(
              "images",
              imageChannelActionLabel,
              !channelSupportsImages(activeImageChannel),
              () => {
                if (imageChannelAction.kind === "pick") {
                  onPickImagesForChannel(activeImageChannel);
                  return;
                }
                if (imageChannelAction.kind === "reuse") {
                  onUseExistingImagesForChannel(activeImageChannel);
                  return;
                }
                setChannelMediaMode(activeImageChannel, "images");
              },
            )}
            {mediaModeButton("none", i18nT("media_none"), !channelSupportsTextOnly(activeImageChannel))}
          </div>

          {activeMediaBlockers.length ? (
            <div
              role="alert"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                borderRadius: 14,
                padding: "11px 13px",
                border: "1px solid rgba(248,113,113,0.38)",
                background: "rgba(248,113,113,0.11)",
                color: "#fecaca",
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <span aria-hidden="true" style={{ flex: "0 0 auto" }}>
                ⛔
              </span>
              <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <strong>
                  {i18nT("media_incompatible_pour_value_20130e10", { value0: getLocalizedChannelLabel(activeImageChannel, runtimeT) })}</strong>
                {activeMediaBlockers.map((blocker) => (
                  <span key={blocker}>{blocker}</span>
                ))}
              </div>
            </div>
          ) : null}

          {activeMode === "none" ? (
            <div
              style={{
                borderRadius: 16,
                padding: "18px 16px",
                border: "1px solid rgba(251,191,36,0.22)",
                background: "rgba(251,191,36,0.08)",
                color: "#fde68a",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              {!channelSupportsTextOnly(activeImageChannel)
                ? getLocalizedUnavailableMediaModeMessage(activeImageChannel, "none", runtimeT) ||
                  i18nT("ce_canal_necessite_un_media_848df7b6")
                : i18nT("ce_canal_publiera_uniquement_le_texte_dbcc6b36")}
            </div>
          ) : activeMode === "video" ? (
            <PublishVideoAdapterPanel
              styles={styles}
              isMobile={isMobile}
              activeChannel={activeImageChannel}
              videoFile={videoFile}
              videoPreviewUrl={videoPreviewUrl}
              videoDurationSeconds={videoDurationSeconds}
              videoSourceMetadata={videoSourceMetadata}
              videoFormatByChannel={videoFormatByChannel}
              setVideoFormatForChannel={setVideoFormatForChannel}
              videoAdaptationModeByChannel={videoAdaptationModeByChannel}
              setVideoAdaptationModeForChannel={setVideoAdaptationModeForChannel}
              videoVariantPreparationByChannel={videoVariantPreparationByChannel}
              videoTransformedVariants={videoTransformedVariants}
              videoPreviewVariantsPreparing={videoPreviewVariantsPreparing}
              deferTechnicalPreparationUntilPublish={
                deferTechnicalPreparationUntilPublish
              }
              onApplyVideoFormatForChannel={onApplyVideoFormatForChannel}
              onApplyVideoFormatToAllChannels={onApplyVideoFormatToAllChannels}
              onRemoveMediaFromChannel={onRemoveMediaFromChannel}
              onDeleteVideo={removeVideo}
            />
          ) : !images.length ? (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              {activeImageChannel === "youtube_shorts"
                ? i18nT("ajoutez_une_video_pour_publier_sur_25b3629b")
                : activeImageChannel === "tiktok"
                  ? i18nT("ajoutez_une_photo_ou_une_video_a053ec3d")
                  : i18nT("ajoutez_une_ou_plusieurs_images_ou_5e529a68")}
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginBottom: 2,
                }}
              >
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() =>
                    onRemoveImagesFromChannel(activeImageChannel)
                  }
                  title={i18nT("retirer_les_images_de_value_sans_2fc93efd", { value0: getLocalizedChannelLabel(activeImageChannel, runtimeT) })}
                  aria-label={i18nT("retirer_les_images_de_ce_canal_87c1a09b", { value0: getLocalizedChannelLabel(activeImageChannel, runtimeT) })}
                  style={{
                    minHeight: 30,
                    padding: "4px 10px",
                    fontSize: 11,
                    opacity: 0.82,
                  }}
                >
                  {i18nT("retirer_les_images_de_ce_canal_b025e5ef")}{" "}</button>
              </div>
              <ChannelImageAdapterCardsPanel
                tabs={imageAdapterTabs}
                activeChannel={activeImageChannel}
                onActiveChannelChange={(key) =>
                  setSynchronizedActiveChannel(key as ChannelKey)
                }
                channelTitle={getLocalizedChannelLabel(activeImageChannel, runtimeT)}
                formatLabel={i18nT("rendu_intelligent_par_image_f1db3463")}
                aspectRatio={previewAspectRatio}
                items={imageKeys.map((key, index) => {
                  const selectedKeysForActiveChannel =
                    channelImageEditors[activeImageChannel]?.imageKeys || [];
                  const included = selectedKeysForActiveChannel.includes(key);
                  const usedChannelCount = selectedChannels.filter((channel) =>
                    (channelImageEditors[channel]?.imageKeys || []).includes(key),
                  ).length;
                  const automaticTransform = getOptimizedTransform(
                    activeImageChannel,
                    imageMetaByKey[key],
                  );
                  const currentTransform =
                    channelImageEditors[activeImageChannel]?.transforms?.[key] ||
                    automaticTransform;
                  const explicitlyCustomized = (
                    channelImageEditors[activeImageChannel]?.customizedImageKeys || []
                  ).includes(key);
                  const displayPlan = getBoosterImageDisplayPlan({
                    channel: activeImageChannel,
                    meta: imageMetaByKey[key],
                    customized: explicitlyCustomized,
                    currentTransform,
                    automaticTransform,
                    requiredTargetRatio: activeImageSequenceTargetRatio,
                  });
                  const decision = displayPlan.decision;
                  const sourceMeta = imageMetaByKey[key];
                  const channelPreset = CHANNEL_PRESETS[activeImageChannel];

                  const previewPreset = (() => {
                    if (decision.mode === "original" && sourceMeta?.width && sourceMeta?.height) {
                      return { width: sourceMeta.width, height: sourceMeta.height };
                    }
                    if (decision.mode === "adapted" && displayPlan.previewRatio) {
                      return getBoosterImageRenderDimensions({
                        baseWidth: channelPreset.width,
                        baseHeight: channelPreset.height,
                        targetRatio: displayPlan.previewRatio,
                      });
                    }
                    if (
                      decision.mode === "customized" &&
                      activeImageChannel === "instagram" &&
                      activeImageSequenceTargetRatio
                    ) {
                      return getBoosterImageRenderDimensions({
                        baseWidth: channelPreset.width,
                        baseHeight: channelPreset.height,
                        targetRatio: activeImageSequenceTargetRatio,
                      });
                    }
                    return channelPreset;
                  })();

                  const previewTransform = (() => {
                    if (decision.mode === "customized") return currentTransform;
                    if (decision.mode === "adapted") {
                      return {
                        ...automaticTransform,
                        fit: displayPlan.automaticFit,
                        zoom: 1,
                        offsetX: 0,
                        offsetY: 0,
                        blurBackground: false,
                        backgroundMode:
                          displayPlan.automaticFit === "contain"
                            ? getChannelSafetyBackgroundMode(activeImageChannel)
                            : ("black" as const),
                        backgroundColor: undefined,
                      };
                    }
                    return {
                      ...automaticTransform,
                      fit: "contain" as const,
                      zoom: 1,
                      offsetX: 0,
                      offsetY: 0,
                      blurBackground: false,
                      backgroundMode: getChannelSafetyBackgroundMode(activeImageChannel),
                      backgroundColor: undefined,
                    };
                  })();

                  const previewAspectRatio = `${previewPreset.width} / ${previewPreset.height}`;
                  const bgMode = getBackgroundMode(previewTransform);
                  return {
                    key,
                    previewUrl: previewByKey[key],
                    included,
                    disabled: false,
                    title: i18nT("image_value_5907a7ef", { value0: index + 1 }),
                    subtitle: included
                      ? i18nT("image_usage_included", { count: usedChannelCount })
                      : i18nT("image_usage_excluded", { count: usedChannelCount }),
                    fitLabel: runtimeT(
                      decision.mode === "original"
                        ? "image_decision_original"
                        : decision.mode === "adapted"
                          ? "image_decision_adapted"
                          : decision.mode === "customized"
                            ? "image_decision_customized"
                            : "image_decision_unavailable",
                    ),
                    previewAspectRatio,
                    backgroundMode: bgMode,
                    backgroundColor: previewTransform.backgroundColor,
                    transform: previewTransform,
                    preset: previewPreset,
                    imageMeta: sourceMeta,
                    onToggle: () => toggleChannelImage(activeImageChannel, key),
                    onAdapt: () => openImageEditor(activeImageChannel, key),
                    onReset: () => resetChannelImage(activeImageChannel, key),
                    onRemove: included
                      ? () => toggleChannelImage(activeImageChannel, key)
                      : undefined,
                    removeLabel: i18nT("retirer_de_ce_canal_76fbf864"),
                    onRemoveEverywhere: () => removeImage(index),
                    removeEverywhereLabel: i18nT("supprimer_partout_dfb790c4"),
                    onMovePrevious:
                      included && selectedKeysForActiveChannel.indexOf(key) > 0
                        ? () => moveChannelImage(activeImageChannel, key, -1)
                        : undefined,
                    onMoveNext:
                      included &&
                      selectedKeysForActiveChannel.indexOf(key) >= 0 &&
                      selectedKeysForActiveChannel.indexOf(key) <
                        selectedKeysForActiveChannel.length - 1
                        ? () => moveChannelImage(activeImageChannel, key, 1)
                        : undefined,
                  };
                })}
                buttonClassName={styles.secondaryBtn}
                pillButtonStyle={pillBtn}
                pillButtonActiveStyle={pillBtnActive}
                showTabs={false}
              />
            </>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          {i18nT("selectionnez_d_abord_vos_canaux_224225ce")}{" "}</div>
      )}
    </div>
  );
}
