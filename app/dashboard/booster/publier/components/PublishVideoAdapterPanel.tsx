import { useTranslations } from "next-intl";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import BoosterVideoFormatManager, {
  type BoosterVideoPreparationState,
} from "./BoosterVideoFormatManager";
import {
  type BoosterVideoSourceMetadata,
  type ChannelKey,
  type VideoAdaptationMode,
  type VideoFormat,
} from "../publishModal.shared";

type PublishModalStyles = Readonly<Record<string, string>>;

export type PublishVideoVariantPreparationState = BoosterVideoPreparationState;

type PublishVideoAdapterPanelProps = {
  styles: PublishModalStyles;
  isMobile: boolean;
  activeChannel: ChannelKey;
  videoFile: File | null;
  videoPreviewUrl: string;
  videoDurationSeconds: number | null;
  videoSourceMetadata: BoosterVideoSourceMetadata | null;
  videoFormatByChannel: Partial<Record<ChannelKey, VideoFormat>>;
  setVideoFormatForChannel: (channel: ChannelKey, format: VideoFormat) => void;
  videoAdaptationModeByChannel: Partial<Record<ChannelKey, VideoAdaptationMode>>;
  setVideoAdaptationModeForChannel: (
    channel: ChannelKey,
    mode: VideoAdaptationMode,
  ) => void;
  videoVariantPreparationByChannel?: Partial<
    Record<ChannelKey, PublishVideoVariantPreparationState>
  >;
  videoTransformedVariants?: BoosterVideoTransformedVariant[];
  videoPreviewVariantsPreparing?: boolean;
  deferTechnicalPreparationUntilPublish?: boolean;
  onApplyVideoFormatForChannel?: (channel: ChannelKey) => void;
  onApplyVideoFormatToAllChannels?: (channel: ChannelKey) => void;
  onRemoveMediaFromChannel: (channel: ChannelKey) => void;
  onDeleteVideo: () => void;
};

export default function PublishVideoAdapterPanel({
  styles,
  isMobile,
  activeChannel,
  videoFile,
  videoPreviewUrl,
  videoDurationSeconds,
  videoSourceMetadata,
  videoFormatByChannel,
  setVideoFormatForChannel,
  videoAdaptationModeByChannel,
  setVideoAdaptationModeForChannel,
  videoVariantPreparationByChannel = {},
  videoTransformedVariants = [],
  videoPreviewVariantsPreparing = false,
  deferTechnicalPreparationUntilPublish = false,
  onApplyVideoFormatForChannel,
  onApplyVideoFormatToAllChannels,
  onRemoveMediaFromChannel,
  onDeleteVideo,
}: PublishVideoAdapterPanelProps) {
  const i18nT = useTranslations("booster");
  const hasVideoMedia = Boolean(videoFile || videoPreviewUrl);

  if (!hasVideoMedia) {
    return (
      <div style={{ fontSize: 13, opacity: 0.75 }}>
        {i18nT("ajoutez_une_video_ou_choisissez_photos_0fc6eb5c")}{" "}</div>
    );
  }

  const currentFormat =
    videoFormatByChannel[activeChannel] || "original";
  const adaptationMode = videoAdaptationModeByChannel[activeChannel] || "safe_frame";
  const preparationState = videoVariantPreparationByChannel[activeChannel] || null;

  return (
    <BoosterVideoFormatManager
      isMobile={isMobile}
      channel={activeChannel}
      videoName={videoFile?.name || i18nT("video_selected")}
      videoDisplayUrl={videoPreviewUrl}
      videoSize={videoFile?.size || videoSourceMetadata?.size || 0}
      videoDurationSeconds={videoDurationSeconds}
      videoSourceMetadata={videoSourceMetadata}
      currentFormat={currentFormat}
      adaptationMode={adaptationMode}
      videoTransformedVariants={videoTransformedVariants}
      preparationState={preparationState}
      preparing={videoPreviewVariantsPreparing}
      deferTechnicalPreparationUntilPublish={
        deferTechnicalPreparationUntilPublish
      }
      onFormatChange={(format) => setVideoFormatForChannel(activeChannel, format)}
      onAdaptationModeChange={(mode) =>
        setVideoAdaptationModeForChannel(activeChannel, mode)
      }
      onApplyFormat={
        onApplyVideoFormatForChannel
          ? () => onApplyVideoFormatForChannel(activeChannel)
          : undefined
      }
      onApplyFormatToAllChannels={
        onApplyVideoFormatToAllChannels
          ? () => onApplyVideoFormatToAllChannels(activeChannel)
          : undefined
      }
      onRemoveFromChannel={() => onRemoveMediaFromChannel(activeChannel)}
      onDeleteVideo={onDeleteVideo}
      buttonClassName={styles.secondaryBtn}
    />
  );
}
