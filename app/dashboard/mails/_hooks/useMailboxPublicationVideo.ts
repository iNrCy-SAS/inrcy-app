"use client";

import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { requestBoosterVideoTransforms } from "@/lib/boosterVideoTransformClient";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import {
  isVideoAttachment,
  type ChannelPublication,
  type OutboxItem,
} from "../_lib/mailboxPhase1";
import {
  BOOSTER_MAX_VIDEO_BYTES,
  BOOSTER_MAX_VIDEO_MB_LABEL,
  uploadBoosterVideo,
  getLocalizedVideoAdaptationModeLabel,
  getLocalizedVideoFormatLabel,
  type ChannelKey as BoosterChannelKey,
  type VideoAdaptationMode,
  type VideoFormat,
  type VideoPayload,
} from "../../booster/publier/publishModal.shared";
import {
  attachmentToVideoPayload,
  normalizeBoosterChannelKeyForVideo,
  readPublicationVideoMetadata,
  type PublicationEditVideoState,
} from "../_lib/mailboxPublicationVideo.foundations";

export type MailboxPublicationMediaOptions = {
  detailsOpen: boolean;
  detailsItem: OutboxItem | null;
  detailsEditMode: boolean;
  detailsChannelEntries: ChannelPublication[];
  activeDetailsChannelEntry: ChannelPublication | null;
  setDetailsActionError: React.Dispatch<React.SetStateAction<string | null>>;
};

/** Owns per-channel video hydration, removal, upload and variant preparation. */
export function useMailboxPublicationVideo({
  detailsOpen,
  detailsItem,
  detailsEditMode,
  detailsChannelEntries,
  activeDetailsChannelEntry,
  setDetailsActionError,
}: MailboxPublicationMediaOptions) {
  const i18nT = useTranslations("mails");

  const [publicationEditVideoByChannel, setPublicationEditVideoByChannel] =
    useState<Record<string, PublicationEditVideoState>>({});

  useEffect(() => {
    if (
      !detailsOpen ||
      detailsItem?.source !== "app_events" ||
      detailsEditMode
    )
      return;
    const nextState: Record<string, PublicationEditVideoState> = {};
    for (const entry of detailsChannelEntries) {
      const channel = normalizeBoosterChannelKeyForVideo(entry.key);
      const parts = (entry.parts || {}) as any;
      const videoCandidate =
        parts.video ||
        (Array.isArray(parts.attachments)
          ? parts.attachments.find((att: any) => isVideoAttachment(att))
          : null);
      const finalVideo = attachmentToVideoPayload(videoCandidate);
      if (!finalVideo) continue;
      const settings = parts.videoSettings || {};
      const sourceVideo =
        attachmentToVideoPayload(parts.sourceVideo) || finalVideo;
      const sourceMetadata =
        sourceVideo.sourceMetadata || finalVideo.sourceMetadata || null;
      const defaultFormat: VideoFormat = "original";
      const format = (settings.format ||
        parts.videoFormat ||
        defaultFormat) as VideoFormat;
      const adaptationMode = (settings.adaptationMode ||
        parts.videoAdaptationMode ||
        "safe_frame") as VideoAdaptationMode;
      const signature = buildVideoTransformSignature(
        format,
        adaptationMode,
        getVideoPublicationProfileForChannel(
          normalizeBoosterChannelKeyForVideo(channel),
        ),
      );
      const syntheticFinalVariant =
        finalVideo.publicUrl || finalVideo.url
          ? {
              key: `${channel}-${format}-${adaptationMode}-published`,
              channel,
              format,
              adaptationMode,
              signature,
              publicUrl: finalVideo.publicUrl || finalVideo.url || "",
              url: finalVideo.publicUrl || finalVideo.url || "",
              storagePath: finalVideo.storagePath || "",
              contentType: finalVideo.type || "video/mp4",
              size: finalVideo.size || 0,
              duration: finalVideo.duration || null,
              target: {
                label: getLocalizedVideoFormatLabel(
                  channel,
                  format,
                  sourceMetadata,
                  i18nT,
                ),
              },
            }
          : null;
      const storedVariants = Array.isArray(finalVideo.transformedVariants)
        ? finalVideo.transformedVariants
        : [];
      const transformedVariants = [syntheticFinalVariant, ...storedVariants]
        .filter(Boolean)
        .filter(
          (variant: any, index, arr) =>
            arr.findIndex(
              (candidate: any) =>
                String(
                  candidate?.signature ||
                    candidate?.publicUrl ||
                    candidate?.url ||
                    "",
                ) ===
                String(
                  variant?.signature ||
                    variant?.publicUrl ||
                    variant?.url ||
                    "",
                ),
            ) === index,
        ) as NonNullable<VideoPayload["transformedVariants"]>;
      nextState[channel] = {
        file: null,
        previewUrl:
          sourceVideo.publicUrl ||
          sourceVideo.url ||
          finalVideo.publicUrl ||
          finalVideo.url ||
          "",
        name: sourceVideo.name || finalVideo.name || "video-inrcy.mp4",
        type: sourceVideo.type || finalVideo.type || "video/mp4",
        size: sourceVideo.size || finalVideo.size || 0,
        duration: sourceVideo.duration || finalVideo.duration || null,
        sourceMetadata,
        sourceVideo,
        transformedVariants,
        format,
        adaptationMode,
        preparation: finalVideo.publicUrl
          ? {
              status: "ready",
              label: i18nT("format_applique_43fe4a7e"),
              detail: `${getLocalizedVideoFormatLabel(channel, format, sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
            }
          : null,
      };
    }
    setPublicationEditVideoByChannel(nextState);
  }, [
    detailsOpen,
    detailsItem?.id,
    detailsItem?.source,
    detailsChannelEntries,
    detailsEditMode,
    i18nT,
  ]);

  async function addPublicationVideo(fileList: FileList | File[] | null) {
    const channel = normalizeBoosterChannelKeyForVideo(
      activeDetailsChannelEntry?.key || "",
    );
    if (!channel || !fileList?.length) return;
    const file = Array.from(fileList).find(
      (candidate) =>
        candidate.type.startsWith("video/") ||
        /\.(mp4|m4v|mov|webm)$/i.test(candidate.name || ""),
    );
    if (!file) {
      setDetailsActionError(
        i18nT("seuls_les_fichiers_video_sont_acceptes_20063d2f"),
      );
      return;
    }
    if (file.size > BOOSTER_MAX_VIDEO_BYTES) {
      setDetailsActionError(
        i18nT("video_trop_lourde_taille_maximale_value_358dea38", {
          value0: BOOSTER_MAX_VIDEO_MB_LABEL,
        }),
      );
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    const sourceMetadata = await readPublicationVideoMetadata(file, previewUrl);
    const defaultFormat: VideoFormat = "original";
    setDetailsActionError(null);
    setPublicationEditVideoByChannel((prev) => ({
      ...prev,
      [channel]: {
        file,
        previewUrl,
        name: file.name || "video-inrcy.mp4",
        type: file.type || "video/mp4",
        size: file.size || 0,
        duration: sourceMetadata.duration || null,
        sourceMetadata,
        sourceVideo: null,
        transformedVariants: [],
        format: defaultFormat,
        adaptationMode: prev[channel]?.adaptationMode || "safe_frame",
        preparation: {
          status: "idle",
          label: i18nT("nouvelle_video_ajoutee_73db7bab"),
          detail: i18nT("apply_format_before_saving"),
        },
        removed: false,
      },
    }));
  }

  function removePublicationVideo(channelValue?: string) {
    const channel = normalizeBoosterChannelKeyForVideo(
      channelValue || activeDetailsChannelEntry?.key || "",
    );
    if (!channel) return;
    setPublicationEditVideoByChannel((prev) => {
      const previousVideoState = prev[channel];
      return {
        ...prev,
        [channel]: {
          ...(previousVideoState || {
            file: null,
            previewUrl: "",
            name: "video-inrcy.mp4",
            type: "video/mp4",
            size: 0,
            duration: null,
            sourceMetadata: null,
            sourceVideo: null,
            transformedVariants: [],
            format: "original",
            adaptationMode: "safe_frame",
          }),
          file: null,
          previewUrl: "",
          sourceVideo: null,
          transformedVariants: [],
          removed: true,
          preparation: {
            status: "error",
            label: i18nT("video_supprimee_5fd3ed00"),
            detail: i18nT("ajoutez_une_nouvelle_video_avant_d_803819f5"),
          },
        },
      };
    });
  }

  function setPublicationVideoFormatForChannel(
    channelValue: string,
    format: VideoFormat,
  ) {
    const channel = normalizeBoosterChannelKeyForVideo(channelValue);
    setPublicationEditVideoByChannel((prev) => {
      const current = prev[channel];
      if (!current) return prev;
      return {
        ...prev,
        [channel]: {
          ...current,
          format,
          preparation:
            current.preparation?.status === "ready"
              ? {
                  status: "idle",
                  label: i18nT("format_modifie_a2680e9d"),
                  detail: i18nT("apply_this_format_before_saving"),
                }
              : current.preparation,
        },
      };
    });
  }

  function setPublicationVideoAdaptationModeForChannel(
    channelValue: string,
    mode: VideoAdaptationMode,
  ) {
    const channel = normalizeBoosterChannelKeyForVideo(channelValue);
    setPublicationEditVideoByChannel((prev) => {
      const current = prev[channel];
      if (!current) return prev;
      return {
        ...prev,
        [channel]: {
          ...current,
          adaptationMode: mode,
          preparation:
            current.preparation?.status === "ready"
              ? {
                  status: "idle",
                  label: i18nT("adaptation_modifiee_7c8ae175"),
                  detail: i18nT("apply_this_format_before_saving"),
                }
              : current.preparation,
        },
      };
    });
  }

  async function ensurePublicationEditVideoUploaded(
    channel: BoosterChannelKey,
    current: PublicationEditVideoState,
  ): Promise<VideoPayload> {
    if (!current.file && current.sourceVideo?.publicUrl)
      return current.sourceVideo;
    if (!current.file)
      throw new Error(i18nT("add_video_before_saving"));
    const uploaded = await uploadBoosterVideo(current.file, {
      folder: "booster-videos",
      duration: current.duration,
      sourceMetadata: current.sourceMetadata,
    });
    setPublicationEditVideoByChannel((prev) => ({
      ...prev,
      [channel]: {
        ...(prev[channel] || current),
        sourceVideo: uploaded,
        previewUrl: uploaded.publicUrl || uploaded.url || current.previewUrl,
        transformedVariants: [],
        preparation: {
          status: "idle",
          label: i18nT("video_ajoutee_ad22d54a"),
          detail: i18nT("format_can_be_applied"),
        },
      },
    }));
    return uploaded;
  }

  async function applyPublicationVideoFormatForChannel(channelValue: string) {
    const channel = normalizeBoosterChannelKeyForVideo(channelValue);
    const current = publicationEditVideoByChannel[channel];
    if (!current || current.removed || !current.previewUrl) {
      setDetailsActionError(i18nT("ajoutez_une_video_avant_d_appliquer_580c0ec6"));
      return;
    }

    const format = current.format || "original";
    const adaptationMode = current.adaptationMode || "safe_frame";
    const signature = buildVideoTransformSignature(
      format,
      adaptationMode,
      getVideoPublicationProfileForChannel(channel),
    );
    const existing = current.transformedVariants.find(
      (variant: any) => variant.signature === signature,
    );
    if (existing?.publicUrl || existing?.url) {
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [channel]: {
          ...current,
          previewUrl: existing.publicUrl || existing.url || current.previewUrl,
          preparation: {
            status: "ready",
            label: i18nT("format_applique_43fe4a7e"),
            detail: `${getLocalizedVideoFormatLabel(channel, format, current.sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
          },
        },
      }));
      return;
    }

    setDetailsActionError(null);
    setPublicationEditVideoByChannel((prev) => ({
      ...prev,
      [channel]: {
        ...current,
        preparing: true,
        preparation: {
          status: "preparing",
          label: i18nT("modification_du_format_d563b6d2"),
          detail: `${getLocalizedVideoFormatLabel(channel, format, current.sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
        },
      },
    }));

    try {
      const base = await ensurePublicationEditVideoUploaded(channel, current);
      const response = await requestBoosterVideoTransforms({
        source: {
          storagePath: base.storagePath,
          publicUrl: base.publicUrl || base.url,
          url: base.url || base.publicUrl,
          name: base.name,
          type: base.type,
          size: base.size,
          duration: base.duration,
          sourceMetadata: base.sourceMetadata || current.sourceMetadata,
        },
        variants: [
          {
            key: `${channel}-${format}-${adaptationMode}`,
            channel,
            format,
            adaptationMode,
          },
        ],
      });
      const variants = [
        ...current.transformedVariants.filter(
          (variant: any) => variant.signature !== signature,
        ),
        ...(Array.isArray(response.variants) ? response.variants : []),
      ];
      const found = variants.find(
        (variant: any) => variant.signature === signature,
      );
      if (!found?.publicUrl && !found?.url) {
        setPublicationEditVideoByChannel((prev) => ({
          ...prev,
          [channel]: {
            ...(prev[channel] || current),
            sourceVideo: base,
            transformedVariants: variants,
            previewUrl: base.publicUrl || base.url || current.previewUrl,
            file: current.file,
            preparing: false,
            preparation: {
              status: "ready",
              label: i18nT("video_originale_conservee_84fd0d77"),
              detail: i18nT(
                "adaptation_automatique_indisponible_la_video_ori_c770d639",
              ),
            },
          },
        }));
        setDetailsActionError(
          i18nT("adaptation_automatique_indisponible_la_video_ori_c770d639"),
        );
        return;
      }
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [channel]: {
          ...(prev[channel] || current),
          sourceVideo: base,
          transformedVariants: variants,
          previewUrl: found.publicUrl || found.url || current.previewUrl,
          file: current.file,
          preparing: false,
          preparation: {
            status: "ready",
            label: i18nT("format_applique_43fe4a7e"),
            detail: `${getLocalizedVideoFormatLabel(channel, format, current.sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(adaptationMode, i18nT)}`,
          },
        },
      }));
    } catch (_error: any) {
      const fallbackDetail = i18nT(
        "adaptation_automatique_indisponible_la_video_ori_c770d639",
      );
      setDetailsActionError(fallbackDetail);
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [channel]: {
          ...(prev[channel] || current),
          preparing: false,
          preparation: {
            status: "ready",
            label: i18nT("video_originale_conservee_84fd0d77"),
            detail: fallbackDetail,
          },
        },
      }));
    }
  }

  return {
    publicationEditVideoByChannel,
    setPublicationEditVideoByChannel,
    addPublicationVideo,
    removePublicationVideo,
    setPublicationVideoFormatForChannel,
    setPublicationVideoAdaptationModeForChannel,
    ensurePublicationEditVideoUploaded,
    applyPublicationVideoFormatForChannel,
  };
}
