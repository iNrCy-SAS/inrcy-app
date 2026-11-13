"use client";
import { getClientUserFacingErrorMessage as getSafeClientErrorMessage } from "@/lib/userFacingErrors";

import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { ChannelImageAdapterModal } from "./ChannelImageAdapterTool";
import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "./MediaLibraryPickerModal";
import { prepareMediaImageEditMaster } from "@/lib/mediaImageEditMasterClient";
import type { BackgroundMode } from "./channel-image-adapter/types";
import type { ImageOverlay } from "@/lib/imageOverlay";
import { useInrAssistantImageCommands } from "../_hooks/useInrAssistantImageCommands";
import { useInrAssistantLocalInterface } from "../_hooks/useInrAssistantLocalInterface";
import { loadInrAssistantLibraryImage } from "@/lib/inrAssistantMediaUiClient";
import { resolveRetoucherGeometry } from "@/lib/mediaRetoucherGeometry";
import {
  INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS,
  INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  INR_MEDIA_IMAGE_FORMATS_LABEL,
  INR_MEDIA_IMAGE_MAX_BYTES,
  INR_MEDIA_IMAGE_MAX_MB_LABEL,
  isInrMediaImageFile,
} from "@/lib/mediaRules";

import styles from "./MediaRetoucher.module.css";

export type MediaRetoucherTransform = {
  fit: "contain" | "cover";
  zoom: number;
  offsetX: number;
  offsetY: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  overlay?: ImageOverlay;
};

export type MediaRetoucherInitialSource = {
  file?: File | null;
  url?: string | null;
  name?: string | null;
  mimeType?: string | null;
  metadata?: Record<string, unknown>;
};

export type MediaRetoucherSourceValue = {
  sourceFile: File;
  width: number;
  height: number;
  sourceMetadata?: Record<string, unknown>;
};

export type MediaRetoucherSavedValue = MediaRetoucherSourceValue & {
  /** Browser-decodable source used by the canvas renderer. */
  renderSourceFile: File;
  transform: MediaRetoucherTransform;
};
export type MediaRetoucherSaveOptions = { keepOpen?: boolean; isCurrent?: () => boolean };
export type MediaRetoucherSaveReceipt = { savedMediaId: string };

export type MediaStudioInitialPreview = {
  url: string;
  name: string;
  mimeType?: string;
  size?: number;
};

export type MediaRetoucherProps = {
  /** Optional source used when another iNrCy surface opens Retoucher. */
  initialSource?: File | MediaRetoucherInitialSource | null;
  initialPreview?: MediaStudioInitialPreview | null;
  initialSourceLoading?: boolean;
  openEditorOnInitialSource?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSourceChange?: (source: MediaRetoucherSourceValue | null) => void;
  onSaved?: (
    value: MediaRetoucherSavedValue,
    options?: MediaRetoucherSaveOptions,
  ) => void | MediaRetoucherSaveReceipt | Promise<void | MediaRetoucherSaveReceipt>;
  acceptMode?: "library" | "insert";
};

type RetouchSource = {
  file: File;
  renderFile: File;
  previewUrl: string;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
  preserveAlpha: boolean;
};

const DEFAULT_TRANSFORM: MediaRetoucherTransform = {
  fit: "contain",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  backgroundMode: "white",
  backgroundColor: "#ffffff",
};

const SOURCE_ACCEPT = [
  ...INR_MEDIA_ALLOWED_IMAGE_MIME_TYPES,
  ...INR_MEDIA_ALLOWED_IMAGE_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

const IMAGE_PREVIEW_LOAD_TIMEOUT_MS = 8_000;

function libraryItemName(item: MediaLibraryPickerItem) {
  return (
    item.original_file_name ||
    item.title ||
    item.storage_path.split("/").pop() ||
    "image-source.jpg"
  );
}

function readPreviewDimensions(previewUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const finish = (
      result:
        | { ok: true; width: number; height: number }
        | { ok: false; error: Error },
    ) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      if (result.ok) {
        resolve({ width: result.width, height: result.height });
      } else {
        reject(result.error);
      }
    };
    const timeoutId = window.setTimeout(
      () =>
        finish({
          ok: false,
          error: new Error("image_preview_timeout"),
        }),
      IMAGE_PREVIEW_LOAD_TIMEOUT_MS,
    );
    image.decoding = "async";
    image.onload = () =>
      finish({
        ok: true,
        width: Math.max(1, image.naturalWidth || 1),
        height: Math.max(1, image.naturalHeight || 1),
      });
    image.onerror = () =>
      finish({ ok: false, error: new Error("image_preview_unreadable") });
    image.src = previewUrl;
  });
}

function cloneTransform(
  transform: MediaRetoucherTransform,
): MediaRetoucherTransform {
  return {
    ...transform,
    overlay: transform.overlay
      ? {
          ...transform.overlay,
          items: transform.overlay.items?.map((item) => ({ ...item })),
        }
      : undefined,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export default function MediaRetoucher({
  initialSource = null,
  initialPreview = null,
  initialSourceLoading = false,
  openEditorOnInitialSource = true,
  onEditingChange,
  onDirtyChange,
  onSourceChange,
  onSaved,
  acceptMode = "library",
}: MediaRetoucherProps) {
  const t = useTranslations("media");
  const i18nT = useTranslations("shell");
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const sourceRequestRef = useRef(0);
  const sourceAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const unmountCleanupTimerRef = useRef<number | null>(null);
  const initializedSourceRef = useRef<
    File | MediaRetoucherInitialSource | null
  >(null);
  const baselineRef = useRef<MediaRetoucherTransform>(
    cloneTransform(DEFAULT_TRANSFORM),
  );
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const [source, setSource] = useState<RetouchSource | null>(null);
  const [transform, setTransform] = useState<MediaRetoucherTransform>(() =>
    cloneTransform(DEFAULT_TRANSFORM),
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const sourcePreparing =
    loadingSource ||
    Boolean(initialSourceLoading && !source && initialPreview?.url);
  useInrAssistantLocalInterface("studio_retouch_library", { open: libraryOpen }, {
    open: { invoke: () => { if (sourcePreparing || saving) throw new Error("reference_picker_unavailable"); setLibraryOpen(true); }, matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === true },
    close: { invoke: () => setLibraryOpen(false), matches: state => !!state && typeof state === "object" && (state as { open?: boolean }).open === false },
  }, true, sourcePreparing || saving);

  useEffect(() => {
    return () => {
      if (source?.previewUrl) URL.revokeObjectURL(source.previewUrl);
    };
  }, [source?.previewUrl]);

  useEffect(() => {
    mountedRef.current = true;
    if (unmountCleanupTimerRef.current !== null) {
      window.clearTimeout(unmountCleanupTimerRef.current);
      unmountCleanupTimerRef.current = null;
    }
    return () => {
      mountedRef.current = false;
      // React StrictMode rejoue setup -> cleanup -> setup en développement.
      // Différer l'invalidation d'un tour permet au second setup de conserver
      // le chargement initial au lieu de laisser « Préparation de l’image… »
      // bloqué. Lors d'un vrai démontage, le timer annule bien la requête.
      unmountCleanupTimerRef.current = window.setTimeout(() => {
        if (mountedRef.current) return;
        sourceRequestRef.current += 1;
        sourceAbortRef.current?.abort();
        sourceAbortRef.current = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    onEditingChange?.(sourcePreparing || saving);
    return () => onEditingChange?.(false);
  }, [onEditingChange, saving, sourcePreparing]);

  useEffect(() => {
    onDirtyChange?.(Boolean(source) && !saved);
    return () => onDirtyChange?.(false);
  }, [onDirtyChange, saved, source]);

  const updateTransform = (patch: Partial<MediaRetoucherTransform>) => {
    setSaved(false);
    setTransform((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    onSourceChange?.(
      source
        ? {
            sourceFile: source.file,
            width: source.width,
            height: source.height,
            sourceMetadata: source.metadata,
          }
        : null,
    );
  }, [onSourceChange, source]);

  const selectSource = useCallback((
    file: File | undefined,
    _openAfterLoad = false,
    metadata?: Record<string, unknown>,
  ) => {
    if (!file) return;
    sourceAbortRef.current?.abort();
    sourceAbortRef.current = null;
    setError("");
    setSaved(false);

    if (!isInrMediaImageFile(file)) {
      setLoadingSource(false);
      setError(i18nT("formats_image_acceptes_value_3bc372c6", { value0: INR_MEDIA_IMAGE_FORMATS_LABEL }));
      return;
    }
    if (!file.size || file.size > INR_MEDIA_IMAGE_MAX_BYTES) {
      setLoadingSource(false);
      setError(i18nT("cette_image_depasse_value_96655927", { value0: INR_MEDIA_IMAGE_MAX_MB_LABEL }));
      return;
    }

    const requestId = sourceRequestRef.current + 1;
    sourceRequestRef.current = requestId;
    setLoadingSource(true);
    void (async () => {
      let renderFile = file;
      let previewUrl = URL.createObjectURL(renderFile);
      let preserveAlpha = /image\/(png|webp)/i.test(file.type);
      let sourceMetadata = metadata;
      try {
        let dimensions: { width: number; height: number };
        try {
          dimensions = await readPreviewDimensions(previewUrl);
        } catch {
          URL.revokeObjectURL(previewUrl);
          previewUrl = "";

          // Certains formats pris en charge par iNrCy (HEIC/HEIF/TIFF et
          // quelques AVIF/BMP) ne sont pas décodables par tous les navigateurs.
          // A lossless editing master is distinct from the small AI reference.
          const master = await prepareMediaImageEditMaster(file);
          if (!mountedRef.current || sourceRequestRef.current !== requestId) {
            return;
          }
          renderFile = master.file;
          preserveAlpha = master.hasAlpha;
          previewUrl = URL.createObjectURL(renderFile);
          await readPreviewDimensions(previewUrl);
          dimensions = { width: master.width, height: master.height };
          sourceMetadata = { ...metadata, edit_master: { width: master.masterWidth, height: master.masterHeight, sourceWidth: master.width, sourceHeight: master.height } };
        }

        if (!mountedRef.current || sourceRequestRef.current !== requestId) {
          URL.revokeObjectURL(previewUrl);
          return;
        }
        const nextTransform = cloneTransform(DEFAULT_TRANSFORM);
        if (preserveAlpha) nextTransform.backgroundMode = "transparent";
        baselineRef.current = cloneTransform(nextTransform);
        setTransform(nextTransform);
        setSource({
          file,
          renderFile,
          previewUrl,
          width: dimensions.width,
          height: dimensions.height,
          metadata: sourceMetadata,
          preserveAlpha,
        });
        setLoadingSource(false);
      } catch (previewError) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (!mountedRef.current || sourceRequestRef.current !== requestId) return;
        setLoadingSource(false);
        setError(
          getSafeClientErrorMessage(previewError, i18nT("media_ui_df3c0e9f28", { formats: INR_MEDIA_IMAGE_FORMATS_LABEL })),
        );
      }
    })();
  }, [i18nT]);

  const importLibraryImage = async (item: MediaLibraryPickerItem, stillCurrent: () => boolean = () => true) => {
    if (!item.signed_url) {
      throw new Error(i18nT("media_ui_7c3b3d1b46"));
    }

    setError("");
    setLoadingSource(true);
    try {
      const response = await fetch(item.signed_url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(i18nT("media_ui_a2c06199f6"));
      }
      const blob = await response.blob();
      if (!stillCurrent()) return false;
      const file = new File([blob], libraryItemName(item), {
        type: blob.type || item.mime_type || "image/jpeg",
        lastModified: Date.now(),
      });
      selectSource(file, false, {
        mediaLibraryId: item.id,
        storagePath: item.storage_path,
      });
      return true;
    } catch (libraryError) {
      setLoadingSource(false);
      const message =
        getSafeClientErrorMessage(libraryError, i18nT("media_ui_a2c06199f6"));
      setError(message);
      throw libraryError;
    }
  };

  useEffect(() => {
    if (!initialSource || initializedSourceRef.current === initialSource) return;
    initializedSourceRef.current = initialSource;
    if (initialSource instanceof File) {
      selectSource(initialSource, openEditorOnInitialSource);
      return;
    }
    if (initialSource.file) {
      selectSource(
        initialSource.file,
        openEditorOnInitialSource,
        initialSource.metadata,
      );
      return;
    }

    const sourceUrl = String(initialSource.url || "").trim();
    if (!sourceUrl) return;
    sourceAbortRef.current?.abort();
    const requestId = sourceRequestRef.current + 1;
    sourceRequestRef.current = requestId;
    const controller = new AbortController();
    sourceAbortRef.current = controller;
    setLoadingSource(true);
    setError("");

    void fetch(sourceUrl, {
      signal: controller.signal,
      credentials: "include",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(i18nT("media_ui_275d4d5578"));
        }
        const blob = await response.blob();
        if (!mountedRef.current || sourceRequestRef.current !== requestId) return;
        const sourceName =
          String(initialSource.name || "").trim() ||
          (() => {
            try {
              return decodeURIComponent(
                new URL(sourceUrl, window.location.href).pathname
                  .split("/")
                  .filter(Boolean)
                  .pop() || "image-source",
              );
            } catch {
              return "image-source";
            }
          })();
        const file = new File([blob], sourceName, {
          type:
            blob.type ||
            String(initialSource.mimeType || "").trim() ||
            "image/jpeg",
          lastModified: Date.now(),
        });
        selectSource(
          file,
          openEditorOnInitialSource,
          initialSource.metadata,
        );
      })
      .catch((loadError) => {
        if (
          controller.signal.aborted ||
          !mountedRef.current ||
          sourceRequestRef.current !== requestId
        ) {
          return;
        }
        setLoadingSource(false);
        setError(
          getSafeClientErrorMessage(loadError, i18nT("media_ui_275d4d5578")),
        );
      })
      .finally(() => {
        if (sourceAbortRef.current === controller) {
          sourceAbortRef.current = null;
        }
      });
  }, [i18nT, initialSource, openEditorOnInitialSource, selectSource]);

  const removeSource = () => {
    sourceAbortRef.current?.abort();
    sourceAbortRef.current = null;
    sourceRequestRef.current += 1;
    setLoadingSource(false);
    setSource(null);
    setTransform(cloneTransform(DEFAULT_TRANSFORM));
    baselineRef.current = cloneTransform(DEFAULT_TRANSFORM);
    setSaved(false);
    setError("");
  };

  const savedCopy = useRef<string | null>(null);
  const saveEditor = async (options?: MediaRetoucherSaveOptions) => {
    if (!source || saving || options?.isCurrent?.() === false) return false;
    setSaving(true);
    setError("");
    try {
      const receipt = await onSaved?.({
        sourceFile: source.file,
        renderSourceFile: source.renderFile,
        width: source.width,
        height: source.height,
        sourceMetadata: source.metadata,
        transform: cloneTransform(transform),
      }, options);
      if (options?.isCurrent?.() === false) return false;
      if (options?.keepOpen && (!receipt || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(receipt.savedMediaId))) return false;
      savedCopy.current = receipt?.savedMediaId ?? null;
      baselineRef.current = cloneTransform(transform);
      setSaved(true);
      return true;
    } catch (saveError) {
      setError(
        getSafeClientErrorMessage(saveError, i18nT("media_ui_157738c871")),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  const nudgeZoom = (delta: number) => {
    setSaved(false);
    setTransform((current) => ({
      ...current,
      zoom: clamp(current.zoom + delta, 0.4, 3),
    }));
  };

  const resetTransform = () => {
    setSaved(false);
    setTransform({ ...cloneTransform(DEFAULT_TRANSFORM), ...(source?.preserveAlpha ? { backgroundMode: "transparent" as const } : {}) });
  };

  useInrAssistantImageCommands({
    snapshot: { source: source?.metadata?.mediaLibraryId ?? source?.previewUrl ?? null, transform },
    enabled: !saving && !loadingSource && !initialSourceLoading, hasSource: Boolean(source), canSave: Boolean(source && onSaved && !saved && acceptMode === "library"), channel: "image", pendingChanges: Boolean(source && !saved),
    apply: async (command, stillCurrent, scopeCurrent) => {
      if (command.command === "select_image_source") { const item = await loadInrAssistantLibraryImage(command.mediaId, stillCurrent); return Boolean(item && stillCurrent() && await importLibraryImage(item, stillCurrent)); }
      if (!source || !stillCurrent()) return false;
      savedCopy.current = null;
      if (command.command === "save_image_retouch") return saveEditor({ keepOpen: true, isCurrent: scopeCurrent });
      if (command.command === "reset_image_retouch") { resetTransform(); return true; }
      const patch = command.patch;
      setSaved(false); setTransform(current => ({ ...current, ...patch, ...(patch.overlay === null ? { overlay: undefined } : {}) } as MediaRetoucherTransform)); return true;
    },
    isApplied: command => command.command === "select_image_source" ? source?.metadata?.mediaLibraryId === command.mediaId && !loadingSource
      : command.command === "save_image_retouch" ? Boolean(saved && savedCopy.current)
        : command.command === "reset_image_retouch" ? JSON.stringify(transform) === JSON.stringify({ ...cloneTransform(DEFAULT_TRANSFORM), ...(source?.preserveAlpha ? { backgroundMode: "transparent" } : {}) })
          : Object.entries(command.patch).every(([key, value]) => JSON.stringify(transform[key as keyof MediaRetoucherTransform]) === JSON.stringify(value === null ? undefined : value)),
  });

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!previewRef.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    };
    setIsDraggingImage(true);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const stage = previewRef.current;
    if (!drag || !stage || drag.pointerId !== event.pointerId) return;
    const rect = stage.getBoundingClientRect();
    setSaved(false);
    setTransform((current) => ({
      ...current,
      offsetX: clamp(
        drag.offsetX +
          ((event.clientX - drag.startX) / Math.max(1, rect.width)) * 100,
        -100,
        100,
      ),
      offsetY: clamp(
        drag.offsetY +
          ((event.clientY - drag.startY) / Math.max(1, rect.height)) * 100,
        -100,
        100,
      ),
    }));
  };

  const endPointerDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setIsDraggingImage(false);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.cancelable) event.preventDefault();
    nudgeZoom(event.deltaY < 0 ? 0.08 : -0.08);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingFile(false);
    selectSource(event.dataTransfer.files?.[0], false);
  };

  const previewGeometry = resolveRetoucherGeometry({
    canvasWidth: source?.width || 1,
    canvasHeight: source?.height || 1,
    sourceWidth: source?.width || 1,
    sourceHeight: source?.height || 1,
    ...transform,
  });
  const previewImageStyle: CSSProperties = {
    position: "absolute",
    left: `${previewGeometry.drawX / (source?.width || 1) * 100}%`,
    top: `${previewGeometry.drawY / (source?.height || 1) * 100}%`,
    width: `${previewGeometry.drawWidth / (source?.width || 1) * 100}%`,
    height: `${previewGeometry.drawHeight / (source?.height || 1) * 100}%`,
    maxWidth: "none",
    display: "block",
    userSelect: "none",
    pointerEvents: "none",
  };

  const embeddedEditor = source ? (
    <ChannelImageAdapterModal
      open
      embedded
      previewInfoPlacement="below"
      title={i18nT("retoucher_une_image_75a69232")}
      subtitle={source.file.name}
      aspectRatio={`${source.width} / ${source.height}`}
      backgroundMode={transform.backgroundMode}
      backgroundColor={transform.backgroundColor}
      overlay={transform.overlay}
      fitLabel={
        transform.fit === "cover"
          ? i18nT("plein_cadre_96d0dd78")
          : i18nT("image_entiere_76cd8175")
      }
      zoomLabel={`${transform.zoom.toFixed(2)}×`}
      previewSrc={source.previewUrl}
      previewImageStyle={previewImageStyle}
      isDragging={isDraggingImage}
      onClose={() => undefined}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onDoubleClick={() => updateTransform({ offsetX: 0, offsetY: 0 })}
      previewRef={previewRef}
      buttonClassName={styles.adapterButton}
      primaryButtonClassName={styles.adapterPrimaryButton}
      onZoomOut={() => nudgeZoom(-0.08)}
      onZoomIn={() => nudgeZoom(0.08)}
      onContain={() =>
        updateTransform({
          fit: "contain",
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        })
      }
      onCover={() =>
        updateTransform({
          fit: "cover",
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        })
      }
      onReset={resetTransform}
      onSave={() => void saveEditor()}
      saving={saving}
      onBackgroundModeChange={(mode) =>
        updateTransform({
          backgroundMode: mode,
          backgroundColor:
            mode === "black"
              ? "#0d1320"
              : mode === "white"
                ? "#ffffff"
                : transform.backgroundColor,
          fit: "contain",
          zoom: 1,
          offsetX: 0,
          offsetY: 0,
        })
      }
      onBackgroundColorChange={(color) =>
        updateTransform({
          backgroundMode: "color",
          backgroundColor: color,
        })
      }
      onOverlayChange={(overlay) => updateTransform({ overlay })}
      pillButtonStyle={{}}
      pillButtonActiveStyle={{}}
    />
  ) : null;

  return (
    <div className={styles.workspace} data-saved={saved ? "true" : "false"}>
      <main className={styles.formContent}>
        <input
          ref={fileInputRef}
          id={fileInputId}
          type="file"
          accept={SOURCE_ACCEPT}
          hidden
          disabled={sourcePreparing || saving}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            selectSource(file, false);
          }}
        />

        {source && embeddedEditor ? (
          <section
            className={styles.inlineEditorPanel}
            aria-label={i18nT("atelier_de_retouche_f2787f17")}
          >
            <div className={styles.inlineEditorToolbar}>
              <div className={styles.inlineEditorIdentity}>
                <strong>{source.file.name}</strong>
                <span>
                  {source.width} × {source.height}{i18nT("px_98bb7667")}{" "}
                  {Math.max(1, Math.round(source.file.size / 1024))} {" "}{i18nT("ko_d7f41e28")}{" "}</span>
                {saved ? (
                  <em>
                    <i aria-hidden="true">✓</i> {" "}{i18nT("retouche_enregistree_86d5280f")}{" "}</em>
                ) : null}
              </div>
              <div className={styles.inlineEditorActions}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sourcePreparing || saving}
                >
                  {i18nT("remplacer_depuis_mon_appareil_96ca8626")}{" "}</button>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  disabled={sourcePreparing || saving}
                >
                  {i18nT("choisir_dans_ma_mediatheque_dc58b0e0")}{" "}</button>
                <button
                  type="button"
                  className={styles.removeButton}
                  onClick={removeSource}
                  disabled={sourcePreparing || saving}
                >
                  {t("ai_generator_inspiration_remove")}
                </button>
              </div>
            </div>
            <div className={styles.inlineEditorSurface}>{embeddedEditor}</div>
          </section>
        ) : (
          <>
        <section
          className={styles.panel}
          aria-labelledby="media-retoucher-source-title"
        >
          <header className={styles.panelHeader}>
            <span aria-hidden="true">1</span>
            <div>
              <h2 id="media-retoucher-source-title">{i18nT("image_a_retoucher_9a08f28d")}</h2>
              <p>{i18nT("cette_image_reste_la_base_de_3f9fbb24")}</p>
            </div>
          </header>

          <div
            className={styles.dropZone}
            data-active={isDraggingFile ? "true" : "false"}
            data-has-source={source ? "true" : "false"}
            aria-busy={sourcePreparing}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!sourcePreparing && !saving) setIsDraggingFile(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                setIsDraggingFile(false);
              }
            }}
            onDrop={(event) => {
              if (sourcePreparing || saving) {
                event.preventDefault();
                return;
              }
              handleDrop(event);
            }}
          >
            {source ? (
              <div className={styles.sourcePreview}>
                <img
                  src={source.previewUrl}
                  alt={i18nT("apercu_de_value_11d346cb", { value0: source.file.name })}
                  draggable={false}
                />
                <div className={styles.sourceMeta}>
                  <strong>{source.file.name}</strong>
                  <span>
                    {source.width} × {source.height}{i18nT("px_98bb7667")}{" "}
                    {Math.max(1, Math.round(source.file.size / 1024))} {" "}{i18nT("ko_d7f41e28")}{" "}</span>
                </div>
                {saved ? (
                  <span className={styles.savedBadge}>
                    <i aria-hidden="true">✓</i>
                    {i18nT("retouche_enregistree_86d5280f")}{" "}</span>
                ) : null}
              </div>
            ) : initialPreview?.url ? (
              <div className={styles.sourcePreview} data-preparing="true">
                <img
                  src={initialPreview.url}
                  alt={i18nT("apercu_de_value_11d346cb", { value0: initialPreview.name })}
                  draggable={false}
                />
                <div className={styles.sourceMeta}>
                  <strong>{initialPreview.name}</strong>
                  <span>{i18nT("preparation_des_outils_de_retouche_586484d1")}</span>
                </div>
              </div>
            ) : (
              <label htmlFor={fileInputId} className={styles.emptyState}>
                <span className={styles.uploadGlyph} aria-hidden="true">
                  ＋
                </span>
                <strong>
                  {sourcePreparing
                    ? i18nT("preparation_de_l_image_de911ede")
                    : i18nT("deposez_votre_image_ici_365e72e8")}
                </strong>
                <p>{i18nT("ou_choisissez_la_sur_votre_appareil_6bc348d2")}</p>
                <span className={styles.formatHint}>
                  {INR_MEDIA_IMAGE_FORMATS_LABEL} ·{" "}
                  {INR_MEDIA_IMAGE_MAX_MB_LABEL} max.
                </span>
              </label>
            )}
          </div>

          <div className={styles.importActions}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sourcePreparing || saving}
            >
              {source ? i18nT("remplacer_depuis_mon_appareil_96ca8626") : i18nT("choisir_sur_mon_appareil_b5f2c497")}
            </button>
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              disabled={sourcePreparing || saving}
            >
              {i18nT("choisir_dans_ma_mediatheque_dc58b0e0")}{" "}</button>
            {source ? (
              <button
                type="button"
                className={styles.removeButton}
                onClick={removeSource}
                disabled={sourcePreparing || saving}
              >
                {t("ai_generator_inspiration_remove")}
              </button>
            ) : null}
          </div>
        </section>

        <section
          className={`${styles.panel} ${styles.toolsPanel}`}
          aria-labelledby="media-retoucher-tools-title"
        >
          <header className={styles.panelHeader}>
            <span aria-hidden="true">2</span>
            <div>
              <h2 id="media-retoucher-tools-title">{i18nT("outils_de_retouche_9dfbe4d6")}</h2>
              <p>{i18nT("choisissez_ce_que_vous_souhaitez_modifier_2ed9c58d")}</p>
            </div>
          </header>

          <div className={styles.toolsEmpty} aria-label={i18nT("outils_disponibles_ed64a2bd")}>
            <span aria-hidden="true">✦</span>
            <strong>{i18nT("un_seul_atelier_tous_les_reglages_9f8e1c1d")}</strong>
            <p>
              {i18nT("ajoutez_une_image_elle_apparaitra_directement_100a305c")}{" "}</p>
          </div>

          <div className={styles.toolsNote}>
            <span aria-hidden="true">◎</span>
            <p>
              {i18nT("ajoutez_d_abord_une_image_pour_9ffd2135")}{" "}</p>
          </div>
        </section>
          </>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </main>

      <footer className={styles.actionBar}>
        <div aria-live="polite">
          <strong>
            {saved
              ? i18nT("votre_retouche_est_enregistree_8c4af837")
              : source
                ? i18nT("pret_a_retoucher_votre_image_e15fceae")
                : i18nT("ajoutez_une_image_pour_commencer_42a4eb6b")}
          </strong>
          <span>
            {saved
              ? i18nT("vous_pouvez_poursuivre_les_ajustements_dans_66d4397f")
              : i18nT("ajustez_votre_image_dans_l_atelier_e0fa80a5")}
          </span>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => {
            if (source) void saveEditor();
          }}
          disabled={!source || sourcePreparing || saving}
        >
          <span aria-hidden="true">✎</span>
          {saving
            ? acceptMode === "insert"
              ? i18nT("utilisation_du_media_4e6bf473")
              : i18nT("enregistrement_e7d5f232")
            : acceptMode === "insert"
              ? i18nT("utiliser_ce_media_5cc61021")
              : i18nT("enregistrer_dans_la_mediatheque_113a0c12")}
        </button>
      </footer>

      <MediaLibraryPickerModal
        open={libraryOpen}
        title={i18nT("choisir_l_image_a_retoucher_fee2a339")}
        subtitle={i18nT("media_ui_5b6db67881", { size: INR_MEDIA_IMAGE_MAX_MB_LABEL })}
        accept="image"
        multiple={false}
        maxSelection={1}
        maxImageBytes={INR_MEDIA_IMAGE_MAX_BYTES}
          confirmLabel={
            acceptMode === "insert"
              ? i18nT("utiliser_ce_media_5cc61021")
              : i18nT("enregistrer_dans_la_mediatheque_113a0c12")
          }
        onClose={() => setLibraryOpen(false)}
        onConfirm={async (items) => {
          const item = items[0];
          if (item) await importLibraryImage(item);
        }}
      />
    </div>
  );
}
