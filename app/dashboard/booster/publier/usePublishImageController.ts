import { useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { confirmInrcy } from "@/lib/inrcyDialog";
import {
  isBoosterImageExplicitlyCustomized,
  normalizeBoosterImageCustomizationScope,
} from "@/lib/boosterImageCustomization";
import {
  areBoosterImageTransformsEquivalent,
  getBoosterImageDisplayPlan,
  getBoosterImageRenderDimensions,
  getBoosterImageSafetyBackgroundMode,
  getBoosterImageSequenceTargetRatio,
} from "@/lib/boosterImageDecision";
import {
  BOOSTER_MAX_IMAGE_BYTES,
  BOOSTER_MAX_IMAGE_COUNT,
  BOOSTER_MAX_IMAGE_MB_LABEL,
  BOOSTER_MAX_MEDIA_BYTES,
  BOOSTER_MAX_MEDIA_MB_LABEL,
  BOOSTER_CHANNEL_ORDER,
  CHANNEL_LABELS,
  CHANNEL_PRESETS,
  buildBoosterUploadPath,
  channelSupportsImages,
  clamp,
  computePreviewLayout,
  getBackgroundFill,
  getBackgroundMode,
  getEffectiveTransformZoom,
  getOptimizedTransform,
  isBoosterImageFile,
  makeImageKey,
  offsetFromDrawPosition,
  readImageMeta,
  renderChannelImage,
  syncChannelImageEditors,
  uploadPreparedImages,
  uploadBoosterImageFileDirect,
  type ChannelImageEditorState,
  type ChannelImagePayload,
  type ChannelImageSettingsPayload,
  type ChannelKey,
  type ChannelMediaMode,
  type DisplayKey,
  type ImageMeta,
  type ImagePayload,
  type ImageTransform,
  type PublicationMediaType,
} from "./publishModal.shared";
import { setImageKeysForChannel } from "./imageChannelAssignment";

function buildServerPreviewPlaceholder(file: Pick<File, "name">, placeholderLabel: string) {
  const safeName = String(file.name || "Image")
    .replace(/[<>&"']/g, "")
    .slice(0, 54);
  const safePlaceholderLabel = String(placeholderLabel || "")
    .replace(/[<>&"']/g, "")
    .slice(0, 80);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">',
    '<rect width="1080" height="1080" fill="#f2f4f7"/>',
    '<rect x="220" y="260" width="640" height="430" rx="34" fill="#fff" stroke="#d0d5dd" stroke-width="14"/>',
    '<circle cx="380" cy="410" r="62" fill="#d0d5dd"/>',
    '<path d="M260 640l190-190 120 120 90-90 160 160H260z" fill="#98a2b3"/>',
    `<text x="540" y="790" text-anchor="middle" font-family="Arial,sans-serif" font-size="40" fill="#344054">${safePlaceholderLabel}</text>`,
    `<text x="540" y="850" text-anchor="middle" font-family="Arial,sans-serif" font-size="28" fill="#667085">${safeName}</text>`,
    "</svg>",
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function buildLocalImagePresentation(file: File, placeholderLabel: string) {
  try {
    return {
      meta: await readImageMeta(file),
      preview: URL.createObjectURL(file),
    };
  } catch {
    // Certains formats (HEIC/HEIF/TIFF notamment) sont acceptés par le
    // pipeline mais ne sont pas décodables par tous les navigateurs.
    return {
      meta: { width: 1080, height: 1080, ratio: 1 } satisfies ImageMeta,
      preview: buildServerPreviewPlaceholder(file, placeholderLabel),
    };
  }
}

type UsePublishImageControllerParams = {
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  previewStageRef: MutableRefObject<HTMLDivElement | null>;
  selectedChannels: ChannelKey[];
  images: File[];
  setImages: Dispatch<SetStateAction<File[]>>;
  imagePreviews: string[];
  setImagePreviews: Dispatch<SetStateAction<string[]>>;
  useImagesForAI: boolean;
  setUseImagesForAI: Dispatch<SetStateAction<boolean>>;
  imageMetaByKey: Record<string, ImageMeta>;
  setImageMetaByKey: Dispatch<SetStateAction<Record<string, ImageMeta>>>;
  channelImageEditors: Partial<Record<ChannelKey, ChannelImageEditorState>>;
  setChannelImageEditors: Dispatch<
    SetStateAction<Partial<Record<ChannelKey, ChannelImageEditorState>>>
  >;
  activeImageChannel: ChannelKey;
  setActiveImageChannel: Dispatch<SetStateAction<ChannelKey>>;
  activeImageKeyByChannel: Partial<Record<ChannelKey, string>>;
  setActiveImageKeyByChannel: Dispatch<
    SetStateAction<Partial<Record<ChannelKey, string>>>
  >;
  isImageEditorOpen: boolean;
  setIsImageEditorOpen: Dispatch<SetStateAction<boolean>>;
  isDraggingImage: boolean;
  setIsDraggingImage: Dispatch<SetStateAction<boolean>>;
  hasVideoMedia: boolean;
  setImgError: Dispatch<SetStateAction<string>>;
  onOversizedMedia?: (
    file: File,
    targetChannel?: ChannelKey,
    queuedFiles?: File[],
  ) => boolean | void;
  setActiveCard: Dispatch<SetStateAction<DisplayKey>>;
  setPublicationMediaType: Dispatch<SetStateAction<PublicationMediaType>>;
  setChannelMediaModes: Dispatch<
    SetStateAction<Partial<Record<ChannelKey, ChannelMediaMode>>>
  >;
  preservePublishScroll: () => void;
  restorePublishScroll: () => void;
  syncPersistentWorkspaceImages?: (
    files: readonly File[],
    metadataByIndex?: readonly Record<string, unknown>[],
  ) => Promise<void> | void;
};

export default function usePublishImageController({
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
  hasVideoMedia,
  setImgError,
  onOversizedMedia,
  setActiveCard,
  setPublicationMediaType,
  setChannelMediaModes,
  preservePublishScroll,
  restorePublishScroll,
  syncPersistentWorkspaceImages,
}: UsePublishImageControllerParams) {
  const i18nT = useTranslations("booster");
  const imagePickerTargetChannelRef = useRef<ChannelKey | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const [previewStageSize, setPreviewStageSize] = useState({
    width: 0,
    height: 0,
  });

  const imageAdapterChannels = useMemo<ChannelKey[]>(() => {
    return BOOSTER_CHANNEL_ORDER.filter((channel) =>
      selectedChannels.includes(channel),
    );
  }, [selectedChannels]);

  const getImageAdapterLabel = (channel: ChannelKey) => CHANNEL_LABELS[channel];
  const getImpactedImageChannels = (channel: ChannelKey): ChannelKey[] => [
    channel,
  ];

  const setSynchronizedActiveChannel = (channel: ChannelKey) => {
    setActiveCard(channel);
    setActiveImageChannel(channel);
  };

  const imageKeys = useMemo(
    () => images.map((file) => makeImageKey(file)),
    [images],
  );
  const imageFileByKey = useMemo(
    () => Object.fromEntries(images.map((file) => [makeImageKey(file), file])),
    [images],
  );
  const previewByKey = useMemo(
    () =>
      Object.fromEntries(
        imageKeys.map((key, index) => [key, imagePreviews[index]]),
      ),
    [imageKeys, imagePreviews],
  );

  useEffect(() => {
    setChannelImageEditors((prev) =>
      syncChannelImageEditors({
        previous: prev,
        imageKeys,
        selectedChannels,
        imageMetaByKey,
      }),
    );
  }, [
    imageKeys.join("|"),
    selectedChannels.join("|"),
    Object.keys(imageMetaByKey)
      .sort()
      .map(
        (key) =>
          `${key}:${imageMetaByKey[key]?.width || 0}x${imageMetaByKey[key]?.height || 0}`,
      )
      .join("|"),
    setChannelImageEditors,
  ]);

  useEffect(() => {
    if (!imageAdapterChannels.length) {
      setActiveImageChannel("inrcy_site");
      setActiveCard("inrcy_site");
      return;
    }
    if (!imageAdapterChannels.includes(activeImageChannel)) {
      const fallback = imageAdapterChannels[0];
      setActiveImageChannel(fallback);
      setActiveCard(fallback);
    }
  }, [
    imageAdapterChannels,
    activeImageChannel,
    setActiveCard,
    setActiveImageChannel,
  ]);

  useEffect(() => {
    setActiveImageKeyByChannel((prev) => {
      const next = { ...prev };
      for (const channel of selectedChannels) {
        const available = channelImageEditors[channel]?.imageKeys || [];
        if (!available.length) {
          delete next[channel];
          continue;
        }
        if (!next[channel] || !available.includes(next[channel] as string)) {
          next[channel] = available[0];
        }
      }
      for (const key of Object.keys(next) as ChannelKey[]) {
        if (!selectedChannels.includes(key)) delete next[key];
      }
      return next;
    });
  }, [
    selectedChannels.join("|"),
    channelImageEditors,
    imageKeys.join("|"),
    setActiveImageKeyByChannel,
  ]);

  useEffect(() => {
    if (!images.length && !useImagesForAI) {
      setUseImagesForAI(true);
    }
  }, [images.length, useImagesForAI, setUseImagesForAI]);

  useEffect(() => {
    const node = previewStageRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const update = () => {
      setPreviewStageSize({
        width: node.clientWidth || 0,
        height: node.clientHeight || 0,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [
    activeImageChannel,
    activeImageKeyByChannel[activeImageChannel],
    isImageEditorOpen,
    images.length,
    previewStageRef,
  ]);

  const activeEditor = channelImageEditors[activeImageChannel];
  const activeEditorImageKey =
    activeImageKeyByChannel[activeImageChannel] ||
    activeEditor?.imageKeys?.[0] ||
    "";
  const activeEditorMeta = imageMetaByKey[activeEditorImageKey];
  const activeEditorAutomaticTransform = getOptimizedTransform(
    activeImageChannel,
    activeEditorMeta,
  );
  const activeEditorTransform =
    activeEditor?.transforms?.[activeEditorImageKey] ||
    activeEditorAutomaticTransform;
  const activeEditorFirstImageKey = activeEditor?.imageKeys?.[0] || "";
  const activeEditorSequenceTargetRatio = getBoosterImageSequenceTargetRatio({
    channel: activeImageChannel,
    metas: (activeEditor?.imageKeys || []).map((key) => imageMetaByKey[key]),
    firstImageCustomizedTargetRatio:
      activeImageChannel === "instagram" &&
      activeEditorFirstImageKey &&
      isBoosterImageExplicitlyCustomized(
        activeEditor?.customizedImageKeys,
        activeEditorFirstImageKey,
      )
        ? CHANNEL_PRESETS.instagram.width / CHANNEL_PRESETS.instagram.height
        : null,
  });
  const activeEditorExplicitlyCustomized =
    isBoosterImageExplicitlyCustomized(
      activeEditor?.customizedImageKeys,
      activeEditorImageKey,
    );
  const activeEditorDisplayPlan = getBoosterImageDisplayPlan({
    channel: activeImageChannel,
    meta: activeEditorMeta,
    customized: activeEditorExplicitlyCustomized,
    currentTransform: activeEditorTransform,
    automaticTransform: activeEditorAutomaticTransform,
    requiredTargetRatio: activeEditorSequenceTargetRatio,
  });
  const activeEffectiveZoom = getEffectiveTransformZoom(activeEditorTransform);
  const activeBackgroundMode = getBackgroundMode(activeEditorTransform);
  const activeBackgroundColor = getBackgroundFill(
    activeEditorTransform.backgroundMode || activeBackgroundMode,
    activeEditorTransform.backgroundColor,
  );
  const activePreset = CHANNEL_PRESETS[activeImageChannel];
  const activeEditorPreviewDimensions = (() => {
    if (
      activeEditorDisplayPlan.decision.mode === "original" &&
      activeEditorMeta?.width &&
      activeEditorMeta?.height
    ) {
      return {
        width: activeEditorMeta.width,
        height: activeEditorMeta.height,
      };
    }

    if (activeEditorDisplayPlan.decision.mode === "adapted") {
      return getBoosterImageRenderDimensions({
        baseWidth: activePreset.width,
        baseHeight: activePreset.height,
        targetRatio: activeEditorDisplayPlan.decision.targetRatio,
      });
    }

    if (
      activeEditorDisplayPlan.decision.mode === "customized" &&
      activeImageChannel === "instagram" &&
      activeEditorSequenceTargetRatio
    ) {
      return getBoosterImageRenderDimensions({
        baseWidth: activePreset.width,
        baseHeight: activePreset.height,
        targetRatio: activeEditorSequenceTargetRatio,
      });
    }

    return { width: activePreset.width, height: activePreset.height };
  })();
  const previewAspectRatio = `${activeEditorPreviewDimensions.width} / ${activeEditorPreviewDimensions.height}`;
  const activeEditorDecisionLabel = activeEditorDisplayPlan.decision.label;
  const activeEditorDecisionMode = activeEditorDisplayPlan.decision.mode;
  const previewLayout = computePreviewLayout({
    containerWidth: previewStageSize.width,
    containerHeight: previewStageSize.height,
    imageWidth: activeEditorMeta?.width || 0,
    imageHeight: activeEditorMeta?.height || 0,
    transform: activeEditorTransform,
  });

  const clearImagesMedia = () => {
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImages([]);
    setImagePreviews([]);
    setImageMetaByKey({});
    setChannelImageEditors({});
    setActiveImageKeyByChannel({});
    void syncPersistentWorkspaceImages?.([]);
  };

  const onPickImagesClick = () => {
    imagePickerTargetChannelRef.current = null;
    setImgError("");
    if (images.length >= BOOSTER_MAX_IMAGE_COUNT) return;
    fileInputRef.current?.click();
  };

  const onPickImagesForChannel = (channel: ChannelKey) => {
    setImgError("");
    if (images.length > 0 || !channelSupportsImages(channel)) return;
    imagePickerTargetChannelRef.current = channel;
    fileInputRef.current?.click();
  };

  const addImageFiles = async (
    pickedFiles: File[],
    targetChannel?: ChannelKey,
  ) => {
    if (!pickedFiles.length) return false;
    setImgError("");

    const incoming = pickedFiles.filter(isBoosterImageFile);
    if (!incoming.length) {
      setImgError(i18nT("image_files_invalid"));
      return false;
    }

    if (!hasVideoMedia) {
      setPublicationMediaType("images");
    }

    const existingKeys = new Set(images.map((file) => makeImageKey(file)));
    const deduped = incoming.filter(
      (file) => !existingKeys.has(makeImageKey(file)),
    );
    const allowed = deduped.slice(
      0,
      Math.max(0, BOOSTER_MAX_IMAGE_COUNT - images.length),
    );

    if (!allowed.length) {
      setImgError(
        images.length >= BOOSTER_MAX_IMAGE_COUNT
          ? i18nT("image_maximum_count", { count: BOOSTER_MAX_IMAGE_COUNT })
          : i18nT("images_already_added"),
      );
      return false;
    }

    if (incoming.length > allowed.length) {
      setImgError(
        images.length + allowed.length >= BOOSTER_MAX_IMAGE_COUNT
          ? i18nT("image_maximum_count", { count: BOOSTER_MAX_IMAGE_COUNT })
          : i18nT("some_images_already_added"),
      );
    }

    const oversizedFiles = allowed.filter(
      (file) => file.size > BOOSTER_MAX_IMAGE_BYTES,
    );
    const insertableFiles = allowed.filter(
      (file) => file.size <= BOOSTER_MAX_IMAGE_BYTES,
    );
    const queueOversizedFiles = () => {
      const [first, ...rest] = oversizedFiles;
      if (!first) return;
      const handled = onOversizedMedia?.(first, targetChannel, rest) === true;
      if (!handled) {
        setImgError(
          i18nT("image_file_too_large", { name: first.name, limit: BOOSTER_MAX_IMAGE_MB_LABEL }),
        );
      }
    };

    if (!insertableFiles.length) {
      queueOversizedFiles();
      return false;
    }

    const totalImageBytes = [...images, ...insertableFiles].reduce(
      (sum, file) => sum + (file?.size || 0),
      0,
    );
    if (totalImageBytes > BOOSTER_MAX_MEDIA_BYTES) {
      setImgError(
        i18nT("images_total_too_large", { limit: BOOSTER_MAX_MEDIA_MB_LABEL }),
      );
      return false;
    }

    const nextFiles = [...images, ...insertableFiles].slice(
      0,
      BOOSTER_MAX_IMAGE_COUNT,
    );
    const presentations = await Promise.all(
      insertableFiles.map((file) => buildLocalImagePresentation(file, i18nT("image_preview_prepared_server"))),
    );
    const nextMetaEntries = insertableFiles.map(
      (file, index) =>
        [makeImageKey(file), presentations[index].meta] as const,
    );
    const nextPreviews = [
      ...imagePreviews,
      ...presentations.map((item) => item.preview),
    ].slice(0, BOOSTER_MAX_IMAGE_COUNT);
    const nextMetaMap = Object.fromEntries(nextMetaEntries) as Record<
      string,
      ImageMeta
    >;
    const newKeys = insertableFiles.map((file) => makeImageKey(file));
    const previousPoolKeys = images.map((file) => makeImageKey(file));
    const nextPoolKeys = nextFiles.map((file) => makeImageKey(file));

    setImages(nextFiles);
    setImagePreviews(nextPreviews);
    const combinedMetaMap = { ...imageMetaByKey, ...nextMetaMap };
    setImageMetaByKey((prev) => ({ ...prev, ...nextMetaMap }));
    void syncPersistentWorkspaceImages?.(
      nextFiles,
      nextFiles.map((file) => ({
        source_metadata: combinedMetaMap[makeImageKey(file)] || null,
      })),
    );

    if (targetChannel || (!hasVideoMedia && images.length === 0)) {
      setChannelMediaModes((prev) => {
        const next: Partial<Record<ChannelKey, ChannelMediaMode>> = { ...prev };
        if (targetChannel) {
          if (channelSupportsImages(targetChannel)) next[targetChannel] = "images";
        } else {
          for (const channel of selectedChannels) {
            next[channel] = channelSupportsImages(channel) ? "images" : "none";
          }
        }
        return next;
      });
    }

    if (targetChannel) {
      setChannelImageEditors((prev) => {
        let next = syncChannelImageEditors({
          previous: prev,
          imageKeys: nextPoolKeys,
          selectedChannels,
          imageMetaByKey: { ...imageMetaByKey, ...nextMetaMap },
        });
        if (!channelSupportsImages(targetChannel)) return next;

        // Synchronizing the physical pool must not assign its new keys to
        // another channel. Persist every other channel's previous mapping and
        // only append the picked keys to the channel that opened the picker.
        for (const channel of selectedChannels) {
          if (channel === targetChannel) continue;
          const preservedKeys = (
            prev[channel]?.imageKeys ||
            (channelSupportsImages(channel) ? previousPoolKeys : [])
          ).filter((key) => previousPoolKeys.includes(key));
          next = setImageKeysForChannel(next, channel, preservedKeys, {
            fallback: { imageKeys: [], transforms: {} },
            patch: { synchronizedImageKeys: [...nextPoolKeys] },
          });
        }

        const targetKeys = [
          ...(prev[targetChannel]?.imageKeys || []).filter((key) =>
            previousPoolKeys.includes(key),
          ),
          ...newKeys,
        ];
        next = setImageKeysForChannel(next, targetChannel, targetKeys, {
          fallback: { imageKeys: [], transforms: {} },
          patch: { synchronizedImageKeys: [...nextPoolKeys] },
        });
        return next;
      });
    } else {
      setChannelImageEditors((prev) => {
        let next = syncChannelImageEditors({
          previous: prev,
          imageKeys: nextPoolKeys,
          selectedChannels,
          imageMetaByKey: { ...imageMetaByKey, ...nextMetaMap },
        });
        for (const channel of selectedChannels) {
          const selectedKeys =
            images.length === 0
              ? channelSupportsImages(channel)
                ? nextPoolKeys
                : []
              : (
                  prev[channel]?.imageKeys ||
                  (channelSupportsImages(channel) ? previousPoolKeys : [])
                ).filter((key) => previousPoolKeys.includes(key));
          next = setImageKeysForChannel(next, channel, selectedKeys, {
            fallback: { imageKeys: [], transforms: {} },
            patch: { synchronizedImageKeys: [...nextPoolKeys] },
          });
        }
        return next;
      });
    }
    queueOversizedFiles();
    return true;
  };

  const onImagesChange = async (
    files: FileList | null,
    targetChannel?: ChannelKey,
  ) => {
    const resolvedTargetChannel =
      targetChannel || imagePickerTargetChannelRef.current || undefined;
    imagePickerTargetChannelRef.current = null;
    if (!files?.length) return;
    await addImageFiles(Array.from(files), resolvedTargetChannel);
  };

  const assignExistingImagesToChannel = (channel: ChannelKey) => {
    if (!imageKeys.length || !channelSupportsImages(channel)) return;
    setChannelImageEditors((prev) => {
      const current = prev[channel] || { imageKeys: [], transforms: {} };
      const transforms = Object.fromEntries(
        imageKeys.map((key) => [
          key,
          current.transforms?.[key] ||
            getOptimizedTransform(channel, imageMetaByKey[key]),
        ]),
      );
      return setImageKeysForChannel(prev, channel, imageKeys, {
        fallback: { imageKeys: [], transforms: {} },
        patch: {
          transforms,
          synchronizedImageKeys: [...imageKeys],
        },
      });
    });
    setActiveImageKeyByChannel((prev) => ({
      ...prev,
      [channel]: imageKeys[0],
    }));
    setChannelMediaModes((prev) => ({
      ...prev,
      [channel]: "images",
    }));
  };

  const removeImagesFromChannel = (channel: ChannelKey) => {
    setChannelImageEditors((prev) =>
      setImageKeysForChannel(prev, channel, [], {
        fallback: { imageKeys: [], transforms: {} },
        patch: { synchronizedImageKeys: [...imageKeys] },
      }),
    );
    setActiveImageKeyByChannel((prev) => {
      const next = { ...prev };
      delete next[channel];
      return next;
    });
    setChannelMediaModes((prev) => ({
      ...prev,
      [channel]: "none",
    }));
  };

  const removeImage = (index: number) => {
    setImgError("");
    const removedFile = images[index];
    const removedPreview = imagePreviews[index];
    if (!removedFile) return;

    if (removedPreview) {
      try {
        URL.revokeObjectURL(removedPreview);
      } catch {}
    }

    const removedKey = makeImageKey(removedFile);
    const nextFiles = images.filter((_, idx) => idx !== index);
    const nextPreviews = imagePreviews.filter((_, idx) => idx !== index);
    const remainingKeys = nextFiles.map((file) => makeImageKey(file));

    setImages(nextFiles);
    setImagePreviews(nextPreviews);
    void syncPersistentWorkspaceImages?.(
      nextFiles,
      nextFiles.map((file) => ({
        source_metadata: imageMetaByKey[makeImageKey(file)] || null,
      })),
    );
    setImageMetaByKey((prev) => {
      const next = { ...prev };
      delete next[removedKey];
      return next;
    });
    setChannelImageEditors((prev) =>
      syncChannelImageEditors({
        previous: prev,
        imageKeys: remainingKeys,
        selectedChannels,
        imageMetaByKey,
      }),
    );
    setActiveImageKeyByChannel((prev) => {
      const next = { ...prev };
      for (const channel of Object.keys(next) as ChannelKey[]) {
        if (next[channel] === removedKey) {
          next[channel] = remainingKeys[0] || "";
        }
      }
      return next;
    });
    if (nextFiles.length === 0) {
      setChannelMediaModes((prev) => {
        const next: Partial<Record<ChannelKey, ChannelMediaMode>> = { ...prev };
        for (const channel of selectedChannels) {
          if (next[channel] === "images") {
            next[channel] = hasVideoMedia ? "video" : "none";
          }
        }
        return next;
      });
    }
  };

  function getSafeDraftImagePath(file: File, index: number) {
    return buildBoosterUploadPath(
      file.name || `image-${index + 1}.jpg`,
      "booster-drafts",
    );
  }

  function getDraftImageSettingsByChannel() {
    return selectedChannels.reduce(
      (acc, channel) => {
        const editor = channelImageEditors[channel] || {
          imageKeys: [],
          transforms: {},
        };
        const imageKeysForChannel = (editor.imageKeys || []).filter((key) =>
          imageKeys.includes(key),
        );
        acc[channel] = {
          imageKeys: !channelSupportsImages(channel)
            ? []
            : imageKeysForChannel.slice(0, BOOSTER_MAX_IMAGE_COUNT),
          transforms: Object.fromEntries(
            Object.entries(editor.transforms || {})
              .filter(([key]) => imageKeysForChannel.includes(key))
              .map(([key, value]) => [key, { ...(value as ImageTransform) }]),
          ),
          customizedImageKeys: (editor.customizedImageKeys || []).filter((key) =>
            imageKeysForChannel.includes(key),
          ),
        };
        return acc;
      },
      {} as Partial<Record<ChannelKey, ChannelImageEditorState>>,
    );
  }

  async function uploadPublicationDraftImages() {
    const uploaded: Array<{
      name: string;
      type?: string;
      size?: number;
      lastModified?: number;
      storagePath?: string;
      publicUrl?: string;
    }> = [];
    for (let index = 0; index < images.length; index += 1) {
      const file = images[index];
      if (!file) continue;
      const stored = await uploadBoosterImageFileDirect({
        file,
        path: getSafeDraftImagePath(file, index),
        target: "booster_draft_image",
      });
      uploaded.push({
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        storagePath: stored.storagePath,
        publicUrl: stored.publicUrl,
      });
    }
    return uploaded;
  }

  async function restorePublicationDraftImages(imageDrafts: any[]) {
    const restoredFiles: File[] = [];
    const restoredPreviews: string[] = [];
    const restoredMeta: Record<string, ImageMeta> = {};

    for (const image of imageDrafts) {
      const publicUrl = String(image?.publicUrl || image?.url || "").trim();
      const dataUrl = String(image?.dataUrl || "").trim();
      const source = publicUrl || dataUrl;
      if (!source) continue;
      try {
        const response = await fetch(source);
        if (!response.ok) continue;
        const blob = await response.blob();
        const name = String(image?.name || "image.jpg");
        const type = String(image?.type || blob.type || "image/jpeg");
        const lastModified = Number(image?.lastModified || Date.now());
        const file = new File([blob], name, { type, lastModified });
        const key = makeImageKey(file);
        const presentation = await buildLocalImagePresentation(file, i18nT("image_preview_prepared_server"));
        restoredFiles.push(file);
        restoredPreviews.push(presentation.preview);
        restoredMeta[key] = presentation.meta;
      } catch {
        // Une ancienne image de brouillon peut ne plus être disponible : on recharge le reste du brouillon.
      }
    }

    return { restoredFiles, restoredPreviews, restoredMeta };
  }

  const updateChannelTransform = (
    channel: ChannelKey,
    imageKey: string,
    patch: Partial<ImageTransform>,
  ) => {
    setChannelImageEditors((prev) => {
      const next = { ...prev };
      for (const targetChannel of getImpactedImageChannels(channel)) {
        const current = next[targetChannel] || {
          imageKeys: imageKeys.slice(),
          transforms: {},
          customizedImageKeys: [],
        };
        const automaticTransform = getOptimizedTransform(
          targetChannel,
          imageMetaByKey[imageKey],
        );
        const nextTransform = {
          ...(current.transforms[imageKey] || automaticTransform),
          ...patch,
        };
        const customizedImageKeys = new Set(current.customizedImageKeys || []);
        if (
          areBoosterImageTransformsEquivalent(
            nextTransform,
            automaticTransform,
          )
        ) {
          customizedImageKeys.delete(imageKey);
        } else {
          customizedImageKeys.add(imageKey);
        }
        next[targetChannel] = {
          ...current,
          imageKeys: current.imageKeys,
          transforms: {
            ...current.transforms,
            [imageKey]: nextTransform,
          },
          customizedImageKeys: Array.from(customizedImageKeys),
        };
      }
      return next;
    });
  };

  const setContainMode = (channel: ChannelKey, imageKey: string) => {
    updateChannelTransform(channel, imageKey, {
      fit: "contain",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      backgroundMode: getBoosterImageSafetyBackgroundMode(channel),
      backgroundColor: undefined,
      blurBackground: false,
    });
  };

  const setCoverMode = (channel: ChannelKey, imageKey: string) => {
    updateChannelTransform(channel, imageKey, {
      fit: "cover",
      backgroundMode: "black",
      blurBackground: false,
    });
  };

  const nudgeZoom = (delta: number) => {
    if (!activeEditorImageKey) return;
    const maxZoom = activeEditorTransform.fit === "cover" ? 3 : 1;
    const currentZoom = getEffectiveTransformZoom(activeEditorTransform);
    const nextZoom = clamp(currentZoom + delta, 0.4, maxZoom);
    updateChannelTransform(activeImageChannel, activeEditorImageKey, {
      zoom: nextZoom,
    });
  };

  const handlePreviewWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (
      !activeEditorImageKey ||
      !activeEditorMeta?.width ||
      !activeEditorMeta?.height ||
      !previewStageRef.current
    )
      return;
    if (event.cancelable) event.preventDefault();

    const rect = previewStageRef.current.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const maxZoom = activeEditorTransform.fit === "cover" ? 3 : 1;
    const currentZoom = getEffectiveTransformZoom(activeEditorTransform);
    const nextZoom = clamp(
      currentZoom + (event.deltaY < 0 ? 0.08 : -0.08),
      0.4,
      maxZoom,
    );

    const nextLayout = computePreviewLayout({
      containerWidth: rect.width,
      containerHeight: rect.height,
      imageWidth: activeEditorMeta.width,
      imageHeight: activeEditorMeta.height,
      transform: { ...activeEditorTransform, zoom: nextZoom },
    });

    const currentDrawW = previewLayout.drawW || nextLayout.drawW;
    const currentDrawH = previewLayout.drawH || nextLayout.drawH;
    const ux = currentDrawW
      ? (pointerX - previewLayout.dx) / currentDrawW
      : 0.5;
    const uy = currentDrawH
      ? (pointerY - previewLayout.dy) / currentDrawH
      : 0.5;
    const nextDx = pointerX - ux * nextLayout.drawW;
    const nextDy = pointerY - uy * nextLayout.drawH;
    const offsets = offsetFromDrawPosition({
      containerWidth: rect.width,
      containerHeight: rect.height,
      drawW: nextLayout.drawW,
      drawH: nextLayout.drawH,
      dx: nextDx,
      dy: nextDy,
    });

    updateChannelTransform(activeImageChannel, activeEditorImageKey, {
      zoom: nextZoom,
      ...offsets,
    });
  };

  const handlePreviewPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!activeEditorImageKey) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: activeEditorTransform.offsetX,
      startOffsetY: activeEditorTransform.offsetY,
    };
    setIsDraggingImage(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePreviewPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !activeEditorImageKey)
      return;
    const nextOffsetX = previewLayout.maxX
      ? clamp(
          drag.startOffsetX -
            ((event.clientX - drag.startX) / previewLayout.maxX) * 100,
          -100,
          100,
        )
      : 0;
    const nextOffsetY = previewLayout.maxY
      ? clamp(
          drag.startOffsetY -
            ((event.clientY - drag.startY) / previewLayout.maxY) * 100,
          -100,
          100,
        )
      : 0;
    updateChannelTransform(activeImageChannel, activeEditorImageKey, {
      offsetX: nextOffsetX,
      offsetY: nextOffsetY,
    });
  };

  const endPreviewDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && dragStateRef.current?.pointerId === event.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    dragStateRef.current = null;
    setIsDraggingImage(false);
  };

  const toggleChannelImage = (channel: ChannelKey, imageKey: string) => {
    const impactedChannels = getImpactedImageChannels(channel);
    setChannelImageEditors((prev) => {
      const current = prev[channel] || {
        imageKeys: imageKeys.slice(),
        transforms: {},
      };
      const exists = current.imageKeys.includes(imageKey);
      const nextKeys = exists
        ? current.imageKeys.filter((key) => key !== imageKey)
        : [...current.imageKeys, imageKey].slice(0, BOOSTER_MAX_IMAGE_COUNT);
      const next = { ...prev };
      for (const targetChannel of impactedChannels) {
        const currentTarget = next[targetChannel] || {
          imageKeys: imageKeys.slice(),
          transforms: {},
        };
        next[targetChannel] = {
          ...currentTarget,
          imageKeys: nextKeys,
          transforms: {
            ...currentTarget.transforms,
            [imageKey]:
              currentTarget.transforms[imageKey] ||
              getOptimizedTransform(targetChannel, imageMetaByKey[imageKey]),
          },
        };
      }
      return next;
    });
    setActiveImageKeyByChannel((prev) => {
      const currentKeys = channelImageEditors[channel]?.imageKeys || [];
      const exists = currentKeys.includes(imageKey);
      if (prev[channel] !== imageKey) return prev;
      const nextKeys = currentKeys.filter((key) => key !== imageKey);
      return {
        ...prev,
        ...Object.fromEntries(
          impactedChannels.map((targetChannel) => [
            targetChannel,
            nextKeys[0] || "",
          ]),
        ),
      };
    });
  };

  const resetChannelImage = async (channel: ChannelKey, imageKey: string) => {
    const ok = await confirmInrcy({
      eyebrow: i18nT("retouche_image_d03a26d6"),
      title: i18nT("reinitialiser_le_cadrage_a883e639"),
      message:
        i18nT("le_cadrage_actuel_de_cette_image_75498a81"),
      cancelLabel: i18nT("annuler_49ba3292"),
      confirmLabel: i18nT("reinitialiser_e0e2ad54"),
      variant: "warning",
    });
    if (!ok) return;
    updateChannelTransform(
      channel,
      imageKey,
      getOptimizedTransform(channel, imageMetaByKey[imageKey]),
    );
  };

  const resetActiveChannelImages = async () => {
    const imageKeysForChannel =
      channelImageEditors[activeImageChannel]?.imageKeys || [];
    if (!imageKeysForChannel.length) return;
    const ok = await confirmInrcy({
      eyebrow: i18nT("retouche_image_d03a26d6"),
      title: i18nT("reinitialiser_tous_les_cadrages_du_canal_25eb7049"),
      message:
        i18nT("tous_les_cadrages_de_ce_canal_981bd781"),
      cancelLabel: i18nT("annuler_49ba3292"),
      confirmLabel: i18nT("reinitialiser_e0e2ad54"),
      variant: "warning",
    });
    if (!ok) return;
    setChannelImageEditors((prev) => {
      const next = { ...prev };
      const current = next[activeImageChannel] || {
        imageKeys: imageKeysForChannel,
        transforms: {},
      };
      const transforms = { ...current.transforms };
      for (const imageKey of imageKeysForChannel) {
        transforms[imageKey] = getOptimizedTransform(
          activeImageChannel,
          imageMetaByKey[imageKey],
        );
      }
      next[activeImageChannel] = {
        ...current,
        imageKeys: imageKeysForChannel,
        transforms,
        customizedImageKeys: (current.customizedImageKeys || []).filter(
          (key) => !imageKeysForChannel.includes(key),
        ),
      };
      return next;
    });
  };

  const applyCurrentCadrageToActiveChannelImages = () => {
    if (!activeEditorImageKey) return;
    const imageKeysForChannel =
      channelImageEditors[activeImageChannel]?.imageKeys || [];
    if (imageKeysForChannel.length <= 1) return;
    setChannelImageEditors((prev) => {
      const next = { ...prev };
      const current = next[activeImageChannel] || {
        imageKeys: imageKeysForChannel,
        transforms: {},
      };
      const transforms = { ...current.transforms };
      for (const imageKey of imageKeysForChannel) {
        transforms[imageKey] = { ...activeEditorTransform };
      }
      const customizedImageKeys = new Set(current.customizedImageKeys || []);
      for (const imageKey of imageKeysForChannel) {
        const automaticTransform = getOptimizedTransform(
          activeImageChannel,
          imageMetaByKey[imageKey],
        );
        if (
          areBoosterImageTransformsEquivalent(
            transforms[imageKey],
            automaticTransform,
          )
        ) {
          customizedImageKeys.delete(imageKey);
        } else {
          customizedImageKeys.add(imageKey);
        }
      }
      next[activeImageChannel] = {
        ...current,
        imageKeys: imageKeysForChannel,
        transforms,
        customizedImageKeys: Array.from(customizedImageKeys),
      };
      return next;
    });
  };

  const moveChannelImage = (
    channel: ChannelKey,
    imageKey: string,
    direction: -1 | 1,
  ) => {
    setChannelImageEditors((prev) => {
      const current = prev[channel] || {
        imageKeys: imageKeys.slice(),
        transforms: {},
      };
      const index = current.imageKeys.indexOf(imageKey);
      const targetIndex = index + direction;
      if (
        index < 0 ||
        targetIndex < 0 ||
        targetIndex >= current.imageKeys.length
      )
        return prev;
      const nextKeys = current.imageKeys.slice();
      const [moved] = nextKeys.splice(index, 1);
      nextKeys.splice(targetIndex, 0, moved);
      return {
        ...prev,
        [channel]: { ...current, imageKeys: nextKeys },
      };
    });
  };

  const applyCurrentImageToSelectedChannels = () => {
    if (!activeEditorImageKey) return;
    setChannelImageEditors((prev) => {
      const next = { ...prev };
      for (const channel of selectedChannels) {
        const current = next[channel] || {
          imageKeys: imageKeys.slice(),
          transforms: {},
        };
        const automaticTransform = getOptimizedTransform(
          channel,
          imageMetaByKey[activeEditorImageKey],
        );
        const customizedImageKeys = new Set(current.customizedImageKeys || []);
        if (
          areBoosterImageTransformsEquivalent(
            activeEditorTransform,
            automaticTransform,
          )
        ) {
          customizedImageKeys.delete(activeEditorImageKey);
        } else {
          customizedImageKeys.add(activeEditorImageKey);
        }
        next[channel] = {
          ...current,
          imageKeys: current.imageKeys.includes(activeEditorImageKey)
            ? current.imageKeys
            : [...current.imageKeys, activeEditorImageKey].slice(
                0,
                BOOSTER_MAX_IMAGE_COUNT,
              ),
          transforms: {
            ...current.transforms,
            [activeEditorImageKey]: { ...activeEditorTransform },
          },
          customizedImageKeys: Array.from(customizedImageKeys),
        };
      }
      return next;
    });
  };

  const openImageEditor = (channel: ChannelKey, imageKey: string) => {
    preservePublishScroll();
    setSynchronizedActiveChannel(channel);
    setActiveImageKeyByChannel((prev) => ({ ...prev, [channel]: imageKey }));
    setIsImageEditorOpen(true);
  };

  const closeImageEditor = () => {
    dragStateRef.current = null;
    setIsDraggingImage(false);
    setIsImageEditorOpen(false);
    restorePublishScroll();
  };

  const buildAutomaticRenderPreset = (
    channel: ChannelKey,
    targetRatio: number | null,
  ) => {
    const base = CHANNEL_PRESETS[channel];
    const dimensions = getBoosterImageRenderDimensions({
      baseWidth: base.width,
      baseHeight: base.height,
      targetRatio,
    });
    return { ...base, ...dimensions };
  };

  const uploadOriginalImagesForPublication = async (
    onProgress?: (current: number, total: number) => void,
  ): Promise<Record<string, ImagePayload>> => {
    if (!images.length) return {};
    const originalPayloads: ImagePayload[] = images.map((file) => ({
      name: file.name || "image.jpg",
      type: file.type || "image/jpeg",
      sourceFile: file,
    }));
    const uploadedOriginals = await uploadPreparedImages(
      originalPayloads,
      onProgress,
    );
    return Object.fromEntries(
      images.map((file, index) => [
        makeImageKey(file),
        uploadedOriginals[index],
      ]),
    );
  };

  const buildChannelImageSettingsPayload = (): ChannelImageSettingsPayload => {
    const channelSettings = {} as ChannelImageSettingsPayload;
    const getEditorForPublish = (channel: ChannelKey) =>
      channelImageEditors[channel] || { imageKeys: [], transforms: {} };

    for (const channel of selectedChannels) {
      if (!channelSupportsImages(channel)) {
        channelSettings[channel] = {
          imageKeys: [],
          transforms: {},
          customizedImageKeys: [],
        };
        continue;
      }

      const editor = getEditorForPublish(channel);
      const customizationScope = normalizeBoosterImageCustomizationScope<ImageTransform>({
        availableImageKeys: imageKeys,
        requestedImageKeys: editor.imageKeys,
        transforms: editor.transforms,
        customizedImageKeys: editor.customizedImageKeys,
        maxImages: BOOSTER_MAX_IMAGE_COUNT,
        fallbackToAvailableWhenSelectionEmpty: false,
      });
      const imageKeysToRender = customizationScope.imageKeys;
      const firstImageKey = imageKeysToRender[0] || "";
      const sequenceTargetRatio = getBoosterImageSequenceTargetRatio({
        channel,
        metas: imageKeysToRender.map((key) => imageMetaByKey[key]),
        firstImageCustomizedTargetRatio:
          channel === "instagram" &&
          firstImageKey &&
          isBoosterImageExplicitlyCustomized(
            customizationScope.customizedImageKeys,
            firstImageKey,
          )
            ? CHANNEL_PRESETS.instagram.width / CHANNEL_PRESETS.instagram.height
            : null,
      });
      const transforms: Record<string, ImageTransform> = {};
      const customizedImageKeys: string[] = [];

      for (const imageKey of imageKeysToRender) {
        const imageMeta = imageMetaByKey[imageKey];
        const automaticTransform = getOptimizedTransform(channel, imageMeta);
        const currentTransform =
          customizationScope.transforms[imageKey] || automaticTransform;
        const explicitlyCustomized = isBoosterImageExplicitlyCustomized(
          customizationScope.customizedImageKeys,
          imageKey,
        );
        const displayPlan = getBoosterImageDisplayPlan({
          channel,
          meta: imageMeta,
          customized: explicitlyCustomized,
          currentTransform,
          automaticTransform,
          requiredTargetRatio: sequenceTargetRatio,
        });
        if (displayPlan.decision.mode === "adapted") {
          transforms[imageKey] = {
            ...automaticTransform,
            fit: displayPlan.automaticFit,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            blurBackground: false,
            backgroundMode:
              displayPlan.automaticFit === "contain"
                ? getBoosterImageSafetyBackgroundMode(channel)
                : "black",
            backgroundColor: undefined,
          };
        } else {
          transforms[imageKey] = { ...currentTransform };
          if (displayPlan.decision.mode === "customized") {
            customizedImageKeys.push(imageKey);
          }
        }
      }

      channelSettings[channel] = {
        imageKeys: [...imageKeysToRender],
        transforms,
        customizedImageKeys,
      };
    }

    return channelSettings;
  };

  const buildChannelImagesPayload = async (
    onProgress?: (current: number, total: number) => void,
  ): Promise<{
    channelImages: ChannelImagePayload;
    channelSettings: ChannelImageSettingsPayload;
  }> => {
    const channelImages = {} as ChannelImagePayload;
    const channelSettings = {} as ChannelImageSettingsPayload;
    const getEditorForPublish = (channel: ChannelKey) => {
      return channelImageEditors[channel] || { imageKeys: [], transforms: {} };
    };

    const totalRenders = selectedChannels.reduce((sum, channel) => {
      if (!channelSupportsImages(channel)) return sum;
      const editor = getEditorForPublish(channel);
      const keys = editor.imageKeys.slice(0, BOOSTER_MAX_IMAGE_COUNT);
      return sum + keys.length;
    }, 0);
    let doneRenders = 0;

    for (const channel of selectedChannels) {
      if (!channelSupportsImages(channel)) {
        channelImages[channel] = [];
        channelSettings[channel] = {
          imageKeys: [],
          transforms: {},
          customizedImageKeys: [],
        };
        continue;
      }

      const editor = getEditorForPublish(channel);
      const customizationScope = normalizeBoosterImageCustomizationScope<ImageTransform>({
        availableImageKeys: imageKeys,
        requestedImageKeys: editor.imageKeys,
        transforms: editor.transforms,
        customizedImageKeys: editor.customizedImageKeys,
        maxImages: BOOSTER_MAX_IMAGE_COUNT,
        fallbackToAvailableWhenSelectionEmpty: false,
      });
      const renderList: ImagePayload[] = [];
      const actualTransforms: Record<string, ImageTransform> = {};
      const actualCustomizedImageKeys: string[] = [];
      const imageKeysToRender = customizationScope.imageKeys;
      const firstImageKey = imageKeysToRender[0] || "";
      const sequenceTargetRatio = getBoosterImageSequenceTargetRatio({
        channel,
        metas: imageKeysToRender.map((key) => imageMetaByKey[key]),
        firstImageCustomizedTargetRatio:
          channel === "instagram" &&
          firstImageKey &&
          isBoosterImageExplicitlyCustomized(
            customizationScope.customizedImageKeys,
            firstImageKey,
          )
            ? CHANNEL_PRESETS.instagram.width / CHANNEL_PRESETS.instagram.height
            : null,
      });

      for (const imageKey of imageKeysToRender) {
        const file = imageFileByKey[imageKey];
        if (!file) continue;

        const imageMeta = imageMetaByKey[imageKey];
        const automaticTransform = getOptimizedTransform(channel, imageMeta);
        const currentTransform =
          customizationScope.transforms[imageKey] || automaticTransform;
        const explicitlyCustomized = isBoosterImageExplicitlyCustomized(
          customizationScope.customizedImageKeys,
          imageKey,
        );
        const displayPlan = getBoosterImageDisplayPlan({
          channel,
          meta: imageMeta,
          customized: explicitlyCustomized,
          currentTransform,
          automaticTransform,
          requiredTargetRatio: sequenceTargetRatio,
        });

        let payload: ImagePayload;
        let outputTransform: ImageTransform;

        if (displayPlan.decision.mode === "original") {
          payload = {
            name: file.name || "image.jpg",
            type: file.type || "image/jpeg",
            sourceFile: file,
          };
          outputTransform = automaticTransform;
        } else if (displayPlan.decision.mode === "adapted") {
          outputTransform = {
            ...automaticTransform,
            fit: displayPlan.automaticFit,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            blurBackground: false,
            backgroundMode:
              displayPlan.automaticFit === "contain"
                ? getBoosterImageSafetyBackgroundMode(channel)
                : "black",
            backgroundColor: undefined,
          };
          payload = await renderChannelImage({
            file,
            transform: outputTransform,
            preset: buildAutomaticRenderPreset(
              channel,
              displayPlan.decision.targetRatio,
            ),
            channel,
          });
        } else {
          outputTransform = currentTransform;
          const customizedPreset =
            channel === "instagram" && sequenceTargetRatio
              ? buildAutomaticRenderPreset(channel, sequenceTargetRatio)
              : CHANNEL_PRESETS[channel];
          payload = await renderChannelImage({
            file,
            transform: currentTransform,
            preset: customizedPreset,
            channel,
          });
          actualCustomizedImageKeys.push(imageKey);
        }

        actualTransforms[imageKey] = { ...outputTransform };
        renderList.push({
          ...payload,
          imageKey,
          transform: { ...outputTransform },
          imageMeta,
          imageDecisionMode: displayPlan.decision.mode,
          imageDecisionLabel: displayPlan.decision.label,
          isCustomized: displayPlan.decision.mode === "customized",
        });
        doneRenders += 1;
        onProgress?.(doneRenders, totalRenders);
      }

      channelImages[channel] = renderList;
      channelSettings[channel] = {
        imageKeys: [...imageKeysToRender],
        transforms: actualTransforms,
        customizedImageKeys: actualCustomizedImageKeys,
      };
    }

    if (!totalRenders) onProgress?.(0, 0);

    return { channelImages, channelSettings };
  };

  const getPublishImageKeysForChannel = (channel: ChannelKey) => {
    if (!channelSupportsImages(channel)) return [];
    const keys = channelImageEditors[channel]?.imageKeys || [];
    return keys.slice(0, BOOSTER_MAX_IMAGE_COUNT);
  };

  return {
    imageAdapterChannels,
    getImageAdapterLabel,
    imageKeys,
    previewByKey,
    activeEditorImageKey,
    activeEditorTransform,
    activeEditorDecisionLabel,
    activeEditorDecisionMode,
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
  };
}
