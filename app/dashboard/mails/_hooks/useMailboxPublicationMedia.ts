"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import type {
  MediaLibraryPickerItem,
} from "@/app/dashboard/_components/MediaLibraryPickerModal";
import { withMediaImageInteractions } from "@/lib/imageInteractions";
import {
  buildPublicationDefaultTransform,
  isImageAttachment,
  makePublicationImageAssetKey,
  normalizeChannelKey,
  type PublicationChannelImagesState,
  type PublicationImageAsset,
  type PublicationImageTransform,
} from "../_lib/mailboxPhase1";
import {
  BOOSTER_MAX_IMAGE_BYTES,
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_MAX_IMAGE_MB_LABEL,
  BOOSTER_MAX_MEDIA_BYTES,
  BOOSTER_MAX_MEDIA_MB_LABEL,
  BOOSTER_MAX_VIDEO_BYTES,
  BOOSTER_MAX_VIDEO_MB_LABEL,
  getLocalizedVideoAdaptationModeLabel,
  getLocalizedVideoFormatLabel,
  getLocalizedVideoOrientationLabel,
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  isUnsupportedBrowserImageFile,
  type BoosterVideoSourceMetadata,
  type VideoFormat,
} from "../../booster/publier/publishModal.shared";
import {
  normalizeBoosterChannelKeyForVideo,
  readPublicationVideoMetadata,
} from "../_lib/mailboxPublicationVideo.foundations";
import { useMailboxPublicationVideo, type MailboxPublicationMediaOptions } from "./useMailboxPublicationVideo";

/** Owns image edits and shared library insertion; Studio navigation stays in MailboxClient. */
export function useMailboxPublicationMedia({
  detailsOpen,
  detailsItem,
  detailsEditMode,
  detailsChannelEntries,
  activeDetailsChannelEntry,
  setDetailsActionError,
}: MailboxPublicationMediaOptions) {
  const i18nT = useTranslations("mails");
  const [publicationEditImagesByChannel, setPublicationEditImagesByChannel] =
    useState<Record<string, PublicationChannelImagesState>>({});

  useEffect(() => {
    if (
      !detailsOpen ||
      detailsItem?.source !== "app_events" ||
      detailsEditMode
    )
      return;
    const nextState: Record<string, PublicationChannelImagesState> = {};
    for (const entry of detailsChannelEntries) {
      const channel = normalizeChannelKey(entry.key);
      const defaultTransform = buildPublicationDefaultTransform(channel);
      const assets = (
        Array.isArray(entry.parts.attachments) ? entry.parts.attachments : []
      )
        .filter(
          (att) =>
            (att?.url ||
              att?.originalUrl ||
              att?.originalPublicUrl ||
              att?.renderedUrl) &&
            isImageAttachment({
              ...att,
              url:
                att.url ||
                att.originalUrl ||
                att.originalPublicUrl ||
                att.renderedUrl,
            }),
        )
        .map((att, index) => {
          const renderedUrl = String(
            att.renderedUrl || att.url || att.publicUrl || "",
          ).trim();
          const originalUrl = String(
            att.originalUrl || att.originalPublicUrl || "",
          ).trim();
          const previewUrl = originalUrl || renderedUrl;
          const storedTransform =
            att.transform && typeof att.transform === "object"
              ? (att.transform as Partial<PublicationImageTransform>)
              : null;
          // iNrSend edition always restarts from the healthy source image when
          // the publication kept one. Never reapply a previous crop to that
          // source: the professional can create a fresh adaptation instead of
          // accumulating crops across successive edits.
          const initialTransform = originalUrl
            ? { ...defaultTransform }
            : storedTransform
              ? { ...defaultTransform, ...storedTransform }
              : { ...defaultTransform };
          return {
            key: makePublicationImageAssetKey(
              "existing",
              att.name || `image-${index + 1}`,
              `${index}:${previewUrl || renderedUrl}`,
            ),
            name: att.originalName || att.name || `Image ${index + 1}`,
            type:
              String(att.originalType || att.type || "image/jpeg") ||
              "image/jpeg",
            previewUrl,
            sourceUrl: renderedUrl || previewUrl || null,
            originalUrl: originalUrl || null,
            renderedUrl: renderedUrl || null,
            originalStoragePath: att.originalStoragePath || null,
            originalName: att.originalName || att.name || null,
            originalType: att.originalType || att.type || null,
            file: null,
            selected: channel === "pinterest" ? index === 0 : true,
            transform: initialTransform,
            savedTransform: { ...initialTransform },
            imageMeta: att.imageMeta || null,
          };
        });
      nextState[channel] = { assets };
    }
    setPublicationEditImagesByChannel(nextState);
  }, [
    detailsOpen,
    detailsItem?.id,
    detailsItem?.source,
    detailsChannelEntries,
    detailsEditMode,
  ]);

  const {
    publicationEditVideoByChannel,
    setPublicationEditVideoByChannel,
    addPublicationVideo,
    removePublicationVideo,
    setPublicationVideoFormatForChannel,
    setPublicationVideoAdaptationModeForChannel,
    ensurePublicationEditVideoUploaded,
    applyPublicationVideoFormatForChannel,
  } = useMailboxPublicationVideo({
    detailsOpen,
    detailsItem,
    detailsEditMode,
    detailsChannelEntries,
    activeDetailsChannelEntry,
    setDetailsActionError,
  });

  function updatePublicationChannelAssets(
    channel: string,
    updater: (assets: PublicationImageAsset[]) => PublicationImageAsset[],
  ) {
    const normalizedChannel = normalizeChannelKey(channel);
    setPublicationEditImagesByChannel((prev) => ({
      ...prev,
      [normalizedChannel]: {
        assets: updater(prev[normalizedChannel]?.assets || []).slice(0, 5),
      },
    }));
  }

  function togglePublicationImage(channel: string, imageKey: string) {
    const normalizedChannel = normalizeChannelKey(channel);
    updatePublicationChannelAssets(normalizedChannel, (assets) => {
      if (normalizedChannel === "pinterest") {
        const target = assets.find((asset) => asset.key === imageKey);
        if (!target) return assets;
        if (target.selected) {
          return assets.map((asset) =>
            asset.key === imageKey ? { ...asset, selected: false } : asset,
          );
        }
        return assets.map((asset) => ({
          ...asset,
          selected: asset.key === imageKey,
        }));
      }
      return assets.map((asset) =>
        asset.key === imageKey
          ? { ...asset, selected: !asset.selected }
          : asset,
      );
    });
  }

  function resetPublicationImage(channel: string, imageKey: string) {
    updatePublicationChannelAssets(channel, (assets) =>
      assets.map((asset) =>
        asset.key === imageKey
          ? {
              ...asset,
              transform: buildPublicationDefaultTransform(
                normalizeChannelKey(channel),
              ),
            }
          : asset,
      ),
    );
  }

  function movePublicationImage(
    channel: string,
    imageKey: string,
    direction: -1 | 1,
  ) {
    updatePublicationChannelAssets(channel, (assets) => {
      const selectedAssets = assets.filter((asset) => asset.selected);
      const selectedIndex = selectedAssets.findIndex(
        (asset) => asset.key === imageKey,
      );
      const targetSelected = selectedAssets[selectedIndex + direction];
      if (!targetSelected) return assets;
      const sourceIndex = assets.findIndex((asset) => asset.key === imageKey);
      const targetIndex = assets.findIndex(
        (asset) => asset.key === targetSelected.key,
      );
      if (sourceIndex < 0 || targetIndex < 0) return assets;
      const next = assets.slice();
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  function addPublicationPickedFiles(picked: File[]) {
    const channel = normalizeChannelKey(activeDetailsChannelEntry?.key || "");
    if (!channel) return;
    setDetailsActionError(null);
    if (!picked.length) return;

    const invalid = picked.find((file) => !file.type.startsWith("image/"));
    if (invalid) {
      setDetailsActionError(
        i18nT("seules_les_images_sont_acceptees_dans_d018d9b9"),
      );
      return;
    }

    const unsupported = picked.find(isUnsupportedBrowserImageFile);
    if (unsupported) {
      setDetailsActionError(
        i18nT("unsupported_browser_image", { name: unsupported.name }),
      );
      return;
    }

    const tooBig = picked.find((file) => file.size > BOOSTER_MAX_IMAGE_BYTES);
    if (tooBig) {
      setDetailsActionError(
        i18nT("l_image_value_depasse_value_1c15db6a", {
          value0: tooBig.name || i18nT("selected_file"),
          value1: BOOSTER_MAX_IMAGE_MB_LABEL,
        }),
      );
      return;
    }

    const currentSelectedFileBytes = (
      publicationEditImagesByChannel[channel]?.assets || []
    )
      .filter((asset) => asset.selected && asset.file)
      .reduce((sum, asset) => sum + (asset.file?.size || 0), 0);
    const nextPickedBytes = picked.reduce(
      (sum, file) => sum + (file?.size || 0),
      0,
    );
    if (currentSelectedFileBytes + nextPickedBytes > BOOSTER_MAX_MEDIA_BYTES) {
      setDetailsActionError(
        i18nT("les_images_depassent_value_au_total_0e09a0f4", {
          value0: BOOSTER_MAX_MEDIA_MB_LABEL,
        }),
      );
      return;
    }

    setPublicationEditVideoByChannel((prev) => {
      const videoChannel = normalizeBoosterChannelKeyForVideo(channel);
      const previousVideoState = prev[videoChannel];
      if (!previousVideoState) return prev;
      return {
        ...prev,
        [videoChannel]: {
          ...previousVideoState,
          file: null,
          previewUrl: "",
          sourceVideo: null,
          transformedVariants: [],
          removed: true,
          preparation: {
            status: "idle",
            label: i18nT("images_selectionnees_db1d99e0"),
            detail: i18nT("publication_saved_as_images"),
          },
        },
      };
    });

    updatePublicationChannelAssets(channel, (assets) => {
      const merged = [...assets];
      for (const file of picked) {
        const key = makePublicationImageAssetKey(
          "new",
          file.name,
          `${file.size}:${file.lastModified}`,
        );
        if (merged.some((asset) => asset.key === key)) continue;
        if (merged.length >= BOOSTER_MAX_IMAGE_COUNT) {
          setDetailsActionError(
            i18nT("maximum_images_per_publication", {
              count: BOOSTER_MAX_IMAGE_COUNT,
            }),
          );
          break;
        }
        merged.push({
          key,
          name: file.name,
          type: file.type || "image/jpeg",
          previewUrl: URL.createObjectURL(file),
          sourceUrl: null,
          file,
          selected:
            channel === "pinterest" ? !merged.some((asset) => asset.selected) : true,
          transform: buildPublicationDefaultTransform(channel),
        });
      }
      return merged;
    });
  }

  function addPublicationFiles(fileList: FileList | File[] | null) {
    if (!fileList) return;
    addPublicationPickedFiles(Array.from(fileList));
  }

  function addPublicationPhoto(file: File) {
    addPublicationPickedFiles([file]);
  }

  function getMediaLibraryDisplayName(item: MediaLibraryPickerItem) {
    return (
      item.title ||
      item.storage_path.split("/").pop() ||
      (item.media_type === "video" ? "video-inrcy.mp4" : "image-inrcy.jpg")
    );
  }

  async function mediaLibraryItemToFile(
    item: MediaLibraryPickerItem,
  ): Promise<File> {
    const sourceUrl = String(item.signed_url || "").trim();
    if (!sourceUrl) throw new Error(i18nT("media_unavailable_in_library"));
    const response = await fetch(sourceUrl);
    if (!response.ok)
      throw new Error(
        i18nT("media_load_failed_with_status", { status: response.status }),
      );
    const blob = await response.blob();
    const type =
      item.mime_type ||
      blob.type ||
      (item.media_type === "video" ? "video/mp4" : "image/jpeg");
    return new File([blob], getMediaLibraryDisplayName(item), {
      type,
      lastModified: Date.now(),
    });
  }

  function buildMediaLibraryImageMetadata(
    item: MediaLibraryPickerItem,
  ): PublicationImageAsset["imageMeta"] {
    const dimensions =
      item.width && item.height
        ? {
            width: item.width,
            height: item.height,
            ratio: item.width / item.height,
          }
        : {};
    const metadata = withMediaImageInteractions(dimensions, item);
    return Object.keys(metadata).length ? metadata : null;
  }

  function buildMediaLibraryVideoMetadata(
    item: MediaLibraryPickerItem,
    file: File,
  ): BoosterVideoSourceMetadata {
    const width = Number(item.width || 0) || null;
    const height = Number(item.height || 0) || null;
    const duration = Number(item.duration_seconds || 0) || null;
    const ratio = width && height ? width / height : null;
    const orientation =
      width && height
        ? width > height
          ? "horizontal"
          : width < height
            ? "vertical"
            : "square"
        : "unknown";
    return {
      width,
      height,
      duration,
      size: file.size || Number(item.size_bytes || 0) || 0,
      type: file.type || item.mime_type || "video/mp4",
      ratio,
      ratioLabel:
        width && height ? `${width}:${height}` : i18nT("ratio_inconnu_26a9214a"),
      orientation,
      orientationLabel: getLocalizedVideoOrientationLabel(orientation, i18nT),
    };
  }

  async function addPublicationMediaLibraryItems(
    items: MediaLibraryPickerItem[],
  ) {
    const channel = normalizeChannelKey(activeDetailsChannelEntry?.key || "");
    if (!channel) return;
    const selectedItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!selectedItems.length) return;

    const videos = selectedItems.filter((item) => item.media_type === "video");
    const imageItems = selectedItems.filter(
      (item) => item.media_type === "image",
    );
    if (videos.length && imageItems.length) {
      const message = i18nT("mixed_media_not_allowed");
      setDetailsActionError(message);
      throw new Error(message);
    }
    if (videos.length > 1) {
      const message = i18nT("one_video_per_publication");
      setDetailsActionError(message);
      throw new Error(message);
    }

    if (videos.length) {
      const item = videos[0];
      const file = await mediaLibraryItemToFile(item);
      if (file.size > BOOSTER_MAX_VIDEO_BYTES) {
        const message = i18nT(
          "video_trop_lourde_taille_maximale_value_358dea38",
          { value0: BOOSTER_MAX_VIDEO_MB_LABEL },
        );
        setDetailsActionError(message);
        throw new Error(message);
      }
      const previewUrl = URL.createObjectURL(file);
      const fallbackMeta = buildMediaLibraryVideoMetadata(item, file);
      const sourceMetadata =
        fallbackMeta.width || fallbackMeta.height
          ? fallbackMeta
          : await readPublicationVideoMetadata(file, previewUrl);
      const videoChannel = normalizeBoosterChannelKeyForVideo(channel);
      const defaultFormat: VideoFormat = "original";
      setDetailsActionError(null);
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [videoChannel]: {
          file,
          previewUrl,
          name: file.name || getMediaLibraryDisplayName(item),
          type: file.type || item.mime_type || "video/mp4",
          size: file.size || Number(item.size_bytes || 0) || 0,
          duration:
            sourceMetadata.duration ||
            Number(item.duration_seconds || 0) ||
            null,
          sourceMetadata,
          sourceVideo: null,
          transformedVariants: [],
          format: defaultFormat,
          adaptationMode: prev[videoChannel]?.adaptationMode || "safe_frame",
          preparation: {
            status: "idle",
            label: i18nT("video_ajoutee_depuis_la_mediatheque_880252c9"),
            detail: i18nT("apply_format_before_saving"),
          },
          preparing: false,
          removed: false,
        },
      }));
      return;
    }

    if (imageItems.length) {
      const files = await Promise.all(
        imageItems.map((item) => mediaLibraryItemToFile(item)),
      );
      const invalid = files.find((file) => !file.type.startsWith("image/"));
      if (invalid) {
        const message = i18nT("images_only_for_channel");
        setDetailsActionError(message);
        throw new Error(message);
      }
      const tooBig = files.find((file) => file.size > BOOSTER_MAX_IMAGE_BYTES);
      if (tooBig) {
        const message = i18nT("l_image_value_depasse_value_1c15db6a", {
          value0: tooBig.name || i18nT("selected_file"),
          value1: BOOSTER_MAX_IMAGE_MB_LABEL,
        });
        setDetailsActionError(message);
        throw new Error(message);
      }
      const currentSelectedFileBytes = (
        publicationEditImagesByChannel[channel]?.assets || []
      )
        .filter((asset) => asset.selected && asset.file)
        .reduce((sum, asset) => sum + (asset.file?.size || 0), 0);
      const nextPickedBytes = files.reduce(
        (sum, file) => sum + (file?.size || 0),
        0,
      );
      if (
        currentSelectedFileBytes + nextPickedBytes >
        BOOSTER_MAX_MEDIA_BYTES
      ) {
        const message = i18nT(
          "les_images_depassent_value_au_total_0e09a0f4",
          { value0: BOOSTER_MAX_MEDIA_MB_LABEL },
        );
        setDetailsActionError(message);
        throw new Error(message);
      }

      setPublicationEditVideoByChannel((prev) => {
        const videoChannel = normalizeBoosterChannelKeyForVideo(channel);
        const previousVideoState = prev[videoChannel];
        if (!previousVideoState) return prev;
        return {
          ...prev,
          [videoChannel]: {
            ...previousVideoState,
            file: null,
            previewUrl: "",
            sourceVideo: null,
            transformedVariants: [],
            removed: true,
            preparation: {
              status: "idle",
              label: i18nT("images_selectionnees_db1d99e0"),
              detail: i18nT("publication_saved_as_images"),
            },
          },
        };
      });

      updatePublicationChannelAssets(channel, (assets) => {
        const merged = [...assets];
        files.forEach((file, index) => {
          const item = imageItems[index];
          const key = makePublicationImageAssetKey(
            "library",
            file.name,
            item.id || `${item.storage_path}:${file.size}`,
          );
          if (merged.some((asset) => asset.key === key)) return;
          if (merged.length >= BOOSTER_MAX_IMAGE_COUNT) {
            setDetailsActionError(
              i18nT("maximum_images_per_publication", {
                count: BOOSTER_MAX_IMAGE_COUNT,
              }),
            );
            return;
          }
          const imageMeta = buildMediaLibraryImageMetadata(item);
          merged.push({
            key,
            name: file.name || getMediaLibraryDisplayName(item),
            type: file.type || item.mime_type || "image/jpeg",
            previewUrl: URL.createObjectURL(file),
            sourceUrl: null,
            originalUrl: item.signed_url || null,
            originalName: getMediaLibraryDisplayName(item),
            originalType: item.mime_type || file.type || "image/jpeg",
            file,
            selected:
              channel === "pinterest"
                ? !merged.some((asset) => asset.selected)
                : true,
            transform: buildPublicationDefaultTransform(channel),
            imageMeta,
          });
        });
        return merged;
      });
      setDetailsActionError(null);
    }
  }

  async function replacePublicationMediaLibraryItem(
    item: MediaLibraryPickerItem,
    target: { channel?: string; imageKey?: string } = {},
  ): Promise<void> {
    const channel = normalizeChannelKey(
      target.channel || activeDetailsChannelEntry?.key || "",
    );
    if (!channel) {
      throw new Error(i18nT("publication_update_failed"));
    }

    const file = await mediaLibraryItemToFile(item);
    const videoChannel = normalizeBoosterChannelKeyForVideo(channel);

    if (item.media_type === "video") {
      if (file.size > BOOSTER_MAX_VIDEO_BYTES) {
        const message = i18nT(
          "video_trop_lourde_taille_maximale_value_358dea38",
          { value0: BOOSTER_MAX_VIDEO_MB_LABEL },
        );
        setDetailsActionError(message);
        throw new Error(message);
      }

      const returnedItem = item as MediaLibraryPickerItem & Record<string, any>;
      const returnedSettings =
        returnedItem.video_settings && typeof returnedItem.video_settings === "object"
          ? returnedItem.video_settings
          : {};
      const returnedFormat = normalizeVideoFormat(
        videoChannel,
        returnedItem.video_format || returnedSettings.format || "original",
      );
      const returnedAdaptationMode = normalizeVideoAdaptationMode(
        returnedItem.video_adaptation_mode ||
          returnedSettings.adaptationMode ||
          "safe_frame",
      );
      const returnedVariants = Array.isArray(returnedItem.transformed_variants)
        ? returnedItem.transformed_variants
        : [];
      const returnedSignature = buildVideoTransformSignature(
        returnedFormat,
        returnedAdaptationMode,
        getVideoPublicationProfileForChannel(videoChannel),
      );
      const returnedVariant = returnedVariants.find(
        (variant: any) => variant?.signature === returnedSignature,
      );
      const previewUrl = String(
        returnedVariant?.publicUrl || returnedVariant?.url || "",
      ).trim() || URL.createObjectURL(file);
      const fallbackMeta = buildMediaLibraryVideoMetadata(item, file);
      const sourceMetadata =
        returnedItem.source_metadata || fallbackMeta.width || fallbackMeta.height
          ? returnedItem.source_metadata || fallbackMeta
          : await readPublicationVideoMetadata(file, previewUrl);

      setPublicationEditImagesByChannel((prev) => ({
        ...prev,
        [channel]: { assets: [] },
      }));
      setPublicationEditVideoByChannel((prev) => ({
        ...prev,
        [videoChannel]: {
          file,
          previewUrl,
          name: file.name || getMediaLibraryDisplayName(item),
          type: file.type || item.mime_type || "video/mp4",
          size: file.size || Number(item.size_bytes || 0) || 0,
          duration:
            sourceMetadata.duration ||
            Number(item.duration_seconds || 0) ||
            null,
          sourceMetadata,
          sourceVideo:
            returnedItem.source_media_record &&
            typeof returnedItem.source_media_record === "object"
              ? returnedItem.source_media_record
              : {
                  name: file.name || getMediaLibraryDisplayName(item),
                  type: file.type || item.mime_type || "video/mp4",
                  size: file.size || Number(item.size_bytes || 0) || 0,
                  duration:
                    sourceMetadata.duration ||
                    Number(item.duration_seconds || 0) ||
                    null,
                  storagePath: item.storage_path || null,
                  publicUrl: item.signed_url || null,
                  url: item.signed_url || null,
                  sourceMetadata,
                },
          transformedVariants: returnedVariants,
          format: returnedFormat,
          adaptationMode: returnedAdaptationMode,
          preparation: {
            status: returnedVariant ? "ready" : "idle",
            label: returnedVariant
              ? i18nT("format_applique_43fe4a7e")
              : i18nT("video_ajoutee_depuis_la_mediatheque_880252c9"),
            detail: returnedVariant
              ? `${getLocalizedVideoFormatLabel(videoChannel, returnedFormat, sourceMetadata, i18nT)} · ${getLocalizedVideoAdaptationModeLabel(returnedAdaptationMode, i18nT)}`
              : i18nT("apply_format_before_saving"),
          },
          preparing: false,
          removed: false,
        },
      }));
      setDetailsActionError(null);
      return;
    }

    if (!file.type.startsWith("image/") || isUnsupportedBrowserImageFile(file)) {
      const message = i18nT("images_only_for_channel");
      setDetailsActionError(message);
      throw new Error(message);
    }
    if (file.size > BOOSTER_MAX_IMAGE_BYTES) {
      const message = i18nT("l_image_value_depasse_value_1c15db6a", {
        value0: file.name || i18nT("selected_file"),
        value1: BOOSTER_MAX_IMAGE_MB_LABEL,
      });
      setDetailsActionError(message);
      throw new Error(message);
    }

    const key = makePublicationImageAssetKey(
      "library",
      file.name,
      item.id || `${item.storage_path}:${file.size}`,
    );
    const imageMeta = buildMediaLibraryImageMetadata(item);

    const targetImageKey = String(target.imageKey || "").trim();
    if (targetImageKey) {
      const currentAsset = publicationEditImagesByChannel[channel]?.assets.find(
        (asset) => asset.key === targetImageKey,
      );
      if (!currentAsset) {
        const message = "L’image source de cette action n’est plus disponible.";
        setDetailsActionError(message);
        throw new Error(message);
      }
      if (currentAsset.previewUrl?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(currentAsset.previewUrl);
        } catch {}
      }
      const transform = buildPublicationDefaultTransform(channel);
      const replacementPreviewUrl = URL.createObjectURL(file);
      setPublicationEditImagesByChannel((previous) => ({
        ...previous,
        [channel]: {
          assets: (previous[channel]?.assets || []).map((asset) =>
            asset.key === targetImageKey
              ? {
                  ...asset,
                  name: file.name || getMediaLibraryDisplayName(item),
                  type: file.type || item.mime_type || "image/jpeg",
                  previewUrl: replacementPreviewUrl,
                  sourceUrl: null,
                  originalUrl: item.signed_url || null,
                  renderedUrl: null,
                  originalStoragePath: item.storage_path || null,
                  originalName: getMediaLibraryDisplayName(item),
                  originalType: item.mime_type || file.type || "image/jpeg",
                  file,
                  transform,
                  savedTransform: { ...transform },
                  imageMeta,
                }
              : asset,
          ),
        },
      }));
      setDetailsActionError(null);
      return;
    }

    setPublicationEditVideoByChannel((prev) => {
      const previousVideoState = prev[videoChannel];
      return {
        ...prev,
        [videoChannel]: {
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
            status: "idle",
            label: i18nT("images_selectionnees_db1d99e0"),
            detail: i18nT("publication_saved_as_images"),
          },
        },
      };
    });
    setPublicationEditImagesByChannel((prev) => ({
      ...prev,
      [channel]: {
        assets: [
          {
            key,
            name: file.name || getMediaLibraryDisplayName(item),
            type: file.type || item.mime_type || "image/jpeg",
            previewUrl: URL.createObjectURL(file),
            sourceUrl: null,
            originalUrl: item.signed_url || null,
            originalName: getMediaLibraryDisplayName(item),
            originalType: item.mime_type || file.type || "image/jpeg",
            file,
            selected: true,
            transform: buildPublicationDefaultTransform(channel),
            imageMeta,
          },
        ],
      },
    }));
    setDetailsActionError(null);
  }

  return {
    publicationEditImagesByChannel,
    setPublicationEditImagesByChannel,
    publicationEditVideoByChannel,
    setPublicationEditVideoByChannel,
    togglePublicationImage,
    resetPublicationImage,
    movePublicationImage,
    addPublicationFiles,
    addPublicationPhoto,
    addPublicationMediaLibraryItems,
    replacePublicationMediaLibraryItem,
    addPublicationVideo,
    removePublicationVideo,
    setPublicationVideoFormatForChannel,
    setPublicationVideoAdaptationModeForChannel,
    ensurePublicationEditVideoUploaded,
    applyPublicationVideoFormatForChannel
  };
}
