import { useLocale, useTranslations } from "next-intl";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
  type BoosterVideoTransformedVariant,
} from "@/lib/boosterVideoTransforms";
import {
  VIDEO_FORMAT_ASPECT_RATIOS,
  VIDEO_FORMAT_OPTIONS_BY_CHANNEL,
  getRecommendedVideoFormatForSource,
  getLocalizedVideoAdaptationModeLabel,
  getLocalizedVideoFormatLabel,
  getLocalizedVideoOrientationLabel,
  type BoosterVideoSourceMetadata,
  type ChannelKey,
  type VideoAdaptationMode,
  type VideoFormat,
} from "../publishModal.shared";

export type BoosterVideoPreparationState = {
  status: "idle" | "preparing" | "ready" | "error";
  label: string;
  detail?: string;
};

function formatVideoSeconds(seconds: number | null | undefined) {
  if (!Number.isFinite(Number(seconds))) return "";
  const safeSeconds = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type BoosterTranslator = (key: string, values?: Record<string, string | number>) => string;

function formatVideoBytes(
  bytes: number | null | undefined,
  locale: string,
  translate: BoosterTranslator,
) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return translate("video_weight_unknown");
  const format = (amount: number, maximumFractionDigits = 0) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits }).format(amount);
  if (value >= 1024 * 1024) {
    return translate("video_size_megabytes", {
      value: format(value / (1024 * 1024), value >= 10 * 1024 * 1024 ? 0 : 1),
    });
  }
  if (value >= 1024) return translate("video_size_kilobytes", { value: format(Math.round(value / 1024)) });
  return translate("video_size_bytes", { value: format(Math.round(value)) });
}

function getVideoSourceSummary(
  meta: BoosterVideoSourceMetadata | null | undefined,
  fallbackDuration: number | null | undefined,
  fallbackSize: number | null | undefined,
  locale: string,
  translate: BoosterTranslator,
) {
  const duration = formatVideoSeconds(meta?.duration ?? fallbackDuration ?? null);
  const dimension = meta?.width && meta?.height
    ? `${meta.width}×${meta.height}`
    : translate("video_dimensions_unknown");
  const orientation = getLocalizedVideoOrientationLabel(meta?.orientation, translate);
  const ratio = meta?.width && meta?.height && meta.ratioLabel ? meta.ratioLabel : null;
  const size = formatVideoBytes(meta?.size || fallbackSize || 0, locale, translate);
  return [orientation, ratio, dimension, duration ? duration : null, size].filter(Boolean).join(" · ");
}

function getVideoTechnicalDetails(
  meta: BoosterVideoSourceMetadata | null | undefined,
  translate: BoosterTranslator,
) {
  return [
    meta?.width && meta?.height
      ? translate("video_resolution", { width: meta.width, height: meta.height })
      : null,
    meta?.width && meta?.height && meta.ratioLabel
      ? translate("video_ratio", { ratio: meta.ratioLabel })
      : null,
    meta?.orientation
      ? translate("video_source_orientation", {
          orientation: getLocalizedVideoOrientationLabel(meta.orientation, translate),
        })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function getVideoPreviewAspectRatio(format: VideoFormat, metadata?: BoosterVideoSourceMetadata | null) {
  if (format === "original" && metadata?.width && metadata?.height) {
    return `${metadata.width} / ${metadata.height}`;
  }
  return VIDEO_FORMAT_ASPECT_RATIOS[format] || "16 / 9";
}

function getVideoFrameWidth(params: {
  format: VideoFormat;
  metadata?: BoosterVideoSourceMetadata | null;
  isMobile: boolean;
}) {
  const { format, metadata, isMobile } = params;
  const orientation = metadata?.orientation || "unknown";

  if (format === "9_16") return isMobile ? "min(76%, 220px)" : "210px";
  if (format === "1_1") return isMobile ? "min(100%, 280px)" : "270px";
  if (format === "16_9") return isMobile ? "100%" : "360px";

  if (orientation === "vertical") return isMobile ? "min(76%, 220px)" : "210px";
  if (orientation === "square") return isMobile ? "min(100%, 280px)" : "270px";
  return isMobile ? "100%" : "360px";
}

function getPreparationTone(state?: BoosterVideoPreparationState | null) {
  if (state?.status === "ready") return { icon: "✅", color: "#bbf7d0", border: "rgba(34,197,94,0.28)", background: "rgba(34,197,94,0.10)" };
  if (state?.status === "preparing") return { icon: "⏳", color: "#bfdbfe", border: "rgba(96,165,250,0.30)", background: "rgba(59,130,246,0.12)" };
  if (state?.status === "error") return { icon: "⚠️", color: "#fecaca", border: "rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.10)" };
  return { icon: "⚙️", color: "rgba(226,232,240,0.76)", border: "rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.055)" };
}

export default function BoosterVideoFormatManager({
  isMobile,
  channel,
  videoName,
  videoDisplayUrl,
  videoSize,
  videoDurationSeconds,
  videoSourceMetadata,
  currentFormat,
  adaptationMode,
  videoTransformedVariants = [],
  preparationState,
  preparing = false,
  deferTechnicalPreparationUntilPublish = false,
  onFormatChange,
  onAdaptationModeChange,
  onApplyFormat,
  onApplyFormatToAllChannels,
  onRemoveFromChannel,
  onDeleteVideo,
  removeFromChannelLabel,
  deleteVideoLabel,
  onPickVideoClick,
  pickVideoLabel,
  showApplyAll = true,
  buttonClassName,
  compact = false,
}: {
  isMobile: boolean;
  channel: ChannelKey;
  videoName?: string | null;
  videoDisplayUrl: string;
  videoSize?: number | null;
  videoDurationSeconds?: number | null;
  videoSourceMetadata?: BoosterVideoSourceMetadata | null;
  currentFormat: VideoFormat;
  adaptationMode: VideoAdaptationMode;
  videoTransformedVariants?: BoosterVideoTransformedVariant[];
  preparationState?: BoosterVideoPreparationState | null;
  preparing?: boolean;
  deferTechnicalPreparationUntilPublish?: boolean;
  onFormatChange?: (format: VideoFormat) => void;
  onAdaptationModeChange?: (mode: VideoAdaptationMode) => void;
  onApplyFormat?: () => void;
  onApplyFormatToAllChannels?: () => void;
  onRemoveFromChannel?: () => void;
  onDeleteVideo?: () => void;
  removeFromChannelLabel?: string;
  deleteVideoLabel?: string;
  onPickVideoClick?: () => void;
  pickVideoLabel?: string;
  showApplyAll?: boolean;
  buttonClassName?: string;
  compact?: boolean;
}) {
  const locale = useLocale();
  const i18nT = useTranslations("booster") as unknown as BoosterTranslator;
  const resolvedRemoveFromChannelLabel =
    removeFromChannelLabel || i18nT("retirer_de_ce_canal_76fbf864");
  const resolvedDeleteVideoLabel =
    deleteVideoLabel || i18nT("supprimer_partout_dfb790c4");
  const resolvedPickVideoLabel =
    pickVideoLabel || i18nT("remplacer_la_video_f6f7fbb3");
  const smartRecommendedFormat = getRecommendedVideoFormatForSource(channel, videoSourceMetadata);
  const videoFormatOptions = [
    smartRecommendedFormat,
    ...(VIDEO_FORMAT_OPTIONS_BY_CHANNEL[channel] || ["original"]),
  ].filter((format, index, arr) => arr.indexOf(format) === index);
  const sourceSummary = getVideoSourceSummary(
    videoSourceMetadata,
    videoDurationSeconds,
    videoSize,
    locale,
    i18nT,
  );
  const technicalDetails = getVideoTechnicalDetails(videoSourceMetadata, i18nT);
  const aspectRatio = getVideoPreviewAspectRatio(currentFormat, videoSourceMetadata);
  const signature = buildVideoTransformSignature(
    currentFormat,
    adaptationMode,
    getVideoPublicationProfileForChannel(channel),
  );
  const exactPreparedVariant = videoTransformedVariants.find((variant) => variant.signature === signature);
  const preparedVariant = exactPreparedVariant || null;
  // An old variant for the same channel is not proof that the pro selected it
  // for this publication. Original remains active until an exact applied
  // signature exists.
  // Avec le pipeline durable, le choix du pro est enregistré immédiatement.
  // La dérivée technique est créée après le clic sur Publier et ne doit pas
  // imposer un second bouton ni un état d'attente dans le bloc Médias.
  const appliedFormat = deferTechnicalPreparationUntilPublish
    ? currentFormat
    : exactPreparedVariant?.format || "original";
  const hasPendingFormat =
    !deferTechnicalPreparationUntilPublish && currentFormat !== appliedFormat;
  const displayUrl = String(preparedVariant?.publicUrl || preparedVariant?.url || "").trim() || videoDisplayUrl;
  const isApplied = Boolean(preparedVariant?.publicUrl || preparedVariant?.url);
  const isHorizontalSource = videoSourceMetadata?.orientation === "horizontal";
  const isVerticalDestination = currentFormat === "9_16";
  const isTikTokHorizontalRecommended = (channel === "tiktok" || channel === "youtube_shorts") && isHorizontalSource && smartRecommendedFormat === "16_9";
  const frameWidth = getVideoFrameWidth({ format: currentFormat, metadata: videoSourceMetadata, isMobile });
  const usesSafeFramePreview = !isApplied && adaptationMode === "safe_frame" && currentFormat !== "original";
  const targetRatio = VIDEO_FORMAT_ASPECT_RATIOS[currentFormat] || "16 / 9";
  const [targetWidth, targetHeight] = targetRatio
    .split("/")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const sourceRatio = videoSourceMetadata?.width && videoSourceMetadata?.height ? videoSourceMetadata.width / videoSourceMetadata.height : 16 / 9;
  const frameRatio = targetWidth && targetHeight ? targetWidth / targetHeight : sourceRatio;
  const sourceIsWiderThanFrame = sourceRatio >= frameRatio;
  const btnClass = buttonClassName || "";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : "minmax(260px, 0.92fr) minmax(320px, 1.08fr)",
        alignItems: "stretch",
        gap: isMobile ? 12 : 16,
        borderRadius: 16,
        padding: isMobile ? 10 : 14,
        border: "1px solid rgba(76,195,255,0.22)",
        background: "#122033",
        isolation: "isolate",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateRows: "auto auto minmax(0, auto) auto",
          alignContent: "start",
          gap: isMobile ? 9 : 10,
          minWidth: 0,
          borderRadius: 14,
          padding: isMobile ? 0 : 2,
        }}
      >
        <strong
          title={videoName || i18nT("video_selected")}
          style={{
            fontSize: isMobile ? 12 : 13,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.25,
            color: "rgba(248,250,252,0.94)",
          }}
        >
          {videoName || i18nT("video_selectionnee_6124b660")}
        </strong>

        {sourceSummary ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-start",
              justifySelf: isMobile ? "center" : "start",
              maxWidth: "100%",
              borderRadius: 999,
              padding: "5px 9px",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(15,23,42,0.46)",
              color: "rgba(226,232,240,0.82)",
              fontSize: 11,
              fontWeight: 800,
              lineHeight: 1.25,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={sourceSummary}
          >
            {sourceSummary}
          </div>
        ) : null}

        {displayUrl ? (
          <div
            style={{
              width: frameWidth,
              maxWidth: "100%",
              marginInline: "auto",
              aspectRatio,
              borderRadius: 14,
              background: "#0b1220",
              overflow: "hidden",
              border: "4px solid #020617",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "none",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                zIndex: 2,
                borderRadius: 999,
                padding: "4px 8px",
                background: isApplied ? "rgba(22,163,74,0.86)" : "rgba(15,23,42,0.82)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 950,
                letterSpacing: "0.01em",
                boxShadow: "0 8px 18px rgba(0,0,0,0.26)",
                pointerEvents: "none",
              }}
            >
              {isApplied ? i18nT("format_applique_43fe4a7e") : i18nT("apercu_du_format_babb12e0")}
            </div>
            <video
              src={displayUrl}
              controls
              playsInline
              preload="metadata"
              style={{
                position: "relative",
                zIndex: 1,
                width: usesSafeFramePreview ? (sourceIsWiderThanFrame ? "100%" : "auto") : "100%",
                height: usesSafeFramePreview ? (sourceIsWiderThanFrame ? "auto" : "100%") : "100%",
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: isApplied ? "contain" : adaptationMode === "cover_crop" ? "cover" : "contain",
                borderRadius: 10,
                background: "#0b1220",
                display: "block",
                boxShadow: "none",
              }}
            />
          </div>
        ) : (
          <div
            style={{
              borderRadius: 14,
              border: "1px dashed rgba(255,255,255,0.16)",
              padding: "24px 16px",
              color: "rgba(226,232,240,0.70)",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {i18nT("aucune_video_selectionnee_2f7f03d2")}{" "}</div>
        )}

        {technicalDetails ? (
          <div
            style={{
              display: "grid",
              gap: 3,
              borderRadius: 12,
              padding: "8px 10px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(15,23,42,0.28)",
              color: "rgba(226,232,240,0.66)",
              fontSize: 10.5,
              lineHeight: 1.35,
              fontWeight: 750,
            }}
          >
            <span style={{ color: "rgba(226,232,240,0.82)", fontWeight: 900 }}>
              {i18nT("infos_techniques_7fe7c797")}{" "}</span>
            <span>{technicalDetails}</span>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          alignContent: "start",
          gap: isMobile ? 10 : 12,
          minWidth: 0,
          borderRadius: 14,
          padding: isMobile ? 10 : 12,
          border: "1px solid rgba(255,255,255,0.09)",
          background: "#111a2b",
        }}
      >
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 950, color: "rgba(248,250,252,0.92)", letterSpacing: "0.01em" }}>
            {i18nT("modification_e3ea079d")}{" "}</div>
          {onRemoveFromChannel || onDeleteVideo ? (
            <div style={{ display: isMobile ? "grid" : "inline-flex", gridTemplateColumns: isMobile && onRemoveFromChannel && onDeleteVideo ? "minmax(0, 1fr) minmax(0, 1fr)" : undefined, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 6, flex: isMobile ? "1 1 auto" : "0 0 auto", width: isMobile ? "100%" : "auto", maxWidth: "100%", minWidth: 0 }}>
              {onRemoveFromChannel ? (
                <button
                  type="button"
                  className={btnClass}
                  onClick={onRemoveFromChannel}
                  title={resolvedRemoveFromChannelLabel}
                  aria-label={resolvedRemoveFromChannelLabel}
                  style={{ minWidth: 0, maxWidth: "100%", minHeight: 28, padding: "4px 7px", fontSize: 10.5, opacity: 0.78, whiteSpace: isMobile ? "normal" : "nowrap", overflowWrap: "anywhere" }}
                >
                  {resolvedRemoveFromChannelLabel}
                </button>
              ) : null}
              {onDeleteVideo ? (
                <button
                  type="button"
                  className={btnClass}
                  onClick={onDeleteVideo}
                  title={resolvedDeleteVideoLabel}
                  aria-label={resolvedDeleteVideoLabel}
                  style={{
                    minHeight: 28,
                    minWidth: 0,
                    maxWidth: "100%",
                    padding: "4px 7px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 5,
                    fontSize: 10.5,
                    color: "#fecaca",
                    borderColor: "rgba(248,113,113,0.34)",
                    background: "rgba(248,113,113,0.10)",
                    whiteSpace: isMobile ? "normal" : "nowrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {resolvedDeleteVideoLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: "grid", gap: 7, width: "100%", minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(226,232,240,0.78)" }}>{i18nT("format_actuel_07def762")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: isMobile ? "center" : "flex-start" }}>
            {videoFormatOptions.map((format) => {
              const applied = appliedFormat === format;
              const pending = hasPendingFormat && currentFormat === format;
              return (
                <button
                  key={format}
                  type="button"
                  onClick={() => onFormatChange?.(format)}
                  disabled={!onFormatChange}
                  title={
                    applied
                      ? deferTechnicalPreparationUntilPublish
                        ? i18nT("video_format_selected_for_publication")
                        : i18nT("video_format_active_for_publication")
                      : pending
                        ? i18nT("video_format_selected_to_apply")
                        : undefined
                  }
                  style={{
                    minHeight: 30,
                    borderRadius: 999,
                    padding: "5px 10px",
                    border: applied
                      ? "2px solid rgba(74,222,128,0.90)"
                      : pending
                        ? "2px solid rgba(251,191,36,0.92)"
                        : "1px solid rgba(255,255,255,0.13)",
                    background: applied
                      ? "rgba(34,197,94,0.14)"
                      : pending
                        ? "rgba(251,191,36,0.15)"
                        : "rgba(255,255,255,0.055)",
                    color: applied ? "#bbf7d0" : pending ? "#fde68a" : "rgba(255,255,255,0.78)",
                    boxShadow: applied
                      ? "0 0 0 1px rgba(74,222,128,0.22) inset, 0 0 14px rgba(74,222,128,0.14)"
                      : pending
                        ? "0 0 0 1px rgba(251,191,36,0.24) inset, 0 0 14px rgba(251,191,36,0.14)"
                        : undefined,
                    cursor: onFormatChange ? "pointer" : "default",
                    fontSize: 11,
                    fontWeight: 900,
                    whiteSpace: "nowrap",
                    opacity: onFormatChange ? 1 : 0.86,
                  }}
                >
                  {getLocalizedVideoFormatLabel(channel, format, videoSourceMetadata, i18nT)}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gap: 7, width: "100%", minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: "rgba(226,232,240,0.78)" }}>{i18nT("adaptation_1cda1dc6")}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: isMobile ? "center" : "flex-start" }}>
            {(["safe_frame", "cover_crop"] as const).map((mode) => {
              const active = adaptationMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onAdaptationModeChange?.(mode)}
                  disabled={!onAdaptationModeChange}
                  style={{
                    minHeight: 30,
                    borderRadius: 999,
                    padding: "5px 10px",
                    border: active ? "2px solid rgba(76,195,255,0.88)" : "1px solid rgba(255,255,255,0.13)",
                    background: active ? "rgba(76,195,255,0.14)" : "rgba(255,255,255,0.055)",
                    color: active ? "#e6f8ff" : "rgba(255,255,255,0.78)",
                    boxShadow: active ? "0 0 0 1px rgba(76,195,255,0.22) inset, 0 0 14px rgba(76,195,255,0.14)" : undefined,
                    cursor: onAdaptationModeChange ? "pointer" : "default",
                    fontSize: 11,
                    fontWeight: 900,
                    whiteSpace: "nowrap",
                    opacity: onAdaptationModeChange ? 1 : 0.86,
                  }}
                >
                  {getLocalizedVideoAdaptationModeLabel(mode, i18nT)}
                </button>
              );
            })}
          </div>
        </div>

        {isHorizontalSource && isVerticalDestination ? (
          <div
            style={{
              borderRadius: 12,
              padding: "8px 10px",
              border: "1px solid rgba(251,191,36,0.24)",
              background: "rgba(251,191,36,0.10)",
              color: "#fde68a",
              fontSize: 11,
              lineHeight: 1.35,
              fontWeight: 800,
            }}
          >
            {i18nT("video_horizontale_detectee_le_9_16_23ada158")}{" "}</div>
        ) : isTikTokHorizontalRecommended ? (
          <div
            style={{
              borderRadius: 12,
              padding: "8px 10px",
              border: "1px solid rgba(96,165,250,0.24)",
              background: "rgba(59,130,246,0.10)",
              color: "#bfdbfe",
              fontSize: 11,
              lineHeight: 1.35,
              fontWeight: 800,
            }}
          >
            {i18nT("video_horizontale_detectee_tiktok_accepte_le_b3cfd59d")}{" "}</div>
        ) : null}

        {!deferTechnicalPreparationUntilPublish && preparationState ? (
          <div
            style={{
              display: "grid",
              gap: 3,
              borderRadius: 12,
              padding: "8px 10px",
              border: `1px solid ${getPreparationTone(preparationState).border}`,
              background: getPreparationTone(preparationState).background,
              color: getPreparationTone(preparationState).color,
              fontSize: 11,
              lineHeight: 1.35,
              fontWeight: 850,
            }}
            role={preparationState.status === "error" ? "alert" : "status"}
          >
            <span>{getPreparationTone(preparationState).icon} {preparationState.label}</span>
            {preparationState.detail ? <span style={{ opacity: 0.78, fontWeight: 750 }}>{preparationState.detail}</span> : null}
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: isMobile ? "stretch" : "flex-start" }}>
          {!deferTechnicalPreparationUntilPublish && onApplyFormat ? (
            <button
              type="button"
              className={btnClass}
              onClick={onApplyFormat}
              disabled={preparing || !displayUrl || !hasPendingFormat}
              style={{
                minHeight: 34,
                padding: "7px 12px",
                fontSize: 11.5,
                opacity: preparing || !displayUrl || !hasPendingFormat ? 0.52 : 1,
                cursor: preparing ? "wait" : !displayUrl || !hasPendingFormat ? "not-allowed" : "pointer",
                flex: isMobile ? "1 1 100%" : "0 0 auto",
                border: "1px solid rgba(76,195,255,0.32)",
                background: "rgba(76,195,255,0.12)",
              }}
            >
              {preparationState?.status === "ready" ? i18nT("format_applique_43fe4a7e") : preparing ? i18nT("modification_du_format_d563b6d2") : i18nT("appliquer_ce_format_17674f93")}
            </button>
          ) : null}
          {!deferTechnicalPreparationUntilPublish &&
          showApplyAll &&
          onApplyFormatToAllChannels ? (
            <button
              type="button"
              className={btnClass}
              onClick={onApplyFormatToAllChannels}
              disabled={preparing || !displayUrl || !hasPendingFormat}
              style={{
                minHeight: 34,
                padding: "7px 12px",
                fontSize: 11.5,
                opacity: preparing || !displayUrl || !hasPendingFormat ? 0.46 : 0.9,
                cursor: preparing ? "wait" : !displayUrl || !hasPendingFormat ? "not-allowed" : "pointer",
                flex: isMobile ? "1 1 100%" : "0 0 auto",
                border: "1px solid rgba(255,255,255,0.13)",
                background: "rgba(255,255,255,0.055)",
              }}
            >
              {preparing ? i18nT("modification_des_formats_453f198d") : i18nT("appliquer_ce_format_a_tous_les_e33366cc")}
            </button>
          ) : null}
        </div>

        {!deferTechnicalPreparationUntilPublish &&
        (onApplyFormat || (showApplyAll && onApplyFormatToAllChannels)) ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
              color: "rgba(226,232,240,0.84)",
              fontSize: 11.5,
              lineHeight: 1.35,
              fontWeight: 650,
            }}
          >
            <span aria-hidden="true" style={{ color: "#93c5fd", fontWeight: 900 }}>ⓘ</span>
            <span>{i18nT("une_modification_du_format_peut_prendre_723d2cf5")}</span>
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: isMobile ? "stretch" : "flex-start" }}>
          {onPickVideoClick ? (
            <button
              type="button"
              className={btnClass}
              onClick={onPickVideoClick}
              disabled={preparing}
              style={{
                minHeight: 34,
                padding: "7px 12px",
                fontSize: 11.5,
                opacity: preparing ? 0.56 : 0.9,
                cursor: preparing ? "wait" : "pointer",
                flex: isMobile ? "1 1 100%" : "0 0 auto",
                border: "1px solid rgba(255,255,255,0.13)",
                background: "rgba(255,255,255,0.055)",
              }}
            >
              {resolvedPickVideoLabel}
            </button>
          ) : null}
        </div>

        {compact ? (
          <div style={{ fontSize: 11, lineHeight: 1.45, color: "rgba(226,232,240,0.62)" }}>
            {i18nT("enregistrez_ensuite_la_modification_pour_republi_fd69cf2c")}{" "}</div>
        ) : null}
      </div>
    </div>
  );
}
