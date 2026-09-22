"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type DragEvent } from "react";

import MediaLibraryPickerModal, {
  type MediaLibraryPickerItem,
} from "./MediaLibraryPickerModal";
import BoosterVideoFormatManager from "../booster/publier/components/BoosterVideoFormatManager";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import {
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  type BoosterVideoSourceMetadata,
  type ChannelKey,
  type VideoAdaptationMode,
  type VideoFormat,
} from "../booster/publier/publishModal.shared";
import {
  UNIVERSAL_MEDIA_VIDEO_EXTENSIONS,
  UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES,
  UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  detectUniversalUploadMediaType,
  getUniversalMediaContentType,
} from "@/lib/mediaUploadPolicy";

import styles from "./MediaVideoRetoucher.module.css";

export type MediaVideoRetoucherInitialContext = {
  channel: ChannelKey;
  format: VideoFormat;
  adaptationMode: VideoAdaptationMode;
  storagePath?: string | null;
  publicUrl?: string | null;
  durationSeconds?: number | null;
  size?: number | null;
  sourceMetadata?: BoosterVideoSourceMetadata | null;
  transformedVariants?: BoosterVideoTransformedVariant[];
  deferTechnicalPreparationUntilPublish?: boolean;
  mediaRecord?: Record<string, unknown> | null;
};

export type MediaVideoRetoucherSource = {
  file: File | null;
  url: string;
  name: string;
  mimeType: string;
  size: number;
  durationSeconds: number | null;
  storagePath: string | null;
  sourceMetadata: BoosterVideoSourceMetadata | null;
  libraryItem?: MediaLibraryPickerItem | null;
};

export type MediaVideoRetoucherSavedValue = {
  source: MediaVideoRetoucherSource;
  channel: ChannelKey;
  format: VideoFormat;
  adaptationMode: VideoAdaptationMode;
  transformedVariants: BoosterVideoTransformedVariant[];
  deferTechnicalPreparationUntilPublish: boolean;
  mediaRecord: Record<string, unknown> | null;
};

type MediaVideoRetoucherProps = {
  initialSource?: File | null;
  initialPreview?: {
    url: string;
    name: string;
    mimeType?: string;
    size?: number;
  } | null;
  initialSourceLoading?: boolean;
  initialContext?: MediaVideoRetoucherInitialContext | null;
  onEditingChange?: (editing: boolean) => void;
  onSaved?: (value: MediaVideoRetoucherSavedValue) => void | Promise<void>;
  acceptMode?: "library" | "insert";
};

const SOURCE_ACCEPT = [
  ...UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  ...UNIVERSAL_MEDIA_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

function orientationFor(width: number, height: number) {
  if (!width || !height) return "unknown" as const;
  if (Math.abs(width - height) <= Math.max(width, height) * 0.04) {
    return "square" as const;
  }
  return width > height ? ("horizontal" as const) : ("vertical" as const);
}

function ratioLabel(width: number, height: number) {
  if (!width || !height) return "";
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.04) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.04) return "9:16";
  if (Math.abs(ratio - 1) < 0.04) return "1:1";
  if (Math.abs(ratio - 4 / 5) < 0.04) return "4:5";
  return `${width}:${height}`;
}

async function readBrowserVideoMetadata(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<BoosterVideoSourceMetadata | null>((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      const finish = (value: BoosterVideoSourceMetadata | null) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        video.onloadedmetadata = null;
        video.onerror = null;
        resolve(value);
      };
      const timeout = window.setTimeout(() => finish(null), 8_000);
      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => {
        const width = Number(video.videoWidth || 0);
        const height = Number(video.videoHeight || 0);
        const duration = Number.isFinite(video.duration)
          ? video.duration
          : null;
        const orientation = orientationFor(width, height);
        finish({
          width: width || null,
          height: height || null,
          duration,
          size: file.size,
          type: getUniversalMediaContentType({
            mediaType: "video",
            name: file.name,
            mimeType: file.type,
          }),
          ratio: width && height ? width / height : null,
          ratioLabel: ratioLabel(width, height),
          orientation,
          orientationLabel: orientation,
        });
      };
      video.onerror = () => finish(null);
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceFromLibraryItem(
  item: MediaLibraryPickerItem
): MediaVideoRetoucherSource | null {
  const url = String(item.signed_url || "").trim();
  if (!url || item.media_type !== "video") return null;
  const width = Number(item.width || 0);
  const height = Number(item.height || 0);
  const duration = Number(item.duration_seconds || 0) || null;
  const orientation = orientationFor(width, height);
  return {
    file: null,
    url,
    name: item.original_file_name || item.title || "video-inrstudio.mp4",
    mimeType: getUniversalMediaContentType({
      mediaType: "video",
      name: item.original_file_name || item.title,
      mimeType: item.mime_type,
    }),
    size: Number(item.size_bytes || 0),
    durationSeconds: duration,
    storagePath: item.storage_path || null,
    sourceMetadata: {
      width: width || null,
      height: height || null,
      duration,
      size: Number(item.size_bytes || 0),
      type: item.mime_type || "video/mp4",
      ratio: width && height ? width / height : null,
      ratioLabel: ratioLabel(width, height),
      orientation,
      orientationLabel: orientation,
    },
    libraryItem: item,
  };
}

export default function MediaVideoRetoucher({
  initialSource = null,
  initialPreview = null,
  initialSourceLoading = false,
  initialContext = null,
  onEditingChange,
  onSaved,
  acceptMode = "library",
}: MediaVideoRetoucherProps) {
  const mediaT = useTranslations("media");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ownedUrlRef = useRef<string | null>(null);
  const initializedPreviewRef = useRef(false);
  const initializedFileRef = useRef<File | null>(null);
  const [source, setSource] = useState<MediaVideoRetoucherSource | null>(null);
  const [format, setFormat] = useState<VideoFormat>(() =>
    normalizeVideoFormat(
      initialContext?.channel || "site_web",
      initialContext?.format || "original"
    )
  );
  const [adaptationMode, setAdaptationMode] = useState<VideoAdaptationMode>(
    () =>
      normalizeVideoAdaptationMode(
        initialContext?.adaptationMode || "safe_frame"
      )
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const channel: ChannelKey = initialContext?.channel || "site_web";

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!initialPreview || initializedPreviewRef.current) return;
    initializedPreviewRef.current = true;
    setSource({
      file: null,
      url: initialPreview.url,
      name: initialPreview.name || "video-inrstudio.mp4",
      mimeType: getUniversalMediaContentType({
        mediaType: "video",
        name: initialPreview.name,
        mimeType:
          initialPreview.mimeType || initialContext?.sourceMetadata?.type,
      }),
      size: Number(initialContext?.size || initialPreview.size || 0),
      durationSeconds: initialContext?.durationSeconds || null,
      storagePath: initialContext?.storagePath || null,
      sourceMetadata: initialContext?.sourceMetadata || null,
    });
  }, [initialContext, initialPreview]);

  useEffect(() => {
    if (!initialSource || initializedFileRef.current === initialSource) return;
    if (
      detectUniversalUploadMediaType({
        name: initialSource.name,
        mimeType: initialSource.type,
      }) !== "video"
    ) {
      return;
    }
    initializedFileRef.current = initialSource;
    const previewUrl =
      initialPreview?.url || URL.createObjectURL(initialSource);
    if (!initialPreview?.url) ownedUrlRef.current = previewUrl;
    setSource((current) => ({
      file: initialSource,
      url: current?.url || previewUrl,
      name: initialSource.name || current?.name || "video-inrstudio.mp4",
      mimeType: getUniversalMediaContentType({
        mediaType: "video",
        name: initialSource.name,
        mimeType: initialSource.type,
      }),
      size: initialSource.size,
      durationSeconds:
        current?.durationSeconds || initialContext?.durationSeconds || null,
      storagePath: current?.storagePath || initialContext?.storagePath || null,
      sourceMetadata:
        current?.sourceMetadata || initialContext?.sourceMetadata || null,
      libraryItem: current?.libraryItem || null,
    }));
    void readBrowserVideoMetadata(initialSource).then((metadata) => {
      if (!metadata) return;
      setSource((current) =>
        current?.file === initialSource
          ? {
              ...current,
              durationSeconds: metadata.duration,
              sourceMetadata: metadata,
            }
          : current
      );
    });
  }, [initialContext, initialPreview, initialSource]);

  useEffect(
    () => () => {
      if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
    },
    []
  );

  const clearOwnedUrl = () => {
    if (ownedUrlRef.current) URL.revokeObjectURL(ownedUrlRef.current);
    ownedUrlRef.current = null;
  };

  const selectFile = async (file: File | null | undefined) => {
    if (!file) return;
    setError("");
    if (
      detectUniversalUploadMediaType({
        name: file.name,
        mimeType: file.type,
      }) !== "video"
    ) {
      setError("Choisissez un fichier vidéo pris en charge par iNrCy.");
      return;
    }
    if (file.size > UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES) {
      setError("Cette vidéo dépasse la limite technique d’import.");
      return;
    }
    clearOwnedUrl();
    const url = URL.createObjectURL(file);
    ownedUrlRef.current = url;
    const next: MediaVideoRetoucherSource = {
      file,
      url,
      name: file.name || "video-inrstudio.mp4",
      mimeType: getUniversalMediaContentType({
        mediaType: "video",
        name: file.name,
        mimeType: file.type,
      }),
      size: file.size,
      durationSeconds: null,
      storagePath: null,
      sourceMetadata: null,
    };
    setSource(next);
    const metadata = await readBrowserVideoMetadata(file);
    if (metadata) {
      setSource((current) =>
        current?.file === file
          ? {
              ...current,
              durationSeconds: metadata.duration,
              sourceMetadata: metadata,
            }
          : current
      );
    }
  };

  const clearSource = () => {
    clearOwnedUrl();
    setSource(null);
    setError("");
  };

  const save = async () => {
    if (!source || saving) return;
    setSaving(true);
    setError("");
    onEditingChange?.(true);
    try {
      await onSaved?.({
        source,
        channel,
        format,
        adaptationMode,
        transformedVariants: initialContext?.transformedVariants || [],
        deferTechnicalPreparationUntilPublish:
          initialContext?.deferTechnicalPreparationUntilPublish === true,
        mediaRecord: initialContext?.mediaRecord || null,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Impossible d’enregistrer cette retouche vidéo."
      );
      setSaving(false);
      onEditingChange?.(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void selectFile(event.dataTransfer.files?.[0]);
  };

  return (
    <section className={styles.root} aria-label="Retoucher une vidéo">
      <input
        ref={fileInputRef}
        className={styles.hiddenInput}
        type="file"
        accept={SOURCE_ACCEPT}
        onChange={(event) => {
          void selectFile(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />

      {!source ? (
        <div className={styles.emptyWorkspace}>
          <article className={styles.sourcePanel}>
            <header className={styles.panelHeader}>
              <span>1</span>
              <div>
                <h2>Vidéo à retoucher</h2>
                <p>Cette vidéo reste la base de votre retouche.</p>
              </div>
            </header>
            <button
              type="button"
              className={styles.dropzone}
              data-dragging={dragging ? "true" : "false"}
              aria-label="Choisir une vidéo à retoucher"
              disabled={initialSourceLoading}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className={styles.dropIcon}>＋</span>
              <strong>
                {initialSourceLoading
                  ? "Préparation de la vidéo…"
                  : "Déposez votre vidéo ici"}
              </strong>
              <small>
                MP4, MOV, WebM, MPEG, AVI, MKV, 3GP, TS, WMV, FLV ou OGV
              </small>
            </button>
            <div className={styles.sourceActions}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                Choisir sur mon appareil
              </button>
              <button type="button" onClick={() => setLibraryOpen(true)}>
                Choisir dans ma médiathèque
              </button>
            </div>
          </article>

          <article className={styles.toolsPanel}>
            <header className={styles.panelHeader}>
              <span>2</span>
              <div>
                <h2>Outils vidéo</h2>
                <p>Choisissez le format et le cadrage adaptés au canal.</p>
              </div>
            </header>
            <div className={styles.disabledTools}>
              <div>
                <b>▣</b>
                <strong>Changer le format</strong>
              </div>
              <div>
                <b>◫</b>
                <strong>Adapter le cadrage</strong>
              </div>
            </div>
            <p className={styles.hint}>
              Ajoutez d’abord une vidéo pour activer les outils.
            </p>
          </article>
        </div>
      ) : (
        <div className={styles.editorWorkspace}>
          <div className={styles.editorHeading}>
            <div>
              <span>RETOUCHE MANUELLE · VIDÉO</span>
              <h2>Retoucher une vidéo</h2>
            </div>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Remplacer la vidéo
            </button>
          </div>
          <div className={styles.videoManager}>
            <BoosterVideoFormatManager
              isMobile={isMobile}
              channel={channel}
              videoName={source.name}
              videoDisplayUrl={source.url}
              videoSize={source.size}
              videoDurationSeconds={source.durationSeconds}
              videoSourceMetadata={source.sourceMetadata}
              currentFormat={format}
              adaptationMode={adaptationMode}
              videoTransformedVariants={initialContext?.transformedVariants || []}
              deferTechnicalPreparationUntilPublish
              onFormatChange={setFormat}
              onAdaptationModeChange={setAdaptationMode}
              onPickVideoClick={() => fileInputRef.current?.click()}
              onDeleteVideo={clearSource}
              showApplyAll={false}
              fillAvailableSpace={!isMobile}
            />
          </div>
        </div>
      )}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <footer className={styles.footer}>
        <div>
          <strong>
            {source
              ? "Prêt à retoucher cette vidéo ?"
              : "Ajoutez une vidéo pour commencer"}
          </strong>
          <span>
            {source
              ? "Le format choisi sera rattaché au média et au canal d’origine."
              : "Choisissez une vidéo pour activer les outils de retouche."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!source || saving}
        >
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
        title="Choisir une vidéo à retoucher"
        subtitle={mediaT("vos_images_et_videos_inrcy_58912437")}
        accept="video"
        multiple={false}
        maxSelection={1}
        confirmLabel="Utiliser cette vidéo"
        onClose={() => setLibraryOpen(false)}
        onConfirm={(items) => {
          const next = items[0] ? sourceFromLibraryItem(items[0]) : null;
          if (!next) {
            setError("Cette vidéo n’est plus disponible.");
            return;
          }
          clearOwnedUrl();
          setSource(next);
          setLibraryOpen(false);
          setError("");
        }}
      />
    </section>
  );
}
