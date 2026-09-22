import { useTranslations } from "next-intl";

import type {
  BoosterVideoSourceMetadata,
  ChannelKey,
} from "../publishModal.shared";

type PublishModalStyles = Readonly<Record<string, string>>;

type PublishVideoAdapterPanelProps = {
  styles: PublishModalStyles;
  isMobile: boolean;
  activeChannel: ChannelKey;
  videoFile: File | null;
  videoPreviewUrl: string;
  videoDurationSeconds: number | null;
  videoSourceMetadata: BoosterVideoSourceMetadata | null;
  onRetouchVideo: (channel: ChannelKey) => void;
  onRemoveMediaFromChannel: (channel: ChannelKey) => void;
  onDeleteVideo: () => void;
};

function formatDuration(seconds: number | null | undefined) {
  const safe = Number(seconds || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "";
  const rounded = Math.round(safe);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export default function PublishVideoAdapterPanel({
  styles,
  isMobile,
  activeChannel,
  videoFile,
  videoPreviewUrl,
  videoDurationSeconds,
  videoSourceMetadata,
  onRetouchVideo,
  onRemoveMediaFromChannel,
  onDeleteVideo,
}: PublishVideoAdapterPanelProps) {
  const i18nT = useTranslations("booster");
  const mediaT = useTranslations("media");
  const hasVideoMedia = Boolean(videoFile || videoPreviewUrl);

  if (!hasVideoMedia) {
    return (
      <div style={{ fontSize: 13, opacity: 0.75 }}>
        {i18nT("ajoutez_une_video_ou_choisissez_photos_0fc6eb5c")} {" "}
      </div>
    );
  }

  const duration = formatDuration(
    videoSourceMetadata?.duration || videoDurationSeconds,
  );
  const dimensions =
    videoSourceMetadata?.width && videoSourceMetadata?.height
      ? `${videoSourceMetadata.width}×${videoSourceMetadata.height}`
      : "";

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: isMobile
          ? "minmax(0, 1fr)"
          : "minmax(220px, 0.72fr) minmax(260px, 1.28fr)",
        gap: 16,
        alignItems: "stretch",
        border: "1px solid rgba(251,146,60,0.3)",
        borderRadius: 18,
        padding: 14,
        background:
          "linear-gradient(135deg, rgba(25,22,48,0.96), rgba(91,37,61,0.62))",
      }}
    >
      <div
        style={{
          minHeight: 230,
          borderRadius: 15,
          overflow: "hidden",
          background: "#030b17",
          border: "1px solid rgba(255,255,255,0.09)",
        }}
      >
        <video
          src={videoPreviewUrl}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>

      <div
        style={{
          display: "grid",
          alignContent: "center",
          gap: 12,
          minWidth: 0,
          padding: "10px 8px",
        }}
      >
        <span
          style={{
            width: "max-content",
            maxWidth: "100%",
            borderRadius: 999,
            padding: "5px 10px",
            background: "rgba(251,146,60,0.14)",
            color: "#ffedd5",
            fontSize: 11,
            fontWeight: 950,
          }}
        >
          {i18nT("video_304f6ca4")}
        </span>
        <strong style={{ fontSize: 18, overflowWrap: "anywhere" }}>
          {videoFile?.name || i18nT("video_selected")}
        </strong>
        {duration || dimensions ? (
          <span style={{ color: "rgba(221,238,247,0.64)", fontSize: 12 }}>
            {[dimensions, duration].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={() => onRetouchVideo(activeChannel)}
          aria-label={mediaT("ai_generator_studio_tab_retouch")}
          style={{
            minHeight: 46,
            borderColor: "rgba(251,146,60,0.62)",
            background:
              "linear-gradient(135deg, rgba(249,115,22,0.94), rgba(244,63,94,0.9))",
            color: "#fff7ed",
            fontWeight: 950,
          }}
        >
          <span aria-hidden="true">🎞️</span> {mediaT("ai_generator_studio_tab_retouch")}
        </button>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => onRemoveMediaFromChannel(activeChannel)}
            aria-label={i18nT("retirer_de_ce_canal_76fbf864")}
          >
            {i18nT("retirer_de_ce_canal_76fbf864")}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onDeleteVideo}
            aria-label={i18nT("supprimer_partout_dfb790c4")}
          >
            {i18nT("supprimer_partout_dfb790c4")}
          </button>
        </div>
      </div>
    </section>
  );
}
