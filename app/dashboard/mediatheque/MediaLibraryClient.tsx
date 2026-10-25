"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from "react";
import { createClient } from "@/lib/supabaseClient";
import {
  isUniversalMediaUploadEnabled,
  uploadFileToPreparedUniversalIntent,
  type UniversalMediaUploadIntent,
} from "@/lib/universalMediaUploadClient";
import {
  UNIVERSAL_MEDIA_VIDEO_EXTENSIONS,
  UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  buildDirectStorageResumableEndpoint,
  detectUniversalUploadMediaType,
  selectUniversalMediaUploadProtocol,
} from "@/lib/mediaUploadPolicy";
import { getClientUserFacingErrorMessage } from "@/lib/userFacingErrors";
import { confirmInrcy } from "@/lib/inrcyDialog";
import MediaOptimizerModal, {
  type MediaOptimizerItem,
} from "@/app/dashboard/_components/MediaOptimizerModal";
import { INR_MEDIA_UPLOAD_BATCH_SIZE } from "@/lib/mediaRules";
import { MEDIA_LIBRARY_AUDIO_MAX_BYTES, detectMediaLibraryAudioType } from "@/lib/mediaLibraryAudio";
import {
  MEDIA_LIBRARY_IMAGE_OUTPUT_MAX_BYTES,
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_OUTPUT_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
  getMediaLibraryOptimizationRequirements,
} from "@/lib/mediaLibraryOptimizationPolicy";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot, invalidateModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import MediaMetadataField, { normalizeMediaMetadata, type MediaMetadataFieldKind } from "./MediaMetadataField";
import { getActiveBrowserUserId } from "@/lib/browserAccountCache";
import styles from "./mediaLibrary.module.css";

type MediaTypeFilter = "all" | "image" | "video" | "audio";
type ActiveFilter = "active" | "inactive" | "all";

type MediaItem = {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  media_type: "image" | "video" | "audio";
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  tags: string[] | null;
  source: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_active: boolean | null;
  usage_count: number | null;
  last_used_at: string | null;
  created_at: string;
  signed_url: string | null;
  preview_url?: string | null;
  imageRecovery?: { kind: "truncated_jpeg" };
  processing_status?: string;
  processing_error_message?: string | null;
  original_file_name?: string | null;
  media_metadata?: Record<string, unknown> | null;
  optimization?: {
    id: string;
    media_id: string;
    job_type: string;
    status: "queued" | "processing" | "retry_wait" | "succeeded" | "failed" | "cancelled";
    progress: number;
    result?: Record<string, unknown> | null;
    error_code?: string | null;
    error_message?: string | null;
    attempt_count?: number;
    max_attempts?: number;
    updated_at?: string;
  } | null;
};

type MediaLibrarySnapshot = {
  items: MediaItem[];
  stats: {
    total: number;
    images: number;
    videos: number;
    audios?: number;
    total_bytes: number;
  };
};

function readInitialMediaLibrarySnapshot(): MediaLibrarySnapshot | null {
  const snapshot = readModuleSnapshot<MediaLibrarySnapshot>(
    MODULE_SNAPSHOT_KEYS.mediaLibraryDefault,
  );
  if (!snapshot?.data || !Array.isArray(snapshot.data.items)) return null;
  return snapshot.data;
}

type UploadPrepareItem = {
  client_id: string;
  original_name: string;
  bucket: string;
  storage_path: string;
  token: string;
  content_type: string;
  media_type: "image" | "video" | "audio";
};

type UploadFinalizeItem = {
  client_id: string;
  original_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  upload_protocol?: "signed" | "tus";
};

const MAX_IMAGE_BYTES = MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES;
const MAX_VIDEO_BYTES = MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES;
const UPLOAD_BATCH_SIZE = INR_MEDIA_UPLOAD_BATCH_SIZE;

async function readApiJson(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await response.json().catch(() => ({ error: fallbackMessage }));
  }

  const text = await response.text().catch(() => "");
  return { error: text.trim() || fallbackMessage };
}

function formatUploadName(file: File) {
  return file.name || "media-inrcy";
}

function getClientFileId(file: File, index: number) {
  return `${index}-${file.name}-${file.size}-${file.lastModified}`;
}

function chunkFiles<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isImageFile(file: File) {
  return (
    detectUniversalUploadMediaType({ name: file.name, mimeType: file.type }) ===
    "image"
  );
}

function isVideoFile(file: File) {
  return (
    detectUniversalUploadMediaType({ name: file.name, mimeType: file.type }) ===
    "video"
  );
}

function isAudioFile(file: File) {
  return detectMediaLibraryAudioType({ name: file.name, mimeType: file.type }) === "audio";
}

function validateUploadFiles(selectedFiles: File[], audioFileError: string) {
  for (const file of selectedFiles) {
    if (!isImageFile(file) && !isVideoFile(file) && !isAudioFile(file)) {
      throw new Error(
        `${formatUploadName(file)} : format non reconnu par le moteur média iNrCy.`,
      );
    }
    if (isAudioFile(file) && (!file.size || file.size > MEDIA_LIBRARY_AUDIO_MAX_BYTES)) {
      throw new Error(`${formatUploadName(file)} : ${audioFileError}`);
    }
    if (isImageFile(file) && file.size > MAX_IMAGE_BYTES) {
      throw new Error(
        `${formatUploadName(file)} : la Médiathèque accepte jusqu’à 300 Mo.`,
      );
    }
    if (isVideoFile(file) && file.size > MAX_VIDEO_BYTES) {
      throw new Error(
        `${formatUploadName(file)} : la Médiathèque accepte jusqu’à 300 Mo.`,
      );
    }
  }
}

function getImageDimensions(
  file: File,
): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: image.naturalWidth || null,
        height: image.naturalHeight || null,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    image.src = url;
  });
}

function getVideoInfo(
  file: File,
): Promise<{
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        duration_seconds: Number.isFinite(video.duration)
          ? video.duration
          : null,
      });
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null, duration_seconds: null });
    };
    video.src = url;
  });
}

async function getMediaInfo(file: File) {
  if (isAudioFile(file)) {
    const duration_seconds = await new Promise<number | null>((resolve) => {
      const audio = document.createElement("audio");
      const url = URL.createObjectURL(file);
      const finish = (duration: number | null) => {
        clearTimeout(timeout);
        audio.onloadedmetadata = null; audio.onerror = null;
        audio.removeAttribute("src"); audio.load();
        URL.revokeObjectURL(url); resolve(duration);
      };
      const timeout = setTimeout(() => finish(null), 10_000);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
      audio.onerror = () => finish(null);
      audio.src = url;
    });
    return { width: null, height: null, duration_seconds };
  }
  if (isImageFile(file)) {
    const dimensions = await getImageDimensions(file);
    return { ...dimensions, duration_seconds: null };
  }
  return getVideoInfo(file);
}

function formatBytes(bytes: number | null | undefined, locale: string, kilobytes: string, megabytes: string) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale).format(Math.max(1, Math.round(bytes / 1024)))} ${kilobytes}`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} ${megabytes}`;
}

function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function tagsToText(tags: string[] | null | undefined) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function buildMediaDownloadUrl(contentUrl: string | null) {
  if (!contentUrl) return null;
  return `${contentUrl}${contentUrl.includes("?") ? "&" : "?"}download=1`;
}

function mediaOptimizationLimit(item: Pick<MediaItem, "media_type">) {
  return item.media_type === "video"
    ? MEDIA_LIBRARY_VIDEO_OUTPUT_MAX_BYTES
    : MEDIA_LIBRARY_IMAGE_OUTPUT_MAX_BYTES;
}

function mediaNeedsOptimization(item: MediaItem) {
  if (item.media_type === "audio") return false;
  return getMediaLibraryOptimizationRequirements({
    mediaType: item.media_type,
    sizeBytes: item.size_bytes,
    targetBytes: mediaOptimizationLimit(item),
    name: item.original_file_name || item.storage_path || item.title,
    mimeType: item.mime_type,
  }).needsOptimization;
}

const MEDIA_LIBRARY_VIDEO_ACCEPT = [
  ...UNIVERSAL_MEDIA_VIDEO_MIME_TYPES,
  ...UNIVERSAL_MEDIA_VIDEO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export default function MediaLibraryClient() {
  const locale = useLocale();
  const i18nT = useTranslations("media");
  const displayBytes = (bytes: number | null | undefined) =>
    formatBytes(bytes, locale, i18nT("unit_kilobytes"), i18nT("unit_megabytes"));
  const displayDate = (iso: string | null | undefined) => formatDate(iso, locale);
  const [initialSnapshot] = useState<MediaLibrarySnapshot | null>(() => readInitialMediaLibrarySnapshot());
  const [items, setItems] = useState<MediaItem[]>(() => initialSnapshot?.items ?? []);
  const [stats, setStats] = useState(() => initialSnapshot?.stats ?? ({
    total: 0,
    images: 0,
    videos: 0,
    audios: 0,
    total_bytes: 0,
  }));
  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [uploading, setUploading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const importDialogRef = useRef<HTMLDivElement>(null);
  const uploadingRef = useRef(uploading);
  uploadingRef.current = uploading;
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const importTitleId = useId();
  const [metadataSavingKeys, setMetadataSavingKeys] = useState<Set<string>>(() => new Set());
  const [metadataEditingKeys, setMetadataEditingKeys] = useState<Set<string>>(() => new Set());
  const loadSequenceRef = useRef(0);
  const metadataRevisionRef = useRef(0);
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const bulkDownloadBusyRef = useRef(false);
  const bulkDownloadAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { bulkDownloadAbortRef.current?.abort(); }, []);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [tags, setTags] = useState("");
  const [typeFilter, setTypeFilter] = useState<MediaTypeFilter>("all");
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [search, setSearch] = useState("");
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [helperOpen, setHelperOpen] = useState(false);
  const [optimizerItem, setOptimizerItem] = useState<MediaOptimizerItem | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(
    () => new Set(),
  );

  const selectedFiles = files;
  const selectedStats = useMemo(() => {
    const images = selectedFiles.filter(isImageFile).length;
    const videos = selectedFiles.filter(isVideoFile).length;
    const audios = selectedFiles.filter(isAudioFile).length;
    const bytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    return { images, videos, audios, bytes };
  }, [selectedFiles]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedItemIds.has(item.id)),
    [items, selectedItemIds],
  );
  const selectedItemCount = selectedItems.length;
  const allVisibleItemsSelected =
    items.length > 0 && items.every((item) => selectedItemIds.has(item.id));
  const bulkDeleting = savingId === "__bulk__";
  const hasRunningOptimization = items.some((item) =>
    ["queued", "processing", "retry_wait"].includes(
      String(item.optimization?.status || ""),
    ) || (item.media_type === "image" && ["queued", "processing", "failed_retryable"].includes(String(item.processing_status || ""))),
  );

  const loadItems = useCallback(async (options?: { silent?: boolean }) => {
    const sequence = ++loadSequenceRef.current;
    const revision = metadataRevisionRef.current;
    const accountId = getActiveBrowserUserId();
    const isCurrentRequest = () => mountedRef.current && sequence === loadSequenceRef.current && getActiveBrowserUserId() === accountId;
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "180");
      params.set("type", typeFilter);
      params.set("includeAudio", "true");
      params.set("active", activeFilter);
      if (search.trim()) params.set("q", search.trim());

      const response = await fetch(
        `/api/media-library/items?${params.toString()}`,
        { cache: "no-store" },
      );
      const json = await readApiJson(
        response,
        i18nT("library_load_failed"),
      );
      if (!response.ok)
        throw new Error(json?.error || i18nT("library_load_failed"));

      // A GET started before a successful edit must never restore the old metadata.
      if (!isCurrentRequest() || revision !== metadataRevisionRef.current) return;
      const nextItems = (json.items ?? []) as MediaItem[];
      setItems(nextItems);
      setSelectedItemIds((prev) => {
        const visibleIds = new Set(nextItems.map((item) => item.id));
        return new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      });
      const nextStats = json.stats ?? {
        total: nextItems.length,
        images: 0,
        videos: 0,
        audios: 0,
        total_bytes: 0,
      };
      setStats(nextStats);

      const isDefaultSnapshot = typeFilter === "all" && activeFilter === "active" && !search.trim();
      if (isDefaultSnapshot) {
        writeModuleSnapshot<MediaLibrarySnapshot>(MODULE_SNAPSHOT_KEYS.mediaLibraryDefault, {
          items: nextItems,
          stats: nextStats,
        });
      }
    } catch (e: any) {
      if (isCurrentRequest() && revision === metadataRevisionRef.current) setError(getClientUserFacingErrorMessage(e, i18nT("library_load_failed")));
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [activeFilter, i18nT, search, typeFilter]);

  useEffect(() => {
    void loadItems({ silent: Boolean(initialSnapshot) });
  }, [initialSnapshot, loadItems]);

  useEffect(() => {
    if (!hasRunningOptimization) return;
    const timer = window.setInterval(() => {
      void loadItems({ silent: true });
    }, 2_500);
    return () => window.clearInterval(timer);
  }, [hasRunningOptimization, loadItems]);

  useEffect(() => {
    if (!importOpen) return;
    const dialog = importDialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uploadingRef.current) { event.preventDefault(); setImportOpen(false); }
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([hidden]), select:not([disabled]), textarea:not([disabled]), a[href]')).filter((element) => element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; importTriggerRef.current?.focus(); };
  }, [importOpen]);

  async function saveMetadata(id: string, field: MediaMetadataFieldKind, value: string) {
    const key = id + ":" + field;
    const accountId = getActiveBrowserUserId();
    setMetadataSavingKeys((current) => new Set(current).add(key));
    try {
      const patch = normalizeMediaMetadata(field, value);
      const response = await fetch("/api/media-library/items", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...patch }),
      });
      const json = await readApiJson(response, i18nT("library_edit_failed"));
      if (!response.ok || json?.ok !== true) throw new Error(json?.error || i18nT("library_edit_failed"));
      if (!mountedRef.current || getActiveBrowserUserId() !== accountId) return;
      metadataRevisionRef.current += 1;
      setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
      setPreviewItem((current) => current?.id === id ? { ...current, ...patch } : current);
      invalidateModuleSnapshot(MODULE_SNAPSHOT_KEYS.mediaLibraryDefault);
    } finally {
      if (mountedRef.current && getActiveBrowserUserId() === accountId) setMetadataSavingKeys((current) => { const next = new Set(current); next.delete(key); return next; });
    }
  }

  function setMetadataEditing(id: string, field: MediaMetadataFieldKind, editing: boolean) {
    if (!mountedRef.current) return;
    const key = id + ":" + field;
    setMetadataEditingKeys((current) => {
      if (current.has(key) === editing) return current;
      const next = new Set(current);
      if (editing) next.add(key); else next.delete(key);
      return next;
    });
  }

  async function downloadSelectedItems() {
    if (bulkDownloadBusyRef.current || selectedItems.length === 0 || bulkDeleting) return;
    const accountId = getActiveBrowserUserId();
    const controller = new AbortController();
    bulkDownloadAbortRef.current = controller;
    bulkDownloadBusyRef.current = true;
    setBulkDownloading(true); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/media-library/download", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedItems.map((item) => item.id) }), signal: controller.signal,
      });
      const json = await readApiJson(response, i18nT("library_bulk_download_failed"));
      if (!response.ok || json?.ok !== true || typeof json.downloadUrl !== "string") throw new Error(json?.error || i18nT("library_bulk_download_failed"));
      if (!mountedRef.current || getActiveBrowserUserId() !== accountId || controller.signal.aborted) return;
      const downloadUrl = new URL(json.downloadUrl, window.location.origin);
      if (downloadUrl.origin !== window.location.origin || downloadUrl.pathname !== "/api/media-library/download") throw new Error(i18nT("library_bulk_download_failed"));
      // Let the browser stream directly to its download manager, including on mobile.
      const link = document.createElement("a");
      link.href = downloadUrl.href; link.download = "mes-medias.zip";
      document.body.appendChild(link); link.click(); link.remove();
      setSuccess(i18nT("library_bulk_download_started"));
    } catch (cause) {
      if (!controller.signal.aborted && mountedRef.current && getActiveBrowserUserId() === accountId) setError(getClientUserFacingErrorMessage(cause, i18nT("library_bulk_download_failed")));
    } finally {
      bulkDownloadBusyRef.current = false;
      if (bulkDownloadAbortRef.current === controller) bulkDownloadAbortRef.current = null;
      if (mountedRef.current && getActiveBrowserUserId() === accountId) setBulkDownloading(false);
    }
  }

  function mergeSelectedFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) return;
    setError(null);
    setSuccess(null);

    try {
      validateUploadFiles(nextFiles, i18nT("library_audio_file_error"));
      const byKey = new Map<string, File>();
      for (const file of files) {
        byKey.set(getClientFileId(file, 0), file);
      }
      for (const file of nextFiles) {
        byKey.set(getClientFileId(file, 0), file);
      }
      const merged = Array.from(byKey.values());
      validateUploadFiles(merged, i18nT("library_audio_file_error"));
      setFiles(merged);
      setFileInputKey((value) => value + 1);
    } catch (e: any) {
      setFileInputKey((value) => value + 1);
      setError(getClientUserFacingErrorMessage(e, i18nT("file_not_allowed")));
    }
  }

  function removeSelectedFile(indexToRemove: number) {
    setFiles((current) =>
      current.filter((_, index) => index !== indexToRemove),
    );
    setFileInputKey((value) => value + 1);
  }

  function clearSelectedFiles() {
    setFiles([]);
    setFileInputKey((value) => value + 1);
  }

  function onDropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    if (uploading) return;
    mergeSelectedFiles(Array.from(event.dataTransfer.files || []));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setUploadProgress(null);

    if (selectedFiles.length === 0) {
      setError(i18nT("library_upload_empty"));
      return;
    }

    const uploadFiles = selectedFiles;
    setUploading(true);
    setUploadPercent(0);

    try {
      validateUploadFiles(uploadFiles, i18nT("library_audio_file_error"));
      const supabase = createClient();
      const batches = chunkFiles(uploadFiles, UPLOAD_BATCH_SIZE);
      let uploaded = 0;
      let failed = 0;
      let processed = 0;
      const failures: string[] = [];

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const batchNumber = batchIndex + 1;
        const startIndex = batchIndex * UPLOAD_BATCH_SIZE;
        setUploadProgress(i18nT("upload_batch_preparing", { batch: batchNumber, total: batches.length }));
        setUploadPercent(
          Math.max(2, Math.round((processed / uploadFiles.length) * 90)),
        );

        const prepareResponse = await fetch("/api/media-library/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "prepare",
            files: batch.map((file, localIndex) => ({
              client_id: getClientFileId(file, startIndex + localIndex),
              name: file.name,
              type: file.type,
              size: file.size,
              last_modified: file.lastModified,
            })),
          }),
        });
        const prepareJson = await readApiJson(
          prepareResponse,
          i18nT("upload_prepare_failed"),
        );
        if (!prepareResponse.ok)
          throw new Error(
            prepareJson?.error || i18nT("upload_prepare_failed"),
          );

        const preparedItems = (
          (prepareJson?.items ?? []) as UploadPrepareItem[]
        ).filter((item) => item?.token && item?.storage_path);
        const preparedById = new Map(
          preparedItems.map((item) => [item.client_id, item]),
        );
        const finalizeItems: UploadFinalizeItem[] = [];

        for (let localIndex = 0; localIndex < batch.length; localIndex += 1) {
          const file = batch[localIndex];
          const clientId = getClientFileId(file, startIndex + localIndex);
          const prepared = preparedById.get(clientId);
          if (!prepared) {
            processed += 1;
            failed += 1;
            setUploadPercent(
              Math.min(
                90,
                Math.max(5, Math.round((processed / uploadFiles.length) * 90)),
              ),
            );
            failures.push(i18nT("upload_file_prepare_failed", { name: formatUploadName(file) }));
            continue;
          }

          try {
            let completedProtocol: "signed" | "tus" = "signed";
            setUploadProgress(i18nT("upload_batch_file_progress", {
              batch: batchNumber,
              batches: batches.length,
              file: localIndex + 1,
              files: batch.length,
            }));
            const info = await getMediaInfo(file);
            const contentType =
              prepared.content_type || file.type || "application/octet-stream";

            if (isUniversalMediaUploadEnabled() && prepared.media_type !== "audio") {
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
                const uploadResult = await uploadFileToPreparedUniversalIntent(file, intent, {
                  onProgress(progress) {
                    setUploadPercent(
                      Math.min(
                        90,
                        Math.max(
                          5,
                          Math.round(
                            ((processed + progress.percent / 100) /
                              uploadFiles.length) *
                              90,
                          ),
                        ),
                      ),
                    );
                  },
                });
                completedProtocol = uploadResult.protocol;
              } catch (universalError) {
                console.warn(
                  "[media-pipeline] media library signed fallback",
                  universalError,
                );
                const { error: uploadError } = await supabase.storage
                  .from(prepared.bucket || "inrcy-pro-media")
                  .uploadToSignedUrl(
                    prepared.storage_path,
                    prepared.token,
                    file,
                    { contentType },
                  );
                if (uploadError) throw uploadError;
              }
            } else {
              const { error: uploadError } = await supabase.storage
                .from(prepared.bucket || "inrcy-pro-media")
                .uploadToSignedUrl(
                  prepared.storage_path,
                  prepared.token,
                  file,
                  { contentType },
                );
              if (uploadError) throw uploadError;
            }

            processed += 1;
            setUploadPercent(
              Math.min(
                90,
                Math.max(5, Math.round((processed / uploadFiles.length) * 90)),
              ),
            );

            finalizeItems.push({
              client_id: clientId,
              original_name: prepared.original_name || file.name,
              storage_path: prepared.storage_path,
              mime_type:
                prepared.content_type ||
                file.type ||
                "application/octet-stream",
              size_bytes: file.size,
              width: info.width,
              height: info.height,
              duration_seconds: info.duration_seconds,
              upload_protocol: completedProtocol,
            });
          } catch (uploadError: any) {
            processed += 1;
            failed += 1;
            setUploadPercent(
              Math.min(
                90,
                Math.max(5, Math.round((processed / uploadFiles.length) * 90)),
              ),
            );
            failures.push(i18nT("upload_file_error", {
              name: formatUploadName(file),
              error: getClientUserFacingErrorMessage(uploadError, i18nT("upload_transfer_failed")),
            }));
          }
        }

        if (finalizeItems.length > 0) {
          setUploadProgress(i18nT("upload_batch_finalizing", { batch: batchNumber, total: batches.length }));
          setUploadPercent(
            Math.max(92, Math.round((processed / uploadFiles.length) * 92)),
          );
          const finalizeResponse = await fetch("/api/media-library/upload", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "finalize",
              tags,
              source: "mediatheque",
              uploads: finalizeItems,
            }),
          });
          const finalizeJson = await readApiJson(
            finalizeResponse,
            i18nT("upload_finalize_failed"),
          );
          if (!finalizeResponse.ok)
            throw new Error(
              finalizeJson?.error || i18nT("upload_finalize_failed"),
            );
          uploaded += Number(finalizeJson?.uploaded || 0);
          failed += Number(finalizeJson?.failed || 0);
          const results = Array.isArray(finalizeJson?.results)
            ? finalizeJson.results
            : [];
          for (const result of results) {
            if (result && result.ok === false && result.original_name) {
              failures.push(i18nT("upload_file_error", {
                name: result.original_name,
                error: getClientUserFacingErrorMessage(result.error, i18nT("upload_finalize_failed_short")),
              }));
            }
          }
        }
      }

      setUploadPercent(100);
      setSuccess(i18nT("upload_result", { uploaded, failed }));
      if (failures.length > 0) setError(failures.slice(0, 4).join("\n"));
      setFiles([]);
      setFileInputKey((value) => value + 1);
      await loadItems();
    } catch (e: any) {
      setError(getClientUserFacingErrorMessage(e, i18nT("upload_failed")));
    } finally {
      setUploadProgress(null);
      setUploadPercent(null);
      setUploading(false);
    }
  }

  function toggleItemSelection(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleItemDetails(id: string) {
    setExpandedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleMobileRowSelection(
    event: MouseEvent<HTMLElement>,
    item: MediaItem,
  ) {
    if (savingId === item.id || bulkDeleting) return;
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 680px)").matches) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, label, select, textarea, audio, video")) return;

    toggleItemSelection(item.id);
  }

  function toggleAllVisibleItems() {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (allVisibleItemsSelected) {
        for (const item of items) next.delete(item.id);
      } else {
        for (const item of items) next.add(item.id);
      }
      return next;
    });
  }

  function clearItemSelection() {
    setSelectedItemIds(new Set());
  }

  function getDeleteUsageLabel(source: unknown) {
    if (source === "inr_agent_scheduled_action") return i18nT("usage_source_agent_schedule");
    if (source === "publish_draft") return i18nT("usage_source_publish_draft");
    if (source === "mail_campaign") return i18nT("usage_source_mail_campaign");
    if (source === "send_item_draft") return i18nT("usage_source_send_draft");
    return i18nT("usage_source_agent_action");
  }

  function buildDeleteUsageConfirmMessage(payload: any, count: number) {
    const usages = Array.isArray(payload?.usages) ? payload.usages : [];
    const usageLines = usages
      .slice(0, 6)
      .map((usage: any) => {
        const title = String(usage?.title || i18nT("usage_default_item")).trim();
        const label = getDeleteUsageLabel(usage?.source);
        const date = usage?.scheduledFor ? displayDate(String(usage.scheduledFor)) : "";
        return i18nT("usage_line", {
          label,
          title,
          hasDate: date ? "yes" : "no",
          date,
        });
      })
      .join("\n");
    const hiddenCount = Math.max(0, Number(payload?.usageCount || usages.length || 0) - 6);
    return [
      i18nT("delete_usage_warning", { count }),
      "",
      usageLines,
      hiddenCount ? i18nT("delete_usage_more", { count: hiddenCount }) : "",
      "",
      i18nT("delete_usage_risk"),
      i18nT("delete_usage_confirm"),
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function requestMediaDelete(ids: string[], force = false): Promise<any> {
    const response = await fetch("/api/media-library/items", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, force }),
    });
    const json = await readApiJson(response, "Suppression impossible.");
    if (
      response.status === 409 &&
      json?.requiresConfirmation &&
      !force
    ) {
      const ok = await confirmInrcy({
        eyebrow: i18nT("mediatheque_e4fa8e31"),
        title: i18nT("supprimer_malgre_les_utilisations_faab5cc2"),
        message: buildDeleteUsageConfirmMessage(json, ids.length),
        confirmLabel: i18nT("supprimer_definitivement_66e03d8b"),
        cancelLabel: i18nT("annuler_49ba3292"),
        variant: "danger",
      });
      if (!ok) return { ok: false, cancelled: true };
      return await requestMediaDelete(ids, true);
    }
    if (!response.ok) throw new Error(json?.error || "Suppression impossible.");
    return json;
  }

  async function deleteSelectedItems() {
    const ids = selectedItems.map((item) => item.id);
    if (!ids.length) return;

    const ok = await confirmInrcy({
      eyebrow: i18nT("mediatheque_e4fa8e31"),
      title: i18nT("supprimer_les_medias_selectionnes_9540bf97"),
      message: i18nT("supprimer_definitivement_value_media_s_de_80952de7", { value0: ids.length }),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      cancelLabel: i18nT("annuler_49ba3292"),
      variant: "danger",
    });
    if (!ok) return;

    setSavingId("__bulk__");
    setError(null);
    setSuccess(null);
    try {
      const json = await requestMediaDelete(ids);
      if (json?.cancelled) return;
      setSuccess(i18nT("value_media_s_supprime_s_8df3af87", { value0: Number(json?.deleted || ids.length) }));
      clearItemSelection();
      await loadItems();
    } catch (e: any) {
      setError(getClientUserFacingErrorMessage(e, i18nT("delete_failed")));
    } finally {
      setSavingId(null);
    }
  }

  async function deleteItem(item: MediaItem) {
    const ok = await confirmInrcy({
      eyebrow: i18nT("mediatheque_e4fa8e31"),
      title: i18nT("supprimer_ce_media_854005e3"),
      message: i18nT("ce_media_sera_supprime_definitivement_de_783dea19"),
      confirmLabel: i18nT("supprimer_1acfc1c7"),
      cancelLabel: i18nT("annuler_49ba3292"),
      variant: "danger",
    });
    if (!ok) return;
    setSavingId(item.id);
    setError(null);
    setSuccess(null);
    try {
      const json = await requestMediaDelete([item.id]);
      if (json?.cancelled) return;
      setSuccess(i18nT("media_supprime_09076281"));
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      await loadItems();
    } catch (e: any) {
      setError(getClientUserFacingErrorMessage(e, i18nT("delete_failed")));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className={styles.page} data-media-library-page="true">
      <div className={styles.wrap} inert={importOpen ? true : undefined}>
        <section className={styles.heroCard}>
          <div className={styles.heroIcon} aria-hidden="true">
            🖼️
          </div>
          <div className={styles.heroContent}>
            <h1 className={styles.title}>{i18nT("mes_medias_0c5196c9")}</h1>
          </div>

          <div className={styles.headerMetrics} aria-label={i18nT("library_statistics")}>
            <span><strong>{stats.total}</strong> {i18nT("medias_486d82f4")}</span>
            <span data-kind="image"><strong>{stats.images}</strong> {i18nT("images_09e871c9")}</span>
            <span data-kind="video"><strong>{stats.videos}</strong> {i18nT("videos_ea129238")}</span>
            <span data-kind="audio"><strong>{stats.audios ?? 0}</strong> {i18nT("library_audio")}</span>
            <span>{displayBytes(stats.total_bytes)}</span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.helperButton}
              onClick={() => setHelperOpen(true)}
              aria-label={i18nT("aide_mediatheque_1327839a")}
            >
              ?
            </button>
            <button
              type="button"
              className={styles.ghostButton}
              onClick={() => void loadItems()}
              disabled={loading}
              aria-label={loading ? i18nT("library_loading_aria") : i18nT("library_refresh_aria")}
            >
              <span className={styles.actionIcon} aria-hidden="true">↻</span>
              <span className={styles.actionText}>
                {loading ? i18nT("chargement_01cba1df") : i18nT("rafraichir_be30b7d1")}
              </span>
            </button>
            <button ref={importTriggerRef} type="button" className={styles.importButton} onClick={() => setImportOpen(true)} aria-haspopup="dialog" aria-expanded={importOpen}>
              <span aria-hidden="true">＋</span>{i18nT("library_import")}
            </button>
            <Link
              href="/dashboard/generer-media"
              className={styles.studioButton}
              aria-label={`${i18nT("ai_generator_made_inrcy")} — ${i18nT("ai_generator_generate_media")}`}
            >
              <span className={styles.studioButtonIcon} aria-hidden="true">✦</span>
              <span>{i18nT("ai_generator_made_inrcy")}</span>
            </Link>
            <Link href="/dashboard" className={styles.closeButton} aria-label={i18nT("fermer_la_mediatheque_beaaf18f")}>
              <span className={styles.closeText}>{i18nT("fermer_5ab4ec64")}</span>
              <span className={styles.closeIcon} aria-hidden="true">×</span>
            </Link>
          </div>
        </section>

        <div className={styles.grid} data-media-library-content="true">

          <section className={styles.libraryCard}>
            <div className={styles.filters}>
              <label>
                <span>{i18nT("type_3deb7456")}</span>
                <select
                  className={styles.select}
                  value={typeFilter}
                  disabled={metadataEditingKeys.size > 0}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as MediaTypeFilter)
                  }
                >
                  <option value="all">{i18nT("tous_b97ae3b4")}</option>
                  <option value="image">{i18nT("images_09e871c9")}</option>
                  <option value="video">{i18nT("videos_ea129238")}</option>
                  <option value="audio">{i18nT("library_audio")}</option>
                </select>
              </label>
              <label>
                <span>{i18nT("statut_659499f3")}</span>
                <select
                  className={styles.select}
                  value={activeFilter}
                  disabled={metadataEditingKeys.size > 0}
                  onChange={(event) =>
                    setActiveFilter(event.target.value as ActiveFilter)
                  }
                >
                  <option value="active">{i18nT("actifs_4fc3a980")}</option>
                  <option value="inactive">{i18nT("masques_cb0d30ef")}</option>
                  <option value="all">{i18nT("tous_b97ae3b4")}</option>
                </select>
              </label>
              <label className={styles.searchLabel}>
                <span>{i18nT("recherche_787b5492")}</span>
                <input
                  className={styles.input}
                  value={search}
                  disabled={metadataEditingKeys.size > 0}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={i18nT("titre_tag_fichier_3ea8c409")}
                />
              </label>

              <button
                type="button"
                className={styles.selectAllButton}
                onClick={toggleAllVisibleItems}
                disabled={loading || items.length === 0 || bulkDeleting}
              >
                {allVisibleItemsSelected ? i18nT("tout_deselectionner_d17ec0b7") : i18nT("tout_selectionner_06f2c1c0")}
              </button>
            </div>

            <div className={styles.bulkToolbar} hidden={!selectedItemCount}>

              {selectedItemCount > 0 ? (
                <>
                  <span className={styles.selectedCount}>
                    {i18nT("value_media_s_selectionne_s_bf363244", { value0: selectedItemCount })}</span>
                  <button type="button" className={styles.bulkDownloadButton} onClick={downloadSelectedItems} disabled={bulkDownloading || bulkDeleting || metadataSavingKeys.size > 0} aria-busy={bulkDownloading}>
                    {i18nT(bulkDownloading ? "library_bulk_download_preparing" : "library_bulk_download")}
                  </button>
                  <button
                    type="button"
                    className={styles.bulkDangerButton}
                    onClick={deleteSelectedItems}
                    disabled={bulkDownloading || bulkDeleting || metadataSavingKeys.size > 0}
                  >
                    {bulkDeleting ? i18nT("suppression_a620db43") : i18nT("supprimer_la_selection_d1347096")}
                  </button>
                </>
              ) : null}
            </div>

            {!importOpen && (success || error) ? <div className={styles.pageFeedback} aria-live="polite">
              {success ? <div className={styles.success}>{success}</div> : null}
              {error ? <div className={styles.error}>{error}</div> : null}
            </div> : null}
            {metadataEditingKeys.size > 0 ? <p className={styles.editingNotice} role="status">{i18nT("library_finish_edit")}</p> : null}
            {loading && items.length === 0 ? (
              <div className={styles.emptyState}>
                {i18nT("chargement_de_votre_mediatheque_25fc0449")}{" "}</div>
            ) : items.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>{i18nT("aucun_media_pour_le_moment_12d38a73")}</strong>
                <span>
                  {i18nT("importez_vos_premieres_photos_ou_videos_7f226498")}{" "}</span>
              </div>
            ) : (
              <div className={styles.mediaList} aria-busy={loading}>
                <div className={styles.mediaListHead} aria-hidden="true">
                  <span></span><span>{i18nT("media_d8a313d3")}</span><span>{i18nT("library_field_title")}</span><span>{i18nT("tags_848eed0f")}</span><span>{i18nT("library_information")}</span><span></span>
                </div>
                {items.map((item) => {
                  const isSelected = selectedItemIds.has(item.id);
                  const detailsOpen = expandedItemIds.has(item.id);
                  const isSaving = savingId === item.id || metadataSavingKeys.has(item.id + ":title") || metadataSavingKeys.has(item.id + ":tags");
                  const downloadUrl = buildMediaDownloadUrl(item.signed_url);
                  return (
                  <article
                    key={item.id}
                    className={`${styles.mediaRow} ${isSelected ? styles.mediaRowSelected : ""} ${detailsOpen ? styles.mediaRowDetailsOpen : ""} ${item.is_active === false ? styles.mediaRowDisabled : ""}`}
                    onClick={(event) => handleMobileRowSelection(event, item)}
                  >
                    <label
                      className={styles.rowCheck}
                      aria-label={i18nT("selectionner_value_b74d84aa", { value0: item.title || i18nT("media_this") })}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleItemSelection(item.id)}
                        disabled={isSaving || bulkDeleting}
                      />
                      <span aria-hidden="true" />
                    </label>
                    <div className={styles.mediaRowFile}>
                      <button
                        type="button"
                        className={styles.mediaRowPreview}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPreviewItem(item);
                        }}
                        aria-label={item.media_type === "audio" ? i18nT("library_audio_preview", { name: item.title || item.original_file_name || i18nT("media_sans_titre_e77f1871") }) : i18nT("agrandir_le_media_55f536e4")}
                      >
                        {item.media_type === "audio" ? (
                          <span className={styles.mediaRowAudioThumb} aria-hidden="true">🎙</span>
                        ) : item.media_type === "video" ? (
                          <video
                            src={item.signed_url || undefined}
                            className={styles.mediaRowThumb}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : item.signed_url ? (
                          <img
                            src={item.preview_url || item.signed_url}
                            alt={item.title || i18nT("media_default_alt")}
                            className={styles.mediaRowThumb}
                            loading="lazy"
                          />
                        ) : (
                          <div className={styles.noPreview}>{i18nT("apercu_indisponible_d0ce704a")}</div>
                        )}
                      </button>

                    </div>
                    <div className={styles.mediaRowMain}>
                        <MediaMetadataField field="title" value={item.title || ""} disabled={isSaving || bulkDeleting} onSave={(field, value) => saveMetadata(item.id, field, value)} onEditingChange={(editing) => setMetadataEditing(item.id, "title", editing)} />
                        {item.media_type === "audio" && item.signed_url ? <audio className={styles.mediaRowAudioPlayer} src={item.signed_url} controls preload="none" aria-label={i18nT("library_audio_preview", { name: item.title || item.original_file_name || i18nT("media_sans_titre_e77f1871") })} /> : null}
                        {item.imageRecovery ? (
                          <span className={styles.optimizationBadge} title={i18nT("image_recovery_notice")}>{i18nT("image_recovery_badge")}</span>
                        ) : item.media_type === "image" && item.processing_status === "failed_terminal" ? (
                          <span className={styles.optimizationBadge} role="status">{item.processing_error_message || i18nT("image_recovery_failed")}</span>
                        ) : null}
                        {mediaNeedsOptimization(item) ? (
                          <div className={styles.mediaRowOptimizationActions}>
                            <span className={styles.optimizationBadge}>
                              {i18nT("a_optimiser_format_et_ou_poids_df2070a3")}{" "}</span>
                            <button
                              type="button"
                              className={styles.optimizeButton}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOptimizerItem(item as MediaOptimizerItem);
                              }}
                            >
                              {["queued", "processing", "retry_wait"].includes(
                                String(item.optimization?.status || ""),
                              )
                                ? i18nT("optimisation_value_174c8358", { value0: Math.max(0, Math.min(99, Number(item.optimization?.progress || 0))) })
                                : i18nT("optimiser_19599bcc")}
                            </button>
                          </div>
                        ) : item.media_type !== "audio" && item.source === "mediatheque_optimization" ? (
                          <span className={styles.compatibleCopyBadge}>{i18nT("copie_optimisee_f10d59ec")}</span>
                        ) : null}
                    </div>
                    <div className={styles.mediaRowTags}>
                      <MediaMetadataField field="tags" value={tagsToText(item.tags)} disabled={isSaving || bulkDeleting} onSave={(field, value) => saveMetadata(item.id, field, value)} onEditingChange={(editing) => setMetadataEditing(item.id, "tags", editing)} />
                    </div>
                    <div className={styles.mediaRowActionRail}>
                      {isSelected ? (
                        <span
                          className={styles.mediaRowSelectionBadge}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className={styles.mediaRowDetailsButton}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleItemDetails(item.id);
                        }}
                        aria-label={detailsOpen ? i18nT("media_hide_details") : i18nT("media_show_details")}
                        aria-expanded={detailsOpen}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 20 20"
                          className={styles.detailsChevron}
                        >
                          <path
                            d="M5.25 7.5 10 12.25 14.75 7.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>

                    <div className={styles.mediaRowFacts}>
                    <span className={styles.mediaRowPill} data-label={i18nT("type_3deb7456")}>
                      {item.media_type === "audio" ? i18nT("library_audio") : item.media_type === "video" ? i18nT("video_304f6ca4") : i18nT("image_50e19fda")}
                    </span>
                    <span className={styles.mediaRowMeta} data-label={i18nT("poids_2cc4c1e5")}>
                      {displayBytes(item.size_bytes)}
                    </span>
                    <span className={styles.mediaRowMeta} data-label={i18nT("format_041a5dec")}>
                      {item.media_type === "video" || item.media_type === "audio"
                        ? formatDuration(item.duration_seconds)
                        : item.width && item.height
                          ? `${item.width}×${item.height}`
                          : "—"}
                    </span>
                    <span className={styles.mediaRowMeta} data-label={i18nT("date_eb9a4bc1")}>
                      {displayDate(item.created_at)}
                    </span>

                    </div>
                    <div className={styles.mediaRowActions}>
                      <a
                        className={styles.mediaRowDownload}
                        href={downloadUrl || undefined}
                        download={item.original_file_name || true}
                        aria-label={i18nT("ai_generator_download")}
                        aria-disabled={!downloadUrl}
                        title={i18nT("ai_generator_download")}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!downloadUrl) event.preventDefault();
                        }}
                      >
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          className={styles.downloadIcon}
                        >
                          <path
                            d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className={styles.mediaRowDownloadLabel}>
                          {i18nT("ai_generator_download")}
                        </span>
                      </a>
                      <button
                        type="button"
                        className={styles.mediaRowDelete}
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteItem(item);
                        }}
                        disabled={isSaving || bulkDeleting}
                      >
                        {i18nT("supprimer_1acfc1c7")}{" "}
                      </button>
                    </div>
                  </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      {importOpen ? <div className={styles.importOverlay} role="presentation" onClick={() => { if (!uploading) setImportOpen(false); }}>
        <div ref={importDialogRef} className={styles.importDialog} role="dialog" aria-modal="true" aria-labelledby={importTitleId} tabIndex={-1} onClick={(event) => event.stopPropagation()}>
          <button type="button" className={styles.importClose} onClick={() => setImportOpen(false)} disabled={uploading} aria-label={i18nT("fermer_5ab4ec64")}>×</button>
          <form className={styles.card} onSubmit={onSubmit}>
            <div className={styles.cardHeader}>
              <h2 id={importTitleId}>{i18nT("importer_dans_ma_mediatheque_3f45cbb6")}</h2>
              <p>
                {i18nT("les_medias_restent_prives_et_rattaches_384c40f8")}{" "}</p>
            </div>

            <div
              className={`${styles.label} ${styles.dropZone} ${dragActive ? styles.dropZoneActive : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragActive(true);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setDragActive(false);
              }}
              onDrop={onDropFiles}
            >
              <label id={`${fileInputId}-label`} htmlFor={fileInputId}>
                {i18nT("fichiers_23a9d9fc")}
              </label>
              <input
                key={fileInputKey}
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                hidden
                aria-labelledby={`${fileInputId}-label`}
                aria-describedby={`${fileInputId}-help`}
                accept={`image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/tiff,image/bmp,${MEDIA_LIBRARY_VIDEO_ACCEPT},audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp3,.wav`}
                multiple
                disabled={uploading}
                onChange={(event) =>
                  mergeSelectedFiles(Array.from(event.target.files || []))
                }
              />
              <button
                type="button"
                className={styles.filePickerButton}
                aria-controls={fileInputId}
                aria-describedby={`${fileInputId}-help`}
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <span className={styles.filePickerPlus} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span>{i18nT("ai_modifier_from_device")}</span>
              </button>
              <small id={`${fileInputId}-help`} className={styles.helper} aria-live="polite">
                {selectedFiles.length
                  ? i18nT("library_selected_files", { count: selectedFiles.length, images: selectedStats.images, videos: selectedStats.videos, audios: selectedStats.audios, size: displayBytes(selectedStats.bytes) })
                  : i18nT("library_audio_upload_help")}
              </small>
            </div>

            {selectedFiles.length > 0 ? (
              <div className={styles.selectedFilesBox}>
                <div className={styles.selectedFilesHeader}>
                  <strong>{i18nT("selection_prete_a_importer_b9f33aa2")}</strong>
                  <button
                    type="button"
                    className={styles.clearSelectionButton}
                    onClick={clearSelectedFiles}
                    disabled={uploading}
                  >
                    {i18nT("vider_13901111")}{" "}</button>
                </div>
                <div className={styles.selectedFilesList}>
                  {selectedFiles.map((file, index) => (
                    <div
                      key={getClientFileId(file, index)}
                      className={styles.selectedFileItem}
                    >
                      <span
                        className={styles.selectedFileIcon}
                        aria-hidden="true"
                      >
                        {isAudioFile(file) ? "🎙" : isVideoFile(file) ? "🎬" : "🖼️"}
                      </span>
                      <span className={styles.selectedFileName}>
                        {file.name}
                      </span>
                      <span className={styles.selectedFileSize}>
                        {displayBytes(file.size)}
                      </span>
                      <button
                        type="button"
                        className={styles.removeFileButton}
                        onClick={() => removeSelectedFile(index)}
                        disabled={uploading}
                        aria-label={i18nT("retirer_value_c04cdfcb", { value0: file.name })}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <label className={styles.label}>
              <span>{i18nT("library_import_common_tags")}</span>
              <input
                className={styles.input}
                value={tags}
                disabled={uploading}
                onChange={(event) => setTags(event.target.value)}
                placeholder={i18nT("chantier_avant_apres_equipe_produit_5ef60075")}
              />
              <small className={styles.helper}>
                {i18nT("les_tags_aideront_inragent_a_choisir_10723b6a")}{" "}</small>
            </label>

            {uploadProgress ? (
              <div className={styles.uploadProgressBox} aria-live="polite">
                <span>{uploadProgress}</span>
                <div className={styles.progressTrack} aria-hidden="true">
                  <span
                    className={styles.progressFill}
                    style={{ width: `${uploadPercent ?? 8}%` }}
                  />
                </div>
              </div>
            ) : null}

            <button
              className={styles.primaryButton}
              type="submit"
              disabled={uploading || selectedFiles.length === 0}
            >
              {uploading ? i18nT("import_en_cours_2357d6a4") : i18nT("importer_dans_ma_mediatheque_3f45cbb6")}
            </button>

            {(success || error) && (
              <div className={styles.formFeedback} aria-live="polite">
                {success ? <div className={styles.success}>{success}</div> : null}
                {error ? <div className={styles.error}>{error}</div> : null}
              </div>
            )}
          </form>
        </div>
      </div> : null}

      <MediaOptimizerModal
        open={Boolean(optimizerItem)}
        sourceItem={optimizerItem}
        origin="mediatheque"
        onClose={() => setOptimizerItem(null)}
        onLibraryChanged={() => loadItems({ silent: true })}
      />

      {helperOpen ? (
        <div data-inrcy-tool-overlay
          className={styles.helperOverlay}
          role="presentation"
          onClick={() => setHelperOpen(false)}
        >
          <div data-inrcy-tool-dialog
            className={styles.helperModal}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("aide_mediatheque_inrcy_c413fda4")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.helperClose}
              onClick={() => setHelperOpen(false)}
              aria-label={i18nT("fermer_l_aide_b2e97a76")}
            >
              ×
            </button>
            <div className={styles.helperModalTop}>
              <div className={styles.helperModalIcon} aria-hidden="true">
                🖼️
              </div>
              <div className={styles.helperModalIntro}>
                <div className={styles.helperModalKicker}>{i18nT("mediatheque_inrcy_a885e19e")}</div>
                <h2>{i18nT("comment_utiliser_vos_medias_b2fba862")}</h2>
                <p>
                  {i18nT("vos_photos_logos_et_videos_restent_a7a8faf5")}{" "}</p>
              </div>
            </div>
            <div className={styles.helperModalPills}>
              <span>{i18nT("prive_e3125aac")}</span>
              <span>{i18nT("images_preparation_automatique_ff95b891")}</span>
              <span>{i18nT("videos_envoi_resumable_e7b7f368")}</span>
              <span>{i18nT("library_audio_help_title")}</span>
              <span>{i18nT("priorite_inragent_91b09501")}</span>
            </div>
            <div className={styles.helperModalGrid}>
              <div className={styles.helperInfoCard}>
                <strong>{i18nT("medias_prives_6faa78ff")}</strong>
                <span>{i18nT("chaque_fichier_reste_rattache_au_compte_bed33f54")}</span>
              </div>
              <div className={styles.helperInfoCard}>
                <strong>{i18nT("images_d6597c32")}</strong>
                <span>{i18nT("formats_image_courants_preparation_automatique_p_33468cd6")}</span>
              </div>
              <div className={styles.helperInfoCard}>
                <strong>{i18nT("videos_65b3bbeb")}</strong>
                <span>{i18nT("formats_video_courants_envoi_direct_et_81881113")}</span>
              </div>
              <div className={styles.helperInfoCard}>
                <strong>{i18nT("library_audio_help_title")}</strong>
                <span>{i18nT("library_audio_help_description")}</span>
              </div>
              <div className={styles.helperInfoCard}>
                <strong>{i18nT("inragent_9be84f49")}</strong>
                <span>{i18nT("inragent_privilegie_cette_mediatheque_avant_la_d4f99b4d")}</span>
              </div>
            </div>
            <div className={styles.helperModalFooter}>
              {i18nT("importez_vos_meilleurs_visuels_ici_pour_470820ca")}{" "}</div>
          </div>
        </div>
      ) : null}

      {previewItem ? (
        <div data-inrcy-tool-overlay
          className={styles.previewOverlay}
          role="presentation"
          onClick={() => setPreviewItem(null)}
        >
          <div data-inrcy-tool-dialog
            className={styles.previewModal}
            role="dialog"
            aria-modal="true"
            aria-label={i18nT("apercu_du_media_a15051aa")}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className={styles.previewClose}
              onClick={() => setPreviewItem(null)}
              aria-label={i18nT("fermer_5ab4ec64")}
            >
              ×
            </button>
            <div className={styles.previewMediaWrap}>
              {previewItem.media_type === "audio" ? (
                <div className={styles.audioPreview}>
                  <span aria-hidden="true">🎙</span>
                  <audio src={previewItem.signed_url || undefined} controls preload="metadata" aria-label={i18nT("library_audio_preview", { name: previewItem.title || previewItem.original_file_name || i18nT("media_sans_titre_e77f1871") })} />
                  <small>{i18nT("library_audio_duration")} : {formatDuration(previewItem.duration_seconds)}</small>
                </div>
              ) : previewItem.media_type === "video" ? (
                <video
                  src={previewItem.signed_url || undefined}
                  controls
                  className={styles.previewMedia}
                />
              ) : (
                <img
                  src={previewItem.preview_url || previewItem.signed_url || ""}
                  alt={previewItem.title || i18nT("media_default_alt")}
                  className={styles.previewMedia}
                />
              )}
            </div>
            <div className={styles.previewInfo}>
              <strong>{previewItem.title || i18nT("media_sans_titre_e77f1871")}</strong>
              <span>{tagsToText(previewItem.tags) || i18nT("aucun_tag_b6d9425d")}</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
