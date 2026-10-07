import { isUniversalMediaUploadEnabled } from "@/lib/universalMediaUploadClient";
import type { BoosterMediaPipelineMission } from "@/lib/boosterMediaPipelineMissions";
import {
  isMediaWorkspaceRetryableFetchError,
  isMediaWorkspaceRetryableHttpStatus,
  MediaWorkspaceHttpError,
  MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
  MEDIA_WORKSPACE_READ_TIMEOUT_MS,
  withMediaWorkspaceDeadline,
} from "@/lib/mediaWorkspaceTimeout";

export type MediaWorkspaceReference = {
  workspaceId: string;
  clientWorkspaceKey: string;
};

export type MediaWorkspaceMediaSummary = {
  mediaId: string;
  mediaType: "image" | "video";
  position: number;
  uploadStatus: "pending" | "uploading" | "uploaded" | "failed" | "removed";
  uploadProgress: number;
  processingStatus?: string;
  processingProgress?: number;
  processingErrorCode?: string | null;
  processingErrorMessage?: string | null;
  publicationStatus?: string;
  bucket: string;
  storagePath: string;
  publicUrl?: string | null;
  previewUrl?: string | null;
  canonicalUrl?: string | null;
  imageRecovery?: {
    kind: "truncated_jpeg";
    version: 1;
    requiresReview: true;
  } | null;
  requiresCanonical?: boolean;
  fileName: string;
  clientMediaKey?: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

export type MediaWorkspaceSnapshot = MediaWorkspaceReference & {
  status: string;
  revision: number;
  media: MediaWorkspaceMediaSummary[];
};

export type MediaWorkspacePreparationResult = {
  ok: true;
  workspaceId: string;
  mission?: BoosterMediaPipelineMission;
  status: "uploading" | "processing" | "ready" | "failed";
  message?: string | null;
  media: MediaWorkspaceMediaSummary[];
};

const BOOSTER_WORKSPACE_SESSION_KEY = "inrcy:booster:media-workspace:v1";

async function waitWorkspaceRetry(ms: number, signal?: AbortSignal | null) {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWorkspaceSnapshotWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await withMediaWorkspaceDeadline(
        (signal) => fetch(input, { ...init, signal }),
        {
          signal: init.signal || undefined,
          timeoutMs: MEDIA_WORKSPACE_READ_TIMEOUT_MS,
          phase: "workspace_read",
        },
      );
      if (
        attempt === 0 &&
        isMediaWorkspaceRetryableHttpStatus(response.status)
      ) {
        await waitWorkspaceRetry(700, init.signal);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (
        init.signal?.aborted ||
        attempt > 0 ||
        !isMediaWorkspaceRetryableFetchError(error)
      ) {
        throw error;
      }
      await waitWorkspaceRetry(700, init.signal);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Impossible de charger l’espace média.");
}

function randomClientKey() {
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `booster:${randomPart}`.slice(0, 480);
}

export function isUniversalMediaWorkspaceEnabled() {
  return (
    isUniversalMediaUploadEnabled() &&
    process.env.NEXT_PUBLIC_MEDIA_PIPELINE_WORKSPACE_V1 === "true"
  );
}

export function getOrCreateBoosterWorkspaceClientKey(draftId?: string | null) {
  const cleanDraftId = String(draftId || "").trim();
  if (cleanDraftId) return `booster:draft:${cleanDraftId}`.slice(0, 480);
  if (typeof window === "undefined") return randomClientKey();

  try {
    const existing = String(
      window.sessionStorage.getItem(BOOSTER_WORKSPACE_SESSION_KEY) || "",
    ).trim();
    if (existing) return existing;
    const created = randomClientKey();
    window.sessionStorage.setItem(BOOSTER_WORKSPACE_SESSION_KEY, created);
    return created;
  } catch {
    return randomClientKey();
  }
}

export function clearBoosterWorkspaceClientKey() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(BOOSTER_WORKSPACE_SESSION_KEY);
  } catch {}
}

export function buildWorkspaceMediaClientKey(
  workspaceClientKey: string,
  file: File,
) {
  return [
    workspaceClientKey,
    file.name || "media",
    file.size || 0,
    file.lastModified || 0,
  ]
    .join(":")
    .slice(0, 500);
}

async function readWorkspaceResponse(response: Response, fallback: string) {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new MediaWorkspaceHttpError(
      response.status,
      String(json?.error || fallback),
    );
  }
  return json;
}

export async function ensureMediaPublicationWorkspace(params: {
  clientWorkspaceKey: string;
  draftId?: string | null;
  selectedChannels?: readonly string[];
  signal?: AbortSignal;
}): Promise<MediaWorkspaceReference> {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "ensure",
          clientWorkspaceKey: params.clientWorkspaceKey,
          sourceModule: "booster",
          draftId: params.draftId || null,
          selectedChannels: params.selectedChannels || [],
        }),
        signal,
        cache: "no-store",
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_ensure",
    },
  );
  const json = await readWorkspaceResponse(
    response,
    "Impossible de préparer l’espace média.",
  );
  return {
    workspaceId: String(json?.workspace?.id || ""),
    clientWorkspaceKey: String(
      json?.workspace?.clientWorkspaceKey || params.clientWorkspaceKey,
    ),
  };
}

export async function clearMediaPublicationWorkspace(params: {
  workspaceId: string;
  mediaType?: "image" | "video";
  reason?: string;
  signal?: AbortSignal;
}) {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "clear_media",
          workspaceId: params.workspaceId,
          mediaType: params.mediaType,
          reason: params.reason || "workspace_sync",
        }),
        signal,
        cache: "no-store",
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_clear",
    },
  );
  await readWorkspaceResponse(response, "Impossible de synchroniser les médias.");
}

export async function archiveMediaPublicationWorkspace(params: {
  workspaceId: string;
  reason?: string;
  signal?: AbortSignal;
}) {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "archive",
          workspaceId: params.workspaceId,
          reason: params.reason || "publication_completed",
        }),
        keepalive: true,
        signal,
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_archive",
    },
  );
  await readWorkspaceResponse(response, "Impossible d’archiver l’espace média.");
}

export async function linkMediaPublicationWorkspaceDraft(params: {
  workspaceId: string;
  draftId: string;
  signal?: AbortSignal;
}) {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "link_draft",
          workspaceId: params.workspaceId,
          draftId: params.draftId,
        }),
        cache: "no-store",
        signal,
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_link_draft",
    },
  );
  await readWorkspaceResponse(
    response,
    "Impossible de relier le brouillon à l’espace média.",
  );
}

export async function loadMediaPublicationWorkspace(params: {
  workspaceId: string;
  signal?: AbortSignal;
  includeUrls?: boolean;
}): Promise<MediaWorkspaceSnapshot> {
  const query = new URLSearchParams({
    workspaceId: params.workspaceId,
    includeUrls: params.includeUrls === false ? "0" : "1",
  });
  const response = await fetchWorkspaceSnapshotWithRetry(
    `/api/media-pipeline/workspace?${query}`,
    {
      signal: params.signal,
      cache: "no-store",
    },
  );
  const json = await readWorkspaceResponse(
    response,
    "Impossible de charger l’espace média.",
  );
  return json.workspace as MediaWorkspaceSnapshot;
}

export async function prepareMediaWorkspaceSourcePreviews(params: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace/source-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: params.workspaceId }),
        signal,
        cache: "no-store",
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_source_preview",
    },
  );
  return await readWorkspaceResponse(
    response,
    "Impossible de préparer la miniature du média.",
  );
}

export async function prepareMediaPublicationWorkspace(params: {
  workspaceId: string;
  mission: Exclude<BoosterMediaPipelineMission, "source_metadata">;
  dispatchWorker?: boolean;
  signal?: AbortSignal;
}): Promise<MediaWorkspacePreparationResult> {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace/prepare", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: params.workspaceId,
          mission: params.mission,
          dispatchWorker: params.dispatchWorker !== false,
        }),
        signal,
        cache: "no-store",
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_prepare",
    },
  );
  const json = await readWorkspaceResponse(
    response,
    "Impossible de lancer la préparation du média.",
  );
  return json as MediaWorkspacePreparationResult;
}

export async function prewarmMediaPublicationWorkspace(params: {
  workspaceId: string;
  selectedChannels?: readonly string[];
  requestedMediaType?: "images" | "video";
  imageSettingsByChannel?: Record<string, unknown>;
  videoSettingsByChannel?: Record<string, unknown>;
  generateMissingVideoVariants?: boolean;
  mediaPipelineCutoverV1?: boolean;
  allowOriginalVideoFallback?: boolean;
  signal?: AbortSignal;
}) {
  const response = await withMediaWorkspaceDeadline(
    (signal) =>
      fetch("/api/media-pipeline/workspace/prewarm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: params.workspaceId,
          selectedChannels: params.selectedChannels || [],
          requestedMediaType: params.requestedMediaType,
          imageSettingsByChannel: params.imageSettingsByChannel || {},
          videoSettingsByChannel: params.videoSettingsByChannel || {},
          generateMissingVideoVariants:
            params.generateMissingVideoVariants !== false,
          mediaPipelineCutoverV1: params.mediaPipelineCutoverV1 === true,
          allowOriginalVideoFallback:
            params.allowOriginalVideoFallback === true,
        }),
        signal,
        cache: "no-store",
      }),
    {
      signal: params.signal,
      timeoutMs: MEDIA_WORKSPACE_MUTATION_TIMEOUT_MS,
      phase: "workspace_prewarm",
    },
  );
  return await readWorkspaceResponse(
    response,
    "Impossible d’anticiper les variantes de publication.",
  );
}
