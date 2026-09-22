"use client";

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
import { prepareMediaGenerationImageReference } from "./MediaGenerator";
import type { BackgroundMode } from "./channel-image-adapter/types";
import type { ImageOverlay } from "@/lib/imageOverlay";
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
  ) => void | Promise<void>;
  acceptMode?: "library" | "insert";
};

type RetouchSource = {
  file: File;
  renderFile: File;
  previewUrl: string;
  width: number;
  height: number;
  metadata?: Record<string, unknown>;
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

function base64ImageBlob(data: string, mimeType: string) {
  const binary = window.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "image/jpeg" });
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
  const shellT = useTranslations("shell");
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
      setError(`Formats image acceptés : ${INR_MEDIA_IMAGE_FORMATS_LABEL}.`);
      return;
    }
    if (!file.size || file.size > INR_MEDIA_IMAGE_MAX_BYTES) {
      setLoadingSource(false);
      setError(`Cette image dépasse ${INR_MEDIA_IMAGE_MAX_MB_LABEL}.`);
      return;
    }

    const requestId = sourceRequestRef.current + 1;
    sourceRequestRef.current = requestId;
    setLoadingSource(true);
    void (async () => {
      let renderFile = file;
      let previewUrl = URL.createObjectURL(renderFile);
      try {
        let dimensions: { width: number; height: number };
        try {
          dimensions = await readPreviewDimensions(previewUrl);
        } catch {
          URL.revokeObjectURL(previewUrl);
          previewUrl = "";

          // Certains formats pris en charge par iNrCy (HEIC/HEIF/TIFF et
          // quelques AVIF/BMP) ne sont pas décodables par tous les navigateurs.
          // Le normaliseur commun fournit uniquement un JPEG d’aperçu : le
          // fichier original et ses métadonnées restent ceux transmis en sortie.
          const normalized = await prepareMediaGenerationImageReference(file);
          if (!mountedRef.current || sourceRequestRef.current !== requestId) {
            return;
          }
          const normalizedBlob = base64ImageBlob(
            normalized.data,
            normalized.mimeType,
          );
          const normalizedStem =
            file.name.replace(/\.[^.]+$/, "").slice(0, 120) ||
            "image-source";
          renderFile = new File([normalizedBlob], `${normalizedStem}.jpg`, {
            type: normalizedBlob.type || "image/jpeg",
            lastModified: file.lastModified || Date.now(),
          });
          previewUrl = URL.createObjectURL(renderFile);
          dimensions = await readPreviewDimensions(previewUrl);
        }

        if (!mountedRef.current || sourceRequestRef.current !== requestId) {
          URL.revokeObjectURL(previewUrl);
          return;
        }
        const nextTransform = cloneTransform(DEFAULT_TRANSFORM);
        baselineRef.current = cloneTransform(nextTransform);
        setTransform(nextTransform);
        setSource({
          file,
          renderFile,
          previewUrl,
          width: dimensions.width,
          height: dimensions.height,
          metadata,
        });
        setLoadingSource(false);
      } catch (previewError) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (!mountedRef.current || sourceRequestRef.current !== requestId) return;
        setLoadingSource(false);
        setError(
          previewError instanceof Error &&
            previewError.message !== "image_preview_unreadable"
            ? previewError.message
            : `Cette image ne peut pas être prévisualisée. Formats acceptés : ${INR_MEDIA_IMAGE_FORMATS_LABEL}.`,
        );
      }
    })();
  }, []);

  const importLibraryImage = async (item: MediaLibraryPickerItem) => {
    if (!item.signed_url) {
      throw new Error("Cette image n’est pas disponible dans la médiathèque.");
    }

    setError("");
    setLoadingSource(true);
    try {
      const response = await fetch(item.signed_url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Impossible de charger cette image de la médiathèque.");
      }
      const blob = await response.blob();
      const file = new File([blob], libraryItemName(item), {
        type: blob.type || item.mime_type || "image/jpeg",
        lastModified: Date.now(),
      });
      selectSource(file, false, {
        mediaLibraryId: item.id,
        storagePath: item.storage_path,
      });
    } catch (libraryError) {
      setLoadingSource(false);
      const message =
        libraryError instanceof Error
          ? libraryError.message
          : "Impossible de charger cette image de la médiathèque.";
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
          throw new Error("Impossible de charger cette image source.");
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
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger cette image source.",
        );
      })
      .finally(() => {
        if (sourceAbortRef.current === controller) {
          sourceAbortRef.current = null;
        }
      });
  }, [initialSource, openEditorOnInitialSource, selectSource]);

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

  const saveEditor = async () => {
    if (!source || saving) return;
    setSaving(true);
    setError("");
    try {
      await onSaved?.({
        sourceFile: source.file,
        renderSourceFile: source.renderFile,
        width: source.width,
        height: source.height,
        sourceMetadata: source.metadata,
        transform: cloneTransform(transform),
      });
      baselineRef.current = cloneTransform(transform);
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d’enregistrer cette retouche.",
      );
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
    setTransform(cloneTransform(DEFAULT_TRANSFORM));
  };

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

  const previewImageStyle: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: "100%",
    height: "100%",
    maxWidth: "none",
    objectFit: transform.fit,
    transform: `translate(calc(-50% + ${transform.offsetX}%), calc(-50% + ${transform.offsetY}%)) scale(${transform.zoom})`,
    transformOrigin: "center",
    display: "block",
    userSelect: "none",
    pointerEvents: "none",
  };

  const embeddedEditor = source ? (
    <ChannelImageAdapterModal
      open
      embedded
      title="Retoucher une image"
      subtitle={source.file.name}
      aspectRatio={`${source.width} / ${source.height}`}
      backgroundMode={transform.backgroundMode}
      backgroundColor={transform.backgroundColor}
      overlay={transform.overlay}
      fitLabel={
        transform.fit === "cover"
          ? shellT("plein_cadre_96d0dd78")
          : shellT("image_entiere_76cd8175")
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
            aria-label="Atelier de retouche"
          >
            <div className={styles.inlineEditorToolbar}>
              <div className={styles.inlineEditorIdentity}>
                <strong>{source.file.name}</strong>
                <span>
                  {source.width} × {source.height}px ·{" "}
                  {Math.max(1, Math.round(source.file.size / 1024))} Ko
                </span>
                {saved ? (
                  <em>
                    <i aria-hidden="true">✓</i> Retouche enregistrée
                  </em>
                ) : null}
              </div>
              <div className={styles.inlineEditorActions}>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sourcePreparing || saving}
                >
                  Remplacer depuis mon appareil
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(true)}
                  disabled={sourcePreparing || saving}
                >
                  Choisir dans ma médiathèque
                </button>
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
              <h2 id="media-retoucher-source-title">Image à retoucher</h2>
              <p>Cette image reste la base de votre retouche.</p>
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
                  alt={`Aperçu de ${source.file.name}`}
                  draggable={false}
                />
                <div className={styles.sourceMeta}>
                  <strong>{source.file.name}</strong>
                  <span>
                    {source.width} × {source.height}px ·{" "}
                    {Math.max(1, Math.round(source.file.size / 1024))} Ko
                  </span>
                </div>
                {saved ? (
                  <span className={styles.savedBadge}>
                    <i aria-hidden="true">✓</i>
                    Retouche enregistrée
                  </span>
                ) : null}
              </div>
            ) : initialPreview?.url ? (
              <div className={styles.sourcePreview} data-preparing="true">
                <img
                  src={initialPreview.url}
                  alt={`Aperçu de ${initialPreview.name}`}
                  draggable={false}
                />
                <div className={styles.sourceMeta}>
                  <strong>{initialPreview.name}</strong>
                  <span>Préparation des outils de retouche…</span>
                </div>
              </div>
            ) : (
              <label htmlFor={fileInputId} className={styles.emptyState}>
                <span className={styles.uploadGlyph} aria-hidden="true">
                  ＋
                </span>
                <strong>
                  {sourcePreparing
                    ? "Préparation de l’image…"
                    : "Déposez votre image ici"}
                </strong>
                <p>ou choisissez-la sur votre appareil</p>
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
              {source ? "Remplacer depuis mon appareil" : "Choisir sur mon appareil"}
            </button>
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              disabled={sourcePreparing || saving}
            >
              Choisir dans ma médiathèque
            </button>
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
              <h2 id="media-retoucher-tools-title">Outils de retouche</h2>
              <p>Choisissez ce que vous souhaitez modifier sur l’image.</p>
            </div>
          </header>

          <div className={styles.toolsEmpty} aria-label="Outils disponibles">
            <span aria-hidden="true">✦</span>
            <strong>Un seul atelier, tous les réglages</strong>
            <p>
              Ajoutez une image : elle apparaîtra directement à gauche, avec
              le cadrage, le fond et les textes à droite.
            </p>
          </div>

          <div className={styles.toolsNote}>
            <span aria-hidden="true">◎</span>
            <p>
              Ajoutez d’abord une image pour activer l’atelier de retouche.
            </p>
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
              ? "Votre retouche est enregistrée"
              : source
                ? "Prêt à retoucher votre image ?"
                : "Ajoutez une image pour commencer"}
          </strong>
          <span>
            {saved
              ? "Vous pouvez rouvrir l’atelier pour poursuivre les ajustements."
              : "Ouvrez l’atelier, utilisez les outils puis enregistrez le rendu."}
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
              ? "Utilisation du média…"
              : "Enregistrement…"
            : acceptMode === "insert"
              ? "Utiliser ce média"
              : "Enregistrer dans la Médiathèque"}
        </button>
      </footer>

      <MediaLibraryPickerModal
        open={libraryOpen}
        title="Choisir l’image à retoucher"
        subtitle={`Tous les formats image iNrCy sont acceptés · ${INR_MEDIA_IMAGE_MAX_MB_LABEL} max.`}
        accept="image"
        multiple={false}
        maxSelection={1}
        maxImageBytes={INR_MEDIA_IMAGE_MAX_BYTES}
          confirmLabel={
            acceptMode === "insert"
              ? "Utiliser ce média"
              : "Enregistrer dans la Médiathèque"
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
