"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
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
import {
  MEDIA_LIBRARY_IMAGE_OUTPUT_MAX_BYTES,
  MEDIA_LIBRARY_IMAGE_SOURCE_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_OUTPUT_MAX_BYTES,
  MEDIA_LIBRARY_VIDEO_SOURCE_MAX_BYTES,
  getMediaLibraryOptimizationRequirements,
} from "@/lib/mediaLibraryOptimizationPolicy";
import { MODULE_SNAPSHOT_KEYS, readModuleSnapshot, writeModuleSnapshot } from "@/lib/browserModuleSnapshotCache";
import styles from "./mediaLibrary.module.css";

type MediaTypeFilter = "all" | "image" | "video";
type ActiveFilter = "active" | "inactive" | "all";

type MediaItem = {
  id: string;
  bucket_name: string | null;
  storage_path: string;
  media_type: "image" | "video";
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
  media_type: "image" | "video";
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

function validateUploadFiles(selectedFiles: File[]) {
  for (const file of selectedFiles) {
    if (!isImageFile(file) && !isVideoFile(file)) {
      throw new Error(
        `${formatUploadName(file)} : format non reconnu par le moteur média iNrCy.`,
      );
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

function cleanEditableTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 30);
}

function mediaOptimizationLimit(item: Pick<MediaItem, "media_type">) {
  return item.media_type === "video"
    ? MEDIA_LIBRARY_VIDEO_OUTPUT_MAX_BYTES
    : MEDIA_LIBRARY_IMAGE_OUTPUT_MAX_BYTES;
}

function mediaNeedsOptimization(item: MediaItem) {
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
    total_bytes: 0,
  }));
  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [uploading, setUploading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [title, setTitle] = useState("");
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
    const bytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    return { images, videos, bytes };
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
    ),
  );

  const loadItems = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", "180");
      params.set("type", typeFilter);
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
      setError(getClientUserFacingErrorMessage(e, i18nT("library_load_failed")));
    } finally {
      setLoading(false);
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

  function mergeSelectedFiles(nextFiles: File[]) {
    if (nextFiles.length === 0) return;
    setError(null);
    setSuccess(null);

    try {
      validateUploadFiles(nextFiles);
      const byKey = new Map<string, File>();
      for (const file of files) {
        byKey.set(getClientFileId(file, 0), file);
      }
      for (const file of nextFiles) {
        byKey.set(getClientFileId(file, 0), file);
      }
      const merged = Array.from(byKey.values());
      validateUploadFiles(merged);
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

  function onDropFiles(event: DragEvent<HTMLLabelElement>) {
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
      setError(i18nT("ajoute_au_moins_une_image_ou_f47dc202"));
      return;
    }

    const uploadFiles = selectedFiles;
    setUploading(true);
    setUploadPercent(0);

    try {
      validateUploadFiles(uploadFiles);
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
              title,
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
      setTitle("");
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
    if (target?.closest("button, a, input, label, select, textarea")) return;

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
    <div className={styles.page}>
      <div className={styles.wrap}>
        <section className={styles.heroCard}>
          <div className={styles.heroIcon} aria-hidden="true">
            🖼️
          </div>
          <div className={styles.heroContent}>
            <h1 className={styles.title}>
              <span className={styles.titleFull}>{i18nT("vos_images_et_videos_inrcy_58912437")}</span>
              <span className={styles.titleMobile}>{i18nT("mediatheque_inrcy_a885e19e")}</span>
            </h1>
            <p className={styles.subtitle}>
              {i18nT("medias_prives_pour_vos_publications_et_d4b404be")}{" "}</p>
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
            <Link href="/dashboard" className={styles.closeButton} aria-label={i18nT("fermer_la_mediatheque_beaaf18f")}>
              <span className={styles.closeText}>{i18nT("fermer_5ab4ec64")}</span>
              <span className={styles.closeIcon} aria-hidden="true">×</span>
            </Link>
          </div>
        </section>


        <section className={styles.metricsGrid}>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>{i18nT("medias_486d82f4")}</span>
            <strong className={styles.metricValue}>{stats.total}</strong>
            <small className={styles.metricSub}>{i18nT("elements_affiches_20abefad")}</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>{i18nT("images_09e871c9")}</span>
            <strong className={styles.metricValue}>{stats.images}</strong>
            <small className={styles.metricSub}>{i18nT("jpg_png_webp_b52b82db")}</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>{i18nT("videos_ea129238")}</span>
            <strong className={styles.metricValue}>{stats.videos}</strong>
            <small className={styles.metricSub}>{i18nT("mp4_webm_mov_116ade48")}</small>
          </article>
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>{i18nT("poids_affiche_299b78be")}</span>
            <strong className={styles.metricValueSmall}>
              {displayBytes(stats.total_bytes)}
            </strong>
            <small className={styles.metricSub}>{i18nT("sur_cette_vue_d3d66a31")}</small>
          </article>
        </section>

        <div className={styles.grid}>
          <form className={styles.card} onSubmit={onSubmit}>
            <div className={styles.cardHeader}>
              <h2>{i18nT("importer_dans_ma_mediatheque_3f45cbb6")}</h2>
              <p>
                {i18nT("les_medias_restent_prives_et_rattaches_384c40f8")}{" "}</p>
            </div>

            <label
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
              <span>{i18nT("fichiers_23a9d9fc")}</span>
              <input
                key={fileInputKey}
                className={styles.fileInput}
                type="file"
                accept={`image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,image/heif,image/tiff,image/bmp,${MEDIA_LIBRARY_VIDEO_ACCEPT}`}
                multiple
                disabled={uploading}
                onChange={(event) =>
                  mergeSelectedFiles(Array.from(event.target.files || []))
                }
              />
              <small className={styles.helper}>
                {selectedFiles.length
                  ? i18nT("value_fichier_s_value_image_s_a7f02e95", { value0: selectedFiles.length, value1: selectedStats.images, value2: selectedStats.videos, value3: displayBytes(selectedStats.bytes) })
                  : i18nT("medias_source_jusqu_a_300_mo_19c89ace", { value0: UPLOAD_BATCH_SIZE })}
              </small>
            </label>

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
                        {isVideoFile(file) ? "🎬" : "🖼️"}
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
              <span>{i18nT("titre_commun_optionnel_01483e16")}</span>
              <input
                className={styles.input}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={i18nT("ex_realisations_toiture_2026_a3f9cf21")}
              />
            </label>

            <label className={styles.label}>
              <span>{i18nT("tags_848eed0f")}</span>
              <input
                className={styles.input}
                value={tags}
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

          <section className={styles.libraryCard}>
            <div className={styles.libraryHeader}>
              <div>
                <h2>{i18nT("mes_medias_0c5196c9")}</h2>
                <p>
                  {i18nT("photos_et_videos_disponibles_pour_inragent_f169f51c")}{" "}</p>
              </div>
            </div>

            <div className={styles.filters}>
              <label>
                <span>{i18nT("type_3deb7456")}</span>
                <select
                  className={styles.select}
                  value={typeFilter}
                  onChange={(event) =>
                    setTypeFilter(event.target.value as MediaTypeFilter)
                  }
                >
                  <option value="all">{i18nT("tous_b97ae3b4")}</option>
                  <option value="image">{i18nT("images_09e871c9")}</option>
                  <option value="video">{i18nT("videos_ea129238")}</option>
                </select>
              </label>
              <label>
                <span>{i18nT("statut_659499f3")}</span>
                <select
                  className={styles.select}
                  value={activeFilter}
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
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={i18nT("titre_tag_fichier_3ea8c409")}
                />
              </label>
              <button
                type="button"
                className={styles.applyButton}
                onClick={() => void loadItems()}
              >
                {i18nT("appliquer_a4d66139")}{" "}</button>
            </div>

            <div className={styles.bulkToolbar}>
              <button
                type="button"
                className={styles.smallGhostButton}
                onClick={toggleAllVisibleItems}
                disabled={loading || items.length === 0 || bulkDeleting}
              >
                {allVisibleItemsSelected ? i18nT("tout_deselectionner_d17ec0b7") : i18nT("tout_selectionner_06f2c1c0")}
              </button>
              {selectedItemCount > 0 ? (
                <>
                  <span className={styles.selectedCount}>
                    {i18nT("value_media_s_selectionne_s_bf363244", { value0: selectedItemCount })}</span>
                  <button
                    type="button"
                    className={styles.bulkDangerButton}
                    onClick={deleteSelectedItems}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? i18nT("suppression_a620db43") : i18nT("supprimer_la_selection_d1347096")}
                  </button>
                </>
              ) : null}
            </div>

            {loading ? (
              <div className={styles.emptyState}>
                {i18nT("chargement_de_votre_mediatheque_25fc0449")}{" "}</div>
            ) : items.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>{i18nT("aucun_media_pour_le_moment_12d38a73")}</strong>
                <span>
                  {i18nT("importez_vos_premieres_photos_ou_videos_7f226498")}{" "}</span>
              </div>
            ) : (
              <div className={styles.mediaList}>
                <div className={styles.mediaListHead} aria-hidden="true">
                  <span></span>
                  <span>{i18nT("media_d8a313d3")}</span>
                  <span>{i18nT("type_3deb7456")}</span>
                  <span>{i18nT("poids_2cc4c1e5")}</span>
                  <span>{i18nT("format_041a5dec")}</span>
                  <span>{i18nT("date_eb9a4bc1")}</span>
                  <span></span>
                </div>
                {items.map((item) => {
                  const isSelected = selectedItemIds.has(item.id);
                  const detailsOpen = expandedItemIds.has(item.id);
                  const isSaving = savingId === item.id;
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
                        aria-label={i18nT("agrandir_le_media_55f536e4")}
                      >
                        {item.media_type === "video" ? (
                          <video
                            src={item.signed_url || undefined}
                            className={styles.mediaRowThumb}
                            muted
                            playsInline
                            preload="metadata"
                          />
                        ) : item.signed_url ? (
                          <img
                            src={item.signed_url}
                            alt={item.title || i18nT("media_default_alt")}
                            className={styles.mediaRowThumb}
                            loading="lazy"
                          />
                        ) : (
                          <div className={styles.noPreview}>{i18nT("apercu_indisponible_d0ce704a")}</div>
                        )}
                      </button>

                      <div className={styles.mediaRowMain}>
                        <strong>{item.title || i18nT("media_sans_titre_e77f1871")}</strong>
                        <span>{tagsToText(item.tags) || i18nT("aucun_tag_b6d9425d")}</span>
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
                        ) : item.source === "mediatheque_optimization" ? (
                          <span className={styles.compatibleCopyBadge}>{i18nT("copie_optimisee_f10d59ec")}</span>
                        ) : null}
                      </div>
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

                    <span className={styles.mediaRowPill} data-label="Type">
                      {item.media_type === "video" ? i18nT("video_304f6ca4") : i18nT("image_50e19fda")}
                    </span>
                    <span className={styles.mediaRowMeta} data-label="Poids">
                      {displayBytes(item.size_bytes)}
                    </span>
                    <span className={styles.mediaRowMeta} data-label="Format">
                      {item.media_type === "video"
                        ? formatDuration(item.duration_seconds)
                        : item.width && item.height
                          ? `${item.width}×${item.height}`
                          : "—"}
                    </span>
                    <span className={styles.mediaRowMeta} data-label="Date">
                      {displayDate(item.created_at)}
                    </span>

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

      <MediaOptimizerModal
        open={Boolean(optimizerItem)}
        sourceItem={optimizerItem}
        origin="mediatheque"
        onClose={() => setOptimizerItem(null)}
        onLibraryChanged={() => loadItems({ silent: true })}
      />

      {helperOpen ? (
        <div
          className={styles.helperOverlay}
          role="presentation"
          onClick={() => setHelperOpen(false)}
        >
          <div
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
        <div
          className={styles.previewOverlay}
          role="presentation"
          onClick={() => setPreviewItem(null)}
        >
          <div
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
              {previewItem.media_type === "video" ? (
                <video
                  src={previewItem.signed_url || undefined}
                  controls
                  className={styles.previewMedia}
                />
              ) : (
                <img
                  src={previewItem.signed_url || ""}
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
