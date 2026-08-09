import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { enforceRateLimit } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSignedUploadUrlWithRetry } from "@/lib/supabaseStorageUpload";
import {
  UNIVERSAL_MEDIA_IMAGE_HARD_MAX_BYTES,
  UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES,
  UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES,
  buildDirectStorageResumableEndpoint,
  detectUniversalUploadMediaType,
  getUniversalMediaContentType,
  getUniversalMediaHardMaxBytes,
  getUniversalMediaProductMaxBytes,
  getUniversalMediaProductMaxLabel,
  isUniversalMediaUploadTarget,
  sanitizeUniversalMediaFileName,
  sanitizeUniversalMediaSegment,
  selectUniversalMediaUploadProtocol,
  targetAcceptsUniversalMediaType,
  type UniversalMediaUploadTarget,
  type UniversalUploadMediaType,
} from "@/lib/mediaUploadPolicy";
import { UNIVERSAL_MEDIA_PIPELINE_VERSION } from "@/lib/mediaPipelineRegistry";
import { refreshPublicationWorkspaceMediaStatus } from "@/lib/mediaWorkspaceServer";
import { sanitizeClientMediaMetadata } from "@/lib/mediaClientMetadata";
import {
  INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS,
  INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES,
  INR_MEDIA_VIDEO_FORMATS_LABEL,
  INR_MEDIA_VIDEO_TOO_LARGE_MESSAGE,
  getInrMediaFileExtension,
} from "@/lib/mediaRules";

export const runtime = "nodejs";

const TARGET_CONFIG: Record<
  UniversalMediaUploadTarget,
  {
    bucket: "booster" | "inrcy-pro-media";
    folder: string;
    registerSource: boolean;
    publicObject: boolean;
  }
> = {
  booster_prepared_image: {
    bucket: "booster",
    folder: "booster-prepublish",
    registerSource: false,
    publicObject: true,
  },
  booster_draft_image: {
    bucket: "booster",
    folder: "booster-drafts",
    registerSource: false,
    publicObject: true,
  },
  booster_video_source: {
    bucket: "booster",
    folder: "booster-videos",
    // The browser still uploads bytes directly to Storage. The lightweight
    // registry row lets the server persist its FFmpeg attestation during the
    // user's review time, including for mixed image-workspace + video payloads.
    registerSource: true,
    publicObject: true,
  },
  media_library_source: {
    bucket: "inrcy-pro-media",
    folder: "library-source",
    registerSource: false,
    publicObject: false,
  },
  workspace_source: {
    bucket: "inrcy-pro-media",
    folder: "workspace-source",
    registerSource: true,
    publicObject: false,
  },
};

type IntentBody = {
  target?: unknown;
  clientMediaKey?: unknown;
  workspaceId?: unknown;
  workspacePosition?: unknown;
  requestedPath?: unknown;
  requestedFolder?: unknown;
  source?: unknown;
  metadata?: unknown;
  file?: {
    name?: unknown;
    type?: unknown;
    size?: unknown;
    lastModified?: unknown;
  };
};

function jsonError(error: string, status = 400, code?: string) {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status },
  );
}

function cleanText(value: unknown, fallback = "", max = 500) {
  return String(value ?? fallback).trim().slice(0, max);
}

function cleanJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).slice(0, 80),
  );
}

function isAcceptedBoosterVideoSource(params: {
  fileName: string;
  mimeType: string;
}) {
  const extension = getInrMediaFileExtension(params.fileName);
  const mimeType = String(params.mimeType || "")
    .toLowerCase()
    .split(";")[0]
    ?.trim() || "";
  const extensionAccepted = INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS.includes(
    extension as (typeof INR_MEDIA_ALLOWED_VIDEO_EXTENSIONS)[number],
  );
  const mimeAccepted =
    !mimeType ||
    mimeType === "application/octet-stream" ||
    INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES.includes(
      mimeType as (typeof INR_MEDIA_ALLOWED_VIDEO_MIME_TYPES)[number],
    );
  return extensionAccepted && mimeAccepted;
}

function positiveNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function resolveSourceRegistryMetadata(
  metadata: Record<string, unknown>,
  mediaType: UniversalUploadMediaType,
) {
  const nested = cleanJsonObject(metadata.source_metadata);
  const source = { ...metadata, ...nested };
  const width = positiveNumber(source.width);
  const height = positiveNumber(source.height);
  const durationSeconds =
    mediaType === "video"
      ? positiveNumber(source.duration_seconds ?? source.duration)
      : null;

  return {
    width,
    height,
    durationSeconds,
    metadata: {
      ...metadata,
      source_metadata: {
        ...nested,
        width,
        height,
        duration_seconds: durationSeconds,
      },
      pipeline_mission: "source_metadata",
      preparation_scope: "source_only",
    },
  };
}

function safeAccountSegment(accountId: string) {
  return sanitizeUniversalMediaSegment(accountId, randomUUID()).replace(
    /\./g,
    "-",
  );
}

function targetFolder(
  target: UniversalMediaUploadTarget,
  requestedFolder: string,
) {
  const configured = TARGET_CONFIG[target].folder;
  if (!requestedFolder) return configured;

  const safeRequested = sanitizeUniversalMediaSegment(
    requestedFolder,
    configured,
  )
    .replace(/\./g, "-")
    .toLowerCase();

  const allowedByTarget: Record<UniversalMediaUploadTarget, Set<string>> = {
    booster_prepared_image: new Set(["booster-prepublish"]),
    booster_draft_image: new Set(["booster-drafts"]),
    booster_video_source: new Set([
      "booster-videos",
      "booster-drafts",
      "booster-video-source",
    ]),
    media_library_source: new Set(["library-source", "mediatheque"]),
    workspace_source: new Set(["workspace-source"]),
  };

  return allowedByTarget[target].has(safeRequested)
    ? safeRequested
    : configured;
}

function requestedFileName(path: string) {
  return (
    String(path || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || ""
  );
}

function buildStoragePath(params: {
  target: UniversalMediaUploadTarget;
  activeUserId: string;
  mediaType: UniversalUploadMediaType;
  fileName: string;
  contentType: string;
  requestedPath: string;
  requestedFolder: string;
}) {
  const config = TARGET_CONFIG[params.target];
  const account = safeAccountSegment(params.activeUserId);
  const folder = targetFolder(params.target, params.requestedFolder);
  const pathName = requestedFileName(params.requestedPath);
  const safeFileName = sanitizeUniversalMediaFileName({
    name: pathName || params.fileName,
    mimeType: params.contentType,
    mediaType: params.mediaType,
  });
  const uniqueName = `${Date.now()}-${randomUUID()}-${safeFileName}`;
  const year = new Date().getUTCFullYear();

  if (config.bucket === "inrcy-pro-media") {
    return `users/${account}/${folder}/${params.mediaType}/${year}/${uniqueName}`;
  }
  return `${account}/${folder}/${uniqueName}`;
}


async function readOwnedWorkspace(activeUserId: string, workspaceId: string) {
  if (!workspaceId) return null;
  const result = await supabaseAdmin
    .from("publication_workspaces")
    .select("id,account_id,status,revision")
    .eq("id", workspaceId)
    .eq("account_id", activeUserId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function attachRegisteredMediaToWorkspace(params: {
  activeUserId: string;
  authUserId: string;
  workspaceId: string;
  mediaId: string;
  mediaType: UniversalUploadMediaType;
  position: number;
  metadata: Record<string, unknown>;
}) {
  const workspace = await readOwnedWorkspace(
    params.activeUserId,
    params.workspaceId,
  );
  if (!workspace) {
    throw new Error("Espace média introuvable pour cet établissement.");
  }
  if (["published", "archived"].includes(String(workspace.status || ""))) {
    throw new Error("Cet espace média est déjà clôturé.");
  }

  const existingAtPosition = await supabaseAdmin
    .from("publication_workspace_media")
    .select("media_id")
    .eq("workspace_id", params.workspaceId)
    .eq("position", params.position)
    .maybeSingle();
  if (existingAtPosition.error) throw existingAtPosition.error;
  if (
    existingAtPosition.data?.media_id &&
    existingAtPosition.data.media_id !== params.mediaId
  ) {
    throw new Error(
      "La position de ce média a changé. iNrCy va resynchroniser le workspace.",
    );
  }

  const attached = await supabaseAdmin
    .from("publication_workspace_media")
    .upsert(
      {
        workspace_id: params.workspaceId,
        media_id: params.mediaId,
        position: params.position,
        media_role: params.position === 0 ? "primary" : "secondary",
        selected_channels: Array.isArray(params.metadata.selected_channels)
          ? params.metadata.selected_channels
          : [],
        media_settings:
          params.metadata.media_settings &&
          typeof params.metadata.media_settings === "object" &&
          !Array.isArray(params.metadata.media_settings)
            ? params.metadata.media_settings
            : {},
        channel_settings:
          params.metadata.channel_settings &&
          typeof params.metadata.channel_settings === "object" &&
          !Array.isArray(params.metadata.channel_settings)
            ? params.metadata.channel_settings
            : {},
        added_by_auth_user_id: params.authUserId,
      },
      { onConflict: "workspace_id,media_id" },
    );
  if (attached.error) throw attached.error;

  const updated = await supabaseAdmin
    .from("publication_workspaces")
    .update({
      revision: Number(workspace.revision || 1) + 1,
      last_opened_at: new Date().toISOString(),
    })
    .eq("id", params.workspaceId)
    .eq("account_id", params.activeUserId);
  if (updated.error) throw updated.error;

  await refreshPublicationWorkspaceMediaStatus({
    workspaceId: params.workspaceId,
    accountId: params.activeUserId,
  });
}

async function createSignedIntent(bucket: string, storagePath: string) {
  return await createSignedUploadUrlWithRetry(() =>
    supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath, { upsert: true }),
  );
}

async function getExistingRegisteredMedia(
  activeUserId: string,
  clientMediaKey: string,
) {
  if (!clientMediaKey) return null;
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select(
      "id,user_id,bucket_name,storage_path,media_type,mime_type,size_bytes,upload_status,upload_protocol,client_media_key,original_file_name,width,height,duration_seconds,media_metadata",
    )
    .eq("user_id", activeUserId)
    .eq("client_media_key", clientMediaKey)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function createOrReuseRegistryRow(params: {
  activeUserId: string;
  authUserId: string;
  clientMediaKey: string;
  workspaceId: string;
  storagePath: string;
  bucket: string;
  mediaType: UniversalUploadMediaType;
  contentType: string;
  sizeBytes: number;
  fileName: string;
  protocol: "signed" | "tus";
  source: string;
  uploadTarget: UniversalMediaUploadTarget;
  metadata: Record<string, unknown>;
}) {
  const existing = await getExistingRegisteredMedia(
    params.activeUserId,
    params.clientMediaKey,
  );
  const sourceRegistry = resolveSourceRegistryMetadata(
    params.metadata,
    params.mediaType,
  );
  const registryVisibleInMediaLibrary = params.uploadTarget === "workspace_source";

  if (existing) {
    const uploaded = existing.upload_status === "uploaded";
    const update = await supabaseAdmin
      .from("pro_media_library")
      .update({
        upload_protocol: params.protocol,
        upload_status: uploaded ? "uploaded" : "pending",
        upload_progress: uploaded ? 100 : 0,
        upload_error_code: null,
        upload_error_message: null,
        is_active: registryVisibleInMediaLibrary,
        original_retention_until: null,
        original_deleted_at: null,
        upload_started_at: uploaded ? undefined : new Date().toISOString(),
        width: sourceRegistry.width ?? existing.width ?? null,
        height: sourceRegistry.height ?? existing.height ?? null,
        duration_seconds:
          sourceRegistry.durationSeconds ?? existing.duration_seconds ?? null,
        media_metadata: {
          ...cleanJsonObject(existing.media_metadata),
          ...sourceRegistry.metadata,
          workspace_id: params.workspaceId || null,
          upload_target: params.uploadTarget,
        },
      })
      .eq("id", existing.id)
      .eq("user_id", params.activeUserId)
      .select(
        "id,bucket_name,storage_path,media_type,mime_type,size_bytes,upload_status,upload_protocol,client_media_key",
      );
    if (update.error) throw update.error;
    const updatedRow = update.data?.[0] ?? null;
    if (!updatedRow) throw new Error("media_registry_update_missing");
    return { row: updatedRow, reused: true, alreadyUploaded: uploaded };
  }

  const insert = await supabaseAdmin
    .from("pro_media_library")
    .insert({
      user_id: params.activeUserId,
      created_by_auth_user_id: params.authUserId,
      bucket_name: params.bucket,
      storage_path: params.storagePath,
      media_type: params.mediaType,
      mime_type: params.contentType,
      size_bytes: params.sizeBytes,
      title: params.fileName.replace(/\.[^.]+$/, "") || "Média iNrCy",
      tags: [],
      source: params.source || "booster_workspace",
      is_active: registryVisibleInMediaLibrary,
      original_file_name: params.fileName,
      client_media_key: params.clientMediaKey,
      upload_protocol: params.protocol,
      upload_status: "pending",
      upload_progress: 0,
      processing_status: "not_requested",
      publication_status: "not_requested",
      processing_progress: 0,
      width: sourceRegistry.width,
      height: sourceRegistry.height,
      duration_seconds: sourceRegistry.durationSeconds,
      pipeline_version: UNIVERSAL_MEDIA_PIPELINE_VERSION,
      upload_started_at: new Date().toISOString(),
      media_metadata: {
        ...sourceRegistry.metadata,
        workspace_id: params.workspaceId || null,
        upload_target: params.uploadTarget,
      },
    })
    .select(
      "id,bucket_name,storage_path,media_type,mime_type,size_bytes,upload_status,upload_protocol,client_media_key",
    )
    .single();

  if (!insert.error) {
    return { row: insert.data, reused: false, alreadyUploaded: false };
  }

  // Une reprise concurrente peut gagner l'index d'idempotence entre le SELECT
  // et l'INSERT. On relit alors la ligne gagnante au lieu de créer un doublon.
  if (insert.error.code === "23505") {
    const concurrent = await getExistingRegisteredMedia(
      params.activeUserId,
      params.clientMediaKey,
    );
    if (concurrent) {
      return {
        row: concurrent,
        reused: true,
        alreadyUploaded: concurrent.upload_status === "uploaded",
      };
    }
  }

  throw insert.error;
}

export async function POST(request: Request) {
  try {
    const { errorResponse, activeUserId, authUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const limited = await enforceRateLimit({
      name: "media_pipeline_upload_intent",
      identifier: activeUserId,
      limit: 180,
      fallbackLimit: 180,
      window: "2 m",
      failClosed: false,
    });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as IntentBody | null;
    if (!body || typeof body !== "object") {
      return jsonError("Données d’envoi invalides.");
    }

    if (!isUniversalMediaUploadTarget(body.target)) {
      return jsonError("Destination média invalide.", 400, "invalid_target");
    }
    const target = body.target;
    const file = body.file || {};
    const fileName = cleanText(file.name, "media-inrcy", 240);
    const mimeType = cleanText(file.type, "", 120);
    const sizeBytes = Number(file.size || 0);
    const lastModified = Number(file.lastModified || 0);
    const mediaType = detectUniversalUploadMediaType({
      name: fileName,
      mimeType,
    });

    if (!mediaType) {
      return jsonError(
        "Ce format de média ne peut pas encore être préparé par iNrCy.",
        415,
        "unsupported_media_format",
      );
    }
    if (!targetAcceptsUniversalMediaType(target, mediaType)) {
      return jsonError(
        mediaType === "video"
          ? "Cette destination attend une image."
          : "Cette destination attend une vidéo.",
        400,
        "media_type_target_mismatch",
      );
    }
    if (
      mediaType === "video" &&
      (target === "booster_video_source" || target === "workspace_source") &&
      !isAcceptedBoosterVideoSource({ fileName, mimeType })
    ) {
      return jsonError(
        `Format vidÃ©o non autorisÃ© dans Booster. Formats acceptÃ©s : ${INR_MEDIA_VIDEO_FORMATS_LABEL}.`,
        415,
        "unsupported_booster_video_format",
      );
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return jsonError("La taille du média est invalide.", 400, "invalid_size");
    }

    const productMax = getUniversalMediaProductMaxBytes(mediaType);
    if (sizeBytes > productMax) {
      return jsonError(
        mediaType === "video"
          ? INR_MEDIA_VIDEO_TOO_LARGE_MESSAGE
          : `Image trop lourde. Taille maximale : ${getUniversalMediaProductMaxLabel(mediaType)}.`,
        413,
        "media_product_limit_exceeded",
      );
    }

    const hardMax = getUniversalMediaHardMaxBytes(mediaType);
    if (sizeBytes > hardMax) {
      return jsonError(
        "Ce fichier est exceptionnellement volumineux et dépasse le plafond de sécurité iNrCy.",
        413,
        "media_safety_limit_exceeded",
      );
    }

    const contentType = getUniversalMediaContentType({
      name: fileName,
      mimeType,
      mediaType,
    });
    const protocol = selectUniversalMediaUploadProtocol(sizeBytes);
    const config = TARGET_CONFIG[target];
    const clientMediaKey = cleanText(body.clientMediaKey, "", 500);
    const workspaceId = cleanText(body.workspaceId, "", 80);
    const workspacePosition =
      typeof body.workspacePosition === "number"
        ? body.workspacePosition
        : Number.NaN;
    const requestedPath = cleanText(body.requestedPath, "", 600);
    const requestedFolder = cleanText(body.requestedFolder, "", 100);
    const source = cleanText(body.source, "", 80);
    const metadata = sanitizeClientMediaMetadata(body.metadata);

    if (config.registerSource && !clientMediaKey) {
      return jsonError(
        "Clé média manquante pour la reprise d’upload.",
        400,
        "client_media_key_required",
      );
    }
    if (target === "workspace_source") {
      if (!workspaceId) {
        return jsonError(
          "Espace média manquant pour cet upload.",
          400,
          "workspace_required",
        );
      }
      if (
        !Number.isInteger(workspacePosition) ||
        workspacePosition < 0 ||
        workspacePosition > 5 ||
        (mediaType === "image" && workspacePosition > 4) ||
        (mediaType === "video" && workspacePosition !== 5)
      ) {
        return jsonError(
          "Position média invalide dans le workspace.",
          400,
          "workspace_position_invalid",
        );
      }
      const workspace = await readOwnedWorkspace(activeUserId, workspaceId);
      if (!workspace) {
        return jsonError(
          "Espace média introuvable pour cet établissement.",
          404,
          "workspace_not_found",
        );
      }
    }

    let storagePath = buildStoragePath({
      target,
      activeUserId,
      mediaType,
      fileName,
      contentType,
      requestedPath,
      requestedFolder,
    });
    let mediaId: string | null = null;
    let reused = false;
    let alreadyUploaded = false;

    if (config.registerSource) {
      const registry = await createOrReuseRegistryRow({
        activeUserId,
        authUserId,
        clientMediaKey,
        workspaceId,
        storagePath,
        bucket: config.bucket,
        mediaType,
        contentType,
        sizeBytes,
        fileName,
        protocol,
        source,
        uploadTarget: target,
        metadata: {
          ...metadata,
          last_modified: Number.isFinite(lastModified) ? lastModified : null,
        },
      });
      mediaId = String(registry.row.id || "") || null;
      storagePath = String(registry.row.storage_path || storagePath);
      reused = registry.reused;
      alreadyUploaded = registry.alreadyUploaded;

      if (target === "workspace_source" && mediaId) {
        await attachRegisteredMediaToWorkspace({
          activeUserId,
          authUserId,
          workspaceId,
          mediaId,
          mediaType,
          position: workspacePosition,
          metadata,
        });
      }
    }

    let token = "";
    let signedUrl: string | null = null;
    if (!alreadyUploaded) {
      const signed = await createSignedIntent(config.bucket, storagePath);
      if (signed.error || !signed.data?.token) {
        return jsonError(
          signed.error?.message || "Impossible de préparer l’envoi Supabase.",
          503,
          "signed_upload_unavailable",
        );
      }
      token = signed.data.token;
      signedUrl = signed.data.signedUrl || null;
    }

    const publicUrl = config.publicObject
      ? supabaseAdmin.storage.from(config.bucket).getPublicUrl(storagePath).data
          .publicUrl
      : null;
    const resumableEndpoint = buildDirectStorageResumableEndpoint(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    );

    return NextResponse.json({
      ok: true,
      target,
      mediaType,
      protocol,
      bucket: config.bucket,
      storagePath,
      token,
      signedUrl,
      publicUrl,
      contentType,
      resumableEndpoint,
      mediaId,
      clientMediaKey: clientMediaKey || null,
      reused,
      alreadyUploaded,
      standardUploadMaxBytes: UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES,
      safetyMaxBytes:
        mediaType === "video"
          ? UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES
          : UNIVERSAL_MEDIA_IMAGE_HARD_MAX_BYTES,
    });
  } catch (error) {
    console.error("[media-pipeline] upload intent failed", error);
    return jsonError(
      error instanceof Error
        ? error.message
        : "Impossible de préparer l’envoi du média.",
      500,
      "upload_intent_failed",
    );
  }
}
