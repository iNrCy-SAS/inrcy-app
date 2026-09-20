"use client";

import { normalizeChannelKey } from "./mailboxPhase1";
import type {
  BoosterVideoSourceMetadata,
  ChannelKey as BoosterChannelKey,
  VideoAdaptationMode,
  VideoFormat,
  VideoPayload,
} from "../../booster/publier/publishModal.shared";

export type PublicationEditVideoState = {
  file: File | null;
  previewUrl: string;
  name: string;
  type: string;
  size: number;
  duration: number | null;
  sourceMetadata: BoosterVideoSourceMetadata | null;
  sourceVideo: VideoPayload | null;
  transformedVariants: NonNullable<VideoPayload["transformedVariants"]>;
  format: VideoFormat;
  adaptationMode: VideoAdaptationMode;
  preparation?: {
    status: "idle" | "preparing" | "ready" | "error";
    label: string;
    detail?: string;
  } | null;
  preparing?: boolean;
  removed?: boolean;
};

export type CampaignDistributionNotice = {
  queuedCount: number;
  batchSize: number;
  deferredReason: string;
  extras: string[];
  estimatedDurationMs: number | null;
  estimatedCompletionAt: string | null;
};

export function normalizeBoosterChannelKeyForVideo(value: string): BoosterChannelKey {
  const channel = normalizeChannelKey(value);
  return (channel || "inrcy_site") as BoosterChannelKey;
}

export function attachmentToVideoPayload(att: any): VideoPayload | null {
  const url = String(att?.publicUrl || att?.url || att?.videoUrl || "").trim();
  if (!url) return null;
  return {
    name: String(att?.name || "video-inrcy.mp4"),
    type: String(att?.type || "video/mp4"),
    size: Number(att?.size || 0),
    lastModified: Date.now(),
    duration: Number.isFinite(Number(att?.duration))
      ? Number(att.duration)
      : null,
    sourceMetadata: (att?.sourceMetadata ||
      att?.source_metadata ||
      null) as BoosterVideoSourceMetadata | null,
    bucket: String(
      att?.bucket ||
        att?.bucketName ||
        att?.bucket_name ||
        att?.storageBucket ||
        att?.storage_bucket ||
        "",
    ),
    mediaId: String(att?.mediaId || att?.media_id || "") || undefined,
    storagePath: String(att?.storagePath || att?.storage_path || ""),
    publicUrl: url,
    url,
    transformedVariants: Array.isArray(att?.transformedVariants)
      ? att.transformedVariants
      : [],
    ...(att?.sourceVideo || att?.source_video
      ? { sourceVideo: att.sourceVideo || att.source_video }
      : {}),
  } as VideoPayload & { sourceVideo?: unknown };
}

export function readPublicationVideoMetadata(
  file: File,
  previewUrl: string,
): Promise<BoosterVideoSourceMetadata> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve({
        width: null,
        height: null,
        duration: null,
        size: file.size || 0,
        type: file.type || "video/mp4",
        ratio: null,
        ratioLabel: "Ratio inconnu",
        orientation: "unknown",
        orientationLabel: "Orientation inconnue",
      });
      return;
    }

    const video = document.createElement("video");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const width = Number(video.videoWidth || 0) || null;
      const height = Number(video.videoHeight || 0) || null;
      const rawDuration = Number(video.duration || 0);
      const duration =
        Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
      const ratio = width && height ? width / height : null;
      const ratioLabel =
        width && height ? `${width}:${height}` : "Ratio inconnu";
      const orientation =
        width && height
          ? width > height
            ? "horizontal"
            : width < height
              ? "vertical"
              : "square"
          : "unknown";
      const orientationLabel =
        orientation === "horizontal"
          ? "Horizontale"
          : orientation === "vertical"
            ? "Verticale"
            : orientation === "square"
              ? "Carrée"
              : "Orientation inconnue";
      video.removeAttribute("src");
      video.load();
      resolve({
        width,
        height,
        duration,
        size: file.size || 0,
        type: file.type || "video/mp4",
        ratio,
        ratioLabel,
        orientation,
        orientationLabel,
      });
    };
    window.setTimeout(finish, 2600);
    video.preload = "metadata";
    video.onloadedmetadata = finish;
    video.onerror = finish;
    video.src = previewUrl;
    video.load();
  });
}
