"use client";

import { useTranslations } from "next-intl";


import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  isUniversalMediaUploadEnabled,
  uploadFileToPreparedUniversalIntent,
  type UniversalMediaUploadIntent,
} from "@/lib/universalMediaUploadClient";
import {
  buildDirectStorageResumableEndpoint,
  detectUniversalUploadMediaType,
  selectUniversalMediaUploadProtocol,
} from "@/lib/mediaUploadPolicy";
import {
  MEDIA_LIBRARY_EMAIL_TARGET_BYTES,
  MEDIA_LIBRARY_IMAGE_OPTIMIZATION_JOB_TYPE,
  MEDIA_LIBRARY_IMAGE_OUTPUT_MAX_BYTES,
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_OPTIMIZATION_JOB_TYPE,
  MEDIA_LIBRARY_VIDEO_OUTPUT_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
  getMediaLibraryOptimizationRequirements,
} from "@/lib/mediaLibraryOptimizationPolicy";
import type { MediaLibraryPickerItem } from "./MediaLibraryPickerModal";

export type MediaOptimizerItem = MediaLibraryPickerItem & {
  source?: string | null;
  original_file_name?: string | null;
  optimization?: {
    id?: string;
    media_id?: string;
    job_type?: string;
    status?: string;
    progress?: number;
    result?: Record<string, unknown> | null;
    error_message?: string | null;
  } | null;
};

type Props = {
  open: boolean;
  sourceItem?: MediaOptimizerItem | null;
  sourceFile?: File | null;
  origin?: "booster" | "mediatheque" | "email";
  onClose: () => void;
  onOptimized?: (item: MediaOptimizerItem) => void | Promise<void>;
  onLibraryChanged?: () => void | Promise<void>;
};

type PreparedUpload = {
  client_id: string;
  original_name: string;
  bucket: string;
  storage_path: string;
  token: string;
  content_type: string;
  media_type: "image" | "video";
};

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} Ko`;
  const mb = bytes / 1_000_000;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} Mo`;
}

function itemName(item: MediaOptimizerItem | null, file: File | null) {
  if (file?.name) return file.name;
  if (item?.title) return item.title;
  if (item?.original_file_name) return item.original_file_name;
  return "Média iNrCy";
}

function outputLimit(
  mediaType: "image" | "video",
  origin: "booster" | "mediatheque" | "email",
) {
  if (origin === "email") return MEDIA_LIBRARY_EMAIL_TARGET_BYTES;
  return mediaType === "video"
    ? MEDIA_LIBRARY_VIDEO_OUTPUT_MAX_BYTES
    : MEDIA_LIBRARY_IMAGE_OUTPUT_MAX_BYTES;
}

function sourceLimit(mediaType: "image" | "video") {
  return mediaType === "video"
    ? MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES
    : MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES;
}

function jobTypeFor(mediaType: "image" | "video") {
  return mediaType === "video"
    ? MEDIA_LIBRARY_VIDEO_OPTIMIZATION_JOB_TYPE
    : MEDIA_LIBRARY_IMAGE_OPTIMIZATION_JOB_TYPE;
}

function readSourceMediaInfo(
  file: File,
  mediaType: "image" | "video",
): Promise<{
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const finish = (value: {
      width: number | null;
      height: number | null;
      duration_seconds: number | null;
    }) => {
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };

    if (mediaType === "image") {
      const image = new Image();
      image.onload = () =>
        finish({
          width: image.naturalWidth || null,
          height: image.naturalHeight || null,
          duration_seconds: null,
        });
      image.onerror = () =>
        finish({ width: null, height: null, duration_seconds: null });
      image.src = objectUrl;
      return;
    }

    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () =>
      finish({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        duration_seconds: Number.isFinite(video.duration) ? video.duration : null,
      });
    video.onerror = () =>
      finish({ width: null, height: null, duration_seconds: null });
    video.src = objectUrl;
  });
}

async function readJson(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(json?.error || fallback));
  return json;
}

async function loadMediaItem(mediaId: string): Promise<MediaOptimizerItem> {
  const response = await fetch(
    `/api/media-library/items?id=${encodeURIComponent(mediaId)}&active=all&limit=1`,
    { cache: "no-store" },
  );
  const json = await readJson(response, "Impossible de relire le média.");
  const item = Array.isArray(json?.items) ? json.items[0] : null;
  if (!item?.id) throw new Error("Média introuvable dans la Médiathèque.");
  return item as MediaOptimizerItem;
}

async function uploadSourceToLibrary(
  file: File,
  onProgress: (percent: number, label: string) => void,
): Promise<MediaOptimizerItem> {
  const mediaType = detectUniversalUploadMediaType({
    name: file.name,
    mimeType: file.type,
  });
  if (mediaType !== "image" && mediaType !== "video") {
    throw new Error("Ce format ne peut pas être optimisé par iNrCy.");
  }
  if (file.size > sourceLimit(mediaType)) {
    throw new Error("Ce fichier dépasse le plafond de 300 Mo de la Médiathèque.");
  }

  const clientId = `optimizer-${file.name}-${file.size}-${file.lastModified}`.slice(0, 180);
  onProgress(3, "Préparation de l’import…");
  const prepareResponse = await fetch("/api/media-library/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "prepare",
      files: [
        {
          client_id: clientId,
          name: file.name,
          type: file.type,
          size: file.size,
          last_modified: file.lastModified,
        },
      ],
    }),
  });
  const prepareJson = await readJson(
    prepareResponse,
    "Préparation de l’import impossible.",
  );
  const prepared = (Array.isArray(prepareJson?.items)
    ? prepareJson.items[0]
    : null) as PreparedUpload | null;
  if (!prepared?.token || !prepared?.storage_path) {
    throw new Error("Préparation de l’import impossible.");
  }

  const contentType = prepared.content_type || file.type || "application/octet-stream";
  let completedProtocol: "signed" | "tus" = "signed";
  const supabase = createClient();
  onProgress(8, "Import de l’original dans la Médiathèque…");

  if (isUniversalMediaUploadEnabled()) {
    const intent: UniversalMediaUploadIntent = {
      ok: true,
      target: "media_library_source",
      mediaType: prepared.media_type,
      protocol: selectUniversalMediaUploadProtocol(file.size),
      bucket: prepared.bucket || "inrcy-pro-media",
      storagePath: prepared.storage_path,
      token: prepared.token,
      signedUrl: null,
      publicUrl: null,
      contentType,
      resumableEndpoint: buildDirectStorageResumableEndpoint(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      ),
      mediaId: null,
      clientMediaKey: clientId,
    };

    try {
      const uploaded = await uploadFileToPreparedUniversalIntent(file, intent, {
        onProgress(progress) {
          onProgress(
            8 + Math.round(Math.max(0, Math.min(100, progress.percent)) * 0.32),
            "Import de l’original dans la Médiathèque…",
          );
        },
      });
      completedProtocol = uploaded.protocol;
    } catch (error) {
      console.warn("[media-optimizer] resumable upload fallback", error);
      const { error: uploadError } = await supabase.storage
        .from(prepared.bucket || "inrcy-pro-media")
        .uploadToSignedUrl(prepared.storage_path, prepared.token, file, {
          contentType,
        });
      if (uploadError) throw uploadError;
    }
  } else {
    const { error: uploadError } = await supabase.storage
      .from(prepared.bucket || "inrcy-pro-media")
      .uploadToSignedUrl(prepared.storage_path, prepared.token, file, {
        contentType,
      });
    if (uploadError) throw uploadError;
  }

  onProgress(42, "Enregistrement du média…");
  const mediaInfo = await readSourceMediaInfo(file, mediaType);
  const finalizeResponse = await fetch("/api/media-library/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "finalize",
      title: file.name.replace(/\.[^.]+$/, ""),
      tags: [],
      source: "media_optimizer",
      uploads: [
        {
          client_id: clientId,
          original_name: prepared.original_name || file.name,
          storage_path: prepared.storage_path,
          mime_type: contentType,
          size_bytes: file.size,
          width: mediaInfo.width,
          height: mediaInfo.height,
          duration_seconds: mediaInfo.duration_seconds,
          upload_protocol: completedProtocol,
        },
      ],
    }),
  });
  const finalizeJson = await readJson(
    finalizeResponse,
    "Finalisation de l’import impossible.",
  );
  const result = Array.isArray(finalizeJson?.results)
    ? finalizeJson.results.find((entry: any) => entry?.ok && entry?.id)
    : null;
  if (!result?.id) {
    throw new Error(
      String(
        finalizeJson?.results?.[0]?.error || "Finalisation de l’import impossible.",
      ),
    );
  }
  return await loadMediaItem(String(result.id));
}

async function removeOriginalIfSafe(mediaId: string) {
  const response = await fetch(
    `/api/media-library/items?id=${encodeURIComponent(mediaId)}`,
    { method: "DELETE" },
  );
  const json = await response.json().catch(() => null);
  if (response.ok) return { deleted: true, message: "Original supprimé de la Médiathèque." };
  if (response.status === 409 && json?.requiresConfirmation) {
    return {
      deleted: false,
      message: "Copie créée. L’original a été conservé car il est encore utilisé dans iNrCy.",
    };
  }
  return {
    deleted: false,
    message: String(json?.error || "Copie créée. L’original n’a pas pu être supprimé."),
  };
}

export default function MediaOptimizerModal({
  open,
  sourceItem,
  sourceFile,
  origin = "mediatheque",
  onClose,
  onOptimized,
  onLibraryChanged,
}: Props) {
  const i18nT = useTranslations("media");
  const [workingItem, setWorkingItem] = useState<MediaOptimizerItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [insertionError, setInsertionError] = useState("");
  const [retentionNotice, setRetentionNotice] = useState("");
  const [outputItem, setOutputItem] = useState<MediaOptimizerItem | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!open) return;
    setWorkingItem(sourceItem || null);
    setBusy(false);
    setKeepOriginal(true);
    setProgress(0);
    setStage("");
    setError("");
    setNotice("");
    setInsertionError("");
    setRetentionNotice("");
    setOutputItem(null);
  }, [open, sourceFile, sourceItem]);

  const mediaType = useMemo<"image" | "video" | null>(() => {
    if (workingItem?.media_type === "image" || workingItem?.media_type === "video") {
      return workingItem.media_type;
    }
    const detected = sourceFile
      ? detectUniversalUploadMediaType({ name: sourceFile.name, mimeType: sourceFile.type })
      : null;
    return detected === "image" || detected === "video" ? detected : null;
  }, [sourceFile, workingItem]);

  const currentSize = Number(workingItem?.size_bytes || sourceFile?.size || 0);
  const limit = mediaType ? outputLimit(mediaType, origin) : 0;
  const sourceMaxBytes = mediaType ? sourceLimit(mediaType) : 0;
  const sourceTooLarge = Boolean(
    sourceMaxBytes && currentSize > sourceMaxBytes,
  );
  const sourceName = itemName(workingItem, sourceFile || null);
  const sourceMimeType =
    workingItem?.mime_type || sourceFile?.type || null;
  const requirements = useMemo(
    () =>
      mediaType
        ? getMediaLibraryOptimizationRequirements({
            mediaType,
            sizeBytes: currentSize,
            targetBytes: limit,
            name:
              workingItem?.original_file_name ||
              workingItem?.storage_path ||
              sourceFile?.name ||
              workingItem?.title,
            mimeType: sourceMimeType,
          })
        : null,
    [
      currentSize,
      limit,
      mediaType,
      sourceFile?.name,
      sourceMimeType,
      workingItem?.original_file_name,
      workingItem?.storage_path,
      workingItem?.title,
    ],
  );
  const targetBytes = limit;
  const title = "Optimiser le média";
  const compressionRatio =
    requirements?.needsCompression && currentSize > 0 && targetBytes > 0
      ? targetBytes / currentSize
      : 1;
  const aggressiveCompression = compressionRatio <= 0.25;

  const applyOptimizedItem = async (
    optimized: MediaOptimizerItem,
    retentionMessage: string,
  ) => {
    if (!onOptimized) {
      setInsertionError("");
      setNotice(retentionMessage);
      return true;
    }

    try {
      await onOptimized(optimized);
      setInsertionError("");
      setNotice(
        origin === "booster"
          ? `Média optimisé ajouté au Booster. ${retentionMessage}`
          : origin === "email"
            ? `Média optimisé ajouté à la pièce jointe. ${retentionMessage}`
            : retentionMessage,
      );
      return true;
    } catch (err) {
      setInsertionError(
        err instanceof Error
          ? err.message
          : "La copie a bien été créée, mais son insertion automatique a échoué.",
      );
      setNotice(i18nT("copie_optimisee_creee_value_369694d0", { value0: retentionMessage }));
      return false;
    }
  };

  const retryOptimizedInsertion = async () => {
    if (!outputItem || !onOptimized || busy) return;
    setBusy(true);
    setInsertionError("");
    try {
      await applyOptimizedItem(
        outputItem,
        retentionNotice || "Original conservé dans la Médiathèque.",
      );
    } finally {
      if (openRef.current) setBusy(false);
    }
  };

  const handleOptimize = async () => {
    if (busy || !mediaType) return;
    setBusy(true);
    setError("");
    setNotice("");
    setInsertionError("");
    setRetentionNotice("");
    setOutputItem(null);
    try {
      let source = workingItem;
      if (!source) {
        if (!sourceFile) throw new Error("Aucun média à optimiser.");
        source = await uploadSourceToLibrary(sourceFile, (nextProgress, label) => {
          if (!openRef.current) return;
          setProgress(nextProgress);
          setStage(label);
        });
        if (!openRef.current) return;
        setWorkingItem(source);
        await onLibraryChanged?.();
      }

      setProgress((current) => Math.max(current, 46));
      setStage("Préparation de l’optimisation…");
      const queueResponse = await fetch("/api/media-library/optimization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mediaId: source.id, targetBytes }),
      });
      const queueJson = await queueResponse.json().catch(() => null);
      if (!queueResponse.ok && queueResponse.status !== 202) {
        throw new Error(String(queueJson?.error || "Optimisation impossible."));
      }

      const queuedJobType = String(queueJson?.job?.job_type || "") || jobTypeFor(mediaType);
      let outputMediaId = String(queueJson?.job?.result?.outputMediaId || "").trim();
      const queuedStatus = String(queueJson?.job?.status || "");
      await onLibraryChanged?.();

      if (queuedStatus !== "succeeded") {
        void fetch("/api/media-library/optimization/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mediaId: source.id, jobType: queuedJobType }),
        }).catch((runError) => {
          console.warn("[media-optimizer] direct worker unavailable", runError);
        });

        const startedAt = Date.now();
        while (openRef.current && Date.now() - startedAt < 20 * 60 * 1000) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
          if (!openRef.current) return;
          const refreshed = await loadMediaItem(source.id);
          setWorkingItem(refreshed);
          const optimization = refreshed.optimization;
          const status = String(optimization?.status || "");
          const pct = Math.max(0, Math.min(100, Number(optimization?.progress || 0)));
          setProgress(Math.max(46, Math.min(98, 46 + Math.round(pct * 0.52))));
          const remoteStage = String(optimization?.result?.stage || "").trim();
          if (remoteStage) setStage(remoteStage);
          if (status === "succeeded") {
            outputMediaId = String(optimization?.result?.outputMediaId || "").trim();
            break;
          }
          if (status === "failed" || status === "cancelled") {
            throw new Error(
              String(optimization?.error_message || "L’optimisation du média a échoué."),
            );
          }
        }
      }

      if (!openRef.current) return;
      if (!outputMediaId) {
        const refreshed = await loadMediaItem(source.id);
        outputMediaId = String(refreshed.optimization?.result?.outputMediaId || "").trim();
      }
      if (!outputMediaId) {
        throw new Error("La copie optimisée n’a pas encore été créée. Réessayez dans quelques instants.");
      }

      const optimized = await loadMediaItem(outputMediaId);
      setOutputItem(optimized);
      setProgress(100);
      setStage("Copie optimisée créée");

      let retentionMessage = "Original conservé dans la Médiathèque.";
      if (!keepOriginal) {
        const retention = await removeOriginalIfSafe(source.id);
        retentionMessage = retention.message;
      }
      setRetentionNotice(retentionMessage);
      setNotice(retentionMessage);
      await onLibraryChanged?.();

      await applyOptimizedItem(optimized, retentionMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimisation impossible.");
    } finally {
      if (openRef.current) setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(2,8,23,.78)",
        backdropFilter: "blur(10px)",
      }}
    >
      <section
        style={{
          width: "min(620px, calc(100vw - 24px))",
          maxHeight: "min(760px, calc(100dvh - 24px))",
          overflow: "auto",
          borderRadius: 24,
          border: "1px solid rgba(105,239,255,.22)",
          background: "linear-gradient(180deg, rgba(12,24,55,.99), rgba(7,15,37,.99))",
          boxShadow: "0 28px 80px rgba(0,0,0,.48)",
          color: "#f8fbff",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div
            aria-hidden="true"
            style={{
              width: 44,
              height: 44,
              borderRadius: 15,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(135deg, rgba(47,209,255,.24), rgba(155,81,255,.28))",
              border: "1px solid rgba(105,239,255,.24)",
              fontSize: 21,
            }}
          >
            {mediaType === "video" ? "🎬" : "🖼️"}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".08em", color: "#84e9ff", textTransform: "uppercase" }}>
              {i18nT("outil_media_inrcy_0c412e55")}{" "}</div>
            <h2 style={{ margin: "3px 0 0", fontSize: 22 }}>{title}</h2>
            <p style={{ margin: "5px 0 0", color: "#aebcdb", fontSize: 13, lineHeight: 1.45 }}>
              {i18nT("inrcy_detecte_automatiquement_ce_qui_est_c3dd1c97")}{" "}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label={i18nT("fermer_5ab4ec64")}
            style={{
              width: 38,
              height: 38,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(255,255,255,.06)",
              color: "#fff",
              fontSize: 20,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.45 : 1,
            }}
          >
            ×
          </button>
        </header>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) auto",
            gap: 10,
            alignItems: "center",
            padding: 13,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,.09)",
            background: "rgba(255,255,255,.035)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {sourceName}
            </strong>
            <span style={{ display: "block", marginTop: 4, fontSize: 12, color: "#9fb0d2" }}>
              {mediaType === "video" ? i18nT("video_304f6ca4") : i18nT("image_50e19fda")} · {formatBytes(currentSize)}
            </span>
          </div>
          <span
            style={{
              borderRadius: 999,
              padding: "7px 10px",
              fontSize: 11,
              fontWeight: 900,
              color: "#dbeafe",
              border: "1px solid rgba(96,165,250,.28)",
              background: "rgba(30,64,175,.16)",
              whiteSpace: "nowrap",
            }}
          >
            {origin === "email"
              ? i18nT("e_mail_value_max_7f932c53", { value0: formatBytes(limit) })
              : i18nT("value_value_max_208b83f4", { value0: mediaType === "video" ? "Vidéo" : "Image", value1: formatBytes(limit) })}
          </span>
        </div>

        {sourceTooLarge ? (
          <div
            role="alert"
            style={{
              padding: "11px 12px",
              borderRadius: 13,
              border: "1px solid rgba(248,113,113,.36)",
              background: "rgba(127,29,29,.22)",
              color: "#fecaca",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            <strong>{i18nT("fichier_source_trop_volumineux_c85fdcd0")}</strong> {" "}{i18nT("ce_media_fait_35c1c7a2")}{" "}
            {formatBytes(currentSize)}{i18nT("inrcy_accepte_une_source_de_88b8d8b4")}{" "}
            {formatBytes(sourceMaxBytes)} {" "}{i18nT("maximum_et_ne_peut_donc_pas_554ed6aa")}{" "}</div>
        ) : null}

        <div
          style={{
            display: "grid",
            gap: 10,
            padding: "13px 14px",
            borderRadius: 16,
            border: "1px solid rgba(105,239,255,.14)",
            background: "rgba(4,12,30,.52)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
            <strong style={{ fontSize: 13 }}>{i18nT("optimisation_detectee_44e8bb9d")}</strong>
            <strong style={{ fontSize: 12, color: "#84e9ff" }}>{i18nT("reglage_automatique_fb6ce5fa")}</strong>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {requirements?.needsConversion ? (
              <span style={{ borderRadius: 999, padding: "7px 10px", border: "1px solid rgba(96,165,250,.28)", background: "rgba(30,64,175,.16)", color: "#dbeafe", fontSize: 12, fontWeight: 850 }}>
                {i18nT("format_adapte_mp4_h_264_aac_50709d9d")}{" "}</span>
            ) : null}
            {requirements?.needsCompression ? (
              <span style={{ borderRadius: 999, padding: "7px 10px", border: "1px solid rgba(167,139,250,.28)", background: "rgba(91,33,182,.15)", color: "#ede9fe", fontSize: 12, fontWeight: 850 }}>
                {i18nT("poids_ramene_a_value_maximum_6f196b66", { value0: formatBytes(limit) })}</span>
            ) : null}
            {requirements && !requirements.needsOptimization ? (
              <span style={{ borderRadius: 999, padding: "7px 10px", border: "1px solid rgba(74,222,128,.26)", background: "rgba(22,101,52,.16)", color: "#d1fae5", fontSize: 12, fontWeight: 850 }}>
                {i18nT("media_deja_pret_pour_cet_outil_a53194a5")}{" "}</span>
            ) : null}
          </div>
          <div style={{ color: "#9fb0d2", fontSize: 11, lineHeight: 1.45 }}>
            {origin === "email"
              ? i18nT("inrcy_prepare_automatiquement_une_piece_jointe_a87848b0")
              : i18nT("inrcy_prepare_automatiquement_un_media_compatibl_908998f0")}
          </div>
          {aggressiveCompression ? (
            <div role="status" style={{ padding: "9px 10px", borderRadius: 12, border: "1px solid rgba(251,191,36,.28)", background: "rgba(120,53,15,.18)", color: "#fde68a", fontSize: 12, lineHeight: 1.4 }}>
              {i18nT("compression_forte_passer_de_value_a_558a609f", { value0: formatBytes(currentSize), value1: formatBytes(limit) })}</div>
          ) : null}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "11px 12px",
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,.08)",
            background: "rgba(4,12,30,.52)",
            cursor: busy ? "default" : "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={keepOriginal}
            onChange={(event) => setKeepOriginal(event.target.checked)}
            disabled={busy}
          />
          <span style={{ fontSize: 13, lineHeight: 1.4 }}>
            <strong>{i18nT("conserver_l_original_dans_la_mediatheque_13a65fe8")}</strong>
            <span style={{ display: "block", color: "#94a5c8", marginTop: 2 }}>
              {i18nT("recommande_si_vous_decochez_inrcy_ne_a608a4c4")}{" "}</span>
          </span>
        </label>

        {(busy || progress > 0) && !error ? (
          <div style={{ display: "grid", gap: 7 }} aria-live="polite">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
              <span style={{ color: "#d8e7ff" }}>{stage || i18nT("preparation_47305e12")}</span>
              <strong>{Math.round(progress)} %</strong>
            </div>
            <div style={{ height: 9, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.08)" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(2, Math.min(100, progress))}%`,
                  borderRadius: 999,
                  background: "linear-gradient(90deg, #38d8ff, #8b5cf6)",
                  transition: "width .25s ease",
                }}
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div role="alert" style={{ padding: "10px 12px", borderRadius: 13, border: "1px solid rgba(248,113,113,.30)", background: "rgba(127,29,29,.20)", color: "#fecaca", fontSize: 13 }}>
            {error}
          </div>
        ) : null}

        {outputItem && !error ? (
          <div role="status" style={{ padding: "10px 12px", borderRadius: 13, border: "1px solid rgba(74,222,128,.28)", background: "rgba(22,101,52,.18)", color: "#d1fae5", fontSize: 13 }}>
            {i18nT("media_optimise_4b220141")}{" "}<strong>{formatBytes(outputItem.size_bytes)}</strong>. {notice}
          </div>
        ) : notice && !error ? (
          <div role="status" style={{ color: "#c9d8f4", fontSize: 12 }}>{notice}</div>
        ) : null}

        {outputItem && insertionError ? (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              borderRadius: 13,
              border: "1px solid rgba(251,191,36,.30)",
              background: "rgba(120,53,15,.18)",
              color: "#fde68a",
              fontSize: 12,
              lineHeight: 1.45,
            }}
          >
            {i18nT("l_optimisation_est_terminee_mais_inrcy_e39b5e05", { value0: insertionError })}</div>
        ) : null}

        <footer style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              borderRadius: 999,
              padding: "10px 15px",
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(255,255,255,.06)",
              color: "#fff",
              fontWeight: 850,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
            }}
          >
            {outputItem ? i18nT("fermer_5ab4ec64") : i18nT("annuler_49ba3292")}
          </button>
          {!outputItem ? (
            <button
              type="button"
              onClick={() => void handleOptimize()}
              disabled={busy || !mediaType || !currentSize || !requirements?.needsOptimization || sourceTooLarge}
              style={{
                borderRadius: 999,
                padding: "10px 16px",
                border: "1px solid rgba(105,239,255,.34)",
                background: "linear-gradient(135deg, rgba(47,209,255,.30), rgba(155,81,255,.34))",
                color: "#fff",
                fontWeight: 950,
                cursor: busy ? "wait" : sourceTooLarge ? "not-allowed" : "pointer",
                opacity: busy || sourceTooLarge ? 0.65 : 1,
              }}
            >
              {busy ? i18nT("optimisation_en_cours_def4a3cc") : i18nT("optimiser_le_media_1bc4fc40")}
            </button>
          ) : insertionError && onOptimized ? (
            <button
              type="button"
              onClick={() => void retryOptimizedInsertion()}
              disabled={busy}
              style={{
                borderRadius: 999,
                padding: "10px 16px",
                border: "1px solid rgba(105,239,255,.34)",
                background: "linear-gradient(135deg, rgba(47,209,255,.30), rgba(155,81,255,.34))",
                color: "#fff",
                fontWeight: 950,
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.65 : 1,
              }}
            >
              {busy ? i18nT("insertion_2e058212") : i18nT("inserer_le_media_optimise_a0ba71d7")}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
