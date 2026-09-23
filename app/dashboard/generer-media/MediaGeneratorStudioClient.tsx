"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import MediaGeneratorModal from "@/app/dashboard/_components/MediaGeneratorModal";
import type {
  MediaRetoucherSavedValue,
  MediaStudioInitialPreview,
} from "@/app/dashboard/_components/MediaRetoucher";
import type {
  MediaVideoRetoucherInitialContext,
  MediaVideoRetoucherSavedValue,
} from "@/app/dashboard/_components/MediaVideoRetoucher";
import type { MediaGenerationResult } from "@/app/dashboard/_hooks/useMediaGeneration";
import {
  buildInrStudioAbandonHref,
  buildInrStudioReturnHref,
  clearInrStudioHandoff,
  getInrStudioOriginLabel,
  loadInrStudioHandoffSourceFile,
  readInrStudioHandoff,
  saveInrStudioReturn,
  type InrStudioHandoff,
  type InrStudioReturnedMedia,
  type InrStudioTab,
} from "@/lib/inrStudioNavigation";
import {
  getImageOverlayLinkUrl,
  normalizeImageOverlay,
} from "@/lib/imageOverlay";
import { imageInteractionsFromOverlay } from "@/lib/imageInteractions";
import { uploadFileToMediaLibrary } from "@/lib/mediaLibraryUploadClient";
import { renderMediaRetoucherFile } from "@/lib/mediaRetoucherRenderClient";
import { requestBoosterVideoTransforms } from "@/lib/boosterVideoTransformClient";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import {
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  type BoosterVideoSourceMetadata,
  type ChannelKey,
} from "@/app/dashboard/booster/publier/publishModal.shared";

import styles from "./mediaGeneratorStudio.module.css";

function getImmediateSourcePreview(
  handoff: InrStudioHandoff | null
): MediaStudioInitialPreview | null {
  const source = handoff?.source;
  const url = String(source?.url || "").trim();
  if (!source || !url) return null;
  const mimeType = String(source.mimeType || "").toLowerCase();
  const extension = String(source.name || "")
    .toLowerCase()
    .split("?")[0]
    ?.split(".")
    .pop();
  if (
    source.mediaType === "image" &&
    (mimeType.includes("heic") ||
      mimeType.includes("heif") ||
      mimeType.includes("tiff") ||
      mimeType.includes("tif") ||
      ["heic", "heif", "tif", "tiff"].includes(extension || ""))
  ) {
    return null;
  }
  return {
    url,
    name:
      source.name ||
      (source.mediaType === "video"
        ? "video-inrstudio.mp4"
        : "image-inrstudio"),
    mimeType: source.mimeType,
    size: source.size,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asVideoVariants(value: unknown) {
  return Array.isArray(value)
    ? (value.filter(
        (entry) => entry && typeof entry === "object"
      ) as BoosterVideoTransformedVariant[])
    : [];
}

function getInitialVideoContext(
  handoff: InrStudioHandoff | null
): MediaVideoRetoucherInitialContext | null {
  if (handoff?.source?.mediaType !== "video") return null;
  const payload = handoff.payload || {};
  const channel = String(payload.videoChannel || "site_web") as ChannelKey;
  return {
    channel,
    format: normalizeVideoFormat(channel, payload.videoFormat),
    adaptationMode: normalizeVideoAdaptationMode(payload.videoAdaptationMode),
    storagePath: String(payload.videoStoragePath || "").trim() || null,
    publicUrl:
      String(payload.videoPublicUrl || handoff.source.url || "").trim() || null,
    durationSeconds: Number(payload.videoDurationSeconds || 0) || null,
    size: Number(payload.videoSize || handoff.source.size || 0) || null,
    sourceMetadata:
      (asRecord(
        payload.videoSourceMetadata
      ) as BoosterVideoSourceMetadata | null) || null,
    transformedVariants: asVideoVariants(payload.videoTransformedVariants),
    deferTechnicalPreparationUntilPublish:
      payload.deferVideoPreparation === true,
    mediaRecord: asRecord(payload.videoMediaRecord),
  };
}

function mergeVideoVariants(
  current: BoosterVideoTransformedVariant[],
  generated: BoosterVideoTransformedVariant[]
) {
  return [
    ...current.filter(
      (variant) =>
        !generated.some(
          (candidate) => candidate.signature === variant.signature
        )
    ),
    ...generated,
  ];
}

type StudioClientProps = {
  embeddedHandoff?: InrStudioHandoff;
  onEmbeddedReturn?: (result: InrStudioReturnedMedia) => Promise<void>;
  onEmbeddedClose?: () => void;
};

export default function MediaGeneratorStudioClient({
  embeddedHandoff,
  onEmbeddedReturn,
  onEmbeddedClose,
}: StudioClientProps = {}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [handoff, setHandoff] = useState<InrStudioHandoff | null>(null);
  const [initialTab, setInitialTab] = useState<InrStudioTab>("generate");
  const [initialSource, setInitialSource] = useState<File | null>(null);
  const [initialPreview, setInitialPreview] =
    useState<MediaStudioInitialPreview | null>(null);
  const [initialSourceLoading, setInitialSourceLoading] = useState(false);
  const sourceLoadRef = useRef<{
    handoffKey: string;
    promise: Promise<File | null>;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("studio_tab");
    const fallbackTab: InrStudioTab =
      requestedTab === "modify" || requestedTab === "retouch"
        ? requestedTab
        : "generate";
    const nextHandoff = embeddedHandoff || readInrStudioHandoff(params.get("studio_handoff"));
    setInitialTab(nextHandoff?.tab || fallbackTab);
    setHandoff(nextHandoff);
    setInitialPreview(getImmediateSourcePreview(nextHandoff));
    setInitialSourceLoading(Boolean(nextHandoff?.source));
    // Le studio et l'aperçu URL/blob peuvent être rendus sans attendre la
    // relecture complète du File depuis Cache API ou le réseau.
    setReady(true);

    void (async () => {
      try {
        let file: File | null = null;
        if (nextHandoff) {
          if (sourceLoadRef.current?.handoffKey !== nextHandoff.key) {
            sourceLoadRef.current = {
              handoffKey: nextHandoff.key,
              promise: loadInrStudioHandoffSourceFile(nextHandoff),
            };
          }
          file = await sourceLoadRef.current.promise;
        }
        if (active) setInitialSource(file);
      } catch {
        if (active) setInitialSource(null);
      } finally {
        if (active) setInitialSourceLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [embeddedHandoff]);

  const closeStudio = useCallback(() => {
    if (!handoff) {
      router.replace("/dashboard");
      return;
    }
    const returnHref = handoff.returnHref;
    void clearInrStudioHandoff(handoff.key).finally(() => {
      if (onEmbeddedClose) onEmbeddedClose();
      else router.replace(returnHref);
    });
  }, [handoff, onEmbeddedClose, router]);

  const abandonStudio = useCallback(() => {
    if (onEmbeddedClose) {
      closeStudio();
      return;
    }
    if (!handoff) {
      router.replace("/dashboard");
      return;
    }
    const abandonHref = buildInrStudioAbandonHref(handoff);
    void clearInrStudioHandoff(handoff.key).finally(() => {
      router.replace(abandonHref);
    });
  }, [closeStudio, handoff, onEmbeddedClose, router]);

  const deliverReturnedMedia = useCallback(async (item: Record<string, unknown>, action: InrStudioTab) => {
    if (!handoff) {
      router.replace("/dashboard/mediatheque");
      return;
    }
    const result: InrStudioReturnedMedia = {
      version: 1,
      returnKey: handoff.returnKey,
      handoffKey: handoff.key,
      action,
      createdAt: Date.now(),
      context: handoff.context,
      item,
    };
    if (onEmbeddedReturn && onEmbeddedClose) {
      await onEmbeddedReturn(result);
      await clearInrStudioHandoff(handoff.key);
      onEmbeddedClose();
      return;
    }
    saveInrStudioReturn(result);
    const returnHref = buildInrStudioReturnHref(handoff);
    await clearInrStudioHandoff(handoff.key);
    router.replace(returnHref);
  }, [handoff, onEmbeddedClose, onEmbeddedReturn, router]);

  const returnAcceptedMedia = useCallback(
    async (result: MediaGenerationResult) => {
      await deliverReturnedMedia(result.item as unknown as Record<string, unknown>, handoff?.tab || "generate");
    },
    [deliverReturnedMedia, handoff]
  );

  const saveRetouchedMedia = useCallback(
    async (value: MediaRetoucherSavedValue) => {
      const rendered = await renderMediaRetoucherFile({
        sourceFile: value.renderSourceFile,
        width: value.width,
        height: value.height,
        transform: value.transform,
      });
      const overlay = normalizeImageOverlay(value.transform.overlay);
      const overlayLinkUrl = getImageOverlayLinkUrl(overlay);
      const imageInteractions = imageInteractionsFromOverlay(overlay);
      const item = await uploadFileToMediaLibrary(rendered.file, {
        title: rendered.file.name.replace(/\.[^.]+$/, ""),
        source: "studio_retouch",
        width: rendered.width,
        height: rendered.height,
        tags: ["inrstudio", "retouche"],
        metadata: {
          studio_action: "retouch",
          source_name: value.sourceFile.name,
          transform: value.transform,
          ...(overlayLinkUrl ? { link_url: overlayLinkUrl } : {}),
          ...(imageInteractions ? { image_interactions: imageInteractions } : {}),
        },
      });
      const returnedItem: Record<string, unknown> = {
        ...item,
        ...(imageInteractions ? { image_interactions: imageInteractions } : {}),
        original_file_name:
          item.original_file_name || item.original_name || rendered.file.name,
        tags: ["inrstudio", "retouche"],
        width: item.width || rendered.width,
        height: item.height || rendered.height,
        duration_seconds: null,
        created_at: item.created_at || new Date().toISOString(),
      };

      await deliverReturnedMedia(returnedItem, "retouch");
    },
    [deliverReturnedMedia]
  );

  const saveRetouchedVideo = useCallback(
    async (value: MediaVideoRetoucherSavedValue) => {
      let sourceFile = value.source.file;
      let storagePath = value.source.storagePath;
      let publicUrl = String(value.source.url || "").trim();
      let libraryItem: Record<string, unknown> | null = value.source.libraryItem
        ? (value.source.libraryItem as unknown as Record<string, unknown>)
        : null;

      if (
        sourceFile &&
        (!storagePath || !publicUrl || publicUrl.startsWith("blob:"))
      ) {
        const uploaded = await uploadFileToMediaLibrary(sourceFile, {
          title: sourceFile.name.replace(/\.[^.]+$/, ""),
          source: "studio_video_retouch_source",
          width: value.source.sourceMetadata?.width || null,
          height: value.source.sourceMetadata?.height || null,
          durationSeconds: value.source.durationSeconds,
          tags: ["inrstudio", "retouche-video"],
          metadata: {
            studio_action: "retouch_video_source",
            channel: value.channel,
          },
        });
        storagePath = String(
          uploaded.storage_path || uploaded.storagePath || ""
        ).trim();
        publicUrl = String(
          uploaded.signed_url ||
            uploaded.public_url ||
            uploaded.publicUrl ||
            publicUrl
        ).trim();
        libraryItem = uploaded;
      }

      let transformedVariants = value.transformedVariants;
      if (!value.deferTechnicalPreparationUntilPublish) {
        const response = await requestBoosterVideoTransforms({
          source: {
            storagePath: storagePath || undefined,
            publicUrl: publicUrl || undefined,
            url: publicUrl || undefined,
            name: value.source.name,
            type: value.source.mimeType || "video/mp4",
            size: value.source.size || null,
            duration: value.source.durationSeconds,
            sourceMetadata: value.source.sourceMetadata,
          },
          variants: [
            {
              channel: value.channel,
              format: value.format,
              adaptationMode: value.adaptationMode,
            },
          ],
        });
        const generated = Array.isArray(response.variants)
          ? response.variants
          : [];
        if (!response.ok && !generated.length) {
          throw new Error(
            response.error ||
              response.errors?.[0]?.message ||
              "La retouche vidéo n’a pas pu être préparée."
          );
        }
        transformedVariants = mergeVideoVariants(
          transformedVariants,
          generated
        );
      }

      const returnedItem: Record<string, unknown> = {
        ...(libraryItem || {}),
        media_type: "video",
        original_file_name: value.source.name,
        mime_type: value.source.mimeType || "video/mp4",
        size_bytes: value.source.size || null,
        duration_seconds: value.source.durationSeconds,
        storage_path: storagePath || null,
        signed_url: publicUrl || null,
        source_metadata: value.source.sourceMetadata,
        video_format: value.format,
        video_adaptation_mode: value.adaptationMode,
        video_settings: {
          format: value.format,
          adaptationMode: value.adaptationMode,
        },
        video_settings_by_channel: {
          [value.channel]: {
            format: value.format,
            adaptationMode: value.adaptationMode,
          },
        },
        transformed_variants: transformedVariants,
        source_media_record: value.mediaRecord,
        studio_video_retouch: true,
      };

      if (!handoff) {
        if (!sourceFile && publicUrl) {
          const response = await fetch(publicUrl, { cache: "force-cache" });
          if (response.ok) {
            const blob = await response.blob();
            sourceFile = new File([blob], value.source.name, {
              type: blob.type || value.source.mimeType || "video/mp4",
              lastModified: Date.now(),
            });
          }
        }
        if (sourceFile && !libraryItem) {
          await uploadFileToMediaLibrary(sourceFile, {
            title: sourceFile.name.replace(/\.[^.]+$/, ""),
            source: "studio_video_retouch",
            width: value.source.sourceMetadata?.width || null,
            height: value.source.sourceMetadata?.height || null,
            durationSeconds: value.source.durationSeconds,
            tags: ["inrstudio", "retouche-video"],
            metadata: {
              studio_action: "retouch_video",
              channel: value.channel,
              format: value.format,
              adaptation_mode: value.adaptationMode,
              transformed_variants: transformedVariants,
            },
          });
        }
        router.replace("/dashboard/mediatheque");
        return;
      }

      await deliverReturnedMedia(returnedItem, "retouch");
    },
    [deliverReturnedMedia, handoff, router]
  );

  return (
    <>
      {!embeddedHandoff ? <main className={styles.page} aria-hidden="true" /> : null}
      {ready ? (
        <MediaGeneratorModal
          open
          embedded={Boolean(embeddedHandoff)}
          source="studio"
          origin={
            handoff?.origin === "booster" ||
            handoff?.origin === "publier" ||
            handoff?.origin === "booster-publish"
              ? "booster"
              : handoff?.origin === "inrsend" ||
                handoff?.origin === "mails" ||
                handoff?.origin === "inrsend-publish"
              ? "inrsend"
              : handoff?.origin === "inr-agent"
              ? "inragent"
              : "menu"
          }
          initialTab={initialTab}
          initialSource={initialSource}
          initialPreview={initialPreview}
          initialSourceLoading={initialSourceLoading}
          initialSourceAvailable={Boolean(handoff?.source)}
          initialMediaType={handoff?.source?.mediaType || "image"}
          initialVideoContext={getInitialVideoContext(handoff)}
          publicationBrief={handoff?.publicationBrief || ""}
          acceptMode={handoff ? "insert" : "library"}
          handoffOriginLabel={getInrStudioOriginLabel(handoff?.origin)}
          onClose={closeStudio}
          onAbandonHandoff={abandonStudio}
          onAccepted={returnAcceptedMedia}
          onRetouched={saveRetouchedMedia}
          onVideoRetouched={saveRetouchedVideo}
        />
      ) : null}
    </>
  );
}
